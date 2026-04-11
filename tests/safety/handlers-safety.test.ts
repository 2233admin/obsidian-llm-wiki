/**
 * Handler-layer safety gate tests.
 *
 * Tests that the six gated handlers (create, modify, append, delete, rename, mkdir)
 * correctly apply the safety gate, and that settings.safety.enabled=false disables it.
 *
 * Uses the same WsServer/VaultBridge/MockApp pattern as tests/handlers.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { WsServer } from "../../src/server";
import { VaultBridge } from "../../src/bridge";
import { registerHandlers } from "../../src/handlers";
import { MockApp } from "../mocks/obsidian";
import { DEFAULT_SETTINGS } from "../../src/types";
import { RPC_SAFETY_PATH_BLOCKED, RPC_SAFETY_CONTENT_REJECTED } from "../../src/protocol";

const TOKEN = "safety-test-token";

const SEED: Record<string, string> = {
  "notes/existing.md": "---\ntitle: Existing\n---\n\nSome content with [[Link]] and https://a.example\n",
};

type SafetySettings = typeof DEFAULT_SETTINGS["safety"];

function startServer(safetyOverride?: Partial<SafetySettings>): Promise<{ server: WsServer; port: number }> {
  return new Promise((resolve) => {
    const app = new MockApp(SEED);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = new VaultBridge(app as any);
    const settings = {
      ...DEFAULT_SETTINGS,
      token: TOKEN,
      dryRunDefault: false,
      safety: { ...DEFAULT_SETTINGS.safety, ...safetyOverride },
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

async function authenticate(ws: WebSocket): Promise<void> {
  const auth = nextMessage(ws);
  sendRpc(ws, "authenticate", { token: TOKEN }, 0);
  await auth;
}

let server: WsServer;
let port: number;
let ws: WebSocket;

beforeEach(async () => {
  ({ server, port } = await startServer());
  ws = connect(port);
  await new Promise<void>((res) => ws.once("open", () => res()));
  await authenticate(ws);
});

afterEach(() => {
  ws.close();
  server.stop();
});


// ---------- vault.create ----------

describe("vault.create gate", () => {
  it("safe path + valid content succeeds (dry-run)", async () => {
    // Content must have frontmatter because requireFrontmatter defaults to "new-files-only"
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.create", {
      path: "notes/new-note.md",
      content: "---\ntitle: Hello\n---\n\n# Hello\n\nGood content.\n",
      dryRun: true,
    }, 1);
    const r = await msg;
    expect(r.error).toBeUndefined();
    const result = r.result as Record<string, unknown>;
    expect(result.dryRun).toBe(true);
  });

  it("blocked path throws RPC_SAFETY_PATH_BLOCKED", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.create", { path: ".obsidian/config.json", content: "{}", dryRun: true }, 2);
    const r = await msg;
    expect(r.error).toBeDefined();
    const err = r.error as Record<string, unknown>;
    expect(err.code).toBe(RPC_SAFETY_PATH_BLOCKED);
    const data = err.data as Record<string, unknown>;
    expect(data.gate).toBe("path");
  });

  it("blocked extension throws RPC_SAFETY_PATH_BLOCKED", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.create", { path: "notes/script.py", content: "print('hi')", dryRun: true }, 3);
    const r = await msg;
    expect(r.error).toBeDefined();
    expect((r.error as Record<string, unknown>).code).toBe(RPC_SAFETY_PATH_BLOCKED);
  });

  it("invalid content (unclosed code fence) throws RPC_SAFETY_CONTENT_REJECTED", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.create", { path: "notes/broken.md", content: "# Title\n\n```python\nprint('hi')\n", dryRun: true }, 4);
    const r = await msg;
    expect(r.error).toBeDefined();
    const err = r.error as Record<string, unknown>;
    expect(err.code).toBe(RPC_SAFETY_CONTENT_REJECTED);
    const data = err.data as Record<string, unknown>;
    expect(data.gate).toBe("content");
    expect(Array.isArray(data.errors)).toBe(true);
  });
});


// ---------- vault.modify ----------

describe("vault.modify gate", () => {
  it("safe path + valid content succeeds (dry-run)", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.modify", { path: "notes/existing.md", content: "---\ntitle: Updated\n---\n\nNew body with [[Link]] and https://a.example\n", dryRun: true }, 10);
    const r = await msg;
    expect(r.error).toBeUndefined();
    expect((r.result as Record<string, unknown>).dryRun).toBe(true);
  });

  it("blocked path throws RPC_SAFETY_PATH_BLOCKED", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.modify", { path: ".git/config", content: "evil", dryRun: true }, 11);
    const r = await msg;
    expect(r.error).toBeDefined();
    expect((r.error as Record<string, unknown>).code).toBe(RPC_SAFETY_PATH_BLOCKED);
  });

  it("content with wikilink mismatch throws RPC_SAFETY_CONTENT_REJECTED", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.modify", { path: "notes/existing.md", content: "see [[Unclosed bracket\n", dryRun: true }, 12);
    const r = await msg;
    expect(r.error).toBeDefined();
    expect((r.error as Record<string, unknown>).code).toBe(RPC_SAFETY_CONTENT_REJECTED);
  });
});


// ---------- vault.append ----------

describe("vault.append gate", () => {
  it("safe path + valid content succeeds (dry-run)", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.append", { path: "notes/existing.md", content: "\n\nAppended text.\n", dryRun: true }, 20);
    const r = await msg;
    expect(r.error).toBeUndefined();
    expect((r.result as Record<string, unknown>).dryRun).toBe(true);
  });

  it("blocked path throws RPC_SAFETY_PATH_BLOCKED", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.append", { path: ".obsidian/plugins/plugin.js", content: "evil", dryRun: true }, 21);
    const r = await msg;
    expect(r.error).toBeDefined();
    expect((r.error as Record<string, unknown>).code).toBe(RPC_SAFETY_PATH_BLOCKED);
  });

  it("appended content creating unclosed fence throws RPC_SAFETY_CONTENT_REJECTED", async () => {
    // Existing file has even fences (none), appending one opening fence -> odd
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.append", { path: "notes/existing.md", content: "\n```python\nunclosed\n", dryRun: true }, 22);
    const r = await msg;
    expect(r.error).toBeDefined();
    expect((r.error as Record<string, unknown>).code).toBe(RPC_SAFETY_CONTENT_REJECTED);
  });
});


// ---------- vault.delete ----------

describe("vault.delete gate", () => {
  it("safe path succeeds (dry-run)", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.delete", { path: "notes/existing.md", dryRun: true }, 30);
    const r = await msg;
    expect(r.error).toBeUndefined();
    expect((r.result as Record<string, unknown>).dryRun).toBe(true);
  });

  it("blocked path throws RPC_SAFETY_PATH_BLOCKED", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.delete", { path: ".git/HEAD", dryRun: true }, 31);
    const r = await msg;
    expect(r.error).toBeDefined();
    expect((r.error as Record<string, unknown>).code).toBe(RPC_SAFETY_PATH_BLOCKED);
  });
});


// ---------- vault.rename ----------

describe("vault.rename gate", () => {
  it("safe from and to succeeds (dry-run)", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.rename", { from: "notes/existing.md", to: "notes/renamed.md", dryRun: true }, 40);
    const r = await msg;
    expect(r.error).toBeUndefined();
    expect((r.result as Record<string, unknown>).dryRun).toBe(true);
  });

  it("blocked 'from' throws RPC_SAFETY_PATH_BLOCKED with rejected:from", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.rename", { from: ".obsidian/app.json", to: "notes/ok.md", dryRun: true }, 41);
    const r = await msg;
    expect(r.error).toBeDefined();
    const err = r.error as Record<string, unknown>;
    expect(err.code).toBe(RPC_SAFETY_PATH_BLOCKED);
    expect((err.data as Record<string, unknown>).rejected).toBe("from");
  });

  it("blocked 'to' throws RPC_SAFETY_PATH_BLOCKED with rejected:to", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.rename", { from: "notes/existing.md", to: ".obsidian/stolen.json", dryRun: true }, 42);
    const r = await msg;
    expect(r.error).toBeDefined();
    const err = r.error as Record<string, unknown>;
    expect(err.code).toBe(RPC_SAFETY_PATH_BLOCKED);
    expect((err.data as Record<string, unknown>).rejected).toBe("to");
  });
});


// ---------- vault.mkdir ----------

describe("vault.mkdir gate", () => {
  it("rejects .obsidian/plugins with RPC_SAFETY_PATH_BLOCKED", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.mkdir", { path: ".obsidian/plugins", dryRun: true }, 50);
    const r = await msg;
    expect(r.error).toBeDefined();
    expect((r.error as Record<string, unknown>).code).toBe(RPC_SAFETY_PATH_BLOCKED);
  });

  it("allows normal directory creation (dry-run)", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.mkdir", { path: "notes/new-topic", dryRun: true }, 51);
    const r = await msg;
    expect(r.error).toBeUndefined();
    const result = r.result as Record<string, unknown>;
    expect(result.dryRun).toBe(true);
    expect(result.action).toBe("mkdir");
  });

  it("rejects .git directory", async () => {
    const msg = nextMessage(ws);
    sendRpc(ws, "vault.mkdir", { path: ".git/refs", dryRun: true }, 52);
    const r = await msg;
    expect(r.error).toBeDefined();
    expect((r.error as Record<string, unknown>).code).toBe(RPC_SAFETY_PATH_BLOCKED);
  });
});


// ---------- safety.enabled = false disables the gate ----------

describe("safety.enabled = false disables all gates", () => {
  let disabledServer: WsServer;
  let disabledPort: number;
  let disabledWs: WebSocket;

  beforeEach(async () => {
    ({ server: disabledServer, port: disabledPort } = await startServer({ enabled: false }));
    disabledWs = connect(disabledPort);
    await new Promise<void>((res) => disabledWs.once("open", () => res()));
    const auth = nextMessage(disabledWs);
    sendRpc(disabledWs, "authenticate", { token: TOKEN }, 0);
    await auth;
  });

  afterEach(() => {
    disabledWs.close();
    disabledServer.stop();
  });

  it("vault.create with blocked path succeeds when safety disabled (dry-run)", async () => {
    // Note: .obsidian/config.json would normally be blocked, but with safety disabled it passes
    // path validation (validatePath still runs, but the safety gate does not).
    // We use a .ts extension which is blocked by safety but not by validatePath.
    const msg = nextMessage(disabledWs);
    sendRpc(disabledWs, "vault.create", { path: "notes/script.ts", content: "const x = 1;", dryRun: true }, 60);
    const r = await msg;
    // Should NOT get a safety error
    if (r.error) {
      const err = r.error as Record<string, unknown>;
      expect(err.code).not.toBe(RPC_SAFETY_PATH_BLOCKED);
      expect(err.code).not.toBe(RPC_SAFETY_CONTENT_REJECTED);
    } else {
      expect(r.result).toBeDefined();
    }
  });

  it("vault.mkdir with blocked path succeeds when safety disabled (P2-1 kill-switch regression)", async () => {
    // Regression test for P2-1 fix in commit 703e8e6:
    // Before the fix, vault.mkdir was missing the `if (settings.safety?.enabled !== false)`
    // kill-switch wrapper that every sibling handler already had. Users disabling the
    // global safety gate would still get mkdir rejections -- a confusing partial-enforcement
    // failure mode. This test pins the invariant that mkdir respects the kill switch.
    //
    // validatePath does NOT block `.obsidian/*` (only traversal markers `..` and `.`),
    // so the only rejection path is the safety gate. With safety disabled, mkdir should
    // reach the dry-run branch and report `action: "mkdir"`.
    const msg = nextMessage(disabledWs);
    sendRpc(disabledWs, "vault.mkdir", { path: ".obsidian/plugins", dryRun: true }, 61);
    const r = await msg;
    // Should NOT get a safety error
    expect(r.error).toBeUndefined();
    const result = r.result as Record<string, unknown>;
    expect(result.dryRun).toBe(true);
    expect(result.action).toBe("mkdir");
    expect(result.path).toBe(".obsidian/plugins");
  });
});


// ---------- allowCanvas propagation across write handlers ----------

describe("allowCanvas propagation across write handlers", () => {
  const CANVAS_PATH = "notes/test.canvas";

  describe("vault.create", () => {
    it("blocks .canvas when allowCanvas is false (default)", async () => {
      const msg = nextMessage(ws);
      sendRpc(ws, "vault.create", {
        path: CANVAS_PATH,
        content: "{}",
        dryRun: true,
      }, 100);
      const r = await msg;
      expect(r.error).toBeDefined();
      expect((r.error as Record<string, unknown>).code).toBe(RPC_SAFETY_PATH_BLOCKED);
    });

    it("allows .canvas when allowCanvas is true", async () => {
      let canvasServer: WsServer;
      let canvasPort: number;
      let canvasWs: WebSocket;
      ({ server: canvasServer, port: canvasPort } = await startServer({ allowCanvas: true }));
      canvasWs = connect(canvasPort);
      await new Promise<void>((res) => canvasWs.once("open", () => res()));
      const auth = nextMessage(canvasWs);
      sendRpc(canvasWs, "authenticate", { token: TOKEN }, 0);
      await auth;

      const msg = nextMessage(canvasWs);
      sendRpc(canvasWs, "vault.create", { path: CANVAS_PATH, content: "{}", dryRun: true }, 101);
      const r = await msg;
      canvasWs.close();
      canvasServer.stop();
      if (r.error) {
        expect((r.error as Record<string, unknown>).code).not.toBe(RPC_SAFETY_PATH_BLOCKED);
      } else {
        expect(r.result).toBeDefined();
      }
    });
  });

  describe("vault.modify", () => {
    it("blocks .canvas when allowCanvas is false (default)", async () => {
      const msg = nextMessage(ws);
      sendRpc(ws, "vault.modify", { path: CANVAS_PATH, content: "{}", dryRun: true }, 110);
      const r = await msg;
      expect(r.error).toBeDefined();
      expect((r.error as Record<string, unknown>).code).toBe(RPC_SAFETY_PATH_BLOCKED);
    });

    it("allows .canvas when allowCanvas is true", async () => {
      let canvasServer: WsServer;
      let canvasPort: number;
      let canvasWs: WebSocket;
      ({ server: canvasServer, port: canvasPort } = await startServer({ allowCanvas: true }));
      canvasWs = connect(canvasPort);
      await new Promise<void>((res) => canvasWs.once("open", () => res()));
      const auth = nextMessage(canvasWs);
      sendRpc(canvasWs, "authenticate", { token: TOKEN }, 0);
      await auth;

      const msg = nextMessage(canvasWs);
      sendRpc(canvasWs, "vault.modify", { path: CANVAS_PATH, content: "{}", dryRun: true }, 111);
      const r = await msg;
      canvasWs.close();
      canvasServer.stop();
      if (r.error) {
        expect((r.error as Record<string, unknown>).code).not.toBe(RPC_SAFETY_PATH_BLOCKED);
      } else {
        expect(r.result).toBeDefined();
      }
    });
  });

  describe("vault.append", () => {
    it("blocks .canvas when allowCanvas is false (default)", async () => {
      const msg = nextMessage(ws);
      sendRpc(ws, "vault.append", { path: CANVAS_PATH, content: "{}", dryRun: true }, 120);
      const r = await msg;
      expect(r.error).toBeDefined();
      expect((r.error as Record<string, unknown>).code).toBe(RPC_SAFETY_PATH_BLOCKED);
    });

    it("allows .canvas when allowCanvas is true", async () => {
      let canvasServer: WsServer;
      let canvasPort: number;
      let canvasWs: WebSocket;
      ({ server: canvasServer, port: canvasPort } = await startServer({ allowCanvas: true }));
      canvasWs = connect(canvasPort);
      await new Promise<void>((res) => canvasWs.once("open", () => res()));
      const auth = nextMessage(canvasWs);
      sendRpc(canvasWs, "authenticate", { token: TOKEN }, 0);
      await auth;

      const msg = nextMessage(canvasWs);
      sendRpc(canvasWs, "vault.append", { path: CANVAS_PATH, content: "{}", dryRun: true }, 121);
      const r = await msg;
      canvasWs.close();
      canvasServer.stop();
      if (r.error) {
        expect((r.error as Record<string, unknown>).code).not.toBe(RPC_SAFETY_PATH_BLOCKED);
      } else {
        expect(r.result).toBeDefined();
      }
    });
  });

  describe("vault.delete", () => {
    it("blocks .canvas when allowCanvas is false (default)", async () => {
      const msg = nextMessage(ws);
      sendRpc(ws, "vault.delete", { path: CANVAS_PATH, dryRun: true }, 130);
      const r = await msg;
      expect(r.error).toBeDefined();
      expect((r.error as Record<string, unknown>).code).toBe(RPC_SAFETY_PATH_BLOCKED);
    });

    it("allows .canvas when allowCanvas is true", async () => {
      let canvasServer: WsServer;
      let canvasPort: number;
      let canvasWs: WebSocket;
      ({ server: canvasServer, port: canvasPort } = await startServer({ allowCanvas: true }));
      canvasWs = connect(canvasPort);
      await new Promise<void>((res) => canvasWs.once("open", () => res()));
      const auth = nextMessage(canvasWs);
      sendRpc(canvasWs, "authenticate", { token: TOKEN }, 0);
      await auth;

      const msg = nextMessage(canvasWs);
      sendRpc(canvasWs, "vault.delete", { path: CANVAS_PATH, dryRun: true }, 131);
      const r = await msg;
      canvasWs.close();
      canvasServer.stop();
      if (r.error) {
        expect((r.error as Record<string, unknown>).code).not.toBe(RPC_SAFETY_PATH_BLOCKED);
      } else {
        expect(r.result).toBeDefined();
      }
    });
  });

  describe("vault.rename", () => {
    it("blocks .canvas destination when allowCanvas is false (default)", async () => {
      const msg = nextMessage(ws);
      sendRpc(ws, "vault.rename", { from: "notes/existing.md", to: CANVAS_PATH, dryRun: true }, 140);
      const r = await msg;
      expect(r.error).toBeDefined();
      expect((r.error as Record<string, unknown>).code).toBe(RPC_SAFETY_PATH_BLOCKED);
    });

    it("allows .canvas destination when allowCanvas is true", async () => {
      let canvasServer: WsServer;
      let canvasPort: number;
      let canvasWs: WebSocket;
      ({ server: canvasServer, port: canvasPort } = await startServer({ allowCanvas: true }));
      canvasWs = connect(canvasPort);
      await new Promise<void>((res) => canvasWs.once("open", () => res()));
      const auth = nextMessage(canvasWs);
      sendRpc(canvasWs, "authenticate", { token: TOKEN }, 0);
      await auth;

      const msg = nextMessage(canvasWs);
      sendRpc(canvasWs, "vault.rename", { from: "notes/existing.md", to: CANVAS_PATH, dryRun: true }, 141);
      const r = await msg;
      canvasWs.close();
      canvasServer.stop();
      if (r.error) {
        expect((r.error as Record<string, unknown>).code).not.toBe(RPC_SAFETY_PATH_BLOCKED);
      } else {
        expect(r.result).toBeDefined();
      }
    });
  });

  describe("vault.mkdir", () => {
    it("blocks .canvas-suffixed dir when allowCanvas is false (default)", async () => {
      const msg = nextMessage(ws);
      sendRpc(ws, "vault.mkdir", { path: "notes/board.canvas", dryRun: true }, 150);
      const r = await msg;
      expect(r.error).toBeDefined();
      expect((r.error as Record<string, unknown>).code).toBe(RPC_SAFETY_PATH_BLOCKED);
    });

    it("allows .canvas-suffixed dir when allowCanvas is true", async () => {
      let canvasServer: WsServer;
      let canvasPort: number;
      let canvasWs: WebSocket;
      ({ server: canvasServer, port: canvasPort } = await startServer({ allowCanvas: true }));
      canvasWs = connect(canvasPort);
      await new Promise<void>((res) => canvasWs.once("open", () => res()));
      const auth = nextMessage(canvasWs);
      sendRpc(canvasWs, "authenticate", { token: TOKEN }, 0);
      await auth;

      const msg = nextMessage(canvasWs);
      sendRpc(canvasWs, "vault.mkdir", { path: "notes/board.canvas", dryRun: true }, 151);
      const r = await msg;
      canvasWs.close();
      canvasServer.stop();
      if (r.error) {
        expect((r.error as Record<string, unknown>).code).not.toBe(RPC_SAFETY_PATH_BLOCKED);
      } else {
        expect(r.result).toBeDefined();
      }
    });
  });
});
