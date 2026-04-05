const ws = require('ws');
console.log('ws type:', typeof ws);
console.log('ws.WebSocket type:', typeof ws.WebSocket);
console.log('keys:', Object.keys(ws).slice(0,10).join(', '));
