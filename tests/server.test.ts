/**
 * Test A: WsServer auth gate
 *
 * Spins up a real WsServer on port 0 (OS-assigned), connects a real WebSocket
 * client, and verifies:
 *   1. Non-authenticate message before auth -> server closes the socket (code 4002)
 *   2. authenticate with wrong token -> JSON-RPC error response, then close (code 4003)
 *   3. authenticate with correct token -> success result with capabilities list
 *   4. After auth, listCapabilities works
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { WsServer } from "../src/server";

const TOKEN = "test-secret-token-abc123";

function startServer(): Promise<{ server: WsServer; port: number }> {
  return new Promise((resolve) => {
    const server = new WsServer(
      { port: 0, token: TOKEN },
      (resolvedPort) => resolve({ server, port: resolvedPort }),
    );
    server.start();
  });
}

function connect(port: number): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}`);
}

function sendRpc(
  ws: WebSocket,
  method: string,
  params: Record<string, unknown>,
  id: number,
): void {
  ws.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
}

/** Waits for the next message from the socket and parses it as JSON. */
function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => {
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(e);
      }
    });
    ws.once("error", reject);
  });
}

/** Waits for the socket close event and returns the close code. */
function nextClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once("close", (code) => resolve(code));
  });
}

let server: WsServer;
let port: number;

beforeEach(async () => {
  ({ server, port } = await startServer());
});

afterEach(() => {
  server.stop();
});

describe("WsServer auth gate", () => {
  it("closes with code 4002 when first message is not authenticate", async () => {
    const ws = connect(port);
    await new Promise<void>((res) => ws.once("open", () => res()));

    const closedCode = nextClose(ws);
    sendRpc(ws, "vault.exists", { path: "note.md" }, 1);

    expect(await closedCode).toBe(4002);
  });

  it("returns permission-denied error and closes with 4003 on wrong token", async () => {
    const ws = connect(port);
    await new Promise<void>((res) => ws.once("open", () => res()));

    const msgPromise = nextMessage(ws);
    const closePromise = nextClose(ws);
    sendRpc(ws, "authenticate", { token: "wrong-token" }, 1);

    const msg = await msgPromise;
    expect(msg.error).toBeDefined();
    expect((msg.error as Record<string, unknown>).code).toBe(-32003); // RPC_PERMISSION_DENIED

    expect(await closePromise).toBe(4003);
  });

  it("returns ok:true with capabilities on correct token", async () => {
    const ws = connect(port);
    await new Promise<void>((res) => ws.once("open", () => res()));

    const msgPromise = nextMessage(ws);
    sendRpc(ws, "authenticate", { token: TOKEN }, 1);

    const msg = await msgPromise;
    expect(msg.error).toBeUndefined();
    const result = msg.result as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.capabilities)).toBe(true);
    expect((result.capabilities as string[]).includes("listCapabilities")).toBe(true);

    ws.close();
  });

  it("dispatches listCapabilities after successful auth", async () => {
    const ws = connect(port);
    await new Promise<void>((res) => ws.once("open", () => res()));

    // auth
    sendRpc(ws, "authenticate", { token: TOKEN }, 1);
    await nextMessage(ws); // consume auth response

    // call listCapabilities
    const capMsg = nextMessage(ws);
    sendRpc(ws, "listCapabilities", {}, 2);

    const msg = await capMsg;
    expect(msg.error).toBeUndefined();
    const result = msg.result as Record<string, unknown>;
    expect(Array.isArray(result.methods)).toBe(true);
    expect(result.version).toBe("0.1.0");

    ws.close();
  });
});
