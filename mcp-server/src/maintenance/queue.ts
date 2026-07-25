import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export const MAINTENANCE_QUEUE_SCHEMA_VERSION = 1 as const;

export type MaintenanceEntryState = 'pending' | 'leased' | 'retry' | 'quarantined' | 'completed';

export interface MaintenanceLease {
  owner: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface MaintenanceQueueEntry {
  schemaVersion: typeof MAINTENANCE_QUEUE_SCHEMA_VERSION;
  entryId: string;
  sourceIds: string[];
  topicKeys: string[];
  dirtyReasons: string[];
  earliestRunAt: string;
  freshnessDeadline: string;
  attempts: number;
  state: MaintenanceEntryState;
  receiptIds: string[];
  lease?: MaintenanceLease;
  updatedAt: string;
  lastDiagnosticCode?: string;
}

export interface MaintenanceReceipt {
  schemaVersion: typeof MAINTENANCE_QUEUE_SCHEMA_VERSION;
  receiptId: string;
  entryId: string;
  status: 'succeeded' | 'retry' | 'quarantined' | 'skipped-budget';
  startedAt: string;
  completedAt: string;
  diagnosticCode?: string;
}

interface QueueState {
  schemaVersion: typeof MAINTENANCE_QUEUE_SCHEMA_VERSION;
  revision: number;
  updatedAt: string;
  entries: Record<string, MaintenanceQueueEntry>;
  receipts: Record<string, MaintenanceReceipt>;
}

export interface EnqueueMaintenanceInput {
  sourceIds?: readonly string[];
  topicKeys: readonly string[];
  dirtyReasons: readonly string[];
  now?: Date;
  debounceMs?: number;
  maximumLagMs?: number;
}

export interface MaintenancePlan {
  schemaVersion: typeof MAINTENANCE_QUEUE_SCHEMA_VERSION;
  reportOnly: boolean;
  plannedAt: string;
  eligible: MaintenanceQueueEntry[];
  deferred: MaintenanceQueueEntry[];
  quarantined: MaintenanceQueueEntry[];
  nextWakeAt?: string;
}

export interface RefreshPolicy {
  debounceMs: number;
  maximumLagMs: number;
}

export interface DrainOptions {
  owner: string;
  now?: () => Date;
  leaseMs?: number;
  maxTopics?: number;
  timeBudgetMs?: number;
  maxAttempts?: number;
  retryBackoffMs?: number;
  accept?: (entry: MaintenanceQueueEntry) => boolean;
}

export interface DrainResult {
  processed: string[];
  retried: string[];
  quarantined: string[];
  deferredByBudget: string[];
  receipts: MaintenanceReceipt[];
}

export type MaintenanceWorker = (entry: MaintenanceQueueEntry) => Promise<void>;

const DEFAULT_DEBOUNCE_MS = 30_000;
const DEFAULT_MAXIMUM_LAG_MS = 5 * 60_000;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const LOCK_STALE_MS = 60_000;

export class DurableMaintenanceQueue {
  readonly #statePath: string;

  constructor(vaultPath: string, relativePath = '_llmwiki/maintenance/queue.v1.json') {
    this.#statePath = join(vaultPath, ...relativePath.split('/'));
  }

