import {
  App,
  FileSystemAdapter,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
} from "obsidian";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";

const pexecFile = promisify(execFile);

interface VaultMindPromoteSettings {
  pythonPath: string;
  kbMetaPath: string;
}

interface PromoteResult {
  outcome: string;
  entity?: string;
  head_note_id?: string | null;
  snapshot_note_id?: string | null;
  reason?: string;
  plan?: string;
  written?: string;
  error?: string;
}

interface PromoteStage {
  key: "note" | "plan" | "write" | "review";
  label: string;
}

const DEFAULT_SETTINGS: VaultMindPromoteSettings = {
  pythonPath: "python",
  kbMetaPath: "",
};

const STAGES: PromoteStage[] = [
  { key: "note", label: "Note" },
  { key: "plan", label: "Plan" },
  { key: "write", label: "Promote" },
  { key: "review", label: "Review" },
];

export default class VaultMindPromotePlugin extends Plugin {
  settings!: VaultMindPromoteSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addRibbonIcon("git-pull-request", "Vault Mind promote", () => {
      const file = this.app.workspace.getActiveFile();
      if (file?.extension === "md") {
        this.openPromoteFlow(file);
      } else {
        new Notice("Open a markdown note first.");
      }
    });

    this.addCommand({
      id: "promote-candidate",
      name: "Open promote flow",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        const ok = !!file && file.extension === "md";
        if (ok && !checking) this.openPromoteFlow(file as TFile);
        return ok;
      },
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) =>
            item
              .setTitle("Open promote flow")
              .setIcon("git-pull-request")
              .onClick(() => this.openPromoteFlow(file)),
          );
        }
      }),
    );

    this.addSettingTab(new VaultMindPromoteSettingTab(this.app, this));
  }

  onunload(): void {}

  openPromoteFlow(file: TFile): void {
    new PromoteFlowModal(this.app, this, file).open();
  }

  async runPromote(noteId: string, apply: boolean): Promise<PromoteResult> {
    if (!this.settings.kbMetaPath) {
      return { outcome: "ERROR", error: "Set the kb_meta.py path in settings." };
    }

    const cwd = this.vaultBasePath();
    if (!cwd) {
      return { outcome: "ERROR", error: "Vault is not on the local filesystem." };
    }

    const args = [this.settings.kbMetaPath, "promote", "--note", noteId];
    if (apply) args.push("--apply");

    try {
      const { stdout } = await pexecFile(this.settings.pythonPath, args, {
        cwd,
        env: { ...process.env, PYTHONUTF8: "1" },
      });
      return JSON.parse(stdout) as PromoteResult;
    } catch (error) {
      const stdout = (error as { stdout?: string }).stdout;
      if (typeof stdout === "string" && stdout.trim()) {
        try {
          return JSON.parse(stdout) as PromoteResult;
        } catch {
          return { outcome: "ERROR", error: stdout.trim() };
        }
      }
      return { outcome: "ERROR", error: String((error as Error)?.message ?? error) };
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  vaultBasePath(): string | null {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
  }
}

type HealthTone = "good" | "warn" | "bad";

interface HealthRow {
  label: string;
  status: string;
  detail: string;
  tone: HealthTone;
}

class PromoteFlowModal extends Modal {
  private stageKey: PromoteStage["key"] = "note";
  private dryRunResult: PromoteResult | null = null;
  private readonly noteId: string;

  constructor(
    app: App,
    private readonly plugin: VaultMindPromotePlugin,
    private readonly file: TFile,
  ) {
    super(app);
    this.noteId = file.path;
  }

  onOpen(): void {
    this.contentEl.addClass("vault-mind-flow");
    this.render("loading");
    window.setTimeout(() => void this.loadPlan(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async loadPlan(): Promise<void> {
    if (!this.plugin.settings.kbMetaPath) {
      this.stageKey = "note";
      this.render("settings");
      return;
    }

    this.stageKey = "plan";
    this.render("loading");
    const result = await this.plugin.runPromote(this.noteId, false);
    if (result.error || result.outcome !== "MATERIALIZED") {
      this.dryRunResult = result;
      this.render("blocked");
      return;
    }

    this.dryRunResult = result;
    this.render("ready");
  }

  private async applyPromotion(): Promise<void> {
    this.stageKey = "write";
    this.render("writing");
    const result = await this.plugin.runPromote(this.noteId, true);
    if (result.error || result.outcome !== "MATERIALIZED") {
      this.dryRunResult = result;
      this.render("blocked");
      return;
    }

    this.stageKey = "review";
    this.dryRunResult = result;
    this.render("complete");
    new Notice(`vault-mind promoted ${result.snapshot_note_id ?? this.file.basename}`);
  }

  private render(state: "loading" | "settings" | "blocked" | "ready" | "writing" | "complete"): void {
    this.contentEl.empty();
    this.contentEl.addClass("vault-mind-flow");

    const header = this.contentEl.createDiv({ cls: "vm-flow-hero" });
    const mark = header.createDiv({ cls: "vm-flow-mark", text: "VM" });
    mark.setAttr("aria-hidden", "true");
    const titleWrap = header.createDiv({ cls: "vm-flow-title" });
    titleWrap.createEl("h2", { text: "Promote Flow" });
    titleWrap.createEl("div", { cls: "vm-flow-note", text: this.noteId });

    this.renderStageRail();

    const panel = this.contentEl.createDiv({ cls: `vm-flow-panel is-${state}` });
    if (state === "loading") this.renderLoading(panel);
    if (state === "settings") this.renderSettings(panel);
    if (state === "blocked") this.renderBlocked(panel);
    if (state === "ready") this.renderReady(panel);
    if (state === "writing") this.renderWriting(panel);
    if (state === "complete") this.renderComplete(panel);
  }

  private renderStageRail(): void {
    const rail = this.contentEl.createDiv({ cls: "vm-stage-rail" });
    const activeIndex = STAGES.findIndex((stage) => stage.key === this.stageKey);
    STAGES.forEach((stage, index) => {
      const item = rail.createDiv({
        cls: `vm-stage ${index <= activeIndex ? "is-lit" : ""} ${stage.key === this.stageKey ? "is-current" : ""}`,
      });
      item.createSpan({ cls: "vm-stage-dot" });
      item.createSpan({ cls: "vm-stage-label", text: stage.label });
    });
  }

  private renderLoading(panel: HTMLElement): void {
    panel.createDiv({ cls: "vm-kicker", text: "Planning" });
    panel.createEl("h3", { text: "Materializing the reviewed snapshot" });
    panel.createDiv({ cls: "vm-progress-bar" }).createDiv({ cls: "vm-progress-fill" });
    this.renderFooter(panel, [{ label: "Cancel", action: () => this.close(), variant: "quiet" }]);
  }

  private renderSettings(panel: HTMLElement): void {
    panel.createDiv({ cls: "vm-kicker", text: "Setup needed" });
    panel.createEl("h3", { text: "kb_meta.py is not connected" });
    panel.createDiv({ cls: "vm-flow-copy", text: "Set the compiler path in Vault Mind Promote settings." });
    this.renderFooter(panel, [
      { label: "Close", action: () => this.close(), variant: "primary" },
    ]);
  }

  private renderBlocked(panel: HTMLElement): void {
    const result = this.dryRunResult;
    panel.createDiv({ cls: "vm-kicker", text: result?.outcome ?? "Blocked" });
    panel.createEl("h3", { text: "Promotion cannot continue" });
    panel.createDiv({ cls: "vm-flow-copy", text: result?.error ?? result?.reason ?? "The compiler returned no reason." });
    this.renderFooter(panel, [
      { label: "Run again", action: () => void this.loadPlan(), variant: "primary" },
      { label: "Close", action: () => this.close(), variant: "quiet" },
    ]);
  }

  private renderReady(panel: HTMLElement): void {
    const result = this.dryRunResult;
    panel.createDiv({ cls: "vm-kicker", text: "Ready" });
    panel.createEl("h3", { text: result?.snapshot_note_id ?? "Reviewed snapshot" });
    if (result?.head_note_id) {
      panel.createDiv({ cls: "vm-flow-copy", text: `Supersedes ${result.head_note_id}` });
    }
    const pre = panel.createEl("pre", { cls: "vm-plan-preview" });
    pre.setText(result?.plan ?? "(no plan returned)");
    this.renderFooter(panel, [
      { label: "Promote snapshot", action: () => void this.applyPromotion(), variant: "primary" },
      { label: "Refresh plan", action: () => void this.loadPlan(), variant: "secondary" },
      { label: "Cancel", action: () => this.close(), variant: "quiet" },
    ]);
  }

  private renderWriting(panel: HTMLElement): void {
    panel.createDiv({ cls: "vm-kicker", text: "Writing" });
    panel.createEl("h3", { text: "Appending reviewed snapshot" });
    panel.createDiv({ cls: "vm-progress-bar" }).createDiv({ cls: "vm-progress-fill" });
    this.renderFooter(panel, []);
  }

  private renderComplete(panel: HTMLElement): void {
    const result = this.dryRunResult;
    panel.createDiv({ cls: "vm-kicker", text: "Complete" });
    panel.createEl("h3", { text: result?.snapshot_note_id ?? "Snapshot written" });
    panel.createDiv({ cls: "vm-flow-copy", text: "Review the new note and commit the vault change when ready." });
    this.renderFooter(panel, [
      { label: "Close", action: () => this.close(), variant: "primary" },
    ]);
  }

  private renderFooter(
    panel: HTMLElement,
    actions: Array<{ label: string; action: () => void; variant: "primary" | "secondary" | "quiet" }>,
  ): void {
    const footer = panel.createDiv({ cls: "vm-flow-actions" });
    for (const action of actions) {
      const button = footer.createEl("button", {
        text: action.label,
        cls: `vm-action vm-action-${action.variant}`,
      });
      button.setAttr("aria-label", action.label);
      button.onclick = action.action;
    }
  }
}

class VaultMindPromoteSettingTab extends PluginSettingTab {
  private healthRowsEl: HTMLElement | null = null;
  private refreshButtonEl: HTMLButtonElement | null = null;
  private refreshRun = 0;

  constructor(app: App, private readonly plugin: VaultMindPromotePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("vault-mind-settings");

    const header = containerEl.createDiv({ cls: "vm-settings-hero" });
    header.createEl("h2", { text: "Vault Mind Promote" });
    header.createDiv({ cls: "vm-settings-subtitle", text: "Connect the compiler once; every promote gesture uses the same flow." });

    this.renderHealthCard(containerEl);

    new Setting(containerEl)
      .setName("Python")
      .setDesc("Executable used to run kb_meta.py.")
      .addText((text) =>
        text
          .setPlaceholder("python")
          .setValue(this.plugin.settings.pythonPath)
          .onChange(async (value) => {
            this.plugin.settings.pythonPath = value.trim() || DEFAULT_SETTINGS.pythonPath;
            await this.plugin.saveSettings();
            this.markHealthStale();
          }),
      );

    new Setting(containerEl)
      .setName("kb_meta.py")
      .setDesc("Absolute path to compiler/kb_meta.py.")
      .addText((text) =>
        text
          .setPlaceholder("D:/projects/obsidian-llm-wiki/compiler/kb_meta.py")
          .setValue(this.plugin.settings.kbMetaPath)
          .onChange(async (value) => {
            this.plugin.settings.kbMetaPath = value.trim();
            await this.plugin.saveSettings();
            this.markHealthStale();
          }),
      );
  }

  private renderHealthCard(containerEl: HTMLElement): void {
    const card = containerEl.createDiv({ cls: "vm-health-card" });
    const header = card.createDiv({ cls: "vm-health-header" });
    const title = header.createDiv({ cls: "vm-health-title" });
    title.createEl("span", { cls: "vm-kicker", text: "Local readiness" });
    title.createEl("h3", { text: "Promote environment" });
    title.createDiv({
      cls: "vm-health-copy",
      text: "Checks the Python runner, compiler script, and vault filesystem path before the flow asks you to promote.",
    });

    this.refreshButtonEl = header.createEl("button", {
      text: "Refresh checks",
      cls: "vm-health-refresh",
    });
    this.refreshButtonEl.onclick = () => {
      void this.refreshHealthStatus();
    };

    this.healthRowsEl = card.createDiv({ cls: "vm-health-list" });
    void this.refreshHealthStatus();
  }

  private async refreshHealthStatus(): Promise<void> {
    const run = ++this.refreshRun;
    this.renderHealthRows([
      { label: "kb_meta.py", status: "Checking", detail: "Verifying configured compiler path.", tone: "warn" },
      { label: "Python", status: "Checking", detail: "Running Python version probe.", tone: "warn" },
      { label: "Vault", status: "Checking", detail: "Resolving local vault filesystem path.", tone: "warn" },
    ]);

    if (this.refreshButtonEl) {
      this.refreshButtonEl.disabled = true;
      this.refreshButtonEl.textContent = "Checking...";
    }

    const rows = await this.collectHealthRows();
    if (run !== this.refreshRun) return;

    this.renderHealthRows(rows);
    if (this.refreshButtonEl) {
      this.refreshButtonEl.disabled = false;
      this.refreshButtonEl.textContent = "Refresh checks";
    }
  }

  private async collectHealthRows(): Promise<HealthRow[]> {
    return [
      this.checkKbMetaPath(),
      await this.checkPython(),
      this.checkVaultPath(),
    ];
  }

  private checkKbMetaPath(): HealthRow {
    const kbMetaPath = this.plugin.settings.kbMetaPath.trim();
    if (!kbMetaPath) {
      return {
        label: "kb_meta.py",
        status: "Missing",
        detail: "Set the absolute path to compiler/kb_meta.py.",
        tone: "bad",
      };
    }

    if (!existsSync(kbMetaPath)) {
      return {
        label: "kb_meta.py",
        status: "Not found",
        detail: kbMetaPath,
        tone: "bad",
      };
    }

    if (!kbMetaPath.endsWith("kb_meta.py")) {
      return {
        label: "kb_meta.py",
        status: "Check path",
        detail: `File exists, but the name does not end with kb_meta.py: ${kbMetaPath}`,
        tone: "warn",
      };
    }

    return {
      label: "kb_meta.py",
      status: "Ready",
      detail: kbMetaPath,
      tone: "good",
    };
  }

  private async checkPython(): Promise<HealthRow> {
    const pythonPath = this.plugin.settings.pythonPath.trim() || DEFAULT_SETTINGS.pythonPath;
    try {
      const { stdout, stderr } = await pexecFile(pythonPath, ["--version"], {
        env: { ...process.env, PYTHONUTF8: "1" },
      });
      const version = `${stdout}${stderr}`.trim() || "Python responded without version text.";
      return {
        label: "Python",
        status: "Ready",
        detail: `${pythonPath} - ${version}`,
        tone: "good",
      };
    } catch (error) {
      return {
        label: "Python",
        status: "Unavailable",
        detail: `${pythonPath} - ${this.errorMessage(error)}`,
        tone: "bad",
      };
    }
  }

  private checkVaultPath(): HealthRow {
    const vaultPath = this.plugin.vaultBasePath();
    if (!vaultPath) {
      return {
        label: "Vault",
        status: "Unsupported",
        detail: "This vault is not backed by Obsidian's local filesystem adapter.",
        tone: "bad",
      };
    }

    if (!existsSync(vaultPath)) {
      return {
        label: "Vault",
        status: "Not found",
        detail: vaultPath,
        tone: "bad",
      };
    }

    return {
      label: "Vault",
      status: "Ready",
      detail: vaultPath,
      tone: "good",
    };
  }

  private markHealthStale(): void {
    this.renderHealthRows([
      {
        label: "Configuration",
        status: "Refresh needed",
        detail: "Settings changed. Run checks again when you finish editing.",
        tone: "warn",
      },
    ]);
  }

  private renderHealthRows(rows: HealthRow[]): void {
    if (!this.healthRowsEl) return;

    this.healthRowsEl.empty();
    for (const row of rows) {
      const item = this.healthRowsEl.createDiv({ cls: `vm-health-row is-${row.tone}` });
      item.createDiv({ cls: "vm-health-dot" });
      const body = item.createDiv({ cls: "vm-health-body" });
      body.createDiv({ cls: "vm-health-label", text: row.label });
      body.createDiv({ cls: "vm-health-detail", text: row.detail });
      item.createDiv({ cls: "vm-health-status", text: row.status });
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
