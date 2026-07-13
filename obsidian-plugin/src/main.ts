/*
 * LLM Wiki's Obsidian-native control surface. Settings domain behavior lives in
 * Settings Platform; this plugin owns presentation, host binding, and safe
 * action invocation only.
 */

import {
  App, Plugin, PluginSettingTab, Setting, Modal, Notice,
  TFile, TAbstractFile, Menu, FileSystemAdapter,
} from "obsidian";
import { execFile } from "child_process";
import { promisify } from "util";
import { isAbsolute } from "path";
import { buildPythonInvocation } from "./executable-command";
import {
  applyPluginDataMigration,
  LLMWikiPluginData,
  planPluginDataMigration,
  selectEditingScope,
} from "./settings";
import {
  EffectiveSetting,
  HealthCheck,
  projectSettingForScope,
  refreshSettingsProjection,
  SettingDefinition,
  SettingScope,
  SettingsConflictError,
  SettingsControlPlaneProjection,
  SettingsOperationClient,
  SettingsOperationTransport,
  SettingValue,
  UnavailableSettingsTransport,
} from "./settings-client";

const pexecFile = promisify(execFile);
const SETTINGS_TRANSPORT_KEY = "__llmwikiSettingsOperationTransport";

interface SettingsTransportHost {
  [SETTINGS_TRANSPORT_KEY]?: SettingsOperationTransport;
}

// Shape of `kb_meta promote` JSON (compiler/kb_meta.cmd_promote).
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

function getInjectedTransport(): SettingsOperationTransport {
  const transport = (globalThis as SettingsTransportHost)[SETTINGS_TRANSPORT_KEY];
  return transport ?? new UnavailableSettingsTransport(
    "Settings Platform service is not attached to the Obsidian host.",
  );
}

function stdoutText(stdout: string | Buffer): string {
  return typeof stdout === "string" ? stdout : stdout.toString("utf8");
}

export default class LLMWikiPlugin extends Plugin {
  data!: LLMWikiPluginData;
  projection: SettingsControlPlaneProjection | null = null;
  settingsError: string | null = null;
  private settingsClient!: SettingsOperationClient;

  async onload(): Promise<void> {
    this.settingsClient = new SettingsOperationClient(getInjectedTransport());
    await this.loadPluginData();
    await this.refreshSettings(false);

    this.addCommand({
      id: "promote-candidate",
      name: "Promote candidate (LLM Wiki)",
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        const ok = !!file && file.extension === "md";
        if (ok && !checking) void this.promote(file as TFile);
        return ok;
      },
    });

