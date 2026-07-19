import test from "node:test";
import assert from "node:assert/strict";
import {
  PLUGIN_DIAGNOSTIC_SCHEMA_VERSION,
  PluginDiagnosticContractError,
  toProblemIntakeDiagnosticCandidates,
  validatePluginDiagnosticReport,
  type PluginDiagnosticReport,
} from "./contracts.js";

function report(): PluginDiagnosticReport {
  return {
    schemaVersion: PLUGIN_DIAGNOSTIC_SCHEMA_VERSION,
    projectId: "project/alpha",
    provider: {
      id: "obsidian-plugin/example",
      version: "1.0.0",
      pluginId: "example",
      pluginVersion: "2.0.0",
    },
    scan: {
      traceId: "trace/scan-001",
      operation: "obsidian.plugin.example.diagnostics.read",
      observedAt: "2026-07-19T00:00:00.000Z",
      health: "degraded",
    },
    findings: [{
      schemaVersion: PLUGIN_DIAGNOSTIC_SCHEMA_VERSION,
      findingId: "finding/one",
      providerId: "obsidian-plugin/example",
      providerVersion: "1.0.0",
      pluginId: "example",
      pluginVersion: "2.0.0",
      ruleId: "example.missing-index",
      subject: { kind: "vault-path", ref: "Notes/example.md" },
      severity: "warning",
      summary: "The bounded plugin index is unavailable.",
      evidenceRefs: [{
        kind: "connector-diagnostic",
        ref: "diagnostic/index-not-ready",
      }],
      health: "degraded",
      requiredPermissions: ["plugin.index.health"],
      observedAt: "2026-07-19T00:00:00.000Z",
      provenance: {
        connectorId: "connector/obsidian",
        connectorVersion: "1.0.0",
        descriptorId: "descriptor/example",
        descriptorVersion: "1.0.0",
        operation: "obsidian.plugin.example.diagnostics.read",
        traceId: "trace/scan-001",
        workRunId: "work-run/scan-001",
        assignmentPlanId: "assignment/scan-001",
        capabilityGrantId: "grant/scan-001",
      },
      retry: { retryable: true },
      remediations: [{
        code: "retry-plugin-index",
        summary: "Retry after the plugin index is ready.",
      }],
    }],
    diagnostics: [],
  };
}

test("plugin diagnostic reports retain provenance and normalize into bounded Problem Intake candidates", () => {
  const validated = validatePluginDiagnosticReport(report());
  assert.equal(validated.projectId, "project/alpha");
  assert.equal(validated.findings[0]?.provenance.connectorId, "connector/obsidian");
  assert.equal(validated.findings[0]?.provenance.traceId, "trace/scan-001");

  const candidates = toProblemIntakeDiagnosticCandidates(validated);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.projectId, "project/alpha");
  assert.match(candidates[0]?.sourceFingerprint ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(candidates[0]!).sort(), [
    "evidenceRefs",
    "observedAt",
    "projectId",
    "provenance",
    "provider",
    "ruleId",
    "schemaVersion",
    "severity",
    "sourceFingerprint",
    "subject",
    "summary",
  ]);
});

test("plugin diagnostic reports reject unknown fields, sensitive keys, and machine paths", () => {
  assert.throws(
    () =>
      validatePluginDiagnosticReport({
        ...report(),
        undeclaredPluginPayload: "opaque",
      }),
    PluginDiagnosticContractError,
  );

  const secret = report() as unknown as Record<string, unknown>;
  (secret.findings as Array<Record<string, unknown>>)[0]!.authorization =
    "Bearer hidden";
  assert.throws(
    () => validatePluginDiagnosticReport(secret),
    /sensitive|credentials/i,
  );

  const localPath = report();
  localPath.findings[0]!.subject.ref = "C:\\Users\\alice\\vault\\private.md";
  assert.throws(
    () => validatePluginDiagnosticReport(localPath),
    /machine-local paths/i,
  );
});

test("plugin diagnostic reports reject mismatched provider and trace identity", () => {
  const mismatch = report();
  mismatch.findings[0]!.provenance.traceId = "trace/other";
  assert.throws(
    () => validatePluginDiagnosticReport(mismatch),
    /provider, trace, and operation identity/i,
  );

  const wrongOperation = report();
  wrongOperation.findings[0]!.provenance.operation =
    "obsidian.plugin.example.other.read";
  assert.throws(
    () => validatePluginDiagnosticReport(wrongOperation),
    /operation identity/i,
  );
});
