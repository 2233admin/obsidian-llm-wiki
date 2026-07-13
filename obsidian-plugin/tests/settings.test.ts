import test from "node:test";
import assert from "node:assert/strict";
import {
  SETTING_DEFINITIONS,
  createDefaultSettings,
  getEffectiveValue,
  migrateSettings,
  resolveSettings,
  setAssignment,
  validateSettings,
} from "../src/settings";

test("uses LLM Wiki product wording while preserving the obc compatibility key", () => {
  const diagnostics = SETTING_DEFINITIONS.find(definition => definition.key === "diagnostics.obc.semantic.enabled");
  assert.equal(diagnostics?.name, "Link-diagnostics semantic suggestions");
  assert.equal(diagnostics?.name.includes("OBC"), false);
});

test("migrates legacy runtime paths into the user-device scope", () => {
  const result = migrateSettings({ pythonPath: "  py -3  ", kbMetaPath: " D:\\repo\\compiler\\kb_meta.py " });
  assert.equal(result.migrated, true);
  assert.equal(result.data.schemaVersion, 1);
  assert.equal(result.data.assignments["user-device"]["runtime.python.path"], "py -3");
  assert.equal(result.data.assignments["user-device"]["runtime.kb_meta.path"], "D:\\repo\\compiler\\kb_meta.py");
});

test("resolves settings from the most specific allowed scope", () => {
  let data = createDefaultSettings();
  data = setAssignment(data, "vault", "query.semantic.enabled", true);
  data = setAssignment(data, "workspace-project", "query.semantic.enabled", false);
  data = setAssignment(data, "session", "query.semantic.enabled", true);
  const effective = resolveSettings(data).get("query.semantic.enabled");
  assert.equal(effective?.value, true);
  assert.equal(effective?.winningScope, "session");
  assert.deepEqual(effective?.overriddenScopes, ["workspace-project", "vault"]);
});

test("unset reveals the next lower value instead of storing null", () => {
  let data = createDefaultSettings();
  data = setAssignment(data, "vault", "query.semantic.enabled", true);
  data = setAssignment(data, "session", "query.semantic.enabled", false);
  data = setAssignment(data, "session", "query.semantic.enabled", undefined);
  assert.equal(getEffectiveValue(data, "query.semantic.enabled"), true);
  assert.equal("query.semantic.enabled" in data.assignments.session, false);
});

test("rejects assignments at scopes not allowed by the definition", () => {
  const data = createDefaultSettings();
  assert.throws(
    () => setAssignment(data, "vault", "runtime.python.path", "python3"),
    /cannot be set at vault scope/,
  );
});

test("validates required values and opaque environment secret references", () => {
  let data = createDefaultSettings();
  data = setAssignment(data, "user-device", "runtime.kb_meta.path", "");
  data = setAssignment(data, "user-device", "providers.web_search.secret_ref", "plaintext-key");
  const issues = validateSettings(data);
  assert.deepEqual(issues.map(issue => issue.key).sort(), [
    "providers.web_search.secret_ref",
    "runtime.kb_meta.path",
  ]);
});

test("normalizes malformed versioned documents without accepting arbitrary values", () => {
  const { data, migrated } = migrateSettings({
    schemaVersion: 1,
    revision: -4,
    assignments: {
      vault: { "query.semantic.enabled": true, ignored: { nested: true } },
    },
    presentation: { selectedScope: "vault", showAdvanced: true },
  });
  assert.equal(migrated, false);
  assert.equal(data.revision, 0);
  assert.equal(data.presentation.selectedScope, "vault");
  assert.equal(data.presentation.showAdvanced, true);
  assert.equal(data.assignments.vault["query.semantic.enabled"], true);
  assert.equal("ignored" in data.assignments.vault, false);
});

test("does not expose project or session editing without a bound runtime context", () => {
  const { data } = migrateSettings({
    schemaVersion: 1,
    assignments: {},
    presentation: { selectedScope: "session" },
  });
  assert.equal(data.presentation.selectedScope, "user-device");
});

test("fails closed on a settings document from a newer schema", () => {
  assert.throws(
    () => migrateSettings({ schemaVersion: 99, assignments: {} }),
    /Unsupported settings schema version: 99/,
  );
});

test("reports type errors and preserves unknown scalar assignments as warnings", () => {
  const { data } = migrateSettings({
    schemaVersion: 1,
    assignments: { vault: { "query.semantic.enabled": "yes", "future.setting": true } },
  });
  const issues = validateSettings(data);
  assert.equal(issues.some(issue => issue.key === "query.semantic.enabled" && issue.severity === "error"), true);
  assert.equal(issues.some(issue => issue.key === "future.setting" && issue.severity === "warning"), true);
});
