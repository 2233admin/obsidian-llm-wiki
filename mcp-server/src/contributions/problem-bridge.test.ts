import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  InMemoryProblemIntake,
  type ProblemReport,
} from '../../../packages/problem-intake/dist/src/index.js';
import type { ProjectContext } from '../project/project-context.js';
import { ProblemIntakeExecutor } from '../problem-intake/executor.js';
import { InMemoryLocalIssueReceiptStore } from '../problem-intake/in-memory-store.js';
import type {
  ConfirmationRequest,
  ContributionTransport,
  PreparedIsolatedPatch,
  RegressionTestEvidence,
  RepositoryPreflightFacts,
} from './contracts.js';
import { ContributionError } from './errors.js';
import { sha256 } from './fingerprint.js';
import {
  createProjectContextGovernedContributionPort,
  type GovernedContributionRuntime,
} from './problem-bridge.js';
import { MemoryContributionReceiptStore } from './receipts.js';

const BASE_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);

class FakeProblemTransport implements ContributionTransport {
  readonly provider = 'github';
  issueCreates = 0;
  pushes = 0;
  draftCreates = 0;
  readyTransitions = 0;

  async preflight(): Promise<RepositoryPreflightFacts> {
    return {
      provider: 'github',
      repositoryId: 'repo-1',
      canonicalUrl: 'https://github.com/example/repository',
      defaultBranch: 'main',
      baseRef: 'main',
      baseSha: BASE_SHA,
      revision: 'repo-rev-1',
      health: 'available',
      permissions: {
        issuesWrite: true,
        pushBranch: true,
        createPullRequest: true,
        markReadyForReview: true,
      },
      capturedAt: '2026-07-19T00:00:00.000Z',
      warnings: [],
    };
  }

  async preflightPushTarget() {
    return {
      provider: 'github',
      repositoryId: 'repo-1',
      owner: 'example',
      repository: 'repository',
      canonicalUrl: 'https://github.com/example/repository',
      revision: 'repo-rev-1',
      canPush: true,
      capturedAt: '2026-07-19T00:00:00.000Z',
    };
  }

  async createIssue() {
    this.issueCreates += 1;
    return {
      remoteId: '17',
      revision: 'issue-rev-1',
      url: 'https://github.com/example/repository/issues/17',
    };
  }

  async pushBranch() {
    this.pushes += 1;
    return {
      remoteId: 'example/repository:fix/problem',
      revision: HEAD_SHA,
      url: 'https://github.com/example/repository/tree/fix/problem',
    };
  }

  async createDraftPullRequest() {
    this.draftCreates += 1;
    return {
      remoteId: '31',
      revision: 'pr-rev-1',
      url: 'https://github.com/example/repository/pull/31',
    };
  }

  async markReadyForReview() {
    this.readyTransitions += 1;
    return {
      remoteId: '31',
      revision: 'pr-rev-2',
      url: 'https://github.com/example/repository/pull/31',
    };
  }
}

function context(): ProjectContext {
  return {
    projectId: 'project/example',
    slug: 'example',
    lifecycle: 'active',
    aliases: [],
    roots: {
      registry: 'Projects',
      registryRecord: 'Projects/example.md',
      workOs: '01-Projects/example',
      knowledge: '10-Projects/example',
      runtime: '.vault-mind',
    },
    workspace: { path: 'D:\\explicit\\repository', available: true },
    projections: [{ kind: 'github', target: 'example/repository' }],
    resolvedBy: 'project_id',
    diagnostics: [],
  } as unknown as ProjectContext;
}

function report(ruleId: string): ProblemReport {
  return {
    schemaVersion: 1,
    projectId: 'project/example',
    provider: { id: 'obc', kind: 'obc', version: '1.0.0' },
    ruleId,
    subject: { kind: 'vault_path', canonicalRef: `Notes/${ruleId}.md` },
    severity: 'error',
    summary: `Problem ${ruleId}`,
    evidenceRefs: [{
      kind: 'vault_path',
      ref: `Notes/${ruleId}.md`,
      digest: sha256(ruleId),
      summary: 'Reviewed evidence',
    }],
    observedAt: '2026-07-19T01:00:00.000Z',
  };
}

