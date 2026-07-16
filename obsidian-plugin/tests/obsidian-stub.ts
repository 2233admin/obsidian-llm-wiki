/**
 * Minimal runtime stand-in for the "obsidian" package so lifecycle tests can
 * bundle src/main.ts (the real package ships types only; the runtime lives
 * inside the Obsidian app). Only what LLMWikiPlugin touches is implemented.
 */

export class Notice {
  constructor(public message?: string) {}
}

export class TFile {
  path = "";
  extension = "md";
}

export class TAbstractFile {}

export class Menu {}

export class FileSystemAdapter {
  getBasePath(): string {
    throw new Error("stub FileSystemAdapter has no base path");
  }
}

export class App {}

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

export interface StubCommand {
  id: string;
  name: string;
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean;
}

export class Plugin {
  commands: StubCommand[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(public app: any, public manifest: { id?: string; dir?: string }) {}
  addCommand(command: StubCommand): StubCommand {
    this.commands.push(command);
    return command;
  }
  addSettingTab(_tab: unknown): void {}
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
