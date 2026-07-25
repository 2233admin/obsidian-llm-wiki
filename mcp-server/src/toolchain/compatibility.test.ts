import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  ToolchainCapabilityRegistry,
  TOOLCHAIN_PROFILES,
  makeReceipt,
  type ToolchainProbe,
} from "./compatibility.js";
import { graphifyCompatibilityRevision, graphifyQueryCommand, openCliDiscoveryCommand, qmdModelFingerprint } from "./provider-contracts.js";

describe("toolchain capability profiles", () => {
  it("matches golden probe outcomes without retaining reflected secrets", () => {
    const definition = TOOLCHAIN_PROFILES.opencli[0]!;
    const fixtures = JSON.parse(readFileSync(
      new URL("./fixtures/probe-cases.json", import.meta.url),
      "utf8",
    )) as Array<{
      name: string;
      observation: Parameters<typeof makeReceipt>[1];
      expected: Pick<ReturnType<typeof makeReceipt>, "health" | "compatibility">;
      forbidden?: string[];
    }>;

    for (const fixture of fixtures) {
      const receipt = makeReceipt(
        definition,
        fixture.observation,
        new Date("2026-07-23T00:00:00.000Z"),
        60_000,
      );
      assert.equal(receipt.health, fixture.expected.health, fixture.name);
      assert.equal(receipt.compatibility, fixture.expected.compatibility, fixture.name);
      const serialized = JSON.stringify(receipt);
      for (const secret of fixture.forbidden ?? []) {
        assert.equal(serialized.includes(secret), false, `${fixture.name} retained ${secret}`);
      }
      if (fixture.observation.timedOut) {
        assert.equal(receipt.evidence.timedOut, true);
        assert.ok(receipt.diagnosticCodes.includes("TOOLCHAIN_PROBE_TIMEOUT"));
      }
    }
  });

  it("maps complete, partial, incompatible, unavailable, and disabled probes", () => {
    const definition = TOOLCHAIN_PROFILES.opencli[0]!;
    const now = new Date("2026-07-23T00:00:00.000Z");
    const complete = makeReceipt(definition, {
      observedVersion: "1.8.6",
      capabilities: definition.requiredCapabilities,
      command: ["opencli", "list", "--api-key", "secret-material"],
      output: "private structured output",
      exitCode: 0,
    }, now, 60_000);
    assert.equal(complete.health, "available");
    assert.equal(complete.compatibility, "compatible");
    assert.equal(complete.evidence.command?.includes("secret-material"), false);
    assert.equal(JSON.stringify(complete).includes("private structured output"), false);
    assert.match(complete.evidence.outputDigest ?? "", /^sha256:[a-f0-9]{64}$/);

    const partial = makeReceipt(definition, {
      observedVersion: "1.8.6",
      capabilities: ["version.structured"],
      exitCode: 0,
    }, now, 60_000);
    assert.equal(partial.health, "degraded");
    assert.equal(partial.compatibility, "partial");

    assert.equal(makeReceipt(definition, { observedVersion: "2.0.0", exitCode: 0 }, now, 1).health, "unavailable");
    assert.equal(makeReceipt(definition, { exitCode: 127 }, now, 1).health, "unavailable");
    assert.equal(makeReceipt(definition, { disabled: true }, now, 1).health, "disabled");
  });

  it("selects Graphify legacy and 0.9 profiles and caches immutable receipts", async () => {
    let calls = 0;
    const probe: ToolchainProbe = {
      observe: async () => {
        calls += 1;
        return {
          observedVersion: "0.8.47",
          capabilities: ["graph.query", "graph.read", "result.normalized"],
          exitCode: 0,
        };
      },
    };
    const registry = new ToolchainCapabilityRegistry(probe, 60_000, () => new Date("2026-07-23T00:00:00.000Z"));
    const first = await registry.inspect("graphify");
    const cached = await registry.inspect("graphify");
    assert.equal(first.profileRevision, "graphify/legacy");
    assert.equal(cached.profileRevision, "graphify/legacy");
    assert.equal(calls, 1);

    first.capabilities.push("mutated-by-caller");
    assert.equal(registry.cached("graphify")?.capabilities.includes("mutated-by-caller"), false);
  });

  it("pins current OpenCLI and Graphify discovery/invocation shapes", () => {
    assert.deepEqual(openCliDiscoveryCommand("list"), ["list", "--format", "json"]);
    assert.deepEqual(openCliDiscoveryCommand("help", "zhihu"), ["zhihu", "--help", "--format", "yaml"]);
    assert.deepEqual(openCliDiscoveryCommand("validate", "zhihu"), ["validate", "zhihu", "--format", "json"]);
    assert.deepEqual(openCliDiscoveryCommand("verify", "zhihu"), ["verify", "zhihu", "--format", "json"]);
    assert.deepEqual(openCliDiscoveryCommand("doctor"), ["doctor", "--format", "json"]);
    assert.deepEqual(openCliDiscoveryCommand("profiles"), ["profile", "list", "--format", "json"]);
    assert.deepEqual(openCliDiscoveryCommand("plugins"), ["plugin", "list", "--format", "json"]);
    assert.deepEqual(openCliDiscoveryCommand("adapters"), ["adapter", "status", "--format", "json"]);
    assert.equal(graphifyCompatibilityRevision("graphify 0.8.47"), "graphify/legacy");
    assert.equal(graphifyCompatibilityRevision("graphify 0.9.24"), "graphify/0.9");
    assert.notEqual(
      qmdModelFingerprint("work", "embeddinggemma-300M"),
      qmdModelFingerprint("work", "Qwen3-Embedding-0.6B"),
    );
    assert.deepEqual(
      graphifyQueryCommand("graphify/0.9", "agent wiki", "graphify-out/graph.json", 2000),
      ["query", "agent wiki", "--graph", "graphify-out/graph.json", "--budget", "2000"],
    );
    assert.deepEqual(
      graphifyQueryCommand("graphify/legacy", "agent wiki", "graphify-out/graph.json", 2000),
      ["query", "agent wiki", "--graph", "graphify-out/graph.json", "--budget", "2000"],
    );
  });
});
