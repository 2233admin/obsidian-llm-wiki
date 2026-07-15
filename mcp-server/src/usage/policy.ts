import { canonicalJson, sha256 } from './canonical.js';
import {
  USAGE_DIMENSION_NAMES,
  type UsageDimensionName,
} from './contracts.js';
import {
  type UsageDimensionFilter,
  type UsageProjection,
} from './projections.js';
import { assertSafeUsageString } from './redaction.js';

export const USAGE_POLICY_SCHEMA = 'llmwiki.usage-policy' as const;
export const USAGE_POLICY_SCHEMA_VERSION = 1 as const;

export type UsageDecision = 'allow' | 'warn' | 'deny';
export type UsagePolicyMetric = 'eventCount' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'providerReportedCost';

export interface UsagePolicyRule {
  ruleId: string;
  metric: UsagePolicyMetric;
  currency?: string;
  warnAt?: number;
  denyAt?: number;
  unknownAction: UsageDecision;
}

export interface UsagePolicyV1 {
  schema: typeof USAGE_POLICY_SCHEMA;
  schemaVersion: typeof USAGE_POLICY_SCHEMA_VERSION;
  policyId: string;
  policyVersion: number;
  scopeFilters: Partial<Record<UsageDimensionName, UsageDimensionFilter>>;
  rules: UsagePolicyRule[];
}

export type UsagePolicyInput = Omit<UsagePolicyV1, 'schema' | 'schemaVersion'>;

export interface UsageRuleDecision {
  ruleId: string;
  metric: UsagePolicyMetric;
  currency?: string;
  decision: UsageDecision;
  knownValue: number;
  unknownCount: number;
  reasons: Array<'within-limit' | 'warning-limit-reached' | 'deny-limit-reached' | 'unknown-facts'>;
}

export interface UsagePolicyDecision {
  schema: 'llmwiki.usage-policy-decision';
  schemaVersion: 1;
  decisionId: string;
  decision: UsageDecision;
  policyId: string;
  policyVersion: number;
  projectionRevision: string;
  sourceEventCount: number;
  window: { from: string | null; to: string | null };
  rules: UsageRuleDecision[];
}

const POLICY_METRICS = new Set<UsagePolicyMetric>([
  'eventCount',
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'providerReportedCost',
]);
const DECISIONS = new Set<UsageDecision>(['allow', 'warn', 'deny']);
const POLICY_ID = /^[A-Za-z][A-Za-z0-9._:/-]{0,159}$/;
const CURRENCY = /^[A-Z]{3}$/;

function record(value: unknown, fieldPath: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldPath} must be an object`);
}

function closed(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[], fieldPath: string): void {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${fieldPath}.${key} is not part of the versioned Usage Policy contract`);
  }
  for (const key of required) {
    if (!(key in value)) throw new TypeError(`${fieldPath}.${key} is required`);
  }
}

