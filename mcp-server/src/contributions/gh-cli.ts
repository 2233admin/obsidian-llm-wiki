import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  ContributionTransport,
  PullRequestPlanDetails,
  PushTargetPreflightFacts,
  RemoteMutationResult,
  RepositoryPreflightFacts,
  RepositoryPreflightRequest,
  ResolvedRepository,
  Sha256Digest,
} from './contracts.js';
import { ContributionError, ContributionTransportError } from './errors.js';

export interface ExecFileRequest {
  file: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxBufferBytes: number;
}

export interface ExecFileResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ExecFilePort {
  run(request: ExecFileRequest): Promise<ExecFileResult>;
}

export class NodeExecFilePort implements ExecFilePort {
  run(request: ExecFileRequest): Promise<ExecFileResult> {
    return new Promise((resolve) => {
      execFile(
        request.file,
        request.args,
        {
          cwd: request.cwd,
          env: request.env,
          timeout: request.timeoutMs,
          maxBuffer: request.maxBufferBytes,
          windowsHide: true,
          shell: false,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          const code = (error as NodeJS.ErrnoException | null)?.code;
          resolve({
            exitCode: typeof code === 'number'
              ? code
              : error
                ? 1
                : 0,
            stdout: String(stdout),
            stderr: String(stderr),
          });
        },
      );
    });
  }
}

export interface ContributionArtifactWorkspace {
  cwd: string;
  headSha: string;
}

export interface ContributionArtifactWorkspacePort {
  resolve(request: {
    artifactId: string;
    artifactDigest: Sha256Digest;
  }): Promise<ContributionArtifactWorkspace>;
  release?(request: {
    artifactId: string;
    artifactDigest: Sha256Digest;
  }): Promise<void>;
}

export interface GhCliContributionTransportOptions {
  ghPath?: string;
  gitPath?: string;
  provider?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

interface GhRepositoryView {
  id: string;
  url: string;
  defaultBranchRef?: { name?: string };
  viewerPermission?: string;
  hasIssuesEnabled?: boolean;
  isArchived?: boolean;
  updatedAt?: string;
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ContributionTransportError(`${label} returned invalid JSON`, 'unknown', { cause: error });
  }
}

function hostFor(repository: ResolvedRepository): string {
  return new URL(repository.canonicalUrl).hostname;
}

function repositorySelector(repository: ResolvedRepository): string {
  const host = hostFor(repository);
  return host === 'github.com'
    ? `${repository.owner}/${repository.name}`
    : `${host}/${repository.owner}/${repository.name}`;
}

function safeRemoteUrl(stdout: string, label: string): string {
  const url = stdout.trim().split(/\s+/).find((item) => /^https:\/\//.test(item));
  if (!url || url.length > 2_000) {
    throw new ContributionTransportError(`${label} did not return a bounded HTTPS URL`, 'unknown');
  }
  return url;
}

function remoteResultFromJson(
  value: Record<string, unknown>,
  label: string,
): RemoteMutationResult {
  const remoteId = String(value.number ?? value.id ?? '');
  const revision = String(value.updatedAt ?? value.id ?? '');
  const url = String(value.url ?? '');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ContributionTransportError(`${label} returned an invalid URL`, 'unknown');
  }
  if (
    !remoteId
    || remoteId.length > 200
    || !revision
    || revision.length > 500
    || url.length > 2_000
    || parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
  ) {
    throw new ContributionTransportError(`${label} returned an unsafe remote identity`, 'unknown');
  }
  return { remoteId, revision, url };
}

function permissionRank(value: string | undefined): number {
  return ({
    READ: 1,
    TRIAGE: 2,
    WRITE: 3,
    MAINTAIN: 4,
    ADMIN: 5,
  } as Record<string, number>)[value ?? ''] ?? 0;
}

export class GhCliContributionTransport implements ContributionTransport {
  readonly provider: string;
  private readonly ghPath: string;
  private readonly gitPath: string;
  private readonly timeoutMs: number;
  private readonly maxBufferBytes: number;

  constructor(
    private readonly exec: ExecFilePort,
    private readonly artifacts: ContributionArtifactWorkspacePort,
    options: GhCliContributionTransportOptions = {},
  ) {
    this.provider = options.provider ?? 'github';
    this.ghPath = options.ghPath ?? 'gh';
    this.gitPath = options.gitPath ?? 'git';
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.maxBufferBytes = options.maxBufferBytes ?? 1_000_000;
  }

