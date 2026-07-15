#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { Operation, OperationContext } from '../core/types.js';
import { badRequest } from '../core/types.js';
import { makeUsageOps } from './operations.js';

export interface UsageCliResult {
  command: 'append' | 'project' | 'policy';
  result: unknown;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw badRequest(`${name} requires a value`);
  return value;
}

function requiredOption(args: string[], name: string): string {
  const value = option(args, name)?.trim();
  if (!value) throw badRequest(`${name} is required`);
  return value;
}

function jsonFile(args: string[], name: string): Record<string, unknown> {
  const path = resolve(requiredOption(args, name));
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw badRequest(`${name} must reference readable JSON: ${(error as Error).message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest(`${name} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

function context(vaultPath: string): OperationContext {
  return {
    vault: { async execute() { return {}; } },
    adapters: null,
    config: { vault_path: vaultPath, collaboration: { actor: 'usage-cli', role: 'human' } },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: false,
  };
}

async function invoke(
  operations: Operation[],
  ctx: OperationContext,
  name: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const operation = operations.find((candidate) => candidate.name === name);
  if (!operation) throw new Error(`Usage operation is not registered: ${name}`);
  return operation.handler(ctx, params);
}

export async function runUsageCli(argv: string[]): Promise<UsageCliResult> {
  const command = argv[0];
  if (command !== 'append' && command !== 'project' && command !== 'policy') {
    throw badRequest('Usage command must be append, project, or policy');
  }
  const vaultPath = resolve(requiredOption(argv, '--vault'));
  const project = requiredOption(argv, '--project');
  const operations = makeUsageOps(vaultPath);
  const ctx = context(vaultPath);
  if (command === 'append') {
    return {
      command,
      result: await invoke(operations, ctx, 'usage.append', {
        project,
        event: jsonFile(argv, '--event-file'),
      }),
    };
  }
  const from = option(argv, '--from');
  const to = option(argv, '--to');
  if (command === 'policy') {
    return {
      command,
      result: await invoke(operations, ctx, 'usage.policy.evaluate', {
        project,
        policy: jsonFile(argv, '--policy-file'),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }),
    };
  }
  const groupBy = option(argv, '--group-by')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    command,
    result: await invoke(operations, ctx, 'usage.project', {
      project,
      ...(groupBy?.length ? { groupBy } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
  };
}

const isEntrypoint = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(resolve(process.argv[1]!)).href;
if (isEntrypoint) {
  runUsageCli(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      const code = typeof (error as { code?: unknown }).code === 'number'
        ? (error as { code: number }).code
        : -32603;
      process.stderr.write(`${JSON.stringify({ code, message: (error as Error).message })}\n`);
      process.exitCode = 1;
    });
}
