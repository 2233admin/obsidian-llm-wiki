import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { parseArgs, renderMd, type Args } from "./memu-perf.js";

const SAMPLE_STATS = {
  n: 1,
  p50: 1,
  p95: 1,
  p99: 1,
  mean: 1,
  min: 1,
  max: 1,
};

const ORIGINAL_DSN = process.env.MEMU_DSN;

afterEach(() => {
  if (ORIGINAL_DSN === undefined) delete process.env.MEMU_DSN;
  else process.env.MEMU_DSN = ORIGINAL_DSN;
});

describe("memu-perf private connection boundary", () => {
  it("rejects private DSNs in argv", () => {
    assert.throws(
      () => parseArgs(["--dsn", "postgresql://secret@localhost/db"]),
      /--dsn is forbidden/,
    );
    assert.throws(
      () => parseArgs(["--dsn=postgresql://secret@localhost/db"]),
      /--dsn is forbidden/,
    );
  });

  it("never renders the process-local DSN", () => {
    const secret = "postgresql://private-user:private-password@localhost/db";
    process.env.MEMU_DSN = secret;
    const args: Args = {
      iters: 1,
      query: "note",
      userId: "perf-user",
      jsonOnly: false,
      help: false,
    };

    const output = renderMd(SAMPLE_STATS, SAMPLE_STATS, args);
    assert.doesNotMatch(output, /private-user|private-password|postgresql:\/\//);
    assert.match(output, /configured \(redacted\)/);
  });
});
