/**
 * embedding-client -- thin HTTP client for OpenAI-compatible embedding
 * endpoints (ollama /v1/embeddings, vLLM, TEI, OpenAI itself).
 *
 * The built-in profiles support both BGE-M3 and Qwen3-Embedding 0.6B via
 * Ollama. VaultBrain keeps BGE-M3 as its compatibility default; other
 * consumers can select Qwen3 explicitly without changing global support.
 *
 * Env overrides:
 *   VAULT_MIND_EMBED_URL    default http://localhost:11434/v1/embeddings
 *   VAULT_MIND_EMBED_PROFILE default ollama/bge-m3
 *   VAULT_MIND_EMBED_MODEL   optional explicit model override
 *
 * This module intentionally has no dependency on the adapters layer --
 * it's just a fetch wrapper. Adapters and tools that need embeddings
 * call embed() directly with whatever text they have.
 */

import {
  embeddingFingerprint,
  resolveEmbeddingProfile,
  validateEmbeddingVector,
  type BuiltInEmbeddingProfileId,
  type EmbeddingFingerprint,
} from "./embedding/profile.js";

const DEFAULT_PROFILE: BuiltInEmbeddingProfileId = "ollama/bge-m3";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface EmbedOpts {
  profileId?: string;
  url?: string;
  model?: string;
  dimensions?: number;
  timeoutMs?: number;
}

export interface EmbeddingResult {
  vector: number[];
  fingerprint: EmbeddingFingerprint;
}

interface OpenAIEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

export async function embed(
  text: string,
  opts?: EmbedOpts,
): Promise<number[]> {
  return (await embedWithProfile(text, opts)).vector;
}

export async function embedWithProfile(
  text: string,
  opts?: EmbedOpts,
): Promise<EmbeddingResult> {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("embed: empty text");
  }
  const profile = resolveEmbeddingProfile({
    profileId:
      opts?.profileId ??
      process.env.VAULT_MIND_EMBED_PROFILE ??
      DEFAULT_PROFILE,
    endpoint: opts?.url ?? process.env.VAULT_MIND_EMBED_URL,
    model: opts?.model ?? process.env.VAULT_MIND_EMBED_MODEL,
    dimensions: opts?.dimensions,
    defaultProfileId: DEFAULT_PROFILE,
  });
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(profile.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: text, model: profile.model }),
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
    validateEmbeddingVector(vec, profile);
    return { vector: vec, fingerprint: embeddingFingerprint(profile) };
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") {
      throw new Error(`embed: timeout after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
