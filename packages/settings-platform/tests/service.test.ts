import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  defaultUserDeviceId,
  ProductSettingsStore,
  SettingsService,
  loadRegistry,
} from "../src/index.js";

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function setup(environment: NodeJS.ProcessEnv = {}) {
  const vaultPath = mkdtempSync(join(tmpdir(), "llmwiki-settings-service-"));
  roots.push(vaultPath);
  const registry = loadRegistry(fileURLToPath(new URL("../registry/v1.json", import.meta.url)));
  const service = new SettingsService({
    registry,
    vaultPath,
    userDevicePath: join(vaultPath, "device.json"),
    userDeviceId: "service-device",
    pythonPath: "definitely-not-a-python-executable",
    compilerPath: join(vaultPath, "compiler", "kb_meta.py"),
    environment,
    clock: () => "2026-07-14T00:00:00.000Z",
  });
  return { registry, service, vaultPath };
}

describe("settings service operations", () => {
  test("exposes product defaults through the same scope-read service", async () => {
    const { registry, service } = setup();

    const product = await service.scopesGet("product");

    assert.equal(product.scope, "product");
    assert.equal(product.revision, registry.registryVersion);
  });

  test("derives a stable user-device identity when the host does not provide one", () => {
    const { registry } = setup();
    const vaultPath = mkdtempSync(join(tmpdir(), "llmwiki-settings-default-device-"));
    roots.push(vaultPath);
    const service = new SettingsService({
      registry,
      vaultPath,
      userDevicePath: join(vaultPath, "device.json"),
      environment: {},
    });

    assert.equal(service.defaultContext.userDeviceId, defaultUserDeviceId({}));
    assert.equal(service.defaultContext.userDeviceId, defaultUserDeviceId({}));
    assert.doesNotMatch(service.defaultContext.userDeviceId, new RegExp(String(process.pid)));
  });

  test("makes product defaults an explicit read-only scope store", () => {
    const { registry } = setup();
    const product = new ProductSettingsStore(registry);
    const read = product.read();

    assert.equal(read.scope, "product");
    assert.equal(read.revision, "1.0.0");
    assert.equal(read.defaults.length, registry.definitions.length);
    assert.throws(() => product.set(), /read-only/i);
  });

  test("doctor reports all four canonical health states with evidence and remediation", async () => {
    const { service } = setup();
    await service.assignmentSet({
      scope: "session",
      key: "providers.web_search.enabled",
      value: true,
      expectedRevision: 0,
      updatedBy: "service-test",
    });
    await service.assignmentSet({
      scope: "session",
      key: "diagnostics.obc.semantic.enabled",
      value: true,
      expectedRevision: 1,
      updatedBy: "service-test",
    });
    await service.assignmentSet({
      scope: "session",
      key: "providers.web_search.secret_ref",
      value: { provider: "external-vault", locator: "providers/web-search" },
      expectedRevision: 2,
      updatedBy: "service-test",
    });

    const doctor = await service.doctor();
    const states = new Set(doctor.capabilities.map(capability => capability.state));

    assert.deepEqual(states, new Set(["available", "degraded", "unavailable", "disabled"]));
    assert.ok(doctor.capabilities.every(capability => capability.evidence.length > 0));
    assert.ok(doctor.capabilities
      .filter(capability => capability.state === "degraded" || capability.state === "unavailable")
      .every(capability => capability.remediations.length > 0));
  });

  test("degrades semantic diagnostics when its enabled query runtime is unavailable", async () => {
    const { service } = setup();
    await service.assignmentSet({
      scope: "session",
      key: "query.semantic.enabled",
      value: true,
      expectedRevision: 0,
      updatedBy: "service-test",
    });
    await service.assignmentSet({
      scope: "session",
      key: "diagnostics.obc.semantic.enabled",
      value: true,
      expectedRevision: 1,
      updatedBy: "service-test",
    });

    const doctor = await service.doctor();
    const diagnostics = doctor.capabilities.find(capability => capability.capabilityId === "diagnostics.obc.semantic")!;

    assert.equal(diagnostics.state, "degraded");
    assert.equal(diagnostics.evidence[0]?.status, "warn");
    assert.ok(diagnostics.remediations.some(item => item.code === "repair-python"));
  });

  test("set and unset reveal lower values while migrations planning remains read-only", async () => {
    const { service } = setup({ TAVILY_API_KEY: "not-returned" });
    const set = await service.assignmentSet({
      scope: "session",
      key: "query.semantic.enabled",
      value: true,
      expectedRevision: 0,
      updatedBy: "service-test",
    });
    assert.equal(set.status, "committed");
    assert.equal((await service.snapshotExplain("query.semantic.enabled")).winningScope, "session");

    const unset = await service.assignmentUnset({
      scope: "session",
      key: "query.semantic.enabled",
      expectedRevision: 1,
      updatedBy: "service-test",
    });
    assert.equal(unset.status, "committed");
    assert.equal((await service.snapshotExplain("query.semantic.enabled")).winningScope, "product");
    assert.equal((await service.migrationsPlan()).writeRequired, false);
  });

  test("plans a registered migration without requiring the legacy document to validate as v1", async () => {
    const { service, vaultPath } = setup();
    const directory = join(vaultPath, "_llmwiki", "settings");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "vault.json"), JSON.stringify({
      schemaVersion: 0,
      scope: "vault",
      targetId: service.defaultContext.vaultId,
      revision: 3,
      assignments: [],
      updatedAt: "2026-07-14T00:00:00.000Z",
      updatedBy: "legacy-host",
    }));

    const plan = await service.migrationsPlan();
    const vault = plan.scopes.find(item => item.scope === "vault")!;

    assert.equal(vault.currentSchemaVersion, 0);
    assert.equal(vault.requiresMigration, true);
    assert.deepEqual(vault.migrations.map(item => item.id), ["settings-document-v0-to-v1"]);
  });
});
