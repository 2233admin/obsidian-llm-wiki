import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  parseManagedMindMapSection,
  type MindMapDocument,
} from "../../../packages/visual-workspace/dist/src/index.js";
import type {
  ProblemObservation,
  ProblemReport,
} from "../../../packages/problem-intake/dist/src/index.js";
import type {
  ProblemIntakeDependencies,
} from "../problem-intake/contracts.js";
import { ProblemIntakeExecutor } from "../problem-intake/executor.js";
import type {
  PluginDiagnosticObservationReceipt,
  ProblemIntakeDiagnosticCandidate,
} from "../host-capabilities/plugin-diagnostics/index.js";
import {
  PROJECT_HUB_PROJECTION_SCHEMA_VERSION,
  type ObservationProjectionInput,
  type ProjectHubProjectionInput,
  type ProviderHealthProjectionInput,
  type VisualDocumentProjectionInput,
  validateProjectHubProjectionInput,
} from "./contracts.js";

const PROJECT_ID = /^project\/([a-z0-9][a-z0-9-]{0,79})$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._/-]{0,199}$/;
const ISSUE_ENTITY = /^project\/([a-z0-9][a-z0-9-]*)\/issue\/([a-z0-9][a-z0-9-]*)$/;
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\/)/;
const SENSITIVE_VALUE =
  /\bBearer\s+\S+|(?:gh[pousr]_|github_pat_|glpat-)[A-Za-z0-9_-]{12,}/i;
const SAFE_REMOTE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/;

export interface ProductionProjectHubLoadRequest {
  projectId: string;
  generatedAt: string;
  vaultPath: string;
}

export interface ProductionProjectHubIntegration {
  loadVisualTriage(
    request: ProductionProjectHubLoadRequest,
  ): Promise<ProjectHubProjectionInput>;
  observePluginDiagnostic(
    candidate: ProblemIntakeDiagnosticCandidate,
  ): Promise<PluginDiagnosticObservationReceipt>;
}

export interface ProductionProjectHubIntegrationOptions {
  vaultPath: string;
  problemIntake: ProblemIntakeDependencies;
}

interface VisualReceipt {
  status: "pending" | "applied";
  projectId: string;
  path: string;
  sourceAfterSha256: `sha256:${string}`;
  modifiedAt: string;
}

interface ContributionReceiptProjection {
  observationId: string;
  kind: "issue" | "pull-request";
  provider: string;
  remoteRef: string;
  state: string;
  workRunId?: string;
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function projectSlug(projectId: string): string {
  const match = PROJECT_ID.exec(projectId);
  if (!match) throw new Error("Project Hub requires a canonical Project ID");
  return match[1]!;
}

function assertConfiguredVault(configured: string, requested: string): void {
  const expected = resolve(configured);
  const actual = resolve(requested);
  if (!isAbsolute(expected) || !isAbsolute(actual) || expected !== actual) {
    throw new Error("Project Hub loader vault does not match its production binding");
  }
}

function vaultRelative(vaultRoot: string, path: string): string | undefined {
  const value = relative(vaultRoot, path).replaceAll("\\", "/");
  if (!value || value.startsWith("../") || isAbsolute(value)) return undefined;
  return value;
}

function filesBelow(root: string, extension: string): string[] {
  if (!existsSync(root)) return [];
  const output: string[] = [];
  const visit = (directory: string): void => {
    try {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
        (left, right) => left.name.localeCompare(right.name),
      )) {
        if (entry.name.startsWith(".")) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (entry.isFile() && entry.name.endsWith(extension)) {
          output.push(path);
        }
      }
    } catch {
      // A missing, unreadable, or non-directory projection source is absent.
    }
  };
  visit(root);
  return output;
}

function safeDocumentId(document: MindMapDocument, path: string): string {
  return SAFE_ID.test(document.id)
    ? document.id
    : `mind-map/${digest(path).slice("sha256:".length, "sha256:".length + 24)}`;
}

function readVisualReceipts(
  vaultRoot: string,
  slug: string,
  projectId: string,
): VisualReceipt[] {
  const root = join(
    vaultRoot,
    "01-Projects",
    slug,
    "maps",
    ".llmwiki",
    "receipts",
  );
  return filesBelow(root, ".json").flatMap((path) => {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      if (
        raw.schemaVersion !== 1
        || (raw.status !== "pending" && raw.status !== "applied")
        || raw.projectId !== projectId
        || typeof raw.path !== "string"
        || !raw.path.startsWith(`01-Projects/${slug}/maps/`)
        || raw.path.includes("..")
        || typeof raw.sourceAfterSha256 !== "string"
        || !SHA256.test(raw.sourceAfterSha256)
      ) {
        return [];
      }
      return [{
        status: raw.status,
        projectId,
        path: raw.path,
        sourceAfterSha256: raw.sourceAfterSha256 as `sha256:${string}`,
        modifiedAt: statSync(path).mtime.toISOString(),
      }];
    } catch {
      return [];
    }
  });
}

