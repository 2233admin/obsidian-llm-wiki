import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  InMemoryProblemIntake,
  parseProblemObservation,
  parseProblemReport,
  ProblemIntakeError,
} from "../src/index.js";
import { reportFixture } from "./helpers.js";

describe("strict Problem Intake validation and security", () => {
  test("normalizes one OBC report into a deterministic versioned observation", () => {
    const first = new InMemoryProblemIntake().ingest(reportFixture()).observation;
    const second = new InMemoryProblemIntake().ingest(reportFixture()).observation;
    assert.deepEqual(first, second);
    assert.match(first.id, /^problem\/[a-f0-9]{64}$/);
    assert.match(first.sourceFingerprint, /^sha256:/);
    assert.match(first.observationFingerprint, /^sha256:/);
    assert.equal(first.lifecycle, "untriaged");
    assert.equal(first.occurrence.count, 1);
    assert.equal(Object.isFrozen(first), true);
    assert.deepEqual(parseProblemObservation(first), first);
  });

  test("rejects unknown fields at every validated boundary", () => {
    assert.throws(
      () => parseProblemReport({ ...reportFixture(), rawPayload: "opaque" }),
      /unknown fields/,
    );
    assert.throws(
      () => parseProblemReport({
        ...reportFixture(),
        provider: { ...reportFixture().provider, commandId: "unsafe-command" },
      }),
      /unknown fields/,
    );
  });

  test("rejects credentials and machine-local paths before persistence", () => {
    for (const summary of [
      "Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456",
      "token=sk-abcdefghijklmnopqrstuvwxyz",
      "Trace written to C:\\Users\\alice\\vault\\debug.log",
      "Trace written to /home/alice/vault/debug.log",
    ]) {
      assert.throws(
        () => new InMemoryProblemIntake().ingest({ ...reportFixture(), summary }),
        (error) => error instanceof ProblemIntakeError && error.code === "SENSITIVE_DATA",
      );
    }
  });

  test("rejects machine paths disguised as vault subjects", () => {
    assert.throws(
      () => new InMemoryProblemIntake().ingest({
        ...reportFixture(),
        subject: { kind: "vault_path", canonicalRef: "C:\\Users\\alice\\vault\\note.md" },
      }),
      (error) =>
        error instanceof ProblemIntakeError
        && (error.code === "SENSITIVE_DATA" || error.code === "INVALID_CONTRACT"),
    );
  });

  test("rejects forged identity and observation fingerprints", () => {
    const observation = new InMemoryProblemIntake().ingest(reportFixture()).observation;
    assert.throws(
      () => parseProblemObservation({
        ...observation,
        observationFingerprint: `sha256:${"0".repeat(64)}`,
      }),
      (error) => error instanceof ProblemIntakeError && error.code === "INVALID_FINGERPRINT",
    );
    assert.throws(
      () => parseProblemObservation({ ...observation, extra: true }),
      /unknown fields/,
    );
  });
});
