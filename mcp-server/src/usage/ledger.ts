import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { canonicalJson, sha256 } from './canonical.js';
import { usageEventId, validateUsageEvent, type UsageEvent } from './contracts.js';

export const USAGE_LEDGER_STORAGE_VERSION = 1 as const;

export interface UsageAppendResult {
  status: 'created' | 'replayed';
  event: UsageEvent;
  storageKey: string;
  contentDigest: string;
}

export class UsageEventConflictError extends Error {
  readonly code = 'USAGE_EVENT_CONFLICT' as const;
  readonly eventId: string;
  readonly storageKey: string;

  constructor(eventId: string, storageKey: string) {
    super(`Usage Event conflicts with immutable event ${eventId}`);
    this.name = 'UsageEventConflictError';
    this.eventId = eventId;
    this.storageKey = storageKey;
  }
}

export class UsageLedgerCorruptionError extends Error {
  readonly code = 'USAGE_LEDGER_CORRUPTION' as const;
  readonly storageKey: string;

  constructor(storageKey: string, message: string) {
    super(`Usage ledger corruption at ${storageKey}: ${message}`);
    this.name = 'UsageLedgerCorruptionError';
    this.storageKey = storageKey;
  }
}

function eventBytes(event: UsageEvent): string {
  return `${canonicalJson(event)}\n`;
}

function normalizeStorageKey(value: string): string {
  return value.split(sep).join('/');
}

export function usageEventStorageKey(idempotencyKey: string): string {
  const digest = usageEventId(idempotencyKey).slice('usage/'.length);
  return `events/${digest.slice(0, 2)}/${digest}.json`;
}

export class UsageLedger {
  readonly storageVersion = USAGE_LEDGER_STORAGE_VERSION;
  readonly #root: string;

  constructor(root: string) {
    if (!root) throw new TypeError('Usage ledger root is required');
    this.#root = resolve(root);
  }

  append(value: unknown): UsageAppendResult {
    const event = validateUsageEvent(value);
    const target = this.#targetForKey(event.idempotencyKey);
    const storageKey = this.#storageKey(target);
    const bytes = eventBytes(event);

    mkdirSync(dirname(target), { recursive: true });
    try {
      writeFileSync(target, bytes, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      return {
        status: 'created',
        event,
        storageKey,
        contentDigest: sha256(bytes),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    const persisted = readFileSync(target, 'utf8');
    if (persisted !== bytes) {
      throw new UsageEventConflictError(event.eventId, storageKey);
    }
    return {
      status: 'replayed',
      event,
      storageKey,
      contentDigest: sha256(bytes),
    };
  }

  get(idempotencyKey: string): UsageEvent | null {
    const expectedId = usageEventId(idempotencyKey);
    const target = this.#targetForKey(idempotencyKey);
    if (!existsSync(target)) return null;
    return this.#readStoredEvent(target, expectedId);
  }

  list(): UsageEvent[] {
    const eventsRoot = join(this.#root, 'events');
    if (!existsSync(eventsRoot)) return [];
    const targets = readdirSync(eventsRoot, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => join(entry.parentPath, entry.name))
      .sort((left, right) => left.localeCompare(right));
    return targets.map(target => {
      const digest = target.slice(target.lastIndexOf(sep) + 1, -'.json'.length);
      return this.#readStoredEvent(target, `usage/${digest}`);
    });
  }

  #targetForKey(idempotencyKey: string): string {
    return join(this.#root, ...usageEventStorageKey(idempotencyKey).split('/'));
  }

  #storageKey(target: string): string {
    const key = normalizeStorageKey(relative(this.#root, target));
    if (!key || key.startsWith('../') || key === '..') {
      throw new TypeError('Usage storage key escaped the ledger root');
    }
    return key;
  }

  #readStoredEvent(target: string, expectedEventId: string): UsageEvent {
    const storageKey = this.#storageKey(target);
    let raw: string;
    let parsed: unknown;
    try {
      raw = readFileSync(target, 'utf8');
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new UsageLedgerCorruptionError(storageKey, 'event is not readable canonical JSON');
    }
    let event: UsageEvent;
    try {
      event = validateUsageEvent(parsed);
    } catch {
      throw new UsageLedgerCorruptionError(storageKey, 'event violates the versioned contract');
    }
    if (event.eventId !== expectedEventId) {
      throw new UsageLedgerCorruptionError(storageKey, 'content address does not match the event identity');
    }
    if (eventBytes(event) !== raw) {
      throw new UsageLedgerCorruptionError(storageKey, 'event bytes are not canonical');
    }
    return event;
  }
}
