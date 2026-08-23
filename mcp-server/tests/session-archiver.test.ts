import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const archiverPath = join(import.meta.dir, "..", "dist", "scripts", "session-archiver.js");

describe("session archiver redaction", () => {
  it("redacts secrets from issue descriptions and bodies", () => {
    const root = mkdtempSync(join(tmpdir(), "session-archiver-test-"));

    try {
      const home = join(root, "home");
      const vault = join(root, "vault");
      const claudeDir = join(home, ".claude");
      const codexDir = join(home, ".codex");
      mkdirSync(claudeDir, { recursive: true });
      mkdirSync(codexDir, { recursive: true });
      mkdirSync(vault, { recursive: true });

      const timestamp = Date.UTC(2026, 7, 18, 12, 0, 0);
      const promptSecret = `ghp_${"a".repeat(20)}`;
      const threadSecret = `sk-proj-${"b".repeat(20)}`;

      writeFileSync(
        join(claudeDir, "history.jsonl"),
        `${JSON.stringify({
          sessionId: "12345678-1234-1234-1234-123456789abc",
          timestamp,
          project: "test-project",
          display: `token=${promptSecret}`,
        })}\n`,
      );
      writeFileSync(
        join(codexDir, "session_index.jsonl"),
        `${JSON.stringify({
          id: "abcdef12-1234-1234-1234-123456789abc",
          updated_at: new Date(timestamp).toISOString(),
          thread_name: threadSecret,
        })}\n`,
      );

      const result = spawnSync("node", [archiverPath, "--vault", vault], {
        encoding: "utf8",
        env: { ...process.env, HOME: home, USERPROFILE: home },
      });
      expect(result.status, result.stderr).toBe(0);

      const promptNote = readFileSync(
        join(vault, "01-Projects", "test-project", "sessions", "2026-08-18-12345678.md"),
        "utf8",
      );
      const threadNote = readFileSync(
        join(vault, "01-Projects", "codex", "sessions", "2026-08-18-abcdef12.md"),
        "utf8",
      );

      expect(promptNote).toContain("<REDACTED>");
      expect(promptNote).not.toContain(promptSecret);
      expect(threadNote).toContain("<REDACTED>");
      expect(threadNote).not.toContain(threadSecret);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
