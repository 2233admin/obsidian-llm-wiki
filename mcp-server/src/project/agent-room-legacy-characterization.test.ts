import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { AdapterRegistry } from '../adapters/registry.js';
import type { VaultMindAdapter } from '../adapters/interface.js';
import type { Operation, OperationContext } from '../core/types.js';
import { makeContextOps } from '../context/context.js';
import { makeMemoryOps } from '../memory/memory.js';
import { makeSettingsOps, createSettingsService } from '../settings/settings.js';
import { makeWorkflowOps } from '../workflow/workflow.js';
import { makeProjectHubOps } from './project-hub.js';

test('legacy Agent memory, context, Work Run, settings, and Project Hub remain one Project-rooted contract', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-agent-room-baseline-'));
  try {
    registerProject(vault);
    const registry = fakeRegistry();
    const userDevicePath = join(vault, '.device', 'settings.json');
    const settings = createSettingsService({
      vaultPath: vault,
      userDevicePath,
      userDeviceId: 'device/local',
      vaultId: 'vault/test',
      workspaceProjectId: 'project/alpha',
      sessionId: 'session/baseline',
      environment: { BASELINE_SECRET: 'must-never-leak' },
    });
    const operations = new Map<string, Operation>([
      ...makeMemoryOps(vault),
      ...makeContextOps(vault, registry),
      ...makeWorkflowOps(vault),
      ...makeSettingsOps({
        vaultPath: vault,
        userDevicePath,
        userDeviceId: 'device/local',
        vaultId: 'vault/test',
        workspaceProjectId: 'project/alpha',
        sessionId: 'session/baseline',
      }, settings),
      ...makeProjectHubOps(registry, settings),
    ].map((operation) => [operation.name, operation]));
    const ctx: OperationContext = {
      vault: { async execute() { return {}; } },
      adapters: registry,
      config: {
        vault_path: vault,
        auth_token: 'must-never-leak',
        adapters: ['filesystem'],
        collaboration: { actor: 'codex', role: 'agent' },
      },
      logger: { info() {}, warn() {}, error() {} },
      dryRun: false,
    };
    const call = async (name: string, params: Record<string, unknown> = {}) => {
      const operation = operations.get(name);
      assert.ok(operation, `${name} operation exists`);
      return operation.handler(ctx, params);
    };

    const passport = await call('memory.passport.upsert', {
      project: 'project/alpha',
      goal: 'Preserve the existing Agent memory contract',
      constraints: ['Room must remain Project-rooted'],
      decisions: ['Use the existing memory path until migration is approved'],
    }) as { path: string };
    const handoff = await call('memory.handoff.write', {
      project: 'project/alpha',
      currentState: 'Legacy context is characterized',
      nextSteps: ['Introduce revisions through an explicit migration'],
    }) as { path: string };
    const run = await call('workflow.agent.start', {
      project: 'project/alpha',
      agent: 'codex',
      objective: 'Characterize the pre-Room execution contract',
      transition_token: 'characterization:manual-start',
      provenance: ['test:agent-room-legacy-characterization'],
    }) as { projectId: string; workRunId: string; path: string; runPath: string };
    const snapshotResult = await call('settings.snapshot.resolve') as {
      snapshot: { context: { workspaceProjectId?: string }; snapshotId: string };
    };

    assert.equal(passport.path, '10-Projects/alpha/agents/codex/memory/passport.md');
    assert.equal(handoff.path, '10-Projects/alpha/agents/codex/memory/handoff.md');
    assert.equal(run.projectId, 'project/alpha');
    assert.match(run.workRunId, /^work-run\//);
    assert.equal(run.path, '01-Projects/alpha/agents/codex/lifetime.md');
    assert.match(run.runPath, /^01-Projects\/alpha\/runs\//);
    assert.equal(snapshotResult.snapshot.context.workspaceProjectId, 'project/alpha');

    const beforeReads = manifest(vault);
    const wakeup = await call('context.wakeup', {
      project: 'project/alpha',
      includeRecall: false,
    }) as Record<string, unknown>;
    const hub = await call('project.hub.get', { ref: 'project/alpha' }) as Record<string, any>;
    assert.deepEqual(manifest(vault), beforeReads, 'read projections must not create a second state store');

    const wakeupText = JSON.stringify(wakeup);
    assert.match(wakeupText, /Preserve the existing Agent memory contract/);
    assert.match(wakeupText, /Legacy context is characterized/);
    assert.equal(hub.projectId, 'project/alpha');
    assert.equal(hub.readOnly, true);
    assert.equal(hub.sections.runtime.data.activeRuns[0].workRunId, run.workRunId);
    assert.equal(hub.sections.knowledge.data.root, '10-Projects/alpha');
    assert.equal(hub.sections.work.data.root, '01-Projects/alpha');

    const serialized = JSON.stringify({ wakeup, hub, snapshotResult });
    assert.doesNotMatch(serialized, /must-never-leak/);
    assert.doesNotMatch(serialized, /\.device[\\/]settings\.json/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

function registerProject(vault: string): void {
  mkdirSync(join(vault, 'Projects'), { recursive: true });
  mkdirSync(join(vault, '01-Projects', 'alpha'), { recursive: true });
  writeFileSync(join(vault, 'Projects', 'alpha.md'), [
    '---',
    'type: project',
    'entity: project/alpha',
    'lifecycle: active',
    '---',
    '# Alpha',
    '',
  ].join('\n'), 'utf-8');
  writeFileSync(
    join(vault, '01-Projects', 'alpha', '_project.md'),
    '---\ntype: project\nentity: project/alpha\nstatus: active\n---\n',
    'utf-8',
  );
}

function fakeRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  const adapter: VaultMindAdapter = {
    name: 'filesystem',
    capabilities: ['search', 'read'],
    isAvailable: true,
    async init() {},
    async dispose() {},
    async search() { return []; },
  };
  registry.register(adapter);
  return registry;
}

function manifest(root: string): Record<string, string> {
  const output: Record<string, string> = {};
  const visit = (directory: string): void => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        output[relative(root, path).replaceAll('\\', '/')] = createHash('sha256')
          .update(readFileSync(path))
          .digest('hex');
      }
    }
  };
  visit(root);
  return output;
}
