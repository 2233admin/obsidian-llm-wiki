#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { AdapterRegistry } from "../adapters/registry.js";
import { FilesystemAdapter } from "../adapters/filesystem.js";
import { createOperationDispatcher } from "../control-plane/dispatcher.js";
import type { OperationContext } from "../core/types.js";
import { badRequest, isOperationError } from "../core/types.js";
import { createDefaultRecoveryRuntime, makeProjectHubOps } from "../project/project-hub.js";
import { createRecoveryPlanningService } from "./recovery-planning-service.js";
import { makeWorkflowOps } from "../workflow/workflow.js";

export type RecoveryFlowCliCommand =
  | "open"
  | "search"
  | "plan"
  | "refresh-plan"
  | "restart"
  | "apply";

export interface RecoveryFlowCliResult {
  command: RecoveryFlowCliCommand;
  result: unknown;
}

const REQUEST_SCHEMA_VERSION = "project-hub-recovery-flow-request/v2";
const APPLY_OPERATION = "workflow.recovery.apply";
const ABSOLUTE_PATH = /(?:[A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\/|~\/)[^\s"']*/gu;
const SECRET_VALUE = /(?:Bearer\s+|(?:token|secret|password|api[_-]?key)=)[^\s"']+/giu;

export async function runRecoveryFlowCli(
  argv: string[],
  invoke?: (operation: string, args: Record<string, unknown>) => Promise<unknown>,
): Promise<RecoveryFlowCliResult> {
  const command = argv[0] as RecoveryFlowCliCommand | undefined;
  if (!command || !["open", "search", "plan", "refresh-plan", "restart", "apply"].includes(command)) {
    throw badRequest("Recovery Flow command must be open, search, plan, refresh-plan, restart, or apply");
  }
  const vaultPath = resolve(requiredOption(argv, "--vault"));
  const operationInvoker = invoke ?? await createDefaultInvoker(vaultPath);
  if (command === "open") {
    const projectId = requiredOption(argv, "--project");
    return {
      command,
      result: await operationInvoker("project.hub.recovery.flow", {
        request: { schemaVersion: REQUEST_SCHEMA_VERSION, projectId, action: "open" },
      }),
    };
  }
  const input = jsonObjectFile(argv, "--input-file");
  const operation = command === "apply" ? APPLY_OPERATION : "project.hub.recovery.flow";
  return { command, result: await operationInvoker(operation, { request: input }) };
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw badRequest(`${name} requires a value`);
  return value;
}

function requiredOption(args: string[], name: string): string {
  const value = option(args, name)?.trim();
  if (!value) throw badRequest(`${name} is required`);
  return value;
}

function jsonObjectFile(args: string[], name: string): Record<string, unknown> {
  const filePath = resolve(requiredOption(args, name));
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    throw badRequest(`${name} must reference readable JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(`${name} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

async function createDefaultInvoker(vaultPath: string): Promise<(operation: string, args: Record<string, unknown>) => Promise<unknown>> {
  const registry = new AdapterRegistry();
  const filesystem = new FilesystemAdapter(vaultPath);
  await filesystem.init();
  registry.register(filesystem);
  const recoveryRuntime = createDefaultRecoveryRuntime({
    vaultPath,
    registry,
    capabilityFact: { capability: "workflow.recovery.plan", state: "available" },
  });
  const recoveryPlanningService = createRecoveryPlanningService(recoveryRuntime.dependencies);
  const operations = [
    ...makeProjectHubOps(registry, undefined, { recoveryRuntime, recoveryPlanningService }),
    ...makeWorkflowOps(vaultPath, {
      recoveryRuntime,
      recoveryPlanningService,
      recoveryApplyCapability: async () => ({ capability: "workflow.recovery.apply", state: "available" }),
    }),
  ];
  const context: OperationContext = {
    vault: { async execute() { return {}; } },
    adapters: registry,
    config: {
      vault_path: vaultPath,
      collaboration: {
        actor: process.env.VAULT_MIND_ACTOR || "llmwiki-cli",
        role: process.env.VAULT_MIND_ROLE || "human",
        enforce: true,
      },
    },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: false,
  };
  const dispatcher = createOperationDispatcher(operations, context);
  return (operation, args) => dispatcher.invoke(operation, args);
}

export function safeCliError(error: unknown): { code: number; message: string } {
  const code = isOperationError(error) ? error.code : -32603;
  const raw = error instanceof Error ? error.message : "Recovery Flow CLI failed";
  return { code, message: raw.replace(SECRET_VALUE, "[redacted]").replace(ABSOLUTE_PATH, "[path]") };
}

const isEntrypoint = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(resolve(process.argv[1]!)).href;
if (isEntrypoint) {
  runRecoveryFlowCli(process.argv.slice(2))
    .then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(error => {
      process.stderr.write(`${JSON.stringify(safeCliError(error))}\n`);
      process.exitCode = 1;
    });
}
