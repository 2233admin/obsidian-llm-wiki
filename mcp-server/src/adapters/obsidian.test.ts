/**
 * ObsidianAdapter tests
 *
 * Unavailable paths (no server needed):
 *   - missing port file -> init() resolves, isAvailable=false
 *   - WS connect refused -> isAvailable=false
 *   - all methods degrade gracefully
 *
 * Happy path (mock WS server):
 *   - auth -> search -> read -> write -> graph
 *   - onFileChange dispatches vault: events
 *   - dispose cleans up
 */

import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer, WebSocket } from "ws";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { ObsidianAdapter } from "./obsidian.js";
import type { FileEvent } from "./interface.js";

// --- Helpers ---

const TMP_PORT_FILE = join(tmpdir(), `.obsidian-ws-port-test-${process.pid}`);
const TEST_TOKEN = "test-token-abc123";

function writePortFile(port: number): void {
  writeFileSync(
    TMP_PORT_FILE,
    JSON.stringify({ port, token: TEST_TOKEN, pid: process.pid, vault: "/test-vault" }),
    "utf-8",
  );
}

function cleanPortFile(): void {
  if (existsSync(TMP_PORT_FILE)) unlinkSync(TMP_PORT_FILE);
}

// Minimal mock WS server that speaks the vault-bridge JSON-RPC protocol
function createMockServer(port: number, opts: { rejectAuth?: boolean } = {}) {
  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    ws.on("message", (raw: Buffer | string) => {
      const msg = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf-8"));
      const { id, method, params } = msg;

      const reply = (result: unknown) => ws.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
      const replyErr = (code: number, message: string) =>
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));

      switch (method) {
        case "vault.auth":
          if (opts.rejectAuth || params?.token !== TEST_TOKEN) {
            replyErr(-32403, "Authentication failed");
          } else {
            reply({ ok: true, vault: "/test-vault" });
          }
          break;

        case "vault.search":
          reply({
            results: [
              {
                path: "notes/hello.md",
                matches: [
                  { line: 3, text: "hello world", before: [], after: ["next line"] },
                ],
              },
            ],
            totalMatches: 1,
          });
          break;

        case "vault.read":
          reply({ content: "# Hello\n\nworld" });
          break;

        case "vault.modify":
          reply({ ok: true });
          break;

        case "vault.create":
          reply({ ok: true });
          break;

        case "vault.graph":
          reply({
            nodes: [{ path: "notes/hello.md" }],
            edges: [{ from: "notes/hello.md", to: "notes/world.md", type: "link" }],
          });
          break;

        default:
          replyErr(-32601, `Unknown method: ${method}`);
      }
    });
  });

  return wss;
}

// --- Tests ---

describe("ObsidianAdapter -- unavailable paths", () => {
  test("missing port file: init() resolves, isAvailable=false", async () => {
    cleanPortFile();
    const adapter = new ObsidianAdapter({ portFile: TMP_PORT_FILE });
    await adapter.init();
    assert.equal(adapter.isAvailable, false);
    await adapter.dispose();
  });

  test("search() returns [] when unavailable", async () => {
    const adapter = new ObsidianAdapter({ portFile: TMP_PORT_FILE });
    const results = await adapter.search("hello");
    assert.deepEqual(results, []);
  });

  test("graph() returns empty graph when unavailable", async () => {
    const adapter = new ObsidianAdapter({ portFile: TMP_PORT_FILE });
    const g = await adapter.graph();
    assert.deepEqual(g, { nodes: [], edges: [] });
  });

  test("read() throws when unavailable", async () => {
    const adapter = new ObsidianAdapter({ portFile: TMP_PORT_FILE });
    await assert.rejects(() => adapter.read("notes/x.md"), /not available/);
  });

  test("write() throws when unavailable", async () => {
    const adapter = new ObsidianAdapter({ portFile: TMP_PORT_FILE });
    await assert.rejects(() => adapter.write("notes/x.md", "content"), /not available/);
  });

  test("onFileChange disposable works without WS", () => {
    const adapter = new ObsidianAdapter({ portFile: TMP_PORT_FILE });
    const events: FileEvent[] = [];
    const { dispose } = adapter.onFileChange((e) => events.push(e));
    dispose();
    // No events, no crash
    assert.equal(events.length, 0);
  });

  test("capabilities includes all 5 caps", () => {
    const adapter = new ObsidianAdapter({ portFile: TMP_PORT_FILE });
    const caps = adapter.capabilities as string[];
    for (const cap of ["search", "read", "write", "graph", "events"]) {
      assert.ok(caps.includes(cap), `missing capability: ${cap}`);
    }
  });

  test("name is 'obsidian'", () => {
    const adapter = new ObsidianAdapter({ portFile: TMP_PORT_FILE });
    assert.equal(adapter.name, "obsidian");
  });
});

