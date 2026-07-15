import { createHash } from 'node:crypto';

import { assertSafeUsageString } from './redaction.js';

export const USAGE_EVENT_SCHEMA = 'llmwiki.usage-event' as const;
export const USAGE_EVENT_SCHEMA_VERSION = 1 as const;

export type UnknownReason = 'not-reported' | 'not-applicable' | 'unavailable' | 'unattributed';

export type UsageFact<T> =
  | { state: 'known'; value: T }
  | { state: 'unknown'; reason: UnknownReason };

export type UsageEventKind = 'model' | 'dreamtime' | 'consult' | 'delegation' | 'connector';

export type UsageDimensionName =
  | 'project'
  | 'agent'
  | 'thread'
  | 'workRun'
  | 'provider'
  | 'model'
  | 'device'
  | 'operation';

export type UsageDimensions = Record<UsageDimensionName, UsageFact<string>>;

export interface UsageProviderFacts {
  inputTokens: UsageFact<number>;
  outputTokens: UsageFact<number>;
  providerReportedCost: UsageFact<number>;
  currency: UsageFact<string>;
}

export interface UsageEventV1 {
  schema: typeof USAGE_EVENT_SCHEMA;
  schemaVersion: typeof USAGE_EVENT_SCHEMA_VERSION;
  eventId: string;
  idempotencyKey: string;
  kind: UsageEventKind;
  occurredAt: string;
  dimensions: UsageDimensions;
  providerFacts: UsageProviderFacts;
  provenance: string[];
}

export type UsageEvent = UsageEventV1;
export type UsageEventInput = Omit<UsageEventV1, 'schema' | 'schemaVersion' | 'eventId'>;

const EVENT_KINDS = new Set<UsageEventKind>(['model', 'dreamtime', 'consult', 'delegation', 'connector']);
const UNKNOWN_REASONS = new Set<UnknownReason>(['not-reported', 'not-applicable', 'unavailable', 'unattributed']);
export const USAGE_DIMENSION_NAMES: readonly UsageDimensionName[] = [
  'project',
  'agent',
  'thread',
  'workRun',
  'provider',
  'model',
  'device',
  'operation',
];
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:/-]{0,159}$/;
const IDEMPOTENCY_KEY = /^[a-z][a-z0-9.-]*:[A-Za-z0-9][A-Za-z0-9._:@/-]{0,190}$/;
const PROVENANCE_REF = /^(?:provider-call|work-run|invocation|connector-call|dreamtime-run|agent-turn|source-event):[A-Za-z0-9][A-Za-z0-9._:@/-]{0,190}$/;
const CURRENCY = /^[A-Z]{3}$/;

export class UsageValidationError extends Error {
  readonly code: string;
  readonly fieldPath: string;

  constructor(code: string, fieldPath: string, message: string) {
    super(`${message} at ${fieldPath}`);
    this.name = 'UsageValidationError';
    this.code = code;
    this.fieldPath = fieldPath;
  }
}

export function known<T>(value: T): UsageFact<T> {
  return { state: 'known', value };
}

export function unknown(reason: UnknownReason): UsageFact<never> {
  return { state: 'unknown', reason };
}

export function usageEventId(idempotencyKey: string): string {
  return `usage/${createHash('sha256').update(idempotencyKey).digest('hex')}`;
}

function assertRecord(value: unknown, fieldPath: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UsageValidationError('INVALID_OBJECT', fieldPath, 'Expected an object');
  }
}

function assertClosed(record: Record<string, unknown>, allowed: readonly string[], fieldPath: string): void {
  const expected = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) {
      throw new UsageValidationError('UNKNOWN_FIELD', `${fieldPath}.${key}`, 'Usage contracts are closed');
    }
  }
  for (const key of allowed) {
    if (!(key in record)) {
      throw new UsageValidationError('MISSING_FIELD', `${fieldPath}.${key}`, 'Required field is missing');
    }
  }
}

function assertIdentifier(value: unknown, fieldPath: string): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new UsageValidationError('INVALID_IDENTIFIER', fieldPath, 'Expected a canonical identifier');
  }
  assertSafeUsageString(value, fieldPath);
}

function parseFact<T>(
  value: unknown,
  fieldPath: string,
  parseKnown: (knownValue: unknown, valuePath: string) => T,
): UsageFact<T> {
  assertRecord(value, fieldPath);
  if (value.state === 'known') {
    assertClosed(value, ['state', 'value'], fieldPath);
    return { state: 'known', value: parseKnown(value.value, `${fieldPath}.value`) };
  }
  if (value.state === 'unknown') {
    assertClosed(value, ['state', 'reason'], fieldPath);
    if (typeof value.reason !== 'string' || !UNKNOWN_REASONS.has(value.reason as UnknownReason)) {
      throw new UsageValidationError('INVALID_UNKNOWN_REASON', `${fieldPath}.reason`, 'Unknown facts require a supported reason');
    }
    return { state: 'unknown', reason: value.reason as UnknownReason };
  }
  throw new UsageValidationError('INVALID_FACT_STATE', `${fieldPath}.state`, 'Fact state must be known or unknown');
}

