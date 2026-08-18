import {
  FileSystemAdapter,
  ItemView,
  PluginSettingTab,
  type App,
  type Plugin,
  type WorkspaceLeaf,
} from "obsidian";
import { AgentfilesView, VIEW_TYPE } from "./views/main-view";
import { SkillStore } from "./store";
import { SkillWatcher } from "./watcher";
import { getWatchPaths } from "./scanner";
import { AgentfilesSettingTab } from "./settings";
import { DEFAULT_SETTINGS, type ChopsSettings } from "./types";

export interface AgentfilesDraftWriter {
  (input: {
    parentQuery: string;
    sourceNodes: string[];
    body: string;
    slug: string;
  }): Promise<{ ok: boolean; path: string; replayed?: boolean }>;
}

export interface AgentfilesHost {
  app: App;
  registerView(
    viewType: string,
    viewCreator: (leaf: WorkspaceLeaf) => ItemView,
  ): void;
  addRibbonIcon(icon: string, title: string, callback: () => void): HTMLElement;
  addCommand(command: Parameters<Plugin["addCommand"]>[0]): void;
  addSettingTab(settingTab: PluginSettingTab): void;
}

function cloneDefaults(): ChopsSettings {
  return {
    ...DEFAULT_SETTINGS,
    tools: {},
    favorites: [],
    collections: {},
    customScanPaths: [],
  };
}

function normalizeSettings(raw: Partial<ChopsSettings> | undefined): ChopsSettings {
  const defaults = cloneDefaults();
  const settings = raw && typeof raw === "object" ? raw : {};
  return {
    ...defaults,
    ...settings,
    tools: settings.tools && typeof settings.tools === "object" ? settings.tools : {},
    favorites: Array.isArray(settings.favorites) ? [...settings.favorites] : [],
    collections: settings.collections && typeof settings.collections === "object" ? settings.collections : {},
    customScanPaths: Array.isArray(settings.customScanPaths) ? [...settings.customScanPaths] : [],
  };
}

/**
 * Native LLM Wiki host for the upstream Agentfiles capability. The feature is
 * deliberately a host adapter rather than a second Obsidian Plugin instance:
 * one plugin owns lifecycle, settings persistence, and teardown.
 */
export class AgentfilesFeature {
  settings: ChopsSettings;
  readonly store = new SkillStore();
  private watcher: SkillWatcher | null = null;

  constructor(
    private readonly host: AgentfilesHost,
    settings: Partial<ChopsSettings> | undefined,
    private readonly persist: (settings: ChopsSettings) => Promise<void>,
    private readonly writeInboxDraft?: AgentfilesDraftWriter,
  ) {
    this.settings = normalizeSettings(settings);
  }

  async onload(): Promise<void> {
    this.addVaultPath();

    this.host.registerView(VIEW_TYPE, (leaf) =>
      new AgentfilesView(
        leaf,
        this.store,
        this.settings,
        () => this.saveSettings(),
        this.writeInboxDraft,
      )
    );

    this.host.addCommand({
      id: "open-agentfiles",
      name: "Open Capability Library (LLM Wiki)",
      callback: () => void this.activateView(),
    });
	this.host.addSettingTab(new AgentfilesSettingTab(this.host.app, this, this.host as unknown as Plugin));

    this.store.setDeepSearch(this.settings.deepSearchDefault ?? false);
    this.store.setDeepSearchScope(this.settings.deepSearchScope ?? "both");

    // Populate the store immediately. Some Obsidian startup paths invoke the
    // feature after the layout-ready event has already fired; relying only on
    // that callback leaves the first Agentfiles view empty until a later
    // lifecycle event.
    this.refreshStore();
    this.startWatcher();

    const workspace = this.host.app.workspace as unknown as {
      onLayoutReady?: (callback: () => void) => void;
    };
    if (typeof workspace.onLayoutReady === "function") {
      workspace.onLayoutReady(() => {
        this.refreshStore();
      });
    }
  }

  async saveSettings(): Promise<void> {
    await this.persist(this.settings);
  }

  refreshStore(): void {
    this.store.refresh(this.settings);
  }

  startWatcher(): void {
    if (!this.settings.watchEnabled) return;
    this.watcher = new SkillWatcher(this.settings.watchDebounceMs, () => this.refreshStore());
    this.watcher.watchPaths(getWatchPaths(this.settings));
  }

  stopWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  restartWatcher(): void {
    this.stopWatcher();
    this.startWatcher();
  }

  async activateView(): Promise<void> {
    // The feature can be loaded before the vault adapter has finished
    // exposing all external tool paths. Refresh at the user-visible entry
    // point so opening Agentfiles never presents a stale empty library.
    this.refreshStore();
    if (!this.watcher) this.startWatcher();
    const existing = this.host.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length > 0) {
      await this.host.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.host.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.host.app.workspace.revealLeaf(leaf);
  }

  onunload(): void {
    this.stopWatcher();
    this.host.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  private addVaultPath(): void {
    const adapter = this.host.app.vault.adapter as FileSystemAdapter;
    if (!adapter.getBasePath) return;
    const vaultPath = adapter.getBasePath();
    if (!this.settings.customScanPaths.includes(vaultPath)) {
      this.settings.customScanPaths.push(vaultPath);
    }
  }
}
