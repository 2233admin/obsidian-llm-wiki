import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';

import {
  USAGE_EVENT_SCHEMA_VERSION,
  UsageEventConflictError,
  UsageLedger,
  UsageLedgerCorruptionError,
  createUsageEvent,
  createUsagePolicy,
  evaluateUsagePolicy,
  known,
  projectUsage,
  redactUsageValue,
  unknown,
  usageEventId,
  validateUsageEvent,
  type UsageDimensions,
  type UsageEvent,
  type UsageProviderFacts,
} from './index.js';

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function tempLedger(): { root: string; ledger: UsageLedger } {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-usage-'));
  roots.push(root);
  return { root, ledger: new UsageLedger(root) };
}

function dimensions(overrides: Partial<UsageDimensions> = {}): UsageDimensions {
  return {
    project: known('project/alpha'),
    agent: known('agent/codex'),
    thread: known('thread/main'),
    workRun: known('work-run/run-1'),
    provider: known('provider/openai'),
    model: known('model/gpt-5'),
    device: known('device/workstation-a'),
    operation: known('model.invoke'),
    ...overrides,
  };
}

function providerFacts(overrides: Partial<UsageProviderFacts> = {}): UsageProviderFacts {
  return {
    inputTokens: known(100),
    outputTokens: known(20),
    providerReportedCost: known(0.25),
    currency: known('USD'),
    ...overrides,
  };
}

function usageEvent(
  suffix: string,
  overrides: Partial<Omit<UsageEvent, 'schema' | 'schemaVersion' | 'eventId' | 'idempotencyKey'>> & {
    dimensions?: UsageDimensions;
    providerFacts?: UsageProviderFacts;
  } = {},
): UsageEvent {
  return createUsageEvent({
    idempotencyKey: `provider-call:${suffix}`,
    kind: 'model',
    occurredAt: '2026-07-15T01:00:00.000Z',
    dimensions: dimensions(),
    providerFacts: providerFacts(),
    provenance: [`provider-call:${suffix}`],
    ...overrides,
  });
}

describe('versioned Usage Event contract and privacy boundary', () => {
  test('derives a stable identity and preserves explicit provider unknowns', () => {
    const event = usageEvent('unknown-facts', {
      providerFacts: providerFacts({
        outputTokens: unknown('not-reported'),
        providerReportedCost: unknown('not-reported'),
        currency: unknown('not-reported'),
      }),
      dimensions: dimensions({ device: unknown('unattributed') }),
    });

    assert.equal(event.schemaVersion, USAGE_EVENT_SCHEMA_VERSION);
    assert.equal(event.eventId, usageEventId('provider-call:unknown-facts'));
    assert.deepEqual(event.providerFacts.outputTokens, { state: 'unknown', reason: 'not-reported' });
    assert.deepEqual(event.dimensions.device, { state: 'unknown', reason: 'unattributed' });
  });

  test('rejects estimated-looking known costs without currency and closes prompt/response fields', () => {
    const base = usageEvent('closed-contract');
    assert.throws(() => validateUsageEvent({
      ...base,
      providerFacts: { ...base.providerFacts, currency: unknown('not-reported') },
    }), /Known provider cost requires known currency/);

    const secretPrompt = 'never echo this prompt or sk-private-123456789';
    let message = '';
    try {
      validateUsageEvent({ ...base, prompt: secretPrompt });
    } catch (error) {
      message = (error as Error).message;
    }
    assert.match(message, /closed/);
    assert.equal(message.includes(secretPrompt), false);
  });

  test('redacts prompt, response, secret, lease, and machine-path material recursively', () => {
    const redacted = redactUsageValue({
      prompt: 'private prompt body',
      responseBody: 'private response body',
      credentials: { apiKey: 'sk-private-123456789' },
      workspacePath: 'C:\\Users\\Administrator\\vault',
      leaseToken: 'lease-secret-value',
      safe: 'model.invoke',
    });
    assert.deepEqual(redacted, {
      prompt: '[REDACTED]',
      responseBody: '[REDACTED]',
      credentials: '[REDACTED]',
      workspacePath: '[MACHINE_PATH]',
      leaseToken: '[REDACTED]',
      safe: 'model.invoke',
    });
    assert.throws(() => usageEvent('machine-path', {
      dimensions: dimensions({ device: known('C:\\Users\\Administrator\\device') }),
    }));
    const base = usageEvent('logical-path-guard');
    assert.throws(() => validateUsageEvent({
      ...base,
      provenance: ['source-event:D:/private/vault/event.json'],
    }));
  });
});

