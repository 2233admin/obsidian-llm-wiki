import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  FileSettingsStore,
  SessionSettingsStore,
  SettingsLockTimeoutError,
  loadRegistry,
} from "../src/index.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function makeStore(lockTimeoutMs = 200) {
  const dir = mkdtempSync(join(tmpdir(), "llmwiki-settings-"));
  dirs.push(dir);
  const filePath = join(dir, "vault.json");
  const registry = loadRegistry(fileURLToPath(new URL("../registry/v1.json", import.meta.url)));
  let tick = 0;
  const store = new FileSettingsStore({
    scope: "vault",
    targetId: "vault-test",
    filePath,
    registry,
    lockTimeoutMs,
    clock: () => `2026-07-14T00:00:0${tick++}.000Z`,
  });
  return { filePath, registry, store };
}

describe("scope persistence", () => {
  test("uses expected revisions, preserves a recoverable backup, and recovers corrupt active state", async () => {
    const { filePath, store } = makeStore();

    const first = await store.set("query.semantic.enabled", true, {
      expectedRevision: 0,
      updatedBy: "test-agent",
    });
    assert.equal(first.status, "committed");
    assert.equal(first.document.revision, 1);

    const second = await store.set("query.semantic.enabled", false, {
      expectedRevision: 1,
      updatedBy: "test-agent",
    });
    assert.equal(second.status, "committed");
    assert.equal(second.document.revision, 2);
    assert.equal(JSON.parse(readFileSync(`${filePath}.bak`, "utf8")).revision, 1);

    const stale = await store.set("query.semantic.enabled", true, {
      expectedRevision: 1,
      updatedBy: "stale-editor",
    });
    assert.equal(stale.status, "conflict");
    assert.equal(stale.conflict.actualRevision, 2);
    assert.equal((await store.read()).document.assignments[0]!.value, false);

    writeFileSync(filePath, "{not-json", "utf8");
    const recovered = await store.read();
    assert.equal(recovered.recoveredFromBackup, true);
    assert.equal(recovered.document.revision, 1);
  });

  test("failed complete-scope validation changes neither active state nor backup", async () => {
    const { filePath, store } = makeStore();
    await store.set("query.semantic.enabled", true, { expectedRevision: 0, updatedBy: "test-agent" });
    await store.set("diagnostics.obc.semantic.enabled", true, { expectedRevision: 1, updatedBy: "test-agent" });
    const beforeActive = readFileSync(filePath);
    const beforeBackup = readFileSync(`${filePath}.bak`);

    const invalid = await store.set("runtime.python.path", "python3", {
      expectedRevision: 2,
      updatedBy: "test-agent",
    });

    assert.equal(invalid.status, "validation-error");
    assert.deepEqual(readFileSync(filePath), beforeActive);
    assert.deepEqual(readFileSync(`${filePath}.bak`), beforeBackup);
  });

  test("conflicts report only keys changed since the retained previous revision", async () => {
    const { store } = makeStore();
    await store.set("query.semantic.enabled", true, { expectedRevision: 0, updatedBy: "test-agent" });
    await store.set("diagnostics.obc.semantic.enabled", true, { expectedRevision: 1, updatedBy: "test-agent" });

    const conflict = await store.set("query.semantic.enabled", false, {
      expectedRevision: 1,
      updatedBy: "stale-agent",
    });

    assert.equal(conflict.status, "conflict");
    assert.deepEqual(conflict.conflict.changedKeys, ["diagnostics.obc.semantic.enabled"]);
  });

  test("session conflicts use the same redacted changed-key diff", async () => {
    const { registry } = makeStore();
    const session = new SessionSettingsStore({
      targetId: "session-test",
      registry,
    });
    await session.set("query.semantic.enabled", true, { expectedRevision: 0, updatedBy: "test-agent" });
    await session.set("diagnostics.obc.semantic.enabled", true, { expectedRevision: 1, updatedBy: "test-agent" });

    const conflict = await session.set("query.semantic.enabled", false, {
      expectedRevision: 1,
      updatedBy: "stale-agent",
    });

    assert.equal(conflict.status, "conflict");
    assert.deepEqual(conflict.conflict.changedKeys, ["diagnostics.obc.semantic.enabled"]);
  });

  test("recovers the previous revision when the active file is missing", async () => {
    const { filePath, store } = makeStore();
    await store.set("query.semantic.enabled", true, { expectedRevision: 0, updatedBy: "test-agent" });
    await store.set("query.semantic.enabled", false, { expectedRevision: 1, updatedBy: "test-agent" });
    rmSync(filePath);

    const recovered = await store.read();

    assert.equal(recovered.recoveredFromBackup, true);
    assert.equal(recovered.document.revision, 1);
  });

  test("recovers when the active JSON parses but is not a settings document", async () => {
    const { filePath, store } = makeStore();
    await store.set("query.semantic.enabled", true, { expectedRevision: 0, updatedBy: "test-agent" });
    await store.set("query.semantic.enabled", false, { expectedRevision: 1, updatedBy: "test-agent" });
    for (const raw of [
      "null\n",
      `${JSON.stringify({
        schemaVersion: 1,
        scope: "vault",
        targetId: "vault-test",
        revision: 2,
        assignments: [null],
        updatedAt: "2026-07-14T00:00:00.000Z",
        updatedBy: "bad-writer",
      })}\n`,
    ]) {
      writeFileSync(filePath, raw, "utf8");
      const recovered = await store.read();
      assert.equal(recovered.recoveredFromBackup, true);
      assert.equal(recovered.document.revision, 1);
    }
  });

  test("a fresh cross-process lock times out without changing the document", async () => {
    const { filePath, store } = makeStore(25);
    writeFileSync(`${filePath}.lock`, JSON.stringify({ pid: 99999, acquiredAt: new Date().toISOString() }));

    await assert.rejects(
      store.set("query.semantic.enabled", true, { expectedRevision: 0, updatedBy: "test-agent" }),
      SettingsLockTimeoutError,
    );
  });

  test("an old cross-process lock fails closed instead of being reclaimed", async () => {
    const { filePath, store } = makeStore(25);
    writeFileSync(`${filePath}.lock`, JSON.stringify({ pid: 99999, acquiredAt: "2000-01-01T00:00:00.000Z" }));

    await assert.rejects(
      store.set("query.semantic.enabled", true, { expectedRevision: 0, updatedBy: "test-agent" }),
      SettingsLockTimeoutError,
    );
    assert.equal(readFileSync(`${filePath}.lock`, "utf8").includes("99999"), true);
  });
});
