import type {
  ForgeExecutionPlanProjection,
  Sha256Digest,
} from './contracts.js';
import { ContributionError } from './errors.js';
import { assertSha256, fingerprint } from './fingerprint.js';

export interface CanonicalExecutionProjectionLock {
  schemaVersion: 1;
  kind: 'forge_execution_v1';
  repositoryMappingFingerprint: Sha256Digest;
  preflightFingerprint: Sha256Digest;
  reviewedLocalWorkFingerprint: Sha256Digest;
  pullRequestArtifactFingerprint: Sha256Digest | null;
  projectionFingerprint: Sha256Digest;
}

export interface CanonicalProblemDisposition {
  schemaVersion: 1;
  observationId: string;
  observationRevision: number;
  choice: 'local_only' | 'submit_issue' | 'prepare_pull_request';
  actor: string;
  selectedAt: string;
  reason: string | null;
}

export interface CanonicalExternalContributionPlanContract {
  schemaVersion: 1;
  id: string;
  disposition: CanonicalProblemDisposition;
  projectId: string;
  observationId: string;
  observationRevision: number;
  linkedIssueEntity: string | null;
  target: {
    provider: 'github' | 'gitea' | 'gitlab';
    repository: string;
    baseRevision: string;
  } | null;
  content: {
    title: string;
    body: string;
    labels: string[];
    evidenceRefs: Array<{
      kind: string;
      ref: string;
      digest?: Sha256Digest;
      summary?: string;
    }>;
  } | null;
  patch: {
    baseRevision: string;
    headRevision: string;
    branchTarget: string;
    diffSummary: string;
    changedPaths: string[];
    tests: Array<{ command: string; status: 'passed'; summary: string }>;
    draft: true;
  } | null;
  executionProjection: CanonicalExecutionProjectionLock | null;
  settingsSnapshotFingerprint: Sha256Digest | null;
  remoteHeadFingerprint: Sha256Digest | null;
  redactions: string[];
  warnings: string[];
  actor: string;
  fingerprint: Sha256Digest;
}

export interface CanonicalExternalContributionPlanParser {
  parse(value: unknown): CanonicalExternalContributionPlanContract;
}

export interface CanonicalPlanBindingPort {
  verify(projection: ForgeExecutionPlanProjection): Promise<void>;
}

export interface CanonicalPlanLoaderPort {
  load(planId: string): Promise<unknown>;
}

export function pullRequestArtifactFingerprint(
  projection: ForgeExecutionPlanProjection,
): Sha256Digest | null {
  if (!projection.pullRequest) return null;
  const pullRequest = projection.pullRequest;
  return fingerprint({
    artifactId: pullRequest.artifactId,
    artifactDigest: pullRequest.artifactDigest,
    isolation: pullRequest.isolation,
    baseRef: pullRequest.baseRef,
    baseSha: pullRequest.baseSha,
    headRef: pullRequest.headRef,
    headSha: pullRequest.headSha,
    pushTarget: pullRequest.pushTarget,
    pushTargetFactsFingerprint: pullRequest.pushTargetFactsFingerprint,
    changedFiles: pullRequest.changedFiles,
    diffSummary: pullRequest.diffSummary,
    diffDigest: pullRequest.diffDigest,
    diffBytes: pullRequest.diffBytes,
    tests: pullRequest.tests,
    generatedFilePolicy: pullRequest.generatedFilePolicy,
    draft: pullRequest.draft,
  });
}

