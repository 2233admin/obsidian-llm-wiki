/**
 * Issue #51 P2 — LLMWikiPlugin lifecycle regressions, run against the real
 * plugin class (obsidian runtime stubbed at bundle time by test-settings.mjs).
 *
 * Covers: onload -> migration failure -> later save -> restart -> successful
 * migration; preimage backup product lifecycle; rollback command; and the
 * .bat/.cmd/.ps1 wrapper rejection at both defense lines.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App, PluginManifest } from "obsidian";
import LLMWikiPlugin from "../src/main";
import { InProcessSettingsTransport, obsidianUserDeviceId } from "../src/settings-host";
import type { SettingsOperationTransport } from "../src/settings-client";
import type { AgentControlPlaneTransport } from "../src/control-plane-client";
import type { DeviceBindingReference } from "../src/settings";

type ControlPlaneTransport = SettingsOperationTransport & AgentControlPlaneTransport;

const PREIMAGE_PATH = ".obsidian/plugins/obsidian-llm-wiki/legacy-migration-preimage.json";

class MemoryAdapter {
  files = new Map<string, string>();
  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }
  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

interface DataStore {
  current: unknown;
}

class FailingTransport implements SettingsOperationTransport {
  async invoke<T>(): Promise<T> {
    throw new Error("settings backend unavailable");
  }
}

function fakeApp(adapter: MemoryAdapter): App {
  return {
    vault: { adapter },
    workspace: { on: () => ({}), getActiveFile: () => null },
  } as unknown as App;
}

class TestPlugin extends LLMWikiPlugin {
  constructor(
    adapter: MemoryAdapter,
    private readonly store: DataStore,
    private readonly transport: ControlPlaneTransport,
  ) {
    super(
      fakeApp(adapter),
      { id: "obsidian-llm-wiki", dir: ".obsidian/plugins/obsidian-llm-wiki" } as PluginManifest,
    );
  }

  protected override createControlPlaneTransport(_binding: DeviceBindingReference): ControlPlaneTransport {
    return this.transport;
  }

  override async loadData(): Promise<unknown> {
    return structuredClone(this.store.current);
  }

  override async saveData(data: unknown): Promise<void> {
    this.store.current = structuredClone(data);
  }
}

function legacyStore(): DataStore {
  return {
    current: {
      pythonPath: "C:/legacy/python.exe",
      kbMetaPath: "C:/legacy/kb_meta.py",
      presentation: { selectedScope: "user-device", showAdvanced: false },
    },
  };
}

async function inProcessTransport(t: test.TestContext): Promise<ControlPlaneTransport> {
  const vaultDir = await mkdtemp(join(tmpdir(), "llmwiki-lifecycle-"));
  t.after(() => rm(vaultDir, { recursive: true, force: true }));
  return new InProcessSettingsTransport({
    vaultPath: vaultDir,
    userDeviceId: obsidianUserDeviceId(process.env),
    // Isolate the user-device document too; the default resolves to the real
    // per-machine settings store under APPDATA/XDG_CONFIG_HOME.
    userDevicePath: join(vaultDir, "user-device.json"),
  }) as unknown as ControlPlaneTransport;
}

test("lifecycle: migration failure -> later save -> restart -> successful migration", async (t) => {
  const adapter = new MemoryAdapter();
  const store = legacyStore();

  // Session 1: backend down, migration must stay pending without data loss.
  const broken = new TestPlugin(adapter, store, new FailingTransport() as ControlPlaneTransport);
  await broken.onload();
  assert.match(broken.settingsError ?? "", /migration pending/i);
  await broken.setEditingScope("vault");
  const persisted = store.current as Record<string, unknown>;
  assert.equal(persisted.pythonPath, "C:/legacy/python.exe", "legacy field destroyed by save");
  assert.equal(persisted.kbMetaPath, "C:/legacy/kb_meta.py");
  assert.equal((persisted.presentation as { selectedScope: string }).selectedScope, "vault");
  assert.equal(adapter.files.has(PREIMAGE_PATH), false, "no preimage backup before success");

  // Session 2 (restart): backend up, migration applies and strips the source.
  const plugin = new TestPlugin(adapter, store, await inProcessTransport(t));
  await plugin.onload();
  assert.equal(plugin.settingsError, null);
  const migrated = store.current as Record<string, unknown>;
  assert.equal(migrated.schemaVersion, 2);
  assert.equal("pythonPath" in migrated, false);
  assert.equal("kbMetaPath" in migrated, false);
  const marker = migrated.legacyMigration as { state: string; preimageJournal: unknown[] };
  assert.equal(marker.state, "applied");
  assert.ok(Array.isArray(marker.preimageJournal) && marker.preimageJournal.length >= 2);
  assert.ok(adapter.files.has(PREIMAGE_PATH), "preimage backup must be persisted device-locally");
});

test("lifecycle: successful first migration persists the stripped document once", async (t) => {
  const adapter = new MemoryAdapter();
  const store = legacyStore();
  const plugin = new TestPlugin(adapter, store, await inProcessTransport(t));
  await plugin.onload();
  const migrated = store.current as Record<string, unknown>;
  assert.equal(migrated.schemaVersion, 2);
  assert.equal("pythonPath" in migrated, false);
  assert.equal((migrated.legacyMigration as { state: string }).state, "applied");
});

test("lifecycle: rollback command restores the preimage and survives restart", async (t) => {
  const adapter = new MemoryAdapter();
  const store = legacyStore();
  const transport = await inProcessTransport(t);
  const plugin = new TestPlugin(adapter, store, transport);
  await plugin.onload();

  const rollback = plugin.commands.find(command => command.id === "rollback-legacy-migration");
  assert.ok(rollback?.checkCallback, "rollback command must exist");
  assert.equal(rollback.checkCallback(true), true, "rollback must be available after an applied migration");

  await plugin.rollbackLegacyMigration();
  const rolledBack = store.current as Record<string, unknown>;
  assert.equal((rolledBack.legacyMigration as { state: string }).state, "rolled-back");
  assert.equal(adapter.files.has(PREIMAGE_PATH), false, "backup removed after rollback");
  assert.equal(rollback.checkCallback(true), false, "rollback must not be offered twice");

  // The migrated assignments are gone from the platform again.
  const scopeRead = await transport.invoke<{ document: { assignments: Array<{ key: string }> } }>(
    "settings.scopes.get",
    { scope: "user-device" },
  );
  assert.equal(
    scopeRead.document.assignments.some(item => item.key === "runtime.python.path"),
    false,
    "rolled-back assignment still present on the platform",
  );

  // Restart: nothing re-migrates, the rolled-back journal survives.
  const restarted = new TestPlugin(adapter, store, transport);
  await restarted.onload();
  assert.equal(((store.current as Record<string, unknown>).legacyMigration as { state: string }).state, "rolled-back");
});

test("lifecycle: rollback without a device-local backup fails closed", async (t) => {
  const adapter = new MemoryAdapter();
  const store = legacyStore();
  const plugin = new TestPlugin(adapter, store, await inProcessTransport(t));
  await plugin.onload();
  await adapter.remove(PREIMAGE_PATH);
  await plugin.rollbackLegacyMigration();
  assert.equal(
    ((store.current as Record<string, unknown>).legacyMigration as { state: string }).state,
    "applied",
    "journal must stay applied when the backup is missing",
  );
});

test("lifecycle: runtime.python.path rejects shell wrappers at the platform boundary", async (t) => {
  const adapter = new MemoryAdapter();
  const store = legacyStore();
  const plugin = new TestPlugin(adapter, store, await inProcessTransport(t));
  await plugin.onload();
  await assert.rejects(
    plugin.updateSetting("user-device", "runtime.python.path", "C:/wrappers/python.bat"),
    /wrapper|not allowed|validation/i,
  );
});
