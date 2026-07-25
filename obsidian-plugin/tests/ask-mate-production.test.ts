import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serializeManagedMindMapSection } from "../../packages/visual-workspace/dist/src/index.js";
import {
  OBSIDIAN_CONTROL_PLANE_ACTOR,
  ProductionControlPlaneTransport,
} from "../src/production-control-plane-host";

test("production host activates visual map read/plan/apply and adapter graph query", async (t) => {
  const vaultPath = mkdtempSync(join(tmpdir(), "llmwiki-ask-mate-production-"));
  t.after(() => rmSync(vaultPath, { recursive: true, force: true }));
  const transport = new ProductionControlPlaneTransport({
    vaultPath,
    userDeviceId: "ask-mate-test",
    userDevicePath: join(vaultPath, "device-settings.json"),
    environment: { VAULT_MIND_GRAPHIFY_BINARY: "definitely-missing-graphify-command" },
  });
  await transport.invoke("project.init", {
    project: "alpha",
    description: "Ask Mate production activation",
  });
  const observed = await transport.invoke<Record<string, any>>("problem.intake.observe", {
    finding: {
      schemaVersion: 1,
      projectId: "project/alpha",
      provider: { id: "manual", kind: "manual", version: "1.0.0" },
      ruleId: "ask-mate-production",
      subject: { kind: "other", canonicalRef: "ask-mate/production" },
      severity: "warning",
      summary: "Production Problem Intake wiring",
      evidenceRefs: [{
        kind: "provider_finding",
        ref: "ask-mate/production",
        summary: "Host integration acceptance",
      }],
      observedAt: "2026-07-19T00:00:00.000Z",
    },
  });
  assert.match(observed.observation.id, /^problem\//);

  const path = "01-Projects/alpha/maps/alpha.md";
  const fullPath = join(vaultPath, ...path.split("/"));
  mkdirSync(join(vaultPath, "01-Projects", "alpha", "maps"), { recursive: true });
  const document = {
    schemaVersion: 1 as const,
    id: "map-alpha",
    title: "Alpha",
    rootId: "root",
    nodes: [
      { id: "root", label: "Root" },
      { id: "child", label: "Before" },
    ],
    edges: [{ from: "root", to: "child" }],
  };
  writeFileSync(fullPath, `Intro\n\n${serializeManagedMindMapSection(document)}\n\nOutro\n`, "utf8");

  const read = await transport.invoke<Record<string, any>>("visual.map.read", {
    project: "project/alpha",
    path,
  });
  assert.equal(read.document.nodes[1].label, "Before");

  const planned = await transport.invoke<Record<string, any>>("visual.map.plan", {
    project: "project/alpha",
    path,
    nextDocument: {
      ...document,
      nodes: document.nodes.map(node => node.id === "child" ? { ...node, label: "After" } : node),
    },
    actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
    origin: "user",
  });
  assert.equal(readFileSync(fullPath, "utf8").includes("Before"), true, "preview wrote source bytes");

  const applied = await transport.invoke<Record<string, any>>("visual.map.apply", {
    project: "project/alpha",
    plan: planned.plan,
    presentedFingerprint: planned.plan.fingerprint,
    actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
    transitionToken: "ask-mate-production-apply",
  });
  assert.equal(applied.replayed, false);
  assert.equal(readFileSync(fullPath, "utf8").includes("After"), true);
  assert.equal(readFileSync(fullPath, "utf8").startsWith("Intro\n\n"), true);
  assert.equal(readFileSync(fullPath, "utf8").endsWith("\n\nOutro\n"), true);

  const hub = await transport.invoke<Record<string, any>>("project.hub.get", {
    project: "project/alpha",
  });
  assert.equal(hub.projectId, "project/alpha");
  assert.equal(hub.sections.visual.data.documents.length, 1);
  assert.equal(hub.sections.triage.data.observations[0].observationId, observed.observation.id);

  const graphOutput = join(vaultPath, "graphify-out");
  mkdirSync(graphOutput, { recursive: true });
  writeFileSync(join(graphOutput, "graph.json"), JSON.stringify({
    nodes: [
      {
        id: "node-root",
        label: "Alpha map",
        file_type: "markdown",
        source_file: fullPath,
      },
      {
        id: "node-related",
        label: "Related evidence",
        file_type: "markdown",
        source_file: join(vaultPath, "10-Projects", "alpha", "evidence", "related.md"),
      },
    ],
    edges: [{
      source: "node-root",
      target: "node-related",
      relation: "supports",
      confidence: "inferred",
      source_file: fullPath,
    }],
  }), "utf8");

  // A fresh host sees the cached Graphify graph even when the CLI is absent.
  const graphTransport = new ProductionControlPlaneTransport({
    vaultPath,
    userDeviceId: "ask-mate-graph-test",
    userDevicePath: join(vaultPath, "graph-device-settings.json"),
    environment: { VAULT_MIND_GRAPHIFY_BINARY: "definitely-missing-graphify-command" },
  });
  const graph = await graphTransport.invoke<Record<string, any>>("graph.adapters.query", {
    adapters: ["graphify"],
  });
  assert.equal(graph.snapshots.length, 1);
  assert.equal(graph.snapshots[0].adapter, "graphify");
  assert.deepEqual(graph.snapshots[0].graph.edges[0].evidence[0], {
    adapter: "graphify",
    relation: "supports",
    confidence: "inferred",
    sourcePath: path,
  });
  assert.deepEqual(graph.diagnostics, []);
});
