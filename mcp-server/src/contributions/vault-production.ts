import type { ProjectContext } from '../project/project-context.js';
import {
  normalizedProjectContext,
  resolveProjectContext,
} from '../project/project-context.js';
import type {
  GovernedContributionPort,
} from '../problem-intake/contracts.js';

import {
  createUiWorkRunApprovalConfirmationAdapter,
  type UiWorkRunApprovalPairPort,
} from './approval-pairs.js';
import {
  loadVaultContributionPolicy,
  type LoadedGovernedPullRequestPolicy,
} from './contribution-policy.js';
import type { ContributionReceiptStore } from './contracts.js';
import { ContributionError } from './errors.js';
import { fingerprint } from './fingerprint.js';
import {
  createProjectContextGovernedContributionPort,
  type GovernedContributionRuntime,
  type ProjectContextGovernedContributionPort,
  type ProjectContextGovernedContributionPortOptions,
} from './problem-bridge.js';
import { repositoryCandidateFromProjectContext } from './production-factory.js';

export interface VaultGovernedContributionPortOptions extends Omit<
  ProjectContextGovernedContributionPortOptions,
  'context' | 'confirmation' | 'pullRequestPolicy' | 'runtime' | 'receipts'
> {
  approvalPairs?: UiWorkRunApprovalPairPort;
  contextResolver?: (
    vaultPath: string,
    projectId: `project/${string}`,
  ) => ProjectContext;
  policyLoader?: (
    vaultPath: string,
    projectId: `project/${string}`,
  ) => Promise<LoadedGovernedPullRequestPolicy | undefined>;
  runtimeFactory?: (
    context: ProjectContext,
  ) => GovernedContributionRuntime | undefined;
  receiptsFactory?: (
    context: ProjectContext,
  ) => ContributionReceiptStore | undefined;
  portFactory?: (
    options: ProjectContextGovernedContributionPortOptions,
  ) => ProjectContextGovernedContributionPort;
}

export type VaultGovernedContributionPort = GovernedContributionPort & {
  repositorySelection(projectId: `project/${string}`): Promise<{
    id: string;
    display: string;
  }>;
  dispose(): Promise<void>;
};

interface CachedPort {
  key: `sha256:${string}`;
  port: ProjectContextGovernedContributionPort;
}

function canonicalProjectId(value: string): asserts value is `project/${string}` {
  if (!/^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(value)) {
    throw new ContributionError(
      'INVALID_INPUT',
      'Contribution projectId must be canonical project/<lowercase-kebab-slug>',
    );
  }
}

/**
 * Vault-scoped multiplexer for OBC/Ask Mate. Project Context and machine-local
 * policy are re-resolved for every operation; ports are reused only while that
 * exact context/policy fingerprint remains current.
 */
export function createVaultGovernedContributionPort(
  options: VaultGovernedContributionPortOptions,
): VaultGovernedContributionPort {
  const resolveContext = options.contextResolver ?? ((
    vaultPath: string,
    projectId: `project/${string}`,
  ) => resolveProjectContext(
    vaultPath,
    projectId,
    'problem.intake.contribution',
    { recordCompatibility: false },
  ));
  const loadPolicy = options.policyLoader ?? loadVaultContributionPolicy;
  const makePort = options.portFactory ?? createProjectContextGovernedContributionPort;
  const confirmation = createUiWorkRunApprovalConfirmationAdapter(
    options.approvalPairs,
    options.now,
  );
  const cache = new Map<`project/${string}`, CachedPort>();

  async function resolveGovernedPort(
    projectId: `project/${string}`,
    requireValidPolicy: boolean,
  ): Promise<ProjectContextGovernedContributionPort> {
    canonicalProjectId(projectId);
    const context = resolveContext(options.vaultPath, projectId);
    if (context.projectId !== projectId) {
      throw new ContributionError(
        'INVALID_INPUT',
        'Resolved Project Context identity does not match the requested Project',
      );
    }
    const candidate = repositoryCandidateFromProjectContext(context);
    let policy: LoadedGovernedPullRequestPolicy | undefined;
    try {
      policy = await loadPolicy(options.vaultPath, projectId);
    } catch (error) {
      if (requireValidPolicy) throw error;
      policy = undefined;
    }
    const key = fingerprint({
      schemaVersion: 1,
      projectContext: normalizedProjectContext(context),
      workspace: context.workspace
        ? { path: context.workspace.path, available: context.workspace.available }
        : null,
      repositoryCandidate: candidate,
      policyFingerprint: policy?.policyFingerprint ?? null,
    });
    const prior = cache.get(projectId);
    if (prior?.key === key) return prior.port;

    const runtime = options.runtimeFactory?.(context);
    const receipts = options.receiptsFactory?.(context);
    const port = makePort({
      vaultPath: options.vaultPath,
      context,
      confirmation,
      ...(policy ? { pullRequestPolicy: policy } : {}),
      ...(runtime ? { runtime } : {}),
      ...(receipts ? { receipts } : {}),
      ...(options.exec ? { exec: options.exec } : {}),
      ...(options.gitPath ? { gitPath: options.gitPath } : {}),
      ...(options.gh ? { gh: options.gh } : {}),
      ...(options.receiptRoot ? { receiptRoot: options.receiptRoot } : {}),
      ...(options.tempRoot ? { tempRoot: options.tempRoot } : {}),
      ...(options.testCommandPolicy
        ? { testCommandPolicy: options.testCommandPolicy }
        : {}),
      ...(options.allowedTestScripts
        ? { allowedTestScripts: options.allowedTestScripts }
        : {}),
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
      ...(options.previewTtlMs ? { previewTtlMs: options.previewTtlMs } : {}),
      ...(options.maxPreviewEntries
        ? { maxPreviewEntries: options.maxPreviewEntries }
        : {}),
      ...(options.now ? { now: options.now } : {}),
    });
    cache.set(projectId, { key, port });
    if (prior) await prior.port.dispose();
    return port;
  }

  return {
    async repositorySelection(projectId) {
      canonicalProjectId(projectId);
      const context = resolveContext(options.vaultPath, projectId);
      if (context.projectId !== projectId) {
        throw new ContributionError(
          'INVALID_INPUT',
          'Resolved Project Context identity does not match the requested Project',
        );
      }
      const candidate = repositoryCandidateFromProjectContext(context);
      return {
        id: candidate.id,
        display: `${candidate.owner}/${candidate.name}`,
      };
    },
    async inspect(input) {
      canonicalProjectId(input.projectId);
      const port = await resolveGovernedPort(
        input.projectId,
        input.choice === 'prepare_pull_request',
      );
      return port.inspect(input);
    },
    async apply(plan, approval) {
      canonicalProjectId(plan.projectId);
      const port = await resolveGovernedPort(
        plan.projectId,
        plan.disposition.choice === 'prepare_pull_request',
      );
      return port.apply(plan, approval);
    },
    async dispose() {
      const ports = [...cache.values()].map((entry) => entry.port);
      cache.clear();
      await Promise.allSettled(ports.map((port) => port.dispose()));
    },
  };
}
