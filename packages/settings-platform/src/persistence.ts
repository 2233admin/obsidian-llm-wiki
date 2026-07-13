import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { canonicalDigest, canonicalJson, deepClone } from "./canonical.js";
import { getDefinition } from "./registry.js";
import { SETTINGS_DOCUMENT_SCHEMA_VERSION } from "./types.js";
import { validateSettingsDocuments } from "./validation.js";
import type {
  MutableSettingsScope,
  SecretReference,
  SettingAssignment,
  SettingValue,
  SettingsDocument,
  SettingsMutationResult,
  SettingsRegistry,
  ValidationIssue,
} from "./types.js";

export interface StoreMutationOptions {
  expectedRevision: number;
  updatedBy: string;
  source?: string;
  reason?: string;
  expiresAt?: string;
}

export interface FileSettingsStoreOptions {
  scope: Exclude<MutableSettingsScope, "session">;
  targetId: string;
  filePath: string;
  registry: SettingsRegistry;
  clock?: () => string;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
}

export interface SettingsStoreRead {
  document: SettingsDocument;
  recoveredFromBackup: boolean;
  diagnostics: ValidationIssue[];
}

export interface MutableSettingsStore {
  readonly scope: MutableSettingsScope;
  readonly targetId: string;
  read(): Promise<SettingsStoreRead>;
  migrationState(): Promise<{ scope: MutableSettingsScope; targetId: string; schemaVersion: number }>;
  set(key: string, value: SettingValue | SecretReference, options: StoreMutationOptions): Promise<SettingsMutationResult>;
  unset(key: string, options: StoreMutationOptions): Promise<SettingsMutationResult>;
}

export interface ProductSettingsRead {
  scope: "product";
  targetId: "settings-platform";
  revision: string;
  registryDigest: string;
  defaults: SettingAssignment[];
}

/** Read-only product scope backed exclusively by the versioned registry. */
export class ProductSettingsStore {
  readonly scope = "product" as const;
  readonly targetId = "settings-platform" as const;

  constructor(private readonly registry: SettingsRegistry) {}

  read(): ProductSettingsRead {
    return {
      scope: "product",
      targetId: "settings-platform",
      revision: this.registry.registryVersion,
      registryDigest: this.registry.registryDigest,
      defaults: this.registry.definitions.map(definition => ({
        key: definition.key,
        ...(definition.valueType === "secret-reference"
          ? { secretRef: deepClone(definition.defaultSecretRef!) }
          : { value: deepClone(definition.defaultValue as SettingValue) }),
        provenance: { actor: "registry", source: "registry/v1.json" },
      })),
    };
  }

  set(): never {
    throw new Error("Product settings are read-only and can change only with a registry release.");
  }

  unset(): never {
    throw new Error("Product settings are read-only and can change only with a registry release.");
  }
}

export class SettingsLockTimeoutError extends Error {
  readonly code = "settings-lock-timeout";

  constructor(readonly lockPath: string, timeoutMs: number) {
    super(`Timed out after ${timeoutMs}ms waiting for settings lock ${lockPath}`);
    this.name = "SettingsLockTimeoutError";
  }
}

export class SettingsPersistenceError extends Error {
  readonly code = "settings-persistence-error";

  constructor(message: string, readonly diagnostics: ValidationIssue[] = []) {
    super(message);
    this.name = "SettingsPersistenceError";
  }
}

export class FileSettingsStore implements MutableSettingsStore {
  readonly scope: Exclude<MutableSettingsScope, "session">;
  readonly targetId: string;
  readonly filePath: string;

  private readonly registry: SettingsRegistry;
  private readonly clock: () => string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryMs: number;

  constructor(options: FileSettingsStoreOptions) {
    this.scope = options.scope;
    this.targetId = options.targetId;
    this.filePath = options.filePath;
    this.registry = options.registry;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.lockTimeoutMs = options.lockTimeoutMs ?? 2_000;
    this.lockRetryMs = options.lockRetryMs ?? 20;
  }

  async read(): Promise<SettingsStoreRead> {
    const active = await this.readPath(this.filePath);
    if (active.status === "valid") {
      return { document: active.document, recoveredFromBackup: false, diagnostics: active.diagnostics };
    }
    const backup = await this.readPath(`${this.filePath}.bak`);
    if (backup.status === "valid") {
      return {
        document: backup.document,
        recoveredFromBackup: true,
        diagnostics: [
          ...active.diagnostics,
          {
            code: "active-document-recovered",
            severity: "warning",
            message: `Recovered ${this.scope}:${this.targetId} from its previous-revision backup.`,
            scope: this.scope,
            targetId: this.targetId,
            remediation: "Commit a valid mutation to replace the corrupt active document.",
          },
        ],
      };
    }
    if (active.status === "missing" && backup.status === "missing") {
      return { document: this.emptyDocument(), recoveredFromBackup: false, diagnostics: [] };
    }
    throw new SettingsPersistenceError(
      `Neither active nor backup settings document is usable for ${this.scope}:${this.targetId}.`,
      [...active.diagnostics, ...backup.diagnostics],
    );
  }

