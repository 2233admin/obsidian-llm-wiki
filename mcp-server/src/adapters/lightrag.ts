/**
 * LightRAGAdapter -- optional retrieval adapter for HKUDS LightRAG servers.
 *
 * This adapter is intentionally thin: LLM Wiki does not vendor or reimplement
 * LightRAG. It calls an already-running LightRAG HTTP server and maps returned
 * context chunks into VaultMindAdapter SearchResult objects.
 *
 * Runtime configuration is injected by the Settings-derived adapter profile.
 * This class deliberately never reads process.env or resolves Secret References.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type {
  AdapterCapability,
  SearchOpts,
  SearchResult,
  VaultMindAdapter,
} from "./interface.js";

export type LightRAGAdapterOpts = {
  baseUrl?: string;
  apiKey?: string;
  mode?: string;
  queryPath?: string;
  queryDataPath?: string;
  documentsTextPath?: string;
  documentsUploadPath?: string;
  fetchImpl?: typeof fetch;
};

export type LightRAGInsertTextRequest = {
  text: string;
  fileSource?: string;
};

export type LightRAGUploadFileRequest = {
  filePath: string;
  fileName?: string;
};

export type LightRAGDocumentResult = {
  ok: boolean;
  trackId?: string;
  status?: string;
  raw: unknown;
};

type LightRAGChunk = {
  id?: unknown;
  file_path?: unknown;
  full_doc_id?: unknown;
  content?: unknown;
  chunk_order_index?: unknown;
  score?: unknown;
};

type LightRAGQueryData = {
  response?: unknown;
  data?: unknown;
  chunks?: unknown;
  sources?: unknown;
  references?: unknown;
};

export class LightRAGAdapter implements VaultMindAdapter {
  readonly name = "lightrag";
  readonly capabilities: readonly AdapterCapability[] = ["search"];

  private _available = false;
  private readonly baseUrl?: string;
  private readonly apiKey?: string;
  private readonly mode: string;
  private readonly queryPath: string;
  private readonly queryDataPath: string;
  private readonly documentsTextPath: string;
  private readonly documentsUploadPath: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: LightRAGAdapterOpts = {}) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.apiKey = opts.apiKey;
    this.mode = opts.mode ?? "hybrid";
    this.queryPath = normalizePath(opts.queryPath ?? "/query");
    this.queryDataPath = normalizePath(opts.queryDataPath ?? "/query/data");
    this.documentsTextPath = normalizePath(opts.documentsTextPath ?? "/documents/text");
    this.documentsUploadPath = normalizePath(opts.documentsUploadPath ?? "/documents/upload");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  get isAvailable(): boolean {
    return this._available;
  }

  async init(): Promise<void> {
    if (!this.baseUrl) {
      this._available = false;
      process.stderr.write("llmwiki: [lightrag] base URL not configured -- adapter disabled\n");
      return;
    }

    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, {
        method: "GET",
        headers: this.headers(),
      });
      this._available = res.ok;
    } catch {
      this._available = false;
    }

    if (!this._available) {
      process.stderr.write(`llmwiki: [lightrag] unavailable at ${this.baseUrl} -- adapter disabled\n`);
    }
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    if (!this._available || !this.baseUrl) return [];
    const limit = opts?.maxResults ?? 20;

    const data = await this.queryData(query, limit);
    if (data.length > 0) return data;

    return this.queryText(query, limit);
  }

  async dispose(): Promise<void> {
    // HTTP adapter -- nothing to clean up
  }

  async insertText(req: LightRAGInsertTextRequest): Promise<LightRAGDocumentResult> {
    if (!this._available || !this.baseUrl) {
      throw new Error("LightRAG adapter is not available");
    }
    const res = await this.fetchImpl(`${this.baseUrl}${this.documentsTextPath}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        text: req.text,
        file_source: req.fileSource,
      }),
    });
    const raw = await safeJson(res);
    if (!res.ok) throw new Error(`LightRAG text ingest failed: HTTP ${res.status}`);
    return mapDocumentResult(raw);
  }

  async uploadFile(req: LightRAGUploadFileRequest): Promise<LightRAGDocumentResult> {
    if (!this._available || !this.baseUrl) {
      throw new Error("LightRAG adapter is not available");
    }
    const form = new FormData();
    const bytes = readFileSync(req.filePath);
    const fileName = req.fileName ?? basename(req.filePath);
    form.append("file", new Blob([bytes]), fileName);

    const res = await this.fetchImpl(`${this.baseUrl}${this.documentsUploadPath}`, {
      method: "POST",
      headers: this.authHeaders(),
      body: form,
    });
    const raw = await safeJson(res);
    if (!res.ok) throw new Error(`LightRAG file upload failed: HTTP ${res.status}`);
    return mapDocumentResult(raw);
  }

  private async queryData(query: string, limit: number): Promise<SearchResult[]> {
    if (!this.baseUrl) return [];
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${this.queryDataPath}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          query,
          mode: this.mode,
          top_k: limit,
          only_need_context: true,
        }),
      });
      if (!res.ok) return [];
      const body = await res.json() as LightRAGQueryData;
      return this.mapQueryData(body, limit);
    } catch {
      return [];
    }
  }

  private async queryText(query: string, limit: number): Promise<SearchResult[]> {
    if (!this.baseUrl) return [];
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${this.queryPath}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          query,
          mode: this.mode,
          top_k: limit,
        }),
      });
      if (!res.ok) return [];
      const body = await res.json() as { response?: unknown; result?: unknown };
      const text = typeof body.response === "string"
        ? body.response
        : typeof body.result === "string"
          ? body.result
          : "";
      if (!text) return [];
      return [{
        source: this.name,
        path: "lightrag:/query",
        content: text,
        score: 1,
        metadata: { mode: this.mode },
      }];
    } catch {
      return [];
    }
  }

  private mapQueryData(body: LightRAGQueryData, limit: number): SearchResult[] {
    const data = body.data && typeof body.data === "object" && !Array.isArray(body.data)
      ? body.data as { chunks?: unknown; sources?: unknown }
      : undefined;
    const chunks = Array.isArray(body.chunks)
      ? body.chunks
      : Array.isArray(data?.chunks)
        ? data.chunks
      : Array.isArray(body.sources)
        ? body.sources
        : Array.isArray(data?.sources)
          ? data.sources
        : [];

    return chunks.slice(0, limit).map((raw, index) => {
      const c = raw as LightRAGChunk;
      const filePath = typeof c.file_path === "string" ? c.file_path : undefined;
      const docId = typeof c.full_doc_id === "string" ? c.full_doc_id : undefined;
      const id = typeof c.id === "string" ? c.id : undefined;
      const content = typeof c.content === "string" ? c.content : JSON.stringify(raw);
      const score = typeof c.score === "number" ? c.score : 1 / (index + 1);

      return {
        source: this.name,
        path: filePath ?? docId ?? id ?? `lightrag:/chunk/${index}`,
        content,
        score,
        metadata: {
          id,
          fullDocId: docId,
          filePath,
          chunkOrderIndex: c.chunk_order_index,
          mode: this.mode,
        },
      };
    });
  }

  private headers(): Record<string, string> {
    return { "Content-Type": "application/json", ...this.authHeaders() };
  }

  private authHeaders(): Record<string, string> {
    if (!this.apiKey) return {};
    return {
      "X-API-Key": this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
    };
  }
}

function normalizeBaseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "");
}

function normalizePath(raw: string): string {
  return raw.startsWith("/") ? raw : `/${raw}`;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function mapDocumentResult(raw: unknown): LightRAGDocumentResult {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const trackId = stringValue(obj.track_id) ?? stringValue(obj.trackId);
  const status = stringValue(obj.status) ?? stringValue(obj.message);
  return { ok: true, trackId, status, raw };
}

function stringValue(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
