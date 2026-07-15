import { canonicalJson, sha256 } from './canonical.js';
import {
  USAGE_DIMENSION_NAMES,
  validateUsageEvent,
  type UsageDimensionName,
  type UsageEvent,
  type UsageFact,
} from './contracts.js';
import { assertSafeUsageString } from './redaction.js';

export const USAGE_PROJECTION_SCHEMA = 'llmwiki.usage-projection' as const;
export const USAGE_PROJECTION_SCHEMA_VERSION = 1 as const;

export type UsageDimensionFilter = string | null;

export interface UsageProjectionQuery {
  groupBy?: UsageDimensionName[];
  filters?: Partial<Record<UsageDimensionName, UsageDimensionFilter>>;
  from?: string;
  to?: string;
}

export interface NormalizedUsageProjectionQuery {
  groupBy: UsageDimensionName[];
  filters: Partial<Record<UsageDimensionName, UsageDimensionFilter>>;
  window: { from: string | null; to: string | null };
}

export interface UsageMetricProjection {
  knownTotal: number;
  knownEventCount: number;
  unknownCount: number;
}

export interface UsageCostTotal {
  currency: string;
  knownTotal: number;
  knownEventCount: number;
}

export interface UsageCostProjection {
  totals: UsageCostTotal[];
  unknownAmountCount: number;
  unknownCurrencyCount: number;
}

export interface UsageProjectionGroup {
  groupKey: string;
  dimensions: Partial<Record<UsageDimensionName, UsageDimensionFilter>>;
  sourceEventCount: number;
  sourceEventIds: string[];
  unknownDimensions: Record<UsageDimensionName, number>;
  metrics: {
    inputTokens: UsageMetricProjection;
    outputTokens: UsageMetricProjection;
    totalTokens: UsageMetricProjection;
    providerReportedCost: UsageCostProjection;
  };
  revision: string;
  lastUpdatedAt: string | null;
}

export interface UsageProjection {
  schema: typeof USAGE_PROJECTION_SCHEMA;
  schemaVersion: typeof USAGE_PROJECTION_SCHEMA_VERSION;
  query: NormalizedUsageProjectionQuery;
  sourceEventCount: number;
  revision: string;
  lastUpdatedAt: string | null;
  groups: UsageProjectionGroup[];
}

function timestamp(value: string | undefined, fieldPath: string): string | null {
  if (value === undefined) return null;
  if (Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError(`${fieldPath} must be canonical UTC RFC3339`);
  }
  return value;
}

function normalizeQuery(query: UsageProjectionQuery): NormalizedUsageProjectionQuery {
  const requested = new Set(query.groupBy ?? []);
  for (const dimension of requested) {
    if (!USAGE_DIMENSION_NAMES.includes(dimension)) throw new TypeError(`Unknown usage dimension: ${dimension}`);
  }
  const groupBy = USAGE_DIMENSION_NAMES.filter(name => requested.has(name));
  const filters: Partial<Record<UsageDimensionName, UsageDimensionFilter>> = {};
  for (const name of USAGE_DIMENSION_NAMES) {
    const value = query.filters?.[name];
    if (value === undefined) continue;
    if (value !== null) {
      if (typeof value !== 'string' || value.length === 0) throw new TypeError(`Usage filter ${name} must be an identifier or null`);
      assertSafeUsageString(value, `$.filters.${name}`);
    }
    filters[name] = value;
  }
  const from = timestamp(query.from, '$.from');
  const to = timestamp(query.to, '$.to');
  if (from !== null && to !== null && from >= to) throw new TypeError('Usage projection window must have from < to');
  return { groupBy, filters, window: { from, to } };
}

function dimensionValue(fact: UsageFact<string>): UsageDimensionFilter {
  return fact.state === 'known' ? fact.value : null;
}

function matches(event: UsageEvent, query: NormalizedUsageProjectionQuery): boolean {
  if (query.window.from !== null && event.occurredAt < query.window.from) return false;
  if (query.window.to !== null && event.occurredAt >= query.window.to) return false;
  return USAGE_DIMENSION_NAMES.every(name => {
    const expected = query.filters[name];
    return expected === undefined || dimensionValue(event.dimensions[name]) === expected;
  });
}

function emptyMetric(): UsageMetricProjection {
  return { knownTotal: 0, knownEventCount: 0, unknownCount: 0 };
}

function aggregateMetric(events: UsageEvent[], select: (event: UsageEvent) => UsageFact<number>): UsageMetricProjection {
  const metric = emptyMetric();
  for (const event of events) {
    const fact = select(event);
    if (fact.state === 'known') {
      metric.knownTotal += fact.value;
      metric.knownEventCount += 1;
    } else {
      metric.unknownCount += 1;
    }
  }
  return metric;
}

