import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Operation, OperationContext } from './types.js';
import { makeAllOperations } from './operations.js';
import {
  adjudicateOperationWrite,
  auditOperationWrite,
  staticTargets,
  targetParams,
  writeEffectsForVerdict,
} from './write-policy.js';

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeVault(): string {
  const dir = join(tmpdir(), `llmwiki-write-policy-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function makeCtx(
  allowed_write_paths = ['notes/**'],
  options: { actor?: string; enforce?: boolean } = {},
): OperationContext {
  return {
    vault: null as never,
    adapters: null,
    config: {
      vault_path: makeVault(),
      collaboration: {
        ...(options.actor === undefined ? { actor: 'codex' } : options.actor ? { actor: options.actor } : {}),
        role: 'agent',
        allowed_write_paths,
        ...(options.enforce === undefined ? {} : { enforce: options.enforce }),
      },
    },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: false,
  };
}

function createOp(): Operation {
  return {
    name: 'vault.create',
    namespace: 'vault',
    description: 'test create',
    mutating: true,
    writePolicy: {
      realWrite: 'dryRunFalse',
      targets: targetParams('path'),
      audit: 'required',
      effects: (_ctx, params) => [{ type: 'touchMarkdown', path: params.path, event: 'create' }],
    },
    params: {
      path: { type: 'string', required: true },
      dryRun: { type: 'boolean', required: false, default: true },
    },
    handler: async () => ({}),
  };
}

function createBatchOp(): Operation {
  return {
    name: 'vault.batch',
    namespace: 'vault',
    description: 'test batch',
    mutating: true,
    writePolicy: {
      realWrite: 'always',
      targets: staticTargets(),
      audit: 'required',
    },
    params: {
      operations: { type: 'array', required: true },
      dryRun: { type: 'boolean', required: false },
    },
    handler: async () => ({}),
  };
}

function makeOperationRegistry(): Map<string, Operation> {
  const deps = {
    compileTrigger: {
      status: () => ({ dirty: false }),
      run: async () => ({ ok: true }),
      abort: async () => ({ ok: true }),
    },
    registry: {
      get: () => undefined,
      list: () => [],
    },
    defaultWeights: {},
    python: 'python',
    compilerPath: makeVault(),
    vaultPath: makeVault(),
    configPath: join(makeVault(), 'config.json'),
  } as unknown as Parameters<typeof makeAllOperations>[0];
  return new Map(makeAllOperations(deps).map((operation) => [operation.name, operation]));
}

function requireOperation(registry: Map<string, Operation>, name: string): Operation {
  const operation = registry.get(name);
  assert.ok(operation, `${name} operation exists`);
  return operation;
}

function auditEntries(ctx: OperationContext): Array<Record<string, unknown>> {
  const day = new Date().toISOString().slice(0, 10);
  const path = join(ctx.config.vault_path, '.wiki-audit', `${day}.jsonl`);
  return readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('Operation Write Policy', () => {
  test('does not adjudicate dry-run writes as real writes', () => {
    const op = createOp();
    const verdict = adjudicateOperationWrite(makeCtx(), op, { path: 'notes/a.md', dryRun: true }, new Map([[op.name, op]]));
    assert.equal(verdict.realWrite, false);
    assert.deepEqual(verdict.targets, []);
  });

  test('blocks real writes outside collaboration allowlist', () => {
    const op = createOp();
    assert.throws(
      () => adjudicateOperationWrite(makeCtx(), op, { path: 'secret/a.md', dryRun: false }, new Map([[op.name, op]])),
      /outside allowed write paths/,
    );
  });

  test('retired project docket is not in the default agent write allowlist', () => {
    const op = createOp();
    const ctx = makeCtx([]);
    assert.throws(
      () => adjudicateOperationWrite(
        ctx,
        op,
        { path: '10-Projects/alpha/docket/legacy.md', dryRun: false },
        new Map([[op.name, op]]),
      ),
      /outside allowed write paths/,
    );
  });

  test('generic mutation operations cannot target Work Run claim, recovery, or lock namespaces', () => {
    const generic = createOp();
    const context = makeCtx([
      '01-Projects/alpha/runs/**',
      '01-Projects/alpha/runs/run.json',
      '01-Projects/alpha/runs/output-runs/**',
      '01-Projects/alpha/runs/recovery-plans/**',
      '.vault-mind/_work-run.lock',
    ]);
    for (const path of [
      '01-Projects/alpha/runs/**',
      '01-Projects/alpha/runs/run.json',
      '01-Projects/alpha/runs/output-runs/claim.json',
      '01-Projects/alpha/runs/recovery-plans/claim.json',
      '.vault-mind/_work-run.lock',
    ]) {
      assert.throws(
        () => adjudicateOperationWrite(context, generic, { path, dryRun: false }, new Map([[generic.name, generic]])),
        /governance namespace is owner-protected/u,
      );
    }
    assert.throws(
      () => adjudicateOperationWrite(context, { ...generic, name: 'workflow.agent.forged' }, { path: '01-Projects/alpha/runs/output-runs/claim.json', dryRun: false }, new Map()),
      /governance namespace is owner-protected/u,
    );
  });

  test('Work Run owner namespaces stay protected without collaboration enforcement or actor', () => {
    const generic = createOp();
    const registry = new Map([[generic.name, generic]]);
    for (const context of [
      makeCtx(['01-Projects/alpha/runs/**'], { enforce: false }),
      makeCtx(['01-Projects/alpha/runs/**'], { actor: '', enforce: false }),
    ]) {
      assert.throws(
        () => adjudicateOperationWrite(context, generic, { path: '01-Projects/alpha/runs/output-claims/claim.json', dryRun: false }, registry),
        /governance namespace is owner-protected/u,
      );
      const batch = createBatchOp();
      assert.throws(
        () => adjudicateOperationWrite(context, batch, {
          dryRun: false,
          operations: [{ method: generic.name, params: { path: '01-Projects/alpha/runs/recovery-tokens/token.json' } }],
        }, new Map([[batch.name, batch], [generic.name, generic]])),
        /governance namespace is owner-protected/u,
      );
    }

    const ownerContext = makeCtx([], { actor: '', enforce: false });
    mkdirSync(join(ownerContext.config.vault_path, 'Projects'), { recursive: true });
    writeFileSync(join(ownerContext.config.vault_path, 'Projects', 'alpha.md'), '---\ntype: project\nentity: project/alpha\n---\n', 'utf8');
    const owner = requireOperation(makeOperationRegistry(), 'workflow.agent.start');
    const allowed = adjudicateOperationWrite(
      ownerContext,
      owner,
      { project: 'project/alpha' },
      makeOperationRegistry(),
    );
    assert.ok(allowed.targets.some((target) => target.endsWith('/runs/**')));
  });

  test('settings paths are authorized only for settings assignment operations', () => {
    const generic = createOp();
    const context = makeCtx([]);
    assert.throws(
      () => adjudicateOperationWrite(
        context,
        generic,
        { path: '_llmwiki/settings/vault.json', dryRun: false },
        new Map([[generic.name, generic]]),
      ),
      /outside allowed write paths/,
    );

    const registry = makeOperationRegistry();
    const assignment = requireOperation(registry, 'settings.assignment.set');
    const verdict = adjudicateOperationWrite(
      context,
      assignment,
      {
        scope: 'vault',
        key: 'query.semantic.enabled',
        value: true,
        expectedRevision: 0,
      },
      registry,
    );
    assert.deepEqual(verdict.targets, ['_llmwiki/settings/vault.json']);
  });

  test('governed Host Capability state and proxy side effects are authorized only for Host operations', () => {
    const registry = makeOperationRegistry();
    const context = makeCtx([]);
    const plan = requireOperation(registry, 'host.assignment.plan');
    const planVerdict = adjudicateOperationWrite(context, plan, {}, registry);
    assert.equal(planVerdict.realWrite, true);
    assert.deepEqual(planVerdict.targets, ['_llmwiki/host-capabilities/v1/assignments']);

    const invoke = requireOperation(registry, 'host.proxy.invoke');
    const invokeVerdict = adjudicateOperationWrite(context, invoke, {}, registry);
    assert.equal(invokeVerdict.realWrite, true);
    assert.equal(invokeVerdict.audit, 'required');
    assert.deepEqual(invokeVerdict.targets, ['external/host-capability/**']);

    const generic = createOp();
    assert.throws(
      () => adjudicateOperationWrite(
        context,
        generic,
        { path: '_llmwiki/host-capabilities/v1/assignments', dryRun: false },
        new Map([[generic.name, generic]]),
      ),
      /outside allowed write paths/,
    );
  });

  test('Agent Domain operations are narrowly authorized for governed state, usage, and Promotion handoff targets', () => {
    const registry = makeOperationRegistry();
    const context = makeCtx([]);

    for (const name of ['dreamtime.checkpoint.propose', 'consult.execute', 'delegation.plan', 'delegation.approve']) {
      const verdict = adjudicateOperationWrite(context, requireOperation(registry, name), {}, registry);
      assert.deepEqual(verdict.targets, ['_llmwiki/agent-domain/v1/**', '_llmwiki/usage/v1/**']);
    }

    const profile = adjudicateOperationWrite(context, requireOperation(registry, 'agent.profile.create'), {}, registry);
    assert.deepEqual(profile.targets, ['_llmwiki/agent-domain/v1/**']);

    const promotion = adjudicateOperationWrite(context, requireOperation(registry, 'dreamtime.promotion.handoff'), {}, registry);
    assert.deepEqual(promotion.targets, ['00-Inbox/AI-Output/vault-dreamtime/**']);

    const generic = createOp();
    assert.throws(
      () => adjudicateOperationWrite(
        context,
        generic,
        { path: '_llmwiki/usage/v1/**', dryRun: false },
        new Map([[generic.name, generic]]),
      ),
      /outside allowed write paths/,
    );
  });

  test('vault.batch inherits dryRun and aggregates child targets', () => {
    const child = createOp();
    const batch = createBatchOp();
    const verdict = adjudicateOperationWrite(
      makeCtx(),
      batch,
      { dryRun: false, operations: [{ method: 'vault.create', params: { path: 'notes/a.md' } }] },
      new Map([[batch.name, batch], [child.name, child]]),
    );
    assert.equal(verdict.realWrite, true);
    assert.deepEqual(verdict.targets, ['notes/a.md']);
    assert.equal(verdict.children?.[0]?.params.dryRun, false);
  });

  test('vault.batch is published as write-capable metadata', () => {
    const batch = requireOperation(makeOperationRegistry(), 'vault.batch');
    assert.equal(batch.mutating, true);
    assert.equal(!batch.mutating, false);
  });

  test('conditional write policies skip read-only calls on mutating-capable operation', () => {
    const op: Operation = {
      name: 'project.board.get',
      namespace: 'project',
      description: 'conditionally writes board.md',
      mutating: true,
      writePolicy: {
        realWrite: 'always',
        shouldWrite: (_ctx, params) => params.write === true,
        targets: targetParams('path'),
        audit: 'required',
      },
      params: {
        path: { type: 'string', required: true },
        write: { type: 'boolean', required: false, default: false },
      },
      handler: async () => ({}),
    };
    const verdict = adjudicateOperationWrite(makeCtx(), op, { path: 'notes/board.md', write: false }, new Map([[op.name, op]]));
    assert.equal(verdict.realWrite, false);
    assert.deepEqual(verdict.targets, []);
  });

  test('Project migration apply and restore are write-policy guarded', () => {
    const registry = makeOperationRegistry();
    const operation = requireOperation(registry, 'project.migration.apply');
    const preview = adjudicateOperationWrite(makeCtx(), operation, { apply: false }, registry);
    assert.equal(preview.realWrite, false);
    assert.deepEqual(preview.targets, []);

    const allowed = ['Projects/**', '01-Projects/**', '.vault-mind/local-bindings.json', '.vault-mind/project-migrations/**'];
    const apply = adjudicateOperationWrite(makeCtx(allowed), operation, { apply: true }, registry);
    assert.equal(apply.realWrite, true);
    assert.equal(apply.audit, 'required');
    assert.deepEqual(apply.targets, allowed);
  });

  test('real writes must declare at least one target', () => {
    const op: Operation = {
      name: 'broken.empty-target',
      namespace: 'vault',
      description: 'invalid empty target policy',
      mutating: true,
      writePolicy: {
        realWrite: 'always',
        targets: staticTargets(),
        audit: 'required',
      },
      params: {},
      handler: async () => ({}),
    };
    assert.throws(
      () => adjudicateOperationWrite(makeCtx(), op, {}, new Map([[op.name, op]])),
      /produced no write targets/,
    );
  });

  test('external side effects require explicit virtual allowlist targets and audit', () => {
    const registry = makeOperationRegistry();
    const recipeRun = requireOperation(registry, 'recipe.run');
    assert.throws(
      () => adjudicateOperationWrite(makeCtx(), recipeRun, { id: 'demo' }, registry),
      /outside allowed write paths/,
    );

    const recipeVerdict = adjudicateOperationWrite(makeCtx(['external/recipe/**']), recipeRun, { id: 'demo' }, registry);
    assert.equal(recipeVerdict.realWrite, true);
    assert.equal(recipeVerdict.audit, 'required');
    assert.deepEqual(recipeVerdict.targets, ['external/recipe/**']);

    const compileRun = requireOperation(registry, 'compile.run');
    const compileVerdict = adjudicateOperationWrite(
      makeCtx(['external/compile/**', '_llmwiki/compile-runs/v1/**', '00-Inbox/AI-Output/vault-compiler/**']),
      compileRun,
      {},
      registry,
    );
    assert.equal(compileVerdict.realWrite, true);
    assert.deepEqual(compileVerdict.targets, [
      'external/compile/**',
      '_llmwiki/compile-runs/v1/**',
      '00-Inbox/AI-Output/vault-compiler/**',
    ]);

    const scopedVerdict = adjudicateOperationWrite(
      makeCtx(['external/compile/**', '_llmwiki/compile-runs/v1/**', '00-Inbox/AI-Output/vault-compiler/**', 'alpha/wiki/**', 'alpha/_meta.json']),
      compileRun,
      { topic: 'alpha' },
      registry,
    );
    assert.deepEqual(scopedVerdict.targets, [
      'external/compile/**',
      '_llmwiki/compile-runs/v1/**',
      '00-Inbox/AI-Output/vault-compiler/**',
      'alpha/wiki/**',
      'alpha/_meta.json',
    ]);

    const agentTrigger = requireOperation(registry, 'agent.trigger');
    const agentVerdict = adjudicateOperationWrite(
      makeCtx([
        'external/agent/**',
        '_llmwiki/agent-runs/v1/**',
        'external/compile/**',
        '_llmwiki/compile-runs/v1/**',
        '00-Inbox/AI-Output/vault-compiler/**',
        'alpha/wiki/**',
        'alpha/_meta.json',
      ]),
      agentTrigger,
      { action: 'compile', topic: 'alpha' },
      registry,
    );
    assert.deepEqual(agentVerdict.targets, [
      'external/agent/**',
      '_llmwiki/agent-runs/v1/**',
      'external/compile/**',
      '_llmwiki/compile-runs/v1/**',
      '00-Inbox/AI-Output/vault-compiler/**',
      'alpha/wiki/**',
      'alpha/_meta.json',
    ]);

    const approval = requireOperation(registry, 'compile.run.approve');
    const approvalVerdict = adjudicateOperationWrite(
      makeCtx(['external/compile/**', '_llmwiki/compile-runs/v1/**', '00-Inbox/AI-Output/vault-compiler/**', 'alpha/wiki/**', 'alpha/_meta.json']),
      approval,
      { runId: 'compile-run/approval', topic: 'alpha' },
      registry,
    );
    assert.deepEqual(approvalVerdict.targets, [
      'external/compile/**',
      '_llmwiki/compile-runs/v1/**',
      '00-Inbox/AI-Output/vault-compiler/**',
      'alpha/wiki/**',
      'alpha/_meta.json',
    ]);

    const rejection = requireOperation(registry, 'compile.run.reject');
    const rejectionVerdict = adjudicateOperationWrite(
      makeCtx(['external/compile/**', '_llmwiki/compile-runs/v1/**', '00-Inbox/AI-Output/vault-compiler/**', 'alpha/wiki/**', 'alpha/_meta.json']),
      rejection,
      { runId: 'compile-run/approval', topic: 'alpha' },
      registry,
    );
    assert.deepEqual(rejectionVerdict.targets, approvalVerdict.targets);
  });

  test('lightrag.ingest only adjudicates external side effects when dryRun is false', () => {
    const registry = makeOperationRegistry();
    const ingest = requireOperation(registry, 'lightrag.ingest');
    const dryRunVerdict = adjudicateOperationWrite(
      makeCtx(['external/lightrag/**']),
      ingest,
      { path: 'notes/a.md', dryRun: true },
      registry,
    );
    assert.equal(dryRunVerdict.realWrite, false);

    const writeVerdict = adjudicateOperationWrite(
      makeCtx(['external/lightrag/**']),
      ingest,
      { path: 'notes/a.md', dryRun: false },
      registry,
    );
    assert.equal(writeVerdict.realWrite, true);
    assert.equal(writeVerdict.audit, 'required');
    assert.deepEqual(writeVerdict.targets, ['external/lightrag/**']);
  });

  test('vault.batch skips effects and records failure for failed write children', () => {
    const ctx = makeCtx();
    const child = createOp();
    const batch = createBatchOp();
    const verdict = adjudicateOperationWrite(
      ctx,
      batch,
      { dryRun: false, operations: [{ method: 'vault.create', params: { path: 'notes/a.md' } }] },
      new Map([[batch.name, batch], [child.name, child]]),
    );
    const result = { results: [{ ok: false, error: 'boom' }] };

    assert.deepEqual(writeEffectsForVerdict(ctx, verdict, result), []);

    auditOperationWrite(ctx, verdict, result);
    const [entry] = auditEntries(ctx);
    assert.equal(entry.ok, false);
    assert.equal((entry.children as Array<{ ok: boolean }>)[0]?.ok, false);
  });
});

// @ts-expect-error mutating operations must declare local writePolicy.
const missingPolicy: Operation = {
  name: 'broken.write',
  namespace: 'vault',
  description: 'compile-time contract check',
  mutating: true,
  params: {},
  handler: async () => ({}),
};
void missingPolicy;
