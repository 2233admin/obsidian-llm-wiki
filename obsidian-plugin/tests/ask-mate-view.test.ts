import test from "node:test";
import assert from "node:assert/strict";
import type { WorkspaceLeaf } from "obsidian";
import type { MindMapDocument, VisualEditPlan } from "../../packages/visual-workspace/dist/src/index.js";
import { AskMateOperationClient } from "../src/ask-mate/client";
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
  assert.deepEqual(view.getState(), { projectId, path });
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
