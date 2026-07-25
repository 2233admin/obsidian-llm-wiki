import test from "node:test";
import assert from "node:assert/strict";
import {
  DATAVIEW_REFERENCE_ADAPTER,
  PluginDiagnosticAdapterError,
  scanDataviewReferenceSnapshot,
  type DataviewDiagnosticInvocation,
} from "./dataview-reference-adapter.js";

function invocation(): DataviewDiagnosticInvocation {
  return {
    projectId: "project/alpha",
    snapshot: {
      installed: true,
      enabled: true,
      pluginVersion: "0.5.68",
      apiVersion: "0.5",
      declaredCapabilities: ["index.query"],
      indexReady: true,
      observedAt: "2026-07-19T00:00:00.000Z",
      findings: [{
        ruleId: "dataview.index-stale",
        subject: { kind: "vault-path", ref: "Notes/project.md" },
        severity: "warning",
        summary: "The indexed note is older than the declared source snapshot.",
        evidenceRefs: [{
          kind: "vault-path",
          ref: "Notes/project.md",
        }],
        requiredPermissions: ["plugin.index.health"],
      }],
    },
    provenance: {
      connectorId: "connector/obsidian-local",
      connectorVersion: "1.0.0",
      descriptorId: "descriptor/dataview-diagnostics",
      descriptorVersion: "1.0.0",
      operation: DATAVIEW_REFERENCE_ADAPTER.operation,
      traceId: "trace/dataview-scan-001",
      workRunId: "work-run/dataview-scan-001",
      assignmentPlanId: "assignment/dataview-scan-001",
      capabilityGrantId: "grant/dataview-scan-001",
    },
  };
}

test("Dataview reference adapter emits typed bounded findings without command authority", () => {
  const result = scanDataviewReferenceSnapshot(invocation());
  assert.equal(DATAVIEW_REFERENCE_ADAPTER.sideEffectClass, "local-read");
  assert.equal(DATAVIEW_REFERENCE_ADAPTER.arbitraryCommands, false);
  assert.equal(DATAVIEW_REFERENCE_ADAPTER.pluginInstallation, false);
  assert.equal(result.scan.health, "degraded");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.provenance.connectorId, "connector/obsidian-local");
  assert.equal(result.findings[0]?.ruleId, "dataview.index-stale");
  assert.deepEqual(result.diagnostics, []);
});

test("Dataview reference adapter reports stable degraded status codes", () => {
  const cases = [
    {
      code: "absent",
      mutate: (value: DataviewDiagnosticInvocation) => {
        value.snapshot.installed = false;
      },
    },
    {
      code: "disabled",
      mutate: (value: DataviewDiagnosticInvocation) => {
        value.snapshot.enabled = false;
      },
    },
    {
      code: "incompatible",
      mutate: (value: DataviewDiagnosticInvocation) => {
        value.snapshot.apiVersion = "9.0";
      },
    },
    {
      code: "capability-missing",
      mutate: (value: DataviewDiagnosticInvocation) => {
        value.snapshot.declaredCapabilities = [];
      },
    },
    {
      code: "runtime-failed",
      mutate: (value: DataviewDiagnosticInvocation) => {
        value.snapshot.indexReady = false;
      },
    },
  ] as const;

  for (const item of cases) {
    const value = invocation();
    item.mutate(value);
    const result = scanDataviewReferenceSnapshot(value);
    assert.equal(result.diagnostics[0]?.code, item.code);
    assert.equal(result.findings.length, 0);
  }
});

test("Dataview reference adapter rejects undeclared and secret-bearing plugin payloads", () => {
  const undeclared = invocation() as unknown as {
    snapshot: Record<string, unknown>;
  };
  undeclared.snapshot.pluginPrivateState = { opaque: true };
  assert.throws(
    () =>
      scanDataviewReferenceSnapshot(
        undeclared as unknown as DataviewDiagnosticInvocation,
      ),
    (error: unknown) =>
      error instanceof PluginDiagnosticAdapterError &&
      error.diagnostic.code === "privacy-blocked" &&
      !JSON.stringify(error.diagnostic).includes("opaque"),
  );

  const secret = invocation() as unknown as {
    snapshot: Record<string, unknown>;
  };
  secret.snapshot.authorization = "Bearer never-persist";
  assert.throws(
    () =>
      scanDataviewReferenceSnapshot(
        secret as unknown as DataviewDiagnosticInvocation,
      ),
    (error: unknown) =>
      error instanceof PluginDiagnosticAdapterError &&
      error.diagnostic.code === "privacy-blocked" &&
      !JSON.stringify(error.diagnostic).includes("never-persist"),
  );
});
