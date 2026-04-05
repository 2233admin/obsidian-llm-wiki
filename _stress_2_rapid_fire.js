/**
 * Stress Test 2: Rapid Fire on Single Connection
 * Send 500 vault.read requests without waiting for responses.
 * Count responses, check for drops or errors.
 * Protocol: JSON-RPC 2.0
 */
const WebSocket = require('ws');

const WS_URL = 'ws://127.0.0.1:48765';
const TOKEN = '2cbaffa84f141fef08bc13f86d1384b94d824b151058b1f2bd72c145165b6e26';
const NUM_REQUESTS = 500;
const TARGET_FILE = 'Welcome.md';
const TIMEOUT_MS = 60000;

async function main() {
  console.log(`[SC2] Rapid fire: ${NUM_REQUESTS} vault.read requests on single connection`);

  const ws = new WebSocket(WS_URL);

  await new Promise((resolve, reject) => {
    const authTimer = setTimeout(() => reject(new Error('Auth timeout')), 10000);
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'authenticate', params: { token: TOKEN }, id: 0 }));
    });
    ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data); } catch(e) { return; }
      if (msg.id === 0 && msg.result && msg.result.ok === true) {
        clearTimeout(authTimer);
        resolve();
      }
    });
  });

  console.log(`[SC2] Authenticated. Firing ${NUM_REQUESTS} requests...`);

  const pending = new Map();
  let received = 0;
  let errors = 0;
  let unknownIds = 0;
  let finished = false;

  const allDone = new Promise((resolve) => {
    const globalTimer = setTimeout(() => {
      console.log(`[SC2] Global timeout. received=${received}/${NUM_REQUESTS}`);
      resolve('timeout');
    }, TIMEOUT_MS);

    ws.on('message', (data) => {
      if (finished) return;
      let msg; try { msg = JSON.parse(data); } catch(e) { return; }

      if (msg.id !== undefined && msg.id !== 0) {
        if (pending.has(msg.id)) {
          pending.delete(msg.id);
          received++;
          if (msg.error) errors++;
        } else {
          unknownIds++;
        }

        if (received + unknownIds === NUM_REQUESTS) {
          finished = true;
          clearTimeout(globalTimer);
          resolve('done');
        }
      }
    });
  });

  const t0 = Date.now();

  // Fire all without awaiting responses
  for (let i = 1; i <= NUM_REQUESTS; i++) {
    pending.set(i, true);
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'vault.read',
      params: { path: TARGET_FILE },
      id: i
    }));
  }

  const sentAt = Date.now() - t0;
  console.log(`[SC2] All ${NUM_REQUESTS} requests sent in ${sentAt}ms. Waiting...`);

  const reason = await allDone;
  const elapsed = Date.now() - t0;

  ws.terminate();

  const dropped = NUM_REQUESTS - received;
  console.log(`\n[SC2] RESULTS:`);
  console.log(`  Requests sent: ${NUM_REQUESTS}`);
  console.log(`  Responses received: ${received}`);
  console.log(`  Dropped (no response): ${dropped}`);
  console.log(`  Error responses: ${errors}`);
  console.log(`  Unknown IDs: ${unknownIds}`);
  console.log(`  Still pending: ${pending.size}`);
  console.log(`  End reason: ${reason}`);
  console.log(`  Total elapsed: ${elapsed}ms`);
  console.log(`  Throughput: ${(received / elapsed * 1000).toFixed(1)} resp/s`);

  const pass = received === NUM_REQUESTS && dropped === 0 && errors === 0;
  console.log(`  VERDICT: ${pass ? 'PASS' : dropped > 0 ? 'FAIL - dropped responses' : 'FAIL - errors present'}`);
}

main().catch(e => { console.error('[SC2] Fatal:', e.message); process.exit(1); });
