export type PluginDiagnosticAuthorityCode =
  | "project-context-required"
  | "work-run-inactive"
  | "assignment-not-approved"
  | "capability-missing"
  | "grant-expired"
  | "scope-mismatch"
  | "operation-not-granted"
  | "read-only-required";

export interface PluginDiagnosticScanAuthority {
  projectId: string;
  workRun: {
    workRunId: string;
    lifecycle: "planned" | "running" | "completed" | "failed" | "cancelled";
  };
  assignmentPlan: {
    planId: string;
    projectId: string;
    workRunId: string;
    operation: string;
    status: "matched" | "no-match";
    approval: "pending" | "approved" | "rejected";
  };
  capabilityGrant?: {
    grantId: string;
    projectId: string;
    workRunId: string;
    operations: string[];
    sideEffectClasses: string[];
    expiresAt: string;
  };
  descriptor: {
    operation: string;
    sideEffectClass: "none" | "local-read" | "local-write" | "external-read" | "external-write";
  };
}

export class PluginDiagnosticAuthorizationError extends Error {
  constructor(
    readonly code: PluginDiagnosticAuthorityCode,
    message: string,
  ) {
    super(message);
    this.name = "PluginDiagnosticAuthorizationError";
  }
}

const PROJECT_PATTERN =
  /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const WORK_RUN_PATTERN = /^work-run\/[a-z0-9][a-z0-9._-]{0,127}$/;

function deny(
  code: PluginDiagnosticAuthorityCode,
  message: string,
): never {
  throw new PluginDiagnosticAuthorizationError(code, message);
}

/**
 * Fail-closed authorization for Agent-triggered plugin diagnostic scans.
 *
 * Human-triggered local scans use the same typed descriptor contract but are
 * persisted only after the caller's Operation Write Policy decision.
 */
export function assertAuthorizedPluginDiagnosticScan(
  authority: PluginDiagnosticScanAuthority,
  now = Date.now(),
): void {
  if (!PROJECT_PATTERN.test(authority.projectId)) {
    deny(
      "project-context-required",
      "Plugin diagnostics require a canonical project/<slug> context",
    );
  }
  if (
    !WORK_RUN_PATTERN.test(authority.workRun.workRunId) ||
    authority.workRun.lifecycle !== "running"
  ) {
    deny(
      "work-run-inactive",
      "Plugin diagnostics require an active server-issued Work Run",
    );
  }
  if (
    authority.assignmentPlan.status !== "matched" ||
    authority.assignmentPlan.approval !== "approved"
  ) {
    deny(
      "assignment-not-approved",
      "Plugin diagnostics require an approved matched Assignment Plan",
    );
  }
  const grant = authority.capabilityGrant;
  if (!grant) {
    deny(
      "capability-missing",
      "Plugin installation does not grant diagnostic execution authority",
    );
  }
  if (!Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= now) {
    deny("grant-expired", "Plugin diagnostic Capability Grant has expired");
  }
  if (
    authority.projectId !== authority.assignmentPlan.projectId ||
    authority.projectId !== grant.projectId ||
    authority.workRun.workRunId !== authority.assignmentPlan.workRunId ||
    authority.workRun.workRunId !== grant.workRunId
  ) {
    deny(
      "scope-mismatch",
      "Project Context, Work Run, Assignment Plan, and Capability Grant must match",
    );
  }
  if (
    authority.assignmentPlan.operation !== authority.descriptor.operation ||
    !grant.operations.includes(authority.descriptor.operation)
  ) {
    deny(
      "operation-not-granted",
      "The exact typed diagnostic operation is not present in the Capability Grant",
    );
  }
  if (
    !new Set(["none", "local-read"]).has(authority.descriptor.sideEffectClass) ||
    !grant.sideEffectClasses.includes(authority.descriptor.sideEffectClass)
  ) {
    deny(
      "read-only-required",
      "Plugin diagnostic adapters may expose only granted read-only operations",
    );
  }
}
