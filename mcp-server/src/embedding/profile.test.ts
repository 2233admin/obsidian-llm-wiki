import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BUILT_IN_EMBEDDING_PROFILES,
  embeddingFingerprint,
  embeddingFingerprintsMatch,
  normalizeEmbeddingEndpoint,
  resolveEmbeddingProfile,
  validateEmbeddingVector,
} from "./profile.js";

describe("embedding profiles", () => {
  it("supports bge-m3 and qwen3-embedding:0.6b as first-class profiles", () => {
    assert.equal(BUILT_IN_EMBEDDING_PROFILES["ollama/bge-m3"].dimensions, 1024);
    assert.equal(
      BUILT_IN_EMBEDDING_PROFILES["ollama/qwen3-embedding:0.6b"].dimensions,
      1024,
    );
    assert.equal(resolveEmbeddingProfile({ profileId: "ollama/bge-m3" }).builtIn, true);
    assert.equal(
      resolveEmbeddingProfile({ profileId: "ollama/qwen3-embedding:0.6b" }).builtIn,
      true,
    );
  });

  it("keeps fingerprints distinct across supported models", () => {
    const bge = embeddingFingerprint(
      resolveEmbeddingProfile({ profileId: "ollama/bge-m3" }),
    );
    const qwen = embeddingFingerprint(
      resolveEmbeddingProfile({ profileId: "ollama/qwen3-embedding:0.6b" }),
    );
    assert.equal(embeddingFingerprintsMatch(bge, qwen), false);
    assert.notEqual(bge.digest, qwen.digest);
  });

  it("normalizes Ollama base URLs and rejects credential-bearing endpoints", () => {
    assert.equal(
      normalizeEmbeddingEndpoint("http://localhost:11434/v1"),
      "http://localhost:11434/v1/embeddings",
    );
    assert.throws(
      () => normalizeEmbeddingEndpoint("https://user:secret@example.com/v1"),
      /must not contain credentials/,
    );
  });

  it("rejects vectors that do not match the selected profile dimension", () => {
    const profile = resolveEmbeddingProfile({ profileId: "ollama/bge-m3" });
    assert.throws(() => validateEmbeddingVector([0.1, 0.2], profile), /dimension mismatch/);
    assert.doesNotThrow(() => validateEmbeddingVector(new Array(1024).fill(0), profile));
  });
});
