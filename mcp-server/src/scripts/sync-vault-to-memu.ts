#!/usr/bin/env node
/**
 * sync-vault-to-memu -- spawn `python -m compiler.memu_sync` with passthrough.
 *
 * Thin TypeScript wrapper. Forwards CLI flags to the Python sync script and
 * pipes stdout/stderr transparently. Exits with the subprocess exit code so
 * CI / shell callers can branch on it.
 *
 * Usage:
 *   node dist/scripts/sync-vault-to-memu.js [--vault PATH] [--dry-run]
 *                                           [--json] [--limit N]
 *                                           [--no-recompute]
 *                                           [--memu-graph-python PATH]
 *                                           [--dsn ...] [--user-id ...]
 *                                           [--ollama-url ...] [--embed-model ...]
 *
 * Defaults are owned by the Python script. This wrapper does no flag parsing
 * beyond what's needed to surface --help locally.
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const _thisDir = dirname(fileURLToPath(import.meta.url));
// dist/scripts/sync-vault-to-memu.js -> obsidian-llm-wiki repo root
// (dist/scripts/.. -> dist; dist/.. -> mcp-server; mcp-server/.. -> repo root)
const COMPILER_REPO = resolve(_thisDir, "..", "..", "..");

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: sync-vault-to-memu [flags...]",
      "",
      "Forwarded to `python -m compiler.memu_sync`. Run with --help via the",
      "Python module directly to see the canonical flag list.",
      "",
      "Common flags:",
      "  --vault PATH               default E:/knowledge",
      "  --dry-run                  show diff without writing",
      "  --json                     emit machine-readable JSON",
      "  --limit N                  scan first N MDs only",
      "  --no-recompute             skip PageRank+LPA after write",
      "  --memu-graph-python PATH   override memu-graph venv python",
      "  --dsn DSN                  override $MEMU_DSN",
      "  --user-id ID               default boris",
      "  --ollama-url URL           default http://127.0.0.1:11434",
      "  --embed-model MODEL        default qwen3-embedding:0.6b",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    return 0;
  }

  const cwd = COMPILER_REPO;
  const child = spawn(
    "python",
    ["-m", "compiler.memu_sync", ...argv],
    {
      cwd,
      stdio: ["inherit", "inherit", "inherit"],
      env: process.env,
    },
  );

  return await new Promise<number>((resolveExit) => {
    child.on("error", (err) => {
      process.stderr.write(
        `sync-vault-to-memu: failed to spawn python: ${(err as Error).message}\n`,
      );
      resolveExit(1);
    });
    child.on("exit", (code, signal) => {
      if (typeof code === "number") {
        resolveExit(code);
        return;
      }
      if (signal) {
        process.stderr.write(`sync-vault-to-memu: terminated by signal ${signal}\n`);
        resolveExit(1);
        return;
      }
      resolveExit(1);
    });
  });
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`sync-vault-to-memu: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
