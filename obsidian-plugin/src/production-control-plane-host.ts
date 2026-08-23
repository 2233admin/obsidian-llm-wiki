import { AdapterRegistry } from "../../mcp-server/src/adapters/registry";
import { FilesystemAdapter } from "../../mcp-server/src/adapters/filesystem";
import { GraphifyAdapter } from "../../mcp-server/src/adapters/graphify";
import { resolveKnowledgeAdaptersRuntimeProfile } from "../../mcp-server/src/adapters/settings-runtime";
import { CompileTrigger } from "../../mcp-server/src/compile-trigger";
import { LegacyCompileRunAdapter } from "../../mcp-server/src/compile/compile-run-port";
import { LegacyAgentRunnerAdapter, PythonEvaluateRunner } from "../../mcp-server/src/agent/agent-runner-port";
import { createApplicationRuntime, type ApplicationRuntime } from "../../mcp-server/src/application/runtime";
import { FileVaultStore } from "../../mcp-server/src/vault/store";
import { badRequest, conflict, type Logger, type OperationContext, type VaultExecutor } from "../../mcp-server/src/core/types";
import { type HostCapabilityTransportFactory } from "../../mcp-server/src/host-capabilities/operations";
import { createExecFileObcRunner } from "../../mcp-server/src/problem-intake/obc-runner";
import {
  createVaultGovernedContributionPort,
  type UiWorkRunApprovalPairPort,
} from "../../mcp-server/src/contributions";
import { createSettingsService, resolveAgentModelProcessEnvironment } from "../../mcp-server/src/settings/settings";
import { isObsidianControlPlaneOperation } from "./host-operation-filter";
import type { AgentControlPlaneTransport } from "./control-plane-client";
import { InProcessSettingsTransport } from "./settings-host";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const OBSIDIAN_CONTROL_PLANE_ACTOR = "obsidian-control-plane";

export interface ProductionControlPlaneOptions {
  vaultPath: string;
  userDeviceId: string;
  userDevicePath?: string;
  workspaceProjectId?: string;
  pythonPath?: string;
  compilerPath?: string;
  environment?: NodeJS.ProcessEnv;
  hostCapabilityTransportFactory?: HostCapabilityTransportFactory;
  contributionApprovalPairs?: UiWorkRunApprovalPairPort;
  logger?: Logger;
}

/**
 * Desktop-only production host for the shared Operation registry.
 *
 * It deliberately imports the shared application runtime rather than the MCP
 * server entry point, so loading the Obsidian plugin cannot start a listener
 * or a service.
 */
export class ProductionControlPlaneTransport implements AgentControlPlaneTransport {
  private readonly runtime: ApplicationRuntime;

