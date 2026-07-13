import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  bundledRegistry,
  explainSetting,
  loadRegistry,
  parseRegistry,
  resolveSettings,
  validateEffectiveValue,
  validateSettingsDocuments,
  type ConformanceFixture,
  type SettingsRegistry,
  type SettingsSnapshot,
  type SettingDefinition,
} from "../src/index.js";

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")) as T;
}

describe("shared settings conformance fixture", () => {
  test("uses the same canonical number spelling expected by the Python runtime", () => {
    assert.equal(
      canonicalJson({ tiny: 1e-7, fixed: 1e-6, integer: 1.0, negativeZero: -0 }),
      '{"fixed":0.000001,"integer":1,"negativeZero":0,"tiny":1e-7}',
    );
  });

  test("uses UTF-16 ordering for canonical non-BMP object keys", () => {
    assert.equal(canonicalJson({ "\ue000": 2, "😀": 1 }), '{"😀":1,"":2}');
  });

  test("bundles the same registry used by external JSON consumers", () => {
    const fromFile = loadRegistry(fileURLToPath(new URL("../registry/v1.json", import.meta.url)));
    assert.equal(canonicalJson(bundledRegistry()), canonicalJson(fromFile));
  });

  test("rejects incomplete setting definitions before they enter either runtime", () => {
    const raw = readJson<Record<string, unknown>>("../registry/v1.json");
    const definitions = raw.definitions as Array<Record<string, unknown>>;
    delete definitions[0]!.owner;

    assert.throws(() => parseRegistry(raw), /metadata|owner/i);
  });

  test("matches every shared bounded-value validation result", () => {
    const fixture = readJson<{
      cases: Array<{ definition: SettingDefinition; value: unknown; expectedCodes: string[] }>;
    }>("../fixtures/conformance/validation-cases.json");
    for (const item of fixture.cases) {
      const result = validateEffectiveValue(item.definition, item.value);
      assert.deepEqual(result.issues.map(issue => issue.code), item.expectedCodes);
    }
  });

  test("resolves deterministic precedence, provenance, unset values, and redacted secrets", () => {
    const registry = loadRegistry(fileURLToPath(new URL("../registry/v1.json", import.meta.url)));
    const fixture = readJson<ConformanceFixture>("../fixtures/conformance/full-precedence.json");
    const expected = readJson<SettingsSnapshot>("../fixtures/expected/full-precedence.snapshot.json");

    const actual = resolveSettings({ registry, ...fixture });

    assert.equal(canonicalJson(actual), canonicalJson(expected));
    assert.equal(canonicalJson(actual).includes("sk-"), false);

    const explained = explainSetting({ registry, ...fixture, key: "query.semantic.enabled" });
    assert.equal(explained.winningScope, "workspace-project");
    assert.deepEqual(
      explained.candidates.map(candidate => [candidate.scope, candidate.state]),
      [
        ["session", "unset"],
        ["workspace-project", "selected"],
        ["vault", "overridden"],
        ["user-device", "not-allowed"],
        ["product", "overridden"],
      ],
    );
  });

  test("applies precedence and unset fallback for every supported setting type", () => {
    const fixture = readJson<{ cases: Array<Record<string, unknown> & { valueType: SettingDefinition["valueType"] }> }>(
      "../fixtures/conformance/all-types-precedence.json",
    );
    for (const [index, item] of fixture.cases.entries()) {
      const secret = item.valueType === "secret-reference";
      const definition: SettingDefinition = {
        key: `tests.type_${index}.value`,
        owner: "tests",
        category: "tests",
        name: `Type ${item.valueType}`,
        description: `Shared precedence fixture for ${item.valueType}.`,
        valueType: item.valueType,
        ...(secret ? { defaultSecretRef: item.defaultSecretRef as SettingDefinition["defaultSecretRef"] } : { defaultValue: item.defaultValue as SettingDefinition["defaultValue"] }),
        allowedScopes: ["vault", "session"],
        sensitivity: secret ? "secret-reference" : "public",
        validator: (item.validator as SettingDefinition["validator"] | undefined) ?? { id: `fixture-${item.valueType}` },
        requires: [],
        applyMode: "hot",
        visibility: "internal",
      };
      const registry: SettingsRegistry = {
        schemaVersion: 1,
        registryVersion: "fixture",
        registryDigest: "sha256:fixture",
        definitions: [definition],
        migrations: [],
      };
      const assignment = (scope: "vault" | "session", value: unknown) => ({
        schemaVersion: 1 as const,
        scope,
        targetId: `${scope}-test`,
        revision: 1,
        assignments: [{
          key: definition.key,
          ...(secret ? { secretRef: value as NonNullable<SettingDefinition["defaultSecretRef"]> } : { value: value as NonNullable<SettingDefinition["defaultValue"]> }),
          provenance: { actor: "fixture", source: scope },
        }],
        updatedAt: "2026-07-14T00:00:00.000Z",
        updatedBy: "fixture",
      });
      const context = { userDeviceId: "device-test", vaultId: "vault-test", sessionId: "session-test" };
      const secretStatus = secret ? {
        [`${(item.defaultSecretRef as { provider: string; locator: string }).provider}:${(item.defaultSecretRef as { provider: string; locator: string }).locator}`]: "present" as const,
        [`${(item.lowerSecretRef as { provider: string; locator: string }).provider}:${(item.lowerSecretRef as { provider: string; locator: string }).locator}`]: "present" as const,
        [`${(item.higherSecretRef as { provider: string; locator: string }).provider}:${(item.higherSecretRef as { provider: string; locator: string }).locator}`]: "present" as const,
      } : {};
      const resolved = resolveSettings({
        registry,
        context,
        documents: [
          assignment("vault", secret ? item.lowerSecretRef : item.lowerValue),
          assignment("session", secret ? item.higherSecretRef : item.higherValue),
        ],
        createdAt: "2026-07-14T00:00:00.000Z",
        secretStatus,
      });
      const unset = resolveSettings({
        registry,
        context,
        documents: [],
        createdAt: "2026-07-14T00:00:00.000Z",
        secretStatus,
      });

      assert.equal(resolved.effective[0]!.winningScope, "session", item.valueType);
      assert.equal(resolved.effective[0]!.overriddenCandidates[0]?.scope, "vault", item.valueType);
      assert.equal(unset.effective[0]!.winningScope, "product", item.valueType);
      if (secret) {
        assert.deepEqual((resolved.effective[0]!.value as { secretRef: unknown }).secretRef, item.higherSecretRef);
        assert.deepEqual((unset.effective[0]!.value as { secretRef: unknown }).secretRef, item.defaultSecretRef);
      } else {
        assert.deepEqual(resolved.effective[0]!.value, item.higherValue);
        assert.deepEqual(unset.effective[0]!.value, item.defaultValue);
      }
    }
  });

  test("validates the complete scope and rejects scope leaks and plaintext secret material", () => {
    const registry = loadRegistry(fileURLToPath(new URL("../registry/v1.json", import.meta.url)));
    const fixture = readJson<ConformanceFixture>("../fixtures/conformance/full-precedence.json");
    const documents = structuredClone(fixture.documents);
    documents[1]!.assignments.push({
      key: "runtime.python.path",
      value: "python3",
      provenance: { actor: "bad-fixture", source: "test" },
    });
    documents[0]!.assignments = documents[0]!.assignments.filter(
      assignment => assignment.key !== "providers.web_search.secret_ref",
    );
    documents[0]!.assignments.push({
      key: "providers.web_search.secret_ref",
      value: "sk-plaintext-must-never-persist",
      provenance: { actor: "bad-fixture", source: "test" },
    });

    const result = validateSettingsDocuments(registry, documents, fixture.context);

    assert.equal(result.valid, false);
    assert.ok(result.issues.some(issue => issue.code === "scope-not-allowed"));
    assert.ok(result.issues.some(issue => issue.code === "invalid-secret-reference"));
    assert.equal(canonicalJson(result).includes("sk-plaintext-must-never-persist"), false);
  });

  test("requires RFC 3339 timestamps instead of accepting date-only host coercions", () => {
    const registry = loadRegistry(fileURLToPath(new URL("../registry/v1.json", import.meta.url)));
    const fixture = readJson<ConformanceFixture>("../fixtures/conformance/full-precedence.json");
    const document = structuredClone(fixture.documents[0]!);
    document.updatedAt = "2026-07-14";

    const result = validateSettingsDocuments(registry, [document]);

    assert.equal(result.valid, false);
    assert.ok(result.issues.some(issue => issue.code === "invalid-updated-at"));
  });

  test("rejects non-canonical project identities and secret material disguised as locators", () => {
    const registry = loadRegistry(fileURLToPath(new URL("../registry/v1.json", import.meta.url)));
    const fixture = readJson<ConformanceFixture>("../fixtures/conformance/full-precedence.json");
    const invalidProject = structuredClone(fixture.documents.find(item => item.scope === "workspace-project")!);
    invalidProject.targetId = "project-alpha";
    const projectResult = validateSettingsDocuments(registry, [invalidProject], {
      ...fixture.context,
      workspaceProjectId: "project-alpha",
    });
    assert.equal(projectResult.valid, false);
    assert.ok(projectResult.issues.some(issue => issue.code === "invalid-workspace-project-id"));

    const secretDocument = structuredClone(fixture.documents[0]!);
    const secret = secretDocument.assignments.find(item => item.key === "providers.web_search.secret_ref")!;
    for (const secretRef of [
      { provider: "environment", locator: "not-an-environment-variable" },
      { provider: "environment", locator: "sk-1234567890abcdef" },
      { provider: "os-keychain", locator: "one-segment" },
      { provider: "external-vault", locator: "../secret" },
      { provider: "external-vault", locator: "Bearer abcdefghijk" },
    ]) {
      delete secret.value;
      secret.secretRef = secretRef as never;
      const result = validateSettingsDocuments(registry, [secretDocument]);
      assert.equal(result.valid, false, JSON.stringify(secretRef));
      assert.ok(result.issues.some(issue => issue.code === "invalid-secret-reference"));
    }
  });
});