  async set(
    key: string,
    value: SettingValue | SecretReference,
    options: StoreMutationOptions,
  ): Promise<SettingsMutationResult> {
    return this.withLock(() => this.mutate("set", key, value, options));
  }

  async unset(key: string, options: StoreMutationOptions): Promise<SettingsMutationResult> {
    return this.withLock(() => this.mutate("unset", key, undefined, options));
  }

  private async mutate(
    kind: "set" | "unset",
    key: string,
    value: SettingValue | SecretReference | undefined,
    options: StoreMutationOptions,
  ): Promise<SettingsMutationResult> {
    const currentRead = await this.read();
    const current = currentRead.document;
    if (current.revision !== options.expectedRevision) {
      return {
        status: "conflict",
        document: deepClone(current),
        conflict: {
          scope: this.scope,
          targetId: this.targetId,
          expectedRevision: options.expectedRevision,
          actualRevision: current.revision,
          changedKeys: await this.changedKeysSince(current, options.expectedRevision),
        },
      };
    }

    const plan = planMutation({
      registry: this.registry,
      current,
      scope: this.scope,
      targetId: this.targetId,
      kind,
      key,
      value,
      options,
      clock: this.clock,
    });
    if ("status" in plan) return plan;
    const { proposed, event } = plan;

    const backupPath = `${this.filePath}.bak`;
    if (current.revision > 0 || await exists(this.filePath)) {
      await atomicWrite(backupPath, `${canonicalJson(current)}\n`);
    }
    proposed.previousRevision = {
      revision: current.revision,
      digest: canonicalDigest(current),
      ...(current.revision > 0 || await exists(backupPath) ? { backupPath: basename(backupPath) } : {}),
    };
    await atomicWrite(this.filePath, `${canonicalJson(proposed)}\n`);
    return {
      status: "committed",
      document: deepClone(proposed),
      event,
    };
  }

