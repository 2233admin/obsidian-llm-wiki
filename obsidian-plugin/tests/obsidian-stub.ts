/**
 * Minimal runtime stand-in for the "obsidian" package so lifecycle tests can
 * bundle src/main.ts (the real package ships types only; the runtime lives
 * inside the Obsidian app). Only what LLMWikiPlugin touches is implemented.
 */

export class Notice {
  static messages: string[] = [];
  constructor(public message?: string) {
    if (message) Notice.messages.push(message);
  }
}

export class TFile {
  path = "";
  extension = "md";
  constructor(path = "", extension = "md") {
    this.path = path;
    this.extension = extension;
  }
}

export class TAbstractFile {}

export class MenuItem {
  title = "";
  icon = "";
  click: (() => void) | null = null;
  setTitle(value: string): this { this.title = value; return this; }
  setIcon(value: string): this { this.icon = value; return this; }
  onClick(callback: () => void): this { this.click = callback; return this; }
}

export class Menu {
  items: MenuItem[] = [];
  addItem(callback: (item: MenuItem) => unknown): this {
    const item = new MenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }
}

export class FileSystemAdapter {
  getBasePath(): string {
    throw new Error("stub FileSystemAdapter has no base path");
  }
}

export class App {}

export const Platform = {
  isDesktop: true,
  isMobile: false,
  isDesktopApp: true,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
  isPhone: false,
  isTablet: false,
  isMacOS: false,
  isWin: true,
  isLinux: false,
  isSafari: false,
};

export class MarkdownView {
  file: TFile | null = null;
  editor: unknown;
  constructor(editor: unknown = null, file: TFile | null = null) {
    this.editor = editor;
    this.file = file;
  }
}

export class WorkspaceLeaf {
  view: unknown = null;
  async setViewState(_state: unknown): Promise<void> {}
}

export class Modal {
  contentEl = {
    empty: () => undefined,
    createEl: () => ({ setText: () => undefined, onclick: null }),
    createDiv: () => ({ createEl: () => ({ setText: () => undefined, onclick: null }) }),
  };
  constructor(public app: unknown) {}
  open(): void {}
  close(): void {}
}

export class ItemView {
  containerEl = {
    children: [
      {},
      {
        empty: () => undefined,
        addClass: () => undefined,
        createEl: () => ({
          createEl: () => ({}),
          createSpan: () => ({}),
          createDiv: () => ({}),
        }),
        createDiv: () => ({
          style: { setProperty: () => undefined },
          createEl: () => ({}),
        }),
      },
    ],
  };
  constructor(public leaf: WorkspaceLeaf) {}
  getViewType(): string { return ""; }
  getDisplayText(): string { return ""; }
}

export interface StubCommand {
  id: string;
  name: string;
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean;
}

export class Plugin {
  commands: StubCommand[] = [];
  views = new Map<string, (leaf: WorkspaceLeaf) => unknown>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public app: any, public manifest: { id?: string; dir?: string }) {}
  addCommand(command: StubCommand): StubCommand {
    this.commands.push(command);
    return command;
  }
  addSettingTab(_tab: unknown): void {}
  registerView(type: string, creator: (leaf: WorkspaceLeaf) => unknown): void {
    this.views.set(type, creator);
  }
  registerEvent(_ref: unknown): void {}
  async loadData(): Promise<unknown> {
    throw new Error("override loadData in the test subclass");
  }
  async saveData(_data: unknown): Promise<void> {
    throw new Error("override saveData in the test subclass");
  }
}

export class PluginSettingTab {
  containerEl = { empty: () => undefined };
  constructor(public app: unknown, public plugin: unknown) {}
  display(): void {}
}

export class Setting {
  constructor(_containerEl: unknown) {}
  setName(): this { return this; }
  setDesc(): this { return this; }
  setHeading(): this { return this; }
  addToggle(): this { return this; }
  addDropdown(): this { return this; }
  addText(): this { return this; }
  addTextArea(): this { return this; }
  addButton(): this { return this; }
  addExtraButton(): this { return this; }
}
