import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { legacyHostCapabilityCandidates } from "./settings-resolution.js";

describe("legacy Host Capability settings compatibility", () => {
  it("never adapts Project Tracker forge bindings or provider tokens into Host authority", () => {
    const root = mkdtempSync(join(tmpdir(), "llmwiki-host-settings-"));
    try {
      mkdirSync(join(root, ".vault-mind"), { recursive: true });
      writeFileSync(join(root, ".vault-mind", "forge.json"), JSON.stringify({
        projects: {
          "project/alpha": { forge: { provider: "gitea", base_url: "https://git.example.test/api/v1" } },
        },
      }));
      assert.deepEqual(legacyHostCapabilityCandidates(root, "project/alpha", {
        GITEA_TOKEN: "never-return-me",
        GITHUB_TOKEN: "also-not-host-authority",
      }), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts only the explicit generic Host compatibility environment", () => {
    const root = mkdtempSync(join(tmpdir(), "llmwiki-host-settings-"));
    try {
      const candidates = legacyHostCapabilityCandidates(root, undefined, {
        LLMWIKI_HOST_CAPABILITY_CONNECTOR_ID: "connector/reviewed-expert",
        LLMWIKI_HOST_CAPABILITY_TRANSPORT: "http",
        LLMWIKI_HOST_CAPABILITY_ENDPOINT: "https://host.example.test/mcp",
        LLMWIKI_HOST_CAPABILITY_KEY: "never-return-this-host-secret",
      });
      assert.equal(candidates[0]?.values.provider, "connector/reviewed-expert");
      assert.equal(candidates[0]?.values.credential?.secretRef.locator, "LLMWIKI_HOST_CAPABILITY_KEY");
      assert.equal(JSON.stringify(candidates).includes("never-return-this-host-secret"), false);
      assert.deepEqual(legacyHostCapabilityCandidates(root, undefined, {
        LLMWIKI_HOST_CAPABILITY_CONNECTOR_ID: "reviewed-expert",
      }), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
