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
    assert.equal(read.revision, registry.registryVersion);
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

  test("local Agent model mode overrides the child process without forwarding cloud credentials", async () => {
    const { service } = setup({ OPENAI_API_KEY: "must-not-reach-local", ANTHROPIC_API_KEY: "also-private" });
    for (const [key, value] of [
      ["models.agent.mode", "local"],
      ["models.agent.provider", "openai-compatible"],
      ["models.agent.base_url", "http://127.0.0.1:12345/v1"],
      ["models.agent.model", "local-model"],
    ] as const) {
      const current = await service.scopesGet("session");
      const result = await service.assignmentSet({
        scope: "session",
        key,
        value,
        expectedRevision: current.document.revision,
        updatedBy: "service-test",
      });
      assert.equal(result.status, "committed");
    }

    const profile = await service.agentModelInvocationProfile();
    assert.deepEqual(profile, {
      mode: "local",
      provider: "openai-compatible",
      baseUrl: "http://127.0.0.1:12345/v1",
      model: "local-model",
      credential: {
        secretRef: { provider: "environment", locator: "OPENAI_API_KEY" },
        status: "present",
      },
    });
    assert.equal(JSON.stringify(profile).includes("must-not-reach-local"), false);
    assert.equal((await service.doctor()).capabilities.find(item => item.capabilityId === "models.agent")?.state, "available");
  });

  test("cloud Agent model mode resolves an environment Secret Reference only for the child process", async () => {
    const { service } = setup({ CLOUD_AGENT_KEY: "cloud-secret-material" });
    for (const [key, value] of [
      ["models.agent.mode", "cloud"],
      ["models.agent.provider", "openai-compatible"],
      ["models.agent.base_url", "https://models.example.test/v1"],
      ["models.agent.model", "cloud-model"],
      ["models.agent.secret_ref", { provider: "environment", locator: "CLOUD_AGENT_KEY" }],
    ] as const) {
      const current = await service.scopesGet("session");
      const result = await service.assignmentSet({
        scope: "session",
        key,
        value,
        expectedRevision: current.document.revision,
        updatedBy: "service-test",
      });
      assert.equal(result.status, "committed");
    }

    const profile = await service.agentModelInvocationProfile();
    const snapshot = await service.snapshotResolve();
    assert.equal(profile.credential?.status, "present");
    assert.equal(profile.credential?.secretRef.locator, "CLOUD_AGENT_KEY");
    assert.equal(JSON.stringify(profile).includes("cloud-secret-material"), false);
    assert.equal(JSON.stringify(snapshot).includes("cloud-secret-material"), false);
    assert.equal(JSON.stringify(snapshot).includes("CLOUD_AGENT_KEY"), true);
    assert.equal((await service.doctor()).capabilities.find(item => item.capabilityId === "models.agent")?.state, "available");
  });

  test("cloud Agent model mode refuses an unresolved credential", async () => {
    const { service } = setup();
    const result = await service.assignmentSet({
      scope: "session",
      key: "models.agent.mode",
      value: "cloud",
      expectedRevision: 0,
      updatedBy: "service-test",
    });
    assert.equal(result.status, "committed");

    assert.equal((await service.agentModelInvocationProfile()).credential?.status, "missing");
    const validation = await service.validate();
    assert.ok(validation.issues.some(item => item.code === "agent-model-secret-missing"));
    assert.equal((await service.doctor()).capabilities.find(item => item.capabilityId === "models.agent")?.state, "unavailable");
  });

  test("governs host connectors through Settings and keeps credentials reference-only", async () => {
    const { service } = setup({ HOST_CONNECTOR_KEY: "never-return-this-secret" });
    for (const [key, value] of [
      ["providers.host_capability.enabled", true],
      ["providers.host_capability.provider", "github"],
      ["providers.host_capability.transport", "cloud-model"],
      ["providers.host_capability.endpoint", "https://host.example.test/mcp"],
      ["providers.host_capability.secret_ref", { provider: "environment", locator: "HOST_CONNECTOR_KEY" }],
      ["providers.host_capability.timeout_ms", 15000],
    ] as const) {
      const current = await service.scopesGet("session");
      const result = await service.assignmentSet({
        scope: "session",
        key,
        value,
        expectedRevision: current.document.revision,
        updatedBy: "service-test",
      });
      assert.equal(result.status, "committed");
    }

    const snapshot = await service.snapshotResolve();
    const connector = (await service.doctor()).capabilities
      .find(item => item.capabilityId === "providers.host-capability");
    assert.equal(connector?.state, "available");
    assert.equal(JSON.stringify(snapshot).includes("never-return-this-secret"), false);
    assert.equal(JSON.stringify(snapshot).includes("HOST_CONNECTOR_KEY"), true);
    const profile = await service.hostCapabilityInvocationProfile();
    assert.equal(profile.provider, "github");
    assert.equal(profile.connectorId, "connector/github");
    assert.equal(profile.secretRequired, true);
    assert.equal(profile.credential?.secretRef.locator, "HOST_CONNECTOR_KEY");
    assert.equal(profile.provenance.provider.source, "settings-assignment");
    assert.equal(JSON.stringify(profile).includes("never-return-this-secret"), false);
  });

  test("normalizes generic and canonical Host connector selectors without granting registry authority", async () => {
    for (const selector of ["reviewed-expert", "connector/reviewed-expert"] as const) {
      const { service } = setup();
      for (const [key, value] of [
        ["providers.host_capability.enabled", true],
        ["providers.host_capability.provider", selector],
        ["providers.host_capability.transport", "stdio"],
        ["providers.host_capability.endpoint", "stdio://reviewed-expert?arg=serve"],
      ] as const) {
        const current = await service.scopesGet("session");
        const result = await service.assignmentSet({
          scope: "session", key, value, expectedRevision: current.document.revision, updatedBy: "service-test",
        });
        assert.equal(result.status, "committed");
      }
      const profile = await service.hostCapabilityInvocationProfile();
      assert.equal(profile.provider, selector);
      assert.equal(profile.connectorId, "connector/reviewed-expert");
      assert.equal(profile.secretRequired, false);
      assert.equal((await service.doctor()).capabilities
        .find(item => item.capabilityId === "providers.host-capability")?.state, "available");
    }
  });

  test("resolves explicit Settings over generic Host environment compatibility with field provenance", async () => {
    const { service } = setup({ GITHUB_TOKEN: "legacy-secret", LINEAR_TOKEN: "legacy-linear" });
    for (const [key, value] of [
      ["providers.host_capability.enabled", true],
      ["providers.host_capability.provider", "gitea"],
      ["providers.host_capability.endpoint", "https://gitea.example.test/api/v1"],
      ["providers.host_capability.secret_ref", { provider: "environment", locator: "GITEA_TOKEN" }],
    ] as const) {
      const current = await service.scopesGet("session");
      const result = await service.assignmentSet({
        scope: "session", key, value, expectedRevision: current.document.revision, updatedBy: "service-test",
      });
      assert.equal(result.status, "committed");
    }
    const profile = await service.hostCapabilityInvocationProfile(service.defaultContext, [{
      source: "legacy-environment",
      priority: 100,
      detail: "generic Host compatibility environment",
      values: {
        enabled: true,
        provider: "legacy-host",
        transport: "http",
        endpoint: "https://legacy-host.example.test/mcp",
        credential: { secretRef: { provider: "environment", locator: "LLMWIKI_HOST_CAPABILITY_KEY" }, status: "present" },
      },
    }]);
    assert.equal(profile.provider, "gitea");
    assert.equal(profile.endpoint, "https://gitea.example.test/api/v1");
    assert.equal(profile.transport, "http");
    assert.equal(profile.provenance.provider.priority, 300);
    assert.equal(profile.provenance.transport.source, "legacy-environment");
    assert.equal(profile.credential?.secretRef.locator, "GITEA_TOKEN");
    assert.equal(profile.credential?.status, "missing");
  });

  test("uses legacy compatibility only when Settings has no explicit assignment", async () => {
    const { service } = setup({ LINEAR_TOKEN: "legacy-linear-secret" });
    const profile = await service.hostCapabilityInvocationProfile(service.defaultContext, [{
      source: "legacy-environment",
      priority: 100,
      detail: "unique token environment",
      values: {
        enabled: true,
        provider: "linear",
        transport: "http",
        endpoint: "https://api.linear.app/graphql",
        credential: { secretRef: { provider: "environment", locator: "LINEAR_TOKEN" }, status: "present" },
      },
    }]);
    assert.equal(profile.enabled, true);
    assert.equal(profile.provider, "linear");
    assert.equal(profile.provenance.enabled.source, "legacy-environment");
    assert.equal(profile.provenance.timeoutMs.source, "product-default");
    assert.equal(JSON.stringify(profile).includes("legacy-linear-secret"), false);
  });

  test("never attaches a legacy credential from a different provider", async () => {
    const { service } = setup({ GITHUB_TOKEN: "legacy-github-secret" });
    for (const [key, value] of [
      ["providers.host_capability.enabled", true],
      ["providers.host_capability.provider", "gitea"],
      ["providers.host_capability.transport", "http"],
      ["providers.host_capability.endpoint", "https://git.example.test/api/v1"],
    ] as const) {
      const current = await service.scopesGet("session");
      const result = await service.assignmentSet({
        scope: "session", key, value, expectedRevision: current.document.revision, updatedBy: "service-test",
      });
      assert.equal(result.status, "committed");
    }

    const profile = await service.hostCapabilityInvocationProfile(service.defaultContext, [{
      source: "legacy-environment",
      priority: 100,
      detail: "unique legacy token locator GITHUB_TOKEN",
      values: {
        enabled: true,
        provider: "github",
        transport: "http",
        endpoint: "https://api.github.com",
        credential: { secretRef: { provider: "environment", locator: "GITHUB_TOKEN" }, status: "present" },
      },
    }]);

    assert.equal(profile.provider, "gitea");
    assert.notEqual(profile.credential?.secretRef.locator, "GITHUB_TOKEN");
    assert.equal(profile.credential?.status, "missing");
    assert.equal(profile.provenance.credential.source, "product-default");
    assert.equal(JSON.stringify(profile).includes("legacy-github-secret"), false);
  });

  test("keeps the Dream Time auto-approval hook disabled and warns when pre-enabled", async () => {
    const { service } = setup();
    assert.equal((await service.doctor()).capabilities
      .find(item => item.capabilityId === "agents.dream-time-approval")?.state, "disabled");

    const result = await service.assignmentSet({
      scope: "session",
      key: "agents.dream_time.warning_free_auto_approval",
      value: true,
      expectedRevision: 0,
      updatedBy: "service-test",
    });
    assert.equal(result.status, "committed");
    assert.ok((await service.validate()).issues
      .some(item => item.code === "dream-time-auto-approval-reserved"));
    assert.equal((await service.doctor()).capabilities
      .find(item => item.capabilityId === "agents.dream-time-approval")?.state, "degraded");
  });

  test("keeps daily, weekly, and monthly Dream Time cadence disabled by default", async () => {
    const { service } = setup();
    const { snapshot } = await service.snapshotResolve();
    const values = new Map(snapshot.effective.map(item => [item.key, item.value]));

    assert.equal(values.get("agents.dream_time.cadence.daily.enabled"), false);
    assert.equal(values.get("agents.dream_time.cadence.weekly.enabled"), false);
    assert.equal(values.get("agents.dream_time.cadence.monthly.enabled"), false);
  });

  test("inherit Agent model mode is a healthy compatibility path", async () => {
    const { service } = setup({
      COMPILE_PROVIDER: "openai-compatible",
      OPENAI_BASE_URL: "https://legacy.example.test/v1",
      COMPILE_MODEL: "legacy-model",
    });

    const capability = (await service.doctor()).capabilities.find(item => item.capabilityId === "models.agent");
    assert.equal(capability?.state, "available");
    assert.equal(capability?.evidence[0]?.status, "pass");
    assert.deepEqual(capability?.remediations, []);
  });

  test("rejects credential-bearing Agent URLs and unsupported project-scoped bindings", async () => {
    const { service } = setup();
    const urlResult = await service.assignmentSet({
      scope: "session",
      key: "models.agent.base_url",
      value: "https://user:password@models.example.test/v1",
      expectedRevision: 0,
      updatedBy: "service-test",
    });
    assert.equal(urlResult.status, "validation-error");
    assert.ok(urlResult.validation.issues.some(item => item.code === "url-credentials-forbidden"));
    assert.equal(JSON.stringify(await service.scopesGet("session")).includes("password"), false);

    const projectResult = await service.assignmentSet({
      scope: "workspace-project",
      targetId: "project/alpha",
      key: "models.agent.model",
      value: "project-model",
      expectedRevision: 0,
      updatedBy: "service-test",
    });
    assert.equal(projectResult.status, "validation-error");
    assert.ok(projectResult.validation.issues.some(item => item.code === "scope-not-allowed"));
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
