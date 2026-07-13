import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPythonInvocation, parseExecutableCommand } from "../src/executable-command";
import { InProcessSettingsTransport } from "../src/settings-host";
import {
  applyPluginDataMigration,
  parseSettingInput,
  planPluginDataMigration,
  rollbackPluginDataMigration,
  selectEditingScope,
} from "../src/settings";
import {
  effectiveSetting,
  redactedSecretLabel,
  refreshSettingsProjection,
  SettingsConflictError,
  SettingsOperationClient,
  type SettingsOperationTransport,
  type SettingsSnapshot,
} from "../src/settings-client";
import type {
  SettingAssignment,
  SettingsDocument,
  SettingsMutationResult,
  ValidationResult,
} from "../../packages/settings-platform/src/types";

function document(revision = 0, assignments: SettingAssignment[] = []): SettingsDocument {
  return {
    schemaVersion: 1,
    scope: "user-device",
    targetId: "device/test",
    revision,
    assignments,
    updatedAt: "2026-07-14T00:00:00.000Z",
    updatedBy: "test",
  };
}

function snapshot(revision = 0): SettingsSnapshot {
  return {
    snapshotId: `snapshot-${revision}`,
    registryVersion: "1.0.0",
    context: { userDeviceId: "device/test", vaultId: "vault-test", sessionId: "session-test" },
    sourceRevisions: {
      "user-device": { targetId: "device/test", revision },
      vault: { targetId: "vault-test", revision: 0 },
    },
    effective: [{
      key: "runtime.python.path",
      value: "python",
      winningScope: "product",
      assignmentProvenance: { actor: "registry", source: "registry/v1.json" },
      validation: { valid: true, issues: [] },
      applyMode: "next-operation",
      overriddenCandidates: [],
    }],
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}

class FakeTransport implements SettingsOperationTransport {
  readonly calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  readonly documents = new Map<string, SettingsDocument>([["user-device", document()]]);
  conflict = false;
  failKey: string | undefined;
  doctorFails = false;

  async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
    this.calls.push({ operation, args });
    if (operation === "settings.definitions.list") {
      return { definitions: [{
        key: "runtime.python.path",
        owner: "runtime.python",
        category: "runtime",
        name: "Python runtime",
        description: "Interpreter command",
        valueType: "path",
        defaultValue: "python",
        allowedScopes: ["user-device", "session"],
        sensitivity: "local",
        validator: { id: "non-empty-path", required: true },
        requires: [],
        applyMode: "next-operation",
        visibility: "normal",
      }] } as T;
    }
    if (operation === "settings.snapshot.resolve") {
      const revision = this.documents.get("user-device")?.revision ?? 0;
      return { snapshot: snapshot(revision), validation: { valid: true, issues: [] }, recoveryDiagnostics: [] } as T;
    }
    if (operation === "settings.scopes.get") {
      const scope = String(args.scope);
      const current = this.documents.get(scope) ?? { ...document(), scope: scope as SettingsDocument["scope"], targetId: `${scope}/test` };
      this.documents.set(scope, current);
      return { document: structuredClone(current), recoveredFromBackup: false, diagnostics: [] } as T;
    }
    if (operation === "settings.doctor") {
      if (this.doctorFails) throw new Error("probe process unavailable");
      return {
        validation: { valid: true, issues: [] },
        capabilities: [{
          capabilityId: "settings.contract",
          state: "available",
          summary: "ready",
          evidence: [],
          remediations: [],
          checkedAt: "2026-07-14T00:00:00.000Z",
          snapshotId: "snapshot-0",
        }],
        checkedAt: "2026-07-14T00:00:00.000Z",
      } as T;
    }
    if (operation === "settings.validate") return { valid: true, issues: [] } satisfies ValidationResult as T;
    if (operation === "settings.assignment.set" || operation === "settings.assignment.unset") {
      const scope = String(args.scope);
      const current = this.documents.get(scope) ?? document();
      if (this.conflict) {
        return {
          status: "conflict",
          document: current,
          conflict: {
            scope: current.scope,
            targetId: current.targetId,
            expectedRevision: Number(args.expectedRevision),
            actualRevision: 9,
            changedKeys: [],
          },
        } satisfies SettingsMutationResult as T;
      }
      if (args.key === this.failKey) {
        return {
          status: "validation-error",
          document: current,
          validation: { valid: false, issues: [{ code: "test", severity: "error", message: "forced failure" }] },
        } satisfies SettingsMutationResult as T;
      }
      assert.equal(args.expectedRevision, current.revision);
      const assignments = current.assignments.filter(item => item.key !== args.key);
      if (operation.endsWith(".set")) {
        assignments.push({
          key: String(args.key),
          ...(typeof args.value === "object" ? { secretRef: args.value as never } : { value: args.value as never }),
          provenance: { actor: "obsidian-control-plane", source: operation },
        });
      }
      const next = { ...current, revision: current.revision + 1, assignments };
      this.documents.set(scope, next);
      return {
        status: "committed",
        document: next,
        event: {
          type: "SettingsAssignmentsChanged",
          scope: next.scope,
          targetId: next.targetId,
          previousRevision: current.revision,
          revision: next.revision,
          keys: [String(args.key)],
          actor: "obsidian-control-plane",
          occurredAt: "2026-07-14T00:00:00.000Z",
        },
      } satisfies SettingsMutationResult as T;
    }
    throw new Error(`Unexpected operation: ${operation}`);
  }
}

