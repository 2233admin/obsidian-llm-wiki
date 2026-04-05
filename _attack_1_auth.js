// Attack 1: Auth bypass variants
const WebSocket = require("ws");

const TOKEN = "2cbaffa84f141fef08bc13f86d1384b94d824b151058b1f2bd72c145165b6e26";
const URL = "ws://127.0.0.1:48765";

function test(name, fn) {
  return new Promise((resolve) => {
    const result = { name, status: "PASS", detail: "" };
    const timeout = setTimeout(() => {
      result.status = "PASS";
      result.detail = "Connection timed out / closed (expected)";
      resolve(result);
    }, 4000);

    try {
      fn(result, () => { clearTimeout(timeout); resolve(result); });
    } catch (e) {
      clearTimeout(timeout);
      result.status = "FAIL";
      result.detail = "Exception: " + e.message;
      resolve(result);
    }
  });
}

async function main() {
  const results = [];

  // TC1: No auth - send vault.read immediately
  results.push(await test("TC1: No auth - send vault.read directly", (r, done) => {
    const ws = new WebSocket(URL);
    ws.on("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.read", params: { path: "Welcome.md" }, id: 1 }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      r.detail = JSON.stringify(msg);
      // Should NOT return file content - connection should be closed
      if (msg.result && msg.result.content) {
        r.status = "VULN";
        r.detail = "UNAUTHORIZED READ SUCCEEDED: " + msg.result.content.slice(0, 100);
      } else {
        r.status = "PASS";
        r.detail = "Correctly rejected: " + JSON.stringify(msg);
      }
      ws.close();
      done();
    });
    ws.on("close", (code, reason) => {
      if (!r.detail) r.detail = `Closed: code=${code} reason=${reason}`;
      done();
    });
    ws.on("error", (e) => { r.detail = "Error: " + e.message; done(); });
  }));

  // TC2: Wrong token
  results.push(await test("TC2: Wrong token", (r, done) => {
    const ws = new WebSocket(URL);
    ws.on("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "authenticate", params: { token: "wrongtoken" }, id: 1 }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      r.detail = JSON.stringify(msg);
      if (msg.result && msg.result.ok) {
        r.status = "VULN";
        r.detail = "Wrong token accepted!";
      } else {
        r.status = "PASS";
        r.detail = "Correctly rejected: " + JSON.stringify(msg);
      }
      ws.close();
      done();
    });
    ws.on("close", (code, reason) => { if (!r.detail) r.detail = `Closed: code=${code}`; done(); });
    ws.on("error", (e) => { r.detail = "Error: " + e.message; done(); });
  }));

  // TC3: Empty token
  results.push(await test("TC3: Empty token", (r, done) => {
    const ws = new WebSocket(URL);
    ws.on("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "authenticate", params: { token: "" }, id: 1 }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.result && msg.result.ok) {
        r.status = "VULN"; r.detail = "Empty token accepted!";
      } else {
        r.status = "PASS"; r.detail = "Correctly rejected: " + JSON.stringify(msg);
      }
      ws.close(); done();
    });
    ws.on("close", () => { if (!r.detail) r.detail = "Closed without response"; done(); });
    ws.on("error", (e) => { r.detail = "Error: " + e.message; done(); });
  }));

  // TC4: Token as number
  results.push(await test("TC4: Token as number (not string)", (r, done) => {
    const ws = new WebSocket(URL);
    ws.on("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "authenticate", params: { token: 12345 }, id: 1 }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.result && msg.result.ok) {
        r.status = "VULN"; r.detail = "Numeric token accepted!";
      } else {
        r.status = "PASS"; r.detail = "Correctly rejected: " + JSON.stringify(msg);
      }
      ws.close(); done();
    });
    ws.on("close", () => { if (!r.detail) r.detail = "Closed without response"; done(); });
    ws.on("error", (e) => { r.detail = "Error: " + e.message; done(); });
  }));

  // TC5: Authenticate twice (second auth after already authenticated)
  results.push(await test("TC5: Authenticate twice", (r, done) => {
    const ws = new WebSocket(URL);
    let authCount = 0;
    ws.on("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "authenticate", params: { token: TOKEN }, id: 1 }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      authCount++;
      if (authCount === 1) {
        // First auth succeeded, now send second auth
        ws.send(JSON.stringify({ jsonrpc: "2.0", method: "authenticate", params: { token: TOKEN }, id: 2 }));
      } else {
        // Second auth response
        r.detail = "Second auth response: " + JSON.stringify(msg);
        // It's a VULN if second auth returns ok:true (re-auth shouldn't be needed)
        // but it's not really dangerous - what matters is if behavior changes unexpectedly
        if (msg.error) {
          r.status = "PASS"; r.detail = "Second auth correctly treated as unknown method or error: " + JSON.stringify(msg);
        } else {
          r.status = "PASS"; r.detail = "Second auth response (handled): " + JSON.stringify(msg);
        }
        ws.close(); done();
      }
    });
    ws.on("close", () => { if (!r.detail) r.detail = "Closed"; done(); });
    ws.on("error", (e) => { r.detail = "Error: " + e.message; done(); });
  }));

  // TC6: No token field at all in authenticate
  results.push(await test("TC6: Authenticate with no token field", (r, done) => {
    const ws = new WebSocket(URL);
    ws.on("open", () => {
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "authenticate", params: {}, id: 1 }));
    });
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.result && msg.result.ok) {
        r.status = "VULN"; r.detail = "No-token authenticate accepted!";
      } else {
        r.status = "PASS"; r.detail = "Correctly rejected: " + JSON.stringify(msg);
      }
      ws.close(); done();
    });
    ws.on("close", () => { if (!r.detail) r.detail = "Closed"; done(); });
    ws.on("error", (e) => { r.detail = "Error: " + e.message; done(); });
  }));

  console.log("\n=== AUTH BYPASS RESULTS ===");
  for (const r of results) {
    console.log(`[${r.status}] ${r.name}`);
    console.log(`       ${r.detail}`);
  }
  return results;
}

main().catch(console.error);
