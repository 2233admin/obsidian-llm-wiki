import test from "node:test";
import assert from "node:assert/strict";
import type { MindMapDocument, VisualEditPlan } from "../../packages/visual-workspace/dist/src/index.js";
import {
  AskMateOutlineModel,
  diffMindMapDocuments,
  renderTextualTree,
} from "../src/ask-mate/outline-model";

function document(): MindMapDocument {
  return {
    schemaVersion: 1,
    id: "map-alpha",
    title: "Alpha",
    rootId: "root",
    nodes: [
      { id: "root", label: "Root" },
      { id: "child-a", label: "A" },
      { id: "child-b", label: "B" },
      { id: "grandchild", label: "A1" },
    ],
    edges: [
      { from: "root", to: "child-a" },
      { from: "child-a", to: "grandchild" },
      { from: "root", to: "child-b" },
    ],
  };
}

function fakePlan(nextDocument: MindMapDocument): VisualEditPlan {
  return {
    schemaVersion: 1,
    source: { path: "01-Projects/alpha/maps/alpha.md", sha256: `sha256:${"1".repeat(64)}` },
    preview: {
      before: {
        document: document(),
        documentFingerprint: `sha256:${"2".repeat(64)}`,
        managedMarkdown: "before",
      },
      after: {
        document: nextDocument,
        documentFingerprint: `sha256:${"3".repeat(64)}`,
        managedMarkdown: "after",
      },
    },
    affectedPaths: ["01-Projects/alpha/maps/alpha.md"],
    provenance: { actor: "obsidian-ask-mate", origin: "user" },
    warnings: [],
    fingerprint: `sha256:${"4".repeat(64)}`,
  };
}

test("outline supports deterministic rename, add, remove, and reparent operations", () => {
  const model = new AskMateOutlineModel();
  model.load(document());
  model.rename("child-a", "Renamed A");
  const added = model.add("child-b", "B1");
  assert.equal(added, "node-1");
  model.reparent("grandchild", "child-b");
  model.remove("child-a");

  assert.equal(
    model.snapshot.textualPreview,
    [
      "- Root ^root",
      "  - B ^child-b",
      "    - B1 ^node-1",
      "    - A1 ^grandchild",
    ].join("\n"),
  );
  assert.deepEqual(model.document.edges, [
    { from: "root", to: "child-b" },
    { from: "child-b", to: "node-1" },
    { from: "child-b", to: "grandchild" },
  ]);
});

test("outline rejects hierarchy damage and invalidates a preview after every edit", () => {
  const model = new AskMateOutlineModel();
  model.load(document());
  model.acceptPlan(fakePlan(model.document));
  assert.ok(model.plan);
  assert.throws(() => model.remove("root"), /root/i);
  assert.throws(() => model.reparent("child-a", "grandchild"), /descendant/i);
  model.rename("child-b", "Changed");
  assert.equal(model.plan, null);
});

test("Graphify evidence remains selectable review state and never changes hierarchy", () => {
  const model = new AskMateOutlineModel();
  model.load(document(), [{
    id: "graphify:1",
    adapter: "graphify",
    relation: "supports",
    from: "child-a",
    to: "child-b",
    confidence: "inferred",
    evidenceRefs: ["10-Projects/alpha/evidence/relation.md#^edge"],
  }]);
  const before = renderTextualTree(model.document);
  model.selectSuggestion("graphify:1", true);
  assert.deepEqual(model.snapshot.selectedSuggestionIds, ["graphify:1"]);
  assert.equal(renderTextualTree(model.document), before);
  assert.deepEqual(model.document.edges, document().edges);
  assert.deepEqual(model.selectedSuggestions.map(suggestion => suggestion.id), ["graphify:1"]);
});

test("selectable structural diff produces a revised plan document without mutating the draft", () => {
  const model = new AskMateOutlineModel();
  model.load(document());
  model.rename("child-a", "Renamed A");
  model.add("child-b", "B1");
  const changes = model.snapshot.structuralChanges;
  assert.deepEqual(changes.map(change => change.id), [
    "add_subtree:node-1",
    "rename:child-a",
  ]);
  model.setChangeSelected("rename:child-a", false);

  assert.equal(
    model.document.nodes.find(node => node.id === "child-a")?.label,
    "Renamed A",
    "ephemeral draft stays intact",
  );
  assert.equal(
    model.documentForPlan.nodes.find(node => node.id === "child-a")?.label,
    "A",
    "deselected rename is excluded from the plan document",
  );
  assert.equal(model.documentForPlan.nodes.some(node => node.id === "node-1"), true);
});

test("subtree removal is one selectable change and cannot create a dangling hierarchy", () => {
  const baseline = document();
  const model = new AskMateOutlineModel();
  model.load(baseline);
  model.remove("child-a");
  assert.deepEqual(diffMindMapDocuments(baseline, model.document).map(change => change.id), [
    "remove_subtree:child-a",
  ]);
  model.setChangeSelected("remove_subtree:child-a", false);
  assert.deepEqual(model.documentForPlan, baseline);
});

test("textual view exposes cross-links and subtree removal cleans attached links", () => {
  const withCrossLink: MindMapDocument = {
    ...document(),
    crossLinks: [{
      id: "related",
      from: "grandchild",
      to: "child-b",
      relation: "supports",
      provenance: {
        kind: "graph_relation_evidence",
        evidenceId: "evidence-1",
        adapterId: "graphify",
        confidence: "inferred",
      },
    }],
  };
  const model = new AskMateOutlineModel();
  model.load(withCrossLink);
  assert.match(model.snapshot.textualPreview, /A1 —supports→ B \[graph_relation_evidence · graphify · inferred\]/);
  model.remove("child-a");
  assert.deepEqual(model.document.crossLinks, []);
});
