import { canonicalDigest, deepClone, deepFreeze } from "./canonical.js";
import { ProblemIntakeError } from "./errors.js";
import type {
  ContributionPlanId,
  IngestProblemResult,
  ObservationTransitionRequest,
  ObservationTransitionResult,
  ProblemObservation,
  ProblemObservationId,
  ProblemReport,
  ProjectId,
  VerifyObservationRequest,
} from "./types.js";
import {
  parseBoundedText,
  parseContributionId,
  parseEvidenceReferences,
  parseInstant,
  parseIssueEntity,
  parseObservationId,
  parsePositiveInteger,
  parseProblemObservation,
  parseProblemReport,
  parseProjectId,
  problemObservationFingerprint,
  problemObservationId,
  problemSourceFingerprint,
} from "./validation.js";

export interface ProblemObservationRepository {
  get(id: ProblemObservationId): Readonly<ProblemObservation> | undefined;
  findByFingerprint(
    projectId: ProjectId,
    observationFingerprint: string,
  ): Readonly<ProblemObservation> | undefined;
  list(projectId?: ProjectId): readonly Readonly<ProblemObservation>[];
  save(observation: ProblemObservation): Readonly<ProblemObservation>;
}

export class InMemoryProblemObservationRepository implements ProblemObservationRepository {
  readonly #observations = new Map<ProblemObservationId, Readonly<ProblemObservation>>();
  readonly #capacity: number;

  constructor(input: { capacity?: number; initial?: readonly unknown[] } = {}) {
    this.#capacity = input.capacity ?? 1000;
    if (!Number.isSafeInteger(this.#capacity) || this.#capacity < 1 || this.#capacity > 100_000) {
      throw new ProblemIntakeError("BOUNDS_EXCEEDED", "Repository capacity must be between 1 and 100000");
    }
    for (const observation of input.initial ?? []) this.save(parseProblemObservation(observation));
  }

  get(id: ProblemObservationId): Readonly<ProblemObservation> | undefined {
    const observation = this.#observations.get(id);
    return observation === undefined ? undefined : deepFreeze(deepClone(observation));
  }

  findByFingerprint(
    projectId: ProjectId,
    observationFingerprint: string,
  ): Readonly<ProblemObservation> | undefined {
    for (const observation of this.#observations.values()) {
      if (
        observation.projectId === projectId
        && observation.observationFingerprint === observationFingerprint
      ) {
        return deepFreeze(deepClone(observation));
      }
    }
    return undefined;
  }

  list(projectId?: ProjectId): readonly Readonly<ProblemObservation>[] {
    const result = [...this.#observations.values()]
      .filter((observation) => projectId === undefined || observation.projectId === projectId)
      .sort((left, right) =>
        left.projectId.localeCompare(right.projectId)
        || left.id.localeCompare(right.id))
      .map((observation) => deepFreeze(deepClone(observation)));
    return deepFreeze(result);
  }

  save(value: ProblemObservation): Readonly<ProblemObservation> {
    const observation = parseProblemObservation(value);
    const existing = this.#observations.get(observation.id);
    if (!existing && this.#observations.size >= this.#capacity) {
      throw new ProblemIntakeError(
        "BOUNDS_EXCEEDED",
        "Problem Observation repository capacity has been reached",
      );
    }
    if (existing) {
      if (observation.revision < existing.revision) {
        throw new ProblemIntakeError(
          "REVISION_CONFLICT",
          "Problem Observation persistence cannot move to an older revision",
        );
      }
      if (
        observation.revision === existing.revision
        && canonicalDigest(observation) !== canonicalDigest(existing)
      ) {
        throw new ProblemIntakeError(
          "REVISION_CONFLICT",
          "Problem Observation persistence cannot replace a revision with different bytes",
        );
      }
    }
    const frozen = deepFreeze(deepClone(observation));
    this.#observations.set(observation.id, frozen);
    return deepFreeze(deepClone(frozen));
  }
}

interface RecordedTransition {
  requestFingerprint: string;
  result: ObservationTransitionResult;
}

export interface ProblemIntakeService {
  ingest(value: unknown): Readonly<IngestProblemResult>;
  get(value: unknown): Readonly<ProblemObservation>;
  list(projectId?: unknown): readonly Readonly<ProblemObservation>[];
  transition(value: ObservationTransitionRequest): Readonly<ObservationTransitionResult>;
  verify(value: VerifyObservationRequest): Readonly<ProblemObservation>;
  linkIssue(input: {
    observationId: ProblemObservationId;
    expectedRevision: number;
    issueEntity: string;
  }): Readonly<ProblemObservation>;
  linkContribution(input: {
    observationId: ProblemObservationId;
    expectedRevision: number;
    contributionId: ContributionPlanId;
  }): Readonly<ProblemObservation>;
}

const ALLOWED_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  untriaged: ["acknowledged", "dismissed", "resolved"],
  acknowledged: ["dismissed", "resolved"],
  dismissed: ["untriaged"],
  resolved: ["untriaged"],
};

export class InMemoryProblemIntake implements ProblemIntakeService {
  readonly #repository: ProblemObservationRepository;
  readonly #transitions = new Map<string, RecordedTransition>();

