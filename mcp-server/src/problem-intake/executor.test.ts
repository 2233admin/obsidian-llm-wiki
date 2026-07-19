import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  canonicalDigest,
  InMemoryProblemIntake,
  type ProblemReport,
} from '../../../packages/problem-intake/dist/src/index.js';
import type {
  GovernedContributionPort,
  ProblemIntakeDependencies,
  ProjectOperationPort,
} from './contracts.js';
import { ProblemIntakeExecutor } from './executor.js';
import { InMemoryLocalIssueReceiptStore } from './in-memory-store.js';

function report(overrides: Partial<ProblemReport> = {}): ProblemReport {
  return {
    schemaVersion: 1,
    projectId: 'project/alpha',
    provider: { id: 'obc', kind: 'obc', version: '1.0' },
    ruleId: 'broken-certain',
    subject: { kind: 'vault_path', canonicalRef: 'Notes/source.md' },
    severity: 'error',
    summary: 'Target not found',
    evidenceRefs: [
      { kind: 'vault_path', ref: 'Notes/source.md', summary: 'Line 4' },
      { kind: 'provider_finding', ref: 'obc/link_1', summary: '[[Missing]]' },
    ],
    observedAt: '2026-07-19T01:00:00.000Z',
    ...overrides,
  };
}

function contributionPort(
  overrides: Partial<GovernedContributionPort> = {},
): GovernedContributionPort {
  return {
    async inspect(input) {
      return {
        available: true,
        target: {
          provider: 'github',
          repository: input.repository,
          baseRevision: 'abcdef1',
        },
        settingsSnapshotFingerprint: canonicalDigest({ settings: 1 }),
        remoteHeadFingerprint: canonicalDigest({ head: 'abcdef1' }),
        executionProjection: {
          schemaVersion: 1,
          kind: 'forge_execution_v1',
          repositoryMappingFingerprint: canonicalDigest({
            repository: input.repository,
          }),
          preflightFingerprint: canonicalDigest({
            choice: input.choice,
            head: 'abcdef1',
          }),
          reviewedLocalWorkFingerprint: canonicalDigest({
            observation: input.observation.id,
          }),
          pullRequestArtifactFingerprint: input.choice === 'prepare_pull_request'
            ? canonicalDigest({ head: 'abcdef2' })
            : null,
        },
        ...(input.choice === 'prepare_pull_request'
          ? {
              patch: {
                baseRevision: 'abcdef1',
                headRevision: 'abcdef2',
                branchTarget: 'llmwiki/fix-broken-link',
                diffSummary: 'Bounded link fix',
                changedPaths: ['Notes/source.md'],
                tests: [{ command: 'bun test', status: 'passed' as const, summary: 'All pass' }],
                draft: true as const,
              },
            }
          : {}),
      };
    },
    async apply() {
      return {
        provider: 'github',
        remoteIdentity: 'issue-42',
        remoteRevision: '1',
        replayed: false,
      };
    },
    ...overrides,
  };
}

function harness(input: {
  projectOperations?: ProjectOperationPort;
  contribution?: GovernedContributionPort;
} = {}) {
  const domain = new InMemoryProblemIntake();
  const issueReceipts = new InMemoryLocalIssueReceiptStore();
  const projectCalls: Array<{ operation: string; params: Record<string, unknown> }> = [];
  const projectOperations: ProjectOperationPort = input.projectOperations ?? {
    async call(operation, params) {
      projectCalls.push({ operation, params });
      return {
        ok: true,
        entity: 'project/alpha/issue/target-not-found',
        slug: 'target-not-found',
        path: '01-Projects/alpha/issues/target-not-found.md',
      };
    },
  };
  const dependencies: ProblemIntakeDependencies = {
    domain,
    issueReceipts,
    projectOperations,
    contribution: input.contribution,
    clock: { now: () => '2026-07-19T02:00:00.000Z' },
  };
  return {
    domain,
    projectCalls,
    executor: new ProblemIntakeExecutor(dependencies),
  };
}