test("plugin data migration keeps only presentation, binding, and migration state", () => {
  const plan = planPluginDataMigration({
    pythonPath: "  py -3  ",
    kbMetaPath: " D:\\repo\\compiler\\kb_meta.py ",
    assignments: { vault: { "query.semantic.enabled": true } },
    presentation: { selectedScope: "vault", showAdvanced: true },
    deviceBinding: { deviceId: "device/local" },
  });
  assert.equal(plan.data.schemaVersion, 2);
  assert.deepEqual(plan.data.presentation, { selectedScope: "vault", showAdvanced: true });
  assert.deepEqual(plan.data.deviceBinding, { deviceId: "device/local" });
  assert.equal("assignments" in plan.data, false);
  assert.equal("pythonPath" in plan.data, false);
  assert.deepEqual(plan.assignments, [
    { scope: "vault", key: "query.semantic.enabled", value: true },
    { scope: "user-device", key: "runtime.python.path", value: "py -3" },
    { scope: "user-device", key: "runtime.kb_meta.path", value: "D:\\repo\\compiler\\kb_meta.py" },
  ]);
});

test("legacy migration journals the preimage and restores an existing assignment exactly", async () => {
  const transport = new FakeTransport();
  transport.documents.set("user-device", document(3, [{
    key: "runtime.python.path",
    value: "old-python",
    provenance: { actor: "person:test", source: "manual" },
  }]));
  const client = new SettingsOperationClient(transport);
  const plan = planPluginDataMigration({ pythonPath: "py -3", kbMetaPath: "D:\\repo\\kb_meta.py" });
  const applied = await applyPluginDataMigration(client, plan, new Date("2026-07-14T00:00:00.000Z"));
  assert.equal(applied.data.legacyMigration?.state, "applied");
  assert.equal(applied.data.legacyMigration?.initialRevisions?.["user-device"], 3);
  assert.equal(applied.data.legacyMigration?.preimage?.[0].assignment?.value, "old-python");

  const rolledBack = await rollbackPluginDataMigration(client, applied.data, new Date("2026-07-14T01:00:00.000Z"));
  assert.equal(rolledBack.data.legacyMigration?.state, "rolled-back");
  const restored = transport.documents.get("user-device")!;
  assert.equal(restored.assignments.find(item => item.key === "runtime.python.path")?.value, "old-python");
  assert.equal(restored.assignments.some(item => item.key === "runtime.kb_meta.path"), false);
});

test("failed legacy batch compensates every earlier mutation", async () => {
  const transport = new FakeTransport();
  transport.documents.set("user-device", document(1, [{
    key: "runtime.python.path",
    value: "old-python",
    provenance: { actor: "test", source: "test" },
  }]));
  transport.failKey = "runtime.kb_meta.path";
  const client = new SettingsOperationClient(transport);
  await assert.rejects(
    () => applyPluginDataMigration(client, planPluginDataMigration({ pythonPath: "new-python", kbMetaPath: "D:\\kb.py" })),
    /forced failure/,
  );
  assert.equal(transport.documents.get("user-device")?.assignments[0].value, "old-python");
});

test("rollback refuses to overwrite a scope changed after migration", async () => {
  const transport = new FakeTransport();
  const client = new SettingsOperationClient(transport);
  const applied = await applyPluginDataMigration(client, planPluginDataMigration({ pythonPath: "py -3" }));
  const current = transport.documents.get("user-device")!;
  transport.documents.set("user-device", { ...current, revision: current.revision + 1 });
  await assert.rejects(() => rollbackPluginDataMigration(client, applied.data), /changed at revision 2/);
});

