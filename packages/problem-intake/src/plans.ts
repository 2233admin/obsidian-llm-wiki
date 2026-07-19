import { canonicalDigest, deepClone, deepFreeze } from "./canonical.js";
import { ProblemIntakeError } from "./errors.js";
import { redactExternalText } from "./security.js";
import type {
  ExternalContributionContent,
  ExternalContributionExecutionProjection,
  ExternalContributionPlan,
  ExternalRepositoryTarget,
  IssueChangePlan,
  ProblemDisposition,
  ProblemDispositionChoice,
  ProblemObservation,
  PullRequestPatchEvidence,
  Sha256Digest,
} from "./types.js";
import {
  parseBoundedText,
  parseExternalContributionPlan,
  parseIssueChangePlan,
  parseIssueEntity,
  parseProblemDisposition,
  parseProblemObservation,
  parseSha256,
} from "./validation.js";

function issueBody(observation: ProblemObservation): string {
  const evidence = observation.evidenceRefs.length === 0
    ? "- No bounded evidence reference was supplied."
    : observation.evidenceRefs.map((item) => `- ${item.kind}: ${item.ref}`).join("\n");
  return [
    observation.summary,
    "",
    `Problem Observation: ${observation.id}`,
    `Provider: ${observation.provider.id}@${observation.provider.version}`,
    `Rule: ${observation.ruleId}`,
    `Subject: ${observation.subject.canonicalRef}`,
    `Observed: ${observation.observedAt}`,
    "",
    "Evidence:",
    evidence,
  ].join("\n");
}

export function createIssueChangePlan(input: {
  observation: unknown;
  actor: string;
  existingIssueEntity?: string;
  action?: "update" | "comment";
  priority?: 0 | 1 | 2 | 3 | 4;
  warnings?: readonly string[];
}): Readonly<IssueChangePlan> {
  const observation = parseProblemObservation(input.observation);
  const actor = parseBoundedText(input.actor, "actor", { max: 256 });
  const existingIssueEntity = input.existingIssueEntity === undefined
    ? observation.linkedIssue
    : parseIssueEntity(input.existingIssueEntity);
  if (existingIssueEntity && !existingIssueEntity.startsWith(`${observation.projectId}/issue/`)) {
    throw new ProblemIntakeError(
      "INVALID_PROJECT_ID",
      "The selected Work-OS issue belongs to another Project",
    );
  }
  const action = existingIssueEntity === null ? "create" : (input.action ?? "comment");
  const operation = action === "create"
    ? "project.issue.create"
    : action === "update"
      ? "project.issue.update"
      : "project.comment.add";
  const description = observation.summary.replace(/\s+/g, " ").slice(0, 200);
  const payload = {
    title: description,
    description,
    body: issueBody(observation),
    priority: input.priority ?? (observation.severity === "critical" ? 1 : observation.severity === "error" ? 2 : 3),
  } as const;
  const warnings = [...(input.warnings ?? [])].map((warning, index) =>
    parseBoundedText(warning, `warnings[${index}]`, { max: 1000 }));
  const planWithoutFingerprint: Omit<IssueChangePlan, "fingerprint"> = {
    schemaVersion: 1,
    projectId: observation.projectId,
    observationId: observation.id,
    observationRevision: observation.revision,
    existingIssueEntity,
    action,
    operation,
    payload,
    evidenceRefs: deepClone(observation.evidenceRefs),
    warnings,
    actor,
  };
  const plan: IssueChangePlan = {
    ...planWithoutFingerprint,
    fingerprint: canonicalDigest(planWithoutFingerprint),
  };
  parseIssueChangePlan(plan);
  return deepFreeze(plan) as Readonly<IssueChangePlan>;
}

export function assertIssueChangePlan(value: unknown): asserts value is IssueChangePlan {
  parseIssueChangePlan(value);
}

export function createProblemDisposition(input: {
  observation: unknown;
  choice: ProblemDispositionChoice;
  actor: string;
  selectedAt: string;
  reason?: string | null;
}): Readonly<ProblemDisposition> {
  const observation = parseProblemObservation(input.observation);
  const disposition: ProblemDisposition = {
    schemaVersion: 1,
    observationId: observation.id,
    observationRevision: observation.revision,
    choice: input.choice,
    actor: input.actor,
    selectedAt: input.selectedAt,
    reason: input.reason ?? null,
  };
  return deepFreeze(parseProblemDisposition(disposition));
}

export interface CreateExternalContributionPlanInput {
  observation: unknown;
  disposition: unknown;
  linkedIssueEntity?: string | null;
  target?: ExternalRepositoryTarget;
  title?: string;
  body?: string;
  labels?: readonly string[];
  patch?: PullRequestPatchEvidence;
  executionProjection?: Omit<ExternalContributionExecutionProjection, "projectionFingerprint">;
  settingsSnapshotFingerprint?: Sha256Digest;
  remoteHeadFingerprint?: Sha256Digest;
  warnings?: readonly string[];
}

