import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
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

function makeCtx(allowed_write_paths = ['notes/**']): OperationContext {
  return {
    vault: null as never,
    adapters: null,
    config: {
      vault_path: makeVault(),
      collaboration: { actor: 'codex', role: 'agent', allowed_write_paths },
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
    const compileVerdict = adjudicateOperationWrite(makeCtx(['external/compile/**']), compileRun, {}, registry);
    assert.equal(compileVerdict.realWrite, true);
    assert.deepEqual(compileVerdict.targets, ['external/compile/**']);
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