function parseTokenCount(value: unknown, fieldPath: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new UsageValidationError('INVALID_TOKEN_COUNT', fieldPath, 'Token count must be a non-negative safe integer');
  }
  return value;
}

function parseCost(value: unknown, fieldPath: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new UsageValidationError('INVALID_PROVIDER_COST', fieldPath, 'Provider-reported cost must be finite and non-negative');
  }
  return value;
}

function parseCurrency(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string' || !CURRENCY.test(value)) {
    throw new UsageValidationError('INVALID_CURRENCY', fieldPath, 'Currency must be a three-letter uppercase code');
  }
  return value;
}

function parseTimestamp(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new UsageValidationError('INVALID_TIMESTAMP', fieldPath, 'Timestamp must be canonical UTC RFC3339');
  }
  return value;
}

export function validateUsageEvent(value: unknown): UsageEvent {
  assertRecord(value, '$');
  assertClosed(value, [
    'schema',
    'schemaVersion',
    'eventId',
    'idempotencyKey',
    'kind',
    'occurredAt',
    'dimensions',
    'providerFacts',
    'provenance',
  ], '$');

  if (value.schema !== USAGE_EVENT_SCHEMA) {
    throw new UsageValidationError('UNSUPPORTED_SCHEMA', '$.schema', 'Unsupported Usage Event schema');
  }
  if (value.schemaVersion !== USAGE_EVENT_SCHEMA_VERSION) {
    throw new UsageValidationError('UNSUPPORTED_SCHEMA_VERSION', '$.schemaVersion', 'Unsupported Usage Event schema version');
  }
  if (typeof value.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(value.idempotencyKey)) {
    throw new UsageValidationError('INVALID_IDEMPOTENCY_KEY', '$.idempotencyKey', 'Idempotency key must be a stable logical reference');
  }
  assertSafeUsageString(value.idempotencyKey, '$.idempotencyKey');
  const expectedEventId = usageEventId(value.idempotencyKey);
  if (value.eventId !== expectedEventId) {
    throw new UsageValidationError('EVENT_ID_MISMATCH', '$.eventId', 'Event ID must be derived from the idempotency key');
  }
  if (typeof value.kind !== 'string' || !EVENT_KINDS.has(value.kind as UsageEventKind)) {
    throw new UsageValidationError('INVALID_EVENT_KIND', '$.kind', 'Unsupported Usage Event kind');
  }

  assertRecord(value.dimensions, '$.dimensions');
  const rawDimensions = value.dimensions;
  assertClosed(rawDimensions, USAGE_DIMENSION_NAMES, '$.dimensions');
  const dimensions = Object.fromEntries(USAGE_DIMENSION_NAMES.map(name => [
    name,
    parseFact(rawDimensions[name], `$.dimensions.${name}`, (item, itemPath) => {
      assertIdentifier(item, itemPath);
      return item;
    }),
  ])) as UsageDimensions;

  assertRecord(value.providerFacts, '$.providerFacts');
  assertClosed(value.providerFacts, ['inputTokens', 'outputTokens', 'providerReportedCost', 'currency'], '$.providerFacts');
  const providerFacts: UsageProviderFacts = {
    inputTokens: parseFact(value.providerFacts.inputTokens, '$.providerFacts.inputTokens', parseTokenCount),
    outputTokens: parseFact(value.providerFacts.outputTokens, '$.providerFacts.outputTokens', parseTokenCount),
    providerReportedCost: parseFact(value.providerFacts.providerReportedCost, '$.providerFacts.providerReportedCost', parseCost),
    currency: parseFact(value.providerFacts.currency, '$.providerFacts.currency', parseCurrency),
  };
  if (providerFacts.providerReportedCost.state === 'known' && providerFacts.currency.state !== 'known') {
    throw new UsageValidationError('COST_CURRENCY_REQUIRED', '$.providerFacts.currency', 'Known provider cost requires known currency');
  }

  if (!Array.isArray(value.provenance) || value.provenance.length === 0) {
    throw new UsageValidationError('INVALID_PROVENANCE', '$.provenance', 'At least one provenance reference is required');
  }
  const provenance = value.provenance.map((item, index) => {
    const fieldPath = `$.provenance[${index}]`;
    if (typeof item !== 'string' || !PROVENANCE_REF.test(item)) {
      throw new UsageValidationError('INVALID_PROVENANCE', fieldPath, 'Provenance must be a supported logical reference');
    }
    assertSafeUsageString(item, fieldPath);
    return item;
  });

  return {
    schema: USAGE_EVENT_SCHEMA,
    schemaVersion: USAGE_EVENT_SCHEMA_VERSION,
    eventId: expectedEventId,
    idempotencyKey: value.idempotencyKey,
    kind: value.kind as UsageEventKind,
    occurredAt: parseTimestamp(value.occurredAt, '$.occurredAt'),
    dimensions,
    providerFacts,
    provenance,
  };
}

export function createUsageEvent(input: UsageEventInput): UsageEvent {
  return validateUsageEvent({
    schema: USAGE_EVENT_SCHEMA,
    schemaVersion: USAGE_EVENT_SCHEMA_VERSION,
    eventId: usageEventId(input.idempotencyKey),
    ...input,
  });
}
