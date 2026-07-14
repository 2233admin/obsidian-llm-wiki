import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";

import { deepClone } from "./canonical.js";
import {
  FileSettingsStore,
  ProductSettingsStore,
  SessionSettingsStore,
  defaultUserDeviceSettingsPath,
  settingsDocumentPath,
  type MutableSettingsStore,
  type ProductSettingsRead,
  type SettingsStoreRead,
  type StoreMutationOptions,
} from "./persistence.js";
import { getDefinition, loadRegistry } from "./registry.js";
import { explainSetting, resolveSettings } from "./resolver.js";
import { targetForScope, validateSettingsDocuments } from "./validation.js";
import type {
  CapabilityHealth,
  MutableSettingsScope,
  RuntimeContext,
  SecretReference,
  SecretStatus,
  SettingAssignment,
  SettingValue,
  SettingsDocument,
  SettingsMutationResult,
  SettingsRegistry,
  SettingsScope,
  SettingsSnapshot,
  ValidationIssue,
  ValidationResult,
} from "./types.js";

export interface SettingsServiceOptions {
  registry: SettingsRegistry;
  vaultPath: string;
  userDeviceId?: string;
  userDevicePath?: string;
  vaultId?: string;
  workspaceProjectId?: string;
  sessionId?: string;
  pythonPath?: string;
  compilerPath?: string;
  environment?: NodeJS.ProcessEnv;
  clock?: () => string;
}

export interface SettingsDoctorResult {
  snapshotId?: string;
  validation: ValidationResult;
  capabilities: CapabilityHealth[];
  checkedAt: string;
}

export type AgentModelMode = "inherit" | "local" | "cloud";

export interface AgentModelInvocationProfile {
  mode: AgentModelMode;
  provider: string;
  baseUrl: string;
  model: string;
  credential?: {
    secretRef: SecretReference;
    status: SecretStatus;
  };
}

export class SettingsService {
  readonly registry: SettingsRegistry;
  readonly defaultContext: RuntimeContext;

  private readonly vaultPath: string;
  private readonly userDevicePath: string;
  private readonly clock: () => string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly stores = new Map<string, MutableSettingsStore>();

  constructor(options: SettingsServiceOptions) {
    this.registry = options.registry;
    this.vaultPath = options.vaultPath;
    this.environment = options.environment ?? process.env;
    this.userDevicePath = options.userDevicePath ?? defaultUserDeviceSettingsPath(this.environment);
    this.clock = options.clock ?? (() => new Date().toISOString());
    const vaultId = options.vaultId ?? safeIdentity(basename(options.vaultPath) || "default-vault");
    const sessionId = options.sessionId ?? `process-${process.pid}`;
    this.defaultContext = {
      userDeviceId: options.userDeviceId ?? defaultUserDeviceId(this.environment),
      vaultId,
      ...(options.workspaceProjectId ? { workspaceProjectId: options.workspaceProjectId } : {}),
      sessionId,
    };
    const bootstrap = this.bootstrapAssignments({
      pythonPath: options.pythonPath,
      compilerPath: options.compilerPath,
      vaultPath: options.vaultPath,
      vaultId,
    });
    this.stores.set(
      this.storeKey("session", sessionId),
      new SessionSettingsStore({ targetId: sessionId, registry: this.registry, clock: this.clock, assignments: bootstrap }),
    );
  }

  static fromRegistryPath(options: Omit<SettingsServiceOptions, "registry"> & { registryPath: string }): SettingsService {
    return new SettingsService({ ...options, registry: loadRegistry(options.registryPath) });
  }

  definitionsList() {
    return {
      registryVersion: this.registry.registryVersion,
      registryDigest: this.registry.registryDigest,
      definitions: deepClone(this.registry.definitions),
    };
  }

  definitionsGet(key: string) {
    const definition = getDefinition(this.registry, key);
    if (!definition) throw new Error(`Unknown setting: ${key}`);
    return deepClone(definition);
  }

