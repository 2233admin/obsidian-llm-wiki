import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AGENT_WIKI_CONTRACT_VERSION,
  CAPABILITY_NAMES,
  DIAGNOSTIC_CODES,
  EVIDENCE_TIERS,
  FRESHNESS_STATES,
  PROVIDER_IDS,
} from "../src/index.js";

const SCHEMA_NAMES = [
  "toolchain-capability-profile",
  "ingest-run",
  "contribution-manifest",
  "maintenance-queue-entry",
  "execution-receipt",
  "embedding-fingerprint",
  "query-trace",
] as const;

function json(relative: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("Agent Wiki shared contracts", () => {
  test("publishes each lifecycle contract under a stable versioned schema id", () => {
    const ids = new Set<string>();
    for (const name of SCHEMA_NAMES) {
      const schema = json(`../schemas/${name}.schema.json`);
      assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
      assert.equal(schema.$id, `https://schemas.llmwiki.org/agent-wiki/v1/${name}.schema.json`);
      assert.equal(ids.has(String(schema.$id)), false);
      ids.add(String(schema.$id));
      assert.equal(schema.type, "object");
      assert.equal(schema.additionalProperties, false);
    }
  });

  test("keeps normalized vocabulary identical in TypeScript, fixture, and common schema", () => {
    const fixture = json("../fixtures/v1/vocabulary.json");
    const common = json("../schemas/common.schema.json") as {
      $defs: Record<string, { enum?: string[] }>;
    };
    assert.equal(fixture.schemaVersion, AGENT_WIKI_CONTRACT_VERSION);
    assert.deepEqual(fixture.providerIds, PROVIDER_IDS);
    assert.deepEqual(fixture.diagnosticCodes, DIAGNOSTIC_CODES);
    assert.deepEqual(fixture.evidenceTiers, EVIDENCE_TIERS);
    assert.deepEqual(fixture.freshnessStates, FRESHNESS_STATES);
    assert.deepEqual(fixture.capabilityNames, CAPABILITY_NAMES);
    assert.deepEqual(common.$defs.providerId?.enum, PROVIDER_IDS);
    assert.deepEqual(common.$defs.diagnosticCode?.enum, DIAGNOSTIC_CODES);
    assert.deepEqual(common.$defs.evidenceTier?.enum, EVIDENCE_TIERS);
    assert.deepEqual(common.$defs.freshnessState?.enum, FRESHNESS_STATES);
    assert.deepEqual(common.$defs.capabilityName?.enum, CAPABILITY_NAMES);
    assert.deepEqual(CAPABILITY_NAMES, [...new Set(CAPABILITY_NAMES)].sort());
  });

  test("provides a serialization fixture satisfying every schema's required surface", () => {
    const fixture = json("../fixtures/v1/serialization-cases.json") as {
      schemaVersion: number;
      cases: Record<string, Record<string, unknown>>;
    };
    assert.equal(fixture.schemaVersion, AGENT_WIKI_CONTRACT_VERSION);
    const caseNames = [
      "toolchainCapabilityProfile",
      "ingestRun",
      "contributionManifest",
      "maintenanceQueueEntry",
      "executionReceipt",
      "embeddingFingerprint",
      "queryTrace",
    ];
    assert.equal(Object.keys(fixture.cases).length, caseNames.length);
    SCHEMA_NAMES.forEach((schemaName, index) => {
      const schema = json(`../schemas/${schemaName}.schema.json`) as {
        required: string[];
        properties: Record<string, unknown>;
      };
      const value = fixture.cases[caseNames[index]!]!;
      assert.equal(value.schemaVersion, AGENT_WIKI_CONTRACT_VERSION);
      for (const key of schema.required) assert.ok(key in value, `${caseNames[index]} requires ${key}`);
      for (const key of Object.keys(value)) assert.ok(key in schema.properties, `${caseNames[index]} declares ${key}`);
    });
  });

  test("fixtures never serialize credential material or raw machine paths", () => {
    const serialized = JSON.stringify(json("../fixtures/v1/serialization-cases.json"));
    assert.doesNotMatch(serialized, /(?:api[_-]?key|bearer |password|sk-[a-z0-9]|[a-z]:\\\\users\\)/i);
  });
});
