import type { ProjectContext } from '../project/project-context.js';
import { isAbsolute, relative, resolve } from 'node:path';
import type {
  ContributionPreflight,
  GovernedContributionPort,
} from '../problem-intake/contracts.js';
import {
  parseExternalContributionPlan,
  type ExternalContributionPlan,
  type ProblemObservation,
} from '../../../packages/problem-intake/dist/src/index.js';

import {
  canonicalExecutionProjectionLock,
  createCanonicalPlanBindingPort,
  type CanonicalExternalContributionPlanContract,
} from './canonical-projection.js';
import type {
  ConfirmationTokenPort,
  ContributionReceiptStore,
  ContributionTransport,
  ContributionTransportRegistry,
  ForgeExecutionPlanProjection,
  IsolatedWorktreePort,
  PullRequestPlanDetails,
  RegressionVerifierPort,
  ReviewedLocalWork,
} from './contracts.js';
import { ContributionError } from './errors.js';
import {
  assertSha256,
  forgeProjectionFingerprint,
  fingerprint,
  pushTargetFactsFingerprint,
  repositoryFactsFingerprint,
} from './fingerprint.js';
import type {
  ExecFilePort,
  GhCliContributionTransportOptions,
} from './gh-cli.js';
import {
  createLocalGhCliContributionProductionPorts,
  type LocalGhCliContributionProductionPorts,
  type TestCommandPolicy,
} from './local-production.js';
import {
  repositoryCandidateFromProjectContext,
} from './production-factory.js';
import { JsonFileContributionReceiptStore } from './receipts.js';
import { resolveRepository } from './repository.js';
import {
  assertSafeRelativePaths,
  validateGeneratedFilePolicy,
} from './sanitize.js';
import { createContributionService } from './service.js';

export interface GovernedPullRequestPreparation {
  headRef: string;
  changeSummary: string;
  allowedPaths: string[];
  testCommands: string[];
  pushTarget?: PullRequestPlanDetails['pushTarget'];
  generatedFilePolicy: PullRequestPlanDetails['generatedFilePolicy'];
  maxDiffBytes?: number;
}

export interface GovernedPullRequestPolicy {
  prepare(input: {
    projectId: `project/${string}`;
    repositorySelection: string;
    observation: Readonly<ProblemObservation>;
  }): Promise<GovernedPullRequestPreparation> | GovernedPullRequestPreparation;
}

export interface GovernedContributionRuntime {
  transport: ContributionTransport;
  worktree: IsolatedWorktreePort;
  verifier: RegressionVerifierPort;
  dispose(): Promise<void>;
}

export interface ProjectContextGovernedContributionPortOptions {
  vaultPath: string;
  context: ProjectContext;
  confirmation: ConfirmationTokenPort;
  pullRequestPolicy?: GovernedPullRequestPolicy;
  runtime?: GovernedContributionRuntime;
  receipts?: ContributionReceiptStore;
  exec?: ExecFilePort;
  gitPath?: string;
  gh?: GhCliContributionTransportOptions;
  receiptRoot?: string;
  tempRoot?: string;
  testCommandPolicy?: TestCommandPolicy;
  allowedTestScripts?: string[];
  testTimeoutMs?: number;
  maxTestOutputBytes?: number;
  generatedPathMatcher?: (repositoryRelativePath: string) => boolean;
  linkNodeModules?: boolean;
  previewTtlMs?: number;
  maxPreviewEntries?: number;
  now?: () => string;
}

export type ProjectContextGovernedContributionPort =
  GovernedContributionPort & {
    readonly repositorySelection: string;
    dispose(): Promise<void>;
  };

interface PreviewEntry {
  key: string;
  choice: 'submit_issue' | 'prepare_pull_request';
  projectId: `project/${string}`;
  observationId: string;
  observationRevision: number;
  repository: ReturnType<typeof resolveRepository>;
  remoteFacts: ForgeExecutionPlanProjection['remoteFacts'] & {};
  remoteFactsFingerprint: NonNullable<ForgeExecutionPlanProjection['remoteFactsFingerprint']>;
  localWork: ReviewedLocalWork;
  pullRequest?: PullRequestPlanDetails;
  settingsSnapshotFingerprint: `sha256:${string}`;
  warnings: string[];
  expiresAt: number;
}