  async scopesGet(scope: "product", targetId?: string): Promise<ProductSettingsRead>;
  async scopesGet(scope: MutableSettingsScope, targetId?: string): Promise<SettingsStoreRead>;
  async scopesGet(scope: SettingsScope, targetId?: string): Promise<ProductSettingsRead | SettingsStoreRead>;
  async scopesGet(scope: SettingsScope, targetId?: string): Promise<ProductSettingsRead | SettingsStoreRead> {
    if (scope === "product") return new ProductSettingsStore(this.registry).read();
    const resolvedTarget = targetId ?? targetForScope(scope, this.defaultContext);
    if (!resolvedTarget) throw new Error(`${scope} scope requires a targetId in the runtime context`);
    const read = await this.getStore(scope, resolvedTarget).read();
    return { ...read, document: deepClone(read.document) };
  }

  async snapshotResolve(context: RuntimeContext = this.defaultContext): Promise<{
    snapshot: SettingsSnapshot;
    validation: ValidationResult;
    recoveryDiagnostics: ValidationIssue[];
  }> {
    const { documents, diagnostics } = await this.readDocuments(context);
    const secretStatus = this.secretStatuses(documents);
    const snapshot = resolveSettings({
      registry: this.registry,
      context,
      documents,
      secretStatus,
      createdAt: this.clock(),
    });
    const validation = this.validateResolved(documents, context, snapshot);
    return { snapshot, validation, recoveryDiagnostics: diagnostics };
  }

  async snapshotExplain(key: string, context: RuntimeContext = this.defaultContext) {
    const { documents } = await this.readDocuments(context);
    return explainSetting({
      registry: this.registry,
      context,
      documents,
      secretStatus: this.secretStatuses(documents),
      createdAt: this.clock(),
      key,
    });
  }

  /** Return a redacted invocation profile; host adapters resolve secrets. */
  async agentModelInvocationProfile(
    context: RuntimeContext = this.defaultContext,
  ): Promise<AgentModelInvocationProfile> {
    const { snapshot } = await this.snapshotResolve(context);
    const mode = effectiveString(snapshot, "models.agent.mode") as AgentModelMode;
    const provider = effectiveString(snapshot, "models.agent.provider");
    const baseUrl = effectiveString(snapshot, "models.agent.base_url");
    const model = effectiveString(snapshot, "models.agent.model");
    const credentialValue = snapshot.effective.find(item => item.key === "models.agent.secret_ref")?.value;
    const secretRef = effectiveSecretReference(snapshot, "models.agent.secret_ref");
    const status = credentialValue && typeof credentialValue === "object" && !Array.isArray(credentialValue)
      && "status" in credentialValue && typeof (credentialValue as { status?: unknown }).status === "string"
      ? (credentialValue as { status: SecretStatus }).status
      : undefined;
    return {
      mode,
      provider,
      baseUrl,
      model,
      ...(secretRef && status ? { credential: { secretRef, status } } : {}),
    };
  }

  async assignmentSet(input: {
    scope: MutableSettingsScope;
    targetId?: string;
    key: string;
    value: SettingValue | SecretReference;
    expectedRevision: number;
    updatedBy: string;
    reason?: string;
    expiresAt?: string;
  }): Promise<SettingsMutationResult> {
    const targetId = input.targetId ?? targetForScope(input.scope, this.defaultContext);
    if (!targetId) throw new Error(`${input.scope} scope requires targetId`);
    const options: StoreMutationOptions = {
      expectedRevision: input.expectedRevision,
      updatedBy: input.updatedBy,
      source: "settings.assignment.set",
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    };
    return this.getStore(input.scope, targetId).set(input.key, input.value, options);
  }

