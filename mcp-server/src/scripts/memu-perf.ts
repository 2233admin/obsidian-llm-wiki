#!/usr/bin/env node
/**
 * memu-perf -- latency baseline for the memU PG adapter.
 *
 * Measures two things that matter for this adapter:
 *   - Cold pool: fresh MemUAdapter + init() + search() + dispose() per query.
 *     Models the worst-case path where each MCP tool invocation spawns a new
 *     bundle.js process (which is what the memu-query CLI already does).
 *   - Warm pool: init() once, then N sequential search() calls.
 *     Models the path where the MCP server is long-running and the Pool is
 *     reused across tool calls.
 *
 * Both runs report p50/p95/p99/mean/min/max. Output is a Markdown table plus
 * a trailing JSON block so a CI step or docs/PERF.md can consume either.
 *
 * Usage:
 *   node dist/scripts/memu-perf.js [--iters N] [--query Q] [--json]
 *                                  [--user-id ...]
 *
 * The private connection string must be supplied out of band through the
 * Settings/Secret Reference runtime or the process-local MEMU_DSN environment
 * variable. It is never accepted in argv and never rendered in output.
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MemUAdapter } from "../adapters/memu.js";

export type Args = {
  iters: number;
  query: string;
  userId?: string;
  jsonOnly: boolean;
  help: boolean;
};

export function parseArgs(argv: string[]): Args {
  const out: Args = { iters: 100, query: "note", jsonOnly: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--iters") out.iters = Math.max(1, parseInt(argv[++i], 10) || 100);
    else if (a === "--query") out.query = argv[++i];
    else if (a === "--dsn" || a.startsWith("--dsn=")) {
      throw new Error(
        "--dsn is forbidden: resolve private DSNs through Settings/SecretRef or process-local MEMU_DSN",
      );
    }
    else if (a === "--user-id") out.userId = argv[++i];
    else if (a === "--json") out.jsonOnly = true;
    else if (a === "-h" || a === "--help") {
      out.help = true;
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

interface Stats {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  mean: number;
  min: number;
  max: number;
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const pct = (p: number): number => sorted[Math.min(n - 1, Math.floor(p * n))];
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n,
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
    mean: sum / n,
    min: sorted[0],
    max: sorted[n - 1],
  };
}

function fmt(ms: number): string {
  return ms >= 10 ? `${ms.toFixed(1)}ms` : `${ms.toFixed(2)}ms`;
}

async function runCold(args: Args): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < args.iters; i++) {
    const adapter = new MemUAdapter({ userId: args.userId });
    await adapter.init();
    if (!adapter.isAvailable) {
      await adapter.dispose();
      throw new Error(
        "adapter unavailable during cold run -- check MEMU_DSN / PG reachable",
      );
    }
    const t0 = performance.now();
    await adapter.search(args.query);
    samples.push(performance.now() - t0);
    await adapter.dispose();
  }
  return samples;
}

async function runWarm(args: Args): Promise<number[]> {
  const adapter = new MemUAdapter({ userId: args.userId });
  await adapter.init();
  if (!adapter.isAvailable) {
    await adapter.dispose();
    throw new Error("adapter unavailable during warm run");
  }
  const samples: number[] = [];
  try {
    // Throwaway query to prime PG query planner -- first call includes parse/plan.
    await adapter.search(args.query);
    for (let i = 0; i < args.iters; i++) {
      const t0 = performance.now();
      await adapter.search(args.query);
      samples.push(performance.now() - t0);
    }
  } finally {
    await adapter.dispose();
  }
  return samples;
}

export function renderMd(cold: Stats, warm: Stats, args: Args): string {
  const header = [
    "# MemU adapter perf baseline",
    "",
    `- Connection: \`${process.env.MEMU_DSN ? "configured (redacted)" : "PostgreSQL default"}\``,
    `- User: \`${args.userId ?? process.env.MEMU_USER_ID ?? "default"}\``,
    `- Iterations: ${args.iters}`,
    `- Query: \`${args.query}\``,
    "",
  ].join("\n");
  const row = (s: Stats): string =>
    `| ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.p99)} | ${fmt(s.mean)} | ${fmt(s.min)} | ${fmt(s.max)} |`;
  return (
    header +
    "\n## Cold pool (new adapter+init per query)\n" +
    "| p50 | p95 | p99 | mean | min | max |\n" +
    "| --- | --- | --- | ---- | --- | --- |\n" +
    row(cold) +
    "\n\n## Warm pool (init once, reused Pool)\n" +
    "| p50 | p95 | p99 | mean | min | max |\n" +
    "| --- | --- | --- | ---- | --- | --- |\n" +
    row(warm) +
    "\n"
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      "Usage: memu-perf [--iters N] [--query Q] [--user-id ...] [--json]\n",
    );
    return;
  }
  const cold = stats(await runCold(args));
  const warm = stats(await runWarm(args));

  if (args.jsonOnly) {
    process.stdout.write(
      JSON.stringify(
        {
          config: {
            iters: args.iters,
            query: args.query,
            userId: args.userId,
            connection: process.env.MEMU_DSN ? "configured (redacted)" : "PostgreSQL default",
          },
          cold,
          warm,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  process.stdout.write(renderMd(cold, warm, args));
  process.stdout.write(
    "\n```json\n" + JSON.stringify({ cold, warm }, null, 2) + "\n```\n",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    process.stderr.write(`memu-perf: ${(e as Error).message}\n`);
    process.exit(1);
  });
}
