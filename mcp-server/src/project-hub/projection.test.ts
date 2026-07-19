import test from "node:test";
import assert from "node:assert/strict";
import {
  PROJECT_HUB_PROJECTION_SCHEMA_VERSION,
  ProjectHubProjectionContractError,
  type ProjectHubProjectionInput,
  validateProjectHubProjectionInput,
} from "./contracts.js";
import {
  composeProjectHubVisualTriageProjection,
  renderProjectHubVisualTriageBase,
  renderProjectHubVisualTriageCanvas,
  renderProjectHubVisualTriageText,
} from "./projection.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;

function input(): ProjectHubProjectionInput {
  return {
    schemaVersion: PROJECT_HUB_PROJECTION_SCHEMA_VERSION,
    projectId: "project/alpha",
    generatedAt: "2026-07-19T12:00:00.000Z",
    visualDocuments: [{
      documentId: "mind-map/alpha",
      path: "10-Projects/alpha/maps/alpha.md",
      revision: 3,
      sourceObservedAt: "2026-07-19T10:00:00.000Z",
      sourceHash: HASH_A,
      currentSourceHash: HASH_A,
      projectionStatus: "current",
      linkedWorkItems: [{
        entity: "project/alpha/issue/fix-plugin",
        state: "todo",
        reviewedAt: "2026-07-19T09:00:00.000Z",
      }],
    }],
    observations: [
      {
        observationId: "observation/prior-plugin-failure",
        lifecycle: "untriaged",
        providerId: "obsidian-plugin/legacy",
        severity: "warning",
        occurrenceCount: 2,
        firstObservedAt: "2026-07-17T00:00:00.000Z",
        lastObservedAt: "2026-07-18T00:00:00.000Z",
        linkedIssue: {
          entity: "project/alpha/issue/fix-plugin",
          state: "todo",
        },
        contributions: [{
          kind: "issue",
          provider: "github",
          remoteRef: "https://github.com/example/plugin/issues/12",
          state: "open",
        }],
        workRuns: [{
          workRunId: "work-run/fix-plugin-001",
          state: "running",
        }],
        verifications: [{
          verificationId: "verification/prior",
          status: "passed",
          observedAt: "2026-07-18T00:00:00.000Z",
          evidenceRefs: ["diagnostic/prior"],
        }],
      },
      {
        observationId: "observation/resolved-plugin-failure",
        lifecycle: "resolved",
        providerId: "obsidian-plugin/current",
        severity: "info",
        occurrenceCount: 1,
        firstObservedAt: "2026-07-18T00:00:00.000Z",
        lastObservedAt: "2026-07-19T08:00:00.000Z",
        contributions: [],
        workRuns: [],
        verifications: [{
          verificationId: "verification/current",
          status: "passed",
          observedAt: "2026-07-19T09:00:00.000Z",
          evidenceRefs: ["diagnostic/current"],
        }],
      },
    ],
    providerHealth: [
      {
        providerId: "obsidian-plugin/legacy",
        health: "unavailable",
        observedAt: "2026-07-18T00:00:00.000Z",
        diagnosticCode: "runtime-failed",
      },
      {
        providerId: "obsidian-plugin/current",
        health: "available",
        observedAt: "2026-07-19T10:00:00.000Z",
        expiresAt: "2026-07-20T00:00:00.000Z",
      },
    ],
  };
}

test("Project Hub composes read-only visual and triage sections with end-to-end traces", () => {
  const projection = composeProjectHubVisualTriageProjection(input());
  assert.equal(projection.readOnly, true);
  assert.equal(projection.sections.visual.owner, "visual-workspace");
  assert.equal(projection.sections.visual.documents[0]?.sourceFreshness, "current");
  assert.equal(projection.sections.triage.owner, "problem-intake");
  assert.equal(projection.sections.triage.summary.untriaged, 1);
  assert.equal(projection.sections.triage.summary.resolved, 1);
  assert.equal(projection.sections.triage.summary.recurring, 1);
  assert.equal(projection.sections.triage.summary["issue-linked"], 1);

  const prior = projection.sections.triage.observations.find(
    (item) => item.observationId === "observation/prior-plugin-failure",
  )!;
  assert.equal(prior.providerFreshness, "stale");
  assert.equal(prior.newlyVerified, false);
  assert.equal(prior.trace.localIssue?.entity, "project/alpha/issue/fix-plugin");
  assert.equal(prior.trace.upstream[0]?.remoteRef, "https://github.com/example/plugin/issues/12");
  assert.equal(prior.trace.workRuns[0]?.workRunId, "work-run/fix-plugin-001");
  assert.equal(prior.trace.verifications[0]?.status, "passed");
});

