/**
 * Minimal OpenAI-compatible embedding client.
 *
 * Calls the selected profile's /v1/embeddings endpoint to embed a query.
 * The legacy function name and qwen3-embedding:0.6b default remain for callers
 * that do not select a profile explicitly.
 *
 * Uses Node 18+ built-in fetch and undici's ProxyAgent when a proxy is set.
 *
 * Failure modes: returns [] on network/HTTP/parse error and writes a
 * single-line warn to stderr. Caller decides whether to fall back to
 * lexical search.
 */

export interface OllamaEmbedOpts {
  /** Built-in or custom profile id. Default: ollama/qwen3-embedding:0.6b */
  profileId?: string;
  /** Endpoint base URL. Default: env OLLAMA_EMBED_BASE_URL or http://localhost:11434/v1 */
  baseUrl?: string;
  /** Embedding model. Default: env OLLAMA_EMBED_MODEL or qwen3-embedding:0.6b */
  model?: string;
  /** Expected vector dimension for a custom model. */
  dimensions?: number;
  /** Bearer token for API-key-protected embedding endpoints. */
  apiKey?: string;
  /** HTTP proxy URL (e.g. http://127.0.0.1:7897). */
  proxy?: string;
  /** Timeout in ms. Default: 30_000 */
  timeoutMs?: number;
}

import { ProxyAgent } from "undici";

import {
  resolveEmbeddingProfile,
  validateEmbeddingVector,
  type BuiltInEmbeddingProfileId,
} from "./profile.js";

const DEFAULT_PROFILE: BuiltInEmbeddingProfileId =
  "ollama/qwen3-embedding:0.6b";

interface OpenAIEmbedResponse {
  data?: Array<{ embedding?: number[]; index?: number }>;
}

export async function embedTextOllama(
  text: string,
  opts?: OllamaEmbedOpts,
): Promise<number[]> {
  if (!text || text.length === 0) return [];

  const profile = resolveEmbeddingProfile({
    profileId:
      opts?.profileId ??
      process.env.OLLAMA_EMBED_PROFILE ??
      DEFAULT_PROFILE,
    endpoint: opts?.baseUrl ?? process.env.OLLAMA_EMBED_BASE_URL,
    model: opts?.model ?? process.env.OLLAMA_EMBED_MODEL,
    dimensions: opts?.dimensions,
    defaultProfileId: DEFAULT_PROFILE,
  });
  const timeoutMs = opts?.timeoutMs ?? 30_000;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  const apiKey =
    opts?.apiKey ?? process.env.OLLAMA_EMBED_API_KEY ?? process.env.VAULT_MIND_EMBED_API_KEY ?? "";
  const proxyUrl = opts?.proxy ?? process.env.OLLAMA_EMBED_PROXY ?? "";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

  try {
    const resp = await fetch(profile.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: profile.model, input: [text] }),
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      process.stderr.write(
        `obsidian-llm-wiki: [warn] ollama embed HTTP ${resp.status}: ${errText.slice(0, 200)}\n`,
      );
      return [];
    }

    const json = (await resp.json()) as OpenAIEmbedResponse;
    const first = json.data?.[0];
    const vec = first?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) {
      process.stderr.write(
        `obsidian-llm-wiki: [warn] ollama embed returned no vector\n`,
      );
      return [];
    }
    validateEmbeddingVector(vec, profile);
    return vec;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`obsidian-llm-wiki: [warn] ollama embed failed: ${msg}\n`);
    return [];
  } finally {
    clearTimeout(t);
    await dispatcher?.close();
  }
}
