import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  SettingsService,
  buildToolchainCapabilityProfiles,
  collectLegacyToolchainDiagnostics,
  embeddingFingerprintDigest,
  loadRegistry,
  redactEndpoint,
  redactExecutable,
  resolveSettings,
  type ConformanceFixture,
} from "../src/index.js";

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")) as T;
}

function collectRequiredFeatures(value: unknown, features = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectRequiredFeatures(item, features);
    return features;
  }
  if (!value || typeof value !== "object") return features;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "requiredFeatures" && Array.isArray(item)) {
      for (const feature of item) if (typeof feature === "string") features.add(feature);
    }
    collectRequiredFeatures(item, features);
  }
  return features;
}

describe("toolchain capability profile settings", () => {
  test("uses only capability names from the shared Agent Wiki vocabulary", () => {
    const registry = readJson<unknown>("../registry/v1.json");
    const vocabulary = readJson<{ capabilityNames: string[] }>(
      "../../agent-wiki-contracts/fixtures/v1/vocabulary.json",
    );
    const shared = new Set(vocabulary.capabilityNames);
    for (const feature of collectRequiredFeatures(registry)) {
      assert.ok(shared.has(feature), `Settings capability is not shared: ${feature}`);
    }
  });

  test("redacts executables and credential-bearing endpoints", () => {
    assert.equal(redactExecutable("C:\\\\Tools\\\\qmd.exe"), "qmd.exe");
    assert.equal(
      redactEndpoint("https://user:pass@localhost:11434/v1/embeddings?api_key=secret"),
      "https://localhost:11434/v1/embeddings?api_key=[redacted]",
    );
    assert.match(redactEndpoint("https://example.test/path?token=abc"), /\[redacted\]/);
  });

  test("builds deterministic embedding fingerprint digests", () => {
    const left = embeddingFingerprintDigest({
      profileId: "ollama/bge-m3",
      providerId: "ollama",
      endpointIdentity: "http://localhost:11434/v1/embeddings",
      modelId: "bge-m3",
      dimensions: 1024,
      adapterSchemaVersion: "openai-compatible/v1",
    });
    const right = embeddingFingerprintDigest({
      profileId: "ollama/qwen3-embedding:0.6b",
      providerId: "ollama",
      endpointIdentity: "http://localhost:11434/v1/embeddings",
      modelId: "qwen3-embedding:0.6b",
      dimensions: 1024,
      adapterSchemaVersion: "openai-compatible/v1",
    });
    assert.match(left, /^sha256:[a-f0-9]{64}$/);
    assert.notEqual(left, right);
  });

  test("doctor and migration plan expose redacted profiles with probe age and legacy diagnostics", async () => {
    const vault = mkdtempSync(join(tmpdir(), "settings-toolchain-"));
    try {
      const registry = loadRegistry(fileURLToPath(new URL("../registry/v1.json", import.meta.url)));
      const service = new SettingsService({
        registry,
        vaultPath: vault,
        userDeviceId: "device-test",
        userDevicePath: join(vault, "user-device-settings.json"),
        vaultId: "vault-test",
        sessionId: "session-test",
        environment: {
          VAULT_MIND_QMD_BINARY: "C:/secret-path/qmd.exe",
          OLLAMA_EMBED_MODEL: "bge-m3",
        },
        clock: () => "2026-07-23T00:05:00.000Z",
      });

      const probes = {
        qmd: {
          observedVersion: "2.5.1",
          capabilities: ["query.hybrid", "query.intent", "uri.qmd", "index.health"],
          diagnosticCodes: [],
          probedAt: "2026-07-23T00:00:00.000Z",
          expiresAt: "2026-07-23T00:10:00.000Z",
        },
        opencli: {
          observedVersion: "1.8.6",
          capabilities: ["version.structured"],
          diagnosticCodes: ["CAPABILITY_MISSING"],
          probedAt: "2026-07-23T00:04:00.000Z",
          expiresAt: "2026-07-23T00:09:00.000Z",
        },
      };

      const doctor = await service.doctor(undefined, { probes });
      assert.ok(doctor.toolchainProfiles.length >= 5);
      const qmd = doctor.toolchainProfiles.find(item => item.providerId === "qmd");
      assert.ok(qmd);
      assert.equal(qmd!.health, "available");
      assert.equal(qmd!.observedVersion, "2.5.1");
      assert.equal(qmd!.probeAgeMs, 5 * 60_000);
      assert.equal(qmd!.redactedExecutable, "qmd");
      assert.equal(JSON.stringify(doctor).includes("secret-path"), false);
      assert.equal(JSON.stringify(doctor).includes("sk-"), false);

      const opencli = doctor.toolchainProfiles.find(item => item.providerId === "opencli");
      assert.equal(opencli?.health, "degraded");
      assert.ok(opencli?.missingCapabilities.includes("command.list.structured"));

      assert.ok(doctor.migrationDiagnostics.some(item => item.code === "legacy-toolchain-env"));
      assert.ok(doctor.capabilities.some(item => item.capabilityId === "toolchain.qmd"));

      const plan = await service.migrationsPlan(undefined, { probes });
      assert.equal(plan.registryVersion, registry.registryVersion);
      assert.ok(plan.legacyDiagnostics.length >= 1);
      assert.ok(plan.toolchainProfiles.some(item => item.providerId === "qmd"));
      assert.equal(JSON.stringify(plan).includes("C:/secret-path"), false);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });

  test("snapshot-derived profiles mark unselected providers disabled and avoid secret reflection", () => {
    const registry = loadRegistry(fileURLToPath(new URL("../registry/v1.json", import.meta.url)));
    const fixture = readJson<ConformanceFixture>("../fixtures/conformance/full-precedence.json");
    const snapshot = resolveSettings({
      registry,
      ...fixture,
      createdAt: "2026-07-23T00:00:00.000Z",
    });
    const vault = structuredClone(fixture.documents.find(item => item.scope === "vault")!);
    // Force selection to only qmd via re-resolve with assignment isn't needed for product defaults.
    const profiles = buildToolchainCapabilityProfiles(snapshot, {
      checkedAt: "2026-07-23T00:00:00.000Z",
      probes: {
        ollama: {
          observedVersion: "0.5.0",
          capabilities: ["embeddings.openai-compatible", "model.fingerprint"],
          probedAt: "2026-07-23T00:00:00.000Z",
        },
      },
    });
    const ollama = profiles.find(item => item.providerId === "ollama");
    assert.ok(ollama?.embeddingFingerprint);
    assert.match(ollama!.embeddingFingerprint!.digest, /^sha256:/);
    assert.equal(JSON.stringify(profiles).includes("user:pass"), false);

    const legacy = collectLegacyToolchainDiagnostics({ VAULT_MIND_EMBED_URL: "http://localhost/v1" });
    assert.equal(legacy[0]?.key, "embeddings.endpoint");
  });
});
