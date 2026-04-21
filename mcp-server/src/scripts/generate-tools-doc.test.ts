// Drift guard: the on-disk docs/mcp-tools-reference.md must equal what
// the generator produces right now. If this test fails, run
// `npm run generate-tools-doc` and commit the result.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { generate } from './generate-tools-doc.js';

test('generate-tools-doc: on-disk doc matches generator output', () => {
  const { path, content: expected } = generate();
  const onDisk = readFileSync(path, 'utf8');
  assert.equal(
    onDisk,
    expected,
    `docs/mcp-tools-reference.md is stale. Run: npm run generate-tools-doc`,
  );
});

test('generate-tools-doc: emits all namespaces found in operations', () => {
  const { content } = generate();
  for (const ns of ['vault', 'query', 'compile', 'recipe', 'agent']) {
    assert.match(content, new RegExp(`## \`${ns}\\.\\*\``), `missing namespace header for ${ns}`);
  }
});
