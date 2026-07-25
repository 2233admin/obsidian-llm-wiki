import { isAbsolute, relative, resolve } from 'node:path';

import type { ProjectContext } from '../project/project-context.js';
import type { CanonicalPlanBindingPort } from './canonical-projection.js';
import type {
  ConfirmationTokenPort,
  ContributionApplyRequest,
  ContributionApplyResult,
  ContributionPlanInput,
  ContributionTransportRegistry,
  ForgeExecutionPlanProjection,
  RepositoryCandidate,
} from './contracts.js';
import { ContributionError } from './errors.js';
import type {
  ExecFilePort,
  GhCliContributionTransportOptions,
} from './gh-cli.js';
import { fingerprint } from './fingerprint.js';
import {
  createLocalGhCliContributionProductionPorts,
  type LocalGhCliContributionProductionPorts,
  type TestCommandPolicy,
} from './local-production.js';
import { JsonFileContributionReceiptStore } from './receipts.js';
import { resolveRepository } from './repository.js';
import {
  createContributionService,
  type ContributionService,
} from './service.js';

const GITHUB_PROJECTION_KINDS = new Set([
  'github',
  'github-repo',
  'github-repository',
]);
const REPOSITORY_SEGMENT_RE = /^[A-Za-z0-9_.-]+$/;

export interface ProjectContextGhContributionFactoryOptions {
  vaultPath: string;
  context: ProjectContext;
  canonicalBinding: CanonicalPlanBindingPort;
  confirmation: ConfirmationTokenPort;
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
}

export interface ProjectContextGhContributionProduction {
  service: ContributionService;
  repositoryCandidate: RepositoryCandidate;
  repositoryCandidates: [RepositoryCandidate];
  receipts: JsonFileContributionReceiptStore;
  runtime: LocalGhCliContributionProductionPorts;
  /**
   * Problem GovernedContributionPort inspect seam. Repository candidates and
   * Project identity are re-bound to Project Context, never accepted from a
   * public request.
   */
  inspect(input: ContributionPlanInput): Promise<ForgeExecutionPlanProjection>;
  /**
   * Apply seam preserves action, pullRequestId and
   * expectedPullRequestRevision for staged PR transitions.
   */
  apply(input: ContributionApplyRequest): Promise<ContributionApplyResult>;
  dispose(): Promise<void>;
}

function projectionRepository(
  context: ProjectContext,
): {
  kind: string;
  target: string;
  host: string;
  owner: string;
  name: string;
  canonicalUrl: string;
  apiEndpoint: string;
} {
  const github = context.projections.filter((projection) =>
    GITHUB_PROJECTION_KINDS.has(projection.kind.trim().toLowerCase()),
  );
  if (github.length !== 1) {
    throw new ContributionError(
      'AMBIGUOUS_REPOSITORY',
      github.length
        ? 'Project Context contains multiple GitHub repository projections'
        : 'Project Context has no governed GitHub repository projection',
    );
  }
  const projection = github[0]!;
  const rawTarget = projection.target.trim();
  let host = 'github.com';
  let owner: string;
  let name: string;
  if (/^https:\/\//i.test(rawTarget)) {
    let url: URL;
    try {
      url = new URL(rawTarget);
    } catch {
      throw new ContributionError('INVALID_INPUT', 'GitHub projection URL is invalid');
    }
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.search
      || url.hash
      || url.port
    ) {
      throw new ContributionError(
        'INVALID_INPUT',
        'GitHub projection must be a credential-free canonical HTTPS URL',
      );
    }
    const parts = url.pathname.replace(/^\/|\/$/g, '').split('/');
    if (parts.length !== 2) {
      throw new ContributionError('INVALID_INPUT', 'GitHub projection must identify owner/repository');
    }
    host = url.hostname.toLowerCase();
    [owner, name] = parts;
  } else {
    const parts = rawTarget.replace(/^\/|\/$/g, '').split('/');
    if (parts.length !== 2) {
      throw new ContributionError('INVALID_INPUT', 'GitHub projection must identify owner/repository');
    }
    [owner, name] = parts;
  }
  name = name!.replace(/\.git$/i, '');
  if (
    !host
    || !REPOSITORY_SEGMENT_RE.test(owner!)
    || !REPOSITORY_SEGMENT_RE.test(name)
  ) {
    throw new ContributionError('INVALID_INPUT', 'GitHub projection contains unsafe repository identity');
  }
  const canonicalUrl = `https://${host}/${owner!}/${name}`;
  return {
    kind: projection.kind,
    target: rawTarget,
    host,
    owner: owner!,
    name,
    canonicalUrl,
    apiEndpoint: host === 'github.com'
      ? 'https://api.github.com'
      : `https://${host}/api/v3`,
  };
}

