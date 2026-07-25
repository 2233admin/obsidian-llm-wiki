import test from "node:test";
import assert from "node:assert/strict";
import type { WorkspaceLeaf } from "obsidian";
import type { MindMapDocument, VisualEditPlan } from "../../packages/visual-workspace/dist/src/index.js";
import {
  AskMateOperationClient,
  type AskMateExternalContributionPlan,
  type AskMateIssueChangePlan,
} from "../src/ask-mate/client";
import { AskMateView } from "../src/ask-mate/view";

const projectId = "project/alpha" as const;
const path = "01-Projects/alpha/maps/alpha.md";
const sourceSha256 = `sha256:${"1".repeat(64)}` as const;
const documentFingerprint = `sha256:${"2".repeat(64)}` as const;
const planFingerprint = `sha256:${"3".repeat(64)}` as const;
const document: MindMapDocument = {
  schemaVersion: 1,
  id: "map-alpha",
  title: "Alpha",
  rootId: "root",
  nodes: [{ id: "root", label: "Root" }],
  edges: [],
};
const managedMarkdown = [
  '<!-- llmwiki:mind-map:v1 {"id":"map-alpha","title":"Alpha"} -->',
  '- "Root" ^root',
  "<!-- /llmwiki:mind-map:v1 -->",
].join("\n");
const plan: VisualEditPlan = {
  schemaVersion: 1,
  source: { path, sha256: sourceSha256 },
  preview: {
    before: { document, documentFingerprint, managedMarkdown },
    after: { document, documentFingerprint, managedMarkdown },
  },
  affectedPaths: [path],
  provenance: { actor: "obsidian-control-plane", origin: "user" },
  warnings: [],
  fingerprint: planFingerprint,
};

function issuePlan(fingerprintCharacter = "9"): AskMateIssueChangePlan {
  return {
    schemaVersion: 1,
    projectId,
    observationId: "problem-observation/alpha",
    observationRevision: 3,
    existingIssueEntity: null,
    action: "create",
    operation: "project.issue.create",
    payload: {
      title: "Reviewed problem",
      description: "Reviewed observation",
      body: "Reviewed observation evidence",
      priority: 2,
    },
    evidenceRefs: ["01-Projects/alpha/observations/problem.md"],
    warnings: [],
    actor: "ask-mate-ui-proposer",
    fingerprint: `sha256:${fingerprintCharacter.repeat(64)}` as `sha256:${string}`,
  };
}

function contributionPlan(
  choice: "local_only" | "submit_issue" | "prepare_pull_request",
  fingerprintCharacter = "8",
): AskMateExternalContributionPlan {
  return {
    schemaVersion: 1,
    id: `contribution/${choice}`,
    disposition: { choice },
    projectId,
    observationId: "problem-observation/alpha",
    observationRevision: 3,
    target: choice === "local_only"
      ? null
      : { provider: "github", repository: "owner/repo" },
    content: choice === "local_only"
      ? null
      : { title: "Fix", body: "Reviewed body", labels: ["bug"] },
    patch: choice === "prepare_pull_request" ? { draft: true } : null,
    executionProjection: choice === "local_only" ? null : { schemaVersion: 1 },
    redactions: [],
    warnings: [],
    actor: "ask-mate-ui-proposer",
    fingerprint: `sha256:${fingerprintCharacter.repeat(64)}` as `sha256:${string}`,
  };
}

function mapReadResult(): Record<string, unknown> {
  return {
    projectId,
    path,
    source: managedMarkdown,
    sourceSha256,
    document,
    documentFingerprint,
    managedMarkdown,
  };
}