test("editing scope changes presentation only", () => {
  const { data } = planPluginDataMigration({ schemaVersion: 2, presentation: {} });
  const updated = selectEditingScope(data, "vault");
  assert.equal(updated.presentation.selectedScope, "vault");
  assert.equal("assignments" in updated, false);
  assert.throws(() => selectEditingScope(data, "session"), /not editable/);
});

test("Doctor failure degrades independently while definitions and snapshot remain usable", async () => {
  const transport = new FakeTransport();
  transport.doctorFails = true;
  const projection = await refreshSettingsProjection(
    new SettingsOperationClient(transport),
    new Date("2026-07-14T02:00:00.000Z"),
  );
  assert.equal(projection.definitions[0].key, "runtime.python.path");
  assert.equal(effectiveSetting(projection.snapshot, "runtime.python.path")?.winningScope, "product");
  assert.equal(projection.health[0].state, "degraded");
  assert.match(projection.doctorError ?? "", /probe process unavailable/);
});

test("stale revisions surface a typed conflict and do not retry blindly", async () => {
  const transport = new FakeTransport();
  transport.conflict = true;
  const client = new SettingsOperationClient(transport);
  await assert.rejects(
    () => client.setAssignment("user-device", "runtime.python.path", "python3", 4),
    (error: unknown) => error instanceof SettingsConflictError && error.conflict.actualRevision === 9,
  );
  assert.equal(transport.calls.filter(call => call.operation === "settings.assignment.set").length, 1);
});

test("number parsing rejects text and secret labels never expose locators", () => {
  assert.equal(parseSettingInput("integer", "42"), 42);
  assert.equal(parseSettingInput("number", "3.5"), 3.5);
  assert.throws(() => parseSettingInput("integer", "4.2"), /whole number/);
  assert.equal(redactedSecretLabel({ secretRef: { provider: "environment", locator: "TOP_SECRET" }, status: "present" }), "environment:•••• (present)");
});

test("in-process host adapter persists through the authoritative SettingsService", async () => {
  const vault = await mkdtemp(join(tmpdir(), "llmwiki-plugin-settings-"));
  try {
    const client = new SettingsOperationClient(new InProcessSettingsTransport({
      vaultPath: vault,
      userDeviceId: "device/test",
      environment: { ...process.env, LLMWIKI_SETTINGS_USER_PATH: join(vault, "device-settings.json") },
    }));
    const before = await client.snapshot();
    await client.setAssignment("vault", "query.semantic.enabled", true, 0);
    const after = await client.snapshot();
    assert.equal(effectiveSetting(after.snapshot, "query.semantic.enabled")?.value, true);
    assert.notEqual(after.snapshot.snapshotId, before.snapshot.snapshotId);
    const persisted = JSON.parse(await readFile(join(vault, "_llmwiki", "settings", "vault.json"), "utf8"));
    assert.equal(persisted.assignments[0].key, "query.semantic.enabled");
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
});

test("parses Python executable and fixed argv without shell composition", () => {
  assert.deepEqual(parseExecutableCommand("py -3"), { executable: "py", args: ["-3"] });
  assert.deepEqual(
    parseExecutableCommand('"C:\\Program Files\\Python\\python.exe" -X utf8'),
    { executable: "C:\\Program Files\\Python\\python.exe", args: ["-X", "utf8"] },
  );
  assert.deepEqual(
    buildPythonInvocation("py -3", ["D:\\repo with spaces\\kb_meta.py", "promote", "--note", "A B.md"]),
    { executable: "py", args: ["-3", "D:\\repo with spaces\\kb_meta.py", "promote", "--note", "A B.md"] },
  );
  assert.deepEqual(parseExecutableCommand('"\\\\server\\share\\Python\\python.exe" -X utf8'), {
    executable: "\\\\server\\share\\Python\\python.exe", args: ["-X", "utf8"],
  });
  assert.deepEqual(parseExecutableCommand('"\\\\?\\C:\\Python\\python.exe"'), {
    executable: "\\\\?\\C:\\Python\\python.exe", args: [],
  });
  assert.throws(() => parseExecutableCommand('"C:\\Python\\python.exe'), /unterminated quote/);
});