describe('canonical Problem Intake execution', () => {
  test('delegates observation identity, deduplication and recurrence to the shared domain package', async () => {
    const h = harness();
    const first = await h.executor.observe(report());
    const second = await h.executor.observe(report({
      provider: { id: 'obc', kind: 'obc', version: '1.1' },
      observedAt: '2026-07-19T03:00:00.000Z',
    }));

    assert.equal(first.deduplicated, false);
    assert.equal(second.deduplicated, true);
    assert.equal(second.observation.id, first.observation.id);
    assert.equal(second.observation.occurrence.count, 2);
    assert.deepEqual(second.observation.occurrence.providerVersions, ['1.0', '1.1']);
  });

  test('uses the domain lifecycle state machine and token replay semantics', async () => {
    const h = harness();
    const observed = await h.executor.observe(report());
    const request = {
      projectId: 'project/alpha',
      observationId: observed.observation.id,
      action: 'dismiss',
      actor: 'person:alice',
      reason: 'Reviewed false positive',
      expectedRevision: 1,
      transitionToken: 'dismiss-token',
    };
    const first = await h.executor.lifecycleApply(request);
    const replay = await h.executor.lifecycleApply(request);

    assert.equal(first.observation.lifecycle, 'dismissed');
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    await assert.rejects(
      () => h.executor.lifecycleApply({ ...request, action: 'resolve' }),
      /already used/,
    );
  });

  test('records verification, replays an identical immediate request, and fails closed on unsafe evidence', async () => {
    const h = harness();
    const observed = await h.executor.observe(report());
    const request = {
      projectId: 'project/alpha',
      observationId: observed.observation.id,
      expectedRevision: observed.observation.revision,
      status: 'not_reproduced',
      actor: 'person:alice',
      providerVersion: '1.1',
      evidenceRefs: [{
        kind: 'provider_finding',
        ref: 'obc/link_1/pass',
        summary: 'OBC no longer reproduces the broken link',
      }],
    };
    const first = await h.executor.verificationApply(request);
    const replay = await h.executor.verificationApply(request);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.observation.revision, first.observation.revision);
    assert.equal(replay.observation.lifecycle, 'untriaged');
    assert.equal(replay.observation.verificationHistory.length, 1);

    const failed = await h.executor.verificationApply({
      ...request,
      expectedRevision: first.observation.revision,
      status: 'provider_failed',
      providerVersion: '1.2',
      evidenceRefs: [{
        kind: 'provider_finding',
        ref: 'obc/run_2',
        summary: 'Provider timed out before producing a trusted report',
      }],
    });
    assert.equal(failed.observation.verificationHistory.at(-1)?.status, 'provider_failed');
    const revisionBeforeUnsafe = failed.observation.revision;
    await assert.rejects(
      () => h.executor.verificationApply({
        ...request,
        expectedRevision: revisionBeforeUnsafe,
        status: 'provider_failed',
        evidenceRefs: [{
          kind: 'provider_finding',
          ref: 'obc/run_3',
          summary: 'Authorization: Bearer should-never-persist',
        }],
      }),
      /credential-like material/,
    );
    assert.equal(h.domain.get(observed.observation.id).revision, revisionBeforeUnsafe);
  });

  test('rejects cross-Project verification before persistence', async () => {
    const h = harness();
    const observed = await h.executor.observe(report());
    await assert.rejects(
      () => h.executor.verificationApply({
        projectId: 'project/beta',
        observationId: observed.observation.id,
        expectedRevision: observed.observation.revision,
        status: 'reproduced',
        actor: 'person:alice',
        providerVersion: '1.1',
        evidenceRefs: [{
          kind: 'provider_finding',
          ref: 'obc/link_1',
          summary: 'Still reproduced',
        }],
      }),
      /not found in project\/beta/,
    );
    assert.equal(h.domain.get(observed.observation.id).verificationHistory.length, 0);
  });

  test('creates a canonical Issue Change Plan and invokes only project.issue.create on apply', async () => {
    const h = harness();
    const observed = await h.executor.observe(report());
    const plan = await h.executor.issuePlan({
      projectId: 'project/alpha',
      observationId: observed.observation.id,
      actor: 'person:alice',
    });
    assert.equal(h.projectCalls.length, 0);
    assert.equal(plan.operation, 'project.issue.create');

    const request = {
      plan,
      presentedFingerprint: plan.fingerprint,
      actor: 'person:alice',
      transitionToken: 'issue-token',
    };
    const first = await h.executor.issueApply(request);
    const replay = await h.executor.issueApply(request);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(h.projectCalls.length, 1);
    assert.equal(h.projectCalls[0]?.operation, 'project.issue.create');
    assert.equal(first.observation.linkedIssue, 'project/alpha/issue/target-not-found');
  });

  test('plans a comment instead of duplicate issue creation when an issue is selected', async () => {
    const h = harness();
    const observed = await h.executor.observe(report());
    const plan = await h.executor.issuePlan({
      projectId: 'project/alpha',
      observationId: observed.observation.id,
      actor: 'person:alice',
      existingIssue: 'project/alpha/issue/already-tracked',
    });
    assert.equal(plan.action, 'comment');
    assert.equal(plan.operation, 'project.comment.add');
  });

  test('blocks blind Work-OS retries after outcome-unknown', async () => {
    let calls = 0;
    const h = harness({
      projectOperations: {
        async call() {
          calls += 1;
          throw new Error('response lost after possible write');
        },
      },
    });
    const observed = await h.executor.observe(report());
    const plan = await h.executor.issuePlan({
      projectId: 'project/alpha',
      observationId: observed.observation.id,
      actor: 'person:alice',
    });
    const request = {
      plan,
      presentedFingerprint: plan.fingerprint,
      actor: 'person:alice',
      transitionToken: 'unknown-issue-token',
    };
    await assert.rejects(() => h.executor.issueApply(request), /automatic retry is blocked/);
    await assert.rejects(() => h.executor.issueApply(request), /outcome-unknown/);
    assert.equal(calls, 1);
  });

  test('local_only retains no remote intent and invokes no contribution adapter', async () => {
    let inspected = 0;
    let applied = 0;
    const port = contributionPort({
      async inspect(input) {
        inspected += 1;
        return contributionPort().inspect(input);
      },
      async apply(plan, approval) {
        applied += 1;
        return contributionPort().apply(plan, approval);
      },
    });
    const h = harness({ contribution: port });
    const observed = await h.executor.observe(report());
    const planned = await h.executor.contributionPlan({
      projectId: 'project/alpha',
      observationId: observed.observation.id,
      choice: 'local_only',
      actor: 'person:alice',
    });
    assert.equal(planned.available, true);
    assert.equal(planned.available && planned.plan.target, null);
    const result = await h.executor.contributionApply({
      plan: planned.available && planned.plan,
      presentedFingerprint: planned.available && planned.plan.fingerprint,
      approved: false,
      actor: 'person:alice',
      workRunId: 'ignored',
      approvalToken: 'ignored',
      transitionToken: 'ignored',
    });
    assert.equal(result.localOnly, true);
    assert.equal(inspected, 0);
    assert.equal(applied, 0);
  });

  test('requires approval and replays a remote Issue without a second provider mutation', async () => {
    let calls = 0;
    let completed = false;
    const approvals: Array<Record<string, unknown>> = [];
    const h = harness({
      contribution: contributionPort({
        async apply(_plan, approval) {
          approvals.push(structuredClone(approval));
          if (!completed) calls += 1;
          const replayed = completed;
          completed = true;
          return {
            provider: 'github',
            remoteIdentity: 'issue-42',
            remoteRevision: '1',
            replayed,
            receipt: { status: 'success', action: 'create_issue' },
          };
        },
      }),
    });
    const observed = await h.executor.observe(report());
    const planned = await h.executor.contributionPlan({
      projectId: 'project/alpha',
      observationId: observed.observation.id,
      choice: 'submit_issue',
      actor: 'person:alice',
      repository: 'example/repo',
      title: 'OBC broken link',
      body: 'Bounded redacted report.',
    });
    assert.equal(planned.available, true);
    if (!planned.available) return;
    const request = {
      plan: planned.plan,
      presentedFingerprint: planned.plan.fingerprint,
      approved: true,
      actor: 'person:alice',
      workRunId: 'work-run/alpha-42',
      approvalToken: 'approval-42',
      transitionToken: 'remote-issue-token',
      action: 'create_issue' as const,
    };
    await assert.rejects(
      () => h.executor.contributionApply({ ...request, approved: false }),
      /explicit per-run approval/,
    );
    const first = await h.executor.contributionApply(request);
    const replay = await h.executor.contributionApply(request);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(calls, 1);
    assert.equal(approvals[0]?.action, 'create_issue');
    assert.deepEqual(first.observation.linkedContributions, [planned.plan.id]);
  });

  test('returns submit_issue fallback when no verified PR patch is available', async () => {
    const h = harness({
      contribution: contributionPort({
        async inspect(input) {
          const ready = await contributionPort().inspect(input);
          return {
            ...ready,
            available: false,
            unavailableReason: 'Regression tests failed',
            patch: undefined,
          };
        },
      }),
    });
    const observed = await h.executor.observe(report());
    const planned = await h.executor.contributionPlan({
      projectId: 'project/alpha',
      observationId: observed.observation.id,
      choice: 'prepare_pull_request',
      actor: 'person:alice',
      repository: 'example/repo',
    });
    assert.equal(planned.available, false);
    assert.equal(!planned.available && planned.fallback, 'submit_issue');
  });

  test('blocks external retry when provider outcome is unknown', async () => {
    let calls = 0;
    let outcomeUnknown = false;
    const h = harness({
      contribution: contributionPort({
        async apply() {
          if (!outcomeUnknown) {
            calls += 1;
            outcomeUnknown = true;
            throw new Error('provider response lost');
          }
          throw new Error('forge receipt outcome-unknown blocks replay');
        },
      }),
    });
    const observed = await h.executor.observe(report());
    const planned = await h.executor.contributionPlan({
      projectId: 'project/alpha',
      observationId: observed.observation.id,
      choice: 'submit_issue',
      actor: 'person:alice',
      repository: 'example/repo',
    });
    assert.equal(planned.available, true);
    if (!planned.available) return;
    const request = {
      plan: planned.plan,
      presentedFingerprint: planned.plan.fingerprint,
      approved: true,
      actor: 'person:alice',
      workRunId: 'work-run/alpha-43',
      approvalToken: 'approval-43',
      transitionToken: 'unknown-remote-token',
    };
    await assert.rejects(() => h.executor.contributionApply(request), /provider response lost/);
    await assert.rejects(() => h.executor.contributionApply(request), /outcome-unknown/);
    assert.equal(calls, 1);
  });
});
