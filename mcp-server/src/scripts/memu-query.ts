#!/usr/bin/env node
// memu-query -- CLI wrapper around the llm-wiki MCP server's query.unified tool.
//
// Survives MCP client restarts / stale tool caches by speaking JSON-RPC directly
// to bundle.js over stdio. Same transport Claude Code uses, minus the client.
//
// Usage:
//   memu-query <query> [--max N] [--source memu|all] [--json|--pretty] [--debug]
//
// Env:
//   VAULT_MIND_VAULT_PATH  vault root (forwarded to bundle.js); required.
//   MEMU_DSN               PG DSN; adapter default is postgres:postgres@localhost:5432/memu.
//   MEMU_USER_ID           user_id scope; adapter default "boris".

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

type Args = { query: string; max: number; source: 'memu' | 'all'; json: boolean; debug: boolean };

function parseArgs(argv: string[]): Args {
  const out: Args = { query: '', max: 10, source: 'all', json: false, debug: false };
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max') out.max = Math.max(1, Math.min(100, parseInt(argv[++i], 10) || 10));
    else if (a === '--source') {
      const v = argv[++i];
      if (v !== 'memu' && v !== 'all') throw new Error(`--source must be memu|all, got: ${v}`);
      out.source = v;
    } else if (a === '--json') out.json = true;
    else if (a === '--pretty') out.json = false;
    else if (a === '--debug') out.debug = true;
    else if (a === '-h' || a === '--help') {
      console.log('Usage: memu-query <query> [--max N] [--source memu|all] [--json|--pretty] [--debug]');
      process.exit(0);
    } else if (a.startsWith('--')) throw new Error(`unknown flag: ${a}`);
    else pos.push(a);
  }
  if (pos.length === 0) throw new Error('query required (see --help)');
  out.query = pos.join(' ');
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const _thisDir = dirname(fileURLToPath(import.meta.url));
  // dist/scripts/ -> dist/ -> mcp-server/
  const bundlePath = join(_thisDir, '..', '..', 'bundle.js');

  const child = spawn('node', [bundlePath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  let stdoutBuf = '';
  let done = false;
  const kill = (code: number): void => { if (!done) { done = true; child.kill(); process.exit(code); } };

  child.stderr.on('data', (c) => { if (args.debug) process.stderr.write(`[srv] ${c}`); });
  child.on('exit', (code) => { if (!done) { process.stderr.write(`bundle exited ${code}\n`); process.exit(1); } });

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuf += chunk.toString('utf-8');
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg: { id?: number; result?: { content?: Array<{ text: string }> }; error?: { message?: string } };
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id === 2) {
        if (msg.error) { process.stderr.write(`query.unified error: ${msg.error.message}\n`); kill(1); return; }
        const text = msg.result?.content?.[0]?.text ?? '';
        let body: { results?: Array<{ source: string; path: string; content: string; score: number; metadata?: Record<string, unknown> }> };
        try { body = JSON.parse(text); } catch { body = { results: [] }; }
        const results = (body.results ?? []).filter((r) => args.source === 'all' || r.source === args.source);
        if (args.json) {
          process.stdout.write(JSON.stringify({ query: args.query, count: results.length, results }, null, 2) + '\n');
        } else {
          process.stdout.write(`query: ${args.query}  (${results.length} result${results.length === 1 ? '' : 's'})\n\n`);
          for (const r of results) {
            const preview = (r.content ?? '').replace(/\s+/g, ' ').slice(0, 240);
            process.stdout.write(`[${r.source}] ${r.path}\n  ${preview}\n\n`);
          }
        }
        kill(results.length === 0 ? 2 : 0);
      }
    }
  });

  const send = (obj: unknown): void => { child.stdin.write(JSON.stringify(obj) + '\n'); };
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'memu-query', version: '0.1.0' } } });
  setTimeout(() => {
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'query.unified', arguments: { query: args.query, maxResults: args.max } } });
  }, 300);

  setTimeout(() => { process.stderr.write('timeout (10s) waiting for bundle response\n'); kill(3); }, 10_000);
}

main().catch((e) => { process.stderr.write(`memu-query: ${(e as Error).message}\n`); process.exit(1); });
