import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { OperationContext } from './types.js';
import { operations } from './operations.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('deprecated vault.project routes only registered Projects and never implicitly creates', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-vault-project-'));
  roots.push(vault);
  const calls: Array<Record<string, unknown>> = [];
  const ctx: OperationContext = {
    vault: { async execute(_method, params) { calls.push(params); return { path: 'Projects/alpha.md' }; } },
    adapters: null, config: { vault_path: vault },
    logger: { info() {}, warn() {}, error() {} }, dryRun: false,
  };
  const operation = operations.find((candidate) => candidate.name === 'vault.project')!;
  await assert.rejects(operation.handler(ctx, { name: 'unknown', dryRun: false }), /Project not found/);
  assert.equal(calls.length, 0);

  mkdirSync(join(vault, 'Projects'), { recursive: true });
  writeFileSync(join(vault, 'Projects', 'alpha.md'), '---\ntype: project\nentity: project/alpha\naliases: [Alpha Product]\n---\n');
  const result = await operation.handler(ctx, { name: 'Alpha Product', dryRun: false }) as Record<string, any>;
  assert.equal(calls[0]?.name, 'alpha');
  assert.equal(calls[0]?.entity, 'project/alpha');
  assert.equal(result.projectId, 'project/alpha');
  assert.equal(result.diagnostics[0].code, 'vault_project_deprecated');
});
