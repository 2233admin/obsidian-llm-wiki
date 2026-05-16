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
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
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
  // loadConfig() precedence is env > ./vault-mind.yaml > ../vault-mind.yaml,
  // so setting VAULT_MIND_VAULT_PATH below is sufficient -- no yaml drop
  // required. Default adapter list is fine post pglite-externalize fix.
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

test('tools/list includes query.vector (pgvector semantic search)', async () => {
  const res = await client.listTools();
  const names = new Set(res.tools.map((t) => t.name));
  assert.ok(names.has('query.vector'), 'query.vector tool must be registered');
});

test('tools/list includes query.semantic (text -> embed -> vector search)', async () => {
  const res = await client.listTools();
  const names = new Set(res.tools.map((t) => t.name));
  assert.ok(names.has('query.semantic'), 'query.semantic tool must be registered');
});

test('tools/call query.semantic rejects empty query string', async () => {
  const res = await client.callTool({
    name: 'query.semantic',
    arguments: { query: '' },
  });
  assert.ok(res.isError, 'empty query must produce an error response');
});

test('tools/call query.vector rejects empty vector with -32602', async () => {
  const res = await client.callTool({
    name: 'query.vector',
    arguments: { vector: [] },
  });
  // Server should reject; SDK surfaces JSON-RPC errors via isError=true.
  assert.ok(res.isError, 'empty vector must produce an error response');
});

test('tools/call query.vector rejects non-numeric vector', async () => {
  const res = await client.callTool({
    name: 'query.vector',
    arguments: { vector: [1, 2, 'three' as unknown as number] },
  });
  assert.ok(res.isError, 'non-numeric vector must produce an error response');
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
  // VAULT_MIND_VAULT_PATH env is authoritative (loadConfig precedence:
  // env > ./yaml > ../yaml), and the server uses its default adapter list
  // which includes vaultbrain.
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

test('collaboration policy enforces actor write boundaries and audits writes', async () => {
  const policyRoot = join(tmpdir(), `obsidian-llm-wiki-policy-${randomUUID()}`);
  mkdirSync(join(policyRoot, '00-Inbox', 'AI-Output', 'codex'), { recursive: true });
  mkdirSync(join(policyRoot, '00-Inbox', 'AI-Output', 'claude'), { recursive: true });
  mkdirSync(join(policyRoot, '30-Architecture'), { recursive: true });
  writeFileSync(
    join(policyRoot, '.vault-collab.json'),
    JSON.stringify({ agents: ['codex', 'claude'], protected_paths: ['30-Architecture/**'] }),
    'utf-8',
  );
  const policyTransport = new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE_PATH],
    cwd: policyRoot,
    env: {
      ...process.env,
      VAULT_MIND_VAULT_PATH: policyRoot,
      VAULT_MIND_ADAPTERS: 'filesystem',
      VAULT_MIND_ACTOR: 'codex',
      VAULT_MIND_ROLE: 'agent',
    },
    stderr: 'pipe',
  });
  const policyClient = new Client(
    { name: 'smoke-test-policy', version: '0.0.1' },
    { capabilities: {} },
  );
  try {
    await policyClient.connect(policyTransport);
    const allowed = await policyClient.callTool({
      name: 'vault.create',
      arguments: { path: '00-Inbox/AI-Output/codex/ok.md', content: 'ok', dryRun: false },
    });
    assert.ok(!allowed.isError, `own actor path should be allowed: ${JSON.stringify(allowed.content)}`);

    const otherAgent = await policyClient.callTool({
      name: 'vault.create',
      arguments: { path: '00-Inbox/AI-Output/claude/no.md', content: 'no', dryRun: false },
    });
    assert.ok(otherAgent.isError, 'writing another agent namespace must be blocked');

    const batch = await policyClient.callTool({
      name: 'vault.batch',
      arguments: {
        dryRun: false,
        operations: [{ method: 'vault.create', params: { path: '30-Architecture/batch-hole.md', content: 'no' } }],
      },
    });
    assert.ok(batch.isError, 'batch must not bypass collaboration policy');

    const auditDir = join(policyRoot, '.wiki-audit');
    assert.ok(existsSync(auditDir), 'successful real write must create audit directory');
    const auditFiles = readdirSync(auditDir).filter((f) => f.endsWith('.jsonl'));
    assert.ok(auditFiles.length > 0, 'audit jsonl file must be present');
    const auditBody = readFileSync(join(auditDir, auditFiles[0]), 'utf-8');
    assert.ok(auditBody.includes('"actor":"codex"'), 'audit log records actor');
    assert.ok(auditBody.includes('00-Inbox/AI-Output/codex/ok.md'), 'audit log records target path');
  } finally {
    try { await policyClient.close(); } catch { /* best effort */ }
    try { await policyTransport.close(); } catch { /* best effort */ }
    rmSync(policyRoot, { recursive: true, force: true });
  }
});

test('collaboration policy rejects malformed policy JSON objects', async () => {
  const badPolicyRoot = join(tmpdir(), `obsidian-llm-wiki-bad-policy-${randomUUID()}`);
  mkdirSync(join(badPolicyRoot, '00-Inbox', 'AI-Output', 'codex'), { recursive: true });
  writeFileSync(join(badPolicyRoot, '.vault-collab.json'), 'null', 'utf-8');
  const badPolicyTransport = new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE_PATH],
    cwd: badPolicyRoot,
    env: {
      ...process.env,
      VAULT_MIND_VAULT_PATH: badPolicyRoot,
      VAULT_MIND_ADAPTERS: 'filesystem',
      VAULT_MIND_ACTOR: 'codex',
      VAULT_MIND_ROLE: 'agent',
    },
    stderr: 'pipe',
  });
  const badPolicyClient = new Client(
    { name: 'smoke-test-bad-policy', version: '0.0.1' },
    { capabilities: {} },
  );
  try {
    await badPolicyClient.connect(badPolicyTransport);
    const res = await badPolicyClient.callTool({
      name: 'vault.create',
      arguments: { path: '00-Inbox/AI-Output/codex/no.md', content: 'no', dryRun: false },
    });
    assert.ok(res.isError, 'non-object policy JSON must reject real writes');
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? '';
    assert.ok(text.includes('expected a JSON object'), `unexpected error: ${text}`);
  } finally {
    try { await badPolicyClient.close(); } catch { /* best effort */ }
    try { await badPolicyTransport.close(); } catch { /* best effort */ }
    rmSync(badPolicyRoot, { recursive: true, force: true });
  }
});