  constructor(options: ProductionControlPlaneOptions) {
    const settingsOptions = {
      vaultPath: options.vaultPath,
      userDeviceId: options.userDeviceId,
      userDevicePath: options.userDevicePath,
      workspaceProjectId: options.workspaceProjectId,
      pythonPath: options.pythonPath,
      compilerPath: options.compilerPath,
      environment: options.environment,
    };
    const settingsService = createSettingsService(settingsOptions);

    // Preserve the existing in-process Obsidian settings host as the owner of
    // the authoritative service, then publish that same service through the
    // shared Settings Operation definitions and write policies.
    const settingsHost = new InProcessSettingsTransport({
      ...settingsOptions,
      service: settingsService,
    });
    const adapters = new AdapterRegistry();
    const filesystemAdapter = new FilesystemAdapter(options.vaultPath);
    adapters.register(filesystemAdapter);
    const filesystemReady = filesystemAdapter.init().catch(() => undefined);
    const graphifyReady = initializeGraphifyAdapter(
      adapters,
      settingsHost.service,
      options.vaultPath,
      options.environment,
    ).catch(() => undefined);
    const context: OperationContext = {
      vault: new ObsidianAIOutputVaultExecutor(options.vaultPath),
      store: new FileVaultStore(options.vaultPath),
      adapters,
      config: {
        vault_path: options.vaultPath,
        adapters: [],
        collaboration: {
          actor: OBSIDIAN_CONTROL_PLANE_ACTOR,
          role: "human",
          enforce: true,
          allowed_write_paths: [
            "_llmwiki/agent-domain/v1/**",
            "_llmwiki/usage/v1/**",
            "_llmwiki/host-capabilities/**",
            "_llmwiki/settings/**",
            "_llmwiki/projects/**",
            "Projects/**",
            "01-Projects/**",
            "00-Inbox/AI-Output/vault-dreamtime/**",
            "00-Inbox/AI-Output/vault-ask/**",
            "00-Inbox/AI-Output/vault-agentfiles/**",
          ],
        },
      },
      logger: options.logger ?? quietLogger,
      dryRun: false,
    };
    const contribution = createVaultGovernedContributionPort({
      vaultPath: options.vaultPath,
      ...(options.contributionApprovalPairs
        ? { approvalPairs: options.contributionApprovalPairs }
        : {}),
    });
    const python = options.pythonPath ?? "python";
    const compilerPath = options.compilerPath ?? join(options.vaultPath, "compiler");
    const compileTrigger = new CompileTrigger({
      vaultPath: options.vaultPath,
      compilerPath,
      python,
      vaultStore: context.store,
      autoCompile: false,
      schedulingMode: "legacy-threshold",
    });
    const compileRunPort = new LegacyCompileRunAdapter(compileTrigger, { vaultPath: options.vaultPath });
    compileTrigger.setRunScheduler(compileRunPort);
    const agentRunnerPort = new LegacyAgentRunnerAdapter(
      new PythonEvaluateRunner({
        vaultPath: options.vaultPath,
        compilerPath,
        python,
        environmentResolver: () => resolveAgentModelProcessEnvironment(settingsService),
      }),
      { vaultPath: options.vaultPath },
    );
    const ready = Promise.all([
      filesystemReady,
      graphifyReady,
      compileRunPort.recover(),
      agentRunnerPort.recover(),
    ]).then(() => undefined);
    this.runtime = createApplicationRuntime({
      compileTrigger,
      compileRunPort,
      agentRunnerPort,
      registry: adapters,
      python,
      compilerPath,
      vaultPath: options.vaultPath,
      store: context.store,
      environment: options.environment,
      settingsOptions,
      settingsService: settingsHost.service,
      hostCapabilityTransportFactory: options.hostCapabilityTransportFactory,
      obcRunner: createExecFileObcRunner({
        pythonCommand: python,
        cwd: options.compilerPath ? dirname(options.compilerPath) : undefined,
      }),
      problemContributionFactory: () => ({ contribution }),
      context,
      operationFilter: isObsidianControlPlaneOperation,
      ready,
      onDispose: () => contribution.dispose(),
    });
  }

  async invoke<T>(operation: string, args: Record<string, unknown> = {}): Promise<T> {
    return this.runtime.invoke(operation, args) as Promise<T>;
  }

  async dispose(): Promise<void> {
    await this.runtime.dispose();
  }
}

async function initializeGraphifyAdapter(
  registry: AdapterRegistry,
  settingsService: ReturnType<typeof createSettingsService>,
  vaultPath: string,
  environment: NodeJS.ProcessEnv | undefined,
): Promise<void> {
  const profile = await resolveKnowledgeAdaptersRuntimeProfile(settingsService, { environment });
  if (!profile.graphify.enabled || !profile.graphify.valid) return;
  const adapter = new GraphifyAdapter({
    vaultPath,
    binary: profile.graphify.binary,
    outputDir: profile.graphify.outputDir,
    autoRescan: profile.graphify.autoRescan,
    timeout: profile.graphify.timeoutMs,
  });
  await adapter.init();
  if (adapter.isAvailable) registry.register(adapter);
}