  private run(
    file: string,
    args: string[],
    options: { cwd?: string; mutating?: boolean } = {},
  ): Promise<ExecFileResult> {
    return this.exec.run({
      file,
      args,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: {
        ...process.env,
        GH_PROMPT_DISABLED: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
      timeoutMs: this.timeoutMs,
      maxBufferBytes: this.maxBufferBytes,
    }).then((result) => {
      if (result.exitCode !== 0) {
        const message = result.stderr.trim().slice(0, 1_000) || `${file} exited ${result.exitCode}`;
        if (options.mutating) {
          throw new ContributionTransportError(message, 'unknown');
        }
        throw new ContributionError('PREFLIGHT_FAILED', message);
      }
      return result;
    });
  }

  private runGh(
    args: string[],
    options: { cwd?: string; mutating?: boolean } = {},
  ): Promise<ExecFileResult> {
    return this.run(this.ghPath, args, options);
  }

  private async assertAuth(repository: ResolvedRepository): Promise<void> {
    await this.runGh(['auth', 'status', '--active', '--hostname', hostFor(repository)]);
  }

  private async baseSha(repository: ResolvedRepository, baseRef: string): Promise<string> {
    const response = await this.runGh([
      'api',
      '--hostname',
      hostFor(repository),
      `repos/${repository.owner}/${repository.name}/commits/${encodeURIComponent(baseRef)}`,
      '--jq',
      '.sha',
    ]);
    const sha = response.stdout.trim();
    if (!/^[0-9a-f]{40,64}$/.test(sha)) {
      throw new ContributionError('PREFLIGHT_FAILED', 'gh returned an invalid base revision');
    }
    return sha;
  }

  async preflight(request: RepositoryPreflightRequest): Promise<RepositoryPreflightFacts> {
    await this.assertAuth(request.repository);
    const response = await this.runGh([
      'repo',
      'view',
      repositorySelector(request.repository),
      '--json',
      'id,url,defaultBranchRef,viewerPermission,hasIssuesEnabled,isArchived,updatedAt',
    ]);
    const view = parseJsonObject(response.stdout, 'gh repo view') as unknown as GhRepositoryView;
    if (
      !view.id
      || !view.url
      || view.url.replace(/\/$/, '') !== request.repository.canonicalUrl.replace(/\/$/, '')
    ) {
      throw new ContributionError('PREFLIGHT_FAILED', 'gh repository identity does not match the governed binding');
    }
    const defaultBranch = String(view.defaultBranchRef?.name ?? '');
    const baseRef = request.baseRef ?? defaultBranch;
    if (!baseRef || baseRef.length > 255) {
      throw new ContributionError('PREFLIGHT_FAILED', 'gh repository has no bounded base branch');
    }
    const baseSha = await this.baseSha(request.repository, baseRef);
    const rank = permissionRank(view.viewerPermission);
    const archived = view.isArchived === true;
    return {
      provider: this.provider,
      repositoryId: view.id,
      canonicalUrl: request.repository.canonicalUrl,
      defaultBranch,
      baseRef,
      baseSha,
      revision: String(view.updatedAt ?? baseSha),
      health: archived ? 'unavailable' : 'available',
      permissions: {
        issuesWrite: !archived && view.hasIssuesEnabled === true && rank >= 2,
        pushBranch: !archived && rank >= 3,
        createPullRequest: !archived && rank >= 1,
        markReadyForReview: !archived && rank >= 1,
      },
      capturedAt: new Date().toISOString(),
      warnings: archived ? ['Repository is archived.'] : [],
    };
  }

  async preflightPushTarget(request: {
    repository: ResolvedRepository;
    target: PullRequestPlanDetails['pushTarget'];
  }): Promise<PushTargetPreflightFacts> {
    await this.assertAuth(request.repository);
    const host = hostFor(request.repository);
    const targetUrl = `https://${host}/${request.target.owner}/${request.target.repository}`;
    const targetSelector = host === 'github.com'
      ? `${request.target.owner}/${request.target.repository}`
      : `${host}/${request.target.owner}/${request.target.repository}`;
    const response = await this.runGh([
      'repo',
      'view',
      targetSelector,
      '--json',
      'id,url,viewerPermission,isArchived,updatedAt',
    ]);
    const view = parseJsonObject(response.stdout, 'gh push target repo view') as unknown as GhRepositoryView;
    if (
      !view.id
      || !view.url
      || view.url.replace(/\/$/, '') !== targetUrl
    ) {
      throw new ContributionError(
        'PREFLIGHT_FAILED',
        'gh push target identity does not match the reviewed branch or fork',
      );
    }
    const archived = view.isArchived === true;
    return {
      provider: this.provider,
      repositoryId: view.id,
      owner: request.target.owner,
      repository: request.target.repository,
      canonicalUrl: targetUrl,
      revision: String(view.updatedAt ?? view.id),
      canPush: !archived && permissionRank(view.viewerPermission) >= 3,
      capturedAt: new Date().toISOString(),
    };
  }

  private withBodyFile<T>(body: string, fn: (path: string) => Promise<T>): Promise<T> {
    const path = join(tmpdir(), `llmwiki-contribution-${process.pid}-${randomUUID()}.md`);
    writeFileSync(path, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return fn(path).finally(() => rmSync(path, { force: true }));
  }

  async reconcileIssue(
    repository: ResolvedRepository,
    issue: string,
  ): Promise<RemoteMutationResult> {
    const response = await this.runGh([
      'issue',
      'view',
      issue,
      '--repo',
      repositorySelector(repository),
      '--json',
      'id,number,url,updatedAt',
    ]);
    const value = parseJsonObject(response.stdout, 'gh issue view');
    return remoteResultFromJson(value, 'gh issue view');
  }

  async createIssue(
    request: Parameters<ContributionTransport['createIssue']>[0],
  ): Promise<RemoteMutationResult> {
    await this.assertAuth(request.repository);
    const response = await this.withBodyFile(request.body, (bodyFile) => this.runGh([
      'issue',
      'create',
      '--repo',
      repositorySelector(request.repository),
      '--title',
      request.title,
      '--body-file',
      bodyFile,
      ...request.labels.flatMap((label) => ['--label', label]),
    ], { mutating: true }));
    const url = safeRemoteUrl(response.stdout, 'gh issue create');
    return this.reconcileIssue(request.repository, url);
  }

  async pushBranch(
    request: Parameters<ContributionTransport['pushBranch']>[0],
  ): Promise<RemoteMutationResult> {
    await this.assertAuth(request.repository);
    const artifactRequest = {
      artifactId: request.artifactId,
      artifactDigest: request.artifactDigest,
    };
    const workspace = await this.artifacts.resolve(artifactRequest);
    try {
      if (
        workspace.headSha === request.expectedHeadSha
        && workspace.headSha !== request.baseSha
        && /^[0-9a-f]{40,64}$/.test(workspace.headSha)
      ) {
        const targetUrl = request.target.owner === request.repository.owner
          && request.target.repository === request.repository.name
          ? request.repository.canonicalUrl
          : `https://${hostFor(request.repository)}/${request.target.owner}/${request.target.repository}`;
        await this.run(this.gitPath, [
          '-C',
          workspace.cwd,
          'push',
          '--porcelain',
          targetUrl,
          `${workspace.headSha}:refs/heads/${request.target.ref}`,
        ], { cwd: workspace.cwd, mutating: true });
        return {
          remoteId: `${request.target.owner}/${request.target.repository}:${request.target.ref}`,
          revision: workspace.headSha,
          url: `${targetUrl}/tree/${encodeURIComponent(request.target.ref)}`,
        };
      }
      throw new ContributionTransportError('Contribution artifact head revision is invalid', 'not_sent');
    } finally {
      await this.artifacts.release?.(artifactRequest);
    }
  }

  async reconcilePullRequest(
    repository: ResolvedRepository,
    pullRequest: string,
  ): Promise<RemoteMutationResult> {
    const response = await this.runGh([
      'pr',
      'view',
      pullRequest,
      '--repo',
      repositorySelector(repository),
      '--json',
      'id,number,url,updatedAt,isDraft',
    ]);
    const value = parseJsonObject(response.stdout, 'gh pr view');
    return remoteResultFromJson(value, 'gh pr view');
  }

  async createDraftPullRequest(
    request: Parameters<ContributionTransport['createDraftPullRequest']>[0],
  ): Promise<RemoteMutationResult> {
    if (request.draft !== true) {
      throw new ContributionError('INVALID_INPUT', 'gh contribution transport creates draft pull requests only');
    }
    await this.assertAuth(request.repository);
    const response = await this.withBodyFile(request.body, (bodyFile) => this.runGh([
      'pr',
      'create',
      '--repo',
      repositorySelector(request.repository),
      '--base',
      request.baseRef,
      '--head',
      request.headRef,
      '--title',
      request.title,
      '--body-file',
      bodyFile,
      '--draft',
    ], { mutating: true }));
    const url = safeRemoteUrl(response.stdout, 'gh pr create');
    return this.reconcilePullRequest(request.repository, url);
  }

  async markReadyForReview(
    request: Parameters<NonNullable<ContributionTransport['markReadyForReview']>>[0],
  ): Promise<RemoteMutationResult> {
    const current = await this.reconcilePullRequest(request.repository, request.pullRequestId);
    if (current.revision !== request.expectedRevision) {
      throw new ContributionError('STALE_PLAN', 'Pull request revision changed before ready-for-review');
    }
    await this.runGh([
      'pr',
      'ready',
      request.pullRequestId,
      '--repo',
      repositorySelector(request.repository),
    ], { mutating: true });
    return this.reconcilePullRequest(request.repository, request.pullRequestId);
  }
}
