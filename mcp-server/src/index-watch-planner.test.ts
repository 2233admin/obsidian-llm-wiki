import { test } from "node:test";
import assert from "node:assert/strict";
import { IndexWatchPlanner } from "./index-watch-planner.js";

test("IndexWatchPlanner returns only paths outside the quiet window", () => {
  const planner = new IndexWatchPlanner({ debounceMs: 100 });
  planner.record("b.md", 0);
  planner.record("a.md", 50);
  planner.record("b.md", 80);

  assert.deepEqual(planner.due(150), ["a.md"]);
  assert.deepEqual(planner.due(180), ["a.md", "b.md"]);
  assert.equal(planner.pendingCount, 2);
});

test("IndexWatchPlanner take removes due paths but keeps newer events pending", () => {
  const planner = new IndexWatchPlanner({ debounceMs: 100 });
  planner.record("old.md", 0);
  planner.record("new.md", 90);

  assert.deepEqual(planner.take(100), ["old.md"]);
  assert.deepEqual(planner.take(189), []);
  assert.deepEqual(planner.take(190), ["new.md"]);
  assert.equal(planner.pendingCount, 0);
});

test("IndexWatchPlanner reports the earliest next flush time", () => {
  const planner = new IndexWatchPlanner({ debounceMs: 250 });
  assert.equal(planner.nextDueAt(), null);
  planner.record("note.md", 1000);
  assert.equal(planner.nextDueAt(), 1250);
});

test("IndexWatchPlanner rejects invalid debounce windows", () => {
  assert.throws(() => new IndexWatchPlanner({ debounceMs: -1 }), /non-negative/);
  assert.throws(() => new IndexWatchPlanner({ debounceMs: Number.NaN }), /finite/);
});