test("view restores only context and never applies an unconfirmed preview", async () => {
  const calls: string[] = [];
  let proposalActor: unknown;
  let confirmationActor: unknown;
  const client = new AskMateOperationClient({
    async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
      calls.push(operation);
      if (operation === "visual.map.read") {
        return {
          projectId,
          path,
          source: managedMarkdown,
          sourceSha256,
          document,
          documentFingerprint,
          managedMarkdown,
        } as T;
      }
      if (operation === "graph.adapters.query") return { snapshots: [] } as T;
      if (operation === "visual.map.plan") {
        proposalActor = args.actor;
        return { projectId, path, plan } as T;
      }
      if (operation === "visual.map.apply") {
        confirmationActor = args.actor;
        return {
          projectId,
          path,
          sourceSha256,
          planFingerprint,
          actor: "obsidian-control-plane",
          transitionToken: "test",
          replayed: false,
          receiptPath: "01-Projects/alpha/maps/.receipts/test.json",
        } as T;
      }
      throw new Error(`Unexpected operation: ${operation}`);
    },
  });
  const view = new AskMateView({} as WorkspaceLeaf, client, {
    proposalActor: "ask-mate-ui-proposer",
    confirmationActor: "obsidian-control-plane",
  });
  // DOM rendering is covered by Obsidian; this test isolates state and side
  // effects so it remains deterministic in Node.
  view.render = () => undefined;

  await view.setState({ projectId, path }, {} as never);
  assert.deepEqual(view.getState(), { projectId, kind: "managed_map", path });
  await view.previewChanges();
  assert.equal(calls.filter(operation => operation === "visual.map.apply").length, 0);
  await assert.rejects(() => view.applyConfirmedPlan(), /confirm/i);
  assert.equal(calls.filter(operation => operation === "visual.map.apply").length, 0);

  view.setApplyConfirmed(true);
  await view.applyConfirmedPlan();
  assert.equal(calls.filter(operation => operation === "visual.map.apply").length, 1);
  assert.equal(proposalActor, "ask-mate-ui-proposer");
  assert.equal(confirmationActor, "obsidian-control-plane");

  await view.onClose();
  assert.deepEqual(view.getState(), {});
  assert.equal(view.model.hasDocument, false);
});

test("Graphify lookup does not block restored outline editing", async () => {
  let releaseGraph!: () => void;
  const graphPending = new Promise<void>(resolve => { releaseGraph = resolve; });
  const client = new AskMateOperationClient({
    async invoke<T>(operation: string): Promise<T> {
      if (operation === "visual.map.read") {
        return {
          projectId,
          path,
          source: managedMarkdown,
          sourceSha256,
          document,
          documentFingerprint,
          managedMarkdown,
        } as T;
      }
      if (operation === "graph.adapters.query") {
        await graphPending;
        return { snapshots: [] } as T;
      }
      throw new Error(`Unexpected operation: ${operation}`);
    },
  });
  const view = new AskMateView({} as WorkspaceLeaf, client, {
    proposalActor: "ask-mate-ui-proposer",
    confirmationActor: "obsidian-control-plane",
  });
  view.render = () => undefined;

  const restored = view.setState({ projectId, path }, {} as never);
  const outcome = await Promise.race([
    restored.then(() => "restored"),
    new Promise<string>(resolve => setTimeout(() => resolve("blocked"), 50)),
  ]);
  assert.equal(outcome, "restored");
  assert.equal(view.model.hasDocument, true);
  releaseGraph();
  await view.onClose();
});

test("ambiguous ordinary note blocks map planning until the required root is selected", async () => {
  const calls: string[] = [];
  const client = new AskMateOperationClient({
    async invoke<T>(operation: string): Promise<T> {
      calls.push(operation);
      if (operation === "visual.context.read") {
        return {
          projectId,
          context: { kind: "markdown_note", path, sourceLabel: path },
          document,
          documentFingerprint,
          targetPath: "01-Projects/alpha/maps/adopted.md",
          adoptionRequired: true,
          readOnly: true,
          warnings: ["Ordinary Markdown remains unchanged until adoption apply."],
          clarifications: [{
            id: "root",
            prompt: "Which root?",
            kind: "root",
            required: true,
            options: [
              { id: "a", label: "Alpha", evidenceRefs: [`${path}#Alpha`] },
              { id: "b", label: "Beta", evidenceRefs: [`${path}#Beta`] },
            ],
          }],
          capabilities: {
            model: "degraded",
            graphify: "unavailable",
            problemIntake: "available",
            messages: [],
          },
        } as T;
      }
      if (operation === "graph.adapters.query") return { snapshots: [] } as T;
      if (operation === "visual.map.plan") return { projectId, path, plan } as T;
      throw new Error(`Unexpected operation: ${operation}`);
    },
  });
  const view = new AskMateView({} as WorkspaceLeaf, client, {
    proposalActor: "ask-mate-ui-proposer",
    confirmationActor: "obsidian-control-plane",
  });
  view.render = () => undefined;
  await view.openContext({ projectId, kind: "markdown_note", path });
  await assert.rejects(() => view.previewChanges(), /clarification/i);
  assert.equal(calls.includes("visual.map.plan"), false);
  view.answerClarification("root", "a");
  await view.previewChanges();
  assert.equal(calls.includes("visual.map.plan"), true);
  assert.equal(calls.includes("visual.map.apply"), false);
});