export function repositoryCandidateFromProjectContext(
  context: ProjectContext,
): RepositoryCandidate {
  const repository = projectionRepository(context);
  return {
    id: `project-context:${repository.host}/${repository.owner}/${repository.name}`,
    provider: 'github',
    role: 'configured',
    owner: repository.owner,
    name: repository.name,
    canonicalUrl: repository.canonicalUrl,
    apiEndpoint: repository.apiEndpoint,
    provenance: {
      source: 'project_binding',
      evidenceDigest: fingerprint({
        projectId: context.projectId,
        registryRecord: context.roots.registryRecord,
        projection: {
          kind: repository.kind,
          target: repository.target,
        },
      }),
    },
  };
}

function governedReceiptRoot(
  vaultPath: string,
  context: ProjectContext,
  override?: string,
): string {
  if (!isAbsolute(vaultPath)) {
    throw new ContributionError('INVALID_INPUT', 'vaultPath must be absolute');
  }
  if (override && !isAbsolute(override)) {
    throw new ContributionError('INVALID_INPUT', 'receiptRoot override must be absolute');
  }
  const vault = resolve(vaultPath);
  const root = override
    ? resolve(override)
    : resolve(vault, context.roots.workOs, 'projection-receipts', 'external-contributions');
  const rel = relative(vault, root);
  if (!override && (rel.startsWith('..') || isAbsolute(rel))) {
    throw new ContributionError('INVALID_INPUT', 'Contribution receipt root escaped the vault');
  }
  return root;
}

/**
 * Fully wired local GitHub production runtime for problem_mcp_obc. Callers
 * provide a Project Context already resolved by resolveProjectContext plus the
 * canonical Problem Intake binding and explicit confirmation verifier.
 */
export function createProjectContextGhContributionProduction(
  options: ProjectContextGhContributionFactoryOptions,
): ProjectContextGhContributionProduction {
  const { context } = options;
  if (!context.workspace?.available || !isAbsolute(context.workspace.path)) {
    throw new ContributionError(
      'PR_UNAVAILABLE',
      'Project Context has no available machine-local workspace binding',
      { fallback: 'submit_issue' },
    );
  }
  const candidate = repositoryCandidateFromProjectContext(context);
  const resolved = resolveRepository([candidate], candidate.id);
  const runtime = createLocalGhCliContributionProductionPorts({
    binding: {
      projectId: context.projectId as `project/${string}`,
      repositoryMappingFingerprint: resolved.mappingFingerprint,
      localRepositoryPath: context.workspace.path,
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
  const receipts = new JsonFileContributionReceiptStore(governedReceiptRoot(
    options.vaultPath,
    context,
    options.receiptRoot,
  ));
  const transports: ContributionTransportRegistry = {
    get(provider) {
      return provider === 'github' ? runtime.transport : undefined;
    },
  };
  const baseService = createContributionService({
    transports,
    receipts,
    confirmation: options.confirmation,
    canonicalBinding: options.canonicalBinding,
    worktree: runtime.worktree,
    verifier: runtime.verifier,
  });
  const service: ContributionService = {
    plan(input) {
      if (input.projectId !== context.projectId) {
        throw new ContributionError(
          'INVALID_INPUT',
          'Contribution Project identity does not match resolved Project Context',
        );
      }
      if (input.disposition === 'local_only') return baseService.plan(input);
      return baseService.plan({
        ...input,
        repositoryCandidates: [candidate],
        selectedRepositoryId: candidate.id,
      });
    },
    apply(input) {
      if (
        input.plan.projectId !== context.projectId
        || (
          input.plan.repository
          && input.plan.repository.mappingFingerprint !== resolved.mappingFingerprint
        )
      ) {
        throw new ContributionError(
          'STALE_PLAN',
          'Contribution plan is not bound to the resolved Project Context repository',
        );
      }
      return baseService.apply(input);
    },
  };
  return {
    service,
    repositoryCandidate: candidate,
    repositoryCandidates: [candidate],
    receipts,
    runtime,
    inspect: (input) => service.plan(input),
    apply: (input) => service.apply(input),
    dispose: () => runtime.dispose(),
  };
}