function threshold(value: unknown, fieldPath: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${fieldPath} must be finite and non-negative`);
  }
  return value;
}

export function validateUsagePolicy(value: unknown): UsagePolicyV1 {
  record(value, '$');
  closed(value, [
    'schema',
    'schemaVersion',
    'policyId',
    'policyVersion',
    'scopeFilters',
    'rules',
  ], [
    'schema',
    'schemaVersion',
    'policyId',
    'policyVersion',
    'scopeFilters',
    'rules',
  ], '$');
  if (value.schema !== USAGE_POLICY_SCHEMA || value.schemaVersion !== USAGE_POLICY_SCHEMA_VERSION) {
    throw new TypeError('Unsupported Usage Policy schema version');
  }
  if (typeof value.policyId !== 'string' || !POLICY_ID.test(value.policyId)) throw new TypeError('$.policyId must be canonical');
  assertSafeUsageString(value.policyId, '$.policyId');
  if (!Number.isSafeInteger(value.policyVersion) || (value.policyVersion as number) < 1) {
    throw new TypeError('$.policyVersion must be a positive safe integer');
  }
  record(value.scopeFilters, '$.scopeFilters');
  closed(value.scopeFilters, USAGE_DIMENSION_NAMES, [], '$.scopeFilters');
  const scopeFilters: Partial<Record<UsageDimensionName, UsageDimensionFilter>> = {};
  for (const name of USAGE_DIMENSION_NAMES) {
    const filter = value.scopeFilters[name];
    if (filter === undefined) continue;
    if (filter !== null) {
      if (typeof filter !== 'string' || filter.length === 0) throw new TypeError(`$.scopeFilters.${name} must be an identifier or null`);
      assertSafeUsageString(filter, `$.scopeFilters.${name}`);
    }
    scopeFilters[name] = filter;
  }
  if (!Array.isArray(value.rules) || value.rules.length === 0) throw new TypeError('$.rules must contain at least one rule');
  const ruleIds = new Set<string>();
  const rules = value.rules.map((item, index): UsagePolicyRule => {
    const fieldPath = `$.rules[${index}]`;
    record(item, fieldPath);
    closed(item, ['ruleId', 'metric', 'currency', 'warnAt', 'denyAt', 'unknownAction'], ['ruleId', 'metric', 'unknownAction'], fieldPath);
    if (typeof item.ruleId !== 'string' || !POLICY_ID.test(item.ruleId)) throw new TypeError(`${fieldPath}.ruleId must be canonical`);
    assertSafeUsageString(item.ruleId, `${fieldPath}.ruleId`);
    if (ruleIds.has(item.ruleId)) throw new TypeError(`Duplicate Usage Policy rule: ${item.ruleId}`);
    ruleIds.add(item.ruleId);
    if (typeof item.metric !== 'string' || !POLICY_METRICS.has(item.metric as UsagePolicyMetric)) {
      throw new TypeError(`${fieldPath}.metric is unsupported`);
    }
    if (typeof item.unknownAction !== 'string' || !DECISIONS.has(item.unknownAction as UsageDecision)) {
      throw new TypeError(`${fieldPath}.unknownAction must be allow, warn, or deny`);
    }
    const metric = item.metric as UsagePolicyMetric;
    let currency: string | undefined;
    if (metric === 'providerReportedCost') {
      if (typeof item.currency !== 'string' || !CURRENCY.test(item.currency)) {
        throw new TypeError(`${fieldPath}.currency is required for providerReportedCost`);
      }
      currency = item.currency;
    } else if (item.currency !== undefined) {
      throw new TypeError(`${fieldPath}.currency is only valid for providerReportedCost`);
    }
    const warnAt = threshold(item.warnAt, `${fieldPath}.warnAt`);
    const denyAt = threshold(item.denyAt, `${fieldPath}.denyAt`);
    if (warnAt === undefined && denyAt === undefined && item.unknownAction === 'allow') {
      throw new TypeError(`${fieldPath} has no enforceable limit`);
    }
    if (warnAt !== undefined && denyAt !== undefined && warnAt > denyAt) {
      throw new TypeError(`${fieldPath}.warnAt must not exceed denyAt`);
    }
    return {
      ruleId: item.ruleId,
      metric,
      ...(currency === undefined ? {} : { currency }),
      ...(warnAt === undefined ? {} : { warnAt }),
      ...(denyAt === undefined ? {} : { denyAt }),
      unknownAction: item.unknownAction as UsageDecision,
    };
  });
  return {
    schema: USAGE_POLICY_SCHEMA,
    schemaVersion: USAGE_POLICY_SCHEMA_VERSION,
    policyId: value.policyId,
    policyVersion: value.policyVersion as number,
    scopeFilters,
    rules,
  };
}
export function createUsagePolicy(input: UsagePolicyInput): UsagePolicyV1 {
  return validateUsagePolicy({
    schema: USAGE_POLICY_SCHEMA,
    schemaVersion: USAGE_POLICY_SCHEMA_VERSION,
    ...input,
  });
}

function severity(value: UsageDecision): number {
  return value === 'deny' ? 2 : value === 'warn' ? 1 : 0;
}

function metricValue(projection: UsageProjection, rule: UsagePolicyRule): { knownValue: number; unknownCount: number } {
  if (rule.metric === 'eventCount') return { knownValue: projection.sourceEventCount, unknownCount: 0 };
  if (rule.metric === 'providerReportedCost') {
    let knownValue = 0;
    let unknownCount = 0;
    for (const group of projection.groups) {
      knownValue += group.metrics.providerReportedCost.totals
        .filter(total => total.currency === rule.currency)
        .reduce((sum, total) => sum + total.knownTotal, 0);
      unknownCount += group.metrics.providerReportedCost.unknownAmountCount;
    }
    return { knownValue, unknownCount };
  }
  let knownValue = 0;
  let unknownCount = 0;
  for (const group of projection.groups) {
    const metric = group.metrics[rule.metric];
    knownValue += metric.knownTotal;
    unknownCount += metric.unknownCount;
  }
  return { knownValue, unknownCount };
}

function sameScope(
  expected: Partial<Record<UsageDimensionName, UsageDimensionFilter>>,
  actual: Partial<Record<UsageDimensionName, UsageDimensionFilter>>,
): boolean {
  return canonicalJson(expected) === canonicalJson(actual);
}

export function evaluateUsagePolicy(policyValue: unknown, projection: UsageProjection): UsagePolicyDecision {
  const policy = validateUsagePolicy(policyValue);
  if (projection.schema !== 'llmwiki.usage-projection' || projection.schemaVersion !== 1) {
    throw new TypeError('Unsupported Usage Projection schema version');
  }
  if (!sameScope(policy.scopeFilters, projection.query.filters)) {
    throw new TypeError('Usage Policy scope must exactly match the projection filters');
  }
  const rules = policy.rules.map((rule): UsageRuleDecision => {
    const { knownValue, unknownCount } = metricValue(projection, rule);
    let decision: UsageDecision = 'allow';
    const reasons: UsageRuleDecision['reasons'] = [];
    if (rule.denyAt !== undefined && knownValue >= rule.denyAt) {
      decision = 'deny';
      reasons.push('deny-limit-reached');
    } else if (rule.warnAt !== undefined && knownValue >= rule.warnAt) {
      decision = 'warn';
      reasons.push('warning-limit-reached');
    } else {
      reasons.push('within-limit');
    }
    if (unknownCount > 0) {
      reasons.push('unknown-facts');
      if (severity(rule.unknownAction) > severity(decision)) decision = rule.unknownAction;
    }
    return {
      ruleId: rule.ruleId,
      metric: rule.metric,
      ...(rule.currency === undefined ? {} : { currency: rule.currency }),
      decision,
      knownValue,
      unknownCount,
      reasons,
    };
  });
  const decision = rules.reduce<UsageDecision>((current, rule) => (
    severity(rule.decision) > severity(current) ? rule.decision : current
  ), 'allow');
  const decisionId = `usage-decision/${sha256(canonicalJson({
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    projectionRevision: projection.revision,
    rules,
  }))}`;
  return {
    schema: 'llmwiki.usage-policy-decision',
    schemaVersion: 1,
    decisionId,
    decision,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    projectionRevision: projection.revision,
    sourceEventCount: projection.sourceEventCount,
    window: projection.query.window,
    rules,
  };
}
