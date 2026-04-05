/**
 * Stress Test 1: Connection Storm
 * Open 20 connections, authenticate all, each send 10 requests simultaneously.
 * Verify no mixed-up responses between connections.
 * Protocol: JSON-RPC 2.0
 */
const WebSocket = require('ws');

const WS_URL = 'ws://127.0.0.1:48765';
const TOKEN = '2cbaffa84f141fef08bc13f86d1384b94d824b151058b1f2bd72c145165b6e26';
const NUM_CONNECTIONS = 20;
const REQUESTS_PER_CONN = 10;
const TIMEOUT_MS = 30000;

function connectAndAuth(connIndex) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { ws.terminate(); } catch(e) {}
      reject(new Error(`Conn ${connIndex}: timeout during auth`));
    }, TIMEOUT_MS);

    const ws = new WebSocket(WS_URL);
    let seq = 0;

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Conn ${connIndex}: WS error ${err.message}`));
    });

    ws.on('open', () => {
      seq++;
      ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'authenticate', params: { token: TOKEN }, id: seq }));
    });

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch(e) { return; }
      if (msg.id === seq && msg.result) {
        if (msg.result.ok === true) {
          clearTimeout(timer);
          resolve({ ws, seq });
        } else {
          clearTimeout(timer);
          try { ws.terminate(); } catch(e) {}
          reject(new Error(`Conn ${connIndex}: auth failed: ${JSON.stringify(msg)}`));
        }
      }
    });
  });
}

function sendRequests(ws, startSeq, connIndex) {
  return new Promise((resolve) => {
    const pending = new Map();
    const results = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve({
          connIndex,
          sent: REQUESTS_PER_CONN,
          received: results.length,
          pending: pending.size,
          errors: results.filter(r => r.error).length,
          timedOut: true
        });
      }
    }, TIMEOUT_MS);

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch(e) { return; }

      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.delete(msg.id);
        results.push({
          id: msg.id,
          ok: !msg.error,
          error: msg.error ? JSON.stringify(msg.error) : null
        });

        if (results.length === REQUESTS_PER_CONN && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve({
            connIndex,
            sent: REQUESTS_PER_CONN,
            received: results.length,
            pending: pending.size,
            errors: results.filter(r => r.error).length,
            timedOut: false
          });
        }
      }
    });

    // Send all requests without waiting
    for (let i = 0; i < REQUESTS_PER_CONN; i++) {
      const id = startSeq + i + 1;
      pending.set(id, connIndex);
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'vault.list',
        params: { path: '' },
        id
      }));
    }
  });
}

async function main() {
  console.log(`[SC1] Opening ${NUM_CONNECTIONS} connections...`);
  const t0 = Date.now();

  const connPromises = [];
  for (let i = 0; i < NUM_CONNECTIONS; i++) {
    connPromises.push(connectAndAuth(i));
  }

  let connections;
  try {
    connections = await Promise.all(connPromises);
    console.log(`[SC1] All ${NUM_CONNECTIONS} connections authenticated in ${Date.now()-t0}ms`);
  } catch(e) {
    console.error(`[SC1] Connection phase FAILED: ${e.message}`);
    process.exit(1);
  }

  const t1 = Date.now();
  const allResults = await Promise.all(
    connections.map(({ ws, seq }, i) => sendRequests(ws, seq, i))
  );
  const elapsed = Date.now() - t1;

  connections.forEach(({ ws }) => { try { ws.terminate(); } catch(e) {} });

  const totalSent     = allResults.reduce((s, r) => s + r.sent, 0);
  const totalReceived = allResults.reduce((s, r) => s + r.received, 0);
  const totalErrors   = allResults.reduce((s, r) => s + r.errors, 0);
  const timedOut      = allResults.filter(r => r.timedOut).length;

  console.log(`\n[SC1] RESULTS:`);
  console.log(`  Connections: ${NUM_CONNECTIONS}`);
  console.log(`  Total requests sent: ${totalSent}`);
  console.log(`  Total responses received: ${totalReceived}`);
  console.log(`  Dropped (no response): ${totalSent - totalReceived}`);
  console.log(`  Error responses: ${totalErrors}`);
  console.log(`  Timed-out connections: ${timedOut}`);
  console.log(`  Elapsed (request phase): ${elapsed}ms`);

  allResults.forEach(r => {
    if (r.received !== r.sent || r.timedOut) {
      console.log(`    Conn ${r.connIndex}: sent=${r.sent} recv=${r.received} errors=${r.errors} timeout=${r.timedOut}`);
    }
  });

  const pass = totalReceived === totalSent && timedOut === 0 && totalErrors === 0;
  console.log(`  VERDICT: ${pass ? 'PASS' : 'FAIL'}`);
}

main().catch(e => { console.error('[SC1] Fatal:', e); process.exit(1); });