  enqueue(input: EnqueueMaintenanceInput): MaintenanceQueueEntry[] {
    const now = input.now ?? new Date();
    const debounceMs = nonNegative(input.debounceMs, DEFAULT_DEBOUNCE_MS);
    const maximumLagMs = positive(input.maximumLagMs, DEFAULT_MAXIMUM_LAG_MS);
    const topics = normalized(input.topicKeys);
    const reasons = normalized(input.dirtyReasons);
    if (topics.length === 0) throw new Error('Maintenance enqueue requires at least one topic key');
    if (reasons.length === 0) throw new Error('Maintenance enqueue requires at least one dirty reason');
    const sourceIds = normalized(input.sourceIds ?? []);

    return this.#mutate((state) => topics.map((topicKey) => {
      const entryId = entryIdForTopic(topicKey);
      const existing = state.entries[entryId];
      const newEarliest = now.getTime() + debounceMs;
      const newDeadline = now.getTime() + maximumLagMs;
      const preservedDeadline = existing
        ? Math.min(Date.parse(existing.freshnessDeadline), newDeadline)
        : newDeadline;
      // Trailing-edge debounce may move the earliest run later, but never past
      // the first freshness deadline established for the coalesced burst.
      const coalescedEarliest = existing
        ? Math.min(Math.max(Date.parse(existing.earliestRunAt), newEarliest), preservedDeadline)
        : Math.min(newEarliest, preservedDeadline);
      const entry: MaintenanceQueueEntry = {
        schemaVersion: MAINTENANCE_QUEUE_SCHEMA_VERSION,
        entryId,
        sourceIds: normalized([...(existing?.sourceIds ?? []), ...sourceIds]),
        topicKeys: normalized([...(existing?.topicKeys ?? []), topicKey]),
        dirtyReasons: normalized([...(existing?.dirtyReasons ?? []), ...reasons]),
        earliestRunAt: new Date(coalescedEarliest).toISOString(),
        freshnessDeadline: new Date(preservedDeadline).toISOString(),
        attempts: existing?.attempts ?? 0,
        state: existing?.state === 'leased' ? 'leased' : 'pending',
        receiptIds: existing?.receiptIds ?? [],
        ...(existing?.lease ? { lease: existing.lease } : {}),
        updatedAt: now.toISOString(),
      };
      state.entries[entryId] = entry;
      return clone(entry);
    }));
  }

  inspect(entryId?: string): MaintenanceQueueEntry[] {
    const entries = Object.values(this.#read().entries)
      .filter((entry) => entryId ? entry.entryId === entryId : true)
      .sort(compareEntries);
    return clone(entries);
  }

  receipts(): MaintenanceReceipt[] {
    return clone(Object.values(this.#read().receipts).sort((a, b) => a.startedAt.localeCompare(b.startedAt)));
  }

  plan(options: {
    now?: Date;
    reportOnly?: boolean;
    maxTopics?: number;
    accept?: (entry: MaintenanceQueueEntry) => boolean;
  } = {}): MaintenancePlan {
    const now = options.now ?? new Date();
    const recovered = this.#recoverExpired(now);
    const entries = Object.values(recovered.entries).sort(compareEntries);
    const accepted = (entry: MaintenanceQueueEntry) => options.accept?.(clone(entry)) ?? true;
    const eligible = entries.filter((entry) => isEligible(entry, now) && accepted(entry)).slice(0, positive(options.maxTopics, Number.MAX_SAFE_INTEGER));
    const eligibleIds = new Set(eligible.map((entry) => entry.entryId));
    const deferred = entries.filter((entry) =>
      !eligibleIds.has(entry.entryId)
      && entry.state !== 'completed'
      && entry.state !== 'quarantined'
      && entry.state !== 'leased'
      && accepted(entry));
    const nextWake = deferred
      .flatMap((entry) => [Date.parse(entry.earliestRunAt), Date.parse(entry.freshnessDeadline)])
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0];
    return {
      schemaVersion: MAINTENANCE_QUEUE_SCHEMA_VERSION,
      reportOnly: options.reportOnly ?? true,
      plannedAt: now.toISOString(),
      eligible: clone(eligible),
      deferred: clone(deferred),
      quarantined: clone(entries.filter((entry) => entry.state === 'quarantined')),
      ...(nextWake === undefined ? {} : { nextWakeAt: new Date(nextWake).toISOString() }),
    };
  }

  leaseEligible(owner: string, options: {
    now?: Date;
    leaseMs?: number;
    maxTopics?: number;
    accept?: (entry: MaintenanceQueueEntry) => boolean;
  } = {}): MaintenanceQueueEntry[] {
    if (!owner.trim()) throw new Error('Maintenance lease owner required');
    const now = options.now ?? new Date();
    const leaseMs = positive(options.leaseMs, DEFAULT_LEASE_MS);
    const maxTopics = positive(options.maxTopics, 1);
    return this.#mutate((state) => {
      recoverExpiredInState(state, now);
      const candidates = Object.values(state.entries)
        .filter((entry) => isEligible(entry, now) && (options.accept?.(clone(entry)) ?? true))
        .sort(compareEntries)
        .slice(0, maxTopics);
      for (const entry of candidates) {
        entry.state = 'leased';
        entry.lease = {
          owner,
          acquiredAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        };
        entry.updatedAt = now.toISOString();
      }
      return clone(candidates);
    });
  }

  complete(entryId: string, owner: string, startedAt: Date, completedAt = new Date()): MaintenanceReceipt {
    return this.#finish(entryId, owner, startedAt, completedAt, 'succeeded');
  }

  fail(
    entryId: string,
    owner: string,
    startedAt: Date,
    diagnosticCode: string,
    options: { now?: Date; transient?: boolean; maxAttempts?: number; retryBackoffMs?: number } = {},
  ): MaintenanceReceipt {
    const now = options.now ?? new Date();
    const transient = options.transient ?? true;
    const maxAttempts = positive(options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
    const retryBackoffMs = nonNegative(options.retryBackoffMs, 30_000);
    return this.#mutate((state) => {
      const entry = requireLeasedBy(state, entryId, owner);
      entry.attempts += 1;
      const retry = transient && entry.attempts < maxAttempts;
      entry.state = retry ? 'retry' : 'quarantined';
      entry.earliestRunAt = retry
        ? new Date(now.getTime() + retryBackoffMs * Math.max(1, 2 ** (entry.attempts - 1))).toISOString()
        : entry.earliestRunAt;
      entry.lastDiagnosticCode = safeCode(diagnosticCode);
      delete entry.lease;
      entry.updatedAt = now.toISOString();
      const receipt = makeReceipt(entry, retry ? 'retry' : 'quarantined', startedAt, now, entry.lastDiagnosticCode);
      entry.receiptIds.push(receipt.receiptId);
      state.receipts[receipt.receiptId] = receipt;
      return clone(receipt);
    });
  }

  async drain(worker: MaintenanceWorker, options: DrainOptions): Promise<DrainResult> {
    const clock = options.now ?? (() => new Date());
    const started = clock();
    const maxTopics = positive(options.maxTopics, 16);
    const timeBudgetMs = positive(options.timeBudgetMs, 30_000);
    const leased = this.leaseEligible(options.owner, {
      now: started,
      leaseMs: options.leaseMs,
      maxTopics,
      accept: options.accept,
    });
    const result: DrainResult = { processed: [], retried: [], quarantined: [], deferredByBudget: [], receipts: [] };

    for (let index = 0; index < leased.length; index += 1) {
      const entry = leased[index]!;
      if (clock().getTime() - started.getTime() >= timeBudgetMs) {
        const remaining = leased.slice(index);
        this.#releaseLeases(remaining.map((item) => item.entryId), options.owner, clock());
        result.deferredByBudget.push(...remaining.map((item) => item.entryId));
        break;
      }
      const itemStarted = clock();
      try {
        await worker(clone(entry));
        const receipt = this.complete(entry.entryId, options.owner, itemStarted, clock());
        result.processed.push(entry.entryId);
        result.receipts.push(receipt);
      } catch (error) {
        const failure = classifyFailure(error);
        const receipt = this.fail(entry.entryId, options.owner, itemStarted, failure.code, {
          now: clock(),
          transient: failure.transient,
          maxAttempts: options.maxAttempts,
          retryBackoffMs: options.retryBackoffMs,
        });
        result[receipt.status === 'retry' ? 'retried' : 'quarantined'].push(entry.entryId);
        result.receipts.push(receipt);
      }
    }
    return result;
  }

  #finish(entryId: string, owner: string, startedAt: Date, completedAt: Date, status: 'succeeded'): MaintenanceReceipt {
    return this.#mutate((state) => {
      const entry = requireLeasedBy(state, entryId, owner);
      entry.state = 'completed';
      delete entry.lease;
      entry.updatedAt = completedAt.toISOString();
      const receipt = makeReceipt(entry, status, startedAt, completedAt);
      entry.receiptIds.push(receipt.receiptId);
      state.receipts[receipt.receiptId] = receipt;
      return clone(receipt);
    });
  }

  #releaseLeases(entryIds: string[], owner: string, now: Date): void {
    this.#mutate((state) => {
      for (const entryId of entryIds) {
        const entry = state.entries[entryId];
        if (!entry || entry.state !== 'leased' || entry.lease?.owner !== owner) continue;
        entry.state = 'pending';
        delete entry.lease;
        entry.updatedAt = now.toISOString();
      }
    });
  }

  #recoverExpired(now: Date): QueueState {
    let recovered = false;
    const current = this.#read();
    for (const entry of Object.values(current.entries)) {
      if (entry.state === 'leased' && Date.parse(entry.lease?.expiresAt ?? '') <= now.getTime()) {
        recovered = true;
        break;
      }
    }
    if (!recovered) return current;
    return this.#mutate((state) => {
      recoverExpiredInState(state, now);
      return clone(state);
    });
  }

  #mutate<T>(mutator: (state: QueueState) => T): T {
    return withLock(this.#statePath, () => {
      const state = this.#read();
      const result = mutator(state);
      state.revision += 1;
      state.updatedAt = new Date().toISOString();
      atomicJson(this.#statePath, state);
      return result;
    });
  }

  #read(): QueueState {
    if (!existsSync(this.#statePath)) return emptyState();
    return readCompatibleQueueState(JSON.parse(readFileSync(this.#statePath, 'utf8')) as unknown);
  }
}

/** Additive compatibility reader; the next mutation persists canonical v1. */
export function readCompatibleQueueState(raw: unknown): QueueState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Unsupported or corrupt maintenance queue state');
  }
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion === MAINTENANCE_QUEUE_SCHEMA_VERSION
    && value.entries && typeof value.entries === 'object' && !Array.isArray(value.entries)
    && value.receipts && typeof value.receipts === 'object' && !Array.isArray(value.receipts)) {
    return value as unknown as QueueState;
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== 0) {
    throw new Error('Unsupported or corrupt maintenance queue state');
  }
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString();
  const legacyEntries = Array.isArray(value.entries)
    ? value.entries
    : value.entries && typeof value.entries === 'object'
      ? Object.values(value.entries as Record<string, unknown>)
      : [];
  const entries: Record<string, MaintenanceQueueEntry> = {};
  for (const rawEntry of legacyEntries) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;
    const entry = rawEntry as Record<string, unknown>;
    const topicKeys = legacyStrings(Array.isArray(entry.topicKeys) ? entry.topicKeys : [entry.topicKey]);
    if (topicKeys.length === 0) continue;
    const entryId = typeof entry.entryId === 'string' ? entry.entryId : entryIdForTopic(topicKeys[0]);
    const state = isEntryState(entry.state) ? entry.state : 'pending';
    entries[entryId] = {
      schemaVersion: MAINTENANCE_QUEUE_SCHEMA_VERSION,
      entryId,
      sourceIds: legacyStrings(Array.isArray(entry.sourceIds) ? entry.sourceIds : [entry.sourceId]),
      topicKeys,
      dirtyReasons: legacyStrings(Array.isArray(entry.dirtyReasons) ? entry.dirtyReasons : [entry.reason ?? 'legacy-dirty']),
      earliestRunAt: isoValue(entry.earliestRunAt ?? entry.dueAt, updatedAt),
      freshnessDeadline: isoValue(entry.freshnessDeadline ?? entry.deadline, updatedAt),
      attempts: nonNegative(typeof entry.attempts === 'number' ? entry.attempts : undefined, 0),
      state,
      receiptIds: legacyStrings(Array.isArray(entry.receiptIds) ? entry.receiptIds : []),
      updatedAt: isoValue(entry.updatedAt, updatedAt),
      ...(entry.lease && typeof entry.lease === 'object' ? { lease: entry.lease as MaintenanceLease } : {}),
      ...(typeof entry.lastDiagnosticCode === 'string' ? { lastDiagnosticCode: entry.lastDiagnosticCode } : {}),
    };
  }
  return {
    schemaVersion: MAINTENANCE_QUEUE_SCHEMA_VERSION,
    revision: nonNegative(typeof value.revision === 'number' ? value.revision : undefined, 0),
    updatedAt,
    entries,
    receipts: {},
  };
}

