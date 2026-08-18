import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';

import { AdapterRegistry } from '../adapters/registry.js';
import { CompileTrigger } from '../compile-trigger.js';
import type { OperationContext } from '../core/types.js';
import {
  assertUniqueOperationNames,
  createApplicationRuntime,
  type ApplicationRuntime,
} from './runtime.js';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('ApplicationRuntime', () => {
  it('publishes one filtered OperationCatalog through the governed invocation path', async () => {
    const vaultPath = mkdtempSync(join(tmpdir(), 'llmwiki-application-runtime-'));
    roots.push(vaultPath);
    const registry = new AdapterRegistry();
    const compileTrigger = new CompileTrigger({
      vaultPath,
      compilerPath: vaultPath,
      python: 'python',
      autoCompile: false,
      schedulingMode: 'legacy-threshold',
    });
    const context: OperationContext = {
      vault: { execute: async () => ({}) },
      adapters: registry,
      config: { vault_path: vaultPath, adapters: [] },
      logger: { info() {}, warn() {}, error() {} },
      dryRun: false,
    };

    const runtime: ApplicationRuntime = createApplicationRuntime({
      compileTrigger,
      registry,
      python: 'python',
      compilerPath: vaultPath,
      vaultPath,
      settingsOptions: { vaultPath },
      context,
      operationFilter: (operation) =>
        operation.name === 'settings.definitions.list' || operation.name === 'compile.status',
    });

    assert.deepEqual(
      runtime.catalog.operations.map((operation) => operation.name),
      ['compile.status', 'settings.definitions.list'],
    );
    assert.deepEqual(
      runtime.catalog.describe().map((descriptor) => descriptor.name),
      ['compile.status', 'settings.definitions.list'],
    );
    assert.deepEqual(
      runtime.catalog.describe().map((descriptor) => descriptor.name),
      runtime.catalog.operations.map((operation) => operation.name),
    );
    assert.equal(
      new Set(runtime.catalog.operations.map((operation) => operation.name)).size,
      runtime.catalog.operations.length,
    );
    assert.equal(runtime.catalog.get('settings.definitions.list')?.namespace, 'settings');
    assert.equal(runtime.catalog.get('query.answer'), undefined);

    const definitions = await runtime.invoke('settings.definitions.list') as { definitions?: unknown[] };
    assert.ok(Array.isArray(definitions.definitions));
    await runtime.dispose();
  });

  it('fails composition when one Operation is registered twice', () => {
    const operation = {
      name: 'project.duplicate',
    } as never;
    assert.throws(
      () => assertUniqueOperationNames([operation, operation]),
      /Duplicate Operation registration: project\.duplicate/,
    );
  });

  it('keeps application composition host-neutral and the Obsidian host thin', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const runtimeSource = readFileSync(resolve(here, 'runtime.ts'), 'utf8');
    const hostSource = readFileSync(
      resolve(here, '../../../obsidian-plugin/src/production-control-plane-host.ts'),
      'utf8',
    );

    assert.doesNotMatch(runtimeSource, /@modelcontextprotocol\/sdk|from ['"]obsidian/);
    assert.match(hostSource, /createApplicationRuntime/);
    assert.doesNotMatch(
      hostSource,
      /make(?:All|Project|Settings|Agent|Problem|Usage|Visual|HostCapability)Ops/,
    );
  });
});
