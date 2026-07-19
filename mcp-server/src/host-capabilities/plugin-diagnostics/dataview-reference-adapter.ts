import { createHash } from "node:crypto";
import {
  PLUGIN_DIAGNOSTIC_SCHEMA_VERSION,
  PluginDiagnosticContractError,
  type PluginAdapterDiagnostic,
  type PluginDiagnosticEvidenceReference,
  type PluginDiagnosticFinding,
  type PluginDiagnosticProvenance,
  type PluginDiagnosticReport,
  validatePluginDiagnosticReport,
} from "./contracts.js";

export const DATAVIEW_REFERENCE_ADAPTER = Object.freeze({
  schemaVersion: PLUGIN_DIAGNOSTIC_SCHEMA_VERSION,
  adapterId: "obsidian-plugin/dataview-diagnostics",
  adapterVersion: "1.0.0",
  pluginId: "dataview",
  displayName: "Dataview read-only diagnostic reference adapter",
  source: {
    url: "https://github.com/blacksmithgu/obsidian-dataview",
    license: "MIT",
  },
  operation: "obsidian.plugin.dataview.diagnostics.read",
  sideEffectClass: "local-read",
  allowedResources: ["plugin.metadata", "plugin.index.health", "vault.path.references"],
  arbitraryCommands: false,
  dynamicCode: false,
  pluginInstallation: false,
});

export interface DataviewReferenceFinding {
  ruleId: string;
  subject: {
    kind: "vault-path" | "project-entity" | "plugin-capability";
    ref: string;
  };
  severity: "info" | "warning" | "error";
  summary: string;
  evidenceRefs: PluginDiagnosticEvidenceReference[];
  requiredPermissions: string[];
}

export interface DataviewDiagnosticSnapshot {
  installed: boolean;
  enabled: boolean;
  pluginVersion?: string;
  apiVersion?: string;
  declaredCapabilities: string[];
  indexReady: boolean;
  observedAt: string;
  findings: DataviewReferenceFinding[];
}

export interface DataviewDiagnosticInvocation {
  projectId: string;
  snapshot: DataviewDiagnosticSnapshot;
  provenance: PluginDiagnosticProvenance;
}

export class PluginDiagnosticAdapterError extends Error {
  constructor(readonly diagnostic: PluginAdapterDiagnostic) {
    super(diagnostic.summary);
    this.name = "PluginDiagnosticAdapterError";
  }
}

const ALLOWED_API_VERSIONS = new Set(["0.5", "0.6"]);
const REQUIRED_CAPABILITY = "index.query";
const SAFE_ID = /^[a-z0-9][a-z0-9._/-]{0,159}$/;
const SAFE_REF = /^(?![A-Za-z]:[\\/])(?!\/(?:Users|home|root)\/)(?!.*\.\.).+$/;
const SAFE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const SENSITIVE_KEY =
  /(?:authorization|cookie|token|secret|password|api[-_]?key|headers?|personal[-_]?data)/i;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeAdapterDiagnostic(
  invocation: DataviewDiagnosticInvocation,
  code: PluginAdapterDiagnostic["code"],
  summary: string,
  retryable: boolean,
): PluginAdapterDiagnostic {
  return {
    schemaVersion: PLUGIN_DIAGNOSTIC_SCHEMA_VERSION,
    code,
    providerId: DATAVIEW_REFERENCE_ADAPTER.adapterId,
    pluginId: DATAVIEW_REFERENCE_ADAPTER.pluginId,
    health: code === "disabled" ? "disabled" : code === "runtime-failed" ? "degraded" : "unavailable",
    summary,
    observedAt: Number.isFinite(Date.parse(invocation.snapshot.observedAt))
      ? invocation.snapshot.observedAt
      : new Date(0).toISOString(),
    traceId: /^trace\/[a-z0-9][a-z0-9._-]{0,127}$/.test(
      invocation.provenance.traceId,
    )
      ? invocation.provenance.traceId
      : "trace/invalid-adapter-response",
    retryable,
    remediations: [{
      code: code === "privacy-blocked" ? "inspect-adapter-contract" : "inspect-plugin-health",
      summary: code === "privacy-blocked"
        ? "Inspect the adapter contract; undeclared or sensitive fields were not accepted."
        : "Inspect the plugin installation, compatibility, and current runtime health.",
    }],
  };
}

