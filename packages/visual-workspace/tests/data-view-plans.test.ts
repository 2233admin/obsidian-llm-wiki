import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { canonicalDigest, sha256Text } from "../src/canonical.js";
import { assertDataViewEditPlan, createDataViewEditPlan, executeDataViewQuery, InMemoryDataViewWorkspace } from "../src/index.js";
import type { DataViewEditPlan, DataViewSourceBlock } from "../src/index.js";

const sourceMarkdown = "---\nstatus: todo\npriority: 1\n---\n# Alpha\nKeep this text.\n";
const source: DataViewSourceBlock = {
  path: "Projects/alpha.md",
  sha256: sha256Text(sourceMarkdown),
  title: "Alpha",
  frontmatter: { status: "todo", priority: 1 },
  blocks: [],
};
const definition = {
  schemaVersion: 1 as const,
  id: "projects",
  title: "Projects",
  view: "kanban" as const,
  source: { kind: "file" as const, path: "Projects/alpha.md" },
  select: [{ field: "title", label: "Title" }, { field: "status", label: "Status" }],
  groupBy: "status",
};

function query() {
  return executeDataViewQuery({ definition, sources: [source] });
}

describe("controlled data-view edit plans", () => {
  test("changes only the targeted frontmatter property and locks the source", () => {
    const result = query();
    const plan = createDataViewEditPlan({
      definition,
      result,
      action: {
        schemaVersion: 1,
        kind: "move-card",
        queryId: result.model.queryId,
        sourcePath: "Projects/alpha.md",
        field: "status",
        value: "done",
        actor: "user/alice",
      },
      sourceMarkdown,
    });

    assert.equal(plan.source.path, "Projects/alpha.md");
    assert.match(plan.source.sha256, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(plan.preview.before.sourceMarkdown, sourceMarkdown);
    assert.equal(plan.preview.after.sourceMarkdown, "---\nstatus: done\npriority: 1\n---\n# Alpha\nKeep this text.\n");
    assert.equal(plan.affectedPaths.join("/"), "Projects/alpha.md");
    assert.equal(plan.provenance.queryId, result.model.queryId);
    assert.equal(plan.provenance.actionKind, "move-card");
    assert.match(plan.fingerprint, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(Object.isFrozen(plan), true);
  });
  test("applies once and returns the recorded result on replay", () => {
    const result = query();
    const plan = createDataViewEditPlan({
      definition,
      result,
      action: {
        schemaVersion: 1,
        kind: "move-card",
        queryId: result.model.queryId,
        sourcePath: "Projects/alpha.md",
        field: "status",
        value: "done",
        actor: "user/alice",
      },
      sourceMarkdown,
    });
    const workspace = new InMemoryDataViewWorkspace({ "Projects/alpha.md": sourceMarkdown });
    const request = { plan, presentedFingerprint: plan.fingerprint, actor: "user/alice", transitionToken: "data-view-transition" };
    const first = workspace.apply(request);
    const replay = workspace.apply(request);

    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.source, first.source);
    assert.equal(workspace.read("Projects/alpha.md"), first.source);
  });

  test("rejects unknown fields, missing source ranges, and mismatched query IDs", () => {
    const result = query();
    assert.throws(() => createDataViewEditPlan({
      definition,
      result,
      action: { schemaVersion: 1, kind: "edit-property", queryId: result.model.queryId, sourcePath: "Projects/alpha.md", field: "missing", value: "x", actor: "user/alice" },
      sourceMarkdown,
    }), /unknown field/);
    assert.throws(() => createDataViewEditPlan({
      definition,
      result,
      action: { schemaVersion: 1, kind: "edit-property", queryId: result.model.queryId, sourcePath: "Projects/alpha.md", field: "title", value: "Beta", actor: "user/alice" },
      sourceMarkdown,
    }), /source range/);
    assert.throws(() => createDataViewEditPlan({
      definition,
      result,
      action: { schemaVersion: 1, kind: "edit-property", queryId: "sha256:wrong", sourcePath: "Projects/alpha.md", field: "status", value: "done", actor: "user/alice" },
      sourceMarkdown,
    }), /query ID/);
  });

  test("rejects stale or malformed source text before creating a plan", () => {
    const result = query();
    assert.throws(() => createDataViewEditPlan({
      definition,
      result,
      action: { schemaVersion: 1, kind: "edit-property", queryId: result.model.queryId, sourcePath: "Projects/alpha.md", field: "status", value: "done", actor: "user/alice" },
      sourceMarkdown: "---\nstatus: in-progress\n---\n# Alpha\n",
    }), /query snapshot lock/);
  });
  test("preserves trailing spaces and inline comments around the edited value", () => {
    const markdown = "---\nstatus: todo  # keep this note\npriority: 1\n---\n# Alpha\n";
    const snapshot = { ...source, sha256: sha256Text(markdown) };
    const result = executeDataViewQuery({ definition, sources: [snapshot] });
    const plan = createDataViewEditPlan({
      definition,
      result,
      action: { schemaVersion: 1, kind: "move-card", queryId: result.model.queryId, sourcePath: source.path, field: "status", value: "done", actor: "user/alice" },
      sourceMarkdown: markdown,
    });

    assert.equal(plan.preview.after.sourceMarkdown, "---\nstatus: done  # keep this note\npriority: 1\n---\n# Alpha\n");
  });
  test("rejects a tampered self-consistent plan and secret snapshots", () => {
    const result = query();
    const plan = createDataViewEditPlan({
      definition,
      result,
      action: { schemaVersion: 1, kind: "move-card", queryId: result.model.queryId, sourcePath: source.path, field: "status", value: "done", actor: "user/alice" },
      sourceMarkdown,
    });
    const tampered = JSON.parse(JSON.stringify(plan)) as DataViewEditPlan;
    tampered.preview.after.sourceMarkdown = `${sourceMarkdown}rewritten`;
    assert.throws(() => createDataViewEditPlan({
      definition,
      result,
      action: { schemaVersion: 1, kind: "move-card", queryId: result.model.queryId, sourcePath: source.path, field: "status", value: "done", actor: "user/alice" },
      sourceMarkdown: `${sourceMarkdown}api_key: leaked`,
    }), /secret-bearing|query snapshot lock/);
    assert.throws(() => assertDataViewEditPlan(tampered), /hash|range|fingerprint/);
    const injected = JSON.parse(JSON.stringify(plan)) as DataViewEditPlan;
    injected.preview.after.sourceMarkdown = sourceMarkdown.replace("status: todo", "status: done\nowner: attacker");
    injected.preview.after.sourceSha256 = sha256Text(injected.preview.after.sourceMarkdown);
    const { fingerprint: ignoredFingerprint, ...injectedPayload } = injected;
    injected.fingerprint = canonicalDigest(injectedPayload);
    assert.throws(() => assertDataViewEditPlan(injected), /single frontmatter value/);
  });
});
