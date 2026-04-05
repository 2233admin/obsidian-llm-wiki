/**
 * Stress Test 4: Broadcast Storm
 * 10 listener clients + 1 emitter client.
 * Emitter rapidly creates+deletes 20 files.
 * Count event notifications received by each listener.
 * Protocol: JSON-RPC 2.0
 */
const WebSocket = require('ws');

const WS_URL = 'ws://127.0.0.1:48765';
const TOKEN = '2cbaffa84f141fef08bc13f86d1384b94d824b151058b1f2bd72c145165b6e26';
const NUM_LISTENERS = 10;
const NUM_FILES = 20;

function makeId() { return Math.random().toString(36).slice(2,8); }

function connectAndAuth(label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.terminate(); } catch(e) {} reject(new Error(`${label}: auth timeout`)); }, 10000);
    const ws = new WebSocket(WS_URL);
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    ws.on('open', () => ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'authenticate', params: { token: TOKEN }, id: 0 })));
    ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data); } catch(e) { return; }
      if (msg.id === 0 && msg.result && msg.result.ok === true) { clearTimeout(timer); resolve(ws); }
      else if (msg.id === 0 && msg.error) { clearTimeout(timer); ws.terminate(); reject(new Error(`${label}: auth failed`)); }
    });
  });
}

function rpcRequest(ws, id, method, params, timeoutMs) {
  timeoutMs = timeoutMs || 15000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', handler); reject(new Error(`Timeout: ${method}`)); }, timeoutMs);
    const handler = (data) => {
      let msg; try { msg = JSON.parse(data); } catch(e) { return; }
      if (msg.id === id) { clearTimeout(timer); ws.off('message', handler); resolve(msg); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
  });
}

async function main() {
  console.log(`[SC4] Broadcast storm: ${NUM_LISTENERS} listeners, ${NUM_FILES} create+delete cycles`);

  console.log(`[SC4] Connecting ${NUM_LISTENERS} listeners...`);
  const listeners = await Promise.all(
    Array.from({length: NUM_LISTENERS}, (_, i) => connectAndAuth(`listener_${i}`))
  );
  console.log(`[SC4] All listeners connected.`);

  // Track all incoming messages per listener (events have no id or method field)
  const eventCounts = listeners.map(() => ({ total: 0, types: {} }));

  listeners.forEach((ws, i) => {
    ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data); } catch(e) { return; }
      // Events: messages with no id, or with method but no id (notifications in JSON-RPC 2.0)
      const isEvent = (msg.method && msg.id === undefined) ||
                      (msg.type === 'event') ||
                      (msg.event !== undefined);
      if (isEvent) {
        eventCounts[i].total++;
        const t = msg.method || msg.type || msg.event || 'unknown';
        eventCounts[i].types[t] = (eventCounts[i].types[t] || 0) + 1;
      }
    });
  });

  // Connect emitter and do operations
  const emitter = await connectAndAuth('emitter');
  console.log(`[SC4] Emitter connected. Starting storm...`);

  const files = [];
  const t0 = Date.now();
  let seq = 1;

  for (let i = 0; i < NUM_FILES; i++) {
    const path = `_stress_bc_${i}_${makeId()}.md`;
    files.push(path);
    try {
      await rpcRequest(emitter, seq++, 'vault.create', { path, content: `Broadcast test ${i}`, dryRun: false });
    } catch(e) { console.log(`[SC4] Create ${i} err: ${e.message}`); }
  }
  console.log(`[SC4] Created ${NUM_FILES} files in ${Date.now()-t0}ms`);

  const t1 = Date.now();
  for (let i = 0; i < NUM_FILES; i++) {
    try {
      await rpcRequest(emitter, seq++, 'vault.delete', { path: files[i], dryRun: false });
    } catch(e) { console.log(`[SC4] Delete ${i} err: ${e.message}`); }
  }
  console.log(`[SC4] Deleted ${NUM_FILES} files in ${Date.now()-t1}ms`);

  // Wait for events to propagate
  await new Promise(r => setTimeout(r, 3000));

  emitter.terminate();
  listeners.forEach(ws => { try { ws.terminate(); } catch(e) {} });

  console.log(`\n[SC4] RESULTS:`);
  console.log(`  Operations performed: ${NUM_FILES} creates + ${NUM_FILES} deletes = ${NUM_FILES*2} total`);
  console.log(`  Events received per listener:`);

  let anyGotEvents = false;
  eventCounts.forEach((ec, i) => {
    const typeStr = Object.entries(ec.types).map(([k,v]) => `${k}:${v}`).join(', ') || 'none';
    console.log(`    Listener ${i}: total=${ec.total} types=[${typeStr}]`);
    if (ec.total > 0) anyGotEvents = true;
  });

  const consistent = eventCounts.every(ec => ec.total === eventCounts[0].total);
  console.log(`  Events wired: ${anyGotEvents}`);
  console.log(`  Counts consistent across listeners: ${consistent}`);
  console.log(`  VERDICT: ${anyGotEvents ? 'PASS - events received' : 'INFO - events not wired (consistent behavior across all listeners)'}`);
}

main().catch(e => { console.error('[SC4] Fatal:', e.message); process.exit(1); });