  async assignmentUnset(input: {
    scope: MutableSettingsScope;
    targetId?: string;
    key: string;
    expectedRevision: number;
    updatedBy: string;
    reason?: string;
  }): Promise<SettingsMutationResult> {
    const targetId = input.targetId ?? targetForScope(input.scope, this.defaultContext);
    if (!targetId) throw new Error(`${input.scope} scope requires targetId`);
    return this.getStore(input.scope, targetId).unset(input.key, {
      expectedRevision: input.expectedRevision,
      updatedBy: input.updatedBy,
      source: "settings.assignment.unset",
      ...(input.reason ? { reason: input.reason } : {}),
    });
  }

  async validate(context: RuntimeContext = this.defaultContext): Promise<ValidationResult> {
    const { documents } = await this.readDocuments(context);
    const snapshot = resolveSettings({
      registry: this.registry,
      context,
      documents,
      secretStatus: this.secretStatuses(documents),
      createdAt: this.clock(),
    });
    return this.validateResolved(documents, context, snapshot);
  }

  async migrationsPlan(context: RuntimeContext = this.defaultContext) {
    const entries: Array<[MutableSettingsScope, string | undefined]> = [
      ["user-device", context.userDeviceId],
      ["vault", context.vaultId],
      ["workspace-project", context.workspaceProjectId],
      ["session", context.sessionId],
    ];
    const states = await Promise.all(entries
      .filter((entry): entry is [MutableSettingsScope, string] => Boolean(entry[1]))
      .map(([scope, targetId]) => this.getStore(scope, targetId).migrationState()));
    const scopes = states.map(state => {
      const applicable = this.registry.migrations
        .filter(migration => migration.fromSchemaVersion >= state.schemaVersion
          && migration.toSchemaVersion <= this.registry.schemaVersion)
        .sort((a, b) => a.fromSchemaVersion - b.fromSchemaVersion);
      return {
        scope: state.scope,
        targetId: state.targetId,
        currentSchemaVersion: state.schemaVersion,
        targetSchemaVersion: this.registry.schemaVersion,
        migrations: applicable,
        requiresMigration: state.schemaVersion !== this.registry.schemaVersion,
      };
    });
    return { registryVersion: this.registry.registryVersion, writeRequired: scopes.some(item => item.requiresMigration), scopes };
  }

