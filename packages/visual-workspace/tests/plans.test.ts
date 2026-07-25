import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assertVisualEditPlan,
  createVisualEditPlan,
  InMemoryVisualWorkspace,
  VisualWorkspaceError,
} from "../src/index.js";
import { documentFixture, fixture } from "./helpers.js";

describe("immutable VisualEditPlan and replay-safe apply", () => {
  test("creates a frozen preview with source and plan fingerprints", () => {
    const plan = createVisualEditPlan({
      sourcePath: "Projects/release.md",
      sourceMarkdown: fixture("basic.md"),
      nextDocument: documentFixture("basic.edited.document.json"),
      provenance: { actor: "user/alice", origin: "user" },
    });
    assertVisualEditPlan(plan);
    assert.equal(Object.isFrozen(plan), true);
    assert.equal(Object.isFrozen(plan.preview.after.document.nodes), true);
    assert.match(plan.source.sha256, /^sha256:/);
    assert.match(plan.fingerprint, /^sha256:/);
    assert.throws(() => {
      (plan.preview.after.document.nodes[0] as { label: string }).label = "mutated";
    }, TypeError);
  });

  test("applies once and returns the recorded outcome on an identical replay", () => {
    const source = fixture("basic.md");
    const plan = createVisualEditPlan({
      sourcePath: "Projects/release.md",
      sourceMarkdown: source,
      nextDocument: documentFixture("basic.edited.document.json"),
      provenance: { actor: "assistant/codex", origin: "assistant" },
    });
    const workspace = new InMemoryVisualWorkspace({ "Projects/release.md": source });
    const request = {
      plan,
      presentedFingerprint: plan.fingerprint,
      actor: "user/alice",
      transitionToken: "transition-apply",
    };
    const first = workspace.apply(request);
    const replay = workspace.apply(request);

    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.source, first.source);
    assert.equal(workspace.read("Projects/release.md"), first.source);
  });

  test("rejects stale source content before mutation", () => {
    const source = fixture("basic.md");
    const plan = createVisualEditPlan({
      sourcePath: "Projects/release.md",
      sourceMarkdown: source,
      nextDocument: documentFixture("basic.edited.document.json"),
      provenance: { actor: "assistant/codex", origin: "assistant" },
    });
    const workspace = new InMemoryVisualWorkspace({
      "Projects/release.md": `${source}\nconcurrent edit`,
    });
    assert.throws(
      () => workspace.apply({
        plan,
        presentedFingerprint: plan.fingerprint,
        actor: "user/alice",
        transitionToken: "transition-stale",
      }),
      (error) => error instanceof VisualWorkspaceError && error.code === "SOURCE_CHANGED",
    );
    assert.equal(workspace.read("Projects/release.md"), `${source}\nconcurrent edit`);
  });

  test("rejects a token replayed with a different verified plan", () => {
    const source = fixture("basic.md");
    const firstPlan = createVisualEditPlan({
      sourcePath: "Projects/release.md",
      sourceMarkdown: source,
      nextDocument: documentFixture("basic.edited.document.json"),
      provenance: { actor: "assistant/codex", origin: "assistant" },
    });
    const workspace = new InMemoryVisualWorkspace({ "Projects/release.md": source });
    workspace.apply({
      plan: firstPlan,
      presentedFingerprint: firstPlan.fingerprint,
      actor: "user/alice",
      transitionToken: "shared-token",
    });

    const otherSource = fixture("basic.md").replace("This prose", "Different prose");
    const secondPlan = createVisualEditPlan({
      sourcePath: "Projects/other.md",
      sourceMarkdown: otherSource,
      nextDocument: documentFixture("basic.edited.document.json"),
      provenance: { actor: "assistant/codex", origin: "assistant" },
    });
    assert.throws(
      () => workspace.apply({
        plan: secondPlan,
        presentedFingerprint: secondPlan.fingerprint,
        actor: "user/alice",
        transitionToken: "shared-token",
      }),
      (error) => error instanceof VisualWorkspaceError && error.code === "TRANSITION_TOKEN_REUSED",
    );
  });

  test("detects plan tampering and unknown fields", () => {
    const plan = createVisualEditPlan({
      sourcePath: "Projects/release.md",
      sourceMarkdown: fixture("basic.md"),
      nextDocument: documentFixture("basic.edited.document.json"),
      provenance: { actor: "user/alice", origin: "user" },
    });
    assert.throws(() => assertVisualEditPlan({ ...plan, extra: true }), /unknown fields/);
    assert.throws(
      () => assertVisualEditPlan({ ...plan, fingerprint: `sha256:${"0".repeat(64)}` }),
      (error) => error instanceof VisualWorkspaceError && error.code === "PLAN_TAMPERED",
    );
  });

  test("keeps apply confirmation outside the immutable plan", () => {
    const plan = createVisualEditPlan({
      sourcePath: "Projects/release.md",
      sourceMarkdown: fixture("basic.md"),
      nextDocument: documentFixture("basic.edited.document.json"),
      provenance: { actor: "assistant/codex", origin: "assistant" },
      warnings: ["Graphify relation is a suggestion until accepted."],
    });
    assert.equal("transitionToken" in plan, false);
    assert.deepEqual(plan.affectedPaths, ["Projects/release.md"]);
    assert.deepEqual(plan.warnings, ["Graphify relation is a suggestion until accepted."]);

    const workspace = new InMemoryVisualWorkspace({ "Projects/release.md": fixture("basic.md") });
    assert.throws(
      () => workspace.apply({
        plan,
        presentedFingerprint: `sha256:${"0".repeat(64)}`,
        actor: "user/alice",
        transitionToken: "transition-wrong-fingerprint",
      }),
      (error) => error instanceof VisualWorkspaceError && error.code === "PLAN_TAMPERED",
    );
  });

  test("rejects machine-local and escaping paths", () => {
    for (const sourcePath of [
      "C:\\Users\\alice\\vault\\map.md",
      "/home/alice/vault/map.md",
      "../other-project/map.md",
      "Projects/../other.md",
    ]) {
      assert.throws(
        () => createVisualEditPlan({
          sourcePath,
          sourceMarkdown: fixture("basic.md"),
          nextDocument: documentFixture("basic.edited.document.json"),
          provenance: { actor: "user/alice", origin: "user" },
        }),
        /vault-relative path/,
      );
    }
  });
});
