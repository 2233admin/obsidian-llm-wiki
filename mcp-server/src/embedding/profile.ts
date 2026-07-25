import { createHash } from "node:crypto";

export const EMBEDDING_PROFILE_SCHEMA_VERSION = 1 as const;
export const EMBEDDING_ADAPTER_SCHEMA_VERSION = "openai-compatible/v1";

export type BuiltInEmbeddingProfileId =
  | "ollama/bge-m3"
  | "ollama/qwen3-embedding:0.6b";

export interface EmbeddingProfile {
  schemaVersion: typeof EMBEDDING_PROFILE_SCHEMA_VERSION;
  id: string;
  provider: "ollama" | "openai-compatible";
  endpoint: string;
  model: string;
  dimensions?: number;
  adapterSchemaVersion: string;
  builtIn: boolean;
}

export interface EmbeddingFingerprint {
  schemaVersion: typeof EMBEDDING_PROFILE_SCHEMA_VERSION;
  profileId: string;
  provider: EmbeddingProfile["provider"];
  endpoint: string;
  model: string;
  dimensions?: number;
  adapterSchemaVersion: string;
  digest: string;
}

export interface ResolveEmbeddingProfileOptions {
  profileId?: string;
  provider?: EmbeddingProfile["provider"];
  endpoint?: string;
  model?: string;
  dimensions?: number;
  defaultProfileId?: BuiltInEmbeddingProfileId;
}

const DEFAULT_ENDPOINT = "http://localhost:11434/v1/embeddings";

export const BUILT_IN_EMBEDDING_PROFILES: Readonly<
  Record<BuiltInEmbeddingProfileId, EmbeddingProfile>
> = Object.freeze({
  "ollama/bge-m3": Object.freeze({
    schemaVersion: EMBEDDING_PROFILE_SCHEMA_VERSION,
    id: "ollama/bge-m3",
    provider: "ollama",
    endpoint: DEFAULT_ENDPOINT,
    model: "bge-m3",
    dimensions: 1024,
    adapterSchemaVersion: EMBEDDING_ADAPTER_SCHEMA_VERSION,
    builtIn: true,
  }),
  "ollama/qwen3-embedding:0.6b": Object.freeze({
    schemaVersion: EMBEDDING_PROFILE_SCHEMA_VERSION,
    id: "ollama/qwen3-embedding:0.6b",
    provider: "ollama",
    endpoint: DEFAULT_ENDPOINT,
    model: "qwen3-embedding:0.6b",
    dimensions: 1024,
    adapterSchemaVersion: EMBEDDING_ADAPTER_SCHEMA_VERSION,
    builtIn: true,
  }),
});

export function resolveEmbeddingProfile(
  options: ResolveEmbeddingProfileOptions = {},
): EmbeddingProfile {
  const requestedId = options.profileId ?? options.defaultProfileId ?? "ollama/bge-m3";
  const builtIn = isBuiltInEmbeddingProfileId(requestedId)
    ? BUILT_IN_EMBEDDING_PROFILES[requestedId]
    : undefined;
  const endpoint = normalizeEmbeddingEndpoint(
    options.endpoint ?? builtIn?.endpoint ?? DEFAULT_ENDPOINT,
  );
  const model = nonEmpty(options.model ?? builtIn?.model, "embedding model");
  const dimensions = options.dimensions ?? builtIn?.dimensions;
  if (dimensions !== undefined && (!Number.isInteger(dimensions) || dimensions <= 0)) {
    throw new Error("embedding dimensions must be a positive integer");
  }
  const isUnmodifiedBuiltIn = Boolean(
    builtIn && model === builtIn.model && endpoint === builtIn.endpoint,
  );
  return {
    schemaVersion: EMBEDDING_PROFILE_SCHEMA_VERSION,
    id: isUnmodifiedBuiltIn
      ? builtIn!.id
      : requestedId.startsWith("custom/")
        ? requestedId
        : "custom/" + (options.provider ?? builtIn?.provider ?? "openai-compatible") + "/" + model,
    provider: options.provider ?? builtIn?.provider ?? "openai-compatible",
    endpoint,
    model,
    ...(dimensions === undefined ? {} : { dimensions }),
    adapterSchemaVersion: EMBEDDING_ADAPTER_SCHEMA_VERSION,
    builtIn: isUnmodifiedBuiltIn,
  };
}

export function embeddingFingerprint(profile: EmbeddingProfile): EmbeddingFingerprint {
  const canonical = {
    schemaVersion: profile.schemaVersion,
    profileId: profile.id,
    provider: profile.provider,
    endpoint: normalizeEmbeddingEndpoint(profile.endpoint),
    model: profile.model,
    ...(profile.dimensions === undefined ? {} : { dimensions: profile.dimensions }),
    adapterSchemaVersion: profile.adapterSchemaVersion,
  };
  const digest =
    "sha256:" + createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return { ...canonical, digest };
}

export function embeddingFingerprintsMatch(
  left: EmbeddingFingerprint,
  right: EmbeddingFingerprint,
): boolean {
  return left.digest === right.digest;
}

export function validateEmbeddingVector(
  vector: readonly number[],
  profile: EmbeddingProfile,
): void {
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("embedding vector must contain only finite numbers");
  }
  if (profile.dimensions !== undefined && vector.length !== profile.dimensions) {
    throw new Error(
      "embedding vector dimension mismatch: profile " +
        profile.id +
        " expects " +
        profile.dimensions +
        ", received " +
        vector.length,
    );
  }
}

export function normalizeEmbeddingEndpoint(value: string): string {
  const raw = nonEmpty(value, "embedding endpoint");
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("embedding endpoint must use HTTP(S)");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "embedding endpoint must not contain credentials, query parameters, or fragments",
    );
  }
  url.pathname = normalizeEmbeddingPath(url.pathname);
  return url.toString().replace(/\/$/, "");
}

export function isBuiltInEmbeddingProfileId(
  value: string,
): value is BuiltInEmbeddingProfileId {
  return Object.prototype.hasOwnProperty.call(BUILT_IN_EMBEDDING_PROFILES, value);
}

function normalizeEmbeddingPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  if (!trimmed || trimmed === "/") return "/v1/embeddings";
  if (trimmed === "/v1") return "/v1/embeddings";
  return trimmed;
}

function nonEmpty(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(label + " must be non-empty");
  return normalized;
}
