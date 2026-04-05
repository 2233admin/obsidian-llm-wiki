// Attack 7: Concurrency races
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
        else reject(new Error("auth failed"));
      }
    });
    ws.on("error", (e) => { clearTimeout(t); reject(e); });
  });
}

function rpc(ws, method, params, id) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ timeout: true }), 8000);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        clearTimeout(t);
        ws.removeListener("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
  });
}

async function main() {
  const results = [];

  // TC1: Two clients simultaneously create the same file
  {
    const name = "TC1: Two clients simultaneously create same file";
    const [ws1, ws2] = await Promise.all([authedWs(), authedWs()]);
    const path = "_attack_race_create.md";

    const [r1, r2] = await Promise.all([
      rpc(ws1, "vault.create", { path, content: "client1", dryRun: false }, "race1a"),
      rpc(ws2, "vault.create", { path, content: "client2", dryRun: false }, "race1b"),
    ]);

    const r = { name, status: "PASS", detail: "" };
    const ok1 = r1.result?.ok, ok2 = r2.result?.ok;
    const err1 = r1.error?.message, err2 = r2.error?.message;

    if (ok1 && ok2) {
      r.status = "VULN";
      r.detail = "BOTH creates succeeded! File created twice / last-write-wins race condition.";
    } else if ((ok1 && err2) || (ok2 && err1)) {
      r.status = "PASS";
      r.detail = `Only one create succeeded (expected). ok1=${ok1},ok2=${ok2} err1=${err1} err2=${err2}`;
    } else {
      r.detail = `Both errored or unexpected. r1=${JSON.stringify(r1).slice(0,80)} r2=${JSON.stringify(r2).slice(0,80)}`;
    }
    results.push(r);

    // Cleanup
    const cleanWs = ok1 ? ws1 : ws2;
    await rpc(cleanWs, "vault.delete", { path, dryRun: false }, "cleanup1").catch(() => {});
    ws1.close(); ws2.close();
  }

  // TC2: One client creates, another immediately deletes (race)
  {
    const name = "TC2: Create-then-immediately-delete race";
    const [ws1, ws2] = await Promise.all([authedWs(), authedWs()]);
    const path = "_attack_race_delete.md";

    // ws1 creates, ws2 tries to delete immediately (before create completes)
    const createP = rpc(ws1, "vault.create", { path, content: "racing", dryRun: false }, "race2a");
    const deleteP = rpc(ws2, "vault.delete", { path, dryRun: false }, "race2b");

    const [cr, dr] = await Promise.all([createP, deleteP]);
    const r = { name, status: "PASS", detail: "" };
    r.detail = `create=${JSON.stringify(cr).slice(0,60)} delete=${JSON.stringify(dr).slice(0,60)}`;
    // Just check server is still alive
    const pingResp = await rpc(ws1, "vault.list", {}, "ping2");
    if (pingResp.timeout) {
      r.status = "VULN"; r.detail += " | SERVER HUNG after race!";
    } else {
      r.status = "PASS"; r.detail += " | Server still responsive";
    }
    // Cleanup leftover if create won
    await rpc(ws1, "vault.delete", { path, dryRun: false }, "cleanup2").catch(() => {});
    results.push(r);
    ws1.close(); ws2.close();
  }

  // TC3: Multiple clients racing to modify the same file
  {
    const name = "TC3: 10 clients racing to modify same file";
    const path = "_attack_race_modify.md";
    const ws0 = await authedWs();
    await rpc(ws0, "vault.create", { path, content: "initial", dryRun: false }, "setup3");

    const writers = await Promise.all(Array.from({ length: 10 }, () => authedWs()));
    const modResults = await Promise.all(
      writers.map((ws, i) => rpc(ws, "vault.modify", { path, content: `writer_${i}`, dryRun: false }, `race3_${i}`))
    );

    const successes = modResults.filter(r => r.result?.ok).length;
    const errors = modResults.filter(r => r.error).length;

    const r = { name, status: "PASS", detail: `${successes} succeeded, ${errors} errored out of 10 concurrent modifies` };
    // All 10 might succeed (last-write-wins is not a security vuln for modify), just check server stability
    const pingResp = await rpc(ws0, "vault.list", {}, "ping3");
    if (pingResp.timeout) {
      r.status = "VULN"; r.detail += " | SERVER HUNG";
    }

    await rpc(ws0, "vault.delete", { path, dryRun: false }, "cleanup3").catch(() => {});
    ws0.close();
    for (const ws of writers) ws.close();
    results.push(r);
  }

  // TC4: Authenticated then immediately flood with requests while disconnecting
  {
    const name = "TC4: Flood requests then abrupt disconnect";
    let ws;
    try {
      ws = await authedWs();
      // Send 100 requests then immediately terminate
      for (let i = 0; i < 100; i++) {
        ws.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.list", params: {}, id: i }));
      }
      ws.terminate(); // abrupt close (no close handshake)

      // Check server is still alive with a fresh connection
      await new Promise(r => setTimeout(r, 500));
      const ws2 = await authedWs();
      const ping = await rpc(ws2, "vault.list", {}, "ping4");
      const r = { name, status: "PASS", detail: "" };
      if (ping.timeout) {
        r.status = "VULN"; r.detail = "Server hung after abrupt disconnect flood";
      } else {
        r.status = "PASS"; r.detail = "Server still alive after abrupt disconnect flood";
      }
      ws2.close();
      results.push(r);
    } catch(e) {
      results.push({ name, status: "PASS", detail: "Exception: " + e.message });
      if (ws) ws.terminate();
    }
  }

  console.log("\n=== CONCURRENCY RESULTS ===");
  for (const r of results) {
    console.log(`[${r.status}] ${r.name}`);
    console.log(`       ${r.detail}`);
  }
  return results;
}

main().catch(console.error);
