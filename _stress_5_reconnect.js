/**
 * Stress Test 5: Reconnection Resilience
 * Connect, auth, send request, abruptly terminate (no clean close).
 * Immediately reconnect and auth again. Repeat 20 times.
 * Protocol: JSON-RPC 2.0
 */
const WebSocket = require('ws');

const WS_URL = 'ws://127.0.0.1:48765';
const TOKEN = '2cbaffa84f141fef08bc13f86d1384b94d824b151058b1f2bd72c145165b6e26';
const ITERATIONS = 20;
const TIMEOUT_MS = 10000;

function connectAuthSend() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch(e) {}
      reject(new Error('Timeout'));
    }, TIMEOUT_MS);

    const ws = new WebSocket(WS_URL);
    let phase = 'auth';

    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`WS error in ${phase}: ${e.message}`));
    });

    ws.on('open', () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'authenticate', params: { token: TOKEN }, id: 1 }));
    });

    ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data); } catch(e) { return; }

      if (phase === 'auth' && msg.id === 1) {
        if (msg.result && msg.result.ok === true) {
          phase = 'request';
          ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'vault.list', params: { path: '' }, id: 2 }));
        } else {
          clearTimeout(timer);
          try { ws.terminate(); } catch(e) {}
          reject(new Error(`Auth failed: ${JSON.stringify(msg.error)}`));
        }
      } else if (phase === 'request' && msg.id === 2) {
        phase = 'done';
        clearTimeout(timer);
        const ok = !msg.error && msg.result !== undefined;
        // Abrupt terminate — no clean WS close handshake
        ws.terminate();
        resolve({ ok, error: msg.error ? JSON.stringify(msg.error) : null });
      }
    });
  });
}

async function main() {
  console.log(`[SC5] Reconnection resilience: ${ITERATIONS} abrupt-terminate + reconnect cycles`);

  const results = [];
  const times = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = Date.now();
    try {
      const r = await connectAuthSend();
      const elapsed = Date.now() - t0;
      times.push(elapsed);
      results.push({ i, ok: r.ok, elapsed, error: r.error });
      process.stdout.write(`  [${String(i+1).padStart(2)}/${ITERATIONS}] ${elapsed}ms ok=${r.ok}\n`);
    } catch(e) {
      const elapsed = Date.now() - t0;
      results.push({ i, ok: false, elapsed, error: e.message });
      console.log(`  [${String(i+1).padStart(2)}/${ITERATIONS}] FAILED ${elapsed}ms: ${e.message}`);
    }
  }

  const successes = results.filter(r => r.ok).length;
  const failures  = results.filter(r => !r.ok).length;
  const avg = times.length ? times.reduce((a,b)=>a+b,0)/times.length : 0;
  const first10 = times.slice(0,10);
  const last10  = times.slice(10);
  const avgFirst = first10.length ? first10.reduce((a,b)=>a+b,0)/first10.length : 0;
  const avgLast  = last10.length  ? last10.reduce((a,b)=>a+b,0)/last10.length   : 0;
  const drift = avgLast - avgFirst;

  console.log(`\n[SC5] RESULTS:`);
  console.log(`  Iterations: ${ITERATIONS}`);
  console.log(`  Successes: ${successes}`);
  console.log(`  Failures:  ${failures}`);
  console.log(`  Avg round-trip: ${avg.toFixed(0)}ms`);
  console.log(`  Avg first 10:   ${avgFirst.toFixed(0)}ms`);
  console.log(`  Avg last 10:    ${avgLast.toFixed(0)}ms`);
  console.log(`  Time drift:     ${drift > 0 ? '+' : ''}${drift.toFixed(0)}ms (>500ms suggests leak)`);

  if (failures > 0) {
    results.filter(r => !r.ok).forEach(r => console.log(`    iter ${r.i}: ${r.error}`));
  }

  const pass = failures === 0 && drift < 500;
  console.log(`  VERDICT: ${pass ? 'PASS' : failures > 0 ? 'FAIL - connection failures' : 'WARN - significant time drift'}`);
}

main().catch(e => { console.error('[SC5] Fatal:', e.message); process.exit(1); });
