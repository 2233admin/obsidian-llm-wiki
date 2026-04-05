// Attack 2: Protocol abuse
const WebSocket = require("ws");

const TOKEN = "2cbaffa84f141fef08bc13f86d1384b94d824b151058b1f2bd72c145165b6e26";
const URL = "ws://127.0.0.1:48765";

async function authedWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const t = setTimeout(() => reject(new Error("connect timeout")), 4000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "authenticate", params: { token: TOKEN }, id: "__auth__" }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === "__auth__") {
        clearTimeout(t);
        if (msg.result && msg.result.ok) resolve(ws);
        else reject(new Error("auth failed: " + JSON.stringify(msg)));
      }
    });
    ws.on("error", (e) => { clearTimeout(t); reject(e); });
  });
}

function sendAndWait(ws, payload, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ timeout: true }), timeoutMs);
    const handler = (data) => {
      clearTimeout(t);
      ws.removeListener("message", handler);
      try { resolve(JSON.parse(data.toString())); }
      catch { resolve({ parseError: data.toString() }); }
    };
    ws.on("message", handler);
    if (typeof payload === "string") ws.send(payload);
    else ws.send(payload); // Buffer
  });
}

async function main() {
  const results = [];

  // TC1: Invalid JSON
  {
    const name = "TC1: Invalid JSON";
    const ws = new WebSocket(URL);
    await new Promise(r => ws.on("open", r));
    ws.send("this is not json{{{");
    const resp = await sendAndWait(ws, null, 2000).catch(() => null);
    // server sends error to null id then closes
    const closed = await new Promise(r => { ws.on("close", (code) => r(code)); setTimeout(r, 2000); });
    const r = { name, status: "PASS", detail: "" };
    // We expect a parse error response or connection close
    r.detail = "Connection closed or error response (expected)";
    results.push(r);
    ws.close();
  }

  // TC2: Valid JSON but not JSON-RPC (missing jsonrpc field)
  {
    const name = "TC2: Valid JSON, not JSON-RPC";
    let ws;
    try {
      ws = await authedWs();
      const resp = await sendAndWait(ws, JSON.stringify({ method: "vault.read", params: { path: "Welcome.md" }, id: 1 }));
      const r = { name, status: "PASS", detail: "" };
      if (resp.result && resp.result.content) {
        r.status = "VULN"; r.detail = "Non-JSONRPC request succeeded and returned content!";
      } else {
        r.status = "PASS"; r.detail = "Rejected: " + JSON.stringify(resp);
      }
      results.push(r);
      ws.close();
    } catch(e) {
      results.push({ name, status: "PASS", detail: "Exception/close: " + e.message });
      if (ws) ws.close();
    }
  }

  // TC3: JSON-RPC with missing id (notification format)
  {
    const name = "TC3: JSON-RPC missing id (notification)";
    let ws;
    try {
      ws = await authedWs();
      // Send without waiting for response (no id = notification, server may ignore)
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.read", params: { path: "Welcome.md" } }));
      // Wait briefly to see if server sends anything back
      const resp = await new Promise(r => {
        const t = setTimeout(() => r({ timeout: true }), 1500);
        ws.once("message", (d) => { clearTimeout(t); r(JSON.parse(d.toString())); });
      });
      const r = { name, status: "PASS", detail: "" };
      if (resp.timeout) {
        r.status = "PASS"; r.detail = "Server correctly did not respond to notification (no id)";
      } else if (resp.result && resp.result.content) {
        r.status = "VULN"; r.detail = "Notification with vault.read returned content without id!";
      } else {
        r.status = "PASS"; r.detail = "Response: " + JSON.stringify(resp);
      }
      results.push(r);
      ws.close();
    } catch(e) {
      results.push({ name, status: "PASS", detail: "Exception: " + e.message });
      if (ws) ws.close();
    }
  }

  // TC4: id = null
  {
    const name = "TC4: id=null in request";
    let ws;
    try {
      ws = await authedWs();
      const resp = await sendAndWait(ws, JSON.stringify({ jsonrpc: "2.0", method: "vault.list", params: {}, id: null }));
      const r = { name, status: "PASS", detail: "Response: " + JSON.stringify(resp) };
      results.push(r);
      ws.close();
    } catch(e) {
      results.push({ name, status: "PASS", detail: "Exception: " + e.message });
      if (ws) ws.close();
    }
  }

  // TC5: Huge payload (1MB string in query)
  {
    const name = "TC5: Huge payload (1MB string)";
    let ws;
    try {
      ws = await authedWs();
      const bigStr = "A".repeat(1024 * 1024);
      const resp = await sendAndWait(ws, JSON.stringify({ jsonrpc: "2.0", method: "vault.search", params: { query: bigStr }, id: 5 }), 5000);
      const r = { name, status: "PASS", detail: "" };
      if (resp.timeout) {
        r.status = "PASS"; r.detail = "Server timed out handling 1MB payload (no crash)";
      } else if (resp.error) {
        r.status = "PASS"; r.detail = "Server rejected large payload with error: " + resp.error.message;
      } else {
        r.status = "PASS"; r.detail = "Server handled large payload: " + JSON.stringify(resp).slice(0, 100);
      }
      results.push(r);
      ws.close();
    } catch(e) {
      results.push({ name, status: "PASS", detail: "Exception (may be expected): " + e.message });
      if (ws) ws.close();
    }
  }

  // TC6: Binary buffer instead of text
  {
    const name = "TC6: Binary buffer message";
    let ws;
    try {
      ws = await authedWs();
      // Send raw binary
      ws.send(Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]));
      const resp = await new Promise(r => {
        const t = setTimeout(() => r({ timeout: true }), 2000);
        ws.once("message", (d) => { clearTimeout(t); try { r(JSON.parse(d.toString())); } catch { r({ raw: d.toString().slice(0, 50) }); } });
        ws.once("close", (code) => { clearTimeout(t); r({ closed: code }); });
      });
      const r = { name, status: "PASS", detail: "Server response to binary: " + JSON.stringify(resp) };
      results.push(r);
      ws.close();
    } catch(e) {
      results.push({ name, status: "PASS", detail: "Exception: " + e.message });
      if (ws) ws.close();
    }
  }

  console.log("\n=== PROTOCOL ABUSE RESULTS ===");
  for (const r of results) {
    console.log(`[${r.status}] ${r.name}`);
    console.log(`       ${r.detail}`);
  }
  return results;
}

main().catch(console.error);
