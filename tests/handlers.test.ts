import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { VaultBridge } from "../src/bridge";
import { registerHandlers } from "../src/handlers";
import { WsServer } from "../src/server";
import { DEFAULT_SETTINGS } from "../src/types";
import { createMockApp } from "./mocks/obsidian";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

describe("registerHandlers", () => {
  const servers: WsServer[] = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.stop();
    }
  });

  it("routes vault.read through JSON-RPC and returns the file content", async () => {
    const app = createMockApp([
      {
        path: "wiki/topic.md",
        content: "# Topic\nhello from the mock vault\n",
      },
    ]);
    const bridge = new VaultBridge(app);

    let resolvePort: ((value: number) => void) | null = null;
    const portPromise = new Promise<number>((resolve) => {
      resolvePort = resolve;
    });

    const server = new WsServer({ port: 0, token: "handler-token" }, (port) => {
      resolvePort?.(port);
    });
    registerHandlers(server, bridge, {
      ...DEFAULT_SETTINGS,
      token: "handler-token",
      dryRunDefault: true,
    });
    server.start();
    servers.push(server);

    const port = await portPromise;
    const client = await connectClient(port);

    client.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "authenticate",
        params: { token: "handler-token" },
      }),
    );
    await waitForMessage(client);

    client.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "vault.read",
        params: { path: "wiki/topic.md" },
      }),
    );

    const response = await waitForMessage(client);
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: "# Topic\nhello from the mock vault\n",
      },
    });

    client.close();
  });

  it("vault.batch rejects non-string method with RPC_INVALID_PARAMS", async () => {
    const app = createMockApp([]);
    const bridge = new VaultBridge(app);

    let resolvePort: ((value: number) => void) | null = null;
    const portPromise = new Promise<number>((resolve) => {
      resolvePort = resolve;
    });

    const server = new WsServer({ port: 0, token: "handler-token" }, (port) => {
      resolvePort?.(port);
    });
    registerHandlers(server, bridge, {
      ...DEFAULT_SETTINGS,
      token: "handler-token",
    });
    server.start();
    servers.push(server);

    const port = await portPromise;
    const client = await connectClient(port);

    client.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "authenticate",
        params: { token: "handler-token" },
      }),
    );
    await waitForMessage(client);

    client.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "vault.batch",
        params: { operations: [{ method: 42, params: {} }] },
      }),
    );

    const response = await waitForMessage(client);
    expect(response).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        results: [
          {
            index: 0,
            ok: false,
            error: {
              code: -32602, // RPC_INVALID_PARAMS
            },
          },
        ],
        summary: {
          total: 1,
          succeeded: 0,
          failed: 1,
        },
      },
    });
    expect(response.result?.results[0]?.error?.message).toContain("vault.*");

    client.close();
  });
});

async function connectClient(port: number): Promise<WebSocket> {
  return await new Promise<WebSocket>((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    client.once("open", () => resolve(client));
    client.once("error", reject);
  });
}

async function waitForMessage(client: WebSocket): Promise<JsonRpcResponse> {
  return await new Promise<JsonRpcResponse>((resolve, reject) => {
    client.once("message", (raw) => {
      try {
        resolve(JSON.parse(raw.toString()) as JsonRpcResponse);
      } catch (error) {
        reject(error);
      }
    });
    client.once("error", reject);
  });
}
