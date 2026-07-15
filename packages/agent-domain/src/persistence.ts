import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { canonicalDigest, canonicalJson, deepClone } from "./canonical.js";
import { DomainConflictError, DomainValidationError } from "./errors.js";
import { withRecoverableFileLock } from "./locks.js";
import { assertSafeSharedState } from "./security.js";
import type {
  AgentProfile,
  AgentProfileCreate,
  AgentProfileId,
  AgentProfilePatch,
  ProjectAgentBinding,
  ProjectAgentBindingCreate,
  ProjectAgentBindingId,
  ProjectAgentBindingPatch,
  ProjectId,
  StoreMutationResult,
  Thread,
  ThreadCreate,
  ThreadId,
  ThreadLifecycle,
  ThreadReferenceCreate,
  VersionedRecord,
} from "./types.js";
import {
  bindingIdFor,
  parseAgentProfileId,
  parseBindingId,
  parseProjectId,
  parseThreadId,
  validateAgentProfile,
  validateProjectAgentBinding,
  validateThread,
} from "./validation.js";

type Clock = () => string;

export interface PersistenceOptions {
  stateRoot: string;
  clock?: Clock;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  staleLockMs?: number;
}

interface RevisionStoreOptions<T extends VersionedRecord> extends PersistenceOptions {
  kind: string;
  collectionDirectory: string;
  directoryForId: (id: string) => string;
  idOf: (record: T) => string;
  validate: (value: unknown) => T;
}

class RevisionStore<T extends VersionedRecord> {
  private readonly clock: Clock;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryMs: number;
  private readonly staleLockMs?: number;