function issueState(
  vaultRoot: string,
  projectId: string,
  entity: string,
): string {
  const match = ISSUE_ENTITY.exec(entity);
  if (!match || `project/${match[1]}` !== projectId) return "unknown";
  const path = join(
    vaultRoot,
    "01-Projects",
    match[1]!,
    "issues",
    `${match[2]}.md`,
  );
  if (!existsSync(path)) return "unknown";
  try {
    const state = /^state:\s*([a-z0-9-]+)\s*$/mi.exec(
      readFileSync(path, "utf8"),
    )?.[1];
    return state && SAFE_ID.test(state) ? state : "unknown";
  } catch {
    return "unknown";
  }
}

function linkedWorkItems(
  vaultRoot: string,
  projectId: string,
  document: MindMapDocument,
): VisualDocumentProjectionInput["linkedWorkItems"] {
  return [...new Set(
    document.nodes
      .map((node) => node.label.trim())
      .filter((label) => ISSUE_ENTITY.test(label) && label.startsWith(`${projectId}/issue/`)),
  )]
    .sort()
    .map((entity) => ({
      entity,
      state: issueState(vaultRoot, projectId, entity),
    }));
}

function loadVisualDocuments(
  vaultRoot: string,
  projectId: string,
): VisualDocumentProjectionInput[] {
  const slug = projectSlug(projectId);
  const mapRoot = join(vaultRoot, "01-Projects", slug, "maps");
  const receipts = readVisualReceipts(vaultRoot, slug, projectId);
  return filesBelow(mapRoot, ".md").flatMap<VisualDocumentProjectionInput>(
    (fullPath): VisualDocumentProjectionInput[] => {
      const path = vaultRelative(vaultRoot, fullPath);
      if (!path || path.includes("/.llmwiki/")) return [];
      const pathReceipts = receipts
        .filter((receipt) => receipt.path === path)
        .sort((left, right) => left.modifiedAt.localeCompare(right.modifiedAt));
      const latest = pathReceipts.at(-1);
      try {
        const observedAt = statSync(fullPath).mtime.toISOString();
        const source = readFileSync(fullPath, "utf8");
        const currentSourceHash = digest(source);
        const section = parseManagedMindMapSection(source);
        const appliedCount = pathReceipts.filter(
          (receipt) => receipt.status === "applied",
        ).length;
        return [{
          documentId: safeDocumentId(section.document, path),
          path,
          revision: Math.max(1, appliedCount),
          sourceObservedAt: observedAt,
          ...(latest ? { sourceHash: latest.sourceAfterSha256 } : {}),
          currentSourceHash,
          projectionStatus:
            latest && latest.sourceAfterSha256 !== currentSourceHash
              ? "stale" as const
              : "current" as const,
          linkedWorkItems: linkedWorkItems(
            vaultRoot,
            projectId,
            section.document,
          ),
        }];
      } catch {
        let observedAt = "1970-01-01T00:00:00.000Z";
        let currentSourceHash = digest("");
        try {
          observedAt = statSync(fullPath).mtime.toISOString();
          currentSourceHash = digest(readFileSync(fullPath, "utf8"));
        } catch {
          // The source disappeared during the read; keep a bounded failed row.
        }
        return [{
          documentId:
            `mind-map/${digest(path).slice("sha256:".length, "sha256:".length + 24)}`,
          path,
          revision: Math.max(1, pathReceipts.length),
          sourceObservedAt: observedAt,
          ...(latest ? { sourceHash: latest.sourceAfterSha256 } : {}),
          currentSourceHash,
          projectionStatus: "failed" as const,
          linkedWorkItems: [],
        }];
      }
    },
  );
}

function safeProviderFromRemoteUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_000) return "forge";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "forge";
    const host = url.hostname.toLowerCase();
    if (host === "github.com" || host.endsWith(".github.com")) return "github";
    if (host.includes("gitlab")) return "gitlab";
    if (host.includes("gitea")) return "gitea";
  } catch {
    // A malformed remote URL never reaches the projection.
  }
  return "forge";
}