test("local Work-OS issue uses the canonical direct plan and exact confirmation", async () => {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const reviewedPlan = issuePlan();
  const client = new AskMateOperationClient({
    async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ operation, args });
      if (operation === "visual.map.read") return mapReadResult() as T;
      if (operation === "graph.adapters.query") return { snapshots: [] } as T;
      if (operation === "problem.intake.issue.plan") return reviewedPlan as T;
      if (operation === "problem.intake.issue.apply") return { replayed: false } as T;
      throw new Error(`Unexpected operation: ${operation}`);
    },
  });
  const view = new AskMateView({} as WorkspaceLeaf, client, {
    proposalActor: "ask-mate-ui-proposer",
    confirmationActor: "obsidian-control-plane",
  });
  view.render = () => undefined;
  await view.openContext({ projectId, kind: "managed_map", path });
  view.setProblemDraft({ observationId: "problem-observation/alpha" });
  await view.previewProblemAction("local_issue");
  assert.deepEqual(calls.find(call => call.operation === "problem.intake.issue.plan"), {
    operation: "problem.intake.issue.plan",
    args: {
      projectId,
      observationId: "problem-observation/alpha",
      actor: "ask-mate-ui-proposer",
    },
  });
  assert.equal(calls.some(call => call.operation === "problem.intake.issue.apply"), false);
  await assert.rejects(() => view.applyConfirmedProblemPlan(), /confirm/i);
  view.setProblemPlanConfirmed(true);
  await view.applyConfirmedProblemPlan();
  const apply = calls.find(call => call.operation === "problem.intake.issue.apply");
  assert.equal(apply?.args.plan, reviewedPlan);
  assert.equal(apply?.args.presentedFingerprint, reviewedPlan.fingerprint);
  assert.equal(apply?.args.actor, "obsidian-control-plane");
  assert.match(String(apply?.args.transitionToken), /^ask-mate:9{16}:/);
});

test("local-only contribution is reviewable but has no external apply step", async () => {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const reviewedPlan = contributionPlan("local_only");
  const client = new AskMateOperationClient({
    async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ operation, args });
      if (operation === "visual.map.read") return mapReadResult() as T;
      if (operation === "graph.adapters.query") return { snapshots: [] } as T;
      if (operation === "problem.intake.contribution.plan") {
        return { available: true, plan: reviewedPlan } as T;
      }
      throw new Error(`Unexpected operation: ${operation}`);
    },
  });
  const view = new AskMateView({} as WorkspaceLeaf, client, {
    proposalActor: "ask-mate-ui-proposer",
    confirmationActor: "obsidian-control-plane",
  });
  view.render = () => undefined;
  await view.openContext({ projectId, kind: "managed_map", path });
  view.setProblemDraft({
    observationId: "problem-observation/alpha",
    repository: "must-not-be-sent",
    title: "must-not-be-sent",
    body: "must-not-be-sent",
    labels: "must-not-be-sent",
    reason: "Keep this observation local",
  });
  await view.previewProblemAction("local_only");
  assert.deepEqual(
    calls.find(call => call.operation === "problem.intake.contribution.plan"),
    {
      operation: "problem.intake.contribution.plan",
      args: {
        projectId,
        observationId: "problem-observation/alpha",
        choice: "local_only",
        actor: "ask-mate-ui-proposer",
        reason: "Keep this observation local",
      },
    },
  );
  view.setProblemPlanConfirmed(true);
  await assert.rejects(() => view.applyConfirmedProblemPlan(), /no external apply/i);
  assert.equal(
    calls.some(call => call.operation === "problem.intake.contribution.apply"),
    false,
  );
});