describe('content-addressed create-once Usage ledger', () => {
  test('creates canonical bytes once and returns a byte-identical replay without an absolute path', () => {
    const { root, ledger } = tempLedger();
    const event = usageEvent('replay');
    const created = ledger.append(event);
    const target = join(root, created.storageKey);
    const before = readFileSync(target, 'utf8');
    const replayed = ledger.append(JSON.parse(JSON.stringify(event)));
    const after = readFileSync(target, 'utf8');

    assert.equal(created.status, 'created');
    assert.equal(replayed.status, 'replayed');
    assert.equal(before, after);
    assert.equal(created.contentDigest, replayed.contentDigest);
    assert.equal(created.storageKey.includes(root), false);
    assert.match(created.storageKey, /^events\/[a-f0-9]{2}\/[a-f0-9]{64}\.json$/);
    assert.deepEqual(ledger.get(event.idempotencyKey), event);
  });

  test('rejects a different payload for the same idempotency key and never rewrites history', () => {
    const { root, ledger } = tempLedger();
    const original = usageEvent('immutable');
    const created = ledger.append(original);
    const target = join(root, created.storageKey);
    const before = readFileSync(target, 'utf8');
    const conflict = usageEvent('immutable', {
      providerFacts: providerFacts({ providerReportedCost: known(9.99) }),
    });

    assert.throws(() => ledger.append(conflict), UsageEventConflictError);
    assert.equal(readFileSync(target, 'utf8'), before);
  });

  test('lists in stable content-address order and fails closed on corrupted bytes', () => {
    const { root, ledger } = tempLedger();
    const first = usageEvent('list-a');
    const second = usageEvent('list-b', { occurredAt: '2026-07-15T02:00:00.000Z' });
    ledger.append(second);
    ledger.append(first);
    const listed = ledger.list();
    assert.deepEqual(
      listed.map(event => event.eventId),
      [...listed.map(event => event.eventId)].sort(),
    );

    const corruptDigest = 'a'.repeat(64);
    const corruptTarget = join(root, 'events', 'aa', `${corruptDigest}.json`);
    mkdirSync(dirname(corruptTarget), { recursive: true });
    writeFileSync(corruptTarget, '{"not":"a usage event"}\n', 'utf8');
    assert.throws(() => ledger.list(), UsageLedgerCorruptionError);
  });

  test('uses the same storage address and bytes when one report is synchronized across devices', () => {
    const firstDevice = tempLedger();
    const secondDevice = tempLedger();
    const event = usageEvent('cross-device-sync', {
      dimensions: dimensions({ device: known('device/workstation-a') }),
    });
    const first = firstDevice.ledger.append(event);
    const second = secondDevice.ledger.append(event);

    assert.equal(second.storageKey, first.storageKey);
    assert.equal(second.contentDigest, first.contentDigest);
    assert.equal(
      readFileSync(join(secondDevice.root, second.storageKey), 'utf8'),
      readFileSync(join(firstDevice.root, first.storageKey), 'utf8'),
    );
    assert.equal(secondDevice.ledger.append(event).status, 'replayed');
  });

  test('preserves provider-reported prices at each occurrence instead of repricing history', () => {
    const { root, ledger } = tempLedger();
    const beforePriceChange = usageEvent('price-before', {
      occurredAt: '2026-07-01T00:00:00.000Z',
      providerFacts: providerFacts({ providerReportedCost: known(0.25) }),
    });
    const first = ledger.append(beforePriceChange);
    const originalBytes = readFileSync(join(root, first.storageKey), 'utf8');
    ledger.append(usageEvent('price-after', {
      occurredAt: '2026-08-01T00:00:00.000Z',
      providerFacts: providerFacts({ providerReportedCost: known(0.5) }),
    }));

    const projection = projectUsage(ledger.list());
    assert.equal(readFileSync(join(root, first.storageKey), 'utf8'), originalBytes);
    assert.deepEqual(projection.groups[0]!.metrics.providerReportedCost.totals, [
      { currency: 'USD', knownTotal: 0.75, knownEventCount: 2 },
    ]);
  });
});