function loadContributionReceipts(
  vaultRoot: string,
  projectId: string,
): ContributionReceiptProjection[] {
  const slug = projectSlug(projectId);
  const root = join(
    vaultRoot,
    "01-Projects",
    slug,
    "projection-receipts",
    "external-contributions",
  );
  return filesBelow(root, ".json").flatMap((path) => {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      if (
        raw.schemaVersion !== 1
        || raw.projectId !== projectId
        || typeof raw.observationId !== "string"
        || !raw.observationId.startsWith("problem/")
        || typeof raw.action !== "string"
        || !new Set([
          "create_issue",
          "push_branch",
          "create_draft_pull_request",
          "mark_ready_for_review",
        ]).has(raw.action)
        || typeof raw.status !== "string"
        || !new Set(["pending", "success", "outcome_unknown", "cancelled"]).has(
          raw.status,
        )
      ) {
        return [];
      }
      const remote = raw.remote && typeof raw.remote === "object"
        ? raw.remote as Record<string, unknown>
        : undefined;
      const remoteId =
        typeof remote?.remoteId === "string"
        && SAFE_REMOTE_REF.test(remote.remoteId)
        && !ABSOLUTE_PATH.test(remote.remoteId)
        && !SENSITIVE_VALUE.test(remote.remoteId)
          ? remote.remoteId
          : `${raw.action}:${digest(String(raw.planFingerprint ?? path)).slice(
              "sha256:".length,
              "sha256:".length + 16,
            )}`;
      const kind = raw.action === "create_issue" ? "issue" : "pull-request";
      const state = raw.status === "success"
        ? raw.action === "create_draft_pull_request"
          ? "draft"
          : raw.action === "mark_ready_for_review"
            ? "ready-for-review"
            : "applied"
        : raw.status;
      const workRunId =
        typeof raw.workRunId === "string"
        && /^work-run\/[a-z0-9][a-z0-9._-]{0,127}$/.test(raw.workRunId)
          ? raw.workRunId
          : undefined;
      return [{
        observationId: raw.observationId,
        kind,
        provider: safeProviderFromRemoteUrl(remote?.url),
        remoteRef: remoteId,
        state,
        ...(workRunId ? { workRunId } : {}),
      }];
    } catch {
      return [];
    }
  });
}

function lifecycle(
  observation: Readonly<ProblemObservation>,
): ObservationProjectionInput["lifecycle"] {
  if (
    observation.lifecycle === "untriaged"
    && observation.lifecycleHistory.at(-1)?.from === "resolved"
  ) {
    return "reopened";
  }
  return observation.lifecycle;
}

function projectObservation(
  vaultRoot: string,
  observation: Readonly<ProblemObservation>,
  receipts: ContributionReceiptProjection[],
): ObservationProjectionInput {
  const contributions = receipts
    .filter((receipt) => receipt.observationId === observation.id)
    .map(({ kind, provider, remoteRef, state }) => ({
      kind,
      provider,
      remoteRef,
      state,
    }));
  const workRuns = [...new Map(
    receipts
      .filter(
        (receipt): receipt is ContributionReceiptProjection & { workRunId: string } =>
          receipt.observationId === observation.id
          && receipt.workRunId !== undefined,
      )
      .map((receipt) => [
        receipt.workRunId,
        { workRunId: receipt.workRunId, state: receipt.state },
      ]),
  ).values()];
  return {
    observationId: observation.id,
    lifecycle: lifecycle(observation),
    providerId: observation.provider.id,
    severity: observation.severity === "critical"
      ? "error"
      : observation.severity,
    occurrenceCount: observation.occurrence.count,
    firstObservedAt: observation.occurrence.firstObservedAt,
    lastObservedAt: observation.occurrence.lastObservedAt,
    ...(observation.linkedIssue
      ? {
          linkedIssue: {
            entity: observation.linkedIssue,
            state: issueState(
              vaultRoot,
              observation.projectId,
              observation.linkedIssue,
            ),
          },
        }
      : {}),
    contributions,
    workRuns,
    verifications: observation.verificationHistory.map((verification) => ({
      verificationId:
        `verification/${observation.id.slice("problem/".length)}/${verification.revision}`,
      status: verification.status === "reproduced"
        ? "passed"
        : verification.status === "not_reproduced"
          ? "failed"
          : "unknown",
      observedAt: verification.verifiedAt,
      evidenceRefs: verification.evidenceRefs.map((reference) => reference.ref),
    })),
  };
}