  async doctor(context: RuntimeContext = this.defaultContext): Promise<SettingsDoctorResult> {
    const checkedAt = this.clock();
    let snapshot: SettingsSnapshot | undefined;
    let validation: ValidationResult;
    try {
      const resolved = await this.snapshotResolve(context);
      snapshot = resolved.snapshot;
      validation = resolved.validation;
    } catch (error) {
      validation = {
        valid: false,
        issues: [{
          code: "settings-unavailable",
          severity: "error",
          message: `Settings could not be resolved: ${(error as Error).message}`,
          remediation: "Repair the active settings document or restore its backup.",
        }],
      };
    }
    if (!snapshot) return { validation, capabilities: [], checkedAt };

    const value = (key: string) => snapshot!.effective.find(item => item.key === key)?.value;
    const capabilities: CapabilityHealth[] = [];
    const python = value("runtime.python.path");
    const pythonAvailable = typeof python === "string" && probePython(python);
    capabilities.push(this.health(
      "runtime.python",
      pythonAvailable ? "available" : "unavailable",
      pythonAvailable ? "Python runtime responded to a version probe." : "Python runtime could not be executed.",
      checkedAt,
      snapshot.snapshotId,
      pythonAvailable ? "pass" : "fail",
      pythonAvailable ? [] : [{ code: "configure-python", summary: "Set runtime.python.path to an executable Python runtime.", operation: "settings.assignment.set" }],
    ));
    const vaultPath = value("vault.path");
    const vaultAvailable = typeof vaultPath === "string" && existsSync(vaultPath);
    capabilities.push(this.health(
      "vault.filesystem",
      vaultAvailable ? "available" : "unavailable",
      vaultAvailable ? "Configured vault path is accessible." : "Configured vault path is unavailable on this device.",
      checkedAt,
      snapshot.snapshotId,
      vaultAvailable ? "pass" : "fail",
      vaultAvailable ? [] : [{ code: "configure-vault-path", summary: "Set vault.path at user-device or session scope.", operation: "settings.assignment.set" }],
    ));
    const queryEnabled = value("query.semantic.enabled") === true;
    capabilities.push(this.health(
      "query.semantic",
      queryEnabled ? (pythonAvailable ? "available" : "degraded") : "disabled",
      queryEnabled
        ? (pythonAvailable ? "Semantic query is enabled and its runtime is available." : "Semantic query is enabled but its runtime is unavailable; keyword query remains available.")
        : "Semantic query is intentionally disabled.",
      checkedAt,
      snapshot.snapshotId,
      queryEnabled ? (pythonAvailable ? "pass" : "warn") : "pass",
      queryEnabled && !pythonAvailable ? [{ code: "repair-python", summary: "Repair runtime.python.path.", operation: "settings.assignment.set" }] : [],
    ));
    const diagnosticsEnabled = value("diagnostics.obc.semantic.enabled") === true;
    const diagnosticsAvailable = queryEnabled && pythonAvailable;
    capabilities.push(this.health(
      "diagnostics.obc.semantic",
      diagnosticsEnabled ? (diagnosticsAvailable ? "available" : "degraded") : "disabled",
      diagnosticsEnabled
        ? (diagnosticsAvailable
            ? "Semantic link suggestions are enabled."
            : queryEnabled
              ? "Semantic query is enabled but its Python runtime is unavailable; deterministic diagnostics remain available."
              : "Deterministic diagnostics remain available without semantic query.")
        : "Semantic link suggestions are intentionally disabled; deterministic diagnostics remain available.",
      checkedAt,
      snapshot.snapshotId,
      diagnosticsEnabled && !diagnosticsAvailable ? "warn" : "pass",
      diagnosticsEnabled && !queryEnabled
        ? [{ code: "enable-semantic-query", summary: "Enable query.semantic.enabled or disable semantic diagnostics.", operation: "settings.assignment.set" }]
        : diagnosticsEnabled && !pythonAvailable
          ? [{ code: "repair-python", summary: "Repair runtime.python.path.", operation: "settings.assignment.set" }]
          : [],
    ));
    const webEnabled = value("providers.web_search.enabled") === true;
    const secret = value("providers.web_search.secret_ref") as { status?: SecretStatus } | undefined;
    const webState = !webEnabled ? "disabled" : secret?.status === "present" ? "available" : secret?.status === "unreachable" ? "degraded" : "unavailable";
    capabilities.push(this.health(
      "providers.web-search",
      webState,
      !webEnabled ? "Web search is intentionally disabled." : secret?.status === "present" ? "Web search credential reference is present." : "Web search credential reference is not resolvable.",
      checkedAt,
      snapshot.snapshotId,
      webState === "available" || webState === "disabled" ? "pass" : webState === "degraded" ? "warn" : "fail",
      webState === "degraded" || webState === "unavailable"
        ? [{ code: "configure-web-secret", summary: "Configure the referenced secret without storing its value in Settings.", operation: "settings.assignment.set" }]
        : [],
    ));
    const agentMode = value("models.agent.mode") as AgentModelMode | undefined;
    const agentProvider = value("models.agent.provider");
    const agentBaseUrl = value("models.agent.base_url");
    const agentModel = value("models.agent.model");
    const agentSecret = value("models.agent.secret_ref") as { status?: SecretStatus } | undefined;
    const agentConfigured = typeof agentProvider === "string" && Boolean(agentProvider)
      && typeof agentBaseUrl === "string" && Boolean(agentBaseUrl)
      && typeof agentModel === "string" && Boolean(agentModel);
    const agentState: CapabilityHealth["state"] = agentMode === "inherit"
      ? "available"
      : !agentConfigured
        ? "unavailable"
        : agentMode === "cloud" && agentSecret?.status !== "present"
          ? agentSecret?.status === "unreachable" ? "degraded" : "unavailable"
          : "available";
    const agentSummary = agentMode === "inherit"
      ? "Agent model remains on the legacy environment/YAML compatibility path."
      : !agentConfigured
        ? "Agent model connection is missing a provider, base URL, or model identifier."
        : agentMode === "local"
          ? "Local Agent model connection is configured without a cloud credential."
          : agentSecret?.status === "present"
            ? "Cloud Agent model connection and credential reference are configured."
            : "Cloud Agent model credential reference is not resolvable on this device.";
    capabilities.push(this.health(
      "models.agent",
      agentState,
      agentSummary,
      checkedAt,
      snapshot.snapshotId,
      agentState === "available" ? "pass" : agentState === "degraded" ? "warn" : "fail",
      agentState === "available" ? [] : [{
        code: agentMode === "inherit" ? "select-agent-model-mode" : "configure-agent-model",
        summary: agentMode === "inherit"
          ? "Select local or cloud mode to bring Agent model configuration under Settings Platform."
          : "Configure the Agent model connection and a device-local Secret Reference when cloud mode is selected.",
        operation: "settings.assignment.set",
      }],
    ));
    return { snapshotId: snapshot.snapshotId, validation, capabilities, checkedAt };
  }

