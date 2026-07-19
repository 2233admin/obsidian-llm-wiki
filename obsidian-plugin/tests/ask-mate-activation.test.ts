import test from "node:test";
import assert from "node:assert/strict";
import {
  FileSystemAdapter,
  MarkdownView,
  Menu,
  Notice,
  Platform,
  TFile,
  type App,
  type PluginManifest,
} from "obsidian";
import LLMWikiPlugin, { selectedCoreCanvasNodeIds } from "../src/main";
import type {
  AgentControlPlaneTransport,
} from "../src/control-plane-client";
import type { AskMateContext } from "../src/ask-mate/interaction-model";
import type { DeviceBindingReference } from "../src/settings";
import type {
  SettingsOperationTransport,
} from "../src/settings-client";

type ControlPlaneTransport = SettingsOperationTransport & AgentControlPlaneTransport;

class UnavailableTransport implements ControlPlaneTransport {
  async invoke<T>(): Promise<T> {
    throw new Error("test backend unavailable");
  }
}

class TestFilesystemAdapter extends FileSystemAdapter {
  override getBasePath(): string {
    return "D:\\vault";
  }
}

interface TestWorkspace {
  activeFile: TFile | null;
  activeView: MarkdownView | null;
  activeLeaf: { view: unknown } | null;
  events: Map<string, (...args: unknown[]) => void>;
  getActiveFile(): TFile | null;
  getActiveViewOfType<T>(): T | null;
  on(name: string, callback: (...args: unknown[]) => void): object;
}

function testWorkspace(): TestWorkspace {
  return {
    activeFile: null,
    activeView: null,
    activeLeaf: null,
    events: new Map(),
    getActiveFile() { return this.activeFile; },
    getActiveViewOfType<T>() { return this.activeView as T | null; },
    on(name, callback) {
      this.events.set(name, callback);
      return {};
    },
  };
}

class CapturePlugin extends LLMWikiPlugin {
  readonly contexts: AskMateContext[] = [];
  private persisted: unknown = {
    schemaVersion: 2,
    presentation: { selectedScope: "user-device", showAdvanced: false },
    deviceBinding: {
      deviceId: "test-device",
      workspaceProjectId: "project/alpha",
    },
  };

  constructor(readonly workspaceStub: TestWorkspace, adapter: unknown = new TestFilesystemAdapter()) {
    super({
      vault: { adapter },
      workspace: workspaceStub,
    } as unknown as App, {
      id: "obsidian-llm-wiki",
      dir: ".obsidian/plugins/obsidian-llm-wiki",
    } as PluginManifest);
  }

  protected override createControlPlaneTransport(
    _binding: DeviceBindingReference,
  ): ControlPlaneTransport {
    return new UnavailableTransport();
  }

  override async loadData(): Promise<unknown> {
    return structuredClone(this.persisted);
  }

  override async saveData(data: unknown): Promise<void> {
    this.persisted = structuredClone(data);
  }

  override async openAskMate(
    contextOrPath: AskMateContext | string,
    projectId: `project/${string}` | null = "project/alpha",
  ): Promise<void> {
    if (typeof contextOrPath === "string") {
      if (!projectId) return;
      this.contexts.push({ projectId, kind: "markdown_note", path: contextOrPath });
    } else {
      this.contexts.push(structuredClone(contextOrPath));
    }
  }
}

function file(path: string, extension: "md" | "canvas"): TFile {
  return new TFile(path, extension);
}

function editor(selection: string) {
  return {
    getSelection: () => selection,
    getCursor: (side: string) => side === "from"
      ? { line: 1, ch: 2 }
      : { line: 1, ch: 2 + selection.length },
    posToOffset: (position: { line: number; ch: number }) => position.line * 100 + position.ch,
  };
}

test("active Markdown command distinguishes selection, managed map, and ordinary note", async () => {
  const workspace = testWorkspace();
  const plugin = new CapturePlugin(workspace);
  await plugin.onload();
  const command = plugin.commands.find(item => item.id === "open-ask-mate-active-note");
  assert.ok(command?.checkCallback);

  workspace.activeFile = file("01-Projects/alpha/notes/context.md", "md");
  workspace.activeView = new MarkdownView(editor("Selected context"), workspace.activeFile);
  assert.equal(command.checkCallback(true), true);
  assert.equal(command.checkCallback(false), true);
  assert.deepEqual(plugin.contexts.at(-1), {
    projectId: "project/alpha",
    kind: "selection",
    path: "01-Projects/alpha/notes/context.md",
    selection: {
      text: "Selected context",
      from: 102,
      to: 118,
    },
  });

  workspace.activeFile = file("01-Projects/alpha/maps/roadmap.md", "md");
  workspace.activeView = new MarkdownView(editor(""), workspace.activeFile);
  command.checkCallback(false);
  assert.deepEqual(plugin.contexts.at(-1), {
    projectId: "project/alpha",
    kind: "managed_map",
    path: "01-Projects/alpha/maps/roadmap.md",
  });

  workspace.activeFile = file("01-Projects/alpha/notes/ordinary.md", "md");
  workspace.activeView = new MarkdownView(editor(""), workspace.activeFile);
  command.checkCallback(false);
  assert.deepEqual(plugin.contexts.at(-1), {
    projectId: "project/alpha",
    kind: "markdown_note",
    path: "01-Projects/alpha/notes/ordinary.md",
  });
});

