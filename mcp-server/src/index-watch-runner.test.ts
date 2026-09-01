import { test } from "node:test";
import assert from "node:assert/strict";
import { IndexWatchRunner } from "./index-watch-runner.js";

test("IndexWatchRunner coalesces concurrent flushes into one index pass", async () => {
  let starts = 0;
  let release!: () => void;
  const pass = new Promise<void>((resolve) => { release = resolve; });
  const runner = new IndexWatchRunner({
    index: async () => {
      starts++;
      await pass;
    },
    graceMs: 100,
  });

  const first = runner.flush();
  const second = runner.flush();
  assert.strictEqual(first, second);
  assert.equal(starts, 1);
  release();
  await first;
  assert.equal(runner.isFlushing, false);
});

test("IndexWatchRunner aborts in-flight work and waits within the grace window", async () => {
  let aborted = false;
  let releaseGrace!: () => void;
  const grace = new Promise<void>((resolve) => { releaseGrace = resolve; });
  const runner = new IndexWatchRunner({
    index: async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve();
        }, { once: true });
      });
    },
    graceMs: 100,
    graceWaiter: async () => grace,
  });

  const running = runner.flush();
  const shutdown = runner.shutdown();
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.equal(aborted, true);
  releaseGrace();
  await shutdown;
  await running;
  assert.equal(runner.isStopped, true);
  await runner.flush();
});

test("IndexWatchRunner does not wait when the grace window is disabled", async () => {
  let release!: () => void;
  const runningPass = new Promise<void>((resolve) => { release = resolve; });
  let aborted = false;
  const runner = new IndexWatchRunner({
    index: async (signal) => {
      signal.addEventListener("abort", () => { aborted = true; }, { once: true });
      await runningPass;
    },
    graceMs: 0,
  });

  runner.flush();
  await runner.shutdown();
  assert.equal(aborted, true);
  release();
});
