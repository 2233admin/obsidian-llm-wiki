import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  acceptGraphRelationEvidence,
  graphRelationEvidenceFingerprint,
  parseGraphRelationEvidence,
  parseManagedMindMapSection,
  serializeManagedMindMapSection,
} from "../src/index.js";
import { documentFixture } from "./helpers.js";

const evidence = {
  schemaVersion: 1,
  id: "graphify-outline-relation",
  adapter: {
    id: "graphify",
    version: "1.4.0",
  },
  relation: "supports",
  fromNodeId: "outline",
  toNodeId: "graphify",
  confidence: "extracted",
  evidence: [
    { kind: "vault", value: "Projects/release.md" },
    { kind: "adapter", value: "graphify:edge:42" },
  ],
} as const;

describe("Graph Relation Evidence review boundary", () => {
  test("validates a closed provenance-bearing contract and stable fingerprint", () => {
    const parsed = parseGraphRelationEvidence(evidence);
    assert.deepEqual(parsed, evidence);
    assert.match(graphRelationEvidenceFingerprint(parsed), /^sha256:[a-f0-9]{64}$/);
    assert.throws(
      () => parseGraphRelationEvidence({ ...evidence, accepted: true }),
      /unknown fields: accepted/,
    );
    assert.equal(
      parseGraphRelationEvidence({
        ...evidence,
        id: "graphify:edge:42",
        adapter: { id: "knowledge.graphify/v1", version: "1.4.0" },
      }).adapter.id,
      "knowledge.graphify/v1",
    );
  });

  test("rejects secrets, credential URLs, and machine-local paths", () => {
    assert.throws(
      () => parseGraphRelationEvidence({
        ...evidence,
        evidence: [{ kind: "url", value: "https://user:password@example.com/private" }],
      }),
      /credential-free/,
    );
    assert.throws(
      () => parseGraphRelationEvidence({
        ...evidence,
        evidence: [{ kind: "vault", value: "C:\\Users\\Alice\\vault\\note.md" }],
      }),
      /vault-relative|machine-local/,
    );
    assert.throws(
      () => parseGraphRelationEvidence({
        ...evidence,
        evidence: [{ kind: "adapter", value: "Authorization: Bearer abc" }],
      }),
      /secret-bearing/,
    );
    assert.throws(
      () => parseGraphRelationEvidence({
        ...evidence,
        evidence: [{ kind: "adapter", value: "x".repeat(4097) }],
      }),
      /evidence bound/,
    );
  });

  test("turns explicitly accepted evidence into a canonical replay-safe cross-link", () => {
    const accepted = acceptGraphRelationEvidence(documentFixture(), evidence);
    const replayed = acceptGraphRelationEvidence(accepted, evidence);

    assert.deepEqual(replayed, accepted);
    assert.deepEqual(accepted.crossLinks, [{
      id: "graphify-outline-relation",
      from: "outline",
      to: "graphify",
      relation: "supports",
      provenance: {
        kind: "graph_relation_evidence",
        evidenceId: "graphify-outline-relation",
        adapterId: "graphify",
        confidence: "extracted",
      },
    }]);
    const markdown = serializeManagedMindMapSection(accepted);
    assert.match(markdown, /llmwiki:cross-link:v1/);
    assert.deepEqual(parseManagedMindMapSection(markdown).document, accepted);
  });
});
