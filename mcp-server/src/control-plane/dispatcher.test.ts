import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { randomUUID } from 'node:crypto';

import type { Operation, OperationContext } from '../core/types.js';
import { OperationError } from '../core/types.js';
import { createOperationDispatcher } from './dispatcher.js';

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeContext(allowedWritePaths = ['notes/**']): OperationContext {
  const vaultPath = join(tmpdir(), `llmwiki-operation-dispatcher-${randomUUID()}`);
  mkdirSync(vaultPath, { recursive: true });
  tempDirs.push(vaultPath);
  return {
    vault: { execute: async () => null },
    adapters: null,
    config: {
      vault_path: vaultPath,
      collaboration: {
        actor: 'agent/dispatcher-test',
        role: 'agent',
        allowed_write_paths: allowedWritePaths,
        enforce: true,
      },
    },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: false,
  };
}

function readonlyOperation(result: unknown): Operation {
  return {
    name: 'project.read',
    namespace: 'project',
    description: 'Read a project',
    mutating: false,
    params: {
      project: { type: 'string', required: true },
    },
    handler: async (_context, params) => ({ result, project: params.project }),
  };
}

function writeOperation(target: string, handler: Operation['handler']): Operation {
  return {
    name: 'project.write',
    namespace: 'project',
    description: 'Write a project note',
    mutating: true,
    params: {
      content: { type: 'string', required: true },
    },
    writePolicy: {
      realWrite: 'always',
      targets: () => [target],
      audit: 'required',
    },
    handler,
  };
}

function auditEntries(context: OperationContext): Array<Record<string, unknown>> {
  const day = new Date().toISOString().slice(0, 10);
  const auditPath = join(context.config.vault_path, '.wiki-audit', `${day}.jsonl`);
  return readFileSync(auditPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function expectOperationError(
  action: () => Promise<unknown>,
  code: number,
  message: RegExp,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof OperationError);
    assert.equal(error.code, code);
    assert.match(error.message, message);
    return true;
  });
}

describe('Operation dispatcher', () => {
  test('invokes a readonly operation with validated params', async () => {
    const operation = readonlyOperation('project data');
    const dispatcher = createOperationDispatcher([operation], makeContext());

    const result = await dispatcher.invoke('project.read', { project: 'alpha' });

    assert.deepEqual(result, { result: 'project data', project: 'alpha' });
  });

  test('returns the handler result without wrapping or cloning it', async () => {
    const exactResult = { ok: true, nested: { revision: 7 } };
    const operation = readonlyOperation(null);
    operation.handler = async () => exactResult;
    const dispatcher = createOperationDispatcher([operation], makeContext());

    const result = await dispatcher.invoke('project.read', { project: 'alpha' });

    assert.equal(result, exactResult);
  });

  test('allows and audits a governed write', async () => {
    const context = makeContext();
    let mutations = 0;
    const operation = writeOperation('notes/alpha.md', async (_ctx, params) => {
      mutations += 1;
      return { path: 'notes/alpha.md', content: params.content };
    });
    const dispatcher = createOperationDispatcher([operation], context);

    const result = await dispatcher.invoke('project.write', { content: 'hello' });

    assert.deepEqual(result, { path: 'notes/alpha.md', content: 'hello' });
    assert.equal(mutations, 1);
    const entries = auditEntries(context);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.actor, 'agent/dispatcher-test');
    assert.equal(entries[0]?.tool, 'project.write');
    assert.deepEqual(entries[0]?.targets, ['notes/alpha.md']);
    assert.equal(entries[0]?.ok, true);
  });

  test('blocks a disallowed write before its handler can mutate', async () => {
    let mutations = 0;
    const operation = writeOperation('secret/alpha.md', async () => {
      mutations += 1;
      return { ok: true };
    });
    const dispatcher = createOperationDispatcher([operation], makeContext());

    await expectOperationError(
      () => dispatcher.invoke('project.write', { content: 'blocked' }),
      -32403,
      /outside allowed write paths/,
    );
    assert.equal(mutations, 0);
  });

  test('reports invalid params with OperationError semantics', async () => {
    const dispatcher = createOperationDispatcher(
      [readonlyOperation('project data')],
      makeContext(),
    );

    await expectOperationError(
      () => dispatcher.invoke('project.read', {}),
      -32602,
      /Missing required param: project/,
    );
  });

  test('reports unknown operations with method-not-found semantics', async () => {
    const dispatcher = createOperationDispatcher([], makeContext());

    await expectOperationError(
      () => dispatcher.invoke('missing.operation'),
      -32601,
      /Unknown operation: missing\.operation/,
    );
  });

  test('fails closed when a runtime mutating operation has no write policy', async () => {
    let mutations = 0;
    const ungoverned = {
      name: 'project.unsafe',
      namespace: 'project',
      description: 'Unsafe write',
      mutating: true,
      params: {},
      handler: async () => {
        mutations += 1;
        return { ok: true };
      },
    } as unknown as Operation;
    const dispatcher = createOperationDispatcher([ungoverned], makeContext());

    await expectOperationError(
      () => dispatcher.invoke('project.unsafe'),
      -32603,
      /missing an Operation Write Policy/,
    );
    assert.equal(mutations, 0);
  });
});
