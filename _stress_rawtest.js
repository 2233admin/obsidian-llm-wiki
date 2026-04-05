// Raw TCP + HTTP upgrade test to diagnose WS handshake hang
const net = require('net');

const HOST = '127.0.0.1';
const PORT = 48765;

console.log(`Testing TCP connect to ${HOST}:${PORT}...`);
const sock = new net.Socket();
const t0 = Date.now();

sock.setTimeout(5000);

sock.connect(PORT, HOST, () => {
  console.log(`TCP connected in ${Date.now()-t0}ms`);
  // Send HTTP WebSocket upgrade request
  const key = Buffer.from('stress-test-key-12345678901').toString('base64');
  const req = [
    'GET / HTTP/1.1',
    `Host: ${HOST}:${PORT}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
    '',
    ''
  ].join('\r\n');
  sock.write(req);
  console.log('HTTP upgrade request sent, waiting for response...');
});

sock.on('data', (data) => {
  console.log(`Response received in ${Date.now()-t0}ms:`);
  console.log(data.toString().split('\r\n').slice(0,5).join('\n'));
  sock.destroy();
  process.exit(0);
});

sock.on('timeout', () => {
  console.log(`TIMEOUT after ${Date.now()-t0}ms - server not responding to HTTP upgrade`);
  sock.destroy();
  process.exit(1);
});

sock.on('error', (e) => {
  console.error(`TCP error: ${e.message}`);
  process.exit(1);
});

sock.on('close', () => {
  console.log(`Connection closed after ${Date.now()-t0}ms`);
});

// Also check the port file
const fs = require('fs');
const path = require('path');
const os = require('os');
const portFile = path.join(os.homedir(), '.obsidian-ws-port');
try {
  const info = JSON.parse(fs.readFileSync(portFile, 'utf-8'));
  console.log(`Port file: port=${info.port} token=${info.token ? info.token.slice(0,8)+'...' : 'none'}`);
  if (info.port !== PORT) {
    console.log(`WARNING: Port file says ${info.port} but we're testing ${PORT}!`);
  }
} catch(e) {
  console.log(`Port file not found at ${portFile}: ${e.message}`);
}
