import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeAgentWikiFeatureOps, resolveAgentWikiFeatureFlags } from "./feature-flags.js";

describe("Agent Wiki reversible feature flags", () => {
  it("enables the maintained path by default", () => {
    assert.deepEqual(resolveAgentWikiFeatureFlags({}), {
      sourceIngestExecution: true,
      durableMaintenance: true,
      tieredRetrieval: true,
      toolchainProbes: true,
    });
  });

  it("maps each compatibility environment value without deleting state", async () => {
    const flags = resolveAgentWikiFeatureFlags({
      VAULT_MIND_AGENT_WIKI_INGEST: "disabled",
      VAULT_MIND_COMPILE_TRIGGER_MODE: "legacy-threshold",
      VAULT_MIND_RETRIEVAL_MODE: "legacy-rrf",
      VAULT_MIND_TOOLCHAIN_PROBES: "disabled",
    });
    assert.ok(Object.values(flags).every((value) => value === false));
    const result = await makeAgentWikiFeatureOps(flags)[0].handler({} as never, {}) as Record<string, unknown>;
    assert.match(String(result.statePolicy), /retained for recovery/);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  });
});
