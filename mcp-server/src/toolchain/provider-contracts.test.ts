import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  OPENCLI_BOUNDARY,
  OPENCLI_CAPABILITY_NAMES,
  OPENCLI_PROFILE_REVISION,
  assertOpenCliCaptureBoundary,
  graphifyCompatibilityRevision,
  graphifyQueryCommand,
  normalizeOpenCliDiscovery,
  openCliCaptureCommand,
  openCliCompatibilitySurface,
  openCliDiscoveryCommand,
  qmdModelFingerprint,
  redactOpenCliCommand,
  type OpenCliInvocationObservation,
} from "./provider-contracts.js";

describe("OpenCLI provider contracts (3.3)", () => {
  it("advertises only capability names from the shared Agent Wiki vocabulary", () => {
    const vocabulary = JSON.parse(
      readFileSync(
        new URL("../../../packages/agent-wiki-contracts/fixtures/v1/vocabulary.json", import.meta.url),
        "utf8",
      ),
    ) as { capabilityNames: string[] };
    const shared = new Set(vocabulary.capabilityNames);
    for (const capability of OPENCLI_CAPABILITY_NAMES) {
      assert.ok(shared.has(capability), `OpenCLI capability is not shared: ${capability}`);
    }
  });

  it("pins structured discovery command shapes for all surfaces", () => {
    assert.deepEqual(openCliDiscoveryCommand("version"), ["--version"]);
    assert.deepEqual(openCliDiscoveryCommand("list"), ["list", "--format", "json"]);
    assert.deepEqual(openCliDiscoveryCommand("help"), ["--help", "--format", "yaml"]);
    assert.deepEqual(openCliDiscoveryCommand("help", "zhihu"), ["zhihu", "--help", "--format", "yaml"]);
    assert.deepEqual(openCliDiscoveryCommand("validate", "zhihu"), ["validate", "zhihu", "--format", "json"]);
    assert.deepEqual(openCliDiscoveryCommand("verify", "zhihu"), ["verify", "zhihu", "--format", "json"]);
    assert.deepEqual(openCliDiscoveryCommand("doctor"), ["doctor", "--format", "json"]);
    assert.deepEqual(openCliDiscoveryCommand("profiles"), ["profile", "list", "--format", "json"]);
    assert.deepEqual(openCliDiscoveryCommand("plugins"), ["plugin", "list", "--format", "json"]);
    assert.deepEqual(openCliDiscoveryCommand("adapters"), ["adapter", "status", "--format", "json"]);
  });

  it("keeps capture invocations inside the capture Provider boundary", () => {
    assert.deepEqual(
      openCliCaptureCommand("capture.page", "https://example.com"),
      ["capture", "page", "https://example.com", "--format", "json"],
    );
    assert.throws(() => assertOpenCliCaptureBoundary("source.register"), /OPENCLI_BOUNDARY_VIOLATION/);
    assert.throws(() => assertOpenCliCaptureBoundary("vault.write"), /OPENCLI_BOUNDARY_VIOLATION/);
    assert.throws(() => assertOpenCliCaptureBoundary("promote"), /OPENCLI_BOUNDARY_VIOLATION/);
    assert.doesNotThrow(() => assertOpenCliCaptureBoundary("capture.article"));
  });

  it("matches golden discovery fixtures for success, partial, timeout, and redaction", () => {
    const fixtures = JSON.parse(
      readFileSync(new URL("./fixtures/opencli-discovery-cases.json", import.meta.url), "utf8"),
    ) as Array<{
      name: string;
      observation: OpenCliInvocationObservation;
      expected: {
        ok?: boolean;
        partial?: boolean;
        timedOut?: boolean;
        observedVersion?: string;
        capabilities?: string[];
        missingCapabilities?: string[];
        diagnosticCodes?: string[];
        boundary?: string;
        forbidden?: string[];
      };
    }>;

    for (const fixture of fixtures) {
      const result = normalizeOpenCliDiscovery(fixture.observation);
      assert.equal(result.schemaVersion, 1, fixture.name);
      assert.equal(result.profileRevision, OPENCLI_PROFILE_REVISION, fixture.name);
      assert.equal(result.boundary, OPENCLI_BOUNDARY, fixture.name);
      if (fixture.expected.ok !== undefined) {
        assert.equal(result.ok, fixture.expected.ok, `${fixture.name} ok`);
      }
      if (fixture.expected.partial !== undefined) {
        assert.equal(result.partial, fixture.expected.partial, `${fixture.name} partial`);
      }
      if (fixture.expected.timedOut !== undefined) {
        assert.equal(result.timedOut, fixture.expected.timedOut, `${fixture.name} timedOut`);
      }
      if (fixture.expected.observedVersion !== undefined) {
        assert.equal(result.observedVersion, fixture.expected.observedVersion, fixture.name);
      }
      if (fixture.expected.capabilities) {
        for (const cap of fixture.expected.capabilities) {
          assert.ok(result.capabilities.includes(cap as never), `${fixture.name} missing cap ${cap}`);
        }
      }
      if (fixture.expected.missingCapabilities) {
        assert.deepEqual(
          result.missingCapabilities,
          fixture.expected.missingCapabilities,
          `${fixture.name} missingCapabilities`,
        );
      }
      if (fixture.expected.diagnosticCodes) {
        for (const code of fixture.expected.diagnosticCodes) {
          assert.ok(
            result.diagnosticCodes.includes(code as never),
            `${fixture.name} missing diagnostic ${code}: ${result.diagnosticCodes.join(",")}`,
          );
        }
      }
      if (fixture.expected.boundary) {
        assert.equal(result.boundary, fixture.expected.boundary, fixture.name);
      }
      const serialized = JSON.stringify(result);
      for (const secret of fixture.expected.forbidden ?? []) {
        assert.equal(serialized.includes(secret), false, `${fixture.name} retained ${secret}`);
      }
      assert.equal(serialized.includes("user:pass"), false, fixture.name);
    }
  });

  it("redacts secrets from discovery commands without changing argv length semantics", () => {
    const redacted = redactOpenCliCommand([
      "opencli",
      "--api-key",
      "super-secret",
      "https://user:pass@host.example/path?api_key=q",
      "bearer sk-abcdefghi",
    ]);
    assert.equal(redacted.includes("super-secret"), false);
    assert.equal(redacted.some((part) => part.includes("user:pass")), false);
    assert.ok(redacted.includes("[redacted]") || redacted.some((part) => part.includes("[redacted]")));
  });

  it("exports a capture-only compatibility surface for ingest preflight", () => {
    const surface = openCliCompatibilitySurface();
    assert.equal(surface.boundary, OPENCLI_BOUNDARY);
    assert.equal((surface.authority as { vault: boolean }).vault, false);
    assert.equal((surface.authority as { promotion: boolean }).promotion, false);
    assert.equal((surface.authority as { capture: boolean }).capture, true);
    assert.ok((surface.discovery as Record<string, unknown>).validate);
    assert.ok((surface.discovery as Record<string, unknown>).help);
  });
});

describe("shared graphify/qmd contract pins", () => {
  it("retains graphify revision selection and qmd fingerprints", () => {
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
  });
});
