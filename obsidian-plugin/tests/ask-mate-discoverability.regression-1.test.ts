import test from "node:test";
import assert from "node:assert/strict";
import {
  FileSystemAdapter,
  MarkdownView,
  Notice,
  TFile,
  type App,
  type PluginManifest,
} from "obsidian";
import LLMWikiPlugin from "../src/main";
import type { AgentControlPlaneTransport } from "../src/control-plane-client";
import type { AskMateContext } from "../src/ask-mate/interaction-model";
import type { DeviceBindingReference } from "../src/settings";
import type { SettingsOperationTransport } from "../src/settings-client";

// Regression: ISSUE-001 — first-run vaults hid every Ask Mate command
// Found by /qa on 2026-07-19
// Report: .gstack/qa-reports/qa-report-obsidian-llm-wiki-2026-07-19.md

type ControlPlaneTransport = SettingsOperationTransport & AgentControlPlaneTransport;

class TestFilesystemAdapter extends FileSystemAdapter {
  override getBasePath(): string {
    return "D:\\vault";
  }
}

class FirstRunPlugin extends LLMWikiPlugin {
  readonly contexts: AskMateContext[] = [];
  readonly transportBindings: DeviceBindingReference[] = [];
  readonly projectInitializations: Record<string, unknown>[] = [];
  bindingRequests = 0;
  private persisted: unknown = {
    schemaVersion: 2,
    presentation: { selectedScope: "user-device", showAdvanced: false },
    deviceBinding: { deviceId: "test-device" },
  };

  constructor() {
    const activeFile = new TFile("Notes/first-run.md", "md");
    const workspace = {
      activeLeaf: null,
      getActiveFile: () => activeFile,
      getActiveViewOfType: <T>() => new MarkdownView({
        getSelection: () => "",
        getCursor: () => ({ line: 0, ch: 0 }),
        posToOffset: () => 0,
      }, activeFile) as T,
      on: () => ({}),
      detachLeavesOfType: () => undefined,
    };
    super({
      vault: { adapter: new TestFilesystemAdapter() },
      workspace,
    } as unknown as App, {
      id: "obsidian-llm-wiki",
      dir: ".obsidian/plugins/obsidian-llm-wiki",
    } as PluginManifest);
  }

  protected override createControlPlaneTransport(
    binding: DeviceBindingReference,
  ): ControlPlaneTransport {
    this.transportBindings.push(structuredClone(binding));
    return {
      invoke: async <T>(operation: string, args: Record<string, unknown> = {}) => {
        if (operation === "project.init") {
          this.projectInitializations.push(structuredClone(args));
          return { ok: true, projectId: `project/${String(args.project)}` } as T;
        }
        throw new Error("test backend unavailable");
      },
    };
  }

  override async loadData(): Promise<unknown> {
    return structuredClone(this.persisted);
  }

  override async saveData(data: unknown): Promise<void> {
    this.persisted = structuredClone(data);
  }

  savedData(): unknown {
    return structuredClone(this.persisted);
  }

  override openWorkspaceProjectBindingEditor(
    afterBind?: (projectId: `project/${string}`) => void,
  ): void {
    this.bindingRequests += 1;
    afterBind?.("project/alpha");
  }

  override async openAskMate(contextOrPath: AskMateContext | string): Promise<void> {
    assert.notEqual(typeof contextOrPath, "string");
    this.contexts.push(structuredClone(contextOrPath as AskMateContext));
  }
}

test("first-run vault exposes Ask Mate and routes through Workspace Project binding", async () => {
  Notice.messages.length = 0;
  const plugin = new FirstRunPlugin();
  await plugin.onload();

  const command = plugin.commands.find(item => item.id === "open-ask-mate");
  assert.ok(command?.callback, "always-visible Ask Mate command was not registered");
  assert.equal(command.checkCallback, undefined, "first-run visibility must not depend on Project Binding");

  command.callback();

  assert.equal(plugin.bindingRequests, 1);
  assert.deepEqual(plugin.contexts, [{
    projectId: "project/alpha",
    kind: "markdown_note",
    path: "Notes/first-run.md",
  }]);
  assert.match(Notice.messages.at(-1) ?? "", /enter a Project ID to start Ask Mate/i);
});

test("first-run vault exposes an always-visible Ask Mate ribbon action", async () => {
  const plugin = new FirstRunPlugin();
  await plugin.onload();

  const ribbon = plugin.ribbonIcons.find(item => item.title === "Open Ask Mate");
  assert.ok(ribbon, "always-visible Ask Mate ribbon action was not registered");
  assert.equal(ribbon.icon, "sparkles");

  ribbon.callback();

  assert.equal(plugin.bindingRequests, 1);
  assert.deepEqual(plugin.contexts, [{
    projectId: "project/alpha",
    kind: "markdown_note",
    path: "Notes/first-run.md",
  }]);
});

test("Workspace Project binding is validated, persisted, and applied to a fresh transport", async () => {
  const plugin = new FirstRunPlugin();
  await plugin.onload();

  await assert.rejects(
    () => plugin.bindWorkspaceProject("D:\\vault"),
    /project\/<lowercase-kebab-slug>/i,
  );
  assert.equal(plugin.transportBindings.length, 1, "invalid binding replaced the active transport");

  const projectId = await plugin.bindWorkspaceProject(" project/alpha ");

  assert.equal(projectId, "project/alpha");
  assert.deepEqual(plugin.projectInitializations, [{ project: "alpha" }]);
  assert.deepEqual(plugin.savedData(), {
    schemaVersion: 2,
    presentation: { selectedScope: "user-device", showAdvanced: false },
    deviceBinding: {
      deviceId: "test-device",
      workspaceProjectId: "project/alpha",
    },
    legacyMigration: undefined,
  });
  assert.deepEqual(plugin.transportBindings.at(-1), {
    deviceId: "test-device",
    workspaceProjectId: "project/alpha",
  });
});
