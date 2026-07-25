import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { DurableMaintenanceQueue, resolveRefreshPolicy } from './queue.js';

describe('DurableMaintenanceQueue', () => {
  test('ages below any batch threshold and becomes eligible by maximum freshness deadline', () => withQueue((queue) => {
    const now = date(0);
    queue.enqueue({
      topicKeys: ['topic/alpha'],
      dirtyReasons: ['source-edited'],
      now,
      debounceMs: 60_000,
      maximumLagMs: 10_000,
    });
    assert.equal(queue.plan({ now: date(9_999) }).eligible.length, 0);
    assert.deepEqual(queue.plan({ now: date(10_000) }).eligible.map((entry) => entry.topicKeys[0]), ['topic/alpha']);
  }));

  test('coalesces bursts while preserving the earliest maximum-freshness deadline', () => withQueue((queue) => {
    const first = queue.enqueue({
      sourceIds: ['source/a'],
      topicKeys: ['topic/alpha'],
      dirtyReasons: ['source-edited'],
      now: date(0),
      debounceMs: 5_000,
      maximumLagMs: 20_000,
    })[0]!;
    const second = queue.enqueue({
      sourceIds: ['source/b'],
      topicKeys: ['topic/alpha'],
      dirtyReasons: ['source-revised'],
      now: date(4_000),
      debounceMs: 5_000,
      maximumLagMs: 20_000,
    })[0]!;
    assert.equal(second.entryId, first.entryId);
    assert.equal(second.freshnessDeadline, date(20_000).toISOString());
    assert.equal(second.earliestRunAt, date(9_000).toISOString());
    assert.deepEqual(second.sourceIds, ['source/a', 'source/b']);
    assert.deepEqual(second.dirtyReasons, ['source-edited', 'source-revised']);
  }));

  test('recovers an expired lease from persisted state after process restart', () => withQueue((queue, vault) => {
    queue.enqueue({ topicKeys: ['topic/alpha'], dirtyReasons: ['edit'], now: date(0), debounceMs: 0 });
    const leased = queue.leaseEligible('worker/one', { now: date(1), leaseMs: 100, maxTopics: 1 });
    assert.equal(leased[0]?.state, 'leased');

    const restarted = new DurableMaintenanceQueue(vault);
    const plan = restarted.plan({ now: date(102) });
    assert.equal(plan.eligible[0]?.state, 'retry');
    assert.equal(plan.eligible[0]?.lastDiagnosticCode, 'LEASE_EXPIRED');
    assert.equal(plan.eligible[0]?.lease, undefined);
  }));

  test('drains multiple topics and continues unrelated work after a transient failure', async () => withQueue(async (queue) => {
    queue.enqueue({ topicKeys: ['topic/a', 'topic/b', 'topic/c'], dirtyReasons: ['edit'], now: date(0), debounceMs: 0 });
    const seen: string[] = [];
    const result = await queue.drain(async (entry) => {
      const topic = entry.topicKeys[0]!;
      seen.push(topic);
      if (topic === 'topic/b') throw Object.assign(new Error('temporary'), { code: 'PROVIDER_TIMEOUT', transient: true });
    }, {
      owner: 'worker/one',
      now: fixedClock(date(1)),
      maxTopics: 3,
      retryBackoffMs: 10,
    });
    assert.deepEqual(seen.sort(), ['topic/a', 'topic/b', 'topic/c']);
    assert.equal(result.processed.length, 2);
    assert.equal(result.retried.length, 1);
    assert.equal(result.quarantined.length, 0);
  }));

  test('releases unprocessed leases when the drain time budget is exhausted', async () => withQueue(async (queue) => {
    queue.enqueue({ topicKeys: ['topic/a', 'topic/b'], dirtyReasons: ['edit'], now: date(0), debounceMs: 0 });
    const instants = [date(1), date(1), date(1), date(50), date(50)];
    const clock = () => instants.shift() ?? date(50);
    const result = await queue.drain(async () => undefined, {
      owner: 'worker/budget',
      now: clock,
      maxTopics: 2,
      timeBudgetMs: 10,
    });
    assert.equal(result.processed.length, 1);
    assert.equal(result.deferredByBudget.length, 1);
    const deferred = queue.inspect(result.deferredByBudget[0])[0]!;
    assert.equal(deferred.state, 'pending');
    assert.equal(deferred.lease, undefined);
  }));

  test('retries transient errors with backoff and quarantines at the attempt limit', async () => withQueue(async (queue) => {
    queue.enqueue({ topicKeys: ['topic/a'], dirtyReasons: ['edit'], now: date(0), debounceMs: 0 });
    const worker = async () => { throw Object.assign(new Error('temporary'), { code: 'PROVIDER_TIMEOUT' }); };
    const first = await queue.drain(worker, {
      owner: 'worker/retry',
      now: fixedClock(date(1)),
      maxAttempts: 2,
      retryBackoffMs: 10,
    });
    assert.equal(first.retried.length, 1);
    const retry = queue.inspect()[0]!;
    assert.equal(retry.attempts, 1);

    const second = await queue.drain(worker, {
      owner: 'worker/retry',
      now: fixedClock(date(12)),
      maxAttempts: 2,
      retryBackoffMs: 10,
    });
    assert.equal(second.quarantined.length, 1);
    assert.equal(queue.inspect()[0]?.state, 'quarantined');
    assert.deepEqual(queue.receipts().map((receipt) => receipt.status), ['retry', 'quarantined']);
  }));

  test('uses the same persisted planner for report-only and runtime eligibility', () => withQueue((queue, vault) => {
    queue.enqueue({ topicKeys: ['topic/a'], dirtyReasons: ['edit'], now: date(0), debounceMs: 100 });
    const report = queue.plan({ now: date(100), reportOnly: true });
    const runtime = new DurableMaintenanceQueue(vault).leaseEligible('worker/runtime', { now: date(100) });
    assert.deepEqual(report.eligible.map((entry) => entry.entryId), runtime.map((entry) => entry.entryId));
    assert.equal(report.reportOnly, true);
  }));

  test('resolves per-source refresh policy with wildcard and safe defaults', () => {
    assert.deepEqual(resolveRefreshPolicy('source/a', {
      'source/a': { debounceMs: 100, maximumLagMs: 1_000 },
      '*': { debounceMs: 200, maximumLagMs: 2_000 },
    }), { debounceMs: 100, maximumLagMs: 1_000 });
    assert.deepEqual(resolveRefreshPolicy('source/b', {
      '*': { debounceMs: 200, maximumLagMs: 2_000 },
    }), { debounceMs: 200, maximumLagMs: 2_000 });
  });

  test('persists canonical versioned queue records and receipts atomically', async () => withQueue(async (queue, vault) => {
    queue.enqueue({ topicKeys: ['topic/a'], dirtyReasons: ['edit'], now: date(0), debounceMs: 0 });
    await queue.drain(async () => undefined, { owner: 'worker/one', now: fixedClock(date(1)) });
    const state = JSON.parse(readFileSync(join(vault, '_llmwiki', 'maintenance', 'queue.v1.json'), 'utf8')) as {
      schemaVersion: number;
      revision: number;
      entries: Record<string, { receiptIds: string[] }>;
      receipts: Record<string, unknown>;
    };
    assert.equal(state.schemaVersion, 1);
    assert.ok(state.revision >= 3);
    assert.equal(Object.values(state.entries)[0]?.receiptIds.length, 1);
    assert.equal(Object.keys(state.receipts).length, 1);
  }));

  test('reads a legacy additive queue and writes canonical v1 on the next mutation', () => withQueue((queue, vault) => {
    const path = join(vault, '_llmwiki', 'maintenance', 'queue.v1.json');
    mkdirSync(join(vault, '_llmwiki', 'maintenance'), { recursive: true });
    writeFileSync(path, JSON.stringify({
      revision: 2,
      updatedAt: date(0).toISOString(),
      entries: [{
        topicKey: 'topic/legacy',
        sourceId: 'source/legacy',
        reason: 'legacy-dirty',
        dueAt: date(0).toISOString(),
        deadline: date(10_000).toISOString(),
      }],
    }), 'utf8');
    assert.equal(queue.plan({ now: date(1) }).eligible[0]?.topicKeys[0], 'topic/legacy');
    queue.enqueue({ topicKeys: ['topic/new'], dirtyReasons: ['new'], now: date(1), debounceMs: 0 });
    const canonical = JSON.parse(readFileSync(path, 'utf8')) as { schemaVersion: number; entries: Record<string, unknown> };
    assert.equal(canonical.schemaVersion, 1);
    assert.equal(Object.keys(canonical.entries).length, 2);
  }));
});

function date(offsetMs: number): Date {
  return new Date(Date.UTC(2026, 6, 23, 0, 0, 0, offsetMs));
}

function fixedClock(value: Date): () => Date {
  return () => new Date(value);
}

function withQueue<T>(run: (queue: DurableMaintenanceQueue, vault: string) => T): T {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-maintenance-'));
  try {
    const result = run(new DurableMaintenanceQueue(vault), vault);
    if (result instanceof Promise) {
      return result.finally(() => rmSync(vault, { recursive: true, force: true })) as T;
    }
    rmSync(vault, { recursive: true, force: true });
    return result;
  } catch (error) {
    rmSync(vault, { recursive: true, force: true });
    throw error;
  }
}
