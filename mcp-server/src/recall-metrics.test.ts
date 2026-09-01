import assert from "node:assert/strict";
import { test } from "node:test";
import { createRecallTthwRecorder } from "./recall-metrics.js";

test("first-recall timing emits once after the first cited answer", () => {
  const events: Array<{ event: string; elapsedMs: number; citations: number }> = [];
  let now = 1_250;
  const recorder = createRecallTthwRecorder({
    enabled: true,
    startedAtMs: 1_000,
    now: () => now,
    emit: (event) => events.push(event),
  });

  recorder.record(0);
  now = 1_275;
  recorder.record(2);
  now = 1_300;
  recorder.record(3);

  assert.deepEqual(events, [{ event: "recall_first_success", elapsedMs: 275, citations: 2 }]);
});

test("first-recall timing is inert unless enabled", () => {
  const events: unknown[] = [];
  const recorder = createRecallTthwRecorder({ enabled: false, emit: (event) => events.push(event) });
  recorder.record(1);
  assert.deepEqual(events, []);
});
