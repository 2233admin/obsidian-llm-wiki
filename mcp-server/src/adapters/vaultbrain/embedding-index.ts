import type { EmbeddingFingerprint } from "../../embedding/profile.js";

export interface EmbeddingIndexRebuildPlan {
  indexId: string;
  reason: "missing-fingerprint" | "fingerprint-mismatch";
  steps: readonly string[];
  expectedFingerprint: EmbeddingFingerprint;
  actualFingerprint?: EmbeddingFingerprint;
}

export class EmbeddingIndexRebuildRequiredError extends Error {
  readonly code = "EMBEDDING_INDEX_REBUILD_REQUIRED";
  readonly rebuildPlan: EmbeddingIndexRebuildPlan;

  constructor(
    indexId: string,
    expectedFingerprint: EmbeddingFingerprint,
    actualFingerprint?: EmbeddingFingerprint,
  ) {
    const reason = actualFingerprint ? "fingerprint-mismatch" : "missing-fingerprint";
    super(
      `Embedding index ${indexId} requires a per-index rebuild (${reason}); ` +
      `expected ${expectedFingerprint.digest}` +
      (actualFingerprint ? `, found ${actualFingerprint.digest}` : ""),
    );
    this.name = "EmbeddingIndexRebuildRequiredError";
    this.rebuildPlan = {
      indexId,
      reason,
      steps: [
        `stop writes to ${indexId}`,
        `clear only ${indexId} vector rows and vector metadata`,
        `bind ${expectedFingerprint.profileId} (${expectedFingerprint.digest})`,
        `re-embed and verify ${indexId}`,
      ],
      expectedFingerprint,
      ...(actualFingerprint ? { actualFingerprint } : {}),
    };
  }
}
