const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:48765');
ws.on('open', () => {
  console.log('OPEN');
  ws.send(JSON.stringify({jsonrpc:'2.0',method:'authenticate',params:{token:'2cbaffa84f141fef08bc13f86d1384b94d824b151058b1f2bd72c145165b6e26'},id:1}));
});
ws.on('message', d => {
  console.log('MSG:', d.toString());
  // Now send a vault.list
  ws.send(JSON.stringify({jsonrpc:'2.0',method:'vault.list',params:{path:''},id:2}));
});
ws.on('close', () => { console.log('CLOSED'); process.exit(0); });
ws.on('error', e => { console.error('ERR:', e.message); process.exit(1); });
let msgCount = 0;
const orig = ws.on.bind(ws);
ws.on('message', () => { msgCount++; if (msgCount >= 2) { ws.terminate(); } });
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 8000);