export function canonicalExecutionProjectionLock(
  projection: ForgeExecutionPlanProjection,
): CanonicalExecutionProjectionLock | null {
  if (projection.disposition === 'local_only') return null;
  const payload = {
    schemaVersion: 1 as const,
    kind: 'forge_execution_v1' as const,
    repositoryMappingFingerprint: projection.repository!.mappingFingerprint,
    preflightFingerprint: projection.remoteFactsFingerprint!,
    reviewedLocalWorkFingerprint: fingerprint(projection.localWork!),
    pullRequestArtifactFingerprint: pullRequestArtifactFingerprint(projection),
  };
  return {
    ...payload,
    projectionFingerprint: fingerprint(payload),
  };
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function expectedBranchTarget(projection: ForgeExecutionPlanProjection): string | null {
  if (!projection.pullRequest) return null;
  const target = projection.pullRequest.pushTarget;
  return target.owner === projection.repository!.owner
    ? target.ref
    : `${target.owner}:${target.ref}`;
}

/**
 * Validates and binds the forge projection to the one canonical Problem Intake
 * plan. The parser must be the domain's parseExternalContributionPlan export.
 */
export function bindCanonicalExternalContributionPlan(
  value: unknown,
  projection: ForgeExecutionPlanProjection,
  parser: CanonicalExternalContributionPlanParser,
): ForgeExecutionPlanProjection {
  const canonical = parser.parse(value);
  assertSha256(canonical.fingerprint, 'canonical plan fingerprint');
  if (
    canonical.id !== projection.planId
    || canonical.fingerprint !== projection.canonicalPlanFingerprint
    || canonical.disposition.choice !== projection.disposition
    || canonical.projectId !== projection.projectId
    || canonical.observationId !== projection.observationId
    || canonical.actor !== projection.actor
  ) {
    throw new ContributionError(
      'STALE_PLAN',
      'Forge execution projection does not match canonical Problem Intake identity',
    );
  }

  if (canonical.disposition.choice === 'local_only') {
    if (canonical.executionProjection !== null || canonical.target !== null || projection.repository) {
      throw new ContributionError('STALE_PLAN', 'local_only retained remote execution intent');
    }
    return projection;
  }

  const repository = projection.repository;
  const facts = projection.remoteFacts;
  const content = projection.content;
  const localWork = projection.localWork;
  if (!repository || !facts || !content || !localWork || !canonical.target || !canonical.content) {
    throw new ContributionError('STALE_PLAN', 'Remote canonical plan or forge projection is incomplete');
  }
  if (
    canonical.target.provider !== repository.provider
    || canonical.target.repository !== `${repository.owner}/${repository.name}`
    || canonical.target.baseRevision !== facts.baseSha
    || canonical.linkedIssueEntity !== localWork.entity
    || canonical.content.title !== content.title
    || canonical.content.body !== content.body
    || !sameStrings(canonical.content.labels, content.labels)
  ) {
    throw new ContributionError(
      'STALE_PLAN',
      'Canonical target, content, local work, or base revision drifted from the forge preview',
    );
  }

  const expectedLock = canonicalExecutionProjectionLock(projection);
  if (!expectedLock || fingerprint({
    schemaVersion: canonical.executionProjection?.schemaVersion,
    kind: canonical.executionProjection?.kind,
    repositoryMappingFingerprint: canonical.executionProjection?.repositoryMappingFingerprint,
    preflightFingerprint: canonical.executionProjection?.preflightFingerprint,
    reviewedLocalWorkFingerprint: canonical.executionProjection?.reviewedLocalWorkFingerprint,
    pullRequestArtifactFingerprint: canonical.executionProjection?.pullRequestArtifactFingerprint,
  }) !== canonical.executionProjection?.projectionFingerprint) {
    throw new ContributionError('STALE_PLAN', 'Canonical forge execution lock is invalid');
  }
  if (
    expectedLock.repositoryMappingFingerprint
      !== canonical.executionProjection?.repositoryMappingFingerprint
    || expectedLock.preflightFingerprint
      !== canonical.executionProjection?.preflightFingerprint
    || expectedLock.reviewedLocalWorkFingerprint
      !== canonical.executionProjection?.reviewedLocalWorkFingerprint
    || expectedLock.pullRequestArtifactFingerprint
      !== canonical.executionProjection?.pullRequestArtifactFingerprint
    || expectedLock.projectionFingerprint
      !== canonical.executionProjection?.projectionFingerprint
  ) {
    throw new ContributionError(
      'STALE_PLAN',
      'Canonical forge execution lock does not match the resolved execution facts',
    );
  }

  if (canonical.disposition.choice === 'prepare_pull_request') {
    const patch = canonical.patch;
    const pullRequest = projection.pullRequest;
    if (
      !patch
      || !pullRequest
      || patch.baseRevision !== pullRequest.baseSha
      || patch.headRevision !== pullRequest.headSha
      || patch.branchTarget !== expectedBranchTarget(projection)
      || patch.diffSummary !== pullRequest.diffSummary
      || !sameStrings(patch.changedPaths, pullRequest.changedFiles.map((file) => file.path))
      || !sameStrings(patch.tests.map((test) => test.command), pullRequest.tests.map((test) => test.command))
      || !sameStrings(patch.tests.map((test) => test.summary), pullRequest.tests.map((test) => test.summary))
      || patch.draft !== true
    ) {
      throw new ContributionError(
        'STALE_PLAN',
        'Canonical verified patch evidence drifted from the forge execution artifact',
      );
    }
  } else if (canonical.patch !== null || projection.pullRequest) {
    throw new ContributionError('STALE_PLAN', 'Issue contribution cannot carry pull-request execution facts');
  }
  return projection;
}

export function createCanonicalPlanBindingPort(
  loader: CanonicalPlanLoaderPort,
  parser: CanonicalExternalContributionPlanParser,
): CanonicalPlanBindingPort {
  return {
    async verify(projection): Promise<void> {
      const canonical = await loader.load(projection.planId);
      bindCanonicalExternalContributionPlan(canonical, projection, parser);
    },
  };
}
