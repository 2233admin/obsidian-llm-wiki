import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import type {
  ConfirmationTokenPort,
  ContributionTransport,
  ContributionTransportRegistry,
  ForgeExecutionPlanProjection,
  PreparedIsolatedPatch,
  RegressionTestEvidence,
  RepositoryCandidate,
  RepositoryPreflightFacts,
  Sha256Digest,
} from './contracts.js';
import type {
  CanonicalExternalContributionPlanContract,
  CanonicalPlanBindingPort,
} from './canonical-projection.js';
import {
  bindCanonicalExternalContributionPlan,
  canonicalExecutionProjectionLock,
} from './canonical-projection.js';
import { ContributionError, ContributionTransportError } from './errors.js';
import { sha256 } from './fingerprint.js';
import {
  JsonFileContributionReceiptStore,
  MemoryContributionReceiptStore,
} from './receipts.js';
import { StaticContributionTransportRegistry } from './repository.js';
import { createContributionService } from './service.js';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const NOW = '2026-07-19T08:00:00.000Z';

function digest(value: string): Sha256Digest {
  return sha256(value);
}

function candidate(id = 'upstream'): RepositoryCandidate {
  return {
    id,
    provider: 'github',
    role: id === 'origin' ? 'origin' : 'upstream',
    owner: '2233admin',
    name: 'obsidian-llm-wiki',
    canonicalUrl: 'https://github.com/2233admin/obsidian-llm-wiki',
    apiEndpoint: 'https://api.github.com',
    provenance: {
      source: id === 'selected' ? 'user_selected' : 'git_remote',
      evidenceDigest: digest(`candidate:${id}`),
      ...(id === 'selected' ? { selectedBy: 'person:reviewer' } : {}),
    },
  };
}

function facts(revision = 'repo-v1'): RepositoryPreflightFacts {
  return {
    provider: 'github',
    repositoryId: 'repo-1',
    canonicalUrl: candidate().canonicalUrl,
    defaultBranch: 'main',
    baseRef: 'main',
    baseSha: BASE_SHA,
    revision,
    health: 'available',
    permissions: {
      issuesWrite: true,
      pushBranch: true,
      createPullRequest: true,
      markReadyForReview: true,
    },
    capturedAt: NOW,
    warnings: [],
  };
}

class FakeTransport implements ContributionTransport {
  readonly provider = 'github';
  preflightFacts = facts();
  issueCalls = 0;
  pushCalls = 0;
  pullRequestCalls = 0;
  readyCalls = 0;
  issueError?: Error;

  async preflight(): Promise<RepositoryPreflightFacts> {
    return { ...this.preflightFacts, capturedAt: new Date().toISOString() };
  }

  async createIssue(): Promise<{ remoteId: string; revision: string; url: string }> {
    this.issueCalls += 1;
    if (this.issueError) throw this.issueError;
    return {
      remoteId: '17',
      revision: 'issue-rev-1',
      url: 'https://github.com/2233admin/obsidian-llm-wiki/issues/17',
    };
  }

  async pushBranch(): Promise<{ remoteId: string; revision: string; url: string }> {
    this.pushCalls += 1;
    return {
      remoteId: '2233admin/obsidian-llm-wiki:fix/verified',
      revision: HEAD_SHA,
      url: 'https://github.com/2233admin/obsidian-llm-wiki/tree/fix%2Fverified',
    };
  }

  async createDraftPullRequest(
    request: Parameters<ContributionTransport['createDraftPullRequest']>[0],
  ): Promise<{ remoteId: string; revision: string; url: string }> {
    this.pullRequestCalls += 1;
    assert.equal(request.draft, true);
    return {
      remoteId: '31',
      revision: 'pr-rev-1',
      url: 'https://github.com/2233admin/obsidian-llm-wiki/pull/31',
    };
  }

  async markReadyForReview(): Promise<{ remoteId: string; revision: string; url: string }> {
    this.readyCalls += 1;
    return {
      remoteId: '31',
      revision: 'pr-rev-2',
      url: 'https://github.com/2233admin/obsidian-llm-wiki/pull/31',
    };
  }
}

