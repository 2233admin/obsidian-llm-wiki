/**
 * Stress Test 6: Interleaved Operations on Same File
 * 3 concurrent connections race on _stress_shared.md simultaneously:
 *   Client A: vault.create
 *   Client B: vault.modify (same file)
 *   Client C: vault.append (same file)
 * Protocol: JSON-RPC 2.0, dryRun: false
 */
const WebSocket = require('ws');

const WS_URL = 'ws://127.0.0.1:48765';
const TOKEN = '2cbaffa84f141fef08bc13f86d1384b94d824b151058b1f2bd72c145165b6e26';
const SHARED_FILE = '_stress_shared.md';
const TIMEOUT_MS = 15000;

function connectAndAuth(label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.terminate(); } catch(e) {} reject(new Error(`${label}: auth timeout`)); }, 10000);
    const ws = new WebSocket(WS_URL);
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    ws.on('open', () => ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'authenticate', params: { token: TOKEN }, id: 0 })));
    ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data); } catch(e) { return; }
      if (msg.id === 0 && msg.result && msg.result.ok === true) { clearTimeout(timer); resolve(ws); }
      else if (msg.id === 0 && msg.error) { clearTimeout(timer); ws.terminate(); reject(new Error(`${label}: ${JSON.stringify(msg.error)}`)); }
    });
  });
}

function rpcRequest(ws, id, method, params, timeoutMs) {
  timeoutMs = timeoutMs || TIMEOUT_MS;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      resolve({ id, timedOut: true, error: { message: 'timeout' } });
    }, timeoutMs);
    const handler = (data) => {
      let msg; try { msg = JSON.parse(data); } catch(e) { return; }
      if (msg.id === id) { clearTimeout(timer); ws.off('message', handler); resolve(msg); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
  });
}

async function main() {
  console.log(`[SC6] Interleaved ops: 3 clients racing on ${SHARED_FILE}`);

  // Pre-cleanup
  const pre = await connectAndAuth('pre');
  await rpcRequest(pre, 1, 'vault.delete', { path: SHARED_FILE, dryRun: false }, 5000);
  pre.terminate();

  const [wsA, wsB, wsC] = await Promise.all([
    connectAndAuth('clientA'),
    connectAndAuth('clientB'),
    connectAndAuth('clientC'),
  ]);
  console.log(`[SC6] All 3 clients connected. Launching concurrent ops...`);

  const t0 = Date.now();
  const [rA, rB, rC] = await Promise.all([
    rpcRequest(wsA, 1, 'vault.create', { path: SHARED_FILE, content: '# Shared\nCreated by A\n', dryRun: false }),
    rpcRequest(wsB, 1, 'vault.modify', { path: SHARED_FILE, content: '# Shared\nModified by B\n', dryRun: false }),
    rpcRequest(wsC, 1, 'vault.append', { path: SHARED_FILE, content: '\nAppended by C\n',          dryRun: false }),
  ]);
  const elapsed = Date.now() - t0;

  console.log(`[SC6] All ops completed in ${elapsed}ms`);

  function summarize(label, r) {
    const ok  = r.result && r.result.ok === true;
    const err = r.error  ? JSON.stringify(r.error) : (r.timedOut ? 'timeout' : 'none');
    console.log(`  ${label}: ok=${ok} error=${err}`);
    return ok;
  }
  const okA = summarize('Client A (create)', rA);
  const okB = summarize('Client B (modify)', rB);
  const okC = summarize('Client C (append)', rC);

  // Read final state
  const finalResp = await rpcRequest(wsA, 2, 'vault.read', { path: SHARED_FILE });
  const content = finalResp.result ? finalResp.result.content : null;

  console.log(`\n[SC6] Final file state:`);
  if (content !== null) {
    console.log(`  Length: ${content.length} chars`);
    console.log(`  Has A content: ${content.includes('Client A') || content.includes('Created by A')}`);
    console.log(`  Has B content: ${content.includes('Client B') || content.includes('Modified by B')}`);
    console.log(`  Has C content: ${content.includes('Client C') || content.includes('Appended by C')}`);
    console.log(`  Preview: ${JSON.stringify(content.slice(0, 150))}`);
  } else {
    console.log(`  File not found or unreadable. error=${finalResp.error ? JSON.stringify(finalResp.error) : 'none'}`);
  }

  // Post-cleanup
  await rpcRequest(wsA, 3, 'vault.delete', { path: SHARED_FILE, dryRun: false }, 5000);
  wsA.terminate(); wsB.terminate(); wsC.terminate();

  console.log(`\n[SC6] RESULTS:`);
  console.log(`  Ops succeeded: A=${okA} B=${okB} C=${okC}`);
  console.log(`  File readable after race: ${content !== null}`);
  console.log(`  At least one op succeeded: ${okA || okB || okC}`);

  // Pass = no crash, file ends in a coherent readable state
  const pass = (okA || okB || okC) && content !== null;
  console.log(`  VERDICT: ${pass ? 'PASS' : 'FAIL - no ops succeeded or file unreadable'}`);
}

main().catch(e => { console.error('[SC6] Fatal:', e.message); process.exit(1); });
