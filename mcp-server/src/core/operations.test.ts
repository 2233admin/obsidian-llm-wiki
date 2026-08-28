import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { makeAllOperations } from './operations.js';

test('core catalog exposes planning independently of apply', () => {
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
    assert.equal(operations.some((operation) => operation.name === 'workflow.recovery.apply'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