  constructor(repository: ProblemObservationRepository = new InMemoryProblemObservationRepository()) {
    this.#repository = repository;
  }

  ingest(value: unknown): Readonly<IngestProblemResult> {
    const report = parseProblemReport(value);
    const observationFingerprint = problemObservationFingerprint(report);
    const existing = this.#repository.findByFingerprint(report.projectId, observationFingerprint);
    if (existing) {
      const providerVersions = [...new Set([
        ...existing.occurrence.providerVersions,
        report.provider.version,
      ])].sort();
      const lastObservedAt = report.observedAt > existing.occurrence.lastObservedAt
        ? report.observedAt
        : existing.occurrence.lastObservedAt;
      const next: ProblemObservation = {
        ...deepClone(existing),
        provider: report.provider,
        severity: report.severity,
        summary: report.summary,
        observedAt: lastObservedAt,
        revision: existing.revision + 1,
        occurrence: {
          count: existing.occurrence.count + 1,
          firstObservedAt: existing.occurrence.firstObservedAt,
          lastObservedAt,
          providerVersions,
        },
        suggestedAction: report.suggestedAction ?? existing.suggestedAction,
      };
      return deepFreeze({
        observation: this.#repository.save(next),
        deduplicated: true,
      });
    }

    const observation = createObservation(report);
    return deepFreeze({
      observation: this.#repository.save(observation),
      deduplicated: false,
    });
  }

  get(value: unknown): Readonly<ProblemObservation> {
    const id = parseObservationId(value);
    const observation = this.#repository.get(id);
    if (!observation) {
      throw new ProblemIntakeError("OBSERVATION_NOT_FOUND", `Problem Observation not found: ${id}`);
    }
    return observation;
  }

  list(projectId?: unknown): readonly Readonly<ProblemObservation>[] {
    return this.#repository.list(projectId === undefined ? undefined : parseProjectId(projectId));
  }