describe('deterministic multi-dimensional projections', () => {
  const first = usageEvent('projection-a', {
    occurredAt: '2026-07-15T01:00:00.000Z',
  });
  const second = usageEvent('projection-b', {
    occurredAt: '2026-07-15T02:00:00.000Z',
    dimensions: dimensions({
      agent: known('agent/claude'),
      thread: known('thread/review'),
      workRun: known('work-run/run-2'),
      provider: known('provider/anthropic'),
      model: known('model/claude'),
      device: known('device/cloud-5090'),
      operation: known('agent.consult'),
    }),
    providerFacts: providerFacts({
      inputTokens: known(200),
      outputTokens: unknown('not-reported'),
      providerReportedCost: unknown('not-reported'),
      currency: unknown('not-reported'),
    }),
  });
  const third = usageEvent('projection-c', {
    occurredAt: '2026-07-15T03:00:00.000Z',
    dimensions: dimensions({
      project: known('project/beta'),
      device: unknown('unattributed'),
    }),
    providerFacts: providerFacts({
      providerReportedCost: known(1.5),
      currency: known('EUR'),
    }),
  });

  test('projects Project/Agent/Thread/WorkRun/Provider/Device/operation with stable order and revision', () => {
    for (const dimension of ['project', 'agent', 'thread', 'workRun', 'provider', 'device', 'operation'] as const) {
      const forward = projectUsage([first, second, third], { groupBy: [dimension] });
      const reverse = projectUsage([third, second, first], { groupBy: [dimension] });
      assert.deepEqual(reverse, forward, dimension);
      assert.ok(forward.groups.length >= 2, dimension);
      assert.equal(forward.sourceEventCount, 3);
    }
  });

  test('uses an inclusive/exclusive window, filters scope, and never turns unknown into zero', () => {
    const projection = projectUsage([third, first, second], {
      filters: { project: 'project/alpha' },
      from: '2026-07-15T01:00:00.000Z',
      to: '2026-07-15T03:00:00.000Z',
    });
    const group = projection.groups[0]!;
    assert.equal(projection.sourceEventCount, 2);
    assert.equal(group.metrics.inputTokens.knownTotal, 300);
    assert.equal(group.metrics.outputTokens.knownTotal, 20);
    assert.equal(group.metrics.outputTokens.unknownCount, 1);
    assert.equal(group.metrics.totalTokens.knownTotal, 120);
    assert.equal(group.metrics.totalTokens.unknownCount, 1);
    assert.deepEqual(group.metrics.providerReportedCost.totals, [
      { currency: 'USD', knownTotal: 0.25, knownEventCount: 1 },
    ]);
    assert.equal(group.metrics.providerReportedCost.unknownAmountCount, 1);
    assert.equal(projection.lastUpdatedAt, '2026-07-15T02:00:00.000Z');
    assert.match(projection.revision, /^[a-f0-9]{64}$/);
  });

  test('rejects duplicate source identities instead of double-counting them', () => {
    assert.throws(() => projectUsage([first, first]), /Duplicate Usage Event identity/);
  });

  test('keeps local-model token, price, and currency facts explicitly unknown', () => {
    const local = usageEvent('local-model', {
      dimensions: dimensions({
        provider: known('provider/local'),
        model: known('model/local-llama'),
        device: known('device/workstation-a'),
      }),
      providerFacts: providerFacts({
        inputTokens: unknown('not-reported'),
        outputTokens: unknown('not-reported'),
        providerReportedCost: unknown('not-applicable'),
        currency: unknown('not-applicable'),
      }),
    });
    const group = projectUsage([local], { filters: { provider: 'provider/local' } }).groups[0]!;
    assert.equal(group.metrics.inputTokens.knownTotal, 0);
    assert.equal(group.metrics.inputTokens.knownEventCount, 0);
    assert.equal(group.metrics.inputTokens.unknownCount, 1);
    assert.equal(group.metrics.providerReportedCost.totals.length, 0);
    assert.equal(group.metrics.providerReportedCost.unknownAmountCount, 1);
  });
});

