import type {
  ContributionTransport,
  RemoteMutationResult,
  RepositoryPreflightFacts,
  RepositoryPreflightRequest,
  Sha256Digest,
} from './contracts.js';
import { ContributionError, ContributionTransportError } from './errors.js';

export interface ContributionHttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
}

export interface ContributionHttpResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

export interface ContributionHttpPort {
  request(request: ContributionHttpRequest): Promise<ContributionHttpResponse>;
}

export interface GitBranchPushPort {
  push(request: {
    repositoryUrl: string;
    artifactId: string;
    artifactDigest: Sha256Digest;
    baseSha: string;
    expectedHeadSha: string;
    headRef: string;
    targetOwner: string;
    targetRepository: string;
    targetRef: string;
    mode: 'branch' | 'fork';
    idempotencyKey: Sha256Digest;
  }): Promise<RemoteMutationResult>;
}

export interface ReadyForReviewPort {
  markReady(request: {
    repositoryUrl: string;
    pullRequestId: string;
    expectedRevision: string;
    idempotencyKey: Sha256Digest;
  }): Promise<RemoteMutationResult>;
}

export interface GitHubCompatibleTransportOptions {
  provider?: string;
  timeoutMs?: number;
  userAgent?: string;
  authorizationHeader: () => Promise<string>;
}

function objectBody(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContributionTransportError(`${label} returned an invalid response`, 'unknown');
  }
  return value as Record<string, unknown>;
}

function boundedRemoteResult(value: unknown, label: string): RemoteMutationResult {
  const body = objectBody(value, label);
  const remoteId = String(body.id ?? body.number ?? '');
  const revision = String(body.node_id ?? body.updated_at ?? body.sha ?? '');
  const url = String(body.html_url ?? body.url ?? '');
  if (!remoteId || remoteId.length > 200 || !revision || revision.length > 500 || !url || url.length > 2_000) {
    throw new ContributionTransportError(`${label} response lacks a bounded remote identity`, 'unknown');
  }
  return { remoteId, revision, url };
}

export class GitHubCompatibleTransport implements ContributionTransport {
  readonly provider: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(
    private readonly http: ContributionHttpPort,
    private readonly branchPush: GitBranchPushPort,
    private readonly options: GitHubCompatibleTransportOptions,
    private readonly readyForReview?: ReadyForReviewPort,
  ) {
    this.provider = options.provider ?? 'github';
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.userAgent = options.userAgent ?? 'obsidian-llm-wiki';
  }

  private async headers(idempotencyKey?: Sha256Digest): Promise<Record<string, string>> {
    const authorization = await this.options.authorizationHeader();
    if (!authorization || /[\r\n]/.test(authorization)) {
      throw new ContributionError('PROVIDER_UNAVAILABLE', 'GitHub credential resolution failed safely');
    }
    return {
      accept: 'application/vnd.github+json',
      authorization,
      'user-agent': this.userAgent,
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    };
  }

  private repositoryUrl(request: RepositoryPreflightRequest): string {
    return `${request.repository.apiEndpoint}/repos/${encodeURIComponent(request.repository.owner)}/${encodeURIComponent(request.repository.name)}`;
  }

