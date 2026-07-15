import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { createSettingsService } from "../settings/settings.js";
import {
  resolveKnowledgeAdaptersRuntimeProfile,
  resolveKnowledgeAdapterSecret,
  resolveMemUConnectionString,
} from "./settings-runtime.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function setup(environment: NodeJS.ProcessEnv) {
  const root = mkdtempSync(join(tmpdir(), "llmwiki-adapter-settings-"));
  roots.push(root);
  return createSettingsService({
    vaultPath: root,
    userDevicePath: join(root, "device-settings.json"),
    userDeviceId: "adapter-test-device",
    sessionId: "adapter-test-session",
    environment,
  });
}

async function setSession(
  service: ReturnType<typeof setup>,
  key: string,
  value: unknown,
  expectedRevision: number,
): Promise<void> {
  const result = await service.assignmentSet({
    scope: "session",
    key,
    value: value as never,
    expectedRevision,
    updatedBy: "adapter-settings-test",
  });
  assert.equal(result.status, "committed");
}

describe("knowledge adapter Settings runtime profile", () => {
  it("uses legacy environment only for unassigned fields and never serializes secret values", async () => {
    const environment = {
      VAULT_MIND_ADAPTERS: "filesystem,lightrag,hindsight,kanban,qmd",
      MEMU_DSN: "postgresql://memu-user:memu-secret-material@localhost:5432/memu",
      LIGHTRAG_URL: "http://127.0.0.1:9621",
      LIGHTRAG_API_KEY: "light-secret-material",
      HINDSIGHT_URL: "http://127.0.0.1:8888",
      HINDSIGHT_BANK_ID: "project-bank",
      HINDSIGHT_TIMEOUT_MS: "2500",
      HINDSIGHT_API_KEY: "hindsight-secret-material",
      VAULT_MIND_KANBAN_GLOB: "Boards/**/*.md",
      VAULT_MIND_QMD_COLLECTION: "vault",
    };
    const service = setup(environment);

    const profile = await resolveKnowledgeAdaptersRuntimeProfile(service, { environment });
    const snapshot = await service.snapshotResolve();
    const doctor = await service.doctor();

    assert.equal(profile.enablement.provenance.source, "legacy-env");
    assert.equal(profile.memu.dsn, "postgresql://localhost:5432/memu");
    assert.equal(profile.memu.credential?.provenance.source, "legacy-env");
    assert.equal(profile.lightrag.provenance.baseUrl?.source, "legacy-env");
    assert.equal(profile.lightrag.credential?.provenance.source, "legacy-env");
    assert.equal(profile.hindsight.valid, true);
    assert.equal(profile.hindsight.timeoutMs, 2500);
    assert.equal(profile.hindsight.credential?.provenance.source, "legacy-env");
    assert.equal(profile.kanban.glob, "Boards/**/*.md");
    assert.equal(profile.qmd.collection, "vault");
    assert.equal(JSON.stringify({ profile, snapshot, doctor }).includes("secret-material"), false);
    assert.equal(
      await resolveKnowledgeAdapterSecret(profile.hindsight.credential, { environment }),
      "hindsight-secret-material",
    );
    const privateDsn = await resolveKnowledgeAdapterSecret(profile.memu.credential, { environment });
    assert.equal(resolveMemUConnectionString(profile.memu.dsn, privateDsn), environment.MEMU_DSN);
  });

  it("honors explicit disablement and does not revive adapters from legacy environment", async () => {
    const environment = {
      VAULT_MIND_ADAPTERS: "filesystem,lightrag,hindsight",
      LIGHTRAG_URL: "http://legacy-lightrag.local",
      HINDSIGHT_URL: "http://legacy-hindsight.local",
      HINDSIGHT_BANK_ID: "legacy-bank",
    };
    const service = setup(environment);
    await setSession(service, "adapters.enabled", ["filesystem"], 0);

    const profile = await resolveKnowledgeAdaptersRuntimeProfile(service, { environment });

    assert.deepEqual(profile.enabledAdapters, ["filesystem"]);
    assert.equal(profile.enablement.provenance.source, "settings-assignment");
    assert.equal(profile.lightrag.enabled, false);
    assert.equal(profile.hindsight.enabled, false);
  });

  it("fails closed for an unknown explicit adapter or unresolved explicit Secret Reference", async () => {
    const environment = {
      LIGHTRAG_URL: "http://legacy-lightrag.local",
      LIGHTRAG_API_KEY: "legacy-token-must-not-win",
    };
    const invalidListService = setup(environment);
    await setSession(invalidListService, "adapters.enabled", ["filesystem", "unknown-adapter"], 0);
    const invalidList = await resolveKnowledgeAdaptersRuntimeProfile(invalidListService, { environment });
    assert.equal(invalidList.enablement.valid, false);
    assert.deepEqual(invalidList.enabledAdapters, []);

    const missingSecretService = setup(environment);
    await setSession(missingSecretService, "adapters.enabled", ["lightrag"], 0);
    await setSession(missingSecretService, "adapters.lightrag.base_url", "http://settings-lightrag.local", 1);
    await setSession(missingSecretService, "adapters.lightrag.secret_ref", { provider: "environment", locator: "MISSING_LIGHTRAG_KEY" }, 2);
    const missingSecret = await resolveKnowledgeAdaptersRuntimeProfile(missingSecretService, { environment });

    assert.equal(missingSecret.lightrag.valid, false);
    assert.equal(missingSecret.lightrag.credential?.secretRef.locator, "MISSING_LIGHTRAG_KEY");
    assert.equal(missingSecret.lightrag.credential?.provenance.source, "settings-assignment");
    assert.ok(missingSecret.lightrag.issues.some(issue => issue.code === "adapter-secret-unavailable"));
    await assert.rejects(
      resolveKnowledgeAdapterSecret(missingSecret.lightrag.credential, { environment }),
      /not resolvable/i,
    );
  });

  it("projects Hindsight health from redacted Settings without exposing its device secret", async () => {
    const environment = { HINDSIGHT_DEVICE_KEY: "doctor-secret-material" };
    const service = setup(environment);
    await setSession(service, "adapters.enabled", ["hindsight"], 0);
    await setSession(service, "adapters.hindsight.base_url", "https://hindsight.example", 1);
    await setSession(service, "adapters.hindsight.bank_id", "project-bank", 2);
    await setSession(service, "adapters.hindsight.timeout_ms", 5000, 3);
    await setSession(service, "adapters.hindsight.secret_ref", { provider: "environment", locator: "HINDSIGHT_DEVICE_KEY" }, 4);

    const doctor = await service.doctor();
    const health = doctor.capabilities.find(item => item.capabilityId === "adapters.hindsight");

    assert.equal(health?.state, "available");
    assert.match(health?.summary ?? "", /did not call the external service/i);
    assert.equal(JSON.stringify(doctor).includes("doctor-secret-material"), false);
  });

  it("projects MemU health without opening PostgreSQL or exposing its private DSN", async () => {
    const environment = {
      MEMU_DEVICE_DSN: "postgresql://memu-user:memu-doctor-secret@localhost:5432/memu",
    };
    const service = setup(environment);
    await setSession(service, "adapters.enabled", ["memu"], 0);
    await setSession(service, "adapters.memu.dsn", "postgresql://localhost:5432/memu", 1);
    await setSession(service, "adapters.memu.user_id", "project-user", 2);
    await setSession(service, "adapters.memu.secret_ref", { provider: "environment", locator: "MEMU_DEVICE_DSN" }, 3);

    const doctor = await service.doctor();
    const health = doctor.capabilities.find(item => item.capabilityId === "adapters.memu");

    assert.equal(health?.state, "available");
    assert.match(health?.summary ?? "", /did not connect to PostgreSQL or launch a subprocess/i);
    assert.equal(JSON.stringify(doctor).includes("memu-doctor-secret"), false);
  });

  it("rejects a MemU secret DSN for a different endpoint", () => {
    assert.throws(
      () => resolveMemUConnectionString(
        "postgresql://localhost:5432/memu",
        "postgresql://user:password@elsewhere:5432/memu",
      ),
      /different database endpoint/i,
    );
  });

  it("fails closed without reflecting an invalid legacy MemU DSN", async () => {
    const environment = {
      VAULT_MIND_ADAPTERS: "memu",
      MEMU_DSN: "opaque-memu-secret-material",
    };
    const service = setup(environment);

    const profile = await resolveKnowledgeAdaptersRuntimeProfile(service, { environment });

    assert.equal(profile.memu.valid, false);
    assert.equal(profile.memu.dsn, "");
    assert.ok(profile.memu.issues.some(issue => issue.code === "memu-dsn-invalid"));
    assert.equal(JSON.stringify(profile).includes(environment.MEMU_DSN), false);
  });

  it("rejects query credentials from Settings and redacts them from legacy MemU DSNs", async () => {
    const settingsSecret = "settings-query-secret";
    const settingsService = setup({});
    const rejected = await settingsService.assignmentSet({
      scope: "session",
      key: "adapters.memu.dsn",
      value: `postgresql://localhost:5432/memu?password=${settingsSecret}`,
      expectedRevision: 0,
      updatedBy: "adapter-settings-test",
    });
    assert.equal(rejected.status, "validation-error");
    assert.equal(JSON.stringify(rejected).includes(settingsSecret), false);
    assert.equal(JSON.stringify(await settingsService.snapshotResolve()).includes(settingsSecret), false);

    const legacySecret = "legacy-query-secret";
    const environment = {
      VAULT_MIND_ADAPTERS: "memu",
      MEMU_DSN: `postgresql://localhost:5432/memu?password=${legacySecret}`,
    };
    const legacyService = setup(environment);
    const profile = await resolveKnowledgeAdaptersRuntimeProfile(legacyService, { environment });

    assert.equal(profile.memu.valid, false);
    assert.equal(profile.memu.dsn, "");
    assert.equal(JSON.stringify(profile).includes(legacySecret), false);
  });
});