    this.addCommand({
      id: "refresh-settings-control-plane",
      name: "Refresh settings control plane (LLM Wiki)",
      callback: () => void this.refreshSettings(true),
    });

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) => item
            .setTitle("Promote candidate (LLM Wiki)")
            .setIcon("check-circle")
            .onClick(() => void this.promote(file)));
        }
      }),
    );
    this.addSettingTab(new LLMWikiSettingTab(this.app, this));
  }

  onunload(): void {}

  private vaultBasePath(): string | null {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
  }

  private effectiveValue<T extends SettingValue>(key: string): T {
    const effective = this.projection?.snapshot.effective[key];
    if (!effective) throw new Error(`Effective setting is unavailable: ${key}`);
    return effective.value as T;
  }

  private async runPromote(noteId: string, apply: boolean): Promise<PromoteResult> {
    try {
      const pythonCommand = this.effectiveValue<string>("runtime.python.path");
      const kbMetaPath = this.effectiveValue<string>("runtime.kb_meta.path");
      if (!kbMetaPath || !isAbsolute(kbMetaPath)) {
        return { outcome: "ERROR", error: "Set an absolute LLM Wiki runtime entry in Settings Platform." };
      }
      const cwd = this.vaultBasePath();
      if (!cwd) return { outcome: "ERROR", error: "Vault is not on the local filesystem (desktop only)." };
      const args = [kbMetaPath, "promote", "--note", noteId];
      if (apply) args.push("--apply");
      const invocation = buildPythonInvocation(pythonCommand, args);
      const { stdout } = await pexecFile(invocation.executable, invocation.args, {
        cwd,
        env: { ...process.env, PYTHONUTF8: "1" },
        windowsHide: true,
      });
      return JSON.parse(stdoutText(stdout)) as PromoteResult;
    } catch (error) {
      const output = (error as { stdout?: string | Buffer })?.stdout;
      if (output !== undefined) {
        try { return JSON.parse(stdoutText(output)) as PromoteResult; } catch { /* use safe message */ }
      }
      return { outcome: "ERROR", error: String((error as Error)?.message ?? error) };
    }
  }

  private async promote(file: TFile): Promise<void> {
    const noteId = file.path;
    new Notice("LLM Wiki: computing promote plan…");
    const dry = await this.runPromote(noteId, false);
    if (dry.error) { new Notice(`LLM Wiki: ${dry.error}`); return; }
    if (dry.outcome !== "MATERIALIZED") {
      new Notice(`LLM Wiki: cannot promote — ${dry.outcome}${dry.reason ? `: ${dry.reason}` : ""}`);
      return;
    }
    new PromotePlanModal(this.app, noteId, dry, async () => {
      const result = await this.runPromote(noteId, true);
      if (result.error || result.outcome !== "MATERIALIZED") {
        new Notice(`LLM Wiki: promote failed — ${result.error ?? result.outcome}`);
        return;
      }
      new Notice(`LLM Wiki: promoted → ${result.snapshot_note_id ?? "(written)"}. Review & commit via git.`);
    }).open();
  }

  private async loadPluginData(): Promise<void> {
    const plan = planPluginDataMigration(await this.loadData());
    this.data = plan.data;
    if (plan.assignments.length) {
      try {
        const migrated = await applyPluginDataMigration(this.settingsClient, plan);
        this.data = migrated.data;
        await this.savePluginData();
      } catch (error) {
        // Do not save the stripped document until Settings Platform accepts all
        // assignments. The legacy source remains intact for a later retry.
        this.settingsError = `Legacy settings migration pending: ${String((error as Error)?.message ?? error)}`;
      }
    } else if (plan.migrated) {
      await this.savePluginData();
    }
  }

  async savePluginData(): Promise<void> {
    await this.saveData(this.data);
  }

  async setEditingScope(scope: SettingScope): Promise<void> {
    this.data = selectEditingScope(this.data, scope);
    await this.savePluginData();
  }

  async refreshSettings(notify: boolean): Promise<void> {
    try {
      this.projection = await refreshSettingsProjection(this.settingsClient);
      this.settingsError = null;
      if (notify) new Notice("LLM Wiki: settings refreshed.");
    } catch (error) {
      this.projection = null;
      this.settingsError = String((error as Error)?.message ?? error);
      if (notify) new Notice(`LLM Wiki: settings unavailable — ${this.settingsError}`);
    }
  }

  async updateSetting(scope: SettingScope, key: string, value: SettingValue): Promise<void> {
    const expectedRevision = this.projection?.snapshot.sourceRevisions[scope] ?? 0;
    try {
      await this.settingsClient.setAssignment(scope, key, value, expectedRevision);
      await this.refreshSettings(false);
    } catch (error) {
      if (error instanceof SettingsConflictError) {
        await this.refreshSettings(false);
        throw new Error(`Setting changed elsewhere (revision ${error.conflict.actualRevision}); refreshed latest value.`);
      }
      throw error;
    }
  }

  async unsetSetting(scope: SettingScope, key: string): Promise<void> {
    const expectedRevision = this.projection?.snapshot.sourceRevisions[scope] ?? 0;
    try {
      await this.settingsClient.unsetAssignment(scope, key, expectedRevision);
      await this.refreshSettings(false);
    } catch (error) {
      if (error instanceof SettingsConflictError) {
        await this.refreshSettings(false);
        throw new Error(`Setting changed elsewhere (revision ${error.conflict.actualRevision}); refreshed latest value.`);
      }
      throw error;
    }
  }
}

class PromotePlanModal extends Modal {
  constructor(
    app: App,
    private readonly noteId: string,
    private readonly result: PromoteResult,
    private readonly onConfirm: () => Promise<void>,
  ) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Promote candidate" });
    contentEl.createEl("p", { text: `${this.noteId}  →  ${this.result.snapshot_note_id ?? "reviewed snapshot"}` });
    if (this.result.head_note_id) contentEl.createEl("p", { text: `Supersedes current head: ${this.result.head_note_id}` });
    contentEl.createEl("pre", { cls: "vault-mind-promote-plan" }).setText(this.result.plan ?? "(no plan)");
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const confirm = buttons.createEl("button", { text: "Promote (writes reviewed snapshot)", cls: "mod-cta" });
    confirm.onclick = async () => { this.close(); await this.onConfirm(); };
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
  }

  onClose(): void { this.contentEl.empty(); }
}

const CATEGORY_LABELS: Record<string, string> = {
  runtime: "Runtime",
  vault: "Vault",
  query: "Query and index",
  diagnostics: "Diagnostics",
  providers: "Providers and connectors",
};

const SCOPE_LABELS: Record<SettingScope | "product-default", string> = {
  "user-device": "This device",
  vault: "This vault",
  "workspace-project": "Workspace / project",
  session: "Current session",
  "product-default": "Product default",
};

class LLMWikiSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly llmWiki: LLMWikiPlugin) {
    super(app, llmWiki);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("llmwiki-settings");
    containerEl.createEl("h1", { text: "LLM Wiki" });
    containerEl.createEl("p", {
      cls: "llmwiki-settings-intro",
      text: "This page is a control plane over Settings Platform. Obsidian stores presentation and device binding only.",
    });
    this.renderOverview(containerEl);
    if (!this.llmWiki.projection) return;
    this.renderScopeSelector(containerEl);

