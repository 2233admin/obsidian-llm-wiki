#!/usr/bin/env node
// Boot an assembled plugin (dist/plugin or a `plugin` branch checkout) the way a
// host does, against a throwaway vault, and fail on anything a new user would hit.
// Usage: node scripts/smoke-plugin.mjs [pluginDir]

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const pluginDir = resolve(process.argv[2] ?? join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'plugin'));
const vault = mkdtempSync(join(tmpdir(), 'llmwiki-smoke-'));
writeFileSync(join(vault, 'attention.md'), '# Attention\n\nAttention heads route information between tokens.\n');

const child = spawn(process.execPath, [join(pluginDir, 'mcp-server', 'bundle.js')], {
  cwd: tmpdir(),
  env: { ...process.env, VAULT_MIND_VAULT_PATH: vault },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (chunk) => (stderr += chunk));

const pending = new Map();
createInterface({ input: child.stdout }).on('line', (line) => {
  const msg = JSON.parse(line);
  pending.get(msg.id)?.(msg);
});
let nextId = 1;
function request(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`${method} timed out\n${stderr}`)), 60_000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) fail(new Error(`${method}: ${JSON.stringify(msg.error)}`));
      else done(msg.result);
    });
  });
}
const callTool = async (name, args) => JSON.parse((await request('tools/call', { name, arguments: args })).content[0].text);

function check(ok, message) {
  if (!ok) throw new Error(`${message}\n--- server stderr ---\n${stderr}`);
}

try {
  const init = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'smoke-plugin', version: '0' },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  check(init.serverInfo?.name === 'obsidian-llm-wiki', `unexpected serverInfo ${JSON.stringify(init.serverInfo)}`);

  const search = await callTool('vault.search', { query: 'attention' });
  check(search.results?.some((r) => r.path === 'attention.md'), 'vault.search did not find the fixture note');

  const recall = await callTool('context.recall', { query: 'attention heads' });
  check(JSON.stringify(recall).includes('attention.md'), 'context.recall did not cite the fixture note');

  // Recall needs pglite and pglite-pgvector from the plugin's node_modules.
  check(!/\[vaultbrain\] init failed/.test(stderr), 'vaultbrain (recall index) failed to start');

  console.log(`smoke ok: ${pluginDir}`);
} finally {
  child.kill();
  rmSync(vault, { recursive: true, force: true });
}
