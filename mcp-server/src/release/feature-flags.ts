import type { Operation } from "../core/types.js";

export interface AgentWikiFeatureFlags {
  sourceIngestExecution: boolean;
  durableMaintenance: boolean;
  tieredRetrieval: boolean;
  toolchainProbes: boolean;
}

export function resolveAgentWikiFeatureFlags(
  environment: NodeJS.ProcessEnv = process.env,
): AgentWikiFeatureFlags {
  return {
    sourceIngestExecution: environment.VAULT_MIND_AGENT_WIKI_INGEST !== "disabled",
    durableMaintenance: environment.VAULT_MIND_COMPILE_TRIGGER_MODE !== "legacy-threshold",
    tieredRetrieval: environment.VAULT_MIND_RETRIEVAL_MODE !== "legacy-rrf",
    toolchainProbes: environment.VAULT_MIND_TOOLCHAIN_PROBES !== "disabled",
  };
}

export function makeAgentWikiFeatureOps(
  flags: AgentWikiFeatureFlags = resolveAgentWikiFeatureFlags(),
): Operation[] {
  return [{
    name: "settings.agent_wiki.features",
    namespace: "settings",
    description: "Report Agent Wiki rollout flags and reversible compatibility modes without probing providers or mutating state.",
    mutating: false,
    params: {},
    handler: async () => ({
      schemaVersion: 1,
      flags,
      rollback: {
        sourceIngestExecution: "VAULT_MIND_AGENT_WIKI_INGEST=disabled keeps inspect/verify readable while blocking run/resume.",
        durableMaintenance: "VAULT_MIND_COMPILE_TRIGGER_MODE=legacy-threshold restores the prior threshold trigger without deleting queue receipts.",
        tieredRetrieval: "VAULT_MIND_RETRIEVAL_MODE=legacy-rrf preserves normalized results but restores the prior pure-RRF ordering.",
        toolchainProbes: "VAULT_MIND_TOOLCHAIN_PROBES=disabled prevents live provider probing; cached/redacted profile state remains readable.",
      },
      statePolicy: "Rollback changes execution selection only; additive runs, receipts, manifests, queues, generations, and traces are retained for recovery.",
    }),
  }];
}