export function createExternalContributionPlan(
  input: CreateExternalContributionPlanInput,
): Readonly<ExternalContributionPlan> {
  const observation = parseProblemObservation(input.observation);
  const disposition = parseProblemDisposition(input.disposition);
  if (
    disposition.observationId !== observation.id
    || disposition.observationRevision !== observation.revision
  ) {
    throw new ProblemIntakeError(
      "REVISION_CONFLICT",
      "The disposition no longer matches the current Problem Observation",
    );
  }
  const linkedIssueEntity = input.linkedIssueEntity === undefined
    ? observation.linkedIssue
    : input.linkedIssueEntity === null
      ? null
      : parseIssueEntity(input.linkedIssueEntity);
  if (linkedIssueEntity && !linkedIssueEntity.startsWith(`${observation.projectId}/issue/`)) {
    throw new ProblemIntakeError(
      "INVALID_PROJECT_ID",
      "The linked Work-OS issue belongs to another Project",
    );
  }

  const redactions: string[] = [];
  let target: ExternalRepositoryTarget | null = null;
  let content: ExternalContributionContent | null = null;
  let patch: PullRequestPatchEvidence | null = null;
  let executionProjection: ExternalContributionExecutionProjection | null = null;
  let settingsSnapshotFingerprint: Sha256Digest | null = null;
  let remoteHeadFingerprint: Sha256Digest | null = null;

  if (disposition.choice !== "local_only") {
    if (
      input.target === undefined
      || input.title === undefined
      || input.body === undefined
      || input.settingsSnapshotFingerprint === undefined
      || input.remoteHeadFingerprint === undefined
      || input.executionProjection === undefined
    ) {
      throw new ProblemIntakeError(
        "INVALID_CONTRACT",
        "Remote contribution planning requires target, content, Settings snapshot, and remote-head facts",
      );
    }
    const safeTitle = redactExternalText(input.title, "title");
    const safeBody = redactExternalText(input.body, "body");
    const labels = (input.labels ?? []).map((label, index) => {
      const safe = redactExternalText(label, `labels[${index}]`);
      redactions.push(...safe.redactions);
      return safe.value;
    });
    redactions.push(...safeTitle.redactions, ...safeBody.redactions);
    target = deepClone(input.target);
    content = {
      title: safeTitle.value,
      body: safeBody.value,
      labels,
      evidenceRefs: deepClone(observation.evidenceRefs),
    };
    settingsSnapshotFingerprint = parseSha256(
      input.settingsSnapshotFingerprint,
      "settingsSnapshotFingerprint",
    );
    remoteHeadFingerprint = parseSha256(input.remoteHeadFingerprint, "remoteHeadFingerprint");
    executionProjection = {
      ...deepClone(input.executionProjection),
      projectionFingerprint: canonicalDigest(input.executionProjection),
    };
    if (disposition.choice === "prepare_pull_request") {
      if (input.patch === undefined) {
        throw new ProblemIntakeError(
          "UNVERIFIED_PATCH",
          "Prepare pull request is unavailable without isolated passing patch evidence",
        );
      }
      patch = deepClone(input.patch);
    } else if (input.patch !== undefined) {
      throw new ProblemIntakeError(
        "INVALID_CONTRACT",
        "An upstream Issue plan cannot contain patch evidence",
      );
    }
  } else if (
    input.target !== undefined
    || input.title !== undefined
    || input.body !== undefined
    || input.labels !== undefined
    || input.patch !== undefined
    || input.executionProjection !== undefined
    || input.settingsSnapshotFingerprint !== undefined
    || input.remoteHeadFingerprint !== undefined
  ) {
    throw new ProblemIntakeError(
      "CONSENT_REQUIRED",
      "Local-only disposition cannot retain inferred remote intent",
    );
  }

  const warnings = (input.warnings ?? []).map((warning, index) =>
    parseBoundedText(warning, `warnings[${index}]`, { max: 1000 }));
  const payload = {
    schemaVersion: 1 as const,
    disposition,
    projectId: observation.projectId,
    observationId: observation.id,
    observationRevision: observation.revision,
    linkedIssueEntity,
    target,
    content,
    patch,
    executionProjection,
    settingsSnapshotFingerprint,
    remoteHeadFingerprint,
    redactions: [...new Set(redactions)].sort(),
    warnings,
    actor: disposition.actor,
  };
  const fingerprint = canonicalDigest(payload);
  const plan: ExternalContributionPlan = {
    ...payload,
    id: `contribution/${fingerprint.slice("sha256:".length)}`,
    fingerprint,
  };
  const parsed = parseExternalContributionPlan(plan);
  return deepFreeze(parsed);
}

export function assertExternalContributionPlan(
  value: unknown,
): asserts value is ExternalContributionPlan {
  parseExternalContributionPlan(value);
}
