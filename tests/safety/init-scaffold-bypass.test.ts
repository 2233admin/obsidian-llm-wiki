/**
 * ADR invariant test: vault.init scaffold is NOT blocked by the safety gate.
 *
 * vault.init calls bridge.create and bridge.mkdir DIRECTLY, bypassing
 * server.getHandler("vault.create"), so the handler-layer gate does not
 * intercept scaffold writes. This test catches the regression if anyone
 * later moves the gate from the handler layer to the bridge layer.
 *
 * If this test fails, the gate was moved to bridge.ts (ADR option b) without
 * updating the vault.init carve-out. See docs/decisions/yaml-blocklist-conflict.md.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { WsServer } from "../../src/server";
import { VaultBridge } from "../../src/bridge";
import { registerHandlers } from "../../src/handlers";
import { MockApp } from "../mocks/obsidian";
import { DEFAULT_SETTINGS } from "../../src/types";

const TOKEN = "init-bypass-test-token";

function startServer(): Promise<{ server: WsServer; port: number }> {
  return new Promise((resolve) => {
    const app = new MockApp({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = new VaultBridge(app as any);
    // Safety is ENABLED (default) -- the test must pass with it on
    const settings = {
      ...DEFAULT_SETTINGS,
      token: TOKEN,
      dryRunDefault: false,
    };
    const server = new WsServer(
      { port: 0, token: TOKEN },
      (resolvedPort) => resolve({ server, port: resolvedPort }),
    );
    registerHandlers(server, bridge, settings);
    server.start();
  });
}

function connect(port: number): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}`);
}

function sendRpc(ws: WebSocket, method: string, params: Record<string, unknown>, id: number): void {
  ws.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => {
      try { resolve(JSON.parse(data.toString())); }
      catch (e) { reject(e); }
    });
    ws.once("error", reject);
  });
}

let server: WsServer;
let port: number;
let ws: WebSocket;

beforeEach(async () => {
  ({ server, port } = await startServer());
  ws = connect(port);
  await new Promise<void>((res) => ws.once("open", () => res()));
  const auth = nextMessage(ws);
  sendRpc(ws, "authenticate", { token: TOKEN }, 0);
  await auth;
});

afterEach(() => {
  ws.close();
  server.stop();
});


describe("vault.init scaffold bypasses safety gate (ADR invariant)", () => {
  it("vault.init with topic test-topic succeeds and does not throw RPC_SAFETY_PATH_BLOCKED", async () => {
    // vault.init creates kb.yaml (a .yaml file which is in BLOCKED_EXTENSIONS).
    // If the gate were at bridge layer, this would throw -32010.
    // The gate is at handler layer so vault.init calls bridge.create directly
    // and bypasses it -- this must succeed.
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.init", { topic: "test-topic" }, 100);
    const r = await msg;

    // Must NOT return a safety error
    expect(r.error).toBeUndefined();

    const result = r.result as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(result.topic).toBe("test-topic");

    // The created array must include kb.yaml -- if it doesn't, something else went wrong
    const created = result.created as string[];
    expect(created.some((p) => p.endsWith("kb.yaml"))).toBe(true);
  });

  it("vault.init scaffold mkdirs bypass the gate (bridge.mkdir called directly)", async () => {
    // vault.init calls bridge.mkdir for directories including the topic dir itself.
    // bridge.mkdir does not pass through the vault.mkdir handler,
    // so no safety check runs even for dirs that might match blocked patterns.
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.init", { topic: "another-topic" }, 101);
    const r = await msg;

    expect(r.error).toBeUndefined();
    const result = r.result as Record<string, unknown>;
    expect(result.ok).toBe(true);

    // Verify directories were created (implying bridge.mkdir was called without gate)
    const created = result.created as string[];
    expect(created.some((p) => p.includes("another-topic"))).toBe(true);
  });

  it("vault.init is idempotent -- second call skips existing files without error", async () => {
    // First call
    const msg1 = nextMessage(ws);
    sendRpc(ws, "vault.init", { topic: "idempotent-topic" }, 102);
    await msg1;

    // Second call on same topic -- must not fail
    const msg2 = nextMessage(ws);
    sendRpc(ws, "vault.init", { topic: "idempotent-topic" }, 103);
    const r = await msg2;

    expect(r.error).toBeUndefined();
    const result = r.result as Record<string, unknown>;
    expect(result.ok).toBe(true);
    // On second call, everything should be in the skipped array
    const skipped = result.skipped as string[];
    expect(skipped.length).toBeGreaterThan(0);
  });
});
