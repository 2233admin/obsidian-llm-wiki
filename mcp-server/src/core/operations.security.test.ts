import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { AdapterRegistry } from '../adapters/registry.js';
import { makeAllOperations } from './operations.js';

test('multimodal.ingest emits JSON-compatible YAML scalars for backslashes and quotes', async (t) => {
  const vault = mkdtempSync(join(tmpdir(), 'multimodal-yaml-security-'));
  t.after(() => rmSync(vault, { recursive: true, force: true }));
  writeFileSync(join(vault, 'input.pdf'), 'fixture', 'utf8');

  const registry = new AdapterRegistry();
  registry.register({
    name: 'raganything',
    capabilities: ['search'],
    isAvailable: true,
    async init() {},
    async search() { return []; },
    async processDocument() {
      return { markdown: '# Parsed', metadata: {} };
    },
  } as never);

  const operation = makeAllOperations({
    compileTrigger: {} as never,
    registry,
    python: 'python',
    compilerPath: vault,
    vaultPath: vault,
    settingsService: {} as never,
  }).find((candidate) => candidate.name === 'multimodal.ingest');
  assert.ok(operation);

  await operation.handler({} as never, {
    path: 'input.pdf',
    outputPath: '00-Inbox/Multimodal/output.md',
    parser: 'custom\\name"quoted',
    dryRun: false,
  });

  const content = readFileSync(join(vault, '00-Inbox/Multimodal/output.md'), 'utf8');
  assert.ok(content.includes('parser: "custom\\\\name\\"quoted"'));
});