export function resolveRefreshPolicy(
  sourceId: string,
  policies: Readonly<Record<string, Partial<RefreshPolicy>>>,
  fallback: RefreshPolicy = { debounceMs: DEFAULT_DEBOUNCE_MS, maximumLagMs: DEFAULT_MAXIMUM_LAG_MS },
): RefreshPolicy {
  const configured = policies[sourceId] ?? policies['*'] ?? {};
  return {
    debounceMs: nonNegative(configured.debounceMs, fallback.debounceMs),
    maximumLagMs: positive(configured.maximumLagMs, fallback.maximumLagMs),
  };
}

function emptyState(): QueueState {
  return {
    schemaVersion: MAINTENANCE_QUEUE_SCHEMA_VERSION,
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    entries: {},
    receipts: {},
  };
}

function isEligible(entry: MaintenanceQueueEntry, now: Date): boolean {
  if (entry.state !== 'pending' && entry.state !== 'retry') return false;
  return Date.parse(entry.earliestRunAt) <= now.getTime() || Date.parse(entry.freshnessDeadline) <= now.getTime();
}

function isEntryState(value: unknown): value is MaintenanceEntryState {
  return value === 'pending' || value === 'leased' || value === 'retry' || value === 'quarantined' || value === 'completed';
}

function legacyStrings(values: readonly unknown[]): string[] {
  return normalized(values.filter((value): value is string => typeof value === 'string'));
}

function isoValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : fallback;
}

function recoverExpiredInState(state: QueueState, now: Date): void {
  for (const entry of Object.values(state.entries)) {
    if (entry.state !== 'leased' || Date.parse(entry.lease?.expiresAt ?? '') > now.getTime()) continue;
    entry.state = 'retry';
    entry.lastDiagnosticCode = 'LEASE_EXPIRED';
    delete entry.lease;
    entry.updatedAt = now.toISOString();
  }
}

function requireLeasedBy(state: QueueState, entryId: string, owner: string): MaintenanceQueueEntry {
  const entry = state.entries[entryId];
  if (!entry) throw new Error(`Maintenance entry not found: ${entryId}`);
  if (entry.state !== 'leased' || entry.lease?.owner !== owner) {
    throw new Error(`Maintenance entry ${entryId} is not leased by ${owner}`);
  }
  return entry;
}

function makeReceipt(
  entry: MaintenanceQueueEntry,
  status: MaintenanceReceipt['status'],
  startedAt: Date,
  completedAt: Date,
  diagnosticCode?: string,
): MaintenanceReceipt {
  const seed = `${entry.entryId}\0${entry.attempts}\0${status}\0${startedAt.toISOString()}`;
  return {
    schemaVersion: MAINTENANCE_QUEUE_SCHEMA_VERSION,
    receiptId: `maintenance_receipt_${createHash('sha256').update(seed).digest('hex').slice(0, 20)}`,
    entryId: entry.entryId,
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    ...(diagnosticCode ? { diagnosticCode } : {}),
  };
}

