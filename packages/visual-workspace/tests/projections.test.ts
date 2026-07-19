import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  acceptGraphRelationEvidence,
  deriveBoundedMindMapProjection,
  renderMindMapProjectionBundle,
} from "../src/index.js";
import { documentFixture, fixture } from "./helpers.js";

const graphEvidence = {
  schemaVersion: 1,
  id: "graphify-outline-relation",
  adapter: { id: "graphify", version: "1.4.0" },
  relation: "supports",
  fromNodeId: "outline",
  toNodeId: "graphify",
  confidence: "extracted",
  evidence: [{ kind: "vault", value: "Projects/release.md" }],
} as const;

describe("deterministic bounded portable projections", () => {
  test("uses a stable dependency-free tree layout and keeps cross-links secondary", () => {
    const document = acceptGraphRelationEvidence(documentFixture(), graphEvidence);
    const first = deriveBoundedMindMapProjection(
      document,
      { maxNodes: 20, maxDepth: 8 },
      { sourcePath: "Projects/release.md" },
    );
    const second = deriveBoundedMindMapProjection(
      document,
      { maxNodes: 20, maxDepth: 8 },
      { sourcePath: "Projects/release.md" },
    );

    assert.deepEqual(second, first);
    assert.deepEqual(first.nodes.map(({ id, depth, x, y }) => ({ id, depth, x, y })), [
      { id: "release-root", depth: 0, x: 0, y: 48 },
      { id: "ask-mate", depth: 1, x: 260, y: 0 },
      { id: "outline", depth: 2, x: 520, y: 0 },
      { id: "graphify", depth: 1, x: 260, y: 96 },
    ]);
    assert.equal(first.edges.length, 3);
    assert.equal(first.crossLinks.length, 1);
  });

  test("reports deterministic depth, node, and cross-link truncation", () => {
    const document = acceptGraphRelationEvidence(documentFixture(), graphEvidence);
    const depthLimited = deriveBoundedMindMapProjection(
      document,
      { maxNodes: 20, maxDepth: 1 },
      { sourcePath: "Projects/release.md" },
    );
    assert.deepEqual(depthLimited.nodes.map((node) => node.id), [
      "release-root",
      "ask-mate",
      "graphify",
    ]);
    assert.deepEqual(depthLimited.diagnostics.map((diagnostic) => diagnostic.code), [
      "DEPTH_TRUNCATED",
      "CROSS_LINK_OMITTED",
    ]);

    const nodeLimited = deriveBoundedMindMapProjection(
      document,
      { maxNodes: 2, maxDepth: 8 },
      { sourcePath: "Projects/release.md" },
    );
    assert.deepEqual(nodeLimited.nodes.map((node) => node.id), ["release-root", "ask-mate"]);
    assert.ok(nodeLimited.diagnostics.some((diagnostic) => diagnostic.code === "NODE_LIMIT_TRUNCATED"));
  });

  test("matches text, Mermaid, and Canvas golden projections", () => {
    const document = acceptGraphRelationEvidence(documentFixture(), graphEvidence);
    const bundle = renderMindMapProjectionBundle(
      document,
      { maxNodes: 20, maxDepth: 8 },
      { sourcePath: "Projects/release.md" },
    );

    assert.equal(bundle.text, fixture("basic.projection.txt").trimEnd());
    assert.equal(bundle.mermaid, fixture("basic.projection.mermaid").trimEnd());
    assert.deepEqual(JSON.parse(bundle.canvas), JSON.parse(fixture("basic.projection.canvas")));
    assert.deepEqual(bundle.projection.diagnostics, []);
    assert.match(bundle.markdown, /llmwiki:cross-link:v1/);
  });
});
