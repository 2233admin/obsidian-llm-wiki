#!/usr/bin/env node
/**
 * sync-vault-to-memu -- spawn the Settings-owned MemU sync path.
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
 * Defaults are owned by the canonical Settings profile in the Python script.
 * This wrapper validates the deprecated --dsn compatibility flag so a private
 * DSN is never forwarded into the Python process argument vector.
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
      "  --vault PATH               default current directory or $VAULT_MIND_VAULT_PATH",
      "  --dry-run                  show diff without writing",
      "  --json                     emit machine-readable JSON",
      "  --limit N                  scan first N MDs only",
      "  --no-recompute             skip PageRank+LPA after write",
      "  --memu-graph-python PATH   override memu-graph venv python",
      "  --dsn PUBLIC_DSN           credential-free compatibility endpoint only",
      "  --user-id ID               compatibility input; explicit Settings wins",
      "  --ollama-url URL           default http://127.0.0.1:11434",
      "  --embed-model MODEL        default qwen3-embedding:0.6b",
      "",
    ].join("\n"),
  );
}

function validatePublicDsn(value: string): void {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
      || !url.hostname
      || url.username
      || url.password
      || url.search
      || url.hash
    ) {
      throw new Error("unsafe");
    }
  } catch {
    throw new Error(
      "--dsn accepts only a credential-free PostgreSQL endpoint; configure credentials with adapters.memu.secret_ref",
    );
  }
}

/** Validate compatibility arguments without reflecting a rejected DSN. */
export function sanitizeForwardedArguments(argv: readonly string[]): string[] {
  const forwarded: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--dsn") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--dsn requires a credential-free PostgreSQL endpoint");
      }
      validatePublicDsn(value);
      forwarded.push(argument, value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--dsn=")) {
      const value = argument.slice("--dsn=".length);
      validatePublicDsn(value);
      forwarded.push(argument);
      continue;
    }
    forwarded.push(argument);
  }
  return forwarded;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    return 0;
  }
  let forwarded: string[];
  try {
    forwarded = sanitizeForwardedArguments(argv);
  } catch (error) {
    process.stderr.write(`sync-vault-to-memu: ${(error as Error).message}\n`);
    return 2;
  }

  const cwd = COMPILER_REPO;
  const child = spawn(
    "python",
    ["-m", "compiler.memu_sync", ...forwarded],
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

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`sync-vault-to-memu: ${(err as Error).message}\n`);
      process.exit(1);
    },
  );
}
