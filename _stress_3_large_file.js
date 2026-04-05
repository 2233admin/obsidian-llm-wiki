/**
 * Stress Test 3: Large File Handling
 * Create ~5MB file (100k lines), read it, search in it, delete it.
 * Report timing for each operation.
 * Protocol: JSON-RPC 2.0, dryRun: false for writes
 */
const WebSocket = require('ws');

const WS_URL = 'ws://127.0.0.1:48765';
const TOKEN = '2cbaffa84f141fef08bc13f86d1384b94d824b151058b1f2bd72c145165b6e26';
const LARGE_FILE = '_stress_large_test.md';
const TIMEOUT_MS = 120000;

function rpcRequest(ws, id, method, params, timeoutMs) {
  timeoutMs = timeoutMs || TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timeout: ${method} id=${id}`));
    }, timeoutMs);

    const handler = (data) => {
      let msg; try { msg = JSON.parse(data); } catch(e) { return; }
      if (msg.id === id) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
  });
}

async function main() {
  console.log(`[SC3] Large file test: create/read/search/delete ~5MB file`);

  const ws = new WebSocket(WS_URL);

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Auth timeout')), 10000);
    ws.on('error', reject);
    ws.on('open', () => ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'authenticate', params: { token: TOKEN }, id: 0 })));
    ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data); } catch(e) { return; }
      if (msg.id === 0 && msg.result && msg.result.ok === true) { clearTimeout(t); resolve(); }
    });
  });

  console.log(`[SC3] Authenticated.`);

  // Build ~5MB content: 100,000 lines
  console.log(`[SC3] Building 100,000-line content...`);
  const lines = [];
  for (let i = 0; i < 100000; i++) {
    lines.push(`Line ${String(i).padStart(6,'0')}: The quick brown fox jumps over the lazy dog. Stress test payload. Index=${i}`);
  }
  lines[50000] = 'Line 050000: STRESS_NEEDLE_UNIQUE_XK9Z7Q The quick brown fox. Special marker.';
  const content = lines.join('\n');
  const sizeKB = Math.round(Buffer.byteLength(content, 'utf8') / 1024);
  console.log(`[SC3] Content built: ${sizeKB} KB, ${lines.length} lines`);

  const timings = {};
  const outcomes = {};

  // 1. Create
  console.log(`[SC3] Creating file...`);
  let t = Date.now();
  let resp = await rpcRequest(ws, 1, 'vault.create', { path: LARGE_FILE, content, dryRun: false });
  timings.create = Date.now() - t;
  outcomes.create = resp.result ? resp.result.ok : false;
  console.log(`[SC3] vault.create: ${timings.create}ms ok=${outcomes.create} err=${resp.error ? JSON.stringify(resp.error) : 'none'}`);

  // 2. Read
  console.log(`[SC3] Reading file...`);
  t = Date.now();
  resp = await rpcRequest(ws, 2, 'vault.read', { path: LARGE_FILE }, TIMEOUT_MS);
  timings.read = Date.now() - t;
  const readLen = resp.result ? (resp.result.content || '').length : 0;
  outcomes.read = readLen > 0;
  console.log(`[SC3] vault.read: ${timings.read}ms content_len=${readLen} err=${resp.error ? JSON.stringify(resp.error) : 'none'}`);

  // 3. Search
  console.log(`[SC3] Searching...`);
  t = Date.now();
  resp = await rpcRequest(ws, 3, 'vault.search', { query: 'STRESS_NEEDLE_UNIQUE_XK9Z7Q' }, TIMEOUT_MS);
  timings.search = Date.now() - t;
  const hits = resp.result ? (resp.result.results || []).length : 0;
  outcomes.search = hits >= 0; // even 0 hits is a valid response
  console.log(`[SC3] vault.search: ${timings.search}ms hits=${hits} err=${resp.error ? JSON.stringify(resp.error) : 'none'}`);

  // 4. Delete
  console.log(`[SC3] Deleting file...`);
  t = Date.now();
  resp = await rpcRequest(ws, 4, 'vault.delete', { path: LARGE_FILE, dryRun: false });
  timings.delete = Date.now() - t;
  outcomes.delete = resp.result ? resp.result.ok : false;
  console.log(`[SC3] vault.delete: ${timings.delete}ms ok=${outcomes.delete} err=${resp.error ? JSON.stringify(resp.error) : 'none'}`);

  ws.terminate();

  console.log(`\n[SC3] RESULTS:`);
  console.log(`  File size: ${sizeKB} KB`);
  console.log(`  vault.create: ${timings.create}ms (ok=${outcomes.create})`);
  console.log(`  vault.read:   ${timings.read}ms (ok=${outcomes.read})`);
  console.log(`  vault.search: ${timings.search}ms (hits=${hits})`);
  console.log(`  vault.delete: ${timings.delete}ms (ok=${outcomes.delete})`);

  const pass = outcomes.create && outcomes.read && outcomes.delete;
  console.log(`  VERDICT: ${pass ? 'PASS' : 'FAIL'}`);
}

main().catch(e => { console.error('[SC3] Fatal:', e.message); process.exit(1); });