function entryIdForTopic(topicKey: string): string {
  return `maintenance_${createHash('sha256').update(topicKey).digest('hex').slice(0, 20)}`;
}

function compareEntries(left: MaintenanceQueueEntry, right: MaintenanceQueueEntry): number {
  return left.freshnessDeadline.localeCompare(right.freshnessDeadline)
    || left.earliestRunAt.localeCompare(right.earliestRunAt)
    || left.entryId.localeCompare(right.entryId);
}

function normalized(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegative(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function safeCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 80) || 'MAINTENANCE_FAILED';
}

function classifyFailure(error: unknown): { code: string; transient: boolean } {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { code?: unknown; transient?: unknown };
    if (typeof candidate.code === 'string') {
      return { code: safeCode(candidate.code), transient: candidate.transient !== false };
    }
  }
  return { code: 'MAINTENANCE_FAILED', transient: true };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function withLock<T>(path: string, work: () => T): T {
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  try {
    try {
      writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const age = existsSync(lock) ? Date.now() - statSync(lock).mtimeMs : LOCK_STALE_MS + 1;
      if (age <= LOCK_STALE_MS) throw new Error('Maintenance queue is locked');
      rmSync(lock, { force: true });
      writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
    }
    return work();
  } finally {
    rmSync(lock, { force: true });
  }
}
