/**
 * Read-only Knowledge Adapter for the Hindsight HTTP recall API.
 *
 * LLM Wiki remains the authority for Project Context, governed Memory, Sources,
 * and Promotion. This adapter deliberately implements recall only: it does not
 * expose retain or reflect and it never reads environment variables directly.
 */
import type {
  AdapterCapability,
  SearchOpts,
  SearchResult,
  VaultMindAdapter,
} from "./interface.js";

export interface HindsightAdapterOptions {
  baseUrl?: string;
  bankId?: string;
  timeoutMs?: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

type HindsightMemory = {
  id?: unknown;
  memory_id?: unknown;
  text?: unknown;
  content?: unknown;
  memory?: unknown;
  score?: unknown;
  relevance?: unknown;
  scores?: unknown;
  created_at?: unknown;
  metadata?: unknown;
};

export class HindsightAdapter implements VaultMindAdapter {
  readonly name = "hindsight";
  readonly capabilities: readonly AdapterCapability[] = ["search"];

  private available = false;
  private readonly baseUrl?: string;
  private readonly bankId?: string;
  private readonly timeoutMs: number;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HindsightAdapterOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.bankId = options.bankId?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get isAvailable(): boolean {
    return this.available;
  }

  async init(): Promise<void> {
    // No probe here: startup and Settings Doctor must not trigger external calls.
    this.available = Boolean(this.baseUrl && this.bankId && this.timeoutMs > 0);
    if (!this.available) {
      process.stderr.write("llmwiki: [hindsight] endpoint or bank is not configured -- adapter disabled\n");
    }
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    if (!this.available || !this.baseUrl || !this.bankId) return [];
    const maxResults = Math.max(1, Math.min(opts?.maxResults ?? 20, 100));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/v1/default/banks/${encodeURIComponent(this.bankId)}/memories/recall`,
        {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({ query }),
          signal: controller.signal,
        },
      );
      if (!response.ok) return [];
      const payload = await response.json() as unknown;
      return memoriesFrom(payload).slice(0, maxResults).map((memory, index) => mapMemory(this.bankId!, memory, index));
    } catch {
      // Remote error bodies and transport exceptions are intentionally not
      // reflected into diagnostics, where they might contain credentials.
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async dispose(): Promise<void> {
    this.available = false;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  return value?.trim().replace(/\/+$/, "") || undefined;
}

function memoriesFrom(payload: unknown): HindsightMemory[] {
  if (Array.isArray(payload)) return payload as HindsightMemory[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  for (const key of ["results", "memories", "items"]) {
    if (Array.isArray(record[key])) return record[key] as HindsightMemory[];
  }
  const nested = record.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return memoriesFrom(nested);
  }
  return [];
}

function mapMemory(bankId: string, memory: HindsightMemory, index: number): SearchResult {
  const id = stringValue(memory.id) ?? stringValue(memory.memory_id);
  const content = stringValue(memory.text)
    ?? stringValue(memory.content)
    ?? stringValue(memory.memory)
    ?? "";
  const scores = memory.scores && typeof memory.scores === "object" && !Array.isArray(memory.scores)
    ? memory.scores as Record<string, unknown>
    : undefined;
  const score = numberValue(scores?.final) ?? numberValue(memory.score) ?? numberValue(memory.relevance) ?? 1 / (index + 1);
  return {
    source: "hindsight",
    path: `hindsight/${encodeURIComponent(bankId)}/${encodeURIComponent(id ?? String(index))}`,
    content,
    score,
    metadata: {
      ...(id ? { id } : {}),
      ...(stringValue(memory.created_at) ? { createdAt: stringValue(memory.created_at) } : {}),
      authority: "external-read-only",
    },
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
