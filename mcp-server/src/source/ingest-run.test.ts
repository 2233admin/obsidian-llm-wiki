import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import type { Operation, OperationContext } from '../core/types.js';
import { makeSourceOps } from './source.js';

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe('Source Ingest Run lifecycle', () => {
  test('executes filesystem capture through durable run, derivative, Evidence, queue, inspect, and verify', async () => withVault(async (vault) => {
    writeVault(vault, 'Notes/source.md', '# Alpha\r\n\r\nEvidence.\r\n');
    writeVault(vault, 'Notes/_meta.json', '{}\n');
    const registered = await call(vault, 'source.register', {
      inputType: 'vaultPath',
      input: 'Notes/source.md',
      title: 'Alpha Source',
    });
    const plan = await call(vault, 'source.ingest.plan', { id: registered.id });
    const result = await call(vault, 'source.ingest.run', { id: registered.id, planId: plan.planId });
    const run = result.run as Record<string, unknown>;

    assert.equal(run.state, 'succeeded');
    assert.deepEqual(run.completedStages, ['capture', 'derive', 'materialize']);
    assert.equal(result.contentChanged, true);
    assert.equal((result.maintenanceEntryIds as string[]).length, 1);
    assert.ok(existsSync(vaultPath(vault, result.evidencePath as string)));
    assert.match(readFileSync(vaultPath(vault, result.evidencePath as string), 'utf8'), /source-revision: "sha256:/);

    const inspected = await call(vault, 'source.ingest.inspect', { runId: run.runId });
    assert.equal((inspected.receipts as unknown[]).length, 3);
    const verified = await call(vault, 'source.ingest.verify', { runId: run.runId });
    assert.equal(verified.verified, true);
    assert.ok(existsSync(vaultPath(vault, '_llmwiki/maintenance/queue.v1.json')));
    const queue = JSON.parse(readFileSync(vaultPath(vault, '_llmwiki/maintenance/queue.v1.json'), 'utf8')) as {
      entries: Record<string, { sourceIds: string[]; topicKeys: string[] }>;
    };
    const queued = Object.values(queue.entries)[0]!;
    assert.deepEqual(queued.topicKeys, ['Notes']);
    assert.deepEqual(queued.sourceIds, [registered.id]);
  }));

  test('deduplicates the same idempotency key without additional artifacts or queue entries', async () => withVault(async (vault) => {
    writeVault(vault, 'Notes/source.md', '# Stable\n');
    const registered = await call(vault, 'source.register', { inputType: 'vaultPath', input: 'Notes/source.md' });
    const plan = await call(vault, 'source.ingest.plan', { id: registered.id });
    const first = await call(vault, 'source.ingest.run', { id: registered.id, planId: plan.planId });
    const files = allFiles(vault);
    const second = await call(vault, 'source.ingest.run', { id: registered.id, planId: plan.planId });

    assert.equal(second.replay, true);
    assert.deepEqual(second.run, first.run);
    assert.deepEqual(allFiles(vault), files);
    const queue = JSON.parse(readFileSync(vaultPath(vault, '_llmwiki/maintenance/queue.v1.json'), 'utf8')) as {
      entries: Record<string, unknown>;
    };
    assert.equal(Object.keys(queue.entries).length, 1);
  }));

  test('does not enqueue compilation when a new raw revision normalizes to unchanged content', async () => withVault(async (vault) => {
    writeVault(vault, 'Notes/source.md', '# Same\r\n');
    const registered = await call(vault, 'source.register', { inputType: 'vaultPath', input: 'Notes/source.md' });
    const firstPlan = await call(vault, 'source.ingest.plan', { id: registered.id });
    await call(vault, 'source.ingest.run', { id: registered.id, planId: firstPlan.planId });

    writeFileSync(vaultPath(vault, 'Notes/source.md'), '# Same\n', 'utf8');
    const secondPlan = await call(vault, 'source.ingest.plan', { id: registered.id });
    assert.notEqual(secondPlan.planId, firstPlan.planId);
    const second = await call(vault, 'source.ingest.run', { id: registered.id, planId: secondPlan.planId });

    assert.equal(second.contentChanged, false);
    assert.deepEqual(second.maintenanceEntryIds, []);
    const queue = JSON.parse(readFileSync(vaultPath(vault, '_llmwiki/maintenance/queue.v1.json'), 'utf8')) as {
      entries: Record<string, unknown>;
    };
    assert.equal(Object.keys(queue.entries).length, 1);
  }));

  test('records invalid derivative output as a bounded partial run without materializing Evidence', async () => withVault(async (vault) => {
    writeVault(vault, 'Notes/binary.dat', Buffer.from([0, 1, 2, 3]));
    const registered = await call(vault, 'source.register', { inputType: 'vaultPath', input: 'Notes/binary.dat' });
    const plan = await call(vault, 'source.ingest.plan', { id: registered.id });
    const result = await call(vault, 'source.ingest.run', { id: registered.id, planId: plan.planId });

    assert.equal((result.run as Record<string, unknown>).state, 'partial');
    assert.deepEqual((result.run as Record<string, unknown>).completedStages, ['capture']);
    const receipts = result.receipts as Array<Record<string, unknown>>;
    const failure = receipts.find((receipt) => receipt.status === 'failed');
    assert.deepEqual(failure?.diagnosticCodes, ['INCOMPATIBLE_OUTPUT']);
    assert.equal(existsSync(vaultPath(vault, '00-Inbox/Evidence')), false);
  }));

  test('resumes an expired-lease partial run from accepted receipts without duplicating output', async () => withVault(async (vault) => {
    writeVault(vault, 'Notes/source.md', '# Resume\n');
    const registered = await call(vault, 'source.register', { inputType: 'vaultPath', input: 'Notes/source.md' });
    const plan = await call(vault, 'source.ingest.plan', { id: registered.id });
    const completed = await call(vault, 'source.ingest.run', { id: registered.id, planId: plan.planId });
    const run = completed.run as { runId: string; receiptIds: string[] };
    const captureReceiptId = (completed.receipts as Array<{ operation: string; receiptId: string }>)
      .find((receipt) => receipt.operation === 'capture')!.receiptId;
    const runPath = vaultPath(vault, `_llmwiki/ingest-runs/v1/${run.runId}.json`);
    const persisted = JSON.parse(readFileSync(runPath, 'utf8')) as Record<string, unknown>;
    persisted.state = 'running';
    persisted.completedStages = ['capture'];
    persisted.receiptIds = [captureReceiptId];
    persisted.lease = {
      owner: 'dead-worker',
      acquiredAt: '2026-07-22T00:00:00.000Z',
      expiresAt: '2026-07-22T00:01:00.000Z',
    };
    writeFileSync(runPath, JSON.stringify(persisted, null, 2) + '\n', 'utf8');
    const filesBefore = allFiles(vault);

    const resumed = await call(vault, 'source.ingest.resume', { runId: run.runId, leaseOwner: 'worker/restart' });
    assert.equal((resumed.run as Record<string, unknown>).state, 'succeeded');
    assert.deepEqual((resumed.run as Record<string, unknown>).completedStages, ['capture', 'derive', 'materialize']);
    assert.equal((resumed.receipts as unknown[]).length, 3);
    assert.deepEqual(allFiles(vault), filesBefore);
  }));

  test('verification detects a missing immutable capture', async () => withVault(async (vault) => {
    writeVault(vault, 'Notes/source.md', '# Raw\r\n');
    const registered = await call(vault, 'source.register', { inputType: 'vaultPath', input: 'Notes/source.md' });
    const plan = await call(vault, 'source.ingest.plan', { id: registered.id });
    const result = await call(vault, 'source.ingest.run', { id: registered.id, planId: plan.planId });
    const captureDir = vaultPath(vault, '_llmwiki/ingest-artifacts/v1/captures');
    const capture = readdirSync(captureDir)[0]!;
    rmSync(join(captureDir, capture));

    await assert.rejects(
      () => call(vault, 'source.ingest.verify', { runId: (result.run as Record<string, unknown>).runId }),
      /immutable artifact missing/,
    );
  }));

  test('reads legacy additive run state through inspect without rewriting it', async () => withVault(async (vault) => {
    const path = vaultPath(vault, '_llmwiki/ingest-runs/v1/legacy-run.json');
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({
      runId: 'legacy-run',
      sourceId: 'source/legacy',
      revision: 'legacy-rev',
      status: 'completed',
      stages: ['capture', 'derive', 'materialize'],
      receipts: [],
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:01:00.000Z',
    }), 'utf8');
    const inspected = await call(vault, 'source.ingest.inspect', { runId: 'legacy-run' });
    assert.equal((inspected.run as Record<string, unknown>).schemaVersion, 1);
    assert.equal((inspected.run as Record<string, unknown>).state, 'succeeded');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).schemaVersion, undefined);
  }));

  test('compatibility flag blocks run and resume while retaining inspect and verify operations', async () => withVault(async (vault) => {
    const operations = makeSourceOps(vault, { ingestExecutionEnabled: false });
    assert.ok(operations.some((operation) => operation.name === 'source.ingest.inspect'));
    assert.ok(operations.some((operation) => operation.name === 'source.ingest.verify'));
    const run = operations.find((operation) => operation.name === 'source.ingest.run')!;
    await assert.rejects(
      () => run.handler(context(vault), { planId: 'unused' }),
      /disabled by compatibility flag/,
    );
  }));
});

