// Long-wait WS connect test - wait up to 60s for upgrade response
// Also polls netstat to track connection state changes
const net = require('net');
const { execSync } = require('child_process');

const HOST = '127.0.0.1';
const PORT = 48765;

function getConnections() {
  try {
    const out = execSync(`C:/Windows/System32/netstat.exe -ano`, { encoding: 'utf8', timeout: 3000 });
    const lines = out.split('\n').filter(l => l.includes('48765'));
    return lines.map(l => l.trim());
  } catch(e) { return [`error: ${e.message}`]; }
}

console.log('=== Connections at start ===');
getConnections().forEach(l => console.log(' ', l));

const sock = new net.Socket();
const t0 = Date.now();
sock.setTimeout(60000);

sock.connect(PORT, HOST, () => {
  console.log(`\nTCP connected in ${Date.now()-t0}ms`);
  console.log('=== Connections after TCP connect ===');
  getConnections().forEach(l => console.log(' ', l));

  const key = 'dGhlIHNhbXBsZSBub25jZQ=='; // standard test key
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
  console.log('HTTP upgrade sent. Waiting up to 60s...');

  // Log every 5s
  let ticks = 0;
  const ticker = setInterval(() => {
    ticks++;
    console.log(`  [${ticks*5}s] still waiting... connections:`);
    getConnections().forEach(l => console.log('   ', l));
  }, 5000);

  sock.on('data', (data) => {
    clearInterval(ticker);
    console.log(`\nRESPONSE in ${Date.now()-t0}ms:`);
    console.log(data.toString().split('\r\n').slice(0, 8).join('\n'));
    sock.destroy();
  });

  sock.on('timeout', () => {
    clearInterval(ticker);
    console.log(`\nTIMEOUT after ${Date.now()-t0}ms`);
    sock.destroy();
    process.exit(1);
  });
});

sock.on('error', e => { console.error('TCP error:', e.message); process.exit(1); });
sock.on('close', () => { console.log(`Socket closed after ${Date.now()-t0}ms`); process.exit(0); });
