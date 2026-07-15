import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  dreamTimeCadenceIdentity,
  resolveDreamTimeCadenceWindow,
} from "../src/index.js";

describe("Dream Time cadence", () => {
  test("maps daily, weekly, and monthly UTC windows to the linear memory lifecycle", () => {
    assert.deepEqual(resolveDreamTimeCadenceWindow("daily", "2026-07-15T13:45:00.000Z"), {
      cadence: "daily",
      operation: "checkpoint",
      periodKey: "2026-07-15",
      startsAt: "2026-07-15T00:00:00.000Z",
      endsAt: "2026-07-16T00:00:00.000Z",
      dueAt: "2026-07-15T00:00:00.000Z",
    });
    assert.deepEqual(resolveDreamTimeCadenceWindow("weekly", "2026-07-15T13:45:00.000Z"), {
      cadence: "weekly",
      operation: "learn",
      periodKey: "2026-07-13",
      startsAt: "2026-07-13T00:00:00.000Z",
      endsAt: "2026-07-20T00:00:00.000Z",
      dueAt: "2026-07-13T00:00:00.000Z",
    });
    assert.deepEqual(resolveDreamTimeCadenceWindow("monthly", "2026-07-15T13:45:00.000Z"), {
      cadence: "monthly",
      operation: "review",
      periodKey: "2026-07",
      startsAt: "2026-07-01T00:00:00.000Z",
      endsAt: "2026-08-01T00:00:00.000Z",
      dueAt: "2026-07-01T00:00:00.000Z",
    });
  });

  test("uses Monday UTC for weekly windows across year boundaries", () => {
    assert.deepEqual(resolveDreamTimeCadenceWindow("weekly", "2027-01-01T00:00:00.000Z"), {
      cadence: "weekly",
      operation: "learn",
      periodKey: "2026-12-28",
      startsAt: "2026-12-28T00:00:00.000Z",
      endsAt: "2027-01-04T00:00:00.000Z",
      dueAt: "2026-12-28T00:00:00.000Z",
    });
  });

  test("derives stable per-Project identities and rejects non-canonical timestamps", () => {
    const window = resolveDreamTimeCadenceWindow("daily", "2026-07-15T00:00:00.000Z");
    const first = dreamTimeCadenceIdentity("project/alpha", "agent/researcher", window);
    const replay = dreamTimeCadenceIdentity("project/alpha", "agent/researcher", window);
    const otherProject = dreamTimeCadenceIdentity("project/beta", "agent/researcher", window);

    assert.deepEqual(replay, first);
    assert.notEqual(otherProject.invocationId, first.invocationId);
    assert.match(first.invocationId, /^dreamtime-cadence\/daily-2026-07-15-[a-f0-9]{24}$/);
    assert.match(first.proposalId, /^memory-proposal\/cadence-daily-2026-07-15-[a-f0-9]{24}$/);
    assert.match(first.agentId, /^dreamtime-daily-[a-f0-9]{24}$/);
    assert.match(first.transitionToken, /^dreamtime-cadence-daily-2026-07-15-[a-f0-9]{24}$/);
    assert.throws(
      () => resolveDreamTimeCadenceWindow("daily", "2026-07-15T08:00:00+08:00"),
      /canonical UTC RFC3339/,
    );
  });
});
