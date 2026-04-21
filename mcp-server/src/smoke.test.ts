/**
 * End-to-end MCP JSON-RPC smoke test.
 *
 * Spawns the built stdio server as a child process and speaks real MCP
 * protocol to it via the SDK client. Validates:
 *   1. `initialize` succeeds (handshake completes).
 *   2. `tools/list` returns a non-empty tool set including the core vault
 *      operations (`vault.list`, `vault.read`, `vault.exists`).
 *   3. `tools/call` round-trips: `vault.list` on a seeded temp vault
 *      reports the seeded note.
 *
 * Carry-forward from Step 1 (deferred three sessions). This covers the
 * surface that pure unit tests can't: the stdio framing, the Server SDK
 * glue, the tool-name bridge, and the config loader reading
 * VAULT_MIND_VAULT_PATH from env.
 *
 * Uses the already-built bundle.js (npm run rebuild) so this test runs
 * the exact artifact shipped in the package.
 */

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// This file compiles to mcp-server/dist/smoke.test.js, so bundle.js is one level up.
const BUNDLE_PATH = resolve(__dirname, '..', 'bundle.js');

let vaultRoot: string;
let client: Client;
let transport: StdioClientTransport;

before(async () => {
  if (!existsSync(BUNDLE_PATH)) {
    throw new Error(
      `smoke test: bundle.js missing at ${BUNDLE_PATH}. Run "npm run rebuild" first.`,
    );
  }

  vaultRoot = join(tmpdir(), `obsidian-llm-wiki-smoke-${randomUUID()}`);
  mkdirSync(vaultRoot, { recursive: true });
  writeFileSync(
    join(vaultRoot, 'hello.md'),
    '---\ntitle: Hello\n---\n\nsmoke test seed note.\n',
    'utf-8',
  );
  // Drop a minimal vault-mind.yaml that loadConfig() picks up as its
  // first candidate when cwd=vaultRoot. Without it, a dev-workspace
  // yaml above mcp-server/ can capture precedence and redirect the
  // server to the real vault. Default adapter list is fine post
  // pglite-externalize fix.
  writeFileSync(
    join(vaultRoot, 'vault-mind.yaml'),
    `vault_path: "${vaultRoot.replace(/\\/g, '/')}"\n`,
    'utf-8',
  );

  // Spawn with cwd=vaultRoot so loadConfig()'s yaml-file probes
  // (`./vault-mind.yaml`, `../vault-mind.yaml`) miss and the
  // VAULT_MIND_VAULT_PATH env fallback is used. Otherwise a
  // dev-workspace vault-mind.yaml above mcp-server/ would capture
  // precedence and redirect the test to the real vault.
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE_PATH],
    cwd: vaultRoot,
    env: { ...process.env, VAULT_MIND_VAULT_PATH: vaultRoot },
    stderr: 'pipe',
  });

  client = new Client(
    { name: 'smoke-test', version: '0.0.1' },
    { capabilities: {} },
  );

  await client.connect(transport);
});

after(async () => {
  try { await client?.close(); } catch { /* best effort */ }
  try { await transport?.close(); } catch { /* best effort */ }
  if (vaultRoot && existsSync(vaultRoot)) {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});

test('tools/list returns the core vault operations', async () => {
  const res = await client.listTools();
  assert.ok(Array.isArray(res.tools), 'tools array present');
  assert.ok(res.tools.length > 0, 'at least one tool registered');
  const names = new Set(res.tools.map((t) => t.name));
  for (const required of ['vault.list', 'vault.read', 'vault.exists']) {
    assert.ok(names.has(required), `missing required tool: ${required}`);
  }
});

test('tools/call vault.list round-trips the seeded note', async () => {
  const res = await client.callTool({
    name: 'vault.list',
    arguments: { path: '' },
  });
  assert.ok(!res.isError, `vault.list returned an error: ${JSON.stringify(res.content)}`);
  const content = res.content as Array<{ type: string; text: string }>;
  assert.ok(content.length > 0, 'content array populated');
  const payload = JSON.parse(content[0].text);
  // vault.list returns `{ files: string[]; folders: string[] }` (see
  // FsTransport). Keep the assertion tolerant -- accept top-level array
  // or any of files/entries/items -- so a future shape change still
  // exercises the round-trip without a brittle schema lock.
  const buckets: unknown[] = Array.isArray(payload)
    ? payload
    : [payload.files, payload.folders, payload.entries, payload.items].filter(Array.isArray);
  const flat = JSON.stringify(buckets);
  assert.ok(flat.includes('hello.md'), `seed note missing from listing: ${JSON.stringify(payload)}`);
});

test('tools/call vault.exists agrees with vault.list on the seed', async () => {
  const res = await client.callTool({
    name: 'vault.exists',
    arguments: { path: 'hello.md' },
  });
  assert.ok(!res.isError, `vault.exists errored: ${JSON.stringify(res.content)}`);
  const payload = JSON.parse((res.content as Array<{ text: string }>)[0].text);
  // Accept either boolean or { exists: true }.
  const exists = typeof payload === 'boolean' ? payload : Boolean(payload?.exists);
  assert.equal(exists, true, 'seed note should exist');
});

// Regression guard for the bundled pglite/vector path bug. Spawns a
// SECOND server with the default adapter list (which includes
// vaultbrain) and verifies it boots without crashing. Pre-fix this
// threw "Extension bundle not found: .../vector.tar.gz" at startup.
test('server boots with vaultbrain enabled (pglite extension path regression guard)', async () => {
  const vbRoot = join(tmpdir(), `obsidian-llm-wiki-smoke-vb-${randomUUID()}`);
  mkdirSync(vbRoot, { recursive: true });
  writeFileSync(join(vbRoot, 'seed.md'), '# seed\n', 'utf-8');
  // No yaml: loadConfig falls back to VAULT_MIND_VAULT_PATH env, then
  // the server uses its default adapter list which includes vaultbrain.
  const vbTransport = new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE_PATH],
    cwd: vbRoot,
    env: { ...process.env, VAULT_MIND_VAULT_PATH: vbRoot },
    stderr: 'pipe',
  });
  const vbClient = new Client(
    { name: 'smoke-test-vb', version: '0.0.1' },
    { capabilities: {} },
  );
  try {
    await vbClient.connect(vbTransport);
    const res = await vbClient.listTools();
    assert.ok(res.tools.length > 0, 'server with vaultbrain enabled must still register tools');
  } finally {
    try { await vbClient.close(); } catch { /* best effort */ }
    try { await vbTransport.close(); } catch { /* best effort */ }
    rmSync(vbRoot, { recursive: true, force: true });
  }
});
