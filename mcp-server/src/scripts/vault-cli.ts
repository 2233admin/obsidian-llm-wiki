#!/usr/bin/env node

import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AdapterRegistry } from "../adapters/registry.js";
import { FilesystemAdapter } from "../adapters/filesystem.js";
import { VaultBrainAdapter } from "../adapters/vaultbrain/index.js";
import { configureLazyIndex, ensureBackfill } from "../adapters/vaultbrain/lazy-index.js";
import { answerQuery, type QueryAnswerResult } from "../unified-query.js";
import { readVaultEnvironment } from "../runtime-env.js";

export interface VaultRecallArgs {
  query: string;
  vaultPath: string;
  brainDataDir?: string;
}

export function parseVaultRecallArgs(argv: readonly string[], environment: NodeJS.ProcessEnv = process.env): VaultRecallArgs {
  if (argv[0] !== "recall") {
    throw new Error("usage: vault recall \"query\" [--vault PATH]");
  }

  let query: string | undefined;
  let vaultPath: string | undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--vault") {
      vaultPath = argv[++index];
      if (!vaultPath) throw new Error("--vault requires a path");
      continue;
    }
    if (value.startsWith("--")) throw new Error(`unknown option: ${value}`);
    if (query) throw new Error("recall accepts exactly one query");
    query = value;
  }

  const resolvedVault = vaultPath ?? readVaultEnvironment(environment);
  if (!query?.trim()) throw new Error("recall requires a non-empty query");
  if (!resolvedVault) throw new Error("vault path not set: pass --vault PATH or set VAULT_MIND_VAULT_PATH");
  return { query: query.trim(), vaultPath: resolve(resolvedVault) };
}

export function renderRecallResult(result: QueryAnswerResult): string {
  const lines = [`Query: ${result.query}`, "", result.answer, "", "Citations:"];
  if (result.citations.length === 0) {
    lines.push("- none");
  } else {
    for (const citation of result.citations) {
      lines.push(`- [${citation.id}] ${citation.path}: ${citation.snippet}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function runVaultRecall(args: VaultRecallArgs): Promise<string> {
  await access(args.vaultPath);
  const registry = new AdapterRegistry();
  const filesystem = new FilesystemAdapter(args.vaultPath);
  const vaultBrain = new VaultBrainAdapter(args.brainDataDir);
  await filesystem.init();
  await vaultBrain.init();
  registry.register(filesystem);
  try {
    if (vaultBrain.isAvailable) {
      registry.register(vaultBrain);
      configureLazyIndex(vaultBrain, args.vaultPath);
      await ensureBackfill({ syncCap: 300 });
    }
    const result = await answerQuery(registry, args.query, { maxResults: 10 });
    return renderRecallResult(result);
  } finally {
    await vaultBrain.dispose();
    await filesystem.dispose();
  }
}

async function main(): Promise<void> {
  try {
    const args = parseVaultRecallArgs(process.argv.slice(2));
    process.stdout.write(await runVaultRecall(args));
  } catch (error) {
    process.stderr.write(`vault: ${(error as Error).message}\n`);
    process.exitCode = 1;
  }
}

const isEntry = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) void main();
