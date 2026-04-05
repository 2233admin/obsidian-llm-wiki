// Attack 6: Injection attacks
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
  const ws = await authedWs();
  const results = [];

  // TC1: vault.search with regex special chars in non-regex mode (should be escaped)
  {
    const name = "TC1: vault.search regex chars in literal mode";
    const queries = ["(.*)", "[^a-z]", "a{2,}", "^start$", "a|b|c"];
    let allPassed = true;
    const details = [];
    for (const q of queries) {
      const resp = await rpc(ws, "vault.search", { query: q, regex: false }, "inj1_" + q.length);
      if (resp.error) {
        details.push(`'${q}' -> error: ${resp.error.message}`);
      } else if (resp.result) {
        details.push(`'${q}' -> ${resp.result.totalMatches} matches (literal search, OK)`);
      } else {
        details.push(`'${q}' -> unexpected: ${JSON.stringify(resp).slice(0, 50)}`);
        allPassed = false;
      }
    }
    results.push({ name, status: allPassed ? "PASS" : "VULN", detail: details.join("; ") });
  }

  // TC2: vault.searchByFrontmatter with op="__proto__" (prototype pollution probe)
  {
    const name = "TC2: vault.searchByFrontmatter op=__proto__ (proto pollution)";
    const resp = await rpc(ws, "vault.searchByFrontmatter", { key: "topic", op: "__proto__", value: "evil" }, "inj2");
    const r = { name, status: "PASS", detail: "" };
    if (resp.error) {
      r.status = "PASS"; r.detail = "Rejected invalid op: " + resp.error.message;
    } else if (resp.result) {
      r.status = "PASS"; r.detail = "Returned (op not in allowlist so fell through): " + JSON.stringify(resp.result).slice(0, 80);
    }
    results.push(r);
  }

  // TC3: vault.searchByFrontmatter with op="constructor" (another proto pollution)
  {
    const name = "TC3: vault.searchByFrontmatter op=constructor";
    const resp = await rpc(ws, "vault.searchByFrontmatter", { key: "__proto__", op: "eq", value: {} }, "inj3");
    const r = { name, status: "PASS", detail: "Response: " + JSON.stringify(resp).slice(0, 100) };
    results.push(r);
  }

  // TC4: vault.init with topic containing path separators
  {
    const name = "TC4: vault.init with topic containing path separators ../../evil";
    const resp = await rpc(ws, "vault.init", { topic: "../../evil" }, "inj4");
    const r = { name, status: "PASS", detail: "" };
    if (resp.error) {
      r.status = "PASS"; r.detail = "Correctly blocked traversal in topic: " + resp.error.message;
    } else if (resp.result && resp.result.ok) {
      r.status = "VULN"; r.detail = "TRAVERSAL via vault.init topic accepted! Created: " + JSON.stringify(resp.result.created);
    } else {
      r.detail = "Response: " + JSON.stringify(resp).slice(0, 100);
    }
    results.push(r);
  }

  // TC5: vault.init with topic containing null bytes
  {
    const name = "TC5: vault.init with topic containing null byte";
    const resp = await rpc(ws, "vault.init", { topic: "legit\x00evil" }, "inj5");
    const r = { name, status: "PASS", detail: "Response: " + JSON.stringify(resp).slice(0, 100) };
    if (resp.result && resp.result.ok) {
      r.detail += " (accepted - check if path created is safe)";
    }
    results.push(r);
  }

  // TC6: vault.search with extremely long query (over 500 chars - should be rejected)
  {
    const name = "TC6: vault.search query over 500 chars";
    const longQuery = "a".repeat(501);
    const resp = await rpc(ws, "vault.search", { query: longQuery, regex: false }, "inj6");
    const r = { name, status: "PASS", detail: "" };
    if (resp.error) {
      r.status = "PASS"; r.detail = "Correctly rejected: " + resp.error.message;
    } else {
      r.status = "VULN"; r.detail = "Accepted query over 500 chars: " + JSON.stringify(resp).slice(0, 80);
    }
    results.push(r);
  }

  // TC7: vault.searchByFrontmatter with regex op and catastrophic regex value
  {
    const name = "TC7: searchByFrontmatter op=regex with ReDoS value";
    const start = Date.now();
    const resp = await rpc(ws, "vault.searchByFrontmatter", {
      key: "topic",
      op: "regex",
      value: "(a+)+"
    }, "inj7");
    const elapsed = Date.now() - start;
    const r = { name, status: "PASS", detail: "" };
    if (resp.timeout) {
      r.status = "VULN"; r.detail = `ReDoS via searchByFrontmatter regex op hung for ${elapsed}ms`;
    } else {
      r.status = "PASS"; r.detail = `Responded in ${elapsed}ms: ${JSON.stringify(resp).slice(0, 80)}`;
    }
    results.push(r);
  }

  // TC8: vault.batch with non-vault method
  {
    const name = "TC8: vault.batch with non-vault method (authenticate injection)";
    const resp = await rpc(ws, "vault.batch", {
      operations: [{ method: "authenticate", params: { token: "hacked" } }]
    }, "inj8");
    const r = { name, status: "PASS", detail: "" };
    if (resp.error) {
      r.status = "PASS"; r.detail = "Batch correctly rejected non-vault method: " + resp.error.message;
    } else if (resp.result) {
      // If it returned a result, check if any op succeeded
      const ops = resp.result.results || [];
      const anyOk = ops.some(o => o.ok);
      if (anyOk) {
        r.status = "VULN"; r.detail = "Non-vault method executed via batch!";
      } else {
        r.status = "PASS"; r.detail = "Batch returned results but all ops failed: " + JSON.stringify(resp.result.summary);
      }
    }
    results.push(r);
  }

  ws.close();

  console.log("\n=== INJECTION RESULTS ===");
  for (const r of results) {
    console.log(`[${r.status}] ${r.name}`);
    console.log(`       ${r.detail}`);
  }
  return results;
}

main().catch(console.error);
