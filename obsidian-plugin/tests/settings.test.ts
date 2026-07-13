import test from "node:test";
import assert from "node:assert/strict";
import { buildPythonInvocation, parseExecutableCommand } from "../src/executable-command";
import {
  applyPluginDataMigration,
  planPluginDataMigration,
  rollbackPluginDataMigration,
  selectEditingScope,
} from "../src/settings";
import {
  refreshSettingsProjection,
  projectSettingForScope,
  SettingsConflictError,
  SettingsOperationClient,
  type SettingsOperationTransport,
  type SettingsSnapshot,
} from "../src/settings-client";

function snapshot(revision = 0): SettingsSnapshot {
  return {
    sourceRevisions: { "user-device": revision, vault: 0 },
    effective: {
      "runtime.python.path": {
        key: "runtime.python.path",
        value: "python",
        winningScope: "product-default",
      },
    },
    validation: [],
  };
}

class FakeTransport implements SettingsOperationTransport {
  readonly calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  current = snapshot();
  conflict = false;

  async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
    this.calls.push({ operation, args });
    if (operation === "settings.definitions.list") {
      return [{
        key: "runtime.python.path",
        category: "runtime",
        name: "Python runtime",
        description: "Interpreter command",
        valueType: "string",
        allowedScopes: ["user-device", "session"],
        applyMode: "next-operation",
      }] as T;
    }
    if (operation === "settings.snapshot.resolve") return this.current as T;
    if (operation === "settings.doctor") {
      return [{ capability: "Settings contract", state: "available", summary: "ready" }] as T;
    }
    if (operation === "settings.validate") return [] as T;
    if (operation === "settings.assignment.set" || operation === "settings.assignment.unset") {
      if (this.conflict) {
        return {
          status: "conflict",
          scope: args.scope,
          expectedRevision: args.expectedRevision,
          actualRevision: 9,
          message: "stale revision",
        } as T;
      }
      const nextRevision = (this.current.sourceRevisions[args.scope as "user-device"] ?? 0) + 1;
      this.current = { ...this.current, sourceRevisions: { ...this.current.sourceRevisions, [String(args.scope)]: nextRevision } };
      return this.current as T;
    }
    throw new Error(`Unexpected operation: ${operation}`);
  }
}

test("plugin data migration removes operational settings from data.json", () => {
  const plan = planPluginDataMigration({
    pythonPath: "  py -3  ",
    kbMetaPath: " D:\\repo\\compiler\\kb_meta.py ",
    revision: 8,
    assignments: { vault: { "query.semantic.enabled": true } },
    presentation: { selectedScope: "vault", showAdvanced: true },
    deviceBinding: { deviceId: "device/local" },
  });
  assert.equal(plan.migrated, true);
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

test("legacy migration applies through operations and can be rolled back", async () => {
  const transport = new FakeTransport();
  const client = new SettingsOperationClient(transport);
  const plan = planPluginDataMigration({ pythonPath: "py -3", kbMetaPath: "D:\\repo\\kb_meta.py" });
  const applied = await applyPluginDataMigration(client, plan, new Date("2026-07-14T00:00:00.000Z"));
  assert.equal(applied.data.legacyMigration?.state, "applied");
  assert.equal(applied.snapshot.sourceRevisions["user-device"], 2);
  assert.deepEqual(
    transport.calls.filter(call => call.operation === "settings.assignment.set").map(call => call.args.expectedRevision),
    [0, 1],
  );

  const rolledBack = await rollbackPluginDataMigration(client, applied.data, new Date("2026-07-14T01:00:00.000Z"));
  assert.equal(rolledBack.data.legacyMigration?.state, "rolled-back");
  assert.equal(rolledBack.snapshot.sourceRevisions["user-device"], 4);
});

test("editing scope changes presentation only", () => {
  const { data } = planPluginDataMigration({ schemaVersion: 2, presentation: {} });
  const updated = selectEditingScope(data, "vault");
  assert.equal(updated.presentation.selectedScope, "vault");
  assert.equal("assignments" in updated, false);
  assert.throws(() => selectEditingScope(data, "session"), /not editable/);
});

test("refresh reads definitions, snapshot, and Doctor from the operation client", async () => {
  const transport = new FakeTransport();
  const projection = await refreshSettingsProjection(
    new SettingsOperationClient(transport),
    new Date("2026-07-14T02:00:00.000Z"),
  );
  assert.equal(projection.definitions[0].key, "runtime.python.path");
  assert.equal(projection.snapshot.effective["runtime.python.path"].winningScope, "product-default");
  assert.equal(projection.health[0].state, "available");
  assert.equal(projection.refreshedAt, "2026-07-14T02:00:00.000Z");
  const row = projectSettingForScope(projection.definitions[0], projection.snapshot, "user-device");
  assert.equal(row?.applyMode, "next-operation");
  assert.equal(row?.effective.winningScope, "product-default");
  assert.deepEqual(row?.validation, []);
});

test("rollback refuses to delete assignments changed after migration", async () => {
  const transport = new FakeTransport();
  const client = new SettingsOperationClient(transport);
  const plan = planPluginDataMigration({ pythonPath: "py -3" });
  const applied = await applyPluginDataMigration(client, plan);
  transport.current = { ...transport.current, sourceRevisions: { "user-device": 7 } };
  await assert.rejects(
    () => rollbackPluginDataMigration(client, applied.data),
    /changed at revision 7/,
  );
});

test("stale revisions surface a typed conflict and do not retry blindly", async () => {
  const transport = new FakeTransport();
  transport.conflict = true;
  const client = new SettingsOperationClient(transport);
  await assert.rejects(
    () => client.setAssignment("user-device", "runtime.python.path", "python3", 4),
    (error: unknown) => {
      assert.equal(error instanceof SettingsConflictError, true);
      assert.equal((error as SettingsConflictError).conflict.actualRevision, 9);
      return true;
    },
  );
  assert.equal(transport.calls.filter(call => call.operation === "settings.assignment.set").length, 1);
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
  assert.throws(() => parseExecutableCommand('"C:\\Python\\python.exe'), /unterminated quote/);
});
