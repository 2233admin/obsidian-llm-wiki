import test from "node:test";
import assert from "node:assert/strict";
import type { MindMapDocument, VisualEditPlan } from "../../packages/visual-workspace/dist/src/index.js";
import {
  ASK_MATE_OPERATIONS,
  AskMateOperationClient,
  isManagedProjectMapPath,
  type AskMateExternalContributionPlan,
} from "../src/ask-mate/client";

const project = "project/alpha" as const;
const path = "01-Projects/alpha/maps/alpha.md";
const document: MindMapDocument = {
  schemaVersion: 1,
  id: "map-alpha",
  title: "Alpha",
  rootId: "root",
  nodes: [{ id: "root", label: "Root" }],
  edges: [],
};
const plan = {
  fingerprint: `sha256:${"a".repeat(64)}`,
} as VisualEditPlan;

test("active-note command path gate accepts only the current Project managed maps folder", () => {
  assert.equal(isManagedProjectMapPath(project, path), true);
  assert.equal(isManagedProjectMapPath(project, "01-Projects/alpha/issues/alpha.md"), false);
  assert.equal(isManagedProjectMapPath(project, "01-Projects/beta/maps/alpha.md"), false);
  assert.equal(isManagedProjectMapPath(project, "01-Projects/alpha/maps/../issues/alpha.md"), false);
  assert.equal(isManagedProjectMapPath(project, "01-Projects/alpha/maps/.llmwiki/private.md"), false);
  assert.equal(isManagedProjectMapPath(project, "01-Projects/alpha/maps/nested//alpha.md"), false);
  assert.equal(isManagedProjectMapPath(project, "C:\\vault\\01-Projects\\alpha\\maps\\alpha.md"), false);
});

test("read and preview use only their matching operations; apply is a separate explicit call", async () => {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const client = new AskMateOperationClient({
    async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ operation, args });
      if (operation === ASK_MATE_OPERATIONS.readMap) return { document } as T;
      if (operation === ASK_MATE_OPERATIONS.planMap) return { projectId: project, path, plan } as T;
      return { projectId: project, path, replayed: false } as T;
    },
  });

  await client.readMap(project, path);
  await client.planMap({
    project,
    path,
    nextDocument: document,
    actor: "obsidian-ask-mate",
  });
  assert.deepEqual(calls.map(call => call.operation), [
    ASK_MATE_OPERATIONS.readMap,
    ASK_MATE_OPERATIONS.planMap,
  ]);
  assert.equal(calls.some(call => call.operation === ASK_MATE_OPERATIONS.applyMap), false);

  await client.applyMap({
    project,
    plan,
    presentedFingerprint: plan.fingerprint,
    actor: "obsidian-ask-mate",
    transitionToken: "ask-mate:test",
  });
  assert.equal(calls.at(-1)?.operation, ASK_MATE_OPERATIONS.applyMap);
  assert.deepEqual(calls.at(-1)?.args, {
    project,
    plan,
    presentedFingerprint: plan.fingerprint,
    actor: "obsidian-ask-mate",
    transitionToken: "ask-mate:test",
  });
});

test("Graphify query keeps provenance/confidence/source path and filters unrelated edges", async () => {
  const client = new AskMateOperationClient({
    async invoke<T>(operation: string): Promise<T> {
      assert.equal(operation, "graph.adapters.query");
      return {
        snapshots: [{
          adapter: "graphify",
          status: "ok",
          graph: {
            edges: [
              {
                from: path,
                to: "10-Projects/alpha/evidence/related.md",
                type: "link",
                evidence: [{
                  adapter: "graphify",
                  relation: "supports",
                  confidence: "inferred",
                  sourcePath: path,
                }],
              },
              {
                from: "unrelated-a.md",
                to: "unrelated-b.md",
                type: "link",
                evidence: [{
                  adapter: "graphify",
                  relation: "mentions",
                  confidence: "extracted",
                  sourcePath: "unrelated-a.md",
                }],
              },
            ],
          },
        }],
      } as T;
    },
  });

  assert.deepEqual(await client.queryGraphEvidence(path), [{
    id: `graphify:0:0:${path}:10-Projects/alpha/evidence/related.md`,
    adapter: "graphify",
    relation: "supports",
    from: path,
    to: "10-Projects/alpha/evidence/related.md",
    confidence: "inferred",
    evidenceRefs: [path],
  }]);
});

test("ordinary note and Canvas contexts use one bounded context read operation", async () => {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const client = new AskMateOperationClient({
    async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ operation, args });
      return {
        projectId: project,
        context: { kind: "selection", path, sourceLabel: path },
        adoptionRequired: true,
        readOnly: true,
        warnings: [],
        clarifications: [],
        capabilities: {
          model: "degraded",
          graphify: "unavailable",
          problemIntake: "available",
          messages: [],
        },
      } as T;
    },
  });
  await client.readContext({
    projectId: project,
    kind: "selection",
    path,
    selection: { text: "selected only", from: 1, to: 14 },
  });
  assert.deepEqual(calls, [{
    operation: ASK_MATE_OPERATIONS.readContext,
    args: {
      project,
      context: {
        kind: "selection",
        path,
        selection: { text: "selected only", from: 1, to: 14 },
      },
    },
  }]);
  assert.equal(calls.some(call => /scan|list/i.test(call.operation)), false);
});

