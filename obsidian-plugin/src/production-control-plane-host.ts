import { createOperationDispatcher, type OperationDispatcher } from "../../mcp-server/src/control-plane/dispatcher";
import { AdapterRegistry } from "../../mcp-server/src/adapters/registry";
import { makeAdapterGraphOps } from "../../mcp-server/src/adapters/graph-query";
import { GraphifyAdapter } from "../../mcp-server/src/adapters/graphify";
import { resolveKnowledgeAdaptersRuntimeProfile } from "../../mcp-server/src/adapters/settings-runtime";
import { makeAgentDomainOps } from "../../mcp-server/src/agent-domain/operations";
import { makeLegacyAgentMigrationOps } from "../../mcp-server/src/agent-domain/legacy-migration";
import { badRequest, conflict, type Logger, type OperationContext, type VaultExecutor } from "../../mcp-server/src/core/types";
import { makeHostCapabilityOps, type HostCapabilityTransportFactory } from "../../mcp-server/src/host-capabilities/operations";
import { createDefaultHostCapabilityTransportFactory } from "../../mcp-server/src/host-capabilities/transport";
import { makeProjectHubOps } from "../../mcp-server/src/project/project-hub";
import { makeProjectOps } from "../../mcp-server/src/project/project";
import { createSettingsService, makeSettingsOps } from "../../mcp-server/src/settings/settings";
import { makeUsageOps } from "../../mcp-server/src/usage/operations";
import { makeVisualWorkspaceOps } from "../../mcp-server/src/visual-workspace/operations";
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
  logger?: Logger;
}

/**
 * Desktop-only production host for the shared Operation registry.
 *
 * It deliberately imports operation makers rather than the MCP server entry
 * point, so loading the Obsidian plugin cannot start a listener or a service.
 */
export class ProductionControlPlaneTransport implements AgentControlPlaneTransport {
  private readonly dispatcher: OperationDispatcher;
  private readonly ready: Promise<void>;

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
    this.ready = initializeGraphifyAdapter(
      adapters,
      settingsHost.service,
      options.vaultPath,
      options.environment,
    ).catch(() => undefined);
    const context: OperationContext = {
      vault: new PromotionVaultExecutor(options.vaultPath),
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
          ],
        },
      },
      logger: options.logger ?? quietLogger,
      dryRun: false,
    };
    this.dispatcher = createOperationDispatcher([
      ...makeSettingsOps(settingsOptions, settingsHost.service),
      ...makeAdapterGraphOps(adapters),
      ...makeProjectOps(options.vaultPath),
      ...makeVisualWorkspaceOps(options.vaultPath),
      ...makeAgentDomainOps(options.vaultPath),
      ...makeProjectHubOps(adapters, settingsHost.service),
      ...makeUsageOps(options.vaultPath),
      ...makeHostCapabilityOps(options.vaultPath, {
        settingsService,
        environment: options.environment,
        transportFactory: options.hostCapabilityTransportFactory
          ?? createDefaultHostCapabilityTransportFactory({ environment: options.environment }),
      }),
      ...makeLegacyAgentMigrationOps(),
    ], context);
  }

  async invoke<T>(operation: string, args: Record<string, unknown> = {}): Promise<T> {
    if (operation === "graph.adapters.query") await this.ready;
    return this.dispatcher.invoke(operation, args) as Promise<T>;
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
 * Dream Time Promotion needs one narrow VaultExecutor method: write a
 * deterministic quarantined Markdown candidate. Replays preserve the original
 * bytes; no general Vault mutation surface is exposed to this host.
 */
class PromotionVaultExecutor implements VaultExecutor {
  constructor(private readonly vaultPath: string) {}

  async execute(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method !== "vault.writeAIOutput") throw new Error(`Unsupported Obsidian VaultExecutor method: ${method}`);
    return this.writePromotionCandidate(params);
  }

  private async writePromotionCandidate(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const persona = requiredString(params.persona, "persona");
    if (persona !== "vault-dreamtime") throw badRequest("Obsidian Promotion only accepts the vault-dreamtime persona");
    const agent = requiredString(params.agent, "agent");
    const parentQuery = requiredString(params.parentQuery, "parentQuery").slice(0, 200).replace(/"/g, "”");
    const body = requiredString(params.body, "body");
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
      ? `source-nodes:\n${sourceNodes.map(node => `  - "${node.replace(/"/g, "”")}"`).join("\n")}`
      : "source-nodes: []";
    const content = [
      "---",
      `generated-by: ${persona}`,
      `generated-at: ${generatedAt}`,
      `agent: ${agent}`,
      `parent-query: "${parentQuery}"`,
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