describe("ObsidianAdapter -- mock WS server", () => {
  let wss: WebSocketServer;
  let adapter: ObsidianAdapter;
  let PORT = 0;

  before(async () => {
    wss = createMockServer(0);
    await new Promise<void>((res, rej) => {
      wss.once("listening", res);
      wss.once("error", rej);
    });
    PORT = (wss.address() as AddressInfo).port;
  });

  after(async () => {
    cleanPortFile();
    await Promise.all([...wss.clients].map((c) =>
      new Promise<void>((res) => {
        if (c.readyState === WebSocket.CLOSED) res();
        else c.once("close", res);
      }),
    ));
    await new Promise<void>((res) => setImmediate(res));
    await new Promise<void>((res) => wss.close(() => res()));
  });

  beforeEach(async () => {
    writePortFile(PORT);
    adapter = new ObsidianAdapter({ portFile: TMP_PORT_FILE, timeout: 3000 });
    await adapter.init();
  });

  afterEach(async () => {
    await adapter.dispose();
  });

  test("init() authenticates and sets isAvailable=true", () => {
    assert.equal(adapter.isAvailable, true);
  });

  test("search() returns mapped SearchResult[]", async () => {
    const results = await adapter.search("hello");
    assert.equal(results.length, 1);
    assert.equal(results[0].source, "obsidian");
    assert.equal(results[0].path, "notes/hello.md");
    assert.equal(results[0].content, "hello world");
    assert.equal(results[0].score, 0.8);
    assert.equal((results[0].metadata as { line: number }).line, 3);
  });

  test("search() with maxResults opts passes through", async () => {
    // should not throw even if bridge ignores the limit
    const results = await adapter.search("hello", { maxResults: 5 });
    assert.ok(Array.isArray(results));
  });

  test("read() returns file content", async () => {
    const content = await adapter.read("notes/hello.md");
    assert.equal(content, "# Hello\n\nworld");
  });

  test("write() calls vault.modify and resolves", async () => {
    await assert.doesNotReject(() => adapter.write("notes/hello.md", "updated"));
  });

  test("write() with dryRun=true resolves", async () => {
    await assert.doesNotReject(() =>
      adapter.write("notes/hello.md", "updated", true),
    );
  });

  test("graph() returns nodes and edges", async () => {
    const g = await adapter.graph();
    assert.equal(g.nodes.length, 1);
    assert.equal(g.nodes[0].path, "notes/hello.md");
    assert.equal(g.edges.length, 1);
  });

  test("onFileChange dispatches vault:create event", (_, done) => {
    const { dispose } = adapter.onFileChange((e) => {
      assert.equal(e.type, "create");
      assert.equal(e.path, "notes/new.md");
      dispose();
      done();
    });

    // Simulate server pushing a notification
    const client = [...(wss.clients as Set<WebSocket>)][0];
    client?.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "vault:create",
        params: { path: "notes/new.md", type: "file" },
      }),
    );
  });

  test("onFileChange dispatches vault:rename with oldPath", (_, done) => {
    const { dispose } = adapter.onFileChange((e) => {
      assert.equal(e.type, "rename");
      assert.equal(e.path, "notes/new.md");
      assert.equal(e.oldPath, "notes/old.md");
      dispose();
      done();
    });

    const client = [...(wss.clients as Set<WebSocket>)][0];
    client?.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "vault:rename",
        params: { path: "notes/new.md", oldPath: "notes/old.md", type: "file" },
      }),
    );
  });

  test("unknown notifications are silently ignored", async () => {
    const client = [...(wss.clients as Set<WebSocket>)][0];
    client?.send(
      JSON.stringify({ jsonrpc: "2.0", method: "metadata:changed", params: { path: "x.md" } }),
    );
    // No crash, adapter still available
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(adapter.isAvailable, true);
  });

  test("dispose() sets isAvailable=false and cleans up", async () => {
    await adapter.dispose();
    assert.equal(adapter.isAvailable, false);
    // Verify methods degrade after dispose
    const results = await adapter.search("hello");
    assert.deepEqual(results, []);
  });
});

describe("ObsidianAdapter -- auth rejection", () => {
  let wss: WebSocketServer;
  let PORT = 0;

  before(async () => {
    wss = createMockServer(0, { rejectAuth: true });
    await new Promise<void>((res, rej) => {
      wss.once("listening", res);
      wss.once("error", rej);
    });
    PORT = (wss.address() as AddressInfo).port;
  });

  after(async () => {
    cleanPortFile();
    // The adapter owns this connection and terminates it after auth rejection.
    // Wait for that close to propagate instead of racing it with a second
    // server-side terminate, which can wedge Bun's HTTP server close callback.
    await Promise.all([...wss.clients].map((c) =>
      new Promise<void>((res) => {
        if (c.readyState === WebSocket.CLOSED) res();
        else c.once("close", res);
      }),
    ));
    await new Promise<void>((res) => setImmediate(res));
    await new Promise<void>((res) => wss.close(() => res()));
  });

  test("bad auth: init() resolves but isAvailable=false", async () => {
    writePortFile(PORT);
    const adapter = new ObsidianAdapter({ portFile: TMP_PORT_FILE, timeout: 3000 });
    await adapter.init();
    assert.equal(adapter.isAvailable, false);
    await adapter.dispose();
  });
});