const MAX_DIFF_BYTES_DEFAULT = 128_000;
const MAX_DIFF_BYTES_HARD = 1_000_000;
const SAFE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const SAFE_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

function reviewedLocalWork(input: {
  projectId: string;
  observationId: string;
  observationRevision: number;
  linkedIssueEntity: string | null;
}): ReviewedLocalWork {
  return {
    entity: input.linkedIssueEntity,
    reviewedHeadDigest: fingerprint({
      schemaVersion: 1,
      kind: 'problem_observation_revision',
      projectId: input.projectId,
      observationId: input.observationId,
      observationRevision: input.observationRevision,
      linkedIssueEntity: input.linkedIssueEntity,
    }),
  };
}

function previewProjection(
  entry: Omit<PreviewEntry, 'key' | 'settingsSnapshotFingerprint' | 'expiresAt'>,
  now: string,
): ForgeExecutionPlanProjection {
  const body: Omit<ForgeExecutionPlanProjection, 'projectionFingerprint'> = {
    schemaVersion: 1,
    planId: `preview:${fingerprint({
      projectId: entry.projectId,
      observationId: entry.observationId,
      choice: entry.choice,
      remoteFactsFingerprint: entry.remoteFactsFingerprint,
    }).slice('sha256:'.length)}`,
    canonicalPlanFingerprint: fingerprint({
      kind: 'non_executable_preview',
      projectId: entry.projectId,
      observationId: entry.observationId,
      choice: entry.choice,
    }),
    disposition: entry.choice,
    projectId: entry.projectId,
    observationId: entry.observationId,
    actor: 'preview-only',
    createdAt: now,
    repository: entry.repository,
    remoteFacts: entry.remoteFacts,
    remoteFactsFingerprint: entry.remoteFactsFingerprint,
    localWork: entry.localWork,
    ...(entry.pullRequest ? { pullRequest: entry.pullRequest } : {}),
    redactions: [],
    warnings: entry.warnings,
  };
  return {
    ...body,
    projectionFingerprint: forgeProjectionFingerprint(
      body as ForgeExecutionPlanProjection,
    ),
  };
}

function preflightTarget(entry: Pick<PreviewEntry, 'repository' | 'remoteFacts'>) {
  return {
    provider: 'github' as const,
    repository: `${entry.repository.owner}/${entry.repository.name}`,
    baseRevision: entry.remoteFacts.baseSha,
  };
}

function settingsFingerprint(
  context: ProjectContext,
  repositoryMappingFingerprint: `sha256:${string}`,
): `sha256:${string}` {
  return fingerprint({
    schemaVersion: 1,
    kind: 'github_contribution_settings_v1',
    projectId: context.projectId,
    repositoryMappingFingerprint,
    projections: context.projections
      .map((projection) => ({ ...projection }))
      .sort((left, right) =>
        left.kind.localeCompare(right.kind) || left.target.localeCompare(right.target)),
  });
}

function externalProjection(
  entry: PreviewEntry,
): ContributionPreflight['executionProjection'] {
  const lock = canonicalExecutionProjectionLock(previewProjection(entry, new Date(0).toISOString()));
  if (!lock) throw new ContributionError('STALE_PLAN', 'Remote preview lost its execution lock');
  const { projectionFingerprint: _projectionFingerprint, ...withoutFingerprint } = lock;
  return withoutFingerprint;
}

function pullRequestPatch(
  repository: PreviewEntry['repository'],
  pullRequest: PullRequestPlanDetails,
): NonNullable<ContributionPreflight['patch']> {
  return {
    baseRevision: pullRequest.baseSha,
    headRevision: pullRequest.headSha,
    branchTarget: pullRequest.pushTarget.owner === repository.owner
      ? pullRequest.pushTarget.ref
      : `${pullRequest.pushTarget.owner}:${pullRequest.pushTarget.ref}`,
    diffSummary: pullRequest.diffSummary,
    changedPaths: pullRequest.changedFiles.map((file) => file.path),
    tests: pullRequest.tests.map((test) => ({
      command: test.command,
      status: 'passed' as const,
      summary: test.summary,
    })),
    draft: true,
  };
}

