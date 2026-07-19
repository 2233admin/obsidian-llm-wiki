import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assertExternalContributionPlan,
  assertIssueChangePlan,
  createExternalContributionPlan,
  createIssueChangePlan,
  createProblemDisposition,
  InMemoryProblemIntake,
  ProblemIntakeError,
} from "../src/index.js";
import { reportFixture } from "./helpers.js";

const SHA = `sha256:${"a".repeat(64)}` as const;
const HEAD = `sha256:${"b".repeat(64)}` as const;
const LOCAL = `sha256:${"c".repeat(64)}` as const;
const ARTIFACT = `sha256:${"d".repeat(64)}` as const;

function executionProjection(pullRequest = false) {
  return {
    schemaVersion: 1 as const,
    kind: "forge_execution_v1" as const,
    repositoryMappingFingerprint: SHA,
    preflightFingerprint: HEAD,
    reviewedLocalWorkFingerprint: LOCAL,
    pullRequestArtifactFingerprint: pullRequest ? ARTIFACT : null,
  };
}

function observation() {
  return new InMemoryProblemIntake().ingest(reportFixture()).observation;
}

describe("Work-OS and external contribution planning", () => {
  test("proposes Work-OS create or comment operations without writing issue state", () => {
    const observed = observation();
    const create = createIssueChangePlan({
      observation: observed,
      actor: "person:alice",
    });
    assertIssueChangePlan(create);
    assert.equal(create.action, "create");
    assert.equal(create.operation, "project.issue.create");
    assert.equal(create.existingIssueEntity, null);
    assert.match(create.payload.body, new RegExp(observed.id));

    const comment = createIssueChangePlan({
      observation: observed,
      actor: "person:alice",
      existingIssueEntity: "project/obsidian-llm-wiki/issue/repair-link",
    });
    assert.equal(comment.action, "comment");
    assert.equal(comment.operation, "project.comment.add");
  });

  test("rejects issue-plan tampering and cross-Project issue selection", () => {
    const observed = observation();
    const plan = createIssueChangePlan({ observation: observed, actor: "person:alice" });
    assert.throws(
      () => assertIssueChangePlan({
        ...plan,
        payload: { ...plan.payload, title: "Tampered" },
      }),
      (error) => error instanceof ProblemIntakeError && error.code === "PLAN_TAMPERED",
    );
    assert.throws(
      () => createIssueChangePlan({
        observation: observed,
        actor: "person:alice",
        existingIssueEntity: "project/other/issue/repair-link",
      }),
      (error) => error instanceof ProblemIntakeError && error.code === "INVALID_PROJECT_ID",
    );
  });

  test("local-only plan carries no inferred remote consent", () => {
    const observed = observation();
    const disposition = createProblemDisposition({
      observation: observed,
      choice: "local_only",
      actor: "person:alice",
      selectedAt: "2026-07-19T12:00:00.000Z",
    });
    const plan = createExternalContributionPlan({ observation: observed, disposition });
    assertExternalContributionPlan(plan);
    assert.equal(plan.target, null);
    assert.equal(plan.content, null);
    assert.equal(plan.patch, null);
    assert.throws(
      () => createExternalContributionPlan({
        observation: observed,
        disposition,
        target: { provider: "github", repository: "owner/repo", baseRevision: "abcdef1" },
      }),
      (error) => error instanceof ProblemIntakeError && error.code === "CONSENT_REQUIRED",
    );
  });

  test("redacts secrets and machine paths in exact editable Issue preview", () => {
    const observed = observation();
    const disposition = createProblemDisposition({
      observation: observed,
      choice: "submit_issue",
      actor: "person:alice",
      selectedAt: "2026-07-19T12:00:00.000Z",
    });
    const plan = createExternalContributionPlan({
      observation: observed,
      disposition,
      target: { provider: "github", repository: "2233admin/obsidian-llm-wiki", baseRevision: "abcdef1" },
      title: "Broken link from C:\\Users\\alice\\vault\\note.md",
      body: "Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456\nTrace: /home/alice/vault/log.txt",
      labels: ["bug"],
      executionProjection: executionProjection(),
      settingsSnapshotFingerprint: SHA,
      remoteHeadFingerprint: HEAD,
    });
    assertExternalContributionPlan(plan);
    assert.equal(plan.disposition.choice, "submit_issue");
    assert.match(plan.content?.title ?? "", /\[REDACTED_MACHINE_PATH\]/);
    assert.match(plan.content?.body ?? "", /\[REDACTED_SECRET\]/);
    assert.doesNotMatch(JSON.stringify(plan), /ghp_|C:\\Users|\/home\/alice/);
    assert.deepEqual(plan.redactions, [
      "body:machine-path",
      "body:secret",
      "title:machine-path",
    ]);
  });

  test("requires a bounded draft patch with passing tests for pull requests", () => {
    const observed = observation();
    const disposition = createProblemDisposition({
      observation: observed,
      choice: "prepare_pull_request",
      actor: "person:alice",
      selectedAt: "2026-07-19T12:00:00.000Z",
    });
    assert.throws(
      () => createExternalContributionPlan({
        observation: observed,
        disposition,
        target: { provider: "github", repository: "2233admin/obsidian-llm-wiki", baseRevision: "abcdef1" },
        title: "Fix broken link",
        body: "Verified bounded fix.",
        executionProjection: executionProjection(true),
        settingsSnapshotFingerprint: SHA,
        remoteHeadFingerprint: HEAD,
      }),
      (error) => error instanceof ProblemIntakeError && error.code === "UNVERIFIED_PATCH",
    );
    const plan = createExternalContributionPlan({
      observation: observed,
      disposition,
      target: { provider: "github", repository: "2233admin/obsidian-llm-wiki", baseRevision: "abcdef1" },
      title: "Fix broken link",
      body: "Verified bounded fix.",
      executionProjection: executionProjection(true),
      settingsSnapshotFingerprint: SHA,
      remoteHeadFingerprint: HEAD,
      patch: {
        baseRevision: "abcdef1",
        headRevision: "1234567",
        branchTarget: "fork/alice:fix-link",
        diffSummary: "Repairs one wikilink.",
        changedPaths: ["docs/release.md"],
        tests: [{ command: "bun test", status: "passed", summary: "All targeted tests passed." }],
        draft: true,
      },
    });
    assertExternalContributionPlan(plan);
    assert.equal(plan.patch?.draft, true);
    assert.equal(plan.patch?.tests[0]?.status, "passed");
  });

  test("produces a stable immutable fingerprint for the same reviewed upstream Issue preview", () => {
    const observed = observation();
    const disposition = createProblemDisposition({
      observation: observed,
      choice: "submit_issue",
      actor: "person:alice",
      selectedAt: "2026-07-19T12:00:00.000Z",
    });
    const plan = createExternalContributionPlan({
      observation: observed,
      disposition,
      target: { provider: "github", repository: "2233admin/obsidian-llm-wiki", baseRevision: "abcdef1" },
      title: "Broken link",
      body: "Bounded report.",
      executionProjection: executionProjection(),
      settingsSnapshotFingerprint: SHA,
      remoteHeadFingerprint: HEAD,
    });
    const repeated = createExternalContributionPlan({
      observation: observed,
      disposition,
      target: { provider: "github", repository: "2233admin/obsidian-llm-wiki", baseRevision: "abcdef1" },
      title: "Broken link",
      body: "Bounded report.",
      executionProjection: executionProjection(),
      settingsSnapshotFingerprint: SHA,
      remoteHeadFingerprint: HEAD,
    });
    assert.equal(repeated.fingerprint, plan.fingerprint);
    assert.equal(repeated.id, plan.id);
    assert.equal(Object.isFrozen(plan), true);
  });
});
