// ESM probe matching the exact pattern of test-e2e.mjs
import WebSocket from 'ws';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const portFile = join(homedir(), '.obsidian-ws-port');
let PORT, TOKEN;
try {
  const info = JSON.parse(readFileSync(portFile, 'utf-8'));
  PORT = info.port;
  TOKEN = info.token;
  console.log(`Port file: port=${PORT} token=${TOKEN.slice(0,8)}...`);
} catch(e) {
  console.error('Cannot read port file:', e.message);
  process.exit(1);
}

const URL = `ws://127.0.0.1:${PORT}`;
console.log(`Connecting to ${URL}...`);

let idSeq = 0;
const pending = new Map();
const ws = new WebSocket(URL);

function call(method, params = {}) {
  const id = ++idSeq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout: ${method} (id=${id})`));
    }, 10000);
    pending.set(id, { resolve, reject, timer, method });
    ws.send(JSON.stringify({ jsonrpc: '2.0', method, params, id }));
  });
}

ws.on('open', () => {
  console.log('OPEN - WebSocket connected!');
  runTest();
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  const entry = pending.get(msg.id);
  if (entry) {
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(JSON.stringify(msg.error)));
    else entry.resolve(msg.result);
  }
});

ws.on('error', e => { console.error('WS ERROR:', e.message); process.exit(1); });
ws.on('close', (code, reason) => console.log(`CLOSED: ${code} ${reason}`));

setTimeout(() => { console.log('GLOBAL TIMEOUT - no open event'); process.exit(1); }, 12000);

async function runTest() {
  try {
    const auth = await call('authenticate', { token: TOKEN });
    console.log('Auth result:', JSON.stringify(auth));

    const list = await call('vault.list', { path: '' });
    console.log('vault.list files:', list.files?.slice(0,5));

    ws.close();
    console.log('PROBE PASSED');
    process.exit(0);
  } catch(e) {
    console.error('Test failed:', e.message);
    ws.close();
    process.exit(1);
  }
}
