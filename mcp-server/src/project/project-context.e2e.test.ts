import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { AdapterRegistry } from '../adapters/registry.js';
import type { VaultMindAdapter } from '../adapters/interface.js';
import type { Operation, OperationContext } from '../core/types.js';
import { makeSourceOps } from '../source/source.js';
import { makeWorkflowOps } from '../workflow/workflow.js';
import { makeProjectHubOps } from './project-hub.js';
import { makeProjectMigrationOps } from './project-migration.js';
import { makeProjectOps } from './project.js';

const compilerPath = fileURLToPath(new URL('../../../compiler/', import.meta.url));
const python = process.env.PYTHON ?? 'python';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('Project Context end-to-end contract closes one work and migration loop', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-project-e2e-'));
  roots.push(vault);
  const adapters = new AdapterRegistry();
  const filesystem: VaultMindAdapter = {
    name: 'filesystem', capabilities: ['search', 'read'], isAvailable: true,
    async init() {}, async dispose() {},
  };
  adapters.register(filesystem);
  const ctx: OperationContext = {
    vault: { async execute() { return {}; } }, adapters,
    config: { vault_path: vault, adapters: ['filesystem'], auth_token: 'never-return-me', collaboration: { actor: 'codex', role: 'agent' } },
    logger: { info() {}, warn() {}, error() {} }, dryRun: false,
  };
  const operations = new Map<string, Operation>([
    ...makeProjectOps(vault),
    ...makeSourceOps(vault),
    ...makeWorkflowOps(vault),
    ...makeProjectHubOps(adapters),
    ...makeProjectMigrationOps({ python, compilerPath, vaultPath: vault }),
  ].map((operation) => [operation.name, operation]));
  const call = (name: string, params: Record<string, unknown> = {}) => operations.get(name)!.handler(ctx, params);

  const adopted = await call('project.init', { project: 'alpha', description: 'End-to-end Project' }) as Record<string, any>;
  assert.equal(adopted.projectId, 'project/alpha');
  const issue = await call('project.issue.create', {
    project: 'project/alpha', title: 'Build index', state: 'todo', priority: 1,
  }) as Record<string, any>;
  assert.equal(issue.path, '01-Projects/alpha/issues/build-index.md');

  const source = await call('source.register', {
    input: 'https://github.com/Radiant303/SpringNote', project: 'project/alpha',
  }) as Record<string, any>;
  assert.equal(source.projectId, 'project/alpha');

  const selected = JSON.parse(execFileSync(python, [
    join(compilerPath, 'kb_meta.py'), 'work', 'next', vault,
    '--claim', 'codex', '--project', 'project/alpha',
  ], { encoding: 'utf-8', cwd: compilerPath })) as Record<string, any>;
  assert.equal(selected.selected.entity, 'project/alpha/issue/build-index');
  assert.equal(selected.lease.outcome, 'ACQUIRED');
  const lease = selected.lease as Record<string, string>;

  await call('workflow.agent.join', {
    project: lease.project_id, agent: 'codex', work_run_id: lease.work_run_id,
    work_run_state: 'leased', work_item_id: lease.work_item_id,
    transition_token: 'e2e:join', provenance: ['work-driver:lease-acquired'],
  });
  await call('workflow.agent.checkpoint', {
    project: lease.project_id, agent: 'codex', work_run_id: lease.work_run_id,
    work_run_state: 'awaiting_review', transition_token: 'e2e:review',
    output_class: 'knowledge-claim', approval_status: 'pending',
    summary: 'Knowledge output awaits review', evidence: ['test:e2e'],
  });
  const durableRun = JSON.parse(readFileSync(
    join(vault, '01-Projects', 'alpha', 'runs', `${lease.work_run_id.slice('work-run/'.length)}.json`),
    'utf-8',
  )) as Record<string, unknown>;
  assert.equal(durableRun.state, 'awaiting_review');

  const hub = await call('project.hub.get', { ref: 'project/alpha' }) as Record<string, any>;
  assert.equal(hub.sections.runtime.data.activeRuns[0].workRunId, lease.work_run_id);
  assert.doesNotMatch(JSON.stringify(hub), /never-return-me/);

  mkdirSync(join(vault, '10-Projects', 'alpha', 'docket'), { recursive: true });
  writeFileSync(join(vault, '10-Projects', 'alpha', 'docket', 'legacy-closeout.md'), '---\nstate: todo\n---\n# Legacy\n');
  const applied = await call('project.migration.apply', { apply: true, batch_id: 'e2e-closeout' }) as Record<string, any>;
  assert.match(readFileSync(join(vault, '01-Projects', 'alpha', 'issues', 'legacy-closeout.md'), 'utf-8'), /project\/alpha\/issue\/legacy-closeout/);
  const manifest = relative(vault, applied.manifest_path).replaceAll('\\', '/');
  const restored = await call('project.migration.restore', { manifest, apply: true }) as Record<string, any>;
  assert.ok(restored.restored.length > 0);
});