test("pull-request stages reuse one immutable plan with fresh authority and confirmation", async () => {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  let planSequence = 0;
  const client = new AskMateOperationClient({
    async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ operation, args });
      if (operation === "visual.map.read") return mapReadResult() as T;
      if (operation === "graph.adapters.query") return { snapshots: [] } as T;
      if (operation === "problem.intake.contribution.plan") {
        planSequence += 1;
        return {
          available: true,
          plan: contributionPlan("prepare_pull_request", "6"),
        } as T;
      }
      if (operation === "problem.intake.contribution.apply") {
        return { status: "applied", replayed: false, action: args.action } as T;
      }
      throw new Error(`Unexpected operation: ${operation}`);
    },
  });
  const view = new AskMateView({} as WorkspaceLeaf, client, {
    proposalActor: "ask-mate-ui-proposer",
    confirmationActor: "obsidian-control-plane",
  });
  view.render = () => undefined;
  await view.openContext({ projectId, kind: "managed_map", path });
  view.setProblemDraft({
    observationId: "problem-observation/alpha",
    repository: "owner/repo",
    title: "Fix",
    body: "Reviewed body",
    labels: "bug, regression",
  });

  const stages = [
    "push_branch",
    "create_draft_pull_request",
    "mark_ready_for_review",
  ] as const;
  for (const [index, stage] of stages.entries()) {
    await view.previewProblemAction(stage);
    assert.equal(planSequence, 1);
    await assert.rejects(() => view.applyConfirmedProblemPlan(), /confirm/i);

    view.setExternalAuthority({
      workRunId: `work-run/${stage}`,
      approvalToken: `approval/${stage}`,
    });
    view.setProblemPlanConfirmed(true);
    if (stage === "mark_ready_for_review") {
      await assert.rejects(
        () => view.applyConfirmedProblemPlan(),
        /pull request ID and expected revision/i,
      );
      view.setExternalAuthority({
        workRunId: `work-run/${stage}`,
        approvalToken: `approval/${stage}`,
        pullRequestId: "pull-request/42",
        expectedPullRequestRevision: "revision-42",
      });
      view.setProblemPlanConfirmed(true);
    }
    await view.applyConfirmedProblemPlan();
    await assert.rejects(() => view.applyConfirmedProblemPlan(), /confirm/i);
  }

  const planCalls = calls.filter(call =>
    call.operation === "problem.intake.contribution.plan");
  assert.equal(planCalls.length, 1);
  assert.deepEqual(planCalls[0]?.args, {
    projectId,
    observationId: "problem-observation/alpha",
    choice: "prepare_pull_request",
    actor: "ask-mate-ui-proposer",
    repository: "owner/repo",
    title: "Fix",
    body: "Reviewed body",
    labels: ["bug", "regression"],
  });

  const applyCalls = calls.filter(call =>
    call.operation === "problem.intake.contribution.apply");
  assert.deepEqual(applyCalls.map(call => call.args.action), stages);
  assert.deepEqual(
    applyCalls.map(call => (call.args.plan as AskMateExternalContributionPlan).fingerprint),
    Array.from({ length: stages.length }, () => `sha256:${"6".repeat(64)}`),
  );
  assert.deepEqual(
    applyCalls.map(call => call.args.presentedFingerprint),
    Array.from({ length: stages.length }, () => `sha256:${"6".repeat(64)}`),
  );
  for (const [index, call] of applyCalls.entries()) {
    assert.equal(call.args.approved, true);
    assert.equal(call.args.actor, "obsidian-control-plane");
    assert.equal(call.args.workRunId, `work-run/${stages[index]}`);
    assert.equal(call.args.approvalToken, `approval/${stages[index]}`);
    assert.match(String(call.args.transitionToken), /^ask-mate:/);
  }
  assert.equal(
    new Set(applyCalls.map(call => call.args.transitionToken)).size,
    stages.length,
  );
  assert.equal(applyCalls[2]?.args.pullRequestId, "pull-request/42");
  assert.equal(applyCalls[2]?.args.expectedPullRequestRevision, "revision-42");
  assert.equal(
    calls.some(call =>
      call.operation.toLowerCase().includes("merge")
      || String(call.args.action ?? "").toLowerCase().includes("merge")),
    false,
  );
});

test("unavailable pull-request planning remains non-mutating and exposes the issue fallback", async () => {
  const calls: string[] = [];
  const client = new AskMateOperationClient({
    async invoke<T>(operation: string): Promise<T> {
      calls.push(operation);
      if (operation === "visual.map.read") return mapReadResult() as T;
      if (operation === "graph.adapters.query") return { snapshots: [] } as T;
      if (operation === "problem.intake.contribution.plan") {
        return {
          available: false,
          choice: "prepare_pull_request",
          observationId: "problem-observation/alpha",
          reason: "No governed repository mapping",
          fallback: "submit_issue",
          warnings: ["Select a reviewed repository first."],
        } as T;
      }
      throw new Error(`Unexpected operation: ${operation}`);
    },
  });
  const view = new AskMateView({} as WorkspaceLeaf, client, {
    proposalActor: "ask-mate-ui-proposer",
    confirmationActor: "obsidian-control-plane",
  });
  view.render = () => undefined;
  await view.openContext({ projectId, kind: "managed_map", path });
  view.setProblemDraft({ observationId: "problem-observation/alpha" });
  await view.previewProblemAction("push_branch");
  view.setProblemPlanConfirmed(true);
  await assert.rejects(() => view.applyConfirmedProblemPlan(), /confirm/i);
  assert.equal(calls.includes("problem.intake.contribution.apply"), false);
});