  async preflight(request: RepositoryPreflightRequest): Promise<RepositoryPreflightFacts> {
    const repositoryResponse = await this.http.request({
      method: 'GET',
      url: this.repositoryUrl(request),
      headers: await this.headers(),
      timeoutMs: this.timeoutMs,
    });
    if (repositoryResponse.status !== 200) {
      throw new ContributionError(
        'PREFLIGHT_FAILED',
        `Repository preflight failed with status ${repositoryResponse.status}`,
      );
    }
    const repository = objectBody(repositoryResponse.body, 'Repository preflight');
    const defaultBranch = String(request.baseRef ?? repository.default_branch ?? '');
    if (!defaultBranch || defaultBranch.length > 255) {
      throw new ContributionError('PREFLIGHT_FAILED', 'Repository preflight returned no bounded default branch');
    }
    const branchResponse = await this.http.request({
      method: 'GET',
      url: `${this.repositoryUrl(request)}/branches/${encodeURIComponent(defaultBranch)}`,
      headers: await this.headers(),
      timeoutMs: this.timeoutMs,
    });
    if (branchResponse.status !== 200) {
      throw new ContributionError(
        'PREFLIGHT_FAILED',
        `Base branch preflight failed with status ${branchResponse.status}`,
      );
    }
    const branch = objectBody(branchResponse.body, 'Base branch preflight');
    const commit = objectBody(branch.commit, 'Base branch commit');
    const permissions = objectBody(repository.permissions ?? {}, 'Repository permissions');
    const baseSha = String(commit.sha ?? '');
    const repositoryId = String(repository.id ?? '');
    const revision = String(repository.updated_at ?? baseSha);
    if (!baseSha || baseSha.length > 200 || !repositoryId || repositoryId.length > 200) {
      throw new ContributionError('PREFLIGHT_FAILED', 'Repository preflight returned incomplete identity facts');
    }
    const push = permissions.push === true;
    const pull = permissions.pull === true || push;
    const triage = permissions.triage === true || push;
    return {
      provider: this.provider,
      repositoryId,
      canonicalUrl: request.repository.canonicalUrl,
      defaultBranch,
      baseRef: defaultBranch,
      baseSha,
      revision,
      health: 'available',
      permissions: {
        issuesWrite: repository.has_issues !== false && triage,
        pushBranch: push,
        createPullRequest: pull,
        markReadyForReview: pull && this.readyForReview !== undefined,
      },
      capturedAt: new Date().toISOString(),
      warnings: [],
    };
  }

  async createIssue(request: Parameters<ContributionTransport['createIssue']>[0]): Promise<RemoteMutationResult> {
    const response = await this.http.request({
      method: 'POST',
      url: `${request.repository.apiEndpoint}/repos/${encodeURIComponent(request.repository.owner)}/${encodeURIComponent(request.repository.name)}/issues`,
      headers: await this.headers(request.idempotencyKey),
      body: { title: request.title, body: request.body, labels: request.labels },
      timeoutMs: this.timeoutMs,
    });
    if (response.status !== 201) {
      throw new ContributionTransportError(`Issue create failed with status ${response.status}`, 'unknown');
    }
    return boundedRemoteResult(response.body, 'Issue create');
  }

  pushBranch(request: Parameters<ContributionTransport['pushBranch']>[0]): Promise<RemoteMutationResult> {
    return this.branchPush.push({
      repositoryUrl: request.repository.canonicalUrl,
      artifactId: request.artifactId,
      artifactDigest: request.artifactDigest,
      baseSha: request.baseSha,
      expectedHeadSha: request.expectedHeadSha,
      headRef: request.headRef,
      targetOwner: request.target.owner,
      targetRepository: request.target.repository,
      targetRef: request.target.ref,
      mode: request.target.mode,
      idempotencyKey: request.idempotencyKey,
    });
  }

  async createDraftPullRequest(
    request: Parameters<ContributionTransport['createDraftPullRequest']>[0],
  ): Promise<RemoteMutationResult> {
    if (request.draft !== true) {
      throw new ContributionError('INVALID_INPUT', 'GitHub contribution flow creates draft pull requests only');
    }
    const response = await this.http.request({
      method: 'POST',
      url: `${request.repository.apiEndpoint}/repos/${encodeURIComponent(request.repository.owner)}/${encodeURIComponent(request.repository.name)}/pulls`,
      headers: await this.headers(request.idempotencyKey),
      body: {
        base: request.baseRef,
        head: request.headRef,
        title: request.title,
        body: request.body,
        draft: true,
      },
      timeoutMs: this.timeoutMs,
    });
    if (response.status !== 201) {
      throw new ContributionTransportError(`Draft pull request create failed with status ${response.status}`, 'unknown');
    }
    return boundedRemoteResult(response.body, 'Draft pull request create');
  }

  async markReadyForReview(
    request: Parameters<NonNullable<ContributionTransport['markReadyForReview']>>[0],
  ): Promise<RemoteMutationResult> {
    if (!this.readyForReview) {
      throw new ContributionTransportError('Ready-for-review port is not configured', 'not_sent');
    }
    return this.readyForReview.markReady({
      repositoryUrl: request.repository.canonicalUrl,
      pullRequestId: request.pullRequestId,
      expectedRevision: request.expectedRevision,
      idempotencyKey: request.idempotencyKey,
    });
  }
}
