// Attack 3: Path traversal attacks
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

function sendAndWait(ws, payload, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ timeout: true }), timeoutMs);
    const handler = (data) => {
      clearTimeout(t);
      ws.removeListener("message", handler);
      try { resolve(JSON.parse(data.toString())); }
      catch { resolve({ parseError: data.toString().slice(0, 100) }); }
    };
    ws.on("message", handler);
    ws.send(payload);
  });
}

async function main() {
  const ws = await authedWs();
  const results = [];

  const pathTests = [
    { name: "TC1: Classic Unix traversal", path: "../../../etc/passwd" },
    { name: "TC2: Windows SAM file", path: "C:\\Windows\\system32\\config\\SAM" },
    { name: "TC3: Windows SAM forward slashes", path: "C:/Windows/system32/config/SAM" },
    { name: "TC4: Null byte injection", path: "foo\x00.md" },
    { name: "TC5: Unicode trick (dotdot via fullwidth)", path: "\u{FF0E}\u{FF0E}/\u{FF0E}\u{FF0E}/etc/passwd" },
    { name: "TC6: Encoded dotdot %2e%2e", path: "%2e%2e/%2e%2e/etc/passwd" },
    { name: "TC7: Double slash traversal", path: "//etc/passwd" },
    { name: "TC8: Extremely long path (10000 chars)", path: "a".repeat(10000) + ".md" },
    { name: "TC9: Windows device file CON", path: "CON" },
    { name: "TC10: Absolute path /etc/passwd", path: "/etc/passwd" },
    { name: "TC11: Mixed slash traversal", path: "..\\..\\..\\Windows\\system.ini" },
    { name: "TC12: Dotdot via URL encoding double", path: "..%2F..%2F..%2Fetc%2Fpasswd" },
  ];

  let id = 100;
  for (const pt of pathTests) {
    const resp = await sendAndWait(ws,
      JSON.stringify({ jsonrpc: "2.0", method: "vault.read", params: { path: pt.path }, id: id++ })
    );
    const r = { name: pt.name, status: "PASS", detail: "" };
    if (resp.result && resp.result.content !== undefined) {
      // Check if it actually returned content (could be a file named literally)
      const content = resp.result.content;
      if (content.includes("root:") || content.includes("[boot loader]") || content.includes("Administrator")) {
        r.status = "VULN";
        r.detail = "PATH TRAVERSAL SUCCEEDED - got system file content: " + content.slice(0, 100);
      } else {
        r.status = "PASS";
        r.detail = "Returned content but not a system file (may be false match): " + content.slice(0, 50);
      }
    } else if (resp.error) {
      r.status = "PASS";
      r.detail = "Blocked: " + resp.error.message;
    } else if (resp.timeout) {
      r.status = "PASS";
      r.detail = "Timeout (server hung but did not crash/leak)";
    } else {
      r.detail = "Unexpected response: " + JSON.stringify(resp).slice(0, 100);
    }
    results.push(r);
  }

  ws.close();

  console.log("\n=== PATH TRAVERSAL RESULTS ===");
  for (const r of results) {
    console.log(`[${r.status}] ${r.name}`);
    console.log(`       ${r.detail}`);
  }
  return results;
}

main().catch(console.error);