function aggregateTotalTokens(events: UsageEvent[]): UsageMetricProjection {
  const metric = emptyMetric();
  for (const event of events) {
    const { inputTokens, outputTokens } = event.providerFacts;
    if (inputTokens.state === 'known' && outputTokens.state === 'known') {
      metric.knownTotal += inputTokens.value + outputTokens.value;
      metric.knownEventCount += 1;
    } else {
      metric.unknownCount += 1;
    }
  }
  return metric;
}

function aggregateCost(events: UsageEvent[]): UsageCostProjection {
  const totals = new Map<string, { knownTotal: number; knownEventCount: number }>();
  let unknownAmountCount = 0;
  let unknownCurrencyCount = 0;
  for (const event of events) {
    const { providerReportedCost, currency } = event.providerFacts;
    if (providerReportedCost.state === 'unknown') {
      unknownAmountCount += 1;
      if (currency.state === 'unknown') unknownCurrencyCount += 1;
      continue;
    }
    if (currency.state === 'unknown') {
      unknownCurrencyCount += 1;
      continue;
    }
    const total = totals.get(currency.value) ?? { knownTotal: 0, knownEventCount: 0 };
    total.knownTotal += providerReportedCost.value;
    total.knownEventCount += 1;
    totals.set(currency.value, total);
  }
  return {
    totals: [...totals.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, total]) => ({ currency, ...total })),
    unknownAmountCount,
    unknownCurrencyCount,
  };
}

function latest(events: UsageEvent[]): string | null {
  return events.reduce<string | null>((current, event) => (
    current === null || event.occurredAt > current ? event.occurredAt : current
  ), null);
}

function buildGroup(
  events: UsageEvent[],
  dimensions: Partial<Record<UsageDimensionName, UsageDimensionFilter>>,
  query: NormalizedUsageProjectionQuery,
): UsageProjectionGroup {
  const unknownDimensions = Object.fromEntries(
    USAGE_DIMENSION_NAMES.map(name => [name, events.filter(event => event.dimensions[name].state === 'unknown').length]),
  ) as Record<UsageDimensionName, number>;
  const groupKey = canonicalJson(dimensions);
  return {
    groupKey,
    dimensions,
    sourceEventCount: events.length,
    sourceEventIds: events.map(event => event.eventId),
    unknownDimensions,
    metrics: {
      inputTokens: aggregateMetric(events, event => event.providerFacts.inputTokens),
      outputTokens: aggregateMetric(events, event => event.providerFacts.outputTokens),
      totalTokens: aggregateTotalTokens(events),
      providerReportedCost: aggregateCost(events),
    },
    revision: sha256(canonicalJson({
      schemaVersion: USAGE_PROJECTION_SCHEMA_VERSION,
      query,
      dimensions,
      events,
    })),
    lastUpdatedAt: latest(events),
  };
}

export function projectUsage(values: readonly unknown[], requestedQuery: UsageProjectionQuery = {}): UsageProjection {
  const query = normalizeQuery(requestedQuery);
  const events = values.map(validateUsageEvent)
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId));
  const identities = new Set<string>();
  for (const event of events) {
    if (identities.has(event.eventId)) throw new TypeError(`Duplicate Usage Event identity: ${event.eventId}`);
    identities.add(event.eventId);
  }
  const filtered = events.filter(event => matches(event, query));
  const buckets = new Map<string, { dimensions: Partial<Record<UsageDimensionName, UsageDimensionFilter>>; events: UsageEvent[] }>();
  for (const event of filtered) {
    const dimensions = Object.fromEntries(query.groupBy.map(name => [name, dimensionValue(event.dimensions[name])])) as Partial<Record<UsageDimensionName, UsageDimensionFilter>>;
    const key = canonicalJson(dimensions);
    const bucket = buckets.get(key) ?? { dimensions, events: [] };
    bucket.events.push(event);
    buckets.set(key, bucket);
  }
  if (filtered.length === 0 && query.groupBy.length === 0) {
    buckets.set('{}', { dimensions: {}, events: [] });
  }
  const groups = [...buckets.values()]
    .map(bucket => buildGroup(bucket.events, bucket.dimensions, query))
    .sort((left, right) => left.groupKey.localeCompare(right.groupKey));
  return {
    schema: USAGE_PROJECTION_SCHEMA,
    schemaVersion: USAGE_PROJECTION_SCHEMA_VERSION,
    query,
    sourceEventCount: filtered.length,
    revision: sha256(canonicalJson({
      schemaVersion: USAGE_PROJECTION_SCHEMA_VERSION,
      query,
      events: filtered,
    })),
    lastUpdatedAt: latest(filtered),
    groups,
  };
}
