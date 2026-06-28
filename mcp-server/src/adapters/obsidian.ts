/**
 * adapter-obsidian -- WebSocket client for the obsidian-vault-bridge plugin.
 *
 * Provides search/read/write/graph/events when Obsidian is running.
 * Reads ~/.obsidian-ws-port for port + token (written by the plugin on startup).
 * Gracefully stays unavailable (and returns []) when Obsidian is not running.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import WebSocket from "ws";
import type {
  VaultMindAdapter,
  AdapterCapability,
  SearchResult,
  SearchOpts,
  GraphData,
  FileEvent,
  Disposable,
} from "./interface.js";

const DEFAULT_PORT_FILE = join(homedir(), ".obsidian-ws-port");
const CONNECT_TIMEOUT_MS = 5_000;

export interface ObsidianAdapterConfig {
  /** Per-call RPC timeout in ms (default: 10000) */
  timeout?: number;
  /** Override port file path (default: ~/.obsidian-ws-port) */
  portFile?: string;
}

interface PortFileData {
  port: number;
  token: string;
  pid?: number;
  vault?: string;
}

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// Search result shapes from obsidian-vault-bridge
interface BridgeMatch {
  line: number;
  text: string;
  before?: string[];
  after?: string[];
}
interface BridgeSearchResult {
  path: string;
  matches: BridgeMatch[];
}

export class ObsidianAdapter implements VaultMindAdapter {
  readonly name = "obsidian";
  readonly capabilities: readonly AdapterCapability[] = [
    "search", "read", "write", "graph", "events",
  ];

  private ws: WebSocket | null = null;
  private available = false;
  private reqId = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly changeListeners: Array<(event: FileEvent) => void> = [];
  private readonly timeout: number;
  private readonly portFile: string;

  get isAvailable(): boolean { return this.available; }

  constructor(config?: ObsidianAdapterConfig) {
    this.timeout = config?.timeout ?? 10_000;
    this.portFile = config?.portFile ?? DEFAULT_PORT_FILE;
  }

  async init(): Promise<void> {
    let info: PortFileData;
    try {
      info = JSON.parse(readFileSync(this.portFile, "utf-8")) as PortFileData;
    } catch {
      process.stderr.write(
        "vault-mind: [warn] ~/.obsidian-ws-port not found -- obsidian adapter disabled\n",
      );
      return;
    }

    await new Promise<void>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${info.port}`);

      const connectTimer = setTimeout(() => {
        ws.terminate();
        process.stderr.write(
          "vault-mind: [warn] obsidian WS connect timeout -- adapter disabled\n",
        );
        resolve();
      }, CONNECT_TIMEOUT_MS);

      ws.once("open", async () => {
        clearTimeout(connectTimer);
        this.ws = ws;
        this.setupMessageHandler(ws);

        ws.once("close", () => {
          this.available = false;
          this.rejectAllPending("WebSocket closed");
          this.ws = null;
        });

        try {
          await this.call("vault.auth", { token: info.token });
          this.available = true;
        } catch (e) {
          process.stderr.write(
            `vault-mind: [warn] obsidian auth failed: ${(e as Error).message} -- adapter disabled\n`,
          );
          this.ws = null;
          ws.terminate(); // force-close so no CLOSING-state limbo blocks callers
        }
        resolve();
      });

      ws.once("error", (e) => {
        clearTimeout(connectTimer);
        process.stderr.write(
          `vault-mind: [warn] obsidian WS error: ${e.message} -- adapter disabled\n`,
        );
        resolve();
      });
    });
  }

  async dispose(): Promise<void> {
    this.available = false;
    this.rejectAllPending("Adapter disposed");
    this.changeListeners.length = 0;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      await new Promise<void>((resolve) => {
        ws.once("close", resolve);
        ws.close();
      });
    }
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    if (!this.available) return [];
    try {
      const raw = await this.call("vault.search", {
        query,
        maxResults: opts?.maxResults ?? 20,
        caseSensitive: opts?.caseSensitive ?? false,
        ...(opts?.context !== undefined ? { context: opts.context } : {}),
      });
      const { results } = raw as { results: BridgeSearchResult[]; totalMatches: number };
      // Each BridgeSearchResult has multiple match lines -- flatten
      return results.flatMap((r) =>
        r.matches.map((m) => ({
          source: this.name,
          path: r.path,
          content: m.text.trim(),
          score: 0.8, // bridge doesn't produce relevance scores; use fixed value
          metadata: { line: m.line },
        })),
      );
    } catch {
      return [];
    }
  }

  async read(path: string): Promise<string> {
    if (!this.available) throw new Error("Obsidian not available");
    const raw = await this.call("vault.read", { path });
    return (raw as { content: string }).content;
  }

  async write(path: string, content: string, dryRun = false): Promise<void> {
    if (!this.available) throw new Error("Obsidian not available");
    // Try modify first; if file doesn't exist, fall through to create
    try {
      await this.call("vault.modify", { path, content, dryRun });
    } catch (e) {
      const msg = (e as Error).message;
      if (
        msg.includes("-32001") ||          // RPC_FILE_NOT_FOUND
        msg.includes("not found") ||
        msg.includes("FILE_NOT_FOUND")
      ) {
        await this.call("vault.create", { path, content, dryRun });
      } else {
        throw e;
      }
    }
  }

  async graph(): Promise<GraphData> {
    if (!this.available) return { nodes: [], edges: [] };
    try {
      return (await this.call("vault.graph", {})) as GraphData;
    } catch {
      return { nodes: [], edges: [] };
    }
  }

  onFileChange(callback: (event: FileEvent) => void): Disposable {
    this.changeListeners.push(callback);
    return {
      dispose: () => {
        const idx = this.changeListeners.indexOf(callback);
        if (idx !== -1) this.changeListeners.splice(idx, 1);
      },
    };
  }

  // --- Internal ---

  private setupMessageHandler(ws: WebSocket): void {
    ws.on("message", (raw: Buffer | string) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf-8"));
      } catch {
        return;
      }

      if (msg.id !== undefined && msg.id !== null) {
        // Response to a pending RPC call
        const id = msg.id as number;
        const p = this.pending.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(id);
        if (msg.error) {
          const e = msg.error as { code: number; message: string };
          p.reject(new Error(`RPC error ${e.code}: ${e.message}`));
        } else {
          p.resolve(msg.result);
        }
      } else if (typeof msg.method === "string") {
        // Notification (no id) -- vault file event
        this.dispatchEvent(msg.method, msg.params as Record<string, unknown> | undefined);
      }
    });
  }

  private dispatchEvent(method: string, params?: Record<string, unknown>): void {
    if (!params) return;
    const typeMap: Record<string, FileEvent["type"]> = {
      "vault:create": "create",
      "vault:modify": "modify",
      "vault:delete": "delete",
      "vault:rename": "rename",
    };
    const type = typeMap[method];
    if (!type) return;

    const event: FileEvent = {
      type,
      path: (params.path as string) ?? "",
      oldPath: type === "rename" ? (params.oldPath as string | undefined) : undefined,
      timestamp: Date.now(),
    };
    for (const cb of this.changeListeners) cb(event);
  }

  private call(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }
      const id = ++this.reqId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method} (${this.timeout}ms)`));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        (e) => {
          if (e) {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(e);
          }
        },
      );
    });
  }

  private rejectAllPending(reason: string): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