class AllowConfirmation implements ConfirmationTokenPort {
  calls: string[] = [];

  async verify(request: Parameters<ConfirmationTokenPort['verify']>[0]) {
    this.calls.push(request.action);
    return { approved: true, workRunId: 'work-run/approved-1' };
  }
}

function makeService(options: {
  transport?: FakeTransport;
  receipts?: MemoryContributionReceiptStore | JsonFileContributionReceiptStore;
  confirmation?: AllowConfirmation;
  patch?: PreparedIsolatedPatch;
  tests?: RegressionTestEvidence[];
  canonicalBinding?: CanonicalPlanBindingPort;
} = {}) {
  const transport = options.transport ?? new FakeTransport();
  const registry: ContributionTransportRegistry = new StaticContributionTransportRegistry([transport]);
  const confirmation = options.confirmation ?? new AllowConfirmation();
  const receipts = options.receipts ?? new MemoryContributionReceiptStore();
  const patch: PreparedIsolatedPatch = options.patch ?? {
    artifactId: 'patch:verified-fix',
    artifactDigest: digest('patch-artifact'),
    isolation: 'isolated',
    baseRef: 'main',
    baseSha: BASE_SHA,
    headRef: 'fix/verified',
    headSha: HEAD_SHA,
    changedFiles: [{ path: 'mcp-server/src/fix.ts', generated: false }],
    diffSummary: 'Add the bounded regression fix.',
    diffDigest: digest('diff'),
    diffBytes: 600,
  };
  const tests = options.tests ?? [{
    command: 'bun test src/fix.test.ts',
    status: 'passed' as const,
    exitCode: 0,
    outputDigest: digest('test-output'),
    summary: '1 test passed',
  }];
  const service = createContributionService({
    transports: registry,
    receipts,
    confirmation,
    canonicalBinding: options.canonicalBinding ?? { async verify() {} },
    worktree: { async prepare() { return patch; } },
    verifier: { async verify() { return tests; } },
  });
  return { service, transport, receipts, confirmation };
}

function issueInput() {
  return {
    disposition: 'submit_issue' as const,
    projectId: 'project/obsidian-llm-wiki' as const,
    observationId: 'observation/broken-map',
    actor: 'person:reviewer',
    now: NOW,
    canonicalPlanId: 'contribution/issue-broken-map',
    canonicalPlanFingerprint: digest('canonical-issue-plan'),
    repositoryCandidates: [candidate()],
    localWork: {
      entity: 'project/obsidian-llm-wiki/issue/broken-map',
      reviewedHeadDigest: digest('reviewed-head'),
    },
    title: 'Map preview fails with token=github_pat_abcdefghijklmnopqrstuvwxyz',
    body: 'Observed at C:\\Users\\Administrator\\vault\\private.md\nAuthorization: Bearer abcdefghijklmnop',
    bodyAuthorship: 'human' as const,
    evidence: [{
      ref: 'vault:block-map',
      summary: 'Bounded reproduction evidence.',
      digest: digest('evidence'),
    }],
    labels: ['bug', 'Bug'],
  };
}

function pullRequestInput() {
  return {
    disposition: 'prepare_pull_request' as const,
    projectId: 'project/obsidian-llm-wiki' as const,
    observationId: 'observation/broken-map',
    actor: 'person:reviewer',
    now: NOW,
    canonicalPlanId: 'contribution/pr-broken-map',
    canonicalPlanFingerprint: digest('canonical-pr-plan'),
    repositoryCandidates: [candidate()],
    localWork: {
      entity: 'project/obsidian-llm-wiki/issue/broken-map',
      reviewedHeadDigest: digest('reviewed-head'),
    },
    title: 'Fix bounded map preview',
    body: 'This human-reviewed patch fixes the bounded reproduction.',
    bodyAuthorship: 'human' as const,
    evidence: [{
      ref: 'vault:block-map',
      summary: 'Bounded reproduction evidence.',
      digest: digest('evidence'),
    }],
    headRef: 'fix/verified',
    changeSummary: 'Fix the deterministic parser.',
    allowedPaths: ['mcp-server/src/fix.ts'],
    testCommands: ['bun test src/fix.test.ts'],
    pushTarget: {
      owner: '2233admin',
      repository: 'obsidian-llm-wiki',
      ref: 'fix/verified',
      mode: 'branch' as const,
    },
    generatedFilePolicy: 'exclude' as const,
  };
}

