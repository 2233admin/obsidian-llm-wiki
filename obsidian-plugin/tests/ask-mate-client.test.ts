import test from "node:test";
import assert from "node:assert/strict";
import type { MindMapDocument, VisualEditPlan } from "../../packages/visual-workspace/dist/src/index.js";
import {
  ASK_MATE_OPERATIONS,
  AskMateOperationClient,
  isManagedProjectMapPath,
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
