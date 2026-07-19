import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  InMemoryProblemIntake,
  InMemoryProblemObservationRepository,
  ProblemIntakeError,
} from "../src/index.js";
import { reportFixture } from "./helpers.js";

describe("deduplication, recurrence, lifecycle, and verification", () => {
  test("deduplicates recurrence while preserving provider versions and occurrence facts", () => {
    const service = new InMemoryProblemIntake();
    const first = service.ingest(reportFixture());
    const second = service.ingest({
      ...reportFixture(),
      provider: { ...reportFixture().provider, version: "1.5.0" },
      observedAt: "2026-07-19T09:00:00.000Z",
    });
    assert.equal(first.deduplicated, false);
    assert.equal(second.deduplicated, true);
    assert.equal(second.observation.id, first.observation.id);
    assert.equal(second.observation.occurrence.count, 2);
    assert.deepEqual(second.observation.occurrence.providerVersions, ["1.4.0", "1.5.0"]);
    assert.equal(service.list("project/obsidian-llm-wiki").length, 1);
  });

  test("meaningfully changed evidence creates a distinct observation", () => {
    const service = new InMemoryProblemIntake();
    const first = service.ingest(reportFixture()).observation;
    const other = service.ingest({
      ...reportFixture(),
      evidenceRefs: [{ kind: "provider_finding", ref: "obc:broken-wikilink:other" }],
    }).observation;
    assert.notEqual(first.observationFingerprint, other.observationFingerprint);
    assert.equal(service.list().length, 2);
  });

  test("keeps identical fingerprints isolated across canonical Projects", () => {
    const service = new InMemoryProblemIntake();
    const first = service.ingest(reportFixture()).observation;
    const other = service.ingest({
      ...reportFixture(),
      projectId: "project/other",
    }).observation;
    assert.equal(first.observationFingerprint, other.observationFingerprint);
    assert.notEqual(first.id, other.id);
    assert.equal(service.list().length, 2);
  });

  test("dismisses and reopens with optimistic revision and replay-safe tokens", () => {
    const service = new InMemoryProblemIntake();
    const observed = service.ingest(reportFixture()).observation;
    const request = {
      observationId: observed.id,
      expectedRevision: observed.revision,
      to: "dismissed" as const,
      actor: "person:alice",
      reason: "Reviewed false positive.",
      at: "2026-07-19T10:00:00.000Z",
      transitionToken: "dismiss-once",
    };
    const dismissed = service.transition(request);
    const replay = service.transition(request);
    assert.equal(dismissed.observation.lifecycle, "dismissed");
    assert.equal(replay.replayed, true);
    assert.equal(replay.observation.revision, dismissed.observation.revision);

    const reopened = service.transition({
      observationId: observed.id,
      expectedRevision: dismissed.observation.revision,
      to: "untriaged",
      actor: "person:alice",
      reason: "Provider evidence changed after review.",
      at: "2026-07-19T11:00:00.000Z",
      transitionToken: "reopen-once",
    });
    assert.equal(reopened.observation.lifecycle, "untriaged");
    assert.equal(reopened.observation.lifecycleHistory.length, 2);
  });

  test("fails closed on stale revision, invalid transitions, and token reuse", () => {
    const service = new InMemoryProblemIntake();
    const observed = service.ingest(reportFixture()).observation;
    service.transition({
      observationId: observed.id,
      expectedRevision: 1,
      to: "acknowledged",
      actor: "person:alice",
      reason: "Reviewed.",
      at: "2026-07-19T10:00:00.000Z",
      transitionToken: "shared",
    });
    assert.throws(
      () => service.transition({
        observationId: observed.id,
        expectedRevision: 1,
        to: "resolved",
        actor: "person:alice",
        reason: "Stale.",
        at: "2026-07-19T10:01:00.000Z",
        transitionToken: "other",
      }),
      (error) => error instanceof ProblemIntakeError && error.code === "REVISION_CONFLICT",
    );
    assert.throws(
      () => service.transition({
        observationId: observed.id,
        expectedRevision: 2,
        to: "untriaged",
        actor: "person:alice",
        reason: "Invalid from acknowledged.",
        at: "2026-07-19T10:02:00.000Z",
        transitionToken: "invalid",
      }),
      (error) => error instanceof ProblemIntakeError && error.code === "INVALID_TRANSITION",
    );
    assert.throws(
      () => service.transition({
        observationId: observed.id,
        expectedRevision: 2,
        to: "dismissed",
        actor: "person:bob",
        reason: "Different use.",
        at: "2026-07-19T10:03:00.000Z",
        transitionToken: "shared",
      }),
      (error) => error instanceof ProblemIntakeError && error.code === "TRANSITION_TOKEN_REUSED",
    );
  });

  test("verification does not auto-close observation or linked Work-OS issue", () => {
    const service = new InMemoryProblemIntake();
    const observed = service.ingest(reportFixture()).observation;
    const linked = service.linkIssue({
      observationId: observed.id,
      expectedRevision: observed.revision,
      issueEntity: "project/obsidian-llm-wiki/issue/repair-link",
    });
    const verified = service.verify({
      observationId: linked.id,
      expectedRevision: linked.revision,
      status: "not_reproduced",
      verifiedAt: "2026-07-19T12:00:00.000Z",
      actor: "agent:obc",
      providerVersion: "1.5.0",
      evidenceRefs: [{ kind: "provider_finding", ref: "obc:pass:repair-link" }],
    });
    assert.equal(verified.lifecycle, "untriaged");
    assert.equal(verified.linkedIssue, "project/obsidian-llm-wiki/issue/repair-link");
    assert.equal(verified.verificationHistory[0]?.status, "not_reproduced");
  });

  test("bounds reference persistence capacity", () => {
    const service = new InMemoryProblemIntake(
      new InMemoryProblemObservationRepository({ capacity: 1 }),
    );
    service.ingest(reportFixture());
    assert.throws(
      () => service.ingest({
        ...reportFixture(),
        ruleId: "another-rule",
      }),
      (error) => error instanceof ProblemIntakeError && error.code === "BOUNDS_EXCEEDED",
    );
  });

  test("reference persistence rejects revision rollback and same-revision drift", () => {
    const repository = new InMemoryProblemObservationRepository();
    const service = new InMemoryProblemIntake(repository);
    const first = service.ingest(reportFixture()).observation;
    const second = service.ingest({
      ...reportFixture(),
      observedAt: "2026-07-19T09:00:00.000Z",
    }).observation;
    assert.throws(
      () => repository.save(first),
      (error) => error instanceof ProblemIntakeError && error.code === "REVISION_CONFLICT",
    );
    assert.throws(
      () => repository.save({
        ...second,
        linkedIssue: "project/obsidian-llm-wiki/issue/same-revision-drift",
      }),
      (error) => error instanceof ProblemIntakeError && error.code === "REVISION_CONFLICT",
    );
  });
});
