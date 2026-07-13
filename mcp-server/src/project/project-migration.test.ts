import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { OperationContext } from '../core/types.js';
import { makeProjectMigrationOps } from './project-migration.js';

const compilerPath = fileURLToPath(new URL('../../../compiler/', import.meta.url));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-migration-op-'));
  roots.push(root);
  mkdirSync(join(root, 'Projects'), { recursive: true });
  mkdirSync(join(root, '01-Projects', 'alpha'), { recursive: true });
  mkdirSync(join(root, '10-Projects', 'alpha', 'docket'), { recursive: true });
  writeFileSync(join(root, 'Projects', 'alpha.md'), '---\ntype: project\nentity: project/alpha\naliases: [alpha]\nlifecycle: active\n---\n');
  writeFileSync(join(root, '01-Projects', 'alpha', '_project.md'), '---\nentity: project/alpha\n---\n');
  writeFileSync(join(root, '10-Projects', 'alpha', 'docket', 'legacy.md'), '---\nstatus: active\n---\n# Legacy\n');
  const operations = new Map(makeProjectMigrationOps({ python: process.env.PYTHON ?? 'python', compilerPath, vaultPath: root })
    .map((operation) => [operation.name, operation]));
  const ctx: OperationContext = {
    vault: { async execute() { return {}; } }, adapters: null,
    config: { vault_path: root }, logger: { info() {}, warn() {}, error() {} }, dryRun: true,
  };
  const call = (name: string, params: Record<string, unknown> = {}) => operations.get(name)!.handler(ctx, params);
  return { root, operations, call };
}

function bytes(root: string, path: string): string {
  return readFileSync(join(root, path), 'utf-8');
}

describe('Project migration operations', () => {
  test('inventory and plan are byte-preserving and apply defaults to false', async () => {
    const { root, call } = fixture();
    const before = bytes(root, '10-Projects/alpha/docket/legacy.md');
    const inventory = await call('project.migration.inventory') as Record<string, any>;
    const plan = await call('project.migration.plan') as Record<string, any>;
    const preview = await call('project.migration.apply') as Record<string, any>;
    assert.equal(inventory.counts.legacy_work, 1);
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.actions.some((action: Record<string, unknown>) => action.path === '01-Projects/alpha/issues/legacy.md'), true);
    assert.equal(preview.apply, false);
    assert.equal(bytes(root, '10-Projects/alpha/docket/legacy.md'), before);
    assert.deepEqual(readdirSync(join(root, '01-Projects', 'alpha')), ['_project.md']);
  });

  test('explicit apply writes a manifest and restore removes the migrated copy', async () => {
    const { root, call } = fixture();
    const applied = await call('project.migration.apply', { apply: true, batch_id: 'test-batch' }) as Record<string, any>;
    assert.equal(applied.apply, true);
    assert.equal(applied.state, 'completed');
    assert.match(bytes(root, '01-Projects/alpha/issues/legacy.md'), /entity: project\/alpha\/issue\/legacy/);
    const manifest = relative(root, applied.manifest_path).replaceAll('\\', '/');
    const preview = await call('project.migration.restore', { manifest }) as Record<string, any>;
    assert.equal(preview.apply, false);
    const restored = await call('project.migration.restore', { manifest, apply: true }) as Record<string, any>;
    assert.equal(restored.restored.length, 1);
    assert.throws(() => readFileSync(join(root, '01-Projects/alpha/issues/legacy.md')));
  });

  test('only apply and restore expose guarded write policies', () => {
    const { operations } = fixture();
    assert.notEqual(operations.get('project.migration.inventory')!.mutating, true);
    assert.notEqual(operations.get('project.migration.plan')!.mutating, true);
    assert.equal(operations.get('project.migration.apply')!.mutating, true);
    assert.equal(operations.get('project.migration.restore')!.mutating, true);
  });

  test('anchor-only adoption applies and restore removes the shared registry record', async () => {
    const { root, call } = fixture();
    rmSync(join(root, 'Projects', 'alpha.md'));

    const plan = await call('project.migration.plan') as Record<string, any>;
    const adoption = plan.actions.find(
      (action: Record<string, unknown>) => action.reason === 'adopt_work_os_anchor_as_shared_project',
    );
    assert.equal(adoption.path, 'Projects/alpha.md');
    assert.equal(adoption.expected_hash, null);

    const applied = await call('project.migration.apply', { apply: true, batch_id: 'anchor-only' }) as Record<string, any>;
    assert.match(bytes(root, 'Projects/alpha.md'), /entity: project\/alpha/);
    const manifest = relative(root, applied.manifest_path).replaceAll('\\', '/');
    await call('project.migration.restore', { manifest, apply: true });
    assert.throws(() => readFileSync(join(root, 'Projects', 'alpha.md')));
  });
});