  transition(value: ObservationTransitionRequest): Readonly<ObservationTransitionResult> {
    const request = parseTransitionRequest(value);
    const requestFingerprint = canonicalDigest(request);
    const recorded = this.#transitions.get(request.transitionToken);
    if (recorded) {
      if (recorded.requestFingerprint !== requestFingerprint) {
        throw new ProblemIntakeError(
          "TRANSITION_TOKEN_REUSED",
          "The transition token was already used by a different lifecycle request",
        );
      }
      return deepFreeze({
        observation: deepClone(recorded.result.observation),
        replayed: true,
      });
    }
    const current = this.get(request.observationId);
    assertRevision(current, request.expectedRevision);
    if (!(ALLOWED_TRANSITIONS[current.lifecycle] ?? []).includes(request.to)) {
      throw new ProblemIntakeError(
        "INVALID_TRANSITION",
        `Problem Observation cannot transition from ${current.lifecycle} to ${request.to}`,
      );
    }
    if (current.lifecycleHistory.length >= 100) {
      throw new ProblemIntakeError("BOUNDS_EXCEEDED", "Lifecycle history reached its bound");
    }
    const next: ProblemObservation = {
      ...deepClone(current),
      revision: current.revision + 1,
      lifecycle: request.to,
      lifecycleHistory: [
        ...current.lifecycleHistory,
        {
          revision: current.revision + 1,
          from: current.lifecycle,
          to: request.to,
          actor: request.actor,
          reason: request.reason,
          at: request.at,
          transitionToken: request.transitionToken,
        },
      ],
    };
    const result: ObservationTransitionResult = {
      observation: this.#repository.save(next),
      replayed: false,
    };
    this.#transitions.set(request.transitionToken, {
      requestFingerprint,
      result: deepFreeze(deepClone(result)) as ObservationTransitionResult,
    });
    return deepFreeze(result);
  }

  verify(value: VerifyObservationRequest): Readonly<ProblemObservation> {
    const request = parseVerificationRequest(value);
    const current = this.get(request.observationId);
    assertRevision(current, request.expectedRevision);
    if (current.verificationHistory.length >= 100) {
      throw new ProblemIntakeError("BOUNDS_EXCEEDED", "Verification history reached its bound");
    }
    const next: ProblemObservation = {
      ...deepClone(current),
      revision: current.revision + 1,
      verificationHistory: [
        ...current.verificationHistory,
        {
          revision: current.revision + 1,
          status: request.status,
          verifiedAt: request.verifiedAt,
          actor: request.actor,
          providerVersion: request.providerVersion,
          evidenceRefs: request.evidenceRefs,
        },
      ],
    };
    return this.#repository.save(next);
  }

  linkIssue(input: {
    observationId: ProblemObservationId;
    expectedRevision: number;
    issueEntity: string;
  }): Readonly<ProblemObservation> {
    const current = this.get(input.observationId);
    assertRevision(current, parsePositiveInteger(input.expectedRevision, "expectedRevision"));
    const issueEntity = parseIssueEntity(input.issueEntity);
    if (!issueEntity.startsWith(`${current.projectId}/issue/`)) {
      throw new ProblemIntakeError("INVALID_PROJECT_ID", "The Work-OS issue belongs to another Project");
    }
    if (current.linkedIssue && current.linkedIssue !== issueEntity) {
      throw new ProblemIntakeError("REVISION_CONFLICT", "The observation is already linked to another issue");
    }
    if (current.linkedIssue === issueEntity) return current;
    return this.#repository.save({
      ...deepClone(current),
      revision: current.revision + 1,
      linkedIssue: issueEntity,
    });
  }

  linkContribution(input: {
    observationId: ProblemObservationId;
    expectedRevision: number;
    contributionId: ContributionPlanId;
  }): Readonly<ProblemObservation> {
    const current = this.get(input.observationId);
    assertRevision(current, parsePositiveInteger(input.expectedRevision, "expectedRevision"));
    const contributionId = parseContributionId(input.contributionId);
    if (current.linkedContributions.includes(contributionId)) return current;
    if (current.linkedContributions.length >= 32) {
      throw new ProblemIntakeError("BOUNDS_EXCEEDED", "Linked contribution history reached its bound");
    }
    return this.#repository.save({
      ...deepClone(current),
      revision: current.revision + 1,
      linkedContributions: [...current.linkedContributions, contributionId].sort(),
    });
  }
}

