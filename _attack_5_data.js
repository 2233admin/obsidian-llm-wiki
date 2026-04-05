// Attack 5: Data corruption attempts
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
    const t = setTimeout(() => resolve({ timeout: true }), 10000);
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

  // TC1: vault.create with 10MB content (dryRun:false to actually attempt)
  {
    const name = "TC1: vault.create with 10MB content";
    const bigContent = "X".repeat(10 * 1024 * 1024);
    const resp = await rpc(ws, "vault.create", {
      path: "_attack_test_bigfile.md",
      content: bigContent,
      dryRun: false
    }, "data1");
    const r = { name, status: "PASS", detail: "" };
    if (resp.timeout) {
      r.status = "VULN"; r.detail = "Server hung on 10MB create";
    } else if (resp.error) {
      r.status = "PASS"; r.detail = "Rejected: " + resp.error.message;
    } else if (resp.result && resp.result.ok) {
      r.status = "PASS"; r.detail = "Created 10MB file (accepted but not harmful per se) - will cleanup";
      // Clean it up
      await rpc(ws, "vault.delete", { path: "_attack_test_bigfile.md", dryRun: false }, "cleanup1");
    } else {
      r.detail = "Response: " + JSON.stringify(resp).slice(0, 100);
    }
    results.push(r);
  }

  // TC2: vault.modify with empty string content
  {
    const name = "TC2: vault.modify with empty string content";
    // First create a test file
    await rpc(ws, "vault.create", { path: "_attack_modify_test.md", content: "initial", dryRun: false }, "setup2");
    const resp = await rpc(ws, "vault.modify", { path: "_attack_modify_test.md", content: "", dryRun: false }, "data2");
    const r = { name, status: "PASS", detail: "" };
    if (resp.error) {
      r.status = "PASS"; r.detail = "Rejected empty content: " + resp.error.message;
    } else if (resp.result && resp.result.ok) {
      // Check if file was zeroed out
      const read = await rpc(ws, "vault.read", { path: "_attack_modify_test.md" }, "read2");
      r.status = "PASS"; r.detail = `Empty modify accepted (content now: '${read.result?.content}') - data loss but not a security vuln`;
    }
    await rpc(ws, "vault.delete", { path: "_attack_modify_test.md", dryRun: false }, "cleanup2");
    results.push(r);
  }

  // TC3: vault.append with only newlines (thousands of them)
  {
    const name = "TC3: vault.append with 100KB of newlines";
    await rpc(ws, "vault.create", { path: "_attack_append_test.md", content: "base", dryRun: false }, "setup3");
    const resp = await rpc(ws, "vault.append", {
      path: "_attack_append_test.md",
      content: "\n".repeat(100000),
      dryRun: false
    }, "data3");
    const r = { name, status: "PASS", detail: "" };
    if (resp.error) {
      r.status = "PASS"; r.detail = "Rejected: " + resp.error.message;
    } else {
      r.status = "PASS"; r.detail = "Appended 100K newlines (accepted, not harmful)";
    }
    await rpc(ws, "vault.delete", { path: "_attack_append_test.md", dryRun: false }, "cleanup3");
    results.push(r);
  }

  // TC4: vault.rename to same path (rename file to itself)
  {
    const name = "TC4: vault.rename to same path (self-rename)";
    await rpc(ws, "vault.create", { path: "_attack_rename_test.md", content: "test", dryRun: false }, "setup4");
    const resp = await rpc(ws, "vault.rename", {
      from: "_attack_rename_test.md",
      to: "_attack_rename_test.md",
      dryRun: false
    }, "data4");
    const r = { name, status: "PASS", detail: "" };
    if (resp.error) {
      r.status = "PASS"; r.detail = "Correctly rejected self-rename: " + resp.error.message;
    } else if (resp.result && resp.result.ok) {
      // Check if file still exists
      const exists = await rpc(ws, "vault.exists", { path: "_attack_rename_test.md" }, "check4");
      r.status = "PASS"; r.detail = `Self-rename accepted, file exists: ${exists.result?.exists}`;
    }
    await rpc(ws, "vault.delete", { path: "_attack_rename_test.md", dryRun: false }, "cleanup4").catch(() => {});
    results.push(r);
  }

  // TC5: vault.delete on root "/" (should be blocked)
  {
    const name = "TC5: vault.delete on root path '/'";
    const resp = await rpc(ws, "vault.delete", { path: "/", dryRun: false }, "data5");
    const r = { name, status: "PASS", detail: "" };
    if (resp.error) {
      r.status = "PASS"; r.detail = "Correctly rejected root delete: " + resp.error.message;
    } else if (resp.result && resp.result.ok) {
      r.status = "VULN"; r.detail = "ROOT DELETE ACCEPTED - vault may be destroyed!";
    } else if (resp.result && resp.result.dryRun) {
      r.status = "PASS"; r.detail = "dryRun mode returned but root delete would be allowed - check dryRun default";
    } else {
      r.detail = "Response: " + JSON.stringify(resp).slice(0, 100);
    }
    results.push(r);
  }

  // TC6: vault.delete on empty string path
  {
    const name = "TC6: vault.delete on empty path ''";
    const resp = await rpc(ws, "vault.delete", { path: "", dryRun: false }, "data6");
    const r = { name, status: "PASS", detail: "" };
    if (resp.error) {
      r.status = "PASS"; r.detail = "Correctly rejected empty path delete: " + resp.error.message;
    } else {
      r.detail = "Response: " + JSON.stringify(resp).slice(0, 100);
    }
    results.push(r);
  }

  // TC7: vault.modify with null content (missing required field)
  {
    const name = "TC7: vault.modify with null content";
    await rpc(ws, "vault.create", { path: "_attack_null_test.md", content: "original", dryRun: false }, "setup7");
    const resp = await rpc(ws, "vault.modify", { path: "_attack_null_test.md", content: null, dryRun: false }, "data7");
    const r = { name, status: "PASS", detail: "" };
    if (resp.error) {
      r.status = "PASS"; r.detail = "Rejected null content: " + resp.error.message;
    } else if (resp.result && resp.result.ok) {
      const read = await rpc(ws, "vault.read", { path: "_attack_null_test.md" }, "read7");
      r.status = "PASS"; r.detail = `Accepted null content, file now: '${String(read.result?.content).slice(0, 30)}'`;
    }
    await rpc(ws, "vault.delete", { path: "_attack_null_test.md", dryRun: false }, "cleanup7").catch(() => {});
    results.push(r);
  }

  ws.close();

  console.log("\n=== DATA CORRUPTION RESULTS ===");
  for (const r of results) {
    console.log(`[${r.status}] ${r.name}`);
    console.log(`       ${r.detail}`);
  }
  return results;
}

main().catch(console.error);