  private async readDocuments(context: RuntimeContext): Promise<{ documents: SettingsDocument[]; diagnostics: ValidationIssue[] }> {
    const entries: Array<[MutableSettingsScope, string | undefined]> = [
      ["user-device", context.userDeviceId],
      ["vault", context.vaultId],
      ["workspace-project", context.workspaceProjectId],
      ["session", context.sessionId],
    ];
    const reads = await Promise.all(entries.filter((entry): entry is [MutableSettingsScope, string] => Boolean(entry[1])).map(async ([scope, targetId]) => {
      const read = await this.getStore(scope, targetId).read();
      return read;
    }));
    return {
      documents: reads.map(read => read.document),
      diagnostics: reads.flatMap(read => read.diagnostics),
    };
  }

  private getStore(scope: MutableSettingsScope, targetId: string): MutableSettingsStore {
    const key = this.storeKey(scope, targetId);
    const existing = this.stores.get(key);
    if (existing) return existing;
    const store = scope === "session"
      ? new SessionSettingsStore({ targetId, registry: this.registry, clock: this.clock })
      : new FileSettingsStore({
          scope,
          targetId,
          registry: this.registry,
          filePath: settingsDocumentPath(scope, {
            vaultPath: this.vaultPath,
            userDevicePath: this.userDevicePath,
            targetId,
          }),
          clock: this.clock,
        });
    this.stores.set(key, store);
    return store;
  }

  private storeKey(scope: MutableSettingsScope, targetId: string): string {
    return `${scope}:${targetId}`;
  }

  private bootstrapAssignments(input: {
    pythonPath?: string;
    compilerPath?: string;
    vaultPath: string;
    vaultId: string;
  }): SettingAssignment[] {
    const values: Array<[string, string | undefined]> = [
      ["runtime.python.path", input.pythonPath],
      ["runtime.kb_meta.path", input.compilerPath],
      ["vault.path", input.vaultPath],
      ["vault.id", input.vaultId],
    ];
    return values.filter((entry): entry is [string, string] => Boolean(entry[1])).map(([key, value]) => ({
      key,
      value,
      provenance: { actor: "settings-bootstrap", source: "runtime-adapter" },
    }));
  }

  private secretStatuses(documents: SettingsDocument[]): Record<string, SecretStatus> {
    const refs: SecretReference[] = this.registry.definitions
      .flatMap(definition => definition.defaultSecretRef ? [definition.defaultSecretRef] : [])
      .concat(documents.flatMap(document => document.assignments.flatMap(assignment => assignment.secretRef ? [assignment.secretRef] : [])));
    return Object.fromEntries(refs.map(ref => {
      const key = `${ref.provider}:${ref.locator}`;
      if (ref.provider === "environment") return [key, this.environment[ref.locator] ? "present" : "missing"];
      return [key, "unreachable"];
    }));
  }