describe('Problem Intake governed contribution bridge', () => {
  test('runs canonical Issue and staged PR plan/apply with receipts, replay, and exact consent', {
    timeout: 30_000,
  }, async () => {
    const transport = new FakeProblemTransport();
    const prepared: PreparedIsolatedPatch = {
      artifactId: 'artifact:problem',
      artifactDigest: sha256('artifact:problem'),
      isolation: 'isolated',
      baseRef: 'main',
      baseSha: BASE_SHA,
      headRef: 'fix/problem',
      headSha: HEAD_SHA,
      changedFiles: [{ path: 'src/problem.ts', generated: false }],
      diffSummary: '1 file changed',
      diffDigest: sha256('diff'),
      diffBytes: 128,
    };
    const runtime: GovernedContributionRuntime = {
      transport,
      worktree: {
        async prepare() {
          return prepared;
        },
      },
      verifier: {
        async verify(request): Promise<RegressionTestEvidence[]> {
          return request.commands.map((command) => ({
            command,
            status: 'passed',
            exitCode: 0,
            outputDigest: sha256(command),
            summary: 'All tests passed',
          }));
        },
      },
      async dispose() {},
    };
    const approvals = new Map([
      ['approval-issue', 'work-issue'],
      ['approval-push', 'work-push'],
      ['approval-draft', 'work-draft'],
      ['approval-ready', 'work-ready'],
    ]);
    const confirmationCalls: ConfirmationRequest[] = [];
    const port = createProjectContextGovernedContributionPort({
      vaultPath: 'D:\\vault',
      context: context(),
      runtime,
      receipts: new MemoryContributionReceiptStore(),
      confirmation: {
        async verify(request) {
          confirmationCalls.push(request);
          return {
            approved: approvals.has(request.confirmationToken),
            workRunId: approvals.get(request.confirmationToken),
          };
        },
      },
      pullRequestPolicy: {
        prepare() {
          return {
            headRef: 'fix/problem',
            changeSummary: 'Fix reviewed problem',
            allowedPaths: ['src/problem.ts'],
            testCommands: ['bun test'],
            generatedFilePolicy: 'exclude',
          };
        },
      },
      now: () => '2026-07-19T02:00:00.000Z',
    });
    const domain = new InMemoryProblemIntake();
    const executor = new ProblemIntakeExecutor({
      domain,
      issueReceipts: new InMemoryLocalIssueReceiptStore(),
      projectOperations: {
        async call() {
          return {};
        },
      },
      contribution: port,
      clock: { now: () => '2026-07-19T02:00:00.000Z' },
    });

    const localObservation = (await executor.observe(report('local-case'))).observation;
    const unlinkedIssue = await port.inspect({
      choice: 'submit_issue',
      projectId: 'project/example',
      repository: '',
      observation: localObservation,
    });
    assert.equal(unlinkedIssue.available, false);
    assert.match(unlinkedIssue.unavailableReason ?? '', /Work-OS issue/i);
    await assert.rejects(
      port.inspect({
        choice: 'submit_issue',
        projectId: 'project/example',
        repository: 'https://github.com/example/repository',
        observation: localObservation,
      }),
      (error: unknown) =>
        error instanceof ContributionError && error.code === 'INVALID_INPUT',
    );
    const localPlanResult = await executor.contributionPlan({
      projectId: 'project/example',
      observationId: localObservation.id,
      choice: 'local_only',
      actor: 'alice',
    });
    assert.equal(localPlanResult.available, true);
    if (!localPlanResult.available) throw new Error('Local plan unavailable');
    const localApplied = await executor.contributionApply({
      plan: localPlanResult.plan,
      presentedFingerprint: localPlanResult.plan.fingerprint,
      approved: false,
      actor: 'alice',
    });
    assert.equal(localApplied.localOnly, true);
    assert.equal(transport.issueCreates + transport.pushes, 0);
    assert.equal(confirmationCalls.length, 0);

    const issueObserved = (await executor.observe(report('issue-case'))).observation;
    const issueObservation = domain.linkIssue({
      observationId: issueObserved.id,
      expectedRevision: issueObserved.revision,
      issueEntity: 'project/example/issue/issue-case',
    });
    const issuePlanResult = await executor.contributionPlan({
      projectId: 'project/example',
      observationId: issueObservation.id,
      choice: 'submit_issue',
      actor: 'alice',
      repository: port.repositorySelection,
      title: 'Reviewed Issue',
      body: 'Reviewed Issue body',
      labels: ['bug'],
    });
    assert.equal(issuePlanResult.available, true);
    if (!issuePlanResult.available) throw new Error('Issue plan unavailable');
    const issuePlan = issuePlanResult.plan;

    await assert.rejects(
      executor.contributionApply({
        plan: issuePlan,
        presentedFingerprint: issuePlan.fingerprint,
        approved: true,
        actor: 'alice',
        workRunId: 'wrong-work-run',
        approvalToken: 'approval-issue',
        transitionToken: 'transition-issue',
        action: 'create_issue',
      }),
      (error: unknown) =>
        error instanceof ContributionError && error.code === 'CONFIRMATION_REQUIRED',
    );
    assert.equal(transport.issueCreates, 0);

    const issueApplied = await executor.contributionApply({
      plan: issuePlan,
      presentedFingerprint: issuePlan.fingerprint,
      approved: true,
      actor: 'alice',
      workRunId: 'work-issue',
      approvalToken: 'approval-issue',
      transitionToken: 'transition-issue',
      action: 'create_issue',
    });
    assert.equal(issueApplied.replayed, false);
    assert.equal(transport.issueCreates, 1);
    const issueReplay = await executor.contributionApply({
      plan: issuePlan,
      presentedFingerprint: issuePlan.fingerprint,
      approved: true,
      actor: 'alice',
      workRunId: 'work-issue',
      approvalToken: 'approval-issue',
      transitionToken: 'transition-issue',
      action: 'create_issue',
    });
    assert.equal(issueReplay.replayed, true);
    assert.equal(transport.issueCreates, 1);

    const prObserved = (await executor.observe(report('pr-case'))).observation;
    const prObservation = domain.linkIssue({
      observationId: prObserved.id,
      expectedRevision: prObserved.revision,
      issueEntity: 'project/example/issue/pr-case',
    });
    const prPlanResult = await executor.contributionPlan({
      projectId: 'project/example',
      observationId: prObservation.id,
      choice: 'prepare_pull_request',
      actor: 'alice',
      repository: port.repositorySelection,
      title: 'Reviewed PR',
      body: 'Reviewed PR body',
    });
    assert.equal(prPlanResult.available, true);
    if (!prPlanResult.available) throw new Error('PR plan unavailable');
    const prPlan = prPlanResult.plan;

    const pushed = await executor.contributionApply({
      plan: prPlan,
      presentedFingerprint: prPlan.fingerprint,
      approved: true,
      actor: 'alice',
      workRunId: 'work-push',
      approvalToken: 'approval-push',
      transitionToken: 'transition-push',
      action: 'push_branch',
    });
    assert.equal(pushed.replayed, false);
    assert.equal(transport.pushes, 1);

    const draft = await executor.contributionApply({
      plan: prPlan,
      presentedFingerprint: prPlan.fingerprint,
      approved: true,
      actor: 'alice',
      workRunId: 'work-draft',
      approvalToken: 'approval-draft',
      transitionToken: 'transition-draft',
      action: 'create_draft_pull_request',
    });
    assert.equal(draft.result?.remoteIdentity, '31');
    assert.equal(transport.draftCreates, 1);
    const draftReplay = await executor.contributionApply({
      plan: prPlan,
      presentedFingerprint: prPlan.fingerprint,
      approved: true,
      actor: 'alice',
      workRunId: 'work-draft',
      approvalToken: 'approval-draft',
      transitionToken: 'transition-draft',
      action: 'create_draft_pull_request',
    });
    assert.equal(draftReplay.replayed, true);
    assert.equal(transport.draftCreates, 1);

    const ready = await executor.contributionApply({
      plan: prPlan,
      presentedFingerprint: prPlan.fingerprint,
      approved: true,
      actor: 'alice',
      workRunId: 'work-ready',
      approvalToken: 'approval-ready',
      transitionToken: 'transition-ready',
      action: 'mark_ready_for_review',
      pullRequestId: '31',
      expectedPullRequestRevision: 'pr-rev-1',
    });
    assert.equal(ready.result?.remoteRevision, 'pr-rev-2');
    assert.equal(transport.readyTransitions, 1);
    assert.ok(confirmationCalls.every((call) => call.externalSideEffect === true));
    await port.dispose();
  });
});