    const scope = this.llmWiki.data.presentation.selectedScope;
    for (const category of [...new Set(this.llmWiki.projection.definitions.map(item => item.category))]) {
      const definitions = this.llmWiki.projection.definitions.filter(definition =>
        definition.category === category
        && definition.allowedScopes.includes(scope)
        && (this.llmWiki.data.presentation.showAdvanced || !definition.advanced),
      );
      if (!definitions.length) continue;
      containerEl.createEl("h2", { text: CATEGORY_LABELS[category] ?? category });
      for (const definition of definitions) this.renderDefinition(containerEl, definition);
    }

    new Setting(containerEl)
      .setName("Show advanced settings")
      .setDesc("Reveal operator-oriented provider bindings and settings.")
      .addToggle(toggle => toggle
        .setValue(this.llmWiki.data.presentation.showAdvanced)
        .onChange(async value => {
          this.llmWiki.data = {
            ...this.llmWiki.data,
            presentation: { ...this.llmWiki.data.presentation, showAdvanced: value },
          };
          await this.llmWiki.savePluginData();
          this.display();
        }));
  }

  private renderOverview(containerEl: HTMLElement): void {
    const overview = containerEl.createDiv({ cls: "llmwiki-settings-overview" });
    const heading = overview.createDiv({ cls: "llmwiki-settings-overview-heading" });
    heading.createEl("strong", { text: "System status" });
    heading.createEl("span", {
      text: this.llmWiki.projection
        ? `Refreshed ${this.llmWiki.projection.refreshedAt}`
        : "Settings Platform unavailable",
    });
    if (this.llmWiki.settingsError) overview.createEl("p", { text: this.llmWiki.settingsError });
    for (const check of this.llmWiki.projection?.health ?? []) this.renderHealth(overview, check);
    const actions = overview.createDiv({ cls: "llmwiki-settings-actions" });
    const refresh = actions.createEl("button", { text: "Refresh / Run Doctor", cls: "mod-cta" });
    refresh.onclick = async () => {
      refresh.disabled = true;
      refresh.setText("Checking…");
      await this.llmWiki.refreshSettings(false);
      this.display();
    };
  }

  private renderHealth(containerEl: HTMLElement, check: HealthCheck): void {
    const item = containerEl.createDiv({ cls: `llmwiki-health llmwiki-health-${check.state}` });
    item.createEl("span", { cls: "llmwiki-health-dot" });
    const copy = item.createDiv();
    copy.createEl("strong", { text: check.capability });
    copy.createEl("small", { text: check.remediation ? `${check.summary} ${check.remediation}` : check.summary });
  }

  private renderScopeSelector(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Editing scope")
      .setDesc("The shared registry determines which settings each scope may own.")
      .addDropdown(dropdown => dropdown
        .addOption("user-device", SCOPE_LABELS["user-device"])
        .addOption("vault", SCOPE_LABELS.vault)
        .setValue(this.llmWiki.data.presentation.selectedScope)
        .onChange(async value => {
          await this.llmWiki.setEditingScope(value as SettingScope);
          this.display();
        }));
  }

  private renderDefinition(containerEl: HTMLElement, definition: SettingDefinition): void {
    const projection = this.llmWiki.projection!;
    const scope = this.llmWiki.data.presentation.selectedScope;
    const row = projectSettingForScope(definition, projection.snapshot, scope);
    if (!row) return;
    const { effective, validation } = row;
    const description = [
      definition.description,
      `Effective: ${this.displayValue(definition, effective)}`,
      `source: ${SCOPE_LABELS[effective.winningScope]}`,
      `apply: ${definition.applyMode}`,
      ...validation.map(issue => `${issue.severity}: ${issue.message}`),
    ].join(" · ");
    const setting = new Setting(containerEl).setName(definition.name).setDesc(description);
    const assignedHere = row.assignedValue !== undefined;

    if (definition.valueType === "boolean") {
      setting.addToggle(toggle => toggle
        .setValue(Boolean(effective.value))
        .onChange(async value => this.mutate(() => this.llmWiki.updateSetting(scope, definition.key, value))));
    } else {
      setting.addText(text => {
        text.setPlaceholder(definition.placeholder ?? "").setValue(assignedHere ? String(row.assignedValue) : "");
        text.inputEl.addEventListener("change", () => void this.mutate(async () => {
          const value = text.getValue();
          if (!value.trim() && !definition.required) await this.llmWiki.unsetSetting(scope, definition.key);
          else await this.llmWiki.updateSetting(scope, definition.key, value);
        }));
      });
    }

    if (assignedHere) {
      setting.addExtraButton(button => button
        .setIcon("reset")
        .setTooltip("Remove this assignment and inherit the next effective value")
        .onClick(async () => this.mutate(() => this.llmWiki.unsetSetting(scope, definition.key))));
    }
  }

  private async mutate(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      new Notice(`LLM Wiki: ${String((error as Error)?.message ?? error)}`);
    }
    this.display();
  }

  private displayValue(definition: SettingDefinition, effective: EffectiveSetting): string {
    if (definition.valueType === "secret-reference") return effective.value ? String(effective.value) : "not configured";
    return JSON.stringify(effective.value);
  }
}