describe('contribution service', () => {
  test('keeps local_only free of remote intent and transport calls', async () => {
    const { service, transport, confirmation } = makeService();
    const plan = await service.plan({
      disposition: 'local_only',
      projectId: 'project/obsidian-llm-wiki',
      observationId: 'observation/local-only',
      actor: 'person:reviewer',
      now: NOW,
      canonicalPlanId: 'contribution/local-only',
      canonicalPlanFingerprint: digest('canonical-local-plan'),
    });
    assert.equal(plan.disposition, 'local_only');
    assert.equal(plan.repository, undefined);
    assert.equal((await service.apply({ plan, actor: 'person:reviewer' })).status, 'local_only');
    assert.equal(transport.issueCalls, 0);
    assert.deepEqual(confirmation.calls, []);
  });

  test('fails closed on ambiguous origin/upstream and retains selected mapping provenance', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.plan({
        ...issueInput(),
        repositoryCandidates: [candidate('origin'), candidate('upstream')],
      }),
      (error: unknown) =>
        error instanceof ContributionError && error.code === 'AMBIGUOUS_REPOSITORY',
    );
    const plan = await service.plan({
      ...issueInput(),
      repositoryCandidates: [candidate('origin'), candidate('upstream')],
      selectedRepositoryId: 'upstream',
    });
    assert.equal(plan.repository?.id, 'upstream');
    assert.equal(plan.repository?.provenance.source, 'git_remote');
  });

  test('redacts secrets and machine paths before producing an immutable Issue projection', async () => {
    const { service } = makeService();
    const plan = await service.plan(issueInput());
    assert.match(plan.content!.title, /\[REDACTED SECRET\]/);
    assert.match(plan.content!.body, /\[REDACTED LOCAL PATH\]/);
    assert.match(plan.content!.body, /\[REDACTED SECRET\]/);
    assert.equal(plan.content!.labels.length, 1);
    assert.ok(plan.redactions.some((item) => item.reason === 'secret'));
    assert.ok(plan.redactions.some((item) => item.reason === 'machine_path'));
    assert.doesNotMatch(JSON.stringify(plan), /github_pat_|Administrator|Bearer abcdef/);
  });

  test('binds only to the canonical Problem Intake plan and its forge execution locks', async () => {
    const { service } = makeService();
    const projection = await service.plan(issueInput());
    const canonical: CanonicalExternalContributionPlanContract = {
      schemaVersion: 1,
      id: projection.planId,
      disposition: {
        schemaVersion: 1,
        observationId: projection.observationId,
        observationRevision: 1,
        choice: 'submit_issue',
        actor: projection.actor,
        selectedAt: NOW,
        reason: null,
      },
      projectId: projection.projectId,
      observationId: projection.observationId,
      observationRevision: 1,
      linkedIssueEntity: projection.localWork!.entity,
      target: {
        provider: 'github',
        repository: '2233admin/obsidian-llm-wiki',
        baseRevision: BASE_SHA,
      },
      content: {
        title: projection.content!.title,
        body: projection.content!.body,
        labels: projection.content!.labels,
        evidenceRefs: projection.content!.evidence.map((item) => ({
          kind: 'provider_finding',
          ref: item.ref,
          digest: item.digest,
          summary: item.summary,
        })),
      },
      patch: null,
      executionProjection: canonicalExecutionProjectionLock(projection),
      settingsSnapshotFingerprint: digest('settings'),
      remoteHeadFingerprint: digest('remote-head'),
      redactions: [],
      warnings: [],
      actor: projection.actor,
      fingerprint: projection.canonicalPlanFingerprint,
    };
    const parser = {
      parse(value: unknown) {
        return value as CanonicalExternalContributionPlanContract;
      },
    };
    assert.equal(
      bindCanonicalExternalContributionPlan(canonical, projection, parser),
      projection,
    );
    await assert.rejects(
      async () => bindCanonicalExternalContributionPlan({
        ...canonical,
        target: { ...canonical.target!, baseRevision: 'c'.repeat(40) },
      }, projection, parser),
      (error: unknown) =>
        error instanceof ContributionError && error.code === 'STALE_PLAN',
    );
  });

  test('requires explicit approval, creates once, and replays from a success receipt', async () => {
    const { service, transport, confirmation } = makeService();
    const plan = await service.plan(issueInput());
    const request = {
      plan,
      actor: 'person:reviewer',
      transitionToken: 'transition-issue-0001',
      confirmationToken: 'confirmation-issue-0001',
    };
    const first = await service.apply(request);
    const replay = await service.apply({
      ...request,
      transitionToken: 'transition-issue-0002',
      confirmationToken: 'confirmation-issue-0002',
    });
    assert.equal(first.status, 'applied');
    assert.equal(replay.status, 'applied');
    assert.equal(replay.replayed, true);
    assert.equal(transport.issueCalls, 1);
    assert.deepEqual(confirmation.calls, ['create_issue', 'create_issue']);
  });

  test('blocks blind retry when the provider outcome is unknown', async () => {
    const transport = new FakeTransport();
    transport.issueError = new ContributionTransportError('connection lost after send', 'unknown');
    const { service } = makeService({ transport });
    const plan = await service.plan(issueInput());
    const request = {
      plan,
      actor: 'person:reviewer',
      transitionToken: 'transition-unknown-0001',
      confirmationToken: 'confirmation-unknown-0001',
    };
    await assert.rejects(
      () => service.apply(request),
      (error: unknown) =>
        error instanceof ContributionError && error.code === 'OUTCOME_UNKNOWN',
    );
    await assert.rejects(
      () => service.apply({
        ...request,
        transitionToken: 'transition-unknown-0002',
        confirmationToken: 'confirmation-unknown-0002',
      }),
      (error: unknown) =>
        error instanceof ContributionError && error.code === 'OUTCOME_UNKNOWN',
    );
    assert.equal(transport.issueCalls, 1);
  });

  test('persists only token digests and replays through the JSON receipt store', async () => {
    const root = join(tmpdir(), `llmwiki-contribution-receipts-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    try {
      const receipts = new JsonFileContributionReceiptStore(root);
      const { service, transport } = makeService({ receipts });
      const plan = await service.plan(issueInput());
      await service.apply({
        plan,
        actor: 'person:reviewer',
        transitionToken: 'transition-durable-0001',
        confirmationToken: 'confirmation-durable-0001',
      });
      const receiptText = readFileSync(join(root, readdirSync(root).find((name) => name.endsWith('.json'))!), 'utf8');
      assert.doesNotMatch(receiptText, /transition-durable|confirmation-durable|github_pat_|Administrator/);
      const secondService = makeService({
        transport,
        receipts: new JsonFileContributionReceiptStore(root),
      }).service;
      const replay = await secondService.apply({
        plan,
        actor: 'person:reviewer',
        transitionToken: 'transition-durable-0002',
        confirmationToken: 'confirmation-durable-0002',
      });
      assert.equal(replay.status, 'applied');
      assert.equal(replay.replayed, true);
      assert.equal(transport.issueCalls, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('gates draft PR behind isolated passing patch and separate push/create/ready confirmations', async () => {
    const { service, transport, confirmation } = makeService();
    const plan = await service.plan(pullRequestInput());
    assert.equal(plan.pullRequest?.draft, true);
    assert.equal(plan.pullRequest?.isolation, 'isolated');

    await assert.rejects(
      () => service.apply({
        plan,
        action: 'create_draft_pull_request',
        actor: 'person:reviewer',
        transitionToken: 'transition-pr-create-early',
        confirmationToken: 'confirmation-pr-create-early',
      }),
      (error: unknown) =>
        error instanceof ContributionError && error.code === 'CONFIRMATION_REQUIRED',
    );

    await service.apply({
      plan,
      action: 'push_branch',
      actor: 'person:reviewer',
      transitionToken: 'transition-pr-push-0001',
      confirmationToken: 'confirmation-pr-push-0001',
    });
    const draft = await service.apply({
      plan,
      action: 'create_draft_pull_request',
      actor: 'person:reviewer',
      transitionToken: 'transition-pr-create-0001',
      confirmationToken: 'confirmation-pr-create-0001',
    });
    assert.equal(draft.status, 'applied');
    await service.apply({
      plan,
      action: 'mark_ready_for_review',
      actor: 'person:reviewer',
      transitionToken: 'transition-pr-ready-0001',
      confirmationToken: 'confirmation-pr-ready-0001',
      pullRequestId: '31',
      expectedPullRequestRevision: 'pr-rev-1',
    });

    assert.equal(transport.pushCalls, 1);
    assert.equal(transport.pullRequestCalls, 1);
    assert.equal(transport.readyCalls, 1);
    assert.deepEqual(confirmation.calls, [
      'create_draft_pull_request',
      'push_branch',
      'create_draft_pull_request',
      'mark_ready_for_review',
    ]);
  });

  test('offers Issue fallback when tests fail and excludes generated files by policy', async () => {
    const failedTests: RegressionTestEvidence[] = [{
      command: 'bun test src/fix.test.ts',
      status: 'failed',
      exitCode: 1,
      outputDigest: digest('failed-test'),
      summary: 'regression failed',
    }];
    await assert.rejects(
      () => makeService({ tests: failedTests }).service.plan(pullRequestInput()),
      (error: unknown) =>
        error instanceof ContributionError
        && error.code === 'PR_UNAVAILABLE'
        && error.data?.fallback === 'submit_issue',
    );
    const patch: PreparedIsolatedPatch = {
      ...(makeService().service as unknown as { patch?: PreparedIsolatedPatch }).patch!,
      artifactId: 'patch:generated',
      artifactDigest: digest('generated'),
      isolation: 'isolated',
      baseRef: 'main',
      baseSha: BASE_SHA,
      headRef: 'fix/verified',
      headSha: HEAD_SHA,
      changedFiles: [{ path: 'mcp-server/bundle.js', generated: true }],
      diffSummary: 'Generated bundle changed.',
      diffDigest: digest('generated-diff'),
      diffBytes: 200,
    };
    await assert.rejects(
      () => makeService({ patch }).service.plan(pullRequestInput()),
      (error: unknown) =>
        error instanceof ContributionError && error.code === 'PR_UNAVAILABLE',
    );
  });

  test('rejects mutated fingerprints and cancellation performs no remote mutation', async () => {
    const { service, transport, confirmation } = makeService();
    const plan = await service.plan(issueInput());
    await assert.rejects(
      () => service.apply({
        plan: { ...plan, warnings: ['mutated after preview'] } as ForgeExecutionPlanProjection,
        actor: 'person:reviewer',
        transitionToken: 'transition-mutated-0001',
        confirmationToken: 'confirmation-mutated-0001',
      }),
      (error: unknown) =>
        error instanceof ContributionError && error.code === 'STALE_PLAN',
    );
    const cancelled = await service.apply({
      plan,
      actor: 'person:reviewer',
      cancelled: true,
    });
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(transport.issueCalls, 0);
    assert.deepEqual(confirmation.calls, []);
  });

  test('refuses apply when the canonical Problem Intake binding cannot be verified', async () => {
    const { service, transport, confirmation } = makeService({
      canonicalBinding: {
        async verify() {
          throw new ContributionError('STALE_PLAN', 'canonical plan was replaced');
        },
      },
    });
    const plan = await service.plan(issueInput());
    await assert.rejects(
      () => service.apply({
        plan,
        actor: 'person:reviewer',
        transitionToken: 'transition-binding-0001',
        confirmationToken: 'confirmation-binding-0001',
      }),
      (error: unknown) =>
        error instanceof ContributionError && error.code === 'STALE_PLAN',
    );
    assert.equal(transport.issueCalls, 0);
    assert.deepEqual(confirmation.calls, []);
  });
});
