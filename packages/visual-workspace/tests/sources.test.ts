import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  adoptVisualSourceCandidate,
  parseManagedMindMapSection,
  readMarkdownMindMapSource,
  readObsidianCanvasSource,
  serializeManagedMindMapSection,
} from "../src/index.js";
import { fixture } from "./helpers.js";

describe("read-only Markdown and core Canvas source adapters", () => {
  test("recognizes a managed map without proposing adoption", () => {
    const source = fixture("basic.md");
    const result = readMarkdownMindMapSource(source, "Projects/release.md");

    assert.equal(result.sourceKind, "managed_markdown");
    assert.equal(result.document?.rootId, "release-root");
    assert.equal(result.adoptionCandidate, undefined);
    assert.equal(result.sourceReferences["ask-mate"]?.blockId, "ask-mate");
  });

  test("interprets ordinary headings and lists as a deterministic read-only adoption candidate", () => {
    const source = fixture("ordinary-outline.md");
    const first = readMarkdownMindMapSource(source, "Projects/outline.md");
    const second = readMarkdownMindMapSource(source, "Projects/outline.md");
    const candidate = first.adoptionCandidate!;

    assert.equal(first.sourceKind, "markdown");
    assert.deepEqual(second, first);
    assert.equal(candidate.candidateRootIds.length, 1);
    assert.equal(candidate.candidateRootIds[0], "release-plan");
    assert.equal(candidate.sourceReferences["markdown-maps"]?.range?.startLine, 7);
    assert.ok(candidate.diagnostics.some((diagnostic) => diagnostic.code === "INFERRED_ID"));
    assert.equal(source, fixture("ordinary-outline.md"));

    const parentByNode = Object.fromEntries(
      Object.entries(candidate.parentChoices).map(([nodeId, parents]) => [nodeId, parents[0]!]),
    );
    const adopted = adoptVisualSourceCandidate(candidate, {
      rootId: "release-plan",
      parentByNode,
    });
    const managed = serializeManagedMindMapSection(adopted);
    assert.deepEqual(parseManagedMindMapSection(managed).document, adopted);
  });

  test("reports Canvas parent ambiguity and adopts only the explicit choices", () => {
    const source = fixture("ambiguous.canvas");
    const result = readObsidianCanvasSource(source, "Projects/release.canvas");
    const candidate = result.adoptionCandidate!;

    assert.deepEqual(candidate.candidateRootIds, ["root"]);
    assert.deepEqual(candidate.parentChoices.shared, ["left", "right"]);
    assert.ok(candidate.diagnostics.some((diagnostic) => diagnostic.code === "AMBIGUOUS_PARENT"));
    assert.ok(candidate.diagnostics.some((diagnostic) => diagnostic.code === "UNSUPPORTED_CANVAS_FIELD"));
    assert.equal(JSON.stringify(candidate).includes("\"ignored\""), false);

    const adopted = adoptVisualSourceCandidate(candidate, {
      rootId: "root",
      parentByNode: {
        left: "root",
        right: "root",
        shared: "left",
      },
    });
    assert.deepEqual(adopted.edges, [
      { from: "root", to: "left" },
      { from: "root", to: "right" },
      { from: "left", to: "shared" },
    ]);
    assert.deepEqual(adopted.crossLinks, [{
      id: "right-shared",
      from: "right",
      to: "shared",
      relation: "supports",
      provenance: { kind: "explicit" },
    }]);
  });

  test("does not invent a root for a disconnected Canvas", () => {
    const source = JSON.stringify({
      nodes: [
        { id: "one", type: "text", text: "One", x: 0, y: 0, width: 100, height: 100 },
        { id: "two", type: "text", text: "Two", x: 200, y: 0, width: 100, height: 100 },
      ],
      edges: [],
    });
    const result = readObsidianCanvasSource(source, "Projects/disconnected.canvas");
    assert.deepEqual(result.adoptionCandidate?.candidateRootIds, ["one", "two"]);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "AMBIGUOUS_ROOT"));
    assert.equal(result.document, undefined);
  });
});