function canonicalContent(
  canonical: ExternalContributionPlan,
): ForgeExecutionPlanProjection['content'] {
  if (!canonical.content) return undefined;
  return {
    title: canonical.content.title,
    body: canonical.content.body,
    bodyAuthorship: 'human',
    labels: [...canonical.content.labels],
    evidence: canonical.content.evidenceRefs.map((evidence) => ({
      ref: evidence.ref,
      summary: evidence.summary ?? `${evidence.kind} evidence`,
      digest: evidence.digest ?? fingerprint({
        kind: evidence.kind,
        ref: evidence.ref,
        summary: evidence.summary ?? null,
      }),
    })),
  };
}

function executableProjection(
  canonical: ExternalContributionPlan,
  entry: PreviewEntry,
): ForgeExecutionPlanProjection {
  const body: Omit<ForgeExecutionPlanProjection, 'projectionFingerprint'> = {
    schemaVersion: 1,
    planId: canonical.id,
    canonicalPlanFingerprint: canonical.fingerprint,
    disposition: canonical.disposition.choice,
    projectId: canonical.projectId,
    observationId: canonical.observationId,
    actor: canonical.actor,
    createdAt: canonical.disposition.selectedAt,
    repository: entry.repository,
    remoteFacts: entry.remoteFacts,
    remoteFactsFingerprint: entry.remoteFactsFingerprint,
    localWork: entry.localWork,
    ...(canonicalContent(canonical) ? { content: canonicalContent(canonical)! } : {}),
    ...(entry.pullRequest ? { pullRequest: entry.pullRequest } : {}),
    redactions: [],
    warnings: [...canonical.warnings],
  };
  return {
    ...body,
    projectionFingerprint: forgeProjectionFingerprint(
      body as ForgeExecutionPlanProjection,
    ),
  };
}

function asCanonicalContract(value: unknown): CanonicalExternalContributionPlanContract {
  return parseExternalContributionPlan(value) as CanonicalExternalContributionPlanContract;
}

function productionRuntime(
  options: ProjectContextGovernedContributionPortOptions,
  repositoryMappingFingerprint: `sha256:${string}`,
): GovernedContributionRuntime {
  if (options.runtime) return options.runtime;
  if (!options.context.workspace?.available) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      'Project Context workspace binding is unavailable',
      { fallback: 'submit_issue' },
    );
  }
  const runtime: LocalGhCliContributionProductionPorts
    = createLocalGhCliContributionProductionPorts({
      binding: {
        projectId: options.context.projectId as `project/${string}`,
        repositoryMappingFingerprint,
        localRepositoryPath: options.context.workspace.path,
      },
      ...(options.exec ? { exec: options.exec } : {}),
      ...(options.gitPath ? { gitPath: options.gitPath } : {}),
      ...(options.gh ? { gh: options.gh } : {}),
      ...(options.tempRoot ? { tempRoot: options.tempRoot } : {}),
      ...(options.testCommandPolicy ? { testCommandPolicy: options.testCommandPolicy } : {}),
      ...(options.allowedTestScripts ? { allowedTestScripts: options.allowedTestScripts } : {}),
      ...(options.testTimeoutMs ? { testTimeoutMs: options.testTimeoutMs } : {}),
      ...(options.maxTestOutputBytes
        ? { maxTestOutputBytes: options.maxTestOutputBytes }
        : {}),
      ...(options.generatedPathMatcher
        ? { generatedPathMatcher: options.generatedPathMatcher }
        : {}),
      ...(options.linkNodeModules !== undefined
        ? { linkNodeModules: options.linkNodeModules }
        : {}),
    });
  return runtime;
}

/**
 * Problem Intake bridge with a process-scoped staged preview cache. Inspect
 * creates non-executable forge facts before the canonical plan exists. Apply
 * receives that canonical plan, rebinds the cached facts to its identity, and
 * then runs the normal canonical binding + confirmation + receipt gates.
 */
