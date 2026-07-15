import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';

import type { Operation, OperationContext } from '../core/types.js';
import {
  createUsageEvent,
  createUsagePolicy,
  known,
  makeUsageOps,
  unknown,
  type UsageDimensions,
  type UsageEvent,
  type UsageProviderFacts,
} from './index.js';

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-usage-ops-'));
  roots.push(root);
  mkdirSync(join(root, 'Projects'), { recursive: true });
  for (const slug of ['alpha', 'beta']) {
    writeFileSync(
      join(root, 'Projects', `${slug}.md`),
      ['---', `entity: project/${slug}`, 'type: project', 'status: active', '---', '', `# ${slug}`, ''].join('\n'),
      'utf8',
    );
  }
  return root;
}

function context(root: string): OperationContext {
  return {
    vault: { execute: async () => null },
    adapters: null,
    config: { vault_path: root },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: false,
  };
}

function operations(root: string): Map<string, Operation> {
  return new Map(makeUsageOps(root).map(operation => [operation.name, operation]));
}

function dimensions(project = 'project/alpha', overrides: Partial<UsageDimensions> = {}): UsageDimensions {
  return {
    project: known(project),
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

function event(
  suffix: string,
  project = 'project/alpha',
  overrides: Partial<Omit<UsageEvent, 'schema' | 'schemaVersion' | 'eventId' | 'idempotencyKey'>> = {},
): UsageEvent {
  return createUsageEvent({
    idempotencyKey: `provider-call:${suffix}`,
    kind: 'model',
    occurredAt: '2026-07-15T01:00:00.000Z',
    dimensions: dimensions(project),
    providerFacts: providerFacts(),
    provenance: [`provider-call:${suffix}`],
    ...overrides,
  });
}

describe('Usage Operation registration seam', () => {
  test('exposes exactly append, project, and policy evaluation with correct mutation metadata', () => {
    const root = fixture();
    const list = makeUsageOps(root);
    assert.deepEqual(list.map(operation => operation.name), [
      'usage.append',
      'usage.project',
      'usage.policy.evaluate',
    ]);
    assert.ok(list.every(operation => operation.namespace === 'usage'));
    assert.equal(list[0]!.mutating, true);
    assert.equal(list[1]!.mutating, false);
    assert.equal(list[2]!.mutating, false);
  });
});

describe('usage.append Operation', () => {
  test('resolves Project Context, declares the exact write target, and replays idempotently', async () => {
    const root = fixture();
    const ctx = context(root);
    const append = operations(root).get('usage.append')!;
    const usage = event('operation-replay');
    const params = { project: 'alpha', event: usage };
    assert.ok(append.mutating);
    const targets = append.mutating ? append.writePolicy.targets(ctx, params) : [];
    assert.equal(targets.length, 1);
    assert.match(targets[0]!, /^_llmwiki\/usage\/v1\/events\/[a-f0-9]{2}\/[a-f0-9]{64}\.json$/);

    const created = await append.handler(ctx, params) as {
      projectId: string;
      status: string;
      storageKey: string;
    };
    const replayed = await append.handler(ctx, { project: 'project/alpha', event: usage }) as { status: string };
    assert.equal(created.projectId, 'project/alpha');
    assert.equal(created.status, 'created');
    assert.equal(replayed.status, 'replayed');
    assert.equal(JSON.stringify(created).includes(root), false);
    assert.equal(existsSync(join(root, ...targets[0]!.split('/'))), true);
  });

  test('maps same-key different-payload to conflict and leaves canonical bytes unchanged', async () => {
    const root = fixture();
    const ctx = context(root);
    const append = operations(root).get('usage.append')!;
    const original = event('operation-conflict');
    const result = await append.handler(ctx, { project: 'project/alpha', event: original }) as { storageKey: string };
    const target = join(root, '_llmwiki', 'usage', 'v1', ...result.storageKey.split('/'));
    const before = readFileSync(target, 'utf8');
    const changed = event('operation-conflict', 'project/alpha', {
      providerFacts: providerFacts({ providerReportedCost: known(5) }),
    });
    await assert.rejects(
      () => append.handler(ctx, { project: 'project/alpha', event: changed }),
      { code: -32010 },
    );
    assert.equal(readFileSync(target, 'utf8'), before);
  });

  test('fails closed on unknown, mismatched, unregistered, malformed, and privacy-unsafe ownership', async () => {
    const root = fixture();
    const ctx = context(root);
    const append = operations(root).get('usage.append')!;
    const unknownProject = event('unknown-project', 'project/alpha', {
      dimensions: dimensions('project/alpha', { project: unknown('unattributed') }),
    });
    await assert.rejects(() => append.handler(ctx, { project: 'project/alpha', event: unknownProject }), { code: -32602 });
    await assert.rejects(() => append.handler(ctx, {
      project: 'project/beta',
      event: event('mismatched-project'),
    }), { code: -32010 });
    await assert.rejects(() => append.handler(ctx, {
      project: 'project/missing',
      event: event('missing-project', 'project/missing'),
    }), { code: -32004 });
    await assert.rejects(() => append.handler(ctx, { project: 'project/alpha', event: [] }), { code: -32602 });
    await assert.rejects(() => append.handler(ctx, {
      project: 'project/alpha',
      event: event('extra-param'),
      responseBody: 'must not be accepted',
    }), { code: -32602 });

    const safe = event('unsafe-event');
    const secret = 'sk-private-123456789';
    let message = '';
    try {
      await append.handler(ctx, { project: 'project/alpha', event: { ...safe, prompt: secret } });
    } catch (error) {
      message = (error as Error).message;
      assert.equal((error as { code: number }).code, -32602);
    }
    assert.equal(message.includes(secret), false);
    assert.equal(existsSync(join(root, '_llmwiki', 'usage')), false);
  });
});

describe('usage.project Operation', () => {
  test('projects only the resolved Project with deterministic groups, windows, and explicit unknowns', async () => {
    const root = fixture();
    const ctx = context(root);
    const ops = operations(root);
    const append = ops.get('usage.append')!;
    await append.handler(ctx, { project: 'project/alpha', event: event('project-alpha') });
    await append.handler(ctx, {
      project: 'project/alpha',
      event: event('project-local', 'project/alpha', {
        occurredAt: '2026-07-15T02:00:00.000Z',
        dimensions: dimensions('project/alpha', {
          provider: known('provider/local'),
          device: unknown('unattributed'),
        }),
        providerFacts: providerFacts({
          inputTokens: unknown('not-reported'),
          outputTokens: unknown('not-reported'),
          providerReportedCost: unknown('not-applicable'),
          currency: unknown('not-applicable'),
        }),
      }),
    });
    await append.handler(ctx, { project: 'project/beta', event: event('project-beta', 'project/beta') });

    const project = ops.get('usage.project')!;
    const result = await project.handler(ctx, {
      project: 'alpha',
      groupBy: ['provider', 'device'],
      from: '2026-07-15T00:00:00.000Z',
      to: '2026-07-16T00:00:00.000Z',
    }) as { projectId: string; projection: { sourceEventCount: number; groups: Array<any>; query: any } };
    assert.equal(result.projectId, 'project/alpha');
    assert.equal(result.projection.sourceEventCount, 2);
    assert.equal(result.projection.query.filters.project, 'project/alpha');
    assert.equal(result.projection.groups.some(group => group.metrics.inputTokens.unknownCount === 1), true);
    assert.equal(JSON.stringify(result).includes('project/beta'), false);

    const replay = await project.handler(ctx, {
      project: 'project/alpha',
      groupBy: ['device', 'provider'],
      from: '2026-07-15T00:00:00.000Z',
      to: '2026-07-16T00:00:00.000Z',
    });
    assert.deepEqual(replay, result);
  });

  test('rejects Project filter drift, invalid dimensions, and invalid time windows', async () => {
    const root = fixture();
    const ctx = context(root);
    const project = operations(root).get('usage.project')!;
    await assert.rejects(() => project.handler(ctx, {
      project: 'project/alpha',
      filters: { project: 'project/beta' },
    }), { code: -32010 });
    await assert.rejects(() => project.handler(ctx, {
      project: 'project/alpha',
      groupBy: ['secret-dimension'],
    }), { code: -32602 });
    await assert.rejects(() => project.handler(ctx, {
      project: 'project/alpha',
      from: '2026-07-16T00:00:00.000Z',
      to: '2026-07-15T00:00:00.000Z',
    }), { code: -32602 });
  });
});

describe('usage.policy.evaluate Operation', () => {
  test('evaluates an exact Project-scoped versioned policy without changing event bytes', async () => {
    const root = fixture();
    const ctx = context(root);
    const ops = operations(root);
    const appended = await ops.get('usage.append')!.handler(ctx, {
      project: 'project/alpha',
      event: event('policy-operation'),
    }) as { storageKey: string };
    const target = join(root, '_llmwiki', 'usage', 'v1', ...appended.storageKey.split('/'));
    const before = readFileSync(target, 'utf8');
    const policy = createUsagePolicy({
      policyId: 'usage-policy/project-alpha',
      policyVersion: 7,
      scopeFilters: { project: 'project/alpha' },
      rules: [{
        ruleId: 'quota/events',
        metric: 'eventCount',
        warnAt: 1,
        denyAt: 2,
        unknownAction: 'deny',
      }],
    });
    const evaluate = ops.get('usage.policy.evaluate')!;
    const result = await evaluate.handler(ctx, {
      project: 'alpha',
      policy,
      from: '2026-07-15T00:00:00.000Z',
      to: '2026-07-16T00:00:00.000Z',
    }) as { projectId: string; decision: { decision: string; policyVersion: number }; projection: { sourceEventCount: number } };
    assert.equal(result.projectId, 'project/alpha');
    assert.equal(result.projection.sourceEventCount, 1);
    assert.equal(result.decision.decision, 'warn');
    assert.equal(result.decision.policyVersion, 7);
    assert.equal(readFileSync(target, 'utf8'), before);
  });

  test('fails closed for missing or mismatched Project policy scope and corrupted ledger bytes', async () => {
    const root = fixture();
    const ctx = context(root);
    const ops = operations(root);
    const evaluate = ops.get('usage.policy.evaluate')!;
    const policy = (scopeFilters: Record<string, string>) => createUsagePolicy({
      policyId: 'usage-policy/project-scope',
      policyVersion: 1,
      scopeFilters,
      rules: [{ ruleId: 'quota/events', metric: 'eventCount', denyAt: 2, unknownAction: 'deny' }],
    });
    await assert.rejects(() => evaluate.handler(ctx, {
      project: 'project/alpha',
      policy: policy({}),
    }), { code: -32010 });
    await assert.rejects(() => evaluate.handler(ctx, {
      project: 'project/alpha',
      policy: policy({ project: 'project/beta' }),
    }), { code: -32010 });

    const appended = await ops.get('usage.append')!.handler(ctx, {
      project: 'project/alpha',
      event: event('corrupt-operation'),
    }) as { storageKey: string };
    const target = join(root, '_llmwiki', 'usage', 'v1', ...appended.storageKey.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, '{"corrupted":true}\n', 'utf8');
    let failure: unknown;
    try {
      await evaluate.handler(ctx, {
        project: 'project/alpha',
        policy: policy({ project: 'project/alpha' }),
      });
    } catch (error) {
      failure = error;
    }
    assert.equal((failure as { code: number }).code, -32603);
    assert.equal(JSON.stringify(failure).includes(root), false);
  });
});
