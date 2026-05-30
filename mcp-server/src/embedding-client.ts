/**
 * embedding-client -- thin HTTP client for OpenAI-compatible embedding
 * endpoints (ollama /v1/embeddings, vLLM, TEI, OpenAI itself).
 *
 * Defaults match BGE-M3 via Ollama at localhost:11434, producing 1024-dim
 * L2-normalised vectors matching vaultbrain's stored chunk embeddings.
 *
 * Env overrides:
 *   VAULT_MIND_EMBED_URL    default http://localhost:11434/v1/embeddings
 *   VAULT_MIND_EMBED_MODEL  default qwen3-embedding:0.6b
 *
 * This module intentionally has no dependency on the adapters layer --
 * it's just a fetch wrapper. Adapters and tools that need embeddings
 * call embed() directly with whatever text they have.
 */

const DEFAULT_URL = "http://localhost:11434/v1/embeddings";
const DEFAULT_MODEL = "bge-m3";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface EmbedOpts {
  url?: string;
  model?: string;
  timeoutMs?: number;
}

interface OpenAIEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

export async function embed(
  text: string,
  opts?: EmbedOpts,
): Promise<number[]> {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("embed: empty text");
  }
  const url = opts?.url ?? process.env.VAULT_MIND_EMBED_URL ?? DEFAULT_URL;
  const model =
    opts?.model ?? process.env.VAULT_MIND_EMBED_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: text, model }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`embed: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    const body = (await res.json()) as OpenAIEmbeddingResponse;
    const vec = body.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) {
      throw new Error("embed: response missing data[0].embedding");
    }
    return vec;
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") {
      throw new Error(`embed: timeout after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
