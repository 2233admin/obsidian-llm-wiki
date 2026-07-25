import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  canonicalJson,
  mindMapFingerprint,
  parseMindMapDocument,
  VisualWorkspaceError,
} from "../src/index.js";
import { documentFixture } from "./helpers.js";

describe("MindMapDocument strict domain contract", () => {
  test("canonical JSON uses host-independent UTF-16 key ordering", () => {
    assert.equal(canonicalJson({ "\uE000": 1, "😀": 2 }), "{\"😀\":2,\"\":1}");
  });

  test("accepts a single-root tree and emits a stable fingerprint", () => {
    const document = parseMindMapDocument(documentFixture());
    assert.equal(document.rootId, "release-root");
    assert.match(mindMapFingerprint(document), /^sha256:[a-f0-9]{64}$/);

    const reorderedEdges = { ...document, edges: [...document.edges].reverse() };
    assert.equal(mindMapFingerprint(reorderedEdges), mindMapFingerprint(document));
  });

  test("rejects unknown fields at document, node, and edge boundaries", () => {
    const document = documentFixture();
    assert.throws(
      () => parseMindMapDocument({ ...document, futureField: true }),
      /unknown fields: futureField/,
    );
    assert.throws(
      () => parseMindMapDocument({
        ...document,
        nodes: [{ ...document.nodes[0], color: "red" }, ...document.nodes.slice(1)],
      }),
      /unknown fields: color/,
    );
    assert.throws(
      () => parseMindMapDocument({
        ...document,
        edges: [{ ...document.edges[0], relation: "contains" }, ...document.edges.slice(1)],
      }),
      /unknown fields: relation/,
    );
  });

  test("rejects a missing root, multiple roots, dangling edge, and cycles", () => {
    const document = documentFixture();
    const failures: unknown[] = [
      { ...document, rootId: "missing" },
      { ...document, edges: document.edges.slice(0, -1) },
      { ...document, edges: [...document.edges, { from: "missing", to: "outline" }] },
      {
        ...document,
        edges: [
          { from: "release-root", to: "ask-mate" },
          { from: "ask-mate", to: "outline" },
          { from: "outline", to: "ask-mate" },
          { from: "release-root", to: "graphify" },
        ],
      },
    ];
    for (const invalid of failures) {
      assert.throws(
        () => parseMindMapDocument(invalid),
        (error) => error instanceof VisualWorkspaceError && error.code === "INVALID_GRAPH",
      );
    }
  });

  test("keeps secondary cross-links strict and outside hierarchy validation", () => {
    const document = documentFixture();
    const withCrossLink = parseMindMapDocument({
      ...document,
      crossLinks: [{
        id: "outline-graphify",
        from: "outline",
        to: "graphify",
        relation: "supports",
        provenance: { kind: "explicit" },
      }],
    });
    assert.equal(withCrossLink.edges.length, document.edges.length);
    assert.equal(withCrossLink.crossLinks?.length, 1);
    assert.throws(
      () => parseMindMapDocument({
        ...document,
        crossLinks: [{
          id: "outline-graphify",
          from: "outline",
          to: "missing",
          relation: "supports",
          provenance: { kind: "explicit" },
        }],
      }),
      /Dangling cross-link/,
    );
    assert.throws(
      () => parseMindMapDocument({
        ...document,
        crossLinks: [{
          id: "outline-graphify",
          from: "outline",
          to: "graphify",
          relation: "supports",
          provenance: { kind: "explicit", acceptedByMagic: true },
        }],
      }),
      /unknown fields: acceptedByMagic/,
    );
  });
});
