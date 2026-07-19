import { createHash } from 'node:crypto';

import {
  canonicalDigest,
  createExternalContributionPlan,
  createIssueChangePlan,
  createProblemDisposition,
  parseExternalContributionPlan,
  parseIssueChangePlan,
  type ExternalContributionPlan,
  type IssueChangePlan,
  type ProblemEvidenceReference,
  type ProblemLifecycleState,
  type ProblemVerificationStatus,
  type ProblemObservation,
  type ProblemObservationId,
  type ProblemReport,
  type ProjectId,
  type Sha256Digest,
} from '../../../packages/problem-intake/dist/src/index.js';
import {
  ProblemIntakeExecutionError,
  type ContributionPlanResult,
  type LocalIssueApplyReceipt,
  type ProblemIntakeDependencies,
  type ProblemObservationListResult,
} from './contracts.js';
import {
  asRecord,
  assertNoSensitiveMaterial,
  canonicalProjectId,
  invalid,
  requiredString,
  timestamp,
} from './safety.js';

function tokenDigest(token: string): Sha256Digest {
  return `sha256:${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}

function now(deps: ProblemIntakeDependencies): string {
  return timestamp(deps.clock?.now() ?? new Date().toISOString(), 'clock.now');
}

function lifecycleTarget(value: unknown): ProblemLifecycleState {
  const action = requiredString(value, 'action', 16);
  const targets: Record<string, ProblemLifecycleState> = {
    acknowledge: 'acknowledged',
    dismiss: 'dismissed',
    reopen: 'untriaged',
    resolve: 'resolved',
  };
  const target = targets[action];
  if (!target) invalid('action is unsupported');
  return target;
}

type GovernedContributionAction =
  | 'create_issue'
  | 'push_branch'
  | 'create_draft_pull_request'
  | 'mark_ready_for_review';

function contributionAction(value: unknown): GovernedContributionAction {
  const action = requiredString(value, 'request.action', 64);
  if (![
    'create_issue',
    'push_branch',
    'create_draft_pull_request',
    'mark_ready_for_review',
  ].includes(action)) {
    invalid('request.action is unsupported');
  }
  return action as GovernedContributionAction;
}

function issueEntitySlug(projectId: ProjectId, entity: string): string {
  const match = new RegExp(
    `^${projectId.replace('/', '\\/')}\\/issue\\/([a-z0-9][a-z0-9-]*)$`,
  ).exec(entity);
  if (!match) invalid('Issue Change Plan identifies an issue outside its canonical Project');
  return match[1]!;
}

function issueOperationParams(plan: IssueChangePlan): Record<string, unknown> {
  if (plan.operation === 'project.issue.create') {
    return {
      project: plan.projectId,
      title: plan.payload.title,
      summary: plan.payload.description,
      body: plan.payload.body,
      priority: String(plan.payload.priority),
      review: 'reviewed',
    };
  }
  const entity = plan.existingIssueEntity;
  if (!entity) invalid('Existing Work-OS issue is required for update/comment');
  const slug = issueEntitySlug(plan.projectId, entity);
  if (plan.operation === 'project.issue.update') {
    return {
      project: plan.projectId,
      slug,
      summary: plan.payload.description,
      body: plan.payload.body,
      priority: String(plan.payload.priority),
    };
  }
  return {
    project: plan.projectId,
    slug,
    body: plan.payload.body,
  };
}

function issueEntityFromResult(
  plan: IssueChangePlan,
  result: Record<string, unknown>,
): string {
  if (plan.existingIssueEntity) return plan.existingIssueEntity;
  return requiredString(result.entity, 'projectOperationResult.entity', 300);
}

export class ProblemIntakeExecutor {
  readonly #deps: ProblemIntakeDependencies;

  constructor(dependencies: ProblemIntakeDependencies) {
    this.#deps = dependencies;
  }

  async observe(value: unknown): Promise<Readonly<{
    observation: Readonly<ProblemObservation>;
    deduplicated: boolean;
  }>> {
    const result = await this.#deps.domain.ingest(value);
    return result;
  }

  async list(projectValue: unknown): Promise<ProblemObservationListResult> {
    const projectId = canonicalProjectId(projectValue, 'project');
    return {
      projectId,
      observations: await this.#deps.domain.list(projectId),
    };
  }

  async lifecycleApply(value: unknown): Promise<Readonly<{
    observation: Readonly<ProblemObservation>;
    replayed: boolean;
  }>> {
    const item = asRecord(value, 'request', [
      'projectId',
      'observationId',
      'action',
      'actor',
      'reason',
      'expectedRevision',
      'transitionToken',
    ]);
    const projectId = canonicalProjectId(item.projectId, 'request.projectId');
    const observationId = requiredString(
      item.observationId,
      'request.observationId',
      128,
    ) as ProblemObservationId;
    const current = await this.#deps.domain.get(observationId);
    if (current.projectId !== projectId) {
      throw new ProblemIntakeExecutionError(
        'NOT_FOUND',
        `Problem Observation not found in ${projectId}`,
      );
    }
    return this.#deps.domain.transition({
      observationId,
      expectedRevision: item.expectedRevision as number,
      to: lifecycleTarget(item.action),
      actor: requiredString(item.actor, 'request.actor', 256),
      reason: requiredString(item.reason, 'request.reason', 1_000),
      at: now(this.#deps),
      transitionToken: requiredString(
        item.transitionToken,
        'request.transitionToken',
        256,
      ),
    });
  }

  async verificationApply(value: unknown): Promise<Readonly<{
    observation: Readonly<ProblemObservation>;
    replayed: boolean;
  }>> {
    const item = asRecord(value, 'request', [
      'projectId',
      'observationId',
      'expectedRevision',
      'status',
      'actor',
      'providerVersion',
      'evidenceRefs',
    ]);
    const projectId = canonicalProjectId(item.projectId, 'request.projectId');
    const observationId = requiredString(
      item.observationId,
      'request.observationId',
      128,
    ) as ProblemObservationId;
    const current = await this.#deps.domain.get(observationId);
    if (current.projectId !== projectId) {
      throw new ProblemIntakeExecutionError(
        'NOT_FOUND',
        `Problem Observation not found in ${projectId}`,
      );
    }
    if (!Number.isInteger(item.expectedRevision) || (item.expectedRevision as number) < 1) {
      invalid('request.expectedRevision must be a positive integer');
    }
    const expectedRevision = item.expectedRevision as number;
    const status = requiredString(item.status, 'request.status', 32);
    if (!['reproduced', 'not_reproduced', 'provider_failed'].includes(status)) {
      invalid('request.status is unsupported');
    }
    const actor = requiredString(item.actor, 'request.actor', 256);
    const providerVersion = requiredString(
      item.providerVersion,
      'request.providerVersion',
      128,
    );
    if (
      !Array.isArray(item.evidenceRefs)
      || item.evidenceRefs.length < 1
      || item.evidenceRefs.length > 32
    ) {
      invalid('request.evidenceRefs must contain 1 through 32 bounded references');
    }
    assertNoSensitiveMaterial(item.evidenceRefs, 'request.evidenceRefs');
    const requestedFacts = {
      status,
      actor,
      providerVersion,
      evidenceRefs: item.evidenceRefs,
    };
    const previous = current.verificationHistory.at(-1);
    if (
      current.revision === expectedRevision + 1
      && previous?.revision === current.revision
      && canonicalDigest({
        status: previous.status,
        actor: previous.actor,
        providerVersion: previous.providerVersion,
        evidenceRefs: previous.evidenceRefs,
      }) === canonicalDigest(requestedFacts)
    ) {
      return { observation: current, replayed: true };
    }
    const observation = await this.#deps.domain.verify({
      observationId,
      expectedRevision,
      status: status as ProblemVerificationStatus,
      verifiedAt: now(this.#deps),
      actor,
      providerVersion,
      evidenceRefs: item.evidenceRefs as ProblemEvidenceReference[],
    });
    return { observation, replayed: false };
  }

  async issuePlan(value: unknown): Promise<Readonly<IssueChangePlan>> {
    const item = asRecord(value, 'request', [
      'projectId',
      'observationId',
      'actor',
      'existingIssue',
      'action',
      'priority',
      'warnings',
    ]);
    const projectId = canonicalProjectId(item.projectId, 'request.projectId');
    const observation = await this.#deps.domain.get(item.observationId);
    if (observation.projectId !== projectId) {
      throw new ProblemIntakeExecutionError(
        'NOT_FOUND',
        `Problem Observation not found in ${projectId}`,
      );
    }
    if (observation.lifecycle === 'dismissed') {
      throw new ProblemIntakeExecutionError(
        'CONFLICT',
        'Dismissed observations must be reopened before creating work',
      );
    }
    const priority = item.priority;
    if (
      priority !== undefined
      && (!Number.isInteger(priority) || ![0, 1, 2, 3, 4].includes(priority as number))
    ) {
      invalid('request.priority must be an integer from 0 through 4');
    }
    const warnings = item.warnings === undefined ? [] : item.warnings;
    if (!Array.isArray(warnings)) invalid('request.warnings must be an array');
    const action = item.action === undefined
      ? undefined
      : requiredString(item.action, 'request.action', 16);
    if (action !== undefined && action !== 'update' && action !== 'comment') {
      invalid('request.action must be update or comment');
    }
    return createIssueChangePlan({
      observation,
      actor: requiredString(item.actor, 'request.actor', 256),
      existingIssueEntity: item.existingIssue === undefined
        ? undefined
        : requiredString(item.existingIssue, 'request.existingIssue', 300),
      action,
      priority: priority as 0 | 1 | 2 | 3 | 4 | undefined,
      warnings: warnings as string[],
    });
  }

  async issueApply(value: unknown, projectOperationContext?: unknown): Promise<{
    observation: Readonly<ProblemObservation>;
    result: Record<string, unknown>;
    receipt: LocalIssueApplyReceipt;
    replayed: boolean;
  }> {
    const item = asRecord(value, 'request', [
      'plan',
      'presentedFingerprint',
      'actor',
      'transitionToken',
    ]);
    const plan = parseIssueChangePlan(item.plan);
    const presentedFingerprint = requiredString(
      item.presentedFingerprint,
      'request.presentedFingerprint',
      80,
    );
    if (presentedFingerprint !== plan.fingerprint) {
      invalid('Presented fingerprint does not match the Issue Change Plan');
    }
    const actor = requiredString(item.actor, 'request.actor', 256);
    if (actor !== plan.actor) {
      throw new ProblemIntakeExecutionError(
        'APPROVAL_REQUIRED',
        'Issue apply actor must match the reviewed plan actor',
      );
    }
    const digest = tokenDigest(requiredString(
      item.transitionToken,
      'request.transitionToken',
      256,
    ));
    const prior = await this.#deps.issueReceipts.get(plan.projectId, digest);
    if (prior) {
      if (prior.planFingerprint !== plan.fingerprint || prior.actor !== actor) {
        throw new ProblemIntakeExecutionError(
          'CONFLICT',
          'transitionToken was already used for another Issue Change Plan',
        );
      }
      if (prior.status !== 'applied' || prior.result === null) {
        throw new ProblemIntakeExecutionError(
          'OUTCOME_UNKNOWN',
          'A prior Work-OS mutation has outcome-unknown state; reconcile it before retrying',
        );
      }
      const issueEntity = issueEntityFromResult(plan, prior.result);
      const current = await this.#deps.domain.get(plan.observationId);
      const observation = current.linkedIssue === issueEntity
        ? current
        : await this.#deps.domain.linkIssue({
            observationId: plan.observationId,
            expectedRevision: current.revision,
            issueEntity,
          });
      return {
        observation,
        result: structuredClone(prior.result),
        receipt: structuredClone(prior),
        replayed: true,
      };
    }
    const observation = await this.#deps.domain.get(plan.observationId);
    if (
      observation.projectId !== plan.projectId
      || observation.revision !== plan.observationRevision
    ) {
      throw new ProblemIntakeExecutionError(
        'CONFLICT',
        'Problem Observation changed after the Issue Change Plan was presented',
      );
    }
    const pending: LocalIssueApplyReceipt = {
      schemaVersion: 1,
      projectId: plan.projectId,
      status: 'pending',
      planFingerprint: plan.fingerprint,
      transitionTokenDigest: digest,
      actor,
      result: null,
      updatedAt: now(this.#deps),
    };
    await this.#deps.issueReceipts.put(pending);
    let result: Record<string, unknown>;
    try {
      result = await this.#deps.projectOperations.call(
        plan.operation,
        issueOperationParams(plan),
        projectOperationContext,
      );
    } catch (error) {
      await this.#deps.issueReceipts.put({
        ...pending,
        status: 'outcome_unknown',
        updatedAt: now(this.#deps),
      });
      throw new ProblemIntakeExecutionError(
        'OUTCOME_UNKNOWN',
        'The Work-OS operation may have changed authoritative state; automatic retry is blocked',
        { cause: error instanceof Error ? error.message : 'unknown failure' },
      );
    }
    assertNoSensitiveMaterial(result, 'projectOperationResult');
    const applied: LocalIssueApplyReceipt = {
      ...pending,
      status: 'applied',
      result: structuredClone(result),
      updatedAt: now(this.#deps),
    };
    await this.#deps.issueReceipts.put(applied);
    const linked = await this.#deps.domain.linkIssue({
      observationId: plan.observationId,
      expectedRevision: observation.revision,
      issueEntity: issueEntityFromResult(plan, result),
    });
    return { observation: linked, result, receipt: applied, replayed: false };
  }

  async contributionPlan(value: unknown): Promise<ContributionPlanResult> {
    const item = asRecord(value, 'request', [
      'projectId',
      'observationId',
      'choice',
      'actor',
      'reason',
      'repository',
      'title',
      'body',
      'labels',
    ]);
    const projectId = canonicalProjectId(item.projectId, 'request.projectId');
    const observation = await this.#deps.domain.get(item.observationId);
    if (observation.projectId !== projectId) {
      throw new ProblemIntakeExecutionError(
        'NOT_FOUND',
        `Problem Observation not found in ${projectId}`,
      );
    }
    const choice = requiredString(item.choice, 'request.choice', 32);
    if (!['local_only', 'submit_issue', 'prepare_pull_request'].includes(choice)) {
      invalid('request.choice is unsupported');
    }
    const actor = requiredString(item.actor, 'request.actor', 256);
    const disposition = createProblemDisposition({
      observation,
      choice: choice as 'local_only' | 'submit_issue' | 'prepare_pull_request',
      actor,
      selectedAt: now(this.#deps),
      reason: item.reason === undefined
        ? null
        : requiredString(item.reason, 'request.reason', 1_000),
    });
    if (choice === 'local_only') {
      return {
        available: true,
        plan: createExternalContributionPlan({ observation, disposition }),
      };
    }
    if (!this.#deps.contribution) {
      throw new ProblemIntakeExecutionError(
        'UNAVAILABLE',
        'No governed contribution adapter is configured',
      );
    }
    const repository = item.repository === undefined
      ? ''
      : requiredString(item.repository, 'request.repository', 201);
    const inspected = await this.#deps.contribution.inspect({
      choice: choice as 'submit_issue' | 'prepare_pull_request',
      projectId,
      repository,
      observation,
    });
    assertNoSensitiveMaterial(inspected, 'contributionInspection');
    if (!inspected.available) {
      if (choice === 'prepare_pull_request') {
        return {
          available: false,
          choice: 'prepare_pull_request',
          observationId: observation.id,
          reason: inspected.unavailableReason
            ?? 'A bounded isolated patch with passing regression evidence is required',
          fallback: 'submit_issue',
          warnings: [...(inspected.warnings ?? [])],
        };
      }
      throw new ProblemIntakeExecutionError(
        'UNAVAILABLE',
        inspected.unavailableReason ?? 'Upstream Issue submission is unavailable',
      );
    }
    const labels = item.labels === undefined ? [] : item.labels;
    if (!Array.isArray(labels)) invalid('request.labels must be an array');
    const plan = createExternalContributionPlan({
      observation,
      disposition,
      target: inspected.target,
      title: requiredString(item.title ?? observation.summary, 'request.title', 256),
      body: requiredString(item.body ?? observation.summary, 'request.body', 16_000),
      labels: labels as string[],
      patch: choice === 'prepare_pull_request' ? inspected.patch : undefined,
      executionProjection: inspected.executionProjection,
      settingsSnapshotFingerprint: inspected.settingsSnapshotFingerprint,
      remoteHeadFingerprint: inspected.remoteHeadFingerprint,
      warnings: inspected.warnings,
    });
    return { available: true, plan };
  }

  async contributionApply(value: unknown): Promise<{
    localOnly: boolean;
    observation: Readonly<ProblemObservation>;
    receipt?: Readonly<Record<string, unknown>>;
    result?: Record<string, unknown>;
    replayed: boolean;
  }> {
    const item = asRecord(value, 'request', [
      'plan',
      'presentedFingerprint',
      'approved',
      'actor',
      'workRunId',
      'approvalToken',
      'transitionToken',
      'action',
      'pullRequestId',
      'expectedPullRequestRevision',
    ]);
    const plan = parseExternalContributionPlan(item.plan);
    if (
      requiredString(item.presentedFingerprint, 'request.presentedFingerprint', 80)
      !== plan.fingerprint
    ) {
      invalid('Presented fingerprint does not match the External Contribution Plan');
    }
    const actor = requiredString(item.actor, 'request.actor', 256);
    if (actor !== plan.actor) {
      throw new ProblemIntakeExecutionError(
        'APPROVAL_REQUIRED',
        'Contribution apply actor must match the reviewed disposition actor',
      );
    }
    const current = await this.#deps.domain.get(plan.observationId);
    if (current.projectId !== plan.projectId) {
      throw new ProblemIntakeExecutionError(
        'CONFLICT',
        'Contribution plan belongs to another Project',
      );
    }
    if (plan.disposition.choice === 'local_only') {
      if (current.revision !== plan.observationRevision) {
        throw new ProblemIntakeExecutionError(
          'CONFLICT',
          'Problem Observation changed after the local-only plan was presented',
        );
      }
      return {
        localOnly: true,
        observation: current,
        replayed: false,
      };
    }
    if (item.approved !== true) {
      throw new ProblemIntakeExecutionError(
        'APPROVAL_REQUIRED',
        'External contribution apply requires explicit per-run approval',
      );
    }
    if (!this.#deps.contribution) {
      throw new ProblemIntakeExecutionError(
        'UNAVAILABLE',
        'No governed contribution adapter is configured',
      );
    }
    const alreadyLinked = current.linkedContributions.includes(plan.id);
    if (!alreadyLinked && current.revision !== plan.observationRevision) {
      throw new ProblemIntakeExecutionError(
        'CONFLICT',
        'Problem Observation changed after the contribution plan was presented',
      );
    }
    const workRunId = requiredString(item.workRunId, 'request.workRunId', 256);
    const transitionToken = requiredString(
      item.transitionToken,
      'request.transitionToken',
      256,
    );
    const mutation = await this.#deps.contribution.apply(plan, {
      actor,
      workRunId,
      approvalToken: requiredString(
        item.approvalToken,
        'request.approvalToken',
        256,
      ),
      transitionToken,
      ...(item.action === undefined
        ? {}
        : {
            action: contributionAction(item.action),
          }),
      ...(item.pullRequestId === undefined
        ? {}
        : {
            pullRequestId: requiredString(
              item.pullRequestId,
              'request.pullRequestId',
              200,
            ),
          }),
      ...(item.expectedPullRequestRevision === undefined
        ? {}
        : {
            expectedPullRequestRevision: requiredString(
              item.expectedPullRequestRevision,
              'request.expectedPullRequestRevision',
              500,
            ),
          }),
    });
    const remoteIdentity = requiredString(
      mutation.remoteIdentity,
      'contributionResult.remoteIdentity',
      512,
    );
    const remoteRevision = requiredString(
      mutation.remoteRevision,
      'contributionResult.remoteRevision',
      512,
    );
    const observation = alreadyLinked
      ? current
      : await this.#deps.domain.linkContribution({
          observationId: plan.observationId,
          expectedRevision: current.revision,
          contributionId: plan.id,
        });
    const result: Record<string, unknown> = {
      provider: requiredString(mutation.provider, 'contributionResult.provider', 256),
      remoteIdentity,
      remoteRevision,
      ...(mutation.url === undefined
        ? {}
        : { url: requiredString(mutation.url, 'contributionResult.url', 500) }),
    };
    assertNoSensitiveMaterial(result, 'contributionResult');
    if (mutation.receipt) assertNoSensitiveMaterial(mutation.receipt, 'contributionReceipt');
    return {
      localOnly: false,
      observation,
      ...(mutation.receipt ? { receipt: structuredClone(mutation.receipt) } : {}),
      result,
      replayed: mutation.replayed,
    };
  }
}

export type { ProblemReport };