function reject(
  invocation: DataviewDiagnosticInvocation,
  code: PluginAdapterDiagnostic["code"],
  summary: string,
  retryable = false,
): never {
  throw new PluginDiagnosticAdapterError(
    safeAdapterDiagnostic(invocation, code, summary, retryable),
  );
}

function closed(
  value: unknown,
  allowed: readonly string[],
  invocation: DataviewDiagnosticInvocation,
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    reject(invocation, "privacy-blocked", `${path} must be a typed object`);
  }
  const item = value as Record<string, unknown>;
  for (const key of Object.keys(item)) {
    if (SENSITIVE_KEY.test(key) || !allowed.includes(key)) {
      reject(
        invocation,
        "privacy-blocked",
        `${path} contained an undeclared or sensitive field`,
      );
    }
  }
  return item;
}

function validateSnapshot(invocation: DataviewDiagnosticInvocation): void {
  const snapshot = closed(
    invocation.snapshot,
    [
      "installed",
      "enabled",
      "pluginVersion",
      "apiVersion",
      "declaredCapabilities",
      "indexReady",
      "observedAt",
      "findings",
    ],
    invocation,
    "snapshot",
  );
  if (
    typeof snapshot.installed !== "boolean" ||
    typeof snapshot.enabled !== "boolean" ||
    typeof snapshot.indexReady !== "boolean"
  ) {
    reject(invocation, "privacy-blocked", "Snapshot booleans are malformed");
  }
  if (!Number.isFinite(Date.parse(String(snapshot.observedAt)))) {
    reject(invocation, "privacy-blocked", "Snapshot timestamp is malformed");
  }
  for (const field of ["pluginVersion", "apiVersion"] as const) {
    if (
      snapshot[field] !== undefined &&
      (typeof snapshot[field] !== "string" ||
        !SAFE_VERSION.test(snapshot[field] as string))
    ) {
      reject(invocation, "privacy-blocked", `${field} is malformed`);
    }
  }
  if (
    !Array.isArray(snapshot.declaredCapabilities) ||
    snapshot.declaredCapabilities.length > 32 ||
    snapshot.declaredCapabilities.some(
      (item) => typeof item !== "string" || !SAFE_ID.test(item),
    )
  ) {
    reject(invocation, "privacy-blocked", "Declared capabilities are malformed");
  }
  if (!Array.isArray(snapshot.findings) || snapshot.findings.length > 250) {
    reject(invocation, "privacy-blocked", "Finding payload is unbounded");
  }
  for (const [index, raw] of snapshot.findings.entries()) {
    const finding = closed(
      raw,
      [
        "ruleId",
        "subject",
        "severity",
        "summary",
        "evidenceRefs",
        "requiredPermissions",
      ],
      invocation,
      `snapshot.findings[${index}]`,
    );
    const subject = closed(
      finding.subject,
      ["kind", "ref"],
      invocation,
      `snapshot.findings[${index}].subject`,
    );
    if (
      typeof finding.ruleId !== "string" ||
      !SAFE_ID.test(finding.ruleId) ||
      typeof subject.ref !== "string" ||
      !SAFE_REF.test(subject.ref) ||
      typeof finding.summary !== "string" ||
      finding.summary.length > 500
    ) {
      reject(invocation, "privacy-blocked", "Finding identity or summary is unsafe");
    }
    if (
      !new Set(["vault-path", "project-entity", "plugin-capability"]).has(
        String(subject.kind),
      ) ||
      !new Set(["info", "warning", "error"]).has(String(finding.severity))
    ) {
      reject(invocation, "privacy-blocked", "Finding enum value is unsupported");
    }
  }
}

