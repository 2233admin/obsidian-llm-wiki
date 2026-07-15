/**
 * RAGAnythingAdapter -- optional multimodal RAG bridge for HKUDS RAG-Anything.
 *
 * RAG-Anything is primarily a Python framework, so this adapter deliberately
 * targets a tiny HTTP wrapper contract instead of vendoring Python runtime code.
 *
 * Env:
 *   RAGANYTHING_URL=http://127.0.0.1:9622
 *   RAGANYTHING_API_KEY=...                 optional Bearer token
 *   RAGANYTHING_QUERY_PATH=/query           optional query endpoint
 *   RAGANYTHING_PROCESS_PATH=/process_document optional ingest endpoint
 */

import type {
  AdapterCapability,
  SearchOpts,
  SearchResult,
  VaultMindAdapter,
} from "./interface.js";

type RAGAnythingAdapterOpts = {
  baseUrl?: string;
  apiKey?: string;
  queryPath?: string;
  processPath?: string;
  fetchImpl?: typeof fetch;
};

export type RAGAnythingProcessRequest = {
  filePath: string;
  sourcePath?: string;
  parser?: string;
  docId?: string;
  outputFormat?: "markdown" | "content_list";
};

export type RAGAnythingProcessResult = {
  markdown: string;
  contentList?: unknown[];
  metadata: Record<string, unknown>;
};

type QueryBody = {
  results?: unknown;
  chunks?: unknown;
  sources?: unknown;
  response?: unknown;
  answer?: unknown;
};

type ChunkLike = {
  id?: unknown;
  doc_id?: unknown;
  docId?: unknown;
  file_path?: unknown;
  filePath?: unknown;
  source?: unknown;
  content?: unknown;
  text?: unknown;
  markdown?: unknown;
  score?: unknown;
  page_idx?: unknown;
  page?: unknown;
  type?: unknown;
};

type ProcessBody = {
  markdown?: unknown;
  content?: unknown;
  text?: unknown;
  content_list?: unknown;
  contentList?: unknown;
  metadata?: unknown;
  doc_id?: unknown;
  docId?: unknown;
};

export class RAGAnythingAdapter implements VaultMindAdapter {
  readonly name = "raganything";
  readonly capabilities: readonly AdapterCapability[] = ["search"];

  private _available = false;
  private readonly baseUrl?: string;
  private readonly apiKey?: string;
  private readonly queryPath: string;
  private readonly processPath: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts?: RAGAnythingAdapterOpts) {
    this.baseUrl = normalizeBaseUrl(opts?.baseUrl ?? process.env.RAGANYTHING_URL);
    this.apiKey = opts?.apiKey ?? process.env.RAGANYTHING_API_KEY;
    this.queryPath = normalizePath(opts?.queryPath ?? process.env.RAGANYTHING_QUERY_PATH ?? "/query");
    this.processPath = normalizePath(opts?.processPath ?? process.env.RAGANYTHING_PROCESS_PATH ?? "/process_document");
    this.fetchImpl = opts?.fetchImpl ?? fetch;
  }

  get isAvailable(): boolean {
    return this._available;
  }

  async init(): Promise<void> {
    if (!this.baseUrl) {
      this._available = false;
      process.stderr.write("llmwiki: [raganything] RAGANYTHING_URL not set -- adapter disabled\n");
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
      process.stderr.write(`llmwiki: [raganything] unavailable at ${this.baseUrl} -- adapter disabled\n`);
    }
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    if (!this._available || !this.baseUrl) return [];
    const limit = opts?.maxResults ?? 20;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${this.queryPath}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          query,
          top_k: limit,
          max_results: limit,
        }),
      });
      if (!res.ok) return [];
      const body = await res.json() as QueryBody;
      return this.mapQueryBody(body, limit);
    } catch {
      return [];
    }
  }

  async processDocument(req: RAGAnythingProcessRequest): Promise<RAGAnythingProcessResult> {
    if (!this._available || !this.baseUrl) {
      throw new Error("RAG-Anything adapter is not available");
    }

    const res = await this.fetchImpl(`${this.baseUrl}${this.processPath}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        file_path: req.filePath,
        source_path: req.sourcePath,
        parser: req.parser,
        doc_id: req.docId,
        output_format: req.outputFormat ?? "markdown",
      }),
    });
    if (!res.ok) throw new Error(`RAG-Anything process failed: HTTP ${res.status}`);

    const body = await res.json() as ProcessBody;
    const markdown = stringValue(body.markdown)
      ?? stringValue(body.content)
      ?? stringValue(body.text)
      ?? "";
    const contentList = arrayValue(body.content_list) ?? arrayValue(body.contentList);
    const metadata = objectValue(body.metadata) ?? {};
    const docId = stringValue(body.doc_id) ?? stringValue(body.docId);
    if (docId) metadata.docId = docId;
    if (req.parser) metadata.parser = req.parser;

    return { markdown: markdown || contentListToMarkdown(contentList), contentList, metadata };
  }

  async dispose(): Promise<void> {
    // HTTP adapter -- nothing to clean up.
  }

  private mapQueryBody(body: QueryBody, limit: number): SearchResult[] {
    const chunks = Array.isArray(body.results)
      ? body.results
      : Array.isArray(body.chunks)
        ? body.chunks
        : Array.isArray(body.sources)
          ? body.sources
          : [];

    if (chunks.length > 0) {
      return chunks.slice(0, limit).map((raw, index) => {
        const c = raw as ChunkLike;
        const filePath = stringValue(c.file_path) ?? stringValue(c.filePath) ?? stringValue(c.source);
        const docId = stringValue(c.doc_id) ?? stringValue(c.docId);
        const id = stringValue(c.id);
        const content = stringValue(c.content)
          ?? stringValue(c.text)
          ?? stringValue(c.markdown)
          ?? JSON.stringify(raw);
        const score = numberValue(c.score) ?? 1 / (index + 1);

        return {
          source: this.name,
          path: filePath ?? docId ?? id ?? `raganything:/chunk/${index}`,
          content,
          score,
          metadata: {
            id,
            docId,
            filePath,
            page: c.page_idx ?? c.page,
            type: c.type,
          },
        };
      });
    }

    const answer = stringValue(body.response) ?? stringValue(body.answer);
    if (!answer) return [];
    return [{
      source: this.name,
      path: "raganything:/query",
      content: answer,
      score: 1,
      metadata: {},
    }];
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }
}

function normalizeBaseUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "");
}

function normalizePath(raw: string): string {
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function stringValue(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function numberValue(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function arrayValue(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

function objectValue(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}

function contentListToMarkdown(contentList?: unknown[]): string {
  if (!contentList || contentList.length === 0) return "";
  const blocks: string[] = [];
  for (const raw of contentList) {
    const item = objectValue(raw);
    if (!item) continue;
    const type = stringValue(item.type) ?? "block";
    const page = item.page_idx ?? item.page;
    const prefix = page === undefined ? `<!-- ${type} -->` : `<!-- ${type} page=${page} -->`;
    const text = stringValue(item.text)
      ?? stringValue(item.markdown)
      ?? stringValue(item.table_body)
      ?? stringValue(item.latex)
      ?? stringValue(item.image_caption);
    if (text) blocks.push(`${prefix}\n\n${text}`);
  }
  return blocks.join("\n\n");
}