test("active core Canvas captures only detached, sorted, bounded ephemeral node IDs", async () => {
  Notice.messages.length = 0;
  const workspace = testWorkspace();
  const plugin = new CapturePlugin(workspace);
  await plugin.onload();
  const canvasFile = file("01-Projects/alpha/maps/architecture.canvas", "canvas");
  workspace.activeFile = canvasFile;
  const selected = new Set<unknown>([
    { id: "node-b", privatePayload: "must not survive" },
    { id: "node-a" },
    "node-c",
    { missing: "id" },
  ]);
  workspace.activeLeaf = {
    view: {
      getViewType: () => "canvas",
      canvas: { selection: selected },
    },
  };
  const command = plugin.commands.find(item => item.id === "open-ask-mate-active-canvas");
  assert.ok(command?.checkCallback);
  command.checkCallback(false);
  assert.deepEqual(plugin.contexts.at(-1), {
    projectId: "project/alpha",
    kind: "canvas",
    path: canvasFile.path,
    canvasNodeIds: ["node-a", "node-b", "node-c"],
  });
  assert.equal(JSON.stringify(plugin.contexts.at(-1)).includes("privatePayload"), false);
  assert.deepEqual(selectedCoreCanvasNodeIds({ getViewType: () => "markdown" }), []);

  workspace.activeLeaf = {
    view: {
      getViewType: () => "canvas",
      canvas: {
        selection: new Set(
          Array.from({ length: 205 }, (_, index) => ({ id: `node-${String(index).padStart(3, "0")}` })),
        ),
      },
    },
  };
  command.checkCallback(false);
  const bounded = plugin.contexts.at(-1)?.canvasNodeIds ?? [];
  assert.equal(bounded.length, 200);
  assert.deepEqual(bounded.slice(0, 2), ["node-000", "node-001"]);
  assert.deepEqual(bounded.slice(-2), ["node-198", "node-199"]);
  assert.match(Notice.messages.at(-1) ?? "", /first 200 selected Canvas node IDs/i);
});

test("Project command and Markdown/Canvas file menu entries activate supported contexts", async () => {
  const workspace = testWorkspace();
  const plugin = new CapturePlugin(workspace);
  await plugin.onload();
  const projectCommand = plugin.commands.find(item => item.id === "open-ask-mate-project-context");
  assert.ok(projectCommand?.checkCallback);
  projectCommand.checkCallback(false);
  assert.deepEqual(plugin.contexts.at(-1), {
    projectId: "project/alpha",
    kind: "project",
  });

  const fileMenu = workspace.events.get("file-menu");
  assert.ok(fileMenu);
  const markdownMenu = new Menu();
  const markdownFile = file("01-Projects/alpha/notes/from-menu.md", "md");
  fileMenu(markdownMenu, markdownFile);
  const markdownItem = markdownMenu.items.find(item => item.title === "Open in Ask Mate (LLM Wiki)");
  assert.ok(markdownItem?.click);
  markdownItem.click();
  assert.deepEqual(plugin.contexts.at(-1), {
    projectId: "project/alpha",
    kind: "markdown_note",
    path: markdownFile.path,
  });

  const canvasMenu = new Menu();
  const canvasFile = file("01-Projects/alpha/maps/from-menu.canvas", "canvas");
  fileMenu(canvasMenu, canvasFile);
  const canvasItem = canvasMenu.items.find(item => item.title === "Open in Ask Mate (LLM Wiki)");
  assert.ok(canvasItem?.click);
  canvasItem.click();
  assert.deepEqual(plugin.contexts.at(-1), {
    projectId: "project/alpha",
    kind: "canvas",
    path: canvasFile.path,
  });
});

test("mobile and non-filesystem vaults fail closed with an explicit no-scan notice", async () => {
  Notice.messages.length = 0;
  const workspace = testWorkspace();
  workspace.activeFile = file("01-Projects/alpha/notes/context.md", "md");
  let selectionRead = false;
  workspace.activeView = new MarkdownView({
    ...editor("private selection"),
    getSelection: () => {
      selectionRead = true;
      return "private selection";
    },
  }, workspace.activeFile);
  const plugin = new CapturePlugin(workspace);
  await plugin.onload();
  const command = plugin.commands.find(item => item.id === "open-ask-mate-active-note");
  assert.ok(command?.checkCallback);

  Platform.isMobileApp = true;
  command.checkCallback(false);
  Platform.isMobileApp = false;
  assert.equal(plugin.contexts.length, 0);
  assert.equal(selectionRead, false, "mobile degradation read the editor selection");
  assert.match(Notice.messages.at(-1) ?? "", /mobile app.*no note.*scanned or changed/i);

  const nonFilesystem = new CapturePlugin(workspace, {});
  await nonFilesystem.onload();
  const unavailableCommand = nonFilesystem.commands.find(item => item.id === "open-ask-mate-active-note");
  assert.ok(unavailableCommand?.checkCallback);
  unavailableCommand.checkCallback(false);
  assert.equal(nonFilesystem.contexts.length, 0);
  assert.equal(selectionRead, false, "non-filesystem degradation read the editor selection");
  assert.match(Notice.messages.at(-1) ?? "", /filesystem-backed vault.*no note.*scanned or changed/i);
});