test("linked Work-OS state refreshes without changing visual semantics", () => {
  const original = input();
  const before = composeProjectHubVisualTriageProjection(original);
  const afterInput = structuredClone(original);
  afterInput.visualDocuments[0]!.linkedWorkItems[0]!.state = "done";
  afterInput.observations[0]!.linkedIssue!.state = "done";
  const after = composeProjectHubVisualTriageProjection(afterInput);

  assert.equal(before.sections.visual.documents[0]?.documentId, after.sections.visual.documents[0]?.documentId);
  assert.equal(before.sections.visual.documents[0]?.revision, after.sections.visual.documents[0]?.revision);
  assert.equal(after.sections.visual.documents[0]?.linkedWorkItems[0]?.state, "done");
  assert.equal(after.sections.triage.observations[0]?.trace.localIssue?.state, "done");
});

test("Project Hub input rejects unknown fields and private machine-local material", () => {
  assert.throws(
    () =>
      validateProjectHubProjectionInput({
        ...input(),
        copiedCanonicalState: {},
      }),
    ProjectHubProjectionContractError,
  );

  const secret = input() as unknown as Record<string, unknown>;
  (secret.providerHealth as Array<Record<string, unknown>>)[0]!.authorization =
    "Bearer do-not-store";
  assert.throws(
    () => validateProjectHubProjectionInput(secret),
    /sensitive fields/i,
  );

  const local = input();
  local.visualDocuments[0]!.path = "C:\\Users\\alice\\vault\\map.md";
  assert.throws(
    () => validateProjectHubProjectionInput(local),
    /machine-local paths/i,
  );
});

test("text, Base, and Canvas projections are deterministic and remain derived", () => {
  const projection = composeProjectHubVisualTriageProjection(input());
  const text = renderProjectHubVisualTriageText(projection);
  const base = renderProjectHubVisualTriageBase(projection);
  const canvas = renderProjectHubVisualTriageCanvas(projection);

  assert.equal(text, renderProjectHubVisualTriageText(projection));
  assert.deepEqual(base, renderProjectHubVisualTriageBase(projection));
  assert.deepEqual(canvas, renderProjectHubVisualTriageCanvas(projection));
  assert.match(text, /Mutations route to Visual Workspace, Problem Intake, Work-OS/);
  assert.equal(base.readOnly, true);
  assert.equal(base.sourceOwner, "problem-intake");
  assert.ok(canvas.nodes.some((node) => node.llmwikiOwner === "visual-workspace"));
  assert.ok(canvas.nodes.some((node) => node.llmwikiOwner === "problem-intake"));
  assert.ok(canvas.nodes.some((node) => node.llmwikiOwner === "work-os"));
  assert.ok(canvas.nodes.some((node) => node.llmwikiOwner === "governed-tracker-or-forge"));
  assert.ok(canvas.nodes.some((node) => node.llmwikiOwner === "work-driver"));
  assert.ok(canvas.nodes.some((node) => node.llmwikiOwner === "verification"));
});

test("visual source drift and provider expiry are explicit freshness states", () => {
  const stale = input();
  stale.visualDocuments[0]!.currentSourceHash = HASH_B;
  stale.providerHealth[1]!.expiresAt = "2026-07-19T11:00:00.000Z";
  const projection = composeProjectHubVisualTriageProjection(stale);

  assert.equal(projection.sections.visual.freshness, "stale");
  assert.equal(projection.sections.visual.health, "degraded");
  assert.equal(
    projection.sections.triage.providers.find(
      (provider) => provider.providerId === "obsidian-plugin/current",
    )?.freshness,
    "stale",
  );
});
