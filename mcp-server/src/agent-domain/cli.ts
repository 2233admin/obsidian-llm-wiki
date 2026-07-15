#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createOperationDispatcher } from '../control-plane/dispatcher.js';
import type { OperationContext } from '../core/types.js';
import { badRequest, isOperationError } from '../core/types.js';
import { makeAgentDomainOps } from './operations.js';

export type AgentDomainCliCommand = 'room' | 'context-compile';

export interface AgentDomainCliResult {
  command: AgentDomainCliCommand;
  result: unknown;
}

export async function runAgentDomainCli(argv: string[]): Promise<AgentDomainCliResult> {
  const command = argv[0];
  if (command !== 'room' && command !== 'context-compile') {
    throw badRequest('Agent Domain command must be room or context-compile');
  }

  const vaultPath = resolve(requiredOption(argv, '--vault'));
  const dispatcher = createOperationDispatcher(
    makeAgentDomainOps(vaultPath),
    operationContext(vaultPath),
  );

  if (command === 'room') {
    const threadId = option(argv, '--thread-id');
    return {
      command,
      result: await dispatcher.invoke('agent.room.get', {
        project: requiredOption(argv, '--project'),
        profileId: requiredOption(argv, '--profile-id'),
        ...(threadId ? { threadId } : {}),
      }),
    };
  }

  const expectedFingerprint = option(argv, '--expected-fingerprint');
  const references = jsonObjectFile(argv, '--input-file');
  return {
    command,
    result: await dispatcher.invoke('agent.context.compile', {
      ...references,
      ...(expectedFingerprint ? { expectedFingerprint } : {}),
      explicitNewAttempt: argv.includes('--explicit-new-attempt'),
    }),
  };
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

function jsonObjectFile(args: string[], name: string): Record<string, unknown> {
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

function operationContext(vaultPath: string): OperationContext {
  return {
    vault: { async execute() { return {}; } },
    adapters: null,
    config: {
      vault_path: vaultPath,
      collaboration: {
        actor: process.env.VAULT_MIND_ACTOR || 'agent-domain-cli',
        role: process.env.VAULT_MIND_ROLE || 'human',
      },
    },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: false,
  };
}

const isEntrypoint = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(resolve(process.argv[1]!)).href;
if (isEntrypoint) {
  runAgentDomainCli(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      const code = isOperationError(error) ? error.code : -32603;
      const message = error instanceof Error ? error.message : 'Agent Domain CLI failed';
      process.stderr.write(`${JSON.stringify({ code, message })}\n`);
      process.exitCode = 1;
    });
}