const quietLogger: Logger = {
  info() {},
  warn() {},
  error() {},
};

/**
 * Obsidian's governed AI Output flows need one narrow VaultExecutor method:
 * write a deterministic quarantined Markdown candidate. Replays preserve the
 * original bytes; no general Vault mutation surface is exposed to this host.
 */
class ObsidianAIOutputVaultExecutor implements VaultExecutor {
  constructor(private readonly vaultPath: string) {}

  async execute(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method !== "vault.writeAIOutput") throw new Error(`Unsupported Obsidian VaultExecutor method: ${method}`);
    return this.writePromotionCandidate(params);
  }

  private async writePromotionCandidate(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const persona = requiredString(params.persona, "persona");
    if (persona !== "vault-dreamtime" && persona !== "vault-ask" && persona !== "vault-agentfiles") {
      throw badRequest("Obsidian AI Output only accepts the vault-dreamtime, vault-ask, or vault-agentfiles persona");
    }
    const agent = requiredString(params.agent, "agent");
    const parentQuery = requiredString(params.parentQuery, "parentQuery").slice(0, 200).replace(/"/g, "”");
    const body = requiredString(params.body, "body");
    if (/^---\r?\n/.test(body)) throw badRequest("body must not include frontmatter");
    const slug = safeSlug(requiredString(params.slug, "slug"));
    const sourceNodes = stringArray(params.sourceNodes, "sourceNodes");
    const scope = params.scope === undefined ? "project" : requiredString(params.scope, "scope");
    const quarantineState = params.quarantineState === undefined ? "new" : requiredString(params.quarantineState, "quarantineState");
    if (scope !== "project" || quarantineState !== "new") {
      throw badRequest("Obsidian Promotion candidates must use project scope and new quarantine state");
    }

    const path = `00-Inbox/AI-Output/${persona}/${slug}.md`;
    const fullPath = join(this.vaultPath, ...path.split("/"));
    if (existsSync(fullPath)) return replayExistingPromotion(fullPath, path, body);

    const generatedAt = new Date().toISOString();
    const yamlNodes = sourceNodes.length
      ? `source-nodes:\n${sourceNodes.map(node => `  - ${yamlQuoted(node)}`).join("\n")}`
      : "source-nodes: []";
    const content = [
      "---",
      `generated-by: ${persona}`,
      `generated-at: ${generatedAt}`,
      `agent: ${yamlQuoted(agent)}`,
      `parent-query: ${yamlQuoted(parentQuery)}`,
      yamlNodes,
      "status: draft",
      `scope: ${scope}`,
      `quarantine-state: ${quarantineState}`,
      `idempotency-key: ${slug}`,
      "---",
      "",
      body.replace(/\n+$/, ""),
      "",
    ].join("\n");
    mkdirSync(dirname(fullPath), { recursive: true });
    try {
      writeFileSync(fullPath, content, { encoding: "utf-8", flag: "wx" });
      return { ok: true, path, replayed: false };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return replayExistingPromotion(fullPath, path, body);
      throw error;
    }
  }
}

function replayExistingPromotion(fullPath: string, path: string, body: string): Record<string, unknown> {
  const content = readFileSync(fullPath, "utf-8");
  if (!content.endsWith(`\n\n${body.replace(/\n+$/, "")}\n`)) {
    throw conflict(`Promotion candidate path already contains different bytes: ${path}`);
  }
  return { ok: true, path, replayed: true };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw badRequest(`${name} must be a non-empty string`);
  return value.trim();
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    throw badRequest(`${name} must be an array of strings`);
  }
  return value as string[];
}

function yamlQuoted(value: string): string {
  // JSON string quoting is also valid YAML double-quoted scalar syntax and
  // keeps user-controlled newlines, quotes, and backslashes inside metadata.
  return JSON.stringify(value);
}

function safeSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
  if (!slug) throw badRequest("slug must contain at least one safe character");
  return slug;
}