function createObservation(report: ProblemReport): ProblemObservation {
  const observationFingerprint = problemObservationFingerprint(report);
  return {
    schemaVersion: 1,
    id: problemObservationId(report.projectId, observationFingerprint),
    projectId: report.projectId,
    provider: deepClone(report.provider),
    ruleId: report.ruleId,
    subject: deepClone(report.subject),
    severity: report.severity,
    summary: report.summary,
    evidenceRefs: deepClone(report.evidenceRefs),
    observedAt: report.observedAt,
    sourceFingerprint: problemSourceFingerprint(report),
    observationFingerprint,
    revision: 1,
    lifecycle: "untriaged",
    lifecycleHistory: [],
    occurrence: {
      count: 1,
      firstObservedAt: report.observedAt,
      lastObservedAt: report.observedAt,
      providerVersions: [report.provider.version],
    },
    verificationHistory: [],
    suggestedAction: report.suggestedAction ?? null,
    linkedIssue: null,
    linkedContributions: [],
  };
}

function assertRevision(observation: ProblemObservation, expectedRevision: number): void {
  if (observation.revision !== expectedRevision) {
    throw new ProblemIntakeError(
      "REVISION_CONFLICT",
      "Problem Observation changed after preview",
      { expectedRevision, currentRevision: observation.revision },
    );
  }
}

function parseTransitionRequest(value: unknown): ObservationTransitionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProblemIntakeError("INVALID_CONTRACT", "Observation transition must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const expected = ["observationId", "expectedRevision", "to", "actor", "reason", "at", "transitionToken"];
  const unknown = Object.keys(candidate).filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !(key in candidate));
  if (unknown.length > 0 || missing.length > 0) {
    throw new ProblemIntakeError(
      "INVALID_CONTRACT",
      `Observation transition fields are invalid: unknown=${unknown.join(",")} missing=${missing.join(",")}`,
    );
  }
  if (!["untriaged", "acknowledged", "dismissed", "resolved"].includes(String(candidate.to))) {
    throw new ProblemIntakeError("INVALID_CONTRACT", "Observation transition target is invalid");
  }
  return {
    observationId: parseObservationId(candidate.observationId),
    expectedRevision: parsePositiveInteger(candidate.expectedRevision, "expectedRevision"),
    to: candidate.to as ObservationTransitionRequest["to"],
    actor: parseBoundedText(candidate.actor, "actor", { max: 256 }),
    reason: parseBoundedText(candidate.reason, "reason", { max: 1000, allowNewlines: true }),
    at: parseInstant(candidate.at, "at"),
    transitionToken: parseBoundedText(candidate.transitionToken, "transitionToken", { max: 256 }),
  };
}

function parseVerificationRequest(value: unknown): VerifyObservationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProblemIntakeError("INVALID_CONTRACT", "Verification request must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const expected = [
    "observationId",
    "expectedRevision",
    "status",
    "verifiedAt",
    "actor",
    "providerVersion",
    "evidenceRefs",
  ];
  const unknown = Object.keys(candidate).filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !(key in candidate));
  if (unknown.length > 0 || missing.length > 0) {
    throw new ProblemIntakeError("INVALID_CONTRACT", "Verification request fields are invalid");
  }
  if (!["reproduced", "not_reproduced", "provider_failed"].includes(String(candidate.status))) {
    throw new ProblemIntakeError("INVALID_CONTRACT", "Verification status is invalid");
  }
  return {
    observationId: parseObservationId(candidate.observationId),
    expectedRevision: parsePositiveInteger(candidate.expectedRevision, "expectedRevision"),
    status: candidate.status as VerifyObservationRequest["status"],
    verifiedAt: parseInstant(candidate.verifiedAt, "verifiedAt"),
    actor: parseBoundedText(candidate.actor, "actor", { max: 256 }),
    providerVersion: parseBoundedText(candidate.providerVersion, "providerVersion", { max: 128 }),
    evidenceRefs: parseEvidenceReferences(candidate.evidenceRefs),
  };
}