  async migrationState(): Promise<{ scope: MutableSettingsScope; targetId: string; schemaVersion: number }> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { scope: this.scope, targetId: this.targetId, schemaVersion: SETTINGS_DOCUMENT_SCHEMA_VERSION };
      }
      throw new SettingsPersistenceError(`Settings document could not be inspected for migration: ${(error as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SettingsPersistenceError("Settings document is not valid JSON and cannot be inspected for migration.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SettingsPersistenceError("Settings document must be a JSON object to plan migrations.");
    }
    const document = parsed as Partial<SettingsDocument>;
    if (document.scope !== this.scope || document.targetId !== this.targetId) {
      throw new SettingsPersistenceError("Settings document scope identity does not match its store.");
    }
    if (!Number.isInteger(document.schemaVersion) || (document.schemaVersion as number) < 0) {
      throw new SettingsPersistenceError("Settings document schemaVersion must be a non-negative integer.");
    }
    return { scope: this.scope, targetId: this.targetId, schemaVersion: document.schemaVersion as number };
  }

  private async changedKeysSince(current: SettingsDocument, expectedRevision: number): Promise<string[]> {
    if (current.previousRevision?.revision === expectedRevision) {
      const backup = await this.readPath(`${this.filePath}.bak`);
      if (backup.status === "valid" && backup.document.revision === expectedRevision) {
        return changedAssignmentKeys(backup.document, current);
      }
    }
    return current.assignments.map(assignment => assignment.key).sort();
  }

  private emptyDocument(): SettingsDocument {
    return {
      schemaVersion: 1,
      scope: this.scope,
      targetId: this.targetId,
      revision: 0,
      assignments: [],
      updatedAt: "1970-01-01T00:00:00.000Z",
      updatedBy: "settings-platform",
    };
  }

  private async readPath(path: string): Promise<
    | { status: "missing"; diagnostics: ValidationIssue[] }
    | { status: "invalid"; diagnostics: ValidationIssue[] }
    | { status: "valid"; document: SettingsDocument; diagnostics: ValidationIssue[] }
  > {
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing", diagnostics: [] };
      return {
        status: "invalid",
        diagnostics: [{
          code: "settings-read-failed",
          severity: "error",
          message: `Settings document could not be read: ${(error as Error).message}`,
          scope: this.scope,
          targetId: this.targetId,
        }],
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        status: "invalid",
        diagnostics: [{
          code: "settings-json-invalid",
          severity: "error",
          message: "Settings document is not valid JSON.",
          scope: this.scope,
          targetId: this.targetId,
        }],
      };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        status: "invalid",
        diagnostics: [{
          code: "settings-document-invalid",
          severity: "error",
          message: "Settings document must be a JSON object.",
          scope: this.scope,
          targetId: this.targetId,
        }],
      };
    }
    const document = parsed as SettingsDocument;
    if (document.scope !== this.scope || document.targetId !== this.targetId) {
      return {
        status: "invalid",
        diagnostics: [{
          code: "settings-identity-mismatch",
          severity: "error",
          message: "Settings document scope identity does not match its store.",
          scope: this.scope,
          targetId: this.targetId,
        }],
      };
    }
    const validation = validateSettingsDocuments(this.registry, [document]);
    if (!validation.valid) return { status: "invalid", diagnostics: validation.issues };
    return { status: "valid", document: deepClone(document), diagnostics: validation.issues };
  }

  private async withLock<T>(action: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const lockPath = `${this.filePath}.lock`;
    const deadline = Date.now() + this.lockTimeoutMs;
    let acquired = false;
    while (!acquired) {
      try {
        const handle = await open(lockPath, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: this.clock() }), "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        acquired = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (Date.now() >= deadline) throw new SettingsLockTimeoutError(lockPath, this.lockTimeoutMs);
        await delay(Math.min(this.lockRetryMs, Math.max(1, deadline - Date.now())));
      }
    }
    try {
      return await action();
    } finally {
      await rm(lockPath, { force: true });
    }
  }
}

export interface SessionSettingsStoreOptions {
  targetId: string;
  registry: SettingsRegistry;
  clock?: () => string;
  assignments?: SettingAssignment[];
}

export class SessionSettingsStore implements MutableSettingsStore {
  readonly scope = "session" as const;
  readonly targetId: string;
  private document: SettingsDocument;
  private previousDocument?: SettingsDocument;
  private readonly registry: SettingsRegistry;
  private readonly clock: () => string;

  constructor(options: SessionSettingsStoreOptions) {
    this.targetId = options.targetId;
    this.registry = options.registry;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.document = {
      schemaVersion: 1,
      scope: "session",
      targetId: options.targetId,
      revision: 0,
      assignments: deepClone(options.assignments ?? []).sort((a, b) => a.key.localeCompare(b.key)),
      updatedAt: options.assignments?.length ? this.clock() : "1970-01-01T00:00:00.000Z",
      updatedBy: options.assignments?.length ? "settings-bootstrap" : "settings-platform",
    };
  }

  async read(): Promise<SettingsStoreRead> {
    return { document: deepClone(this.document), recoveredFromBackup: false, diagnostics: [] };
  }

  async migrationState(): Promise<{ scope: MutableSettingsScope; targetId: string; schemaVersion: number }> {
    return { scope: "session", targetId: this.targetId, schemaVersion: this.document.schemaVersion };
  }

  async set(
    key: string,
    value: SettingValue | SecretReference,
    options: StoreMutationOptions,
  ): Promise<SettingsMutationResult> {
    return this.mutate("set", key, value, options);
  }

  async unset(key: string, options: StoreMutationOptions): Promise<SettingsMutationResult> {
    return this.mutate("unset", key, undefined, options);
  }

  private async mutate(
    kind: "set" | "unset",
    key: string,
    value: SettingValue | SecretReference | undefined,
    options: StoreMutationOptions,
  ): Promise<SettingsMutationResult> {
    const current = deepClone(this.document);
    if (current.revision !== options.expectedRevision) {
      return {
        status: "conflict",
        document: current,
        conflict: {
          scope: "session",
          targetId: this.targetId,
          expectedRevision: options.expectedRevision,
          actualRevision: current.revision,
          changedKeys: this.previousDocument?.revision === options.expectedRevision
            ? changedAssignmentKeys(this.previousDocument, current)
            : current.assignments.map(item => item.key).sort(),
        },
      };
    }
    const plan = planMutation({
      registry: this.registry,
      current,
      scope: "session",
      targetId: this.targetId,
      kind,
      key,
      value,
      options,
      clock: this.clock,
    });
    if ("status" in plan) return plan;
    const { proposed, event } = plan;
    proposed.previousRevision = { revision: current.revision, digest: canonicalDigest(current) };
    this.previousDocument = current;
    this.document = proposed;
    return {
      status: "committed",
      document: deepClone(proposed),
      event,
    };
  }
}

export function settingsDocumentPath(
  scope: Exclude<MutableSettingsScope, "session">,
  options: { vaultPath: string; userDevicePath: string; targetId: string },
): string {
  if (scope === "user-device") return options.userDevicePath;
  if (scope === "vault") return join(options.vaultPath, "_llmwiki", "settings", "vault.json");
  const match = /^project\/([a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?)$/.exec(options.targetId);
  if (!match) throw new Error(`workspace-project targetId must use canonical project/<slug> form: ${options.targetId}`);
  return join(options.vaultPath, "_llmwiki", "settings", "projects", `${match[1]}.json`);
}

export function defaultUserDeviceSettingsPath(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.LLMWIKI_SETTINGS_USER_PATH) return environment.LLMWIKI_SETTINGS_USER_PATH;
  const base = platform() === "win32"
    ? environment.APPDATA || join(homedir(), "AppData", "Roaming")
    : environment.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "llm-wiki", "settings", "user-device.json");
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await renameWithRetry(temporary, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (!new Set(["EACCES", "EPERM", "EBUSY"]).has(code ?? "")) throw error;
      await delay(10 * (attempt + 1));
    }
  }
  throw lastError;
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const directory = await open(path, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch {
    // Windows does not consistently support fsync on directory handles. The
    // file itself has already been synced before the atomic replace.
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function isSecretRefShape(value: unknown): value is SecretReference {
  return Boolean(
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as SecretReference).provider === "string"
    && typeof (value as SecretReference).locator === "string",
  );
}

function safeSegment(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized || normalized === "." || normalized === "..") throw new Error(`Unsafe settings target: ${value}`);
  return normalized;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface PlannedMutation {
  proposed: SettingsDocument;
  event: Extract<SettingsMutationResult, { status: "committed" }>["event"];
}

function planMutation(input: {
  registry: SettingsRegistry;
  current: SettingsDocument;
  scope: MutableSettingsScope;
  targetId: string;
  kind: "set" | "unset";
  key: string;
  value: SettingValue | SecretReference | undefined;
  options: StoreMutationOptions;
  clock: () => string;
}): PlannedMutation | Extract<SettingsMutationResult, { status: "validation-error" }> {
  const definition = getDefinition(input.registry, input.key);
  if (!definition) {
    return {
      status: "validation-error",
      document: deepClone(input.current),
      validation: {
        valid: false,
        issues: [{
          code: "unknown-setting",
          severity: "error",
          message: `Unknown setting ${input.key} cannot be mutated.`,
          key: input.key,
          scope: input.scope,
          targetId: input.targetId,
        }],
      },
    };
  }
  const assignments = input.current.assignments
    .filter(assignment => assignment.key !== input.key)
    .map(deepClone);
  if (input.kind === "set") {
    const assignment: SettingAssignment = {
      key: input.key,
      provenance: {
        actor: input.options.updatedBy,
        source: input.options.source ?? "settings.assignment.set",
        ...(input.options.reason ? { reason: input.options.reason } : {}),
      },
      ...(input.options.expiresAt ? { expiresAt: input.options.expiresAt } : {}),
    };
    if (definition.valueType === "secret-reference" && isSecretRefShape(input.value)) {
      assignment.secretRef = deepClone(input.value);
    } else {
      assignment.value = deepClone(input.value as SettingValue);
    }
    assignments.push(assignment);
  }
  assignments.sort((left, right) => left.key.localeCompare(right.key));
  const now = input.clock();
  const proposed: SettingsDocument = {
    ...deepClone(input.current),
    revision: input.current.revision + 1,
    assignments,
    updatedAt: now,
    updatedBy: input.options.updatedBy,
  };
  delete proposed.previousRevision;
  const validation = validateSettingsDocuments(input.registry, [proposed]);
  if (!validation.valid) {
    return { status: "validation-error", document: deepClone(input.current), validation };
  }
  return {
    proposed,
    event: {
      type: "SettingsAssignmentsChanged",
      scope: input.scope,
      targetId: input.targetId,
      previousRevision: input.current.revision,
      revision: proposed.revision,
      keys: [input.key],
      actor: input.options.updatedBy,
      occurredAt: now,
    },
  };
}

function changedAssignmentKeys(before: SettingsDocument, after: SettingsDocument): string[] {
  const previous = new Map(before.assignments.map(assignment => [assignment.key, canonicalJson(assignment)]));
  const current = new Map(after.assignments.map(assignment => [assignment.key, canonicalJson(assignment)]));
  return [...new Set([...previous.keys(), ...current.keys()])]
    .filter(key => previous.get(key) !== current.get(key))
    .sort();
}
