import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

import { createProductionProblemIntakeDependencies } from "../problem-intake/production.js";
import {
  createProductionProjectHubIntegration,
} from "./production.js";

function write(root: string, path: string, content: string): void {
  const full = join(root, ...path.split("/"));
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function snapshot(root: string): Record<string, string> {
  const output: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else {
        output[relative(root, full).replaceAll("\\", "/")] =
          readFileSync(full, "utf8");
      }
    }
  };
  visit(root);
  return output;
}

test("production integration composes real maps, observations, Forge receipts, and provider health read-only", async () => {
  const root = mkdtempSync(join(tmpdir(), "llmwiki-project-hub-"));
  try {
    write(
      root,
      "01-Projects/alpha/maps/alpha.md",
      [
        "# Alpha",
        "",
        "<!-- llmwiki:mind-map:v1 {\"id\":\"mind-map-alpha\",\"title\":\"Alpha\"} -->",
        "- \"Alpha\" ^alpha",
        "  - \"project/alpha/issue/fix-links\" ^fix-links",
        "<!-- /llmwiki:mind-map:v1 -->",
        "",
      ].join("\n"),
    );
    write(
      root,
      "01-Projects/alpha/issues/fix-links.md",
      "---\nstate: in-progress\n---\nFix links\n",
    );
    write(
      root,
      "01-Projects/alpha/maps/.llmwiki/receipts/map.json",
      JSON.stringify({
        schemaVersion: 1,
        status: "applied",
        projectId: "project/alpha",
        path: "01-Projects/alpha/maps/alpha.md",
        sourceAfterSha256:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    );

    const dependencies = createProductionProblemIntakeDependencies(
      root,
      {
        async call() {
          throw new Error("Project operations are not used by this test");
        },
      },
    );
    const integration = createProductionProjectHubIntegration({
      vaultPath: root,
      problemIntake: dependencies,
    });
    const observed = await integration.observePluginDiagnostic({
      schemaVersion: 1,
      projectId: "project/alpha",
      provider: {
        id: "dataview",
        version: "0.5.70",
        pluginId: "dataview",
        pluginVersion: "0.5.70",
      },
      ruleId: "missing-target",
      subject: {
        kind: "plugin-capability",
        ref: "plugin/dataview/link-index",
      },
      severity: "warning",
      summary: "One governed link target is missing.",
      evidenceRefs: [{
        kind: "connector-diagnostic",
        ref: "diagnostic/dataview/missing-target",
      }],
      observedAt: "2026-07-19T10:00:00.000Z",
      provenance: {
        connectorId: "connector/dataview",
        connectorVersion: "1.0.0",
        descriptorId: "descriptor/dataview",
        descriptorVersion: "1.0.0",
        operation: "dataview.diagnostics.read",
        traceId: "trace/project-hub-test",
      },
      sourceFingerprint:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    write(
      root,
      "01-Projects/alpha/projection-receipts/external-contributions/issue.json",
      JSON.stringify({
        schemaVersion: 1,
        status: "success",
        action: "create_issue",
        planFingerprint:
          "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        projectId: "project/alpha",
        observationId: observed.observationId,
        actor: "human",
        transitionTokenDigest:
          "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        confirmationTokenDigest:
          "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        remoteFactsFingerprint:
          "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        workRunId: "work-run/project-hub-test",
        createdAt: "2026-07-19T10:01:00.000Z",
        completedAt: "2026-07-19T10:02:00.000Z",
        remote: {
          remoteId: "issue/42",
          revision: "revision-1",
          url: "https://github.com/2233admin/obsidian-llm-wiki/issues/42",
        },
      }),
    );
    write(
      root,
      "01-Projects/alpha/projection-receipts/external-contributions/unsafe-pr.json",
      JSON.stringify({
        schemaVersion: 1,
        status: "success",
        action: "create_draft_pull_request",
        planFingerprint:
          "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        projectId: "project/alpha",
        observationId: observed.observationId,
        actor: "human",
        remote: {
          remoteId: "C:\\Users\\Administrator\\private",
          revision: "secret-revision",
          url: "https://token:secret@example.test/private",
        },
      }),
    );

    const before = snapshot(root);
    const projection = await integration.loadVisualTriage({
      projectId: "project/alpha",
      generatedAt: "2026-07-19T11:00:00.000Z",
      vaultPath: root,
    });
    const after = snapshot(root);

    assert.deepEqual(after, before);
    assert.equal(projection.visualDocuments.length, 1);
    assert.equal(projection.visualDocuments[0]?.documentId, "mind-map-alpha");
    assert.equal(projection.visualDocuments[0]?.projectionStatus, "stale");
    assert.deepEqual(projection.visualDocuments[0]?.linkedWorkItems, [{
      entity: "project/alpha/issue/fix-links",
      state: "in-progress",
    }]);
    assert.equal(projection.observations.length, 1);
    assert.equal(
      projection.observations[0]?.contributions[0]?.remoteRef,
      "issue/42",
    );
    assert.equal(projection.observations[0]?.contributions.length, 2);
    assert.doesNotMatch(
      JSON.stringify(projection),
      /Administrator|token|secret|example\.test/i,
    );
    assert.deepEqual(projection.observations[0]?.workRuns, [{
      workRunId: "work-run/project-hub-test",
      state: "applied",
    }]);
    assert.deepEqual(projection.providerHealth, [{
      providerId: "dataview",
      health: "degraded",
      observedAt: "2026-07-19T10:00:00.000Z",
    }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("production loader degrades missing and malformed project data without leaking unsafe receipt material", async () => {
  const root = mkdtempSync(join(tmpdir(), "llmwiki-project-hub-safe-"));
  try {
    write(
      root,
      "01-Projects/alpha/maps/broken.md",
      "# not a managed map\n",
    );
    write(
      root,
      "01-Projects/alpha/projection-receipts/external-contributions/unsafe.json",
      JSON.stringify({
        schemaVersion: 1,
        status: "success",
        action: "create_draft_pull_request",
        planFingerprint:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        projectId: "project/alpha",
        observationId: "problem/missing",
        remote: {
          remoteId: "C:\\Users\\Administrator\\private",
          revision: "secret-revision",
          url: "https://token:secret@example.test/private",
        },
      }),
    );
    const dependencies = createProductionProblemIntakeDependencies(root, {
      async call() {
        throw new Error("unused");
      },
    });
    const integration = createProductionProjectHubIntegration({
      vaultPath: root,
      problemIntake: dependencies,
    });
    const projection = await integration.loadVisualTriage({
      projectId: "project/alpha",
      generatedAt: "2026-07-19T11:00:00.000Z",
      vaultPath: root,
    });
    const serialized = JSON.stringify(projection);

    assert.equal(projection.visualDocuments[0]?.projectionStatus, "failed");
    assert.deepEqual(projection.observations, []);
    assert.deepEqual(projection.providerHealth, []);
    assert.doesNotMatch(serialized, /Administrator|token|secret|example\.test/i);

    const empty = await integration.loadVisualTriage({
      projectId: "project/beta",
      generatedAt: "2026-07-19T11:00:00.000Z",
      vaultPath: root,
    });
    assert.deepEqual(empty.visualDocuments, []);
    assert.deepEqual(empty.observations, []);
    assert.deepEqual(empty.providerHealth, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
