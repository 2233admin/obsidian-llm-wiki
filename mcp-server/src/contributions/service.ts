import type {
  CanonicalProjectId,
  ContributionAction,
  ContributionApplyRequest,
  ContributionApplyResult,
  ContributionPlanInput,
  ContributionReceipt,
  ContributionReceiptStore,
  ContributionTransport,
  ContributionTransportRegistry,
  ForgeExecutionPlanProjection,
  IsolatedWorktreePort,
  PendingContributionReceipt,
  PreparePullRequestPlanInput,
  RegressionVerifierPort,
  RepositoryPreflightFacts,
  Sha256Digest,
  SubmitIssuePlanInput,
  SuccessContributionReceipt,
  ConfirmationTokenPort,
} from './contracts.js';
import type { CanonicalPlanBindingPort } from './canonical-projection.js';
import {
  CONTRIBUTION_PLAN_SCHEMA_VERSION,
  CONTRIBUTION_RECEIPT_SCHEMA_VERSION,
} from './contracts.js';
import { ContributionError, ContributionTransportError } from './errors.js';
import {
  assertSha256,
  forgeProjectionFingerprint,
  fingerprint,
  pushTargetFactsFingerprint,
  repositoryFactsFingerprint,
  sha256,
} from './fingerprint.js';
import { assertCanonicalProjectId, resolveRepository } from './repository.js';
import {
  assertSafeRelativePaths,
  containsUnsafeRemoteMaterial,
  sanitizeContent,
  validateGeneratedFilePolicy,
} from './sanitize.js';

const MAX_DIFF_BYTES_DEFAULT = 128_000;
const MAX_DIFF_BYTES_HARD = 1_000_000;
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/;
const ENTITY_RE = /^project\/[a-z0-9][a-z0-9-]*\/issue\/[a-z0-9][a-z0-9-]*$/;
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

export interface ContributionServiceDependencies {
  transports: ContributionTransportRegistry;
  receipts: ContributionReceiptStore;
  confirmation: ConfirmationTokenPort;
  canonicalBinding: CanonicalPlanBindingPort;
  worktree?: IsolatedWorktreePort;
  verifier?: RegressionVerifierPort;
}

export interface ContributionService {
  plan(input: ContributionPlanInput): Promise<ForgeExecutionPlanProjection>;
  apply(request: ContributionApplyRequest): Promise<ContributionApplyResult>;
}

