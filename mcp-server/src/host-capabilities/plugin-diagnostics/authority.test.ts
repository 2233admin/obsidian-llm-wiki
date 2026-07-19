import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAuthorizedPluginDiagnosticScan,
  PluginDiagnosticAuthorizationError,
  type PluginDiagnosticScanAuthority,
} from "./authority.js";

const NOW = Date.parse("2026-07-19T00:00:00.000Z");

function authority(): PluginDiagnosticScanAuthority {
  return {
    projectId: "project/alpha",
    workRun: {
      workRunId: "work-run/plugin-scan-001",
      lifecycle: "running",
    },
    assignmentPlan: {
      planId: "assignment/plugin-scan-001",
      projectId: "project/alpha",
      workRunId: "work-run/plugin-scan-001",
      operation: "obsidian.plugin.dataview.diagnostics.read",
      status: "matched",
      approval: "approved",
    },
    capabilityGrant: {
      grantId: "grant/plugin-scan-001",
      projectId: "project/alpha",
      workRunId: "work-run/plugin-scan-001",
      operations: ["obsidian.plugin.dataview.diagnostics.read"],
      sideEffectClasses: ["local-read"],
      expiresAt: "2026-07-20T00:00:00.000Z",
    },
    descriptor: {
      operation: "obsidian.plugin.dataview.diagnostics.read",
      sideEffectClass: "local-read",
    },
  };
}

test("agent plugin scans require matching Project, Work Run, Assignment Plan, and exact grant", () => {
  assert.doesNotThrow(() =>
    assertAuthorizedPluginDiagnosticScan(authority(), NOW),
  );

  const missing = authority();
  delete missing.capabilityGrant;
  assert.throws(
    () => assertAuthorizedPluginDiagnosticScan(missing, NOW),
    (error: unknown) =>
      error instanceof PluginDiagnosticAuthorizationError &&
      error.code === "capability-missing",
  );

  const stale = authority();
  stale.assignmentPlan.projectId = "project/other";
  assert.throws(
    () => assertAuthorizedPluginDiagnosticScan(stale, NOW),
    (error: unknown) =>
      error instanceof PluginDiagnosticAuthorizationError &&
      error.code === "scope-mismatch",
  );
});

test("installation never authorizes arbitrary commands or write operations", () => {
  const command = authority();
  command.assignmentPlan.operation = "obsidian.executeCommandById";
  assert.throws(
    () => assertAuthorizedPluginDiagnosticScan(command, NOW),
    (error: unknown) =>
      error instanceof PluginDiagnosticAuthorizationError &&
      error.code === "operation-not-granted",
  );

  const write = authority();
  write.descriptor.sideEffectClass = "local-write";
  write.capabilityGrant!.sideEffectClasses = ["local-write"];
  assert.throws(
    () => assertAuthorizedPluginDiagnosticScan(write, NOW),
    (error: unknown) =>
      error instanceof PluginDiagnosticAuthorizationError &&
      error.code === "read-only-required",
  );
});