test("accepted Graphify evidence and clarification choices are explicit plan inputs", async () => {
  let args: Record<string, unknown> = {};
  const client = new AskMateOperationClient({
    async invoke<T>(_operation: string, input: Record<string, unknown>): Promise<T> {
      args = input;
      return { projectId: project, path, plan } as T;
    },
  });
  await client.planMap({
    project,
    path,
    nextDocument: document,
    actor: "obsidian-ask-mate",
    acceptedGraphEvidence: [{
      id: "graphify:accepted",
      adapter: "graphify",
      relation: "supports",
      from: path,
      to: "related.md",
      confidence: "extracted",
      evidenceRefs: ["evidence.md#^relation"],
    }],
    clarificationAnswers: { root: "root-a" },
  });
  assert.deepEqual(args.acceptedGraphEvidence, [{
    id: "graphify:accepted",
    adapter: "graphify",
    relation: "supports",
    from: path,
    to: "related.md",
    confidence: "extracted",
    evidenceRefs: ["evidence.md#^relation"],
  }]);
  assert.deepEqual(args.clarificationAnswers, { root: "root-a" });
});

test("contribution planning rejects credentials and machine paths before transport invocation", async () => {
  let invoked = false;
  const client = new AskMateOperationClient({
    async invoke<T>(): Promise<T> {
      invoked = true;
      return {} as T;
    },
  });
  assert.throws(() => client.planContribution({
    projectId: project,
    observationId: "problem-observation/alpha",
    choice: "submit_issue",
    actor: "obsidian-control-plane",
    body: "Bearer usable-secret-value",
  }), /bearer credentials/i);
  assert.throws(() => client.planContribution({
    projectId: project,
    observationId: "problem-observation/alpha",
    choice: "submit_issue",
    actor: "obsidian-control-plane",
    body: "logs at C:\\Users\\private\\trace.log",
  }), /machine-local absolute path/i);
  assert.equal(invoked, false);
});

test("Problem Intake contribution ports use canonical plan and per-stage authority fields", async () => {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const contributionPlan = {
    schemaVersion: 1,
    id: "contribution/alpha",
    disposition: { choice: "prepare_pull_request" },
    projectId: project,
    observationId: "problem-observation/alpha",
    observationRevision: 3,
    target: { provider: "github", repository: "owner/repo" },
    content: { title: "Fix", body: "Reviewed body", labels: [] },
    patch: { draft: true },
    executionProjection: { schemaVersion: 1 },
    redactions: [],
    warnings: [],
    actor: "obsidian-control-plane",
    fingerprint: `sha256:${"8".repeat(64)}`,
  } as unknown as AskMateExternalContributionPlan;
  const client = new AskMateOperationClient({
    async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ operation, args });
      if (operation === ASK_MATE_OPERATIONS.planContribution) {
        return { available: true, plan: contributionPlan } as T;
      }
      return { localOnly: false, replayed: false } as T;
    },
  });

  await client.planContribution({
    projectId: project,
    observationId: "problem-observation/alpha",
    choice: "prepare_pull_request",
    actor: "obsidian-control-plane",
    repository: "owner/repo",
    title: "Fix",
    body: "Reviewed body",
    labels: ["bug"],
  });
  assert.deepEqual(calls.at(-1), {
    operation: ASK_MATE_OPERATIONS.planContribution,
    args: {
      projectId: project,
      observationId: "problem-observation/alpha",
      choice: "prepare_pull_request",
      actor: "obsidian-control-plane",
      repository: "owner/repo",
      title: "Fix",
      body: "Reviewed body",
      labels: ["bug"],
    },
  });

  await client.applyContribution({
    plan: contributionPlan,
    presentedFingerprint: contributionPlan.fingerprint,
    approved: true,
    actor: "obsidian-control-plane",
    workRunId: "work-run/alpha",
    approvalToken: "opaque-per-run-approval",
    transitionToken: "ask-mate:push",
    action: "push_branch",
  });
  assert.deepEqual(calls.at(-1), {
    operation: ASK_MATE_OPERATIONS.applyContribution,
    args: {
      plan: contributionPlan,
      presentedFingerprint: contributionPlan.fingerprint,
      approved: true,
      actor: "obsidian-control-plane",
      workRunId: "work-run/alpha",
      approvalToken: "opaque-per-run-approval",
      transitionToken: "ask-mate:push",
      action: "push_branch",
    },
  });
});