  constructor(private readonly options: RevisionStoreOptions<T>) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.lockTimeoutMs = options.lockTimeoutMs ?? 2_000;
    this.lockRetryMs = options.lockRetryMs ?? 20;
    this.staleLockMs = options.staleLockMs;
  }

  now(): string {
    return this.clock();
  }

  async read(id: string): Promise<T | null> {
    const revisions = await this.revisionNumbers(id);
    if (revisions.length === 0) return null;
    for (let index = 0; index < revisions.length; index += 1) {
      if (revisions[index] !== index + 1) {
        throw new DomainConflictError(`${this.options.kind} revision history is not contiguous`, { id, revisions });
      }
    }
    return this.readRevision(id, revisions.at(-1)!);
  }

  async readRevision(id: string, revision: number): Promise<T | null> {
    if (!Number.isInteger(revision) || revision < 1) throw new DomainValidationError("revision must be a positive integer");
    const path = this.revisionPath(id, revision);
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      const record = this.options.validate(parsed);
      if (this.options.idOf(record) !== id || record.revision !== revision) {
        throw new DomainConflictError(`${this.options.kind} revision identity mismatch`, { id, revision });
      }
      let next = record;
      for (let previousNumber = revision - 1; previousNumber >= 1; previousNumber -= 1) {
        const previous = await this.readRevisionFile(id, previousNumber);
        if (!previous
          || next.previousRevision?.revision !== previous.revision
          || next.previousRevision.digest !== canonicalDigest(previous)) {
          throw new DomainConflictError(`${this.options.kind} revision predecessor lock mismatch`, { id, revision: next.revision });
        }
        next = previous;
      }
      return deepClone(record);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (error instanceof SyntaxError) throw new DomainConflictError(`${this.options.kind} revision is malformed`, { id, revision });
      throw error;
    }
  }

  async list(): Promise<T[]> {
    const revisionFiles = await latestRevisionFiles(join(this.options.stateRoot, this.options.collectionDirectory));
    const records: T[] = [];
    for (const path of revisionFiles) {
      const parsed = this.options.validate(JSON.parse(await readFile(path, "utf8")) as unknown);
      const id = this.options.idOf(parsed);
      if (this.revisionsDirectory(id) !== dirname(path)) {
        throw new DomainConflictError(`${this.options.kind} list projection found an identity/path mismatch`, { id });
      }
      const current = await this.read(id);
      if (!current) throw new DomainConflictError(`${this.options.kind} list projection references a missing record`, { id });
      records.push(current);
    }
    return records.sort((left, right) => this.options.idOf(left).localeCompare(this.options.idOf(right)));
  }

  private async readRevisionFile(id: string, revision: number): Promise<T | null> {
    const path = this.revisionPath(id, revision);
    try {
      const record = this.options.validate(JSON.parse(await readFile(path, "utf8")) as unknown);
      if (this.options.idOf(record) !== id || record.revision !== revision) {
        throw new DomainConflictError(`${this.options.kind} revision identity mismatch`, { id, revision });
      }
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async create(record: T): Promise<StoreMutationResult<T>> {
    return this.withLock(this.options.idOf(record), async () => {
      const current = await this.read(this.options.idOf(record));
      if (current) return { status: "conflict", expectedRevision: 0, actualRevision: current.revision, current };
      if (record.revision !== 1 || record.previousRevision !== undefined) {
        throw new DomainValidationError(`${this.options.kind} creation must start at revision 1 without previousRevision`);
      }
      await this.writeImmutableRevision(record);
      return { status: "committed", record: deepClone(record) };
    });
  }

  async update(
    id: string,
    expectedRevision: number,
    build: (current: T, now: string) => T,
  ): Promise<StoreMutationResult<T>> {
    return this.withLock(id, async () => {
      const current = await this.read(id);
      const actualRevision = current?.revision ?? 0;
      if (!current || actualRevision !== expectedRevision) {
        return { status: "conflict", expectedRevision, actualRevision, current };
      }
      const proposed = build(deepClone(current), this.now());
      if (this.options.idOf(proposed) !== id) throw new DomainValidationError(`${this.options.kind} stable ID cannot change`);
      if (proposed.revision !== current.revision + 1) throw new DomainValidationError(`${this.options.kind} revision must increment by one`);
      if (proposed.previousRevision?.revision !== current.revision || proposed.previousRevision.digest !== canonicalDigest(current)) {
        throw new DomainValidationError(`${this.options.kind} previousRevision must lock the exact prior record`);
      }
      await this.writeImmutableRevision(proposed);
      return { status: "committed", record: deepClone(proposed) };
    });
  }

  private async writeImmutableRevision(record: T): Promise<void> {
    assertSafeSharedState(record, this.options.kind);
    this.options.validate(record);
    const path = this.revisionPath(this.options.idOf(record), record.revision);
    await mkdir(dirname(path), { recursive: true });
    if (await exists(path)) throw new DomainConflictError(`${this.options.kind} immutable revision already exists`, {
      id: this.options.idOf(record),
      revision: record.revision,
    });
    await atomicCreate(path, `${canonicalJson(record)}\n`);
  }

  private async revisionNumbers(id: string): Promise<number[]> {
    const directory = this.revisionsDirectory(id);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return entries
      .filter((entry) => entry.isFile() && /^\d{12}\.json$/.test(entry.name))
      .map((entry) => Number.parseInt(basename(entry.name, ".json"), 10))
      .sort((left, right) => left - right);
  }

  private recordDirectory(id: string): string {
    return join(this.options.stateRoot, this.options.directoryForId(id));
  }

  private revisionsDirectory(id: string): string {
    return join(this.recordDirectory(id), "revisions");
  }

  private revisionPath(id: string, revision: number): string {
    return join(this.revisionsDirectory(id), `${String(revision).padStart(12, "0")}.json`);
  }

  private async withLock<R>(id: string, action: () => Promise<R>): Promise<R> {
    const lockPath = join(this.recordDirectory(id), ".lock");
    return withRecoverableFileLock({
      lockPath,
      now: () => this.now(),
      timeoutMs: this.lockTimeoutMs,
      retryMs: this.lockRetryMs,
      staleLockMs: this.staleLockMs,
    }, action);
  }
}

export class AgentProfileStore {
  private readonly store: RevisionStore<AgentProfile>;

  constructor(options: PersistenceOptions) {
    this.store = new RevisionStore({
      ...options,
      kind: "AgentProfile",
      collectionDirectory: "profiles",
      directoryForId: (id) => join("profiles", profileSlug(parseAgentProfileId(id))),
      idOf: (record) => record.profileId,
      validate: validateAgentProfile,
    });
  }

  read(profileId: AgentProfileId): Promise<AgentProfile | null> {
    parseAgentProfileId(profileId);
    return this.store.read(profileId);
  }

  readRevision(profileId: AgentProfileId, revision: number): Promise<AgentProfile | null> {
    parseAgentProfileId(profileId);
    return this.store.readRevision(profileId, revision);
  }

  async list(filter: { profileIds?: AgentProfileId[] } = {}): Promise<AgentProfile[]> {
    const profileIds = filter.profileIds?.map((profileId) => parseAgentProfileId(profileId));
    const records = await this.store.list();
    return records.filter((record) => !profileIds || profileIds.includes(record.profileId));
  }

  async create(input: AgentProfileCreate): Promise<StoreMutationResult<AgentProfile>> {
    assertSafeSharedState(input, "AgentProfileCreate");
    const profileId = parseAgentProfileId(input.profileId);
    const now = this.store.now();
    const record: AgentProfile = {
      schemaVersion: 1,
      profileId,
      revision: 1,
      displayName: input.displayName,
      role: input.role,
      responsibilities: [...(input.responsibilities ?? [])],
      capabilityClaims: [...(input.capabilityClaims ?? [])],
      constitution: {
        principles: [...input.constitution.principles],
        instructions: [...input.constitution.instructions],
      },
      defaultModelPolicy: { ...(input.defaultModelPolicy ?? { mode: "inherit" }) },
      createdAt: now,
      createdBy: input.actor,
      updatedAt: now,
      updatedBy: input.actor,
    };
    validateAgentProfile(record);
    return this.store.create(record);
  }

  async update(
    profileId: AgentProfileId,
    expectedRevision: number,
    patch: AgentProfilePatch,
    actor: string,
  ): Promise<StoreMutationResult<AgentProfile>> {
    assertSafeSharedState({ patch, actor }, "AgentProfilePatch");
    parseAgentProfileId(profileId);
    return this.store.update(profileId, expectedRevision, (current, now) => {
      const record: AgentProfile = {
        ...current,
        ...patch,
        responsibilities: [...(patch.responsibilities ?? current.responsibilities)],
        capabilityClaims: [...(patch.capabilityClaims ?? current.capabilityClaims)],
        constitution: patch.constitution ? {
          principles: [...patch.constitution.principles],
          instructions: [...patch.constitution.instructions],
        } : current.constitution,
        defaultModelPolicy: { ...(patch.defaultModelPolicy ?? current.defaultModelPolicy) },
        revision: current.revision + 1,
        previousRevision: { revision: current.revision, digest: canonicalDigest(current) },
        updatedAt: now,
        updatedBy: actor,
      };
      return validateAgentProfile(record);
    });
  }
}

export class ProjectAgentBindingStore {
  private readonly store: RevisionStore<ProjectAgentBinding>;

  constructor(options: PersistenceOptions) {
    this.store = new RevisionStore({
      ...options,
      kind: "ProjectAgentBinding",
      collectionDirectory: "bindings",
      directoryForId: (id) => {
        const parsed = parseBindingId(id).split("/");
        return join("bindings", parsed[1]!, parsed[2]!);
      },
      idOf: (record) => record.bindingId,
      validate: validateProjectAgentBinding,
    });
  }

  read(bindingId: ProjectAgentBindingId): Promise<ProjectAgentBinding | null> {
    parseBindingId(bindingId);
    return this.store.read(bindingId);
  }

  readRevision(bindingId: ProjectAgentBindingId, revision: number): Promise<ProjectAgentBinding | null> {
    parseBindingId(bindingId);
    return this.store.readRevision(bindingId, revision);
  }

  async list(filter: { projectId?: ProjectId; profileId?: AgentProfileId; enabled?: boolean } = {}): Promise<ProjectAgentBinding[]> {
    const projectId = filter.projectId === undefined ? undefined : parseProjectId(filter.projectId);
    const profileId = filter.profileId === undefined ? undefined : parseAgentProfileId(filter.profileId);
    const records = await this.store.list();
    return records.filter((record) => (projectId === undefined || record.projectId === projectId)
      && (profileId === undefined || record.profileId === profileId)
      && (filter.enabled === undefined || record.enabled === filter.enabled));
  }

  async create(input: ProjectAgentBindingCreate): Promise<StoreMutationResult<ProjectAgentBinding>> {
    assertSafeSharedState(input, "ProjectAgentBindingCreate");
    const projectId = parseProjectId(input.projectId);
    const profileId = parseAgentProfileId(input.profileId);
    const now = this.store.now();
    const record: ProjectAgentBinding = {
      schemaVersion: 1,
      bindingId: bindingIdFor(projectId, profileId),
      projectId,
      projectContextFingerprint: input.projectContextFingerprint,
      profileId,
      profileRevision: input.profileRevision,
      revision: 1,
      role: input.role,
      enabled: input.enabled ?? true,
      memoryScopes: [...(input.memoryScopes ?? ["recentContext", "openItems", "stableMemory"])],
      connectorGrantRefs: [...(input.connectorGrantRefs ?? [])],
      createdAt: now,
      createdBy: input.actor,
      updatedAt: now,
      updatedBy: input.actor,
    };
    validateProjectAgentBinding(record);
    return this.store.create(record);
  }

  async update(
    bindingId: ProjectAgentBindingId,
    expectedRevision: number,
    patch: ProjectAgentBindingPatch,
    actor: string,
  ): Promise<StoreMutationResult<ProjectAgentBinding>> {
    assertSafeSharedState({ patch, actor }, "ProjectAgentBindingPatch");
    parseBindingId(bindingId);
    return this.store.update(bindingId, expectedRevision, (current, now) => validateProjectAgentBinding({
      ...current,
      ...patch,
      memoryScopes: [...(patch.memoryScopes ?? current.memoryScopes)],
      connectorGrantRefs: [...(patch.connectorGrantRefs ?? current.connectorGrantRefs)],
      revision: current.revision + 1,
      previousRevision: { revision: current.revision, digest: canonicalDigest(current) },
      updatedAt: now,
      updatedBy: actor,
    }));
  }
}

export class ThreadStore {
  private readonly store: RevisionStore<Thread>;

  constructor(options: PersistenceOptions) {
    this.store = new RevisionStore({
      ...options,
      kind: "Thread",
      collectionDirectory: "threads",
      directoryForId: (id) => join("threads", threadSlug(parseThreadId(id))),
      idOf: (record) => record.threadId,
      validate: validateThread,
    });
  }

  read(threadId: ThreadId): Promise<Thread | null> {
    parseThreadId(threadId);
    return this.store.read(threadId);
  }

  readRevision(threadId: ThreadId, revision: number): Promise<Thread | null> {
    parseThreadId(threadId);
    return this.store.readRevision(threadId, revision);
  }

  async list(filter: {
    projectId?: ProjectId;
    profileId?: AgentProfileId;
    bindingId?: ProjectAgentBindingId;
    lifecycle?: ThreadLifecycle;
  } = {}): Promise<Thread[]> {
    const projectId = filter.projectId === undefined ? undefined : parseProjectId(filter.projectId);
    const profileId = filter.profileId === undefined ? undefined : parseAgentProfileId(filter.profileId);
    const bindingId = filter.bindingId === undefined ? undefined : parseBindingId(filter.bindingId);
    const records = await this.store.list();
    return records.filter((record) => (projectId === undefined || record.projectId === projectId)
      && (profileId === undefined || record.profileId === profileId)
      && (bindingId === undefined || record.bindingId === bindingId)
      && (filter.lifecycle === undefined || record.lifecycle === filter.lifecycle));
  }

  async create(input: ThreadCreate): Promise<StoreMutationResult<Thread>> {
    assertSafeSharedState(input, "ThreadCreate");
    const now = this.store.now();
    const record: Thread = {
      schemaVersion: 1,
      threadId: input.threadId ? parseThreadId(input.threadId) : `thread/${randomUUID()}`,
      revision: 1,
      durability: "durable",
      lifecycle: "open",
      projectId: parseProjectId(input.projectId),
      bindingId: parseBindingId(input.bindingId),
      bindingRevision: input.bindingRevision,
      profileId: parseAgentProfileId(input.profileId),
      profileRevision: input.profileRevision,
      title: input.title,
      references: [],
      createdAt: now,
      createdBy: input.actor,
      updatedAt: now,
      updatedBy: input.actor,
    };
    validateThread(record);
    return this.store.create(record);
  }

  appendReference(
    threadId: ThreadId,
    expectedRevision: number,
    input: ThreadReferenceCreate,
    actor: string,
  ): Promise<StoreMutationResult<Thread>> {
    assertSafeSharedState({ input, actor }, "ThreadReferenceCreate");
    parseThreadId(threadId);
    return this.store.update(threadId, expectedRevision, (current, now) => {
      if (current.lifecycle !== "open") throw new DomainConflictError("Only an open Thread accepts new references", { threadId, lifecycle: current.lifecycle });
      return validateThread({
        ...current,
        revision: current.revision + 1,
        references: [...current.references, {
          ordinal: current.references.length + 1,
          kind: input.kind,
          referenceId: input.referenceId,
          recordedAt: input.recordedAt ?? now,
          ...(input.contentHash ? { contentHash: input.contentHash } : {}),
          citations: [...(input.citations ?? [])],
        }],
        previousRevision: { revision: current.revision, digest: canonicalDigest(current) },
        updatedAt: now,
        updatedBy: actor,
      });
    });
  }

  transition(
    threadId: ThreadId,
    expectedRevision: number,
    lifecycle: ThreadLifecycle,
    actor: string,
  ): Promise<StoreMutationResult<Thread>> {
    parseThreadId(threadId);
    return this.store.update(threadId, expectedRevision, (current, now) => {
      if (!threadTransitionAllowed(current.lifecycle, lifecycle)) {
        throw new DomainConflictError(`Invalid Thread lifecycle transition ${current.lifecycle} -> ${lifecycle}`, { threadId });
      }
      return validateThread({
        ...current,
        lifecycle,
        revision: current.revision + 1,
        previousRevision: { revision: current.revision, digest: canonicalDigest(current) },
        updatedAt: now,
        updatedBy: actor,
      });
    });
  }
}

export function threadTransitionAllowed(from: ThreadLifecycle, to: ThreadLifecycle): boolean {
  if (from === to) return false;
  if (from === "open") return to === "closed" || to === "archived";
  if (from === "closed") return to === "open" || to === "archived";
  return false;
}

function profileSlug(profileId: AgentProfileId): string {
  return profileId.slice("agent/".length);
}

function threadSlug(threadId: ThreadId): string {
  return threadId.slice("thread/".length);
}

async function latestRevisionFiles(collectionRoot: string): Promise<string[]> {
  const results: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (basename(directory) === "revisions") {
      const revisions = entries
        .filter((entry) => entry.isFile() && /^\d{12}\.json$/.test(entry.name))
        .map((entry) => entry.name)
        .sort();
      const latest = revisions.at(-1);
      if (latest) results.push(join(directory, latest));
      return;
    }
    for (const entry of entries.filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
      await visit(join(directory, entry.name));
    }
  };
  await visit(collectionRoot);
  return results.sort((left, right) => left.localeCompare(right));
}

async function atomicCreate(path: string, content: string): Promise<void> {
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
    if (await exists(path)) throw new DomainConflictError("Immutable target already exists");
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
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
    // Windows does not consistently support fsync on directory handles.
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
