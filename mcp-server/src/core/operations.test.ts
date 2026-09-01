import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { makeAllOperations } from './operations.js';

test('core catalog exposes planning and claim-first apply independently', () => {
  const root = join(tmpdir(), `llmwiki-recovery-plan-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  try {
    const operations = makeAllOperations({
      compileTrigger: null as never,
      registry: { get: () => undefined, list: () => [] } as never,
      defaultWeights: {},
      python: 'python',
      compilerPath: root,
      vaultPath: root,
    });
    const plan = operations.find((operation) => operation.name === 'workflow.recovery.plan');
    assert.ok(plan);
    assert.equal(plan.mutating, false);
    const apply = operations.find((operation) => operation.name === 'workflow.recovery.apply');
    assert.ok(apply);
    assert.equal(apply.mutating, true);
    const reindexStatus = operations.find((operation) => operation.name === 'vault.reindex_status');
    assert.ok(reindexStatus);
    assert.equal(reindexStatus.mutating, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
