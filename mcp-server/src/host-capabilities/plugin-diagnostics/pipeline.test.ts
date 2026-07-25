import test from "node:test";
import assert from "node:assert/strict";
import {
  DATAVIEW_REFERENCE_ADAPTER,
  scanDataviewReferenceSnapshot,
  type DataviewDiagnosticInvocation,
} from "./dataview-reference-adapter.js";
import { submitPluginDiagnosticReportToProblemIntake } from "./pipeline.js";

function rawReport() {
  const invocation: DataviewDiagnosticInvocation = {
    projectId: "project/alpha",
    snapshot: {
      installed: true,
      enabled: true,
      pluginVersion: "0.5.68",
      apiVersion: "0.5",
      declaredCapabilities: ["index.query"],
      indexReady: true,
      observedAt: "2026-07-19T00:00:00.000Z",
      findings: [
        {
          ruleId: "dataview.index-stale",
          subject: { kind: "vault-path", ref: "Notes/one.md" },
          severity: "warning",
          summary: "One index entry is stale.",
          evidenceRefs: [{ kind: "vault-path", ref: "Notes/one.md" }],
          requiredPermissions: ["plugin.index.health"],
        },
        {
          ruleId: "dataview.index-stale",
          subject: { kind: "vault-path", ref: "Notes/two.md" },
          severity: "warning",
          summary: "Another index entry is stale.",
          evidenceRefs: [{ kind: "vault-path", ref: "Notes/two.md" }],
          requiredPermissions: ["plugin.index.health"],
        },
      ],
    },
    provenance: {
      connectorId: "connector/obsidian-local",
      connectorVersion: "1.0.0",
      descriptorId: "descriptor/dataview-diagnostics",
      descriptorVersion: "1.0.0",
      operation: DATAVIEW_REFERENCE_ADAPTER.operation,
      traceId: "trace/dataview-pipeline-001",
      workRunId: "work-run/dataview-pipeline-001",
      assignmentPlanId: "assignment/dataview-pipeline-001",
      capabilityGrantId: "grant/dataview-pipeline-001",
    },
  };
  return scanDataviewReferenceSnapshot(invocation);
}

test("pipeline validates once, submits bounded candidates, and returns trace receipts", async () => {
  const seen: string[] = [];
  const receipt = await submitPluginDiagnosticReportToProblemIntake(
    rawReport(),
    async (candidate) => {
      seen.push(candidate.subject.ref);
      return {
        observationId: `problem/${candidate.subject.ref.includes("one") ? "one" : "two"}`,
      };
    },
  );

  assert.deepEqual(seen, ["Notes/one.md", "Notes/two.md"]);
  assert.deepEqual(receipt, {
    traceId: "trace/dataview-pipeline-001",
    providerId: "obsidian-plugin/dataview-diagnostics",
    candidateCount: 2,
    observationIds: ["problem/one", "problem/two"],
  });
});

test("pipeline rejects undeclared payload before the first Problem Intake callback", async () => {
  const invalid = {
    ...rawReport(),
    pluginPrivatePayload: { authorization: "Bearer do-not-copy" },
  };
  let calls = 0;
  await assert.rejects(
    () =>
      submitPluginDiagnosticReportToProblemIntake(invalid, async () => {
        calls += 1;
        return { observationId: "problem/unexpected" };
      }),
    /sensitive|supported/i,
  );
  assert.equal(calls, 0);
});