function findingFrom(
  invocation: DataviewDiagnosticInvocation,
  source: DataviewReferenceFinding,
): PluginDiagnosticFinding {
  const findingId = `finding/${digest({
    ruleId: source.ruleId,
    subject: source.subject,
    evidenceRefs: source.evidenceRefs,
  }).slice(0, 24)}`;
  return {
    schemaVersion: PLUGIN_DIAGNOSTIC_SCHEMA_VERSION,
    findingId,
    providerId: DATAVIEW_REFERENCE_ADAPTER.adapterId,
    providerVersion: DATAVIEW_REFERENCE_ADAPTER.adapterVersion,
    pluginId: DATAVIEW_REFERENCE_ADAPTER.pluginId,
    ...(invocation.snapshot.pluginVersion
      ? { pluginVersion: invocation.snapshot.pluginVersion }
      : {}),
    ruleId: source.ruleId,
    subject: structuredClone(source.subject),
    severity: source.severity,
    summary: source.summary,
    evidenceRefs: structuredClone(source.evidenceRefs),
    health: "degraded",
    requiredPermissions: [...source.requiredPermissions].sort(),
    observedAt: invocation.snapshot.observedAt,
    provenance: structuredClone(invocation.provenance),
    retry: { retryable: true },
    remediations: [{
      code: "review-plugin-finding",
      summary: "Review the bounded evidence and choose whether to keep it local or route it to Problem Intake.",
    }],
  };
}

/**
 * Converts a bounded snapshot supplied by an approved Obsidian bridge into the
 * typed diagnostic contract. It never calls plugin commands, reads the vault,
 * installs plugins, or persists findings.
 */
export function scanDataviewReferenceSnapshot(
  invocation: DataviewDiagnosticInvocation,
): PluginDiagnosticReport {
  validateSnapshot(invocation);
  const diagnostics: PluginAdapterDiagnostic[] = [];
  if (!invocation.snapshot.installed) {
    diagnostics.push(
      safeAdapterDiagnostic(
        invocation,
        "absent",
        "The optional Dataview plugin is not installed.",
        false,
      ),
    );
  } else if (!invocation.snapshot.enabled) {
    diagnostics.push(
      safeAdapterDiagnostic(
        invocation,
        "disabled",
        "The optional Dataview plugin is disabled.",
        false,
      ),
    );
  } else if (
    !invocation.snapshot.apiVersion ||
    !ALLOWED_API_VERSIONS.has(invocation.snapshot.apiVersion)
  ) {
    diagnostics.push(
      safeAdapterDiagnostic(
        invocation,
        "incompatible",
        "The declared Dataview API version is not approved by this adapter.",
        false,
      ),
    );
  } else if (
    !invocation.snapshot.declaredCapabilities.includes(REQUIRED_CAPABILITY)
  ) {
    diagnostics.push(
      safeAdapterDiagnostic(
        invocation,
        "capability-missing",
        "The approved read-only index capability is unavailable.",
        false,
      ),
    );
  } else if (!invocation.snapshot.indexReady) {
    diagnostics.push(
      safeAdapterDiagnostic(
        invocation,
        "runtime-failed",
        "The Dataview index is not ready.",
        true,
      ),
    );
  }

  const canReport = diagnostics.length === 0;
  const report: PluginDiagnosticReport = {
    schemaVersion: PLUGIN_DIAGNOSTIC_SCHEMA_VERSION,
    projectId: invocation.projectId,
    provider: {
      id: DATAVIEW_REFERENCE_ADAPTER.adapterId,
      version: DATAVIEW_REFERENCE_ADAPTER.adapterVersion,
      pluginId: DATAVIEW_REFERENCE_ADAPTER.pluginId,
      ...(invocation.snapshot.pluginVersion
        ? { pluginVersion: invocation.snapshot.pluginVersion }
        : {}),
    },
    scan: {
      traceId: invocation.provenance.traceId,
      operation: DATAVIEW_REFERENCE_ADAPTER.operation,
      observedAt: invocation.snapshot.observedAt,
      health: canReport
        ? invocation.snapshot.findings.length
          ? "degraded"
          : "available"
        : diagnostics[0]!.health,
    },
    findings: canReport
      ? invocation.snapshot.findings.map((finding) =>
          findingFrom(invocation, finding),
        )
      : [],
    diagnostics,
  };
  try {
    return validatePluginDiagnosticReport(report);
  } catch (error) {
    if (
      error instanceof PluginDiagnosticContractError ||
      error instanceof TypeError
    ) {
      reject(
        invocation,
        "privacy-blocked",
        "The adapter result violated its declared schema and was rejected.",
      );
    }
    throw error;
  }
}