describe('versioned budget, quota, warning, and admission policy', () => {
  test('returns deterministic allow/warn/deny decisions and records the policy version', () => {
    const events = [usageEvent('policy-a'), usageEvent('policy-b')];
    const projection = projectUsage(events, { filters: { project: 'project/alpha' } });
    const policy = (policyVersion: number, warnAt: number, denyAt: number) => createUsagePolicy({
      policyId: 'usage-policy/project-alpha',
      policyVersion,
      scopeFilters: { project: 'project/alpha' },
      rules: [{
        ruleId: 'quota/events',
        metric: 'eventCount',
        warnAt,
        denyAt,
        unknownAction: 'allow',
      }],
    });

    const allowed = evaluateUsagePolicy(policy(1, 3, 4), projection);
    const warned = evaluateUsagePolicy(policy(2, 2, 4), projection);
    const denied = evaluateUsagePolicy(policy(3, 1, 2), projection);
    assert.equal(allowed.decision, 'allow');
    assert.equal(warned.decision, 'warn');
    assert.equal(denied.decision, 'deny');
    assert.equal(denied.policyVersion, 3);
    assert.equal(evaluateUsagePolicy(policy(3, 1, 2), projection).decisionId, denied.decisionId);
  });

  test('applies unknown-fact admission behavior and currency-specific provider budgets', () => {
    const event = usageEvent('policy-unknown', {
      providerFacts: providerFacts({
        outputTokens: unknown('not-reported'),
        providerReportedCost: unknown('not-reported'),
        currency: unknown('not-reported'),
      }),
    });
    const projection = projectUsage([event], { filters: { project: 'project/alpha' } });
    const decision = evaluateUsagePolicy(createUsagePolicy({
      policyId: 'usage-policy/project-alpha',
      policyVersion: 4,
      scopeFilters: { project: 'project/alpha' },
      rules: [
        {
          ruleId: 'quota/total-tokens',
          metric: 'totalTokens',
          denyAt: 1_000,
          unknownAction: 'warn',
        },
        {
          ruleId: 'budget/provider-usd',
          metric: 'providerReportedCost',
          currency: 'USD',
          denyAt: 10,
          unknownAction: 'deny',
        },
      ],
    }), projection);
    assert.equal(decision.decision, 'deny');
    assert.equal(decision.rules[0]!.decision, 'warn');
    assert.equal(decision.rules[1]!.unknownCount, 1);
    assert.deepEqual(decision.window, { from: null, to: null });
  });

  test('policy changes consume projections without mutating immutable events and reject scope drift', () => {
    const { root, ledger } = tempLedger();
    const created = ledger.append(usageEvent('policy-history'));
    const before = readFileSync(join(root, created.storageKey), 'utf8');
    const projection = projectUsage(ledger.list(), { filters: { project: 'project/alpha' } });
    for (const policyVersion of [1, 2]) {
      evaluateUsagePolicy(createUsagePolicy({
        policyId: 'usage-policy/project-alpha',
        policyVersion,
        scopeFilters: { project: 'project/alpha' },
        rules: [{
          ruleId: 'budget/provider-usd',
          metric: 'providerReportedCost',
          currency: 'USD',
          denyAt: policyVersion,
          unknownAction: 'deny',
        }],
      }), projection);
    }
    assert.equal(readFileSync(join(root, created.storageKey), 'utf8'), before);
    assert.throws(() => evaluateUsagePolicy(createUsagePolicy({
      policyId: 'usage-policy/project-beta',
      policyVersion: 1,
      scopeFilters: { project: 'project/beta' },
      rules: [{ ruleId: 'quota/events', metric: 'eventCount', denyAt: 1, unknownAction: 'deny' }],
    }), projection), /scope/);
  });
});