function mergeProviderHealth(
  observations: readonly Readonly<ProblemObservation>[],
  diagnostics: Map<string, ProviderHealthProjectionInput>,
): ProviderHealthProjectionInput[] {
  const providers = new Map<string, ProviderHealthProjectionInput>();
  for (const observation of observations) {
    const existing = providers.get(observation.provider.id);
    const providerFailed = observation.verificationHistory.some(
      (verification) => verification.status === "provider_failed",
    );
    providers.set(observation.provider.id, {
      providerId: observation.provider.id,
      health: providerFailed ? "degraded" : existing?.health ?? "available",
      observedAt:
        !existing?.observedAt
        || observation.occurrence.lastObservedAt > existing.observedAt
          ? observation.occurrence.lastObservedAt
          : existing.observedAt,
    });
  }
  for (const [providerId, diagnostic] of diagnostics) {
    const existing = providers.get(providerId);
    providers.set(providerId, {
      ...diagnostic,
      ...(existing?.observedAt && (
        !diagnostic.observedAt || existing.observedAt > diagnostic.observedAt
      )
        ? { observedAt: existing.observedAt }
        : {}),
    });
  }
  return [...providers.values()].sort((left, right) =>
    left.providerId.localeCompare(right.providerId)
  );
}

function diagnosticProblemReport(
  candidate: ProblemIntakeDiagnosticCandidate,
): ProblemReport {
  const evidenceKind = (
    kind: ProblemIntakeDiagnosticCandidate["evidenceRefs"][number]["kind"],
  ): ProblemReport["evidenceRefs"][number]["kind"] => {
    if (kind === "vault-path") return "vault_path";
    if (kind === "source-url") return "citation";
    return "provider_finding";
  };
  const subjectKind: ProblemReport["subject"]["kind"] =
    candidate.subject.kind === "vault-path"
      ? "vault_path"
      : candidate.subject.kind === "plugin-capability"
        ? "capability"
        : "other";
  return {
    schemaVersion: 1,
    projectId: candidate.projectId as `project/${string}`,
    provider: {
      id: candidate.provider.id,
      kind: "host_capability",
      version: candidate.provider.version,
    },
    ruleId: candidate.ruleId,
    subject: {
      kind: subjectKind,
      canonicalRef: candidate.subject.ref,
    },
    severity: candidate.severity,
    summary: candidate.summary,
    evidenceRefs: candidate.evidenceRefs.map((reference) => ({
      kind: evidenceKind(reference.kind),
      ref: reference.ref,
      ...(reference.digest ? { digest: reference.digest } : {}),
    })),
    observedAt: candidate.observedAt,
  };
}

/**
 * Production-only, host-neutral composition for Project Hub and plugin
 * diagnostics. Loading never writes; only the explicit diagnostic observer
 * invokes canonical Problem Intake persistence.
 */
export function createProductionProjectHubIntegration(
  options: ProductionProjectHubIntegrationOptions,
): ProductionProjectHubIntegration {
  const vaultRoot = resolve(options.vaultPath);
  if (!isAbsolute(vaultRoot)) throw new Error("Project Hub vault path must be absolute");
  const executor = new ProblemIntakeExecutor(options.problemIntake);
  const diagnostics = new Map<string, ProviderHealthProjectionInput>();

  return {
    async loadVisualTriage(request) {
      assertConfiguredVault(vaultRoot, request.vaultPath);
      const slug = projectSlug(request.projectId);
      if (!Number.isFinite(Date.parse(request.generatedAt))) {
        throw new Error("Project Hub generatedAt must be an ISO timestamp");
      }
      const projectRoot = join(vaultRoot, "01-Projects", slug);
      const relativeProjectRoot = vaultRelative(vaultRoot, projectRoot);
      if (!relativeProjectRoot) {
        throw new Error("Project Hub Project root escapes the vault");
      }
      const observations = await options.problemIntake.domain.list(
        request.projectId,
      );
      const contributionReceipts = loadContributionReceipts(
        vaultRoot,
        request.projectId,
      );
      return validateProjectHubProjectionInput({
        schemaVersion: PROJECT_HUB_PROJECTION_SCHEMA_VERSION,
        projectId: request.projectId,
        generatedAt: request.generatedAt,
        visualDocuments: loadVisualDocuments(vaultRoot, request.projectId),
        observations: observations.map((observation) =>
          projectObservation(vaultRoot, observation, contributionReceipts)
        ),
        providerHealth: mergeProviderHealth(observations, diagnostics),
      });
    },

    async observePluginDiagnostic(candidate) {
      const report = diagnosticProblemReport(candidate);
      const result = await executor.observe(report);
      const existing = diagnostics.get(candidate.provider.id);
      const health = candidate.severity === "info"
        ? existing?.health ?? "available"
        : "degraded";
      diagnostics.set(candidate.provider.id, {
        providerId: candidate.provider.id,
        health,
        observedAt:
          !existing?.observedAt || candidate.observedAt > existing.observedAt
            ? candidate.observedAt
            : existing.observedAt,
      });
      return { observationId: result.observation.id };
    },
  };
}
