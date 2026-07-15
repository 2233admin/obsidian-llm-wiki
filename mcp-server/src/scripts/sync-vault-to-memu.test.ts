import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sanitizeForwardedArguments } from "./sync-vault-to-memu.js";

describe("sync-vault-to-memu CLI boundary", () => {
  it("forwards a credential-free public DSN", () => {
    const args = sanitizeForwardedArguments([
      "--vault",
      "D:/vault",
      "--dsn",
      "postgresql://localhost:5432/memu",
      "--dry-run",
    ]);

    assert.deepEqual(args, [
      "--vault",
      "D:/vault",
      "--dsn",
      "postgresql://localhost:5432/memu",
      "--dry-run",
    ]);
  });

  it("rejects credential-bearing DSNs without reflecting their contents", () => {
    const privateDsn = "postgresql://device-user:device-secret@localhost:5432/memu";

    assert.throws(
      () => sanitizeForwardedArguments(["--dsn", privateDsn]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /device-secret|device-user|postgresql:\/\//);
        return true;
      },
    );
    assert.throws(
      () => sanitizeForwardedArguments([`--dsn=${privateDsn}?sslmode=require`]),
      /credential-free PostgreSQL endpoint/,
    );
  });

  it("rejects query and fragment material even without userinfo", () => {
    assert.throws(
      () => sanitizeForwardedArguments([
        "--dsn=postgresql://localhost:5432/memu?password=secret-material",
      ]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /secret-material/);
        return true;
      },
    );
    assert.throws(
      () => sanitizeForwardedArguments([
        "--dsn",
        "postgresql://localhost:5432/memu#secret-material",
      ]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /secret-material/);
        return true;
      },
    );
  });
});