  private validateResolved(
    documents: SettingsDocument[],
    context: RuntimeContext,
    snapshot: SettingsSnapshot,
  ): ValidationResult {
    const base = validateSettingsDocuments(this.registry, documents, context);
    const issues = [...base.issues, ...snapshot.effective.flatMap(item => item.validation.issues)];
    const effective = new Map(snapshot.effective.map(item => [item.key, item.value]));
    if (effective.get("diagnostics.obc.semantic.enabled") === true && effective.get("query.semantic.enabled") !== true) {
      issues.push({
        code: "semantic-diagnostics-degraded",
        severity: "warning",
        message: "Semantic link suggestions are enabled while semantic query is disabled; deterministic diagnostics remain available.",
        key: "diagnostics.obc.semantic.enabled",
        remediation: "Enable query.semantic.enabled or unset the semantic diagnostics override.",
      });
    }
    const secret = effective.get("providers.web_search.secret_ref") as { status?: SecretStatus } | undefined;
    if (effective.get("providers.web_search.enabled") === true && secret?.status !== "present") {
      issues.push({
        code: "web-search-secret-missing",
        severity: "warning",
        message: "Web search is enabled but its Secret Reference is not present.",
        key: "providers.web_search.secret_ref",
        remediation: "Make the referenced secret available without storing it in Settings.",
      });
    }
    const agentMode = effective.get("models.agent.mode");
    const agentSecret = effective.get("models.agent.secret_ref") as { status?: SecretStatus } | undefined;
    if (agentMode === "cloud" && agentSecret?.status !== "present") {
      issues.push({
        code: "agent-model-secret-missing",
        severity: "warning",
        message: "Cloud Agent model mode is selected but its Secret Reference is not present.",
        key: "models.agent.secret_ref",
        remediation: "Bind a device-local Secret Reference or select local/inherit mode.",
      });
    }
    return { valid: issues.every(item => item.severity !== "error"), issues };
  }

  private health(
    capabilityId: string,
    state: CapabilityHealth["state"],
    summary: string,
    checkedAt: string,
    snapshotId: string,
    evidenceStatus: "pass" | "warn" | "fail",
    remediations: CapabilityHealth["remediations"],
  ): CapabilityHealth {
    return {
      capabilityId,
      state,
      summary,
      evidence: [{ code: `${capabilityId}-probe`, summary, status: evidenceStatus, observedAt: checkedAt }],
      remediations,
      checkedAt,
      snapshotId,
    };
  }
}

export function defaultUserDeviceId(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.LLMWIKI_DEVICE_ID?.trim();
  return safeIdentity(configured || `device-${hostname()}`);
}

function probePython(executable: string): boolean {
  try {
    const result = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 1_500, windowsHide: true });
    return result.status === 0;
  } catch {
    return false;
  }
}

function safeIdentity(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "default-vault";
}

function effectiveString(snapshot: SettingsSnapshot, key: string): string {
  const value = snapshot.effective.find(item => item.key === key)?.value;
  return typeof value === "string" ? value : "";
}

function effectiveSecretReference(snapshot: SettingsSnapshot, key: string): SecretReference | undefined {
  const value = snapshot.effective.find(item => item.key === key)?.value;
  if (!value || typeof value !== "object" || Array.isArray(value) || !("secretRef" in value)) return undefined;
  const secretRef = (value as { secretRef?: unknown }).secretRef;
  if (!secretRef || typeof secretRef !== "object" || Array.isArray(secretRef)) return undefined;
  const candidate = secretRef as Partial<SecretReference>;
  return typeof candidate.provider === "string" && typeof candidate.locator === "string"
    ? candidate as SecretReference
    : undefined;
}