export function createProjectContextGovernedContributionPort(
  options: ProjectContextGovernedContributionPortOptions,
): ProjectContextGovernedContributionPort {
  if (!isAbsolute(options.vaultPath)) {
    throw new ContributionError('INVALID_INPUT', 'vaultPath must be absolute');
  }
  const candidate = repositoryCandidateFromProjectContext(options.context);
  const repository = resolveRepository([candidate], candidate.id);
  const runtime = productionRuntime(options, repository.mappingFingerprint);
  if (runtime.transport.provider !== 'github') {
    throw new ContributionError('PROVIDER_UNAVAILABLE', 'Governed Project transport must be github');
  }
  const vaultRoot = resolve(options.vaultPath);
  const receiptRoot = options.receiptRoot
    ? resolve(options.receiptRoot)
    : resolve(
      vaultRoot,
      options.context.roots.workOs,
      'projection-receipts',
      'external-contributions',
    );
  const receiptRelative = relative(vaultRoot, receiptRoot);
  if (
    (options.receiptRoot && !isAbsolute(options.receiptRoot))
    || (!options.receiptRoot && (
      receiptRelative.startsWith('..')
      || isAbsolute(receiptRelative)
    ))
  ) {
    throw new ContributionError('INVALID_INPUT', 'Contribution receipt root is not governed');
  }
  const receipts = options.receipts ?? new JsonFileContributionReceiptStore(receiptRoot);
  const transports: ContributionTransportRegistry = {
    get(provider) {
      return provider === 'github' ? runtime.transport : undefined;
    },
  };
  const previews = new Map<string, PreviewEntry>();
  const ttlMs = options.previewTtlMs ?? 30 * 60_000;
  const maxEntries = options.maxPreviewEntries ?? 32;
  if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 24 * 60 * 60_000) {
    throw new ContributionError('INVALID_INPUT', 'previewTtlMs must be between 1 second and 24 hours');
  }
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 128) {
    throw new ContributionError('INVALID_INPUT', 'maxPreviewEntries must be between 1 and 128');
  }
  const now = options.now ?? (() => new Date().toISOString());
  const configuredSettingsFingerprint = settingsFingerprint(
    options.context,
    repository.mappingFingerprint,
  );

  async function releasePreview(entry: PreviewEntry): Promise<void> {
    previews.delete(entry.key);
    const artifacts = runtime as Partial<LocalGhCliContributionProductionPorts>;
    if (entry.pullRequest && artifacts.artifacts?.release) {
      await artifacts.artifacts.release({
        artifactId: entry.pullRequest.artifactId,
        artifactDigest: entry.pullRequest.artifactDigest,
      }).catch(() => undefined);
    }
  }

  async function prune(): Promise<void> {
    const timestamp = Date.now();
    for (const entry of [...previews.values()]) {
      if (entry.expiresAt <= timestamp) await releasePreview(entry);
    }
    while (previews.size >= maxEntries) {
      const oldest = [...previews.values()].sort((left, right) =>
        left.expiresAt - right.expiresAt)[0];
      if (!oldest) break;
      await releasePreview(oldest);
    }
  }

  async function inspect(
    input: Parameters<GovernedContributionPort['inspect']>[0],
  ): Promise<ContributionPreflight> {
    await prune();
    const repositoryDisplay = `${candidate.owner}/${candidate.name}`;
    const repositorySelection = input.repository.trim()
      ? input.repository
      : candidate.id;
    if (
      input.projectId !== options.context.projectId
      || input.observation.projectId !== input.projectId
      || (
        repositorySelection !== candidate.id
        && repositorySelection !== repositoryDisplay
      )
    ) {
      throw new ContributionError(
        'INVALID_INPUT',
        'Contribution inspection is not bound to the selected Project repository',
      );
    }
    const remoteFacts = await runtime.transport.preflight({ repository });
    if (
      remoteFacts.provider !== 'github'
      || remoteFacts.canonicalUrl !== repository.canonicalUrl
      || remoteFacts.health === 'unavailable'
    ) {
      throw new ContributionError('PREFLIGHT_FAILED', 'GitHub preflight identity is unavailable');
    }
    const remoteFactsFingerprint = repositoryFactsFingerprint(remoteFacts);
    const localWork = reviewedLocalWork({
      projectId: input.projectId,
      observationId: input.observation.id,
      observationRevision: input.observation.revision,
      linkedIssueEntity: input.observation.linkedIssue,
    });
    const base = {
      choice: input.choice,
      projectId: input.projectId,
      observationId: input.observation.id,
      observationRevision: input.observation.revision,
      repository,
      remoteFacts,
      remoteFactsFingerprint,
      localWork,
      warnings: [...remoteFacts.warnings],
    };
    if (!input.observation.linkedIssue) {
      const unavailableEntry: PreviewEntry = {
        ...base,
        key: 'unavailable',
        settingsSnapshotFingerprint: configuredSettingsFingerprint,
        expiresAt: 0,
      };
      return {
        available: false,
        unavailableReason:
          'Link a reviewed local Work-OS issue to this observation before creating an upstream Issue or Pull Request',
        target: preflightTarget(unavailableEntry),
        settingsSnapshotFingerprint: configuredSettingsFingerprint,
        remoteHeadFingerprint: remoteFactsFingerprint,
        executionProjection: externalProjection(unavailableEntry),
        warnings: unavailableEntry.warnings,
      };
    }
    let pullRequest: PullRequestPlanDetails | undefined;
    if (input.choice === 'submit_issue') {
      if (!remoteFacts.permissions.issuesWrite) {
        throw new ContributionError('PROVIDER_UNAVAILABLE', 'GitHub Issue creation is unavailable');
      }
    } else {
      if (!remoteFacts.permissions.createPullRequest || !options.pullRequestPolicy) {
        const unavailableEntry: PreviewEntry = {
          ...base,
          key: 'unavailable',
          settingsSnapshotFingerprint: configuredSettingsFingerprint,
          expiresAt: 0,
        };
        return {
          available: false,
          unavailableReason: 'No governed pull-request preparation policy is configured',
          target: preflightTarget(unavailableEntry),
          settingsSnapshotFingerprint: configuredSettingsFingerprint,
          remoteHeadFingerprint: remoteFactsFingerprint,
          executionProjection: externalProjection(unavailableEntry),
          warnings: unavailableEntry.warnings,
        };
      }
      try {
        const policy = await options.pullRequestPolicy.prepare({
          projectId: input.projectId,
          repositorySelection: candidate.id,
          observation: input.observation,
        });
        if (
          !SAFE_REF_RE.test(policy.headRef)
          || policy.headRef.includes('..')
          || policy.headRef.startsWith('/')
          || policy.headRef.endsWith('/')
        ) {
          throw new ContributionError('PR_UNAVAILABLE', 'Governed headRef is unsafe', {
            fallback: 'submit_issue',
          });
        }
        const allowedPaths = assertSafeRelativePaths(policy.allowedPaths, 'allowedPaths');
        const maxDiffBytes = policy.maxDiffBytes ?? MAX_DIFF_BYTES_DEFAULT;
        if (
          !Number.isInteger(maxDiffBytes)
          || maxDiffBytes < 1
          || maxDiffBytes > MAX_DIFF_BYTES_HARD
        ) {
          throw new ContributionError('PR_UNAVAILABLE', 'Governed maxDiffBytes is invalid', {
            fallback: 'submit_issue',
          });
        }
        if (!policy.testCommands.length) {
          throw new ContributionError('PR_UNAVAILABLE', 'Governed regression tests are required', {
            fallback: 'submit_issue',
          });
        }
        const prepared = await runtime.worktree.prepare({
          repository,
          baseRef: remoteFacts.baseRef,
          baseSha: remoteFacts.baseSha,
          headRef: policy.headRef,
          changeSummary: policy.changeSummary,
          allowedPaths,
          maxDiffBytes,
        });
        if (
          prepared.isolation !== 'isolated'
          || prepared.baseRef !== remoteFacts.baseRef
          || prepared.baseSha !== remoteFacts.baseSha
          || prepared.headRef !== policy.headRef
          || prepared.headSha === prepared.baseSha
          || prepared.diffBytes < 1
          || prepared.diffBytes > maxDiffBytes
        ) {
          throw new ContributionError(
            'PR_UNAVAILABLE',
            'Prepared artifact is not isolated, bounded, or locked to the reviewed base',
            { fallback: 'submit_issue' },
          );
        }
        assertSha256(prepared.artifactDigest, 'prepared.artifactDigest');
        assertSha256(prepared.diffDigest, 'prepared.diffDigest');
        validateGeneratedFilePolicy(
          prepared.changedFiles,
          policy.generatedFilePolicy,
        );
        const tests = await runtime.verifier.verify({
          artifactId: prepared.artifactId,
          artifactDigest: prepared.artifactDigest,
          commands: policy.testCommands,
        });
        if (
          tests.length !== policy.testCommands.length
          || tests.some((test) => test.status !== 'passed' || test.exitCode !== 0)
        ) {
          throw new ContributionError(
            'PR_UNAVAILABLE',
            'Regression verification did not pass',
            { fallback: 'submit_issue' },
          );
        }
        tests.forEach((test, index) =>
          assertSha256(test.outputDigest, `tests[${index}].outputDigest`));
        const target = policy.pushTarget ?? {
          owner: repository.owner,
          repository: repository.name,
          ref: policy.headRef,
          mode: 'branch' as const,
        };
        if (
          !SAFE_SEGMENT_RE.test(target.owner)
          || !SAFE_SEGMENT_RE.test(target.repository)
          || !SAFE_REF_RE.test(target.ref)
          || target.ref.includes('..')
          || !['branch', 'fork'].includes(target.mode)
        ) {
          throw new ContributionError('PR_UNAVAILABLE', 'Governed push target is unsafe', {
            fallback: 'submit_issue',
          });
        }
        const targetFacts = runtime.transport.preflightPushTarget
          ? await runtime.transport.preflightPushTarget({ repository, target })
          : {
            provider: remoteFacts.provider,
            repositoryId: remoteFacts.repositoryId,
            owner: repository.owner,
            repository: repository.name,
            canonicalUrl: repository.canonicalUrl,
            revision: remoteFacts.revision,
            canPush: remoteFacts.permissions.pushBranch,
            capturedAt: remoteFacts.capturedAt,
          };
        if (
          !targetFacts.canPush
          || targetFacts.provider !== repository.provider
          || targetFacts.owner !== target.owner
          || targetFacts.repository !== target.repository
          || targetFacts.canonicalUrl !== (
            target.owner === repository.owner && target.repository === repository.name
              ? repository.canonicalUrl
              : `https://${new URL(repository.canonicalUrl).hostname}/${target.owner}/${target.repository}`
          )
        ) {
          throw new ContributionError(
            'PR_UNAVAILABLE',
            'Reviewed push target is not writable',
            { fallback: 'submit_issue' },
          );
        }
        pullRequest = {
          ...prepared,
          pushTarget: target,
          pushTargetFactsFingerprint: pushTargetFactsFingerprint(targetFacts),
          tests,
          generatedFilePolicy: policy.generatedFilePolicy,
          draft: true,
        };
      } catch (error) {
        const unavailableEntry: PreviewEntry = {
          ...base,
          key: 'unavailable',
          settingsSnapshotFingerprint: configuredSettingsFingerprint,
          expiresAt: 0,
        };
        return {
          available: false,
          unavailableReason: error instanceof Error
            ? error.message
            : 'Governed pull-request preparation failed',
          target: preflightTarget(unavailableEntry),
          settingsSnapshotFingerprint: configuredSettingsFingerprint,
          remoteHeadFingerprint: remoteFactsFingerprint,
          executionProjection: externalProjection(unavailableEntry),
          warnings: unavailableEntry.warnings,
        };
      }
    }

    const draftEntry = {
      ...base,
      ...(pullRequest ? { pullRequest } : {}),
    };
    const preview = previewProjection(draftEntry, now());
    const lock = canonicalExecutionProjectionLock(preview)!;
    const entry: PreviewEntry = {
      ...draftEntry,
      key: lock.projectionFingerprint,
      settingsSnapshotFingerprint: configuredSettingsFingerprint,
      expiresAt: Date.now() + ttlMs,
    };
    previews.set(entry.key, entry);
    const { projectionFingerprint: _projectionFingerprint, ...executionProjection } = lock;
    return {
      available: true,
      target: preflightTarget(entry),
      settingsSnapshotFingerprint: configuredSettingsFingerprint,
      remoteHeadFingerprint: remoteFactsFingerprint,
      executionProjection,
      ...(pullRequest ? { patch: pullRequestPatch(repository, pullRequest) } : {}),
      warnings: entry.warnings,
    };
  }

  async function apply(
    value: Readonly<ExternalContributionPlan>,
    approval: Parameters<GovernedContributionPort['apply']>[1],
  ): Promise<Awaited<ReturnType<GovernedContributionPort['apply']>>> {
    const canonical = parseExternalContributionPlan(value);
    if (canonical.disposition.choice === 'local_only') {
      throw new ContributionError('INVALID_INPUT', 'local_only cannot enter a remote contribution port');
    }
    if (
      canonical.projectId !== options.context.projectId
      || canonical.target?.provider !== 'github'
      || canonical.target.repository !== `${repository.owner}/${repository.name}`
      || canonical.settingsSnapshotFingerprint !== configuredSettingsFingerprint
      || !canonical.executionProjection
    ) {
      throw new ContributionError('STALE_PLAN', 'Canonical contribution target or settings drifted');
    }
    await prune();
    const entry = previews.get(canonical.executionProjection.projectionFingerprint);
    if (!entry) {
      throw new ContributionError(
        'STALE_PLAN',
        'Staged contribution preview expired or is unavailable; create a new canonical plan',
      );
    }
    if (
      entry.choice !== canonical.disposition.choice
      || entry.projectId !== canonical.projectId
      || entry.observationId !== canonical.observationId
      || entry.observationRevision !== canonical.observationRevision
      || entry.localWork.entity !== canonical.linkedIssueEntity
      || entry.remoteFacts.baseSha !== canonical.target.baseRevision
      || (
        canonical.disposition.choice === 'prepare_pull_request'
        && !entry.pullRequest
      )
    ) {
      throw new ContributionError('STALE_PLAN', 'Canonical plan does not match its staged preview');
    }
    const projection = executableProjection(canonical, entry);
    const parser = { parse: asCanonicalContract };
    const canonicalBinding = createCanonicalPlanBindingPort({
      async load(planId) {
        if (planId !== canonical.id) {
          throw new ContributionError('STALE_PLAN', 'Canonical plan loader identity mismatch');
        }
        return canonical;
      },
    }, parser);
    const strictConfirmation: ConfirmationTokenPort = {
      async verify(request) {
        if (
          request.confirmationToken !== approval.approvalToken
          || request.transitionToken !== approval.transitionToken
          || request.actor !== approval.actor
        ) {
          return { approved: false, reason: 'Approval pair does not match this apply request' };
        }
        const decision = await options.confirmation.verify(request);
        if (!decision.approved || decision.workRunId !== approval.workRunId) {
          return {
            approved: false,
            reason: 'Approval token is not bound to the presented workRunId',
          };
        }
        return decision;
      },
    };
    const service = createContributionService({
      transports,
      receipts,
      confirmation: strictConfirmation,
      canonicalBinding,
      worktree: runtime.worktree,
      verifier: runtime.verifier,
    });
    const result = await service.apply({
      plan: projection,
      actor: approval.actor,
      transitionToken: approval.transitionToken,
      confirmationToken: approval.approvalToken,
      ...(approval.action ? { action: approval.action } : {}),
      ...(approval.pullRequestId ? { pullRequestId: approval.pullRequestId } : {}),
      ...(approval.expectedPullRequestRevision
        ? { expectedPullRequestRevision: approval.expectedPullRequestRevision }
        : {}),
    });
    if (result.status !== 'applied') {
      throw new ContributionError('REMOTE_REJECTED', 'Remote contribution did not produce a receipt');
    }
    entry.expiresAt = Date.now() + ttlMs;
    return {
      provider: repository.provider,
      remoteIdentity: result.remote.remoteId,
      remoteRevision: result.remote.revision,
      url: result.remote.url,
      replayed: result.replayed,
      receipt: result.receipt as unknown as Record<string, unknown>,
    };
  }

  return {
    repositorySelection: candidate.id,
    inspect,
    apply,
    async dispose() {
      for (const entry of [...previews.values()]) await releasePreview(entry);
      await runtime.dispose();
    },
  };
}