async function call(vault: string, name: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const operation = operationFor(vault, name);
  return await operation.handler(context(vault), params) as Record<string, unknown>;
}

function operationFor(vault: string, name: string): Operation {
  const operation = makeSourceOps(vault).find((candidate) => candidate.name === name);
  assert.ok(operation, `${name} operation exists`);
  return operation;
}

function context(vault: string): OperationContext {
  return {
    vault: { execute: async () => null },
    adapters: null,
    config: { vault_path: vault },
    logger,
    dryRun: false,
  };
}

function writeVault(vault: string, relativePath: string, content: string | Buffer): void {
  const fullPath = vaultPath(vault, relativePath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, content);
}

function vaultPath(vault: string, relativePath: string): string {
  return join(vault, ...relativePath.split('/'));
}

function allFiles(root: string): string[] {
  const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full.slice(root.length + 1).replace(/\\/g, '/')];
  });
  return walk(root).sort();
}

function withVault<T>(run: (vault: string) => T): T {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-ingest-run-'));
  try {
    const result = run(vault);
    if (result instanceof Promise) return result.finally(() => rmSync(vault, { recursive: true, force: true })) as T;
    rmSync(vault, { recursive: true, force: true });
    return result;
  } catch (error) {
    rmSync(vault, { recursive: true, force: true });
    throw error;
  }
}