function requiredString(value: unknown, label: string, max = 1_000): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ContributionError('INVALID_INPUT', `${label} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new ContributionError('INVALID_INPUT', `${label} exceeds ${max} characters`);
  }
  return normalized;
}

function assertRemoteMutationResult(
  remote: { remoteId: string; revision: string; url: string },
): void {
  let url: URL;
  try {
    url = new URL(remote.url);
  } catch {
    throw new ContributionTransportError('Provider returned an invalid remote URL', 'unknown');
  }
  if (
    !remote.remoteId
    || remote.remoteId.length > 200
    || !remote.revision
    || remote.revision.length > 500
    || !remote.url
    || remote.url.length > 2_000
    || url.protocol !== 'https:'
    || url.username
    || url.password
    || containsUnsafeRemoteMaterial(remote)
  ) {
    throw new ContributionTransportError(
      'Provider returned an unsafe or unbounded remote identity',
      'unknown',
    );
  }
}

function assertTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new ContributionError('INVALID_INPUT', `${label} must be an ISO timestamp`);
  }
}

function assertLocalWork(
  projectId: CanonicalProjectId,
  value: { entity: string | null; reviewedHeadDigest: Sha256Digest },
): void {
  if (
    value.entity !== null
    && (!ENTITY_RE.test(value.entity) || !value.entity.startsWith(`${projectId}/issue/`))
  ) {
    throw new ContributionError(
      'INVALID_INPUT',
      'localWork.entity must be a reviewed issue under the same canonical Project',
    );
  }
  assertSha256(value.reviewedHeadDigest, 'localWork.reviewedHeadDigest');
}

function assertCommonInput(input: ContributionPlanInput): void {
  assertCanonicalProjectId(input.projectId);
  requiredString(input.canonicalPlanId, 'canonicalPlanId', 200);
  assertSha256(input.canonicalPlanFingerprint, 'canonicalPlanFingerprint');
  requiredString(input.observationId, 'observationId', 200);
  requiredString(input.actor, 'actor', 200);
  assertTimestamp(input.now, 'now');
  if (input.localWork) assertLocalWork(input.projectId, input.localWork);
}

function finalizePlan(
  body: Omit<ForgeExecutionPlanProjection, 'projectionFingerprint'>,
): ForgeExecutionPlanProjection {
  const plan: ForgeExecutionPlanProjection = {
    ...body,
    projectionFingerprint: forgeProjectionFingerprint(body as ForgeExecutionPlanProjection),
  };
  assertForgeExecutionPlanProjection(plan);
  return plan;
}

function getTransport(
  registry: ContributionTransportRegistry,
  provider: string,
): ContributionTransport {
  const transport = registry.get(provider);
  if (!transport) {
    throw new ContributionError(
      'PROVIDER_UNAVAILABLE',
      `No contribution transport is configured for ${provider}`,
    );
  }
  return transport;
}

async function preflight(
  registry: ContributionTransportRegistry,
  input: SubmitIssuePlanInput | PreparePullRequestPlanInput,
): Promise<{
  repository: ReturnType<typeof resolveRepository>;
  facts: RepositoryPreflightFacts;
  factsFingerprint: Sha256Digest;
  transport: ContributionTransport;
}> {
  const repository = resolveRepository(input.repositoryCandidates, input.selectedRepositoryId);
  const transport = getTransport(registry, repository.provider);
  if (transport.provider !== repository.provider) {
    throw new ContributionError('PROVIDER_UNAVAILABLE', 'Contribution transport provider identity drifted');
  }
  const facts = await transport.preflight({
    repository,
    ...(input.disposition === 'prepare_pull_request' && input.baseRef
      ? { baseRef: input.baseRef }
      : {}),
  });
  if (
    facts.provider !== repository.provider
    || facts.canonicalUrl !== repository.canonicalUrl
    || facts.health === 'unavailable'
  ) {
    throw new ContributionError('PREFLIGHT_FAILED', 'Repository preflight did not match the selected mapping');
  }
  return {
    repository,
    facts,
    factsFingerprint: repositoryFactsFingerprint(facts),
    transport,
  };
}

function commonRemotePlan(
  input: SubmitIssuePlanInput | PreparePullRequestPlanInput,
  repository: ReturnType<typeof resolveRepository>,
  facts: RepositoryPreflightFacts,
  factsFingerprint: Sha256Digest,
): {
  schemaVersion: 1;
  planId: string;
  canonicalPlanFingerprint: Sha256Digest;
  disposition: 'submit_issue' | 'prepare_pull_request';
  projectId: CanonicalProjectId;
  observationId: string;
  actor: string;
  createdAt: string;
  repository: ReturnType<typeof resolveRepository>;
  remoteFacts: RepositoryPreflightFacts;
  remoteFactsFingerprint: Sha256Digest;
  localWork: SubmitIssuePlanInput['localWork'];
} {
  return {
    schemaVersion: CONTRIBUTION_PLAN_SCHEMA_VERSION,
    planId: input.canonicalPlanId,
    canonicalPlanFingerprint: input.canonicalPlanFingerprint,
    disposition: input.disposition,
    projectId: input.projectId,
    observationId: input.observationId,
    actor: input.actor,
    createdAt: input.now,
    repository,
    remoteFacts: facts,
    remoteFactsFingerprint: factsFingerprint,
    localWork: input.localWork,
  };
}

async function planRemoteIssue(
  registry: ContributionTransportRegistry,
  input: SubmitIssuePlanInput,
): Promise<ForgeExecutionPlanProjection> {
  const { repository, facts, factsFingerprint } = await preflight(registry, input);
  if (!facts.permissions.issuesWrite) {
    throw new ContributionError('PROVIDER_UNAVAILABLE', 'Selected repository does not allow Issue creation');
  }
  const sanitized = sanitizeContent(input);
  return finalizePlan({
    ...commonRemotePlan(input, repository, facts, factsFingerprint),
    content: sanitized.content,
    redactions: sanitized.redactions,
    warnings: [...new Set([...(input.warnings ?? []), ...facts.warnings])].sort(),
  });
}

async function planPullRequest(
  deps: ContributionServiceDependencies,
  input: PreparePullRequestPlanInput,
): Promise<ForgeExecutionPlanProjection> {
  if (!deps.worktree || !deps.verifier) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      'No isolated worktree and regression verifier are configured',
      { fallback: 'submit_issue' },
    );
  }
  const { repository, facts, factsFingerprint } = await preflight(deps.transports, input);
  if (!facts.permissions.createPullRequest) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      'Repository permissions do not allow a verified pull request',
      { fallback: 'submit_issue' },
    );
  }
  const headRef = requiredString(input.headRef, 'headRef', 255);
  if (!SAFE_REF_RE.test(headRef) || headRef.includes('..') || headRef.startsWith('/') || headRef.endsWith('/')) {
    throw new ContributionError('INVALID_INPUT', 'headRef is not a safe contribution branch name');
  }
  const allowedPaths = assertSafeRelativePaths(input.allowedPaths, 'allowedPaths');
  if (!allowedPaths.length) {
    throw new ContributionError('PR_UNAVAILABLE', 'A bounded pull request requires explicit allowedPaths', {
      fallback: 'submit_issue',
    });
  }
  const maxDiffBytes = input.maxDiffBytes ?? MAX_DIFF_BYTES_DEFAULT;
  if (!Number.isInteger(maxDiffBytes) || maxDiffBytes < 1 || maxDiffBytes > MAX_DIFF_BYTES_HARD) {
    throw new ContributionError('INVALID_INPUT', `maxDiffBytes must be 1..${MAX_DIFF_BYTES_HARD}`);
  }
  const patch = await deps.worktree.prepare({
    repository,
    baseRef: facts.baseRef,
    baseSha: facts.baseSha,
    headRef,
    changeSummary: requiredString(input.changeSummary, 'changeSummary', 2_000),
    allowedPaths,
    maxDiffBytes,
  });
  if (
    patch.isolation !== 'isolated'
    || patch.baseSha !== facts.baseSha
    || patch.baseRef !== facts.baseRef
    || patch.headRef !== headRef
    || patch.diffBytes > maxDiffBytes
    || patch.diffBytes < 1
  ) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      'Prepared patch is not isolated, bounded, or locked to the preflight base',
      { fallback: 'submit_issue' },
    );
  }
  assertSha256(patch.artifactDigest, 'patch.artifactDigest');
  assertSha256(patch.diffDigest, 'patch.diffDigest');
  validateGeneratedFilePolicy(patch.changedFiles, input.generatedFilePolicy);
  if (containsUnsafeRemoteMaterial({
    artifactId: patch.artifactId,
    diffSummary: patch.diffSummary,
    changedFiles: patch.changedFiles,
  })) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      'Prepared patch metadata contains a secret or machine-local path',
      { fallback: 'submit_issue' },
    );
  }
  const commands = input.testCommands.map((value, index) =>
    requiredString(value, `testCommands[${index}]`, 500),
  );
  if (!commands.length) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      'A pull request requires declared regression tests',
      { fallback: 'submit_issue' },
    );
  }
  const tests = await deps.verifier.verify({
    artifactId: patch.artifactId,
    artifactDigest: patch.artifactDigest,
    commands,
  });
  if (
    tests.length !== commands.length
    || tests.some((test) => test.status !== 'passed' || test.exitCode !== 0)
  ) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      'Regression verification did not pass; submit an Issue instead',
      { fallback: 'submit_issue', tests },
    );
  }
  for (const [index, test] of tests.entries()) {
    assertSha256(test.outputDigest, `tests[${index}].outputDigest`);
  }
  const target = input.pushTarget;
  if (
    !SAFE_SEGMENT_RE.test(target.owner)
    || !SAFE_SEGMENT_RE.test(target.repository)
    || !SAFE_REF_RE.test(target.ref)
    || target.ref.includes('..')
    || !['branch', 'fork'].includes(target.mode)
  ) {
    throw new ContributionError('INVALID_INPUT', 'pushTarget is invalid');
  }
  const transport = getTransport(deps.transports, repository.provider);
  const sameRepositoryBranch = target.mode === 'branch'
    && target.owner === repository.owner
    && target.repository === repository.name;
  const pushTargetFacts = transport.preflightPushTarget
    ? await transport.preflightPushTarget({ repository, target })
    : sameRepositoryBranch
      ? {
        provider: facts.provider,
        repositoryId: facts.repositoryId,
        owner: repository.owner,
        repository: repository.name,
        canonicalUrl: repository.canonicalUrl,
        revision: facts.revision,
        canPush: facts.permissions.pushBranch,
        capturedAt: facts.capturedAt,
      }
      : null;
  if (
    !pushTargetFacts
    || !pushTargetFacts.canPush
    || pushTargetFacts.provider !== repository.provider
    || pushTargetFacts.owner !== target.owner
    || pushTargetFacts.repository !== target.repository
  ) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      'Branch or fork push target lacks a governed write preflight',
      { fallback: 'submit_issue' },
    );
  }
  const sanitized = sanitizeContent(input);
  return finalizePlan({
    ...commonRemotePlan(input, repository, facts, factsFingerprint),
    content: sanitized.content,
    pullRequest: {
      artifactId: patch.artifactId,
      artifactDigest: patch.artifactDigest,
      isolation: 'isolated',
      baseRef: patch.baseRef,
      baseSha: patch.baseSha,
      headRef: patch.headRef,
      headSha: patch.headSha,
      pushTarget: target,
      pushTargetFactsFingerprint: pushTargetFactsFingerprint(pushTargetFacts),
      changedFiles: patch.changedFiles,
      diffSummary: patch.diffSummary,
      diffDigest: patch.diffDigest,
      diffBytes: patch.diffBytes,
      tests,
      generatedFilePolicy: input.generatedFilePolicy,
      draft: true,
    },
    redactions: sanitized.redactions,
    warnings: [...new Set([...(input.warnings ?? []), ...facts.warnings])].sort(),
  });
}

export function assertForgeExecutionPlanProjection(plan: ForgeExecutionPlanProjection): void {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new ContributionError('INVALID_INPUT', 'Contribution plan must be an object');
  }
  const allowed = new Set([
    'schemaVersion',
    'planId',
    'disposition',
    'projectId',
    'observationId',
    'actor',
    'createdAt',
    'repository',
    'remoteFacts',
    'remoteFactsFingerprint',
    'localWork',
    'content',
    'pullRequest',
    'redactions',
    'warnings',
    'canonicalPlanFingerprint',
    'projectionFingerprint',
  ]);
  const unknown = Object.keys(plan).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new ContributionError('INVALID_INPUT', `Contribution plan has unknown fields: ${unknown.join(', ')}`);
  }
  if (plan.schemaVersion !== CONTRIBUTION_PLAN_SCHEMA_VERSION) {
    throw new ContributionError('INVALID_INPUT', 'Unsupported contribution plan schema');
  }
  assertCanonicalProjectId(plan.projectId);
  requiredString(plan.planId, 'planId', 200);
  requiredString(plan.observationId, 'observationId', 200);
  requiredString(plan.actor, 'actor', 200);
  assertTimestamp(plan.createdAt, 'createdAt');
  assertSha256(plan.canonicalPlanFingerprint, 'canonicalPlanFingerprint');
  assertSha256(plan.projectionFingerprint, 'projectionFingerprint');
  if (plan.localWork) assertLocalWork(plan.projectId, plan.localWork);
  if (!Array.isArray(plan.redactions) || !Array.isArray(plan.warnings)) {
    throw new ContributionError('INVALID_INPUT', 'redactions and warnings must be arrays');
  }

  if (plan.disposition === 'local_only') {
    if (plan.repository || plan.remoteFacts || plan.content || plan.pullRequest) {
      throw new ContributionError('INVALID_INPUT', 'local_only cannot contain remote contribution intent');
    }
  } else {
    if (!plan.repository || !plan.remoteFacts || !plan.remoteFactsFingerprint || !plan.localWork || !plan.content) {
      throw new ContributionError('INVALID_INPUT', 'Remote contribution plan is incomplete');
    }
    assertSha256(plan.repository.mappingFingerprint, 'repository.mappingFingerprint');
    assertSha256(plan.remoteFactsFingerprint, 'remoteFactsFingerprint');
    if (repositoryFactsFingerprint(plan.remoteFacts) !== plan.remoteFactsFingerprint) {
      throw new ContributionError('STALE_PLAN', 'Remote facts fingerprint does not match the plan');
    }
    if (plan.content.bodyAuthorship !== 'human') {
      throw new ContributionError('INVALID_INPUT', 'Remote body must be human-authored');
    }
    if (plan.disposition === 'prepare_pull_request') {
      if (!plan.pullRequest || plan.pullRequest.draft !== true || plan.pullRequest.isolation !== 'isolated') {
        throw new ContributionError('PR_UNAVAILABLE', 'Pull request plan must contain an isolated draft patch');
      }
      assertSha256(
        plan.pullRequest.pushTargetFactsFingerprint,
        'pullRequest.pushTargetFactsFingerprint',
      );
      validateGeneratedFilePolicy(plan.pullRequest.changedFiles, plan.pullRequest.generatedFilePolicy);
      if (plan.pullRequest.tests.some((test) => test.status !== 'passed' || test.exitCode !== 0)) {
        throw new ContributionError('PR_UNAVAILABLE', 'Pull request plan contains failed regression evidence');
      }
    } else if (plan.pullRequest) {
      throw new ContributionError('INVALID_INPUT', 'Issue plan cannot contain pull request details');
    }
  }
  if (containsUnsafeRemoteMaterial(plan)) {
    throw new ContributionError('SECRET_OR_PATH_UNSAFE', 'Contribution plan contains unsafe remote material');
  }
  if (forgeProjectionFingerprint(plan) !== plan.projectionFingerprint) {
    throw new ContributionError('STALE_PLAN', 'Forge execution projection fingerprint is invalid');
  }
}

function actionFor(request: ContributionApplyRequest): ContributionAction {
  if (request.plan.disposition === 'submit_issue') {
    if (request.action && request.action !== 'create_issue') {
      throw new ContributionError('INVALID_INPUT', 'Issue plans only support create_issue');
    }
    return 'create_issue';
  }
  if (request.plan.disposition === 'prepare_pull_request') {
    if (!request.action) {
      throw new ContributionError(
        'CONFIRMATION_REQUIRED',
        'Pull request flow requires an explicit push, draft-create, or ready action',
      );
    }
    return request.action;
  }
  throw new ContributionError('INVALID_INPUT', 'local_only has no external contribution action');
}

function assertCurrentPermission(facts: RepositoryPreflightFacts, action: ContributionAction): void {
  const allowed = action === 'create_issue'
    ? facts.permissions.issuesWrite
    : action === 'push_branch'
      ? true
      : action === 'create_draft_pull_request'
        ? facts.permissions.createPullRequest
        : facts.permissions.markReadyForReview;
  if (!allowed) {
    throw new ContributionError('PREFLIGHT_FAILED', `Current repository permissions deny ${action}`);
  }
}

function receiptReplay(
  receipt: ContributionReceipt,
  plan: ForgeExecutionPlanProjection,
  action: ContributionAction,
): ContributionApplyResult {
  if (receipt.status === 'success') {
    return {
      status: 'applied',
      planFingerprint: plan.canonicalPlanFingerprint,
      action,
      replayed: true,
      remote: receipt.remote,
      receipt,
    };
  }
  if (receipt.status === 'pending' || receipt.status === 'outcome_unknown') {
    throw new ContributionError(
      'OUTCOME_UNKNOWN',
      'A prior contribution mutation has outcome-unknown state; reconcile it before retrying',
      { status: receipt.status, action },
    );
  }
  throw new ContributionError('REPLAY_CONFLICT', 'Contribution action was cancelled; create a fresh confirmation');
}

async function requirePriorSuccess(
  receipts: ContributionReceiptStore,
  plan: ForgeExecutionPlanProjection,
  action: ContributionAction,
): Promise<SuccessContributionReceipt> {
  const receipt = await receipts.find(plan.canonicalPlanFingerprint, action);
  if (!receipt || receipt.status !== 'success') {
    throw new ContributionError(
      'CONFIRMATION_REQUIRED',
      `${action} must complete successfully before the next contribution stage`,
    );
  }
  return receipt;
}

async function executeRemoteMutation(
  deps: ContributionServiceDependencies,
  request: ContributionApplyRequest,
  action: ContributionAction,
  transport: ContributionTransport,
  pending: PendingContributionReceipt,
): Promise<ContributionApplyResult> {
  const plan = request.plan;
  const repository = plan.repository!;
  const content = plan.content!;
  const idempotencyKey = fingerprint({ planFingerprint: plan.canonicalPlanFingerprint, action });
  try {
    let remote;
    if (action === 'create_issue') {
      remote = await transport.createIssue({
        repository,
        title: content.title,
        body: content.body,
        labels: content.labels,
        idempotencyKey,
      });
    } else if (action === 'push_branch') {
      const pullRequest = plan.pullRequest!;
      remote = await transport.pushBranch({
        repository,
        artifactId: pullRequest.artifactId,
        artifactDigest: pullRequest.artifactDigest,
        baseSha: pullRequest.baseSha,
        expectedHeadSha: pullRequest.headSha,
        headRef: pullRequest.headRef,
        target: pullRequest.pushTarget,
        idempotencyKey,
      });
    } else if (action === 'create_draft_pull_request') {
      await requirePriorSuccess(deps.receipts, plan, 'push_branch');
      const pullRequest = plan.pullRequest!;
      remote = await transport.createDraftPullRequest({
        repository,
        baseRef: pullRequest.baseRef,
        headRef: pullRequest.pushTarget.owner === repository.owner
          ? pullRequest.pushTarget.ref
          : `${pullRequest.pushTarget.owner}:${pullRequest.pushTarget.ref}`,
        title: content.title,
        body: content.body,
        idempotencyKey,
        draft: true,
      });
    } else {
      const draft = await requirePriorSuccess(deps.receipts, plan, 'create_draft_pull_request');
      if (!transport.markReadyForReview) {
        throw new ContributionTransportError('Provider does not support ready-for-review', 'not_sent');
      }
      const pullRequestId = requiredString(request.pullRequestId, 'pullRequestId', 200);
      const expectedRevision = requiredString(
        request.expectedPullRequestRevision,
        'expectedPullRequestRevision',
        500,
      );
      if (pullRequestId !== draft.remote.remoteId || expectedRevision !== draft.remote.revision) {
        throw new ContributionError(
          'STALE_PLAN',
          'Ready-for-review target does not match the created draft receipt',
        );
      }
      remote = await transport.markReadyForReview({
        repository,
        pullRequestId,
        expectedRevision,
        idempotencyKey,
      });
    }
    assertRemoteMutationResult(remote);
    const success: SuccessContributionReceipt = {
      ...pending,
      status: 'success',
      completedAt: new Date().toISOString(),
      remote,
    };
    try {
      await deps.receipts.replace(success);
    } catch (error) {
      throw new ContributionError(
        'OUTCOME_UNKNOWN',
        'Remote mutation succeeded but its durable receipt could not be recorded; reconcile before retrying',
        { action },
        { cause: error },
      );
    }
    return {
      status: 'applied',
      planFingerprint: plan.canonicalPlanFingerprint,
      action,
      replayed: false,
      remote,
      receipt: success,
    };
  } catch (error) {
    if (error instanceof ContributionError && error.code === 'OUTCOME_UNKNOWN') throw error;
    const notSent = error instanceof ContributionTransportError && error.outcome === 'not_sent';
    const terminal: ContributionReceipt = notSent
      ? {
        ...pending,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
        reason: error.message,
      }
      : {
        ...pending,
        status: 'outcome_unknown',
        failedAt: new Date().toISOString(),
        reason: error instanceof Error ? error.message : 'Unknown provider failure',
      };
    try {
      await deps.receipts.replace(terminal);
    } catch {
      // The pending claim itself is sufficient to block blind retries.
    }
    throw new ContributionError(
      notSent ? 'REMOTE_REJECTED' : 'OUTCOME_UNKNOWN',
      notSent
        ? 'Provider rejected the mutation before it was accepted'
        : 'Provider outcome is unknown; reconcile before retrying',
      { action },
      { cause: error },
    );
  }
}

async function applyRemote(
  deps: ContributionServiceDependencies,
  request: ContributionApplyRequest,
): Promise<ContributionApplyResult> {
  const plan = request.plan;
  const action = actionFor(request);
  if (request.cancelled) {
    return {
      status: 'cancelled',
      planFingerprint: plan.canonicalPlanFingerprint,
      action,
      replayed: false,
    };
  }
  if (request.actor !== plan.actor) {
    throw new ContributionError('STALE_PLAN', 'Apply actor does not match the reviewed contribution plan');
  }
  const transitionToken = requiredString(request.transitionToken, 'transitionToken', 256);
  const confirmationToken = requiredString(request.confirmationToken, 'confirmationToken', 512);
  if (!TOKEN_RE.test(transitionToken) || !TOKEN_RE.test(confirmationToken)) {
    throw new ContributionError('INVALID_INPUT', 'Confirmation and transition tokens are malformed');
  }
  const decision = await deps.confirmation.verify({
    planFingerprint: plan.canonicalPlanFingerprint,
    action,
    transitionToken,
    confirmationToken,
    actor: request.actor,
    projectId: plan.projectId,
    observationId: plan.observationId,
    externalSideEffect: true,
  });
  if (!decision.approved) {
    throw new ContributionError(
      'CONFIRMATION_REQUIRED',
      decision.reason ?? 'Explicit per-run approval is required',
    );
  }

  const repository = plan.repository!;
  const transport = getTransport(deps.transports, repository.provider);
  const existing = await deps.receipts.find(plan.canonicalPlanFingerprint, action);
  if (existing && existing.status !== 'cancelled') {
    return receiptReplay(existing, plan, action);
  }
  const currentFacts = await transport.preflight({
    repository,
    ...(plan.pullRequest ? { baseRef: plan.pullRequest.baseRef } : {}),
  });
  const currentFactsFingerprint = repositoryFactsFingerprint(currentFacts);
  if (currentFactsFingerprint !== plan.remoteFactsFingerprint) {
    throw new ContributionError(
      'STALE_PLAN',
      'Repository facts changed after preview; create a new contribution plan',
    );
  }
  assertCurrentPermission(currentFacts, action);
  if (plan.pullRequest) {
    const target = plan.pullRequest.pushTarget;
    const sameRepositoryBranch = target.mode === 'branch'
      && target.owner === repository.owner
      && target.repository === repository.name;
    const currentPushTargetFacts = transport.preflightPushTarget
      ? await transport.preflightPushTarget({ repository, target })
      : sameRepositoryBranch
        ? {
          provider: currentFacts.provider,
          repositoryId: currentFacts.repositoryId,
          owner: repository.owner,
          repository: repository.name,
          canonicalUrl: repository.canonicalUrl,
          revision: currentFacts.revision,
          canPush: currentFacts.permissions.pushBranch,
          capturedAt: currentFacts.capturedAt,
        }
        : null;
    if (
      !currentPushTargetFacts
      || !currentPushTargetFacts.canPush
      || pushTargetFactsFingerprint(currentPushTargetFacts)
        !== plan.pullRequest.pushTargetFactsFingerprint
    ) {
      throw new ContributionError(
        'STALE_PLAN',
        'Branch or fork push target permissions changed after preview',
      );
    }
  }
  if (action === 'create_draft_pull_request') {
    await requirePriorSuccess(deps.receipts, plan, 'push_branch');
  }
  if (action === 'mark_ready_for_review') {
    const draft = await requirePriorSuccess(
      deps.receipts,
      plan,
      'create_draft_pull_request',
    );
    if (!transport.markReadyForReview) {
      throw new ContributionError(
        'PROVIDER_UNAVAILABLE',
        'Provider does not support ready-for-review',
      );
    }
    const pullRequestId = requiredString(request.pullRequestId, 'pullRequestId', 200);
    const expectedRevision = requiredString(
      request.expectedPullRequestRevision,
      'expectedPullRequestRevision',
      500,
    );
    if (pullRequestId !== draft.remote.remoteId || expectedRevision !== draft.remote.revision) {
      throw new ContributionError(
        'STALE_PLAN',
        'Ready-for-review target does not match the created draft receipt',
      );
    }
  }

  const pending: PendingContributionReceipt = {
    schemaVersion: CONTRIBUTION_RECEIPT_SCHEMA_VERSION,
    status: 'pending',
    action,
    planFingerprint: plan.canonicalPlanFingerprint,
    projectId: plan.projectId,
    observationId: plan.observationId,
    actor: request.actor,
    transitionTokenDigest: sha256(transitionToken),
    confirmationTokenDigest: sha256(confirmationToken),
    remoteFactsFingerprint: currentFactsFingerprint,
    ...(decision.workRunId ? { workRunId: decision.workRunId } : {}),
    createdAt: new Date().toISOString(),
  };
  const claim = await deps.receipts.claim(pending);
  if (!claim.claimed) return receiptReplay(claim.receipt, plan, action);
  return executeRemoteMutation(deps, request, action, transport, pending);
}

export function createContributionService(
  deps: ContributionServiceDependencies,
): ContributionService {
  return {
    async plan(input): Promise<ForgeExecutionPlanProjection> {
      assertCommonInput(input);
      if (input.disposition === 'local_only') {
        return finalizePlan({
          schemaVersion: CONTRIBUTION_PLAN_SCHEMA_VERSION,
          planId: input.canonicalPlanId,
          canonicalPlanFingerprint: input.canonicalPlanFingerprint,
          disposition: 'local_only',
          projectId: input.projectId,
          observationId: input.observationId,
          actor: input.actor,
          createdAt: input.now,
          ...(input.localWork ? { localWork: input.localWork } : {}),
          redactions: [],
          warnings: [...new Set(input.warnings ?? [])].sort(),
        });
      }
      if (input.disposition === 'submit_issue') {
        return planRemoteIssue(deps.transports, input);
      }
      return planPullRequest(deps, input);
    },

    async apply(request): Promise<ContributionApplyResult> {
      assertForgeExecutionPlanProjection(request.plan);
      await deps.canonicalBinding.verify(request.plan);
      if (request.plan.disposition === 'local_only') {
        if (request.action || request.transitionToken || request.confirmationToken) {
          throw new ContributionError('INVALID_INPUT', 'local_only cannot carry remote apply authority');
        }
        return {
          status: request.cancelled ? 'cancelled' : 'local_only',
          planFingerprint: request.plan.canonicalPlanFingerprint,
          replayed: false,
        };
      }
      return applyRemote(deps, request);
    },
  };
}
