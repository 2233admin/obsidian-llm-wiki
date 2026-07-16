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
  DeviceBindingReference,
  LegacyMigrationPreimage,
  LLMWikiPluginData,
  parseSettingInput,
  planPluginDataMigration,
  preservePendingMigrationSource,
  rollbackPluginDataMigration,
  selectEditingScope,
} from "./settings";
import {
  EffectiveSetting,
  effectiveSetting,
  HealthCheck,
  isSecretReference,
  projectSettingForScope,
  redactedSecretLabel,
  refreshSettingsProjection,
  SecretReference,
  SettingDefinition,
  SettingScope,
  SettingsConflictError,
  SettingsControlPlaneProjection,
  SettingsOperationClient,
  SettingsOperationTransport,
  SettingValue,
  UnavailableSettingsTransport,
} from "./settings-client";
import { obsidianUserDeviceId } from "./settings-host";
import { ProductionControlPlaneTransport } from "./production-control-plane-host";
import {
  AgentControlPlaneClient,
  AgentControlPlaneTransport,
} from "./control-plane-client";
import {
  AgentControlPlaneModal,
  AgentProfileEditorModal,
  ProjectBindingEditorModal,
} from "./control-plane-ui";

const pexecFile = promisify(execFile);
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

function stdoutText(stdout: string | Buffer): string {
  return typeof stdout === "string" ? stdout : stdout.toString("utf8");
}

export default class LLMWikiPlugin extends Plugin {
  data!: LLMWikiPluginData;
  projection: SettingsControlPlaneProjection | null = null;
  settingsError: string | null = null;
  private settingsClient!: SettingsOperationClient;
  private agentControlPlaneClient!: AgentControlPlaneClient;
  private migrationError: string | null = null;
  // The original (unstripped) plugin data document, retained while a legacy
  // migration is pending so saves cannot destroy the migration source.
  private pendingMigrationSource: Record<string, unknown> | null = null;

  async onload(): Promise<void> {
    const rawData = await this.loadData();
    const plan = planPluginDataMigration(rawData);
    this.pendingMigrationSource =
      plan.assignments.length && rawData && typeof rawData === "object" && !Array.isArray(rawData)
        ? (rawData as Record<string, unknown>)
        : null;
    this.data = plan.data;
    let pluginDataChanged = plan.migrated;
    if (!this.data.deviceBinding) {
      this.data = { ...this.data, deviceBinding: { deviceId: obsidianUserDeviceId(process.env) } };
      pluginDataChanged = true;
    }
    plan.data = this.data;
    const deviceBinding = this.data.deviceBinding;
    if (!deviceBinding) throw new Error("LLM Wiki device binding could not be initialized");
    const transport = this.createControlPlaneTransport(deviceBinding);
    this.settingsClient = new SettingsOperationClient(transport);
    this.agentControlPlaneClient = new AgentControlPlaneClient(transport);
    await this.applyPluginDataPlan(plan, pluginDataChanged);
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

    this.addCommand({
      id: "open-agent-control-plane",
      name: "Open Agent control plane (LLM Wiki)",
      callback: () => this.openAgentControlPlane(),
    });

    this.addCommand({
      id: "rollback-legacy-migration",
      name: "Roll back legacy settings migration (LLM Wiki)",
      checkCallback: (checking: boolean) => {
        const marker = this.data.legacyMigration;
        const ok = marker?.state === "applied" && !!marker.preimageJournal;
        if (ok && !checking) void this.rollbackLegacyMigration();
        return ok;
      },
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

  /** Injection seam for the shared backend operation host. */
  setAgentControlPlaneTransport(transport: AgentControlPlaneTransport): void {
    this.agentControlPlaneClient = new AgentControlPlaneClient(transport);
  }

  openAgentControlPlane(): void {
    new AgentControlPlaneModal(this.app, {
      client: this.agentControlPlaneClient,
      defaultProjectId: this.data.deviceBinding?.workspaceProjectId,
    }).open();
  }

  openAgentProfileEditor(): void {
    new AgentProfileEditorModal(this.app, this.agentControlPlaneClient, async () => undefined).open();
  }

  openProjectBindingEditor(): void {
    new ProjectBindingEditorModal(
      this.app,
      this.agentControlPlaneClient,
      this.data.deviceBinding?.workspaceProjectId ?? "",
      "",
      async () => undefined,
    ).open();
  }

  private vaultBasePath(): string | null {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
  }

  /** Injection seam: lifecycle tests run the plugin against an in-process host. */
  protected createControlPlaneTransport(
    deviceBinding: DeviceBindingReference,
  ): SettingsOperationTransport & AgentControlPlaneTransport {
    const vaultPath = this.vaultBasePath();
    return (vaultPath
      ? new ProductionControlPlaneTransport({
          vaultPath,
          userDeviceId: deviceBinding.deviceId,
          workspaceProjectId: deviceBinding.workspaceProjectId,
          environment: process.env,
        })
      : new UnavailableSettingsTransport("LLM Wiki control plane requires a desktop filesystem vault; mobile and non-filesystem vaults are unavailable.")
    ) as SettingsOperationTransport & AgentControlPlaneTransport;
  }

  private migrationPreimagePath(): string {
    return `${this.manifest.dir ?? ".obsidian/plugins/obsidian-llm-wiki"}/legacy-migration-preimage.json`;
  }

  private async writeMigrationPreimage(preimage: LegacyMigrationPreimage[]): Promise<void> {
    await this.app.vault.adapter.write(
      this.migrationPreimagePath(),
      JSON.stringify({ version: 1, preimage }, null, 2),
    );
  }

  private async readMigrationPreimage(): Promise<LegacyMigrationPreimage[] | null> {
    try {
      const text = await this.app.vault.adapter.read(this.migrationPreimagePath());
      const parsed = JSON.parse(text) as { version?: unknown; preimage?: unknown };
      return parsed.version === 1 && Array.isArray(parsed.preimage)
        ? (parsed.preimage as LegacyMigrationPreimage[])
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Product recovery entry for the migration preimage: restores the exact
   * pre-migration assignments from the device-local backup written when the
   * migration was applied, then marks the journal rolled-back.
   */
  async rollbackLegacyMigration(): Promise<void> {
    try {
      const preimage = await this.readMigrationPreimage();
      if (!preimage) throw new Error("no migration preimage backup exists on this device");
      const result = await rollbackPluginDataMigration(this.settingsClient, this.data, preimage);
      this.data = result.data;
      await this.savePluginData();
      try {
        await this.app.vault.adapter.remove(this.migrationPreimagePath());
      } catch { /* a stale backup is harmless once the journal is rolled-back */ }
      await this.refreshSettings(false);
      new Notice("LLM Wiki: legacy settings migration rolled back.");
    } catch (error) {
      new Notice(`LLM Wiki: rollback failed — ${String((error as Error)?.message ?? error)}`);
    }
  }

  private effectiveValue<T extends SettingValue>(key: string): T {
    const effective = this.projection && effectiveSetting(this.projection.snapshot, key);
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

  private async applyPluginDataPlan(
    plan: ReturnType<typeof planPluginDataMigration>,
    pluginDataChanged: boolean,
  ): Promise<void> {
    if (plan.assignments.length) {
      try {
        const migrated = await applyPluginDataMigration(this.settingsClient, plan);
        try {
          // Persist the full preimage device-locally BEFORE adopting the
          // stripped document, so the applied journal always has a matching
          // restorable backup for rollbackLegacyMigration.
          await this.writeMigrationPreimage(migrated.preimage);
        } catch (preimageError) {
          new Notice(`LLM Wiki: migration applied, but the preimage backup could not be written — rollback is unavailable: ${String((preimageError as Error)?.message ?? preimageError)}`);
        }
        this.data = migrated.data;
        this.pendingMigrationSource = null;
        await this.savePluginData();
      } catch (error) {
        // Do not persist the stripped document until Settings Platform accepts
        // all assignments. pendingMigrationSource stays set, so any save (scope
        // change, presentation toggle) keeps the legacy source intact on disk
        // for a retry after restart.
        this.migrationError = `Legacy settings migration pending: ${String((error as Error)?.message ?? error)}`;
        this.settingsError = this.migrationError;
      }
    } else if (pluginDataChanged) {
      await this.savePluginData();
    }
  }

  async savePluginData(): Promise<void> {
    await this.saveData(preservePendingMigrationSource(this.pendingMigrationSource, this.data));
  }

  async setEditingScope(scope: SettingScope): Promise<void> {
    this.data = selectEditingScope(this.data, scope);
    await this.savePluginData();
  }

  async refreshSettings(notify: boolean): Promise<void> {
    try {
      this.projection = await refreshSettingsProjection(this.settingsClient);
      this.settingsError = this.migrationError;
      if (notify) new Notice("LLM Wiki: settings refreshed.");
    } catch (error) {
      this.projection = null;
      const refreshError = String((error as Error)?.message ?? error);
      this.settingsError = this.migrationError ? `${this.migrationError} Settings refresh failed: ${refreshError}` : refreshError;
      if (notify) new Notice(`LLM Wiki: settings unavailable — ${this.settingsError}`);
    }
  }

  async updateSetting(scope: SettingScope, key: string, value: SettingValue | SecretReference): Promise<void> {
    const revision = this.projection?.snapshot.sourceRevisions[scope]?.revision;
    const expectedRevision = typeof revision === "number" ? revision : 0;
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
    const revision = this.projection?.snapshot.sourceRevisions[scope]?.revision;
    const expectedRevision = typeof revision === "number" ? revision : 0;
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
  models: "Agent model",
  runtime: "Runtime",
  vault: "Vault",
  query: "Query and index",
  diagnostics: "Diagnostics",
  providers: "Providers and connectors",
};

const SCOPE_LABELS: Record<SettingScope | "product", string> = {
  "user-device": "This device",
  vault: "This vault",
  "workspace-project": "Workspace / project",
  session: "Current session",
  product: "Product default",
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
    this.renderAgentControlPlane(containerEl);
    if (!this.llmWiki.projection) return;
    this.renderScopeSelector(containerEl);

    const scope = this.llmWiki.data.presentation.selectedScope;
    for (const category of [...new Set(this.llmWiki.projection.definitions.map(item => item.category))]) {
      const definitions = this.llmWiki.projection.definitions.filter(definition =>
        definition.category === category
        && definition.allowedScopes.includes(scope)
        && (this.llmWiki.data.presentation.showAdvanced || definition.visibility !== "advanced"),
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

  private renderAgentControlPlane(containerEl: HTMLElement): void {
    containerEl.createEl("h2", { text: "Agent control plane" });
    containerEl.createEl("p", {
      cls: "llmwiki-settings-intro",
      text: "Inspect backend-owned Rooms, Threads, Dream Time proposals, collaboration, connector health, and Usage. Profile and Binding changes use the same operation interface as MCP and CLI.",
    });
    const actions = containerEl.createDiv({ cls: "llmwiki-settings-actions llmwiki-agent-control-actions" });
    actions.createEl("button", { text: "Open control plane", cls: "mod-cta" }).onclick = () => this.llmWiki.openAgentControlPlane();
    actions.createEl("button", { text: "Create Agent Profile" }).onclick = () => this.llmWiki.openAgentProfileEditor();
    actions.createEl("button", { text: "Create Project Binding" }).onclick = () => this.llmWiki.openProjectBindingEditor();
    containerEl.createEl("p", {
      cls: "llmwiki-settings-intro",
      text: "Provider credentials stay in the Secret Reference selectors below. Agent Profiles and Project Bindings never contain plaintext credentials, usable grants, or device-local execution material.",
    });
  }

  private renderHealth(containerEl: HTMLElement, check: HealthCheck): void {
    const item = containerEl.createDiv({ cls: `llmwiki-health llmwiki-health-${check.state}` });
    item.createEl("span", { cls: "llmwiki-health-dot" });
    const copy = item.createDiv();
    copy.createEl("strong", { text: check.capabilityId });
    const remediation = check.remediations[0]?.summary;
    copy.createEl("small", { text: remediation ? `${check.summary} ${remediation}` : check.summary });
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
      ...(definition.valueType === "secret-reference"
        ? ["Reference locator only; never paste or store the secret value here."]
        : []),
      `Effective: ${this.displayValue(definition, effective)}`,
      `source: ${SCOPE_LABELS[effective.winningScope]}`,
      `apply: ${definition.applyMode}`,
      ...validation.map(issue => `${issue.severity}: ${issue.message}`),
    ].join(" · ");
    const setting = new Setting(containerEl).setName(definition.name).setDesc(description);
    const assignedHere = row.assignedValue !== undefined;

    if (definition.valueType === "boolean") {
      setting.addDropdown(dropdown => dropdown
        .addOption("inherit", "Inherit")
        .addOption("true", "Enabled")
        .addOption("false", "Disabled")
        .setValue(assignedHere ? String(row.assignedValue) : "inherit")
        .onChange(async value => this.mutate(() => value === "inherit"
          ? this.llmWiki.unsetSetting(scope, definition.key)
          : this.llmWiki.updateSetting(scope, definition.key, value === "true"))));
    } else if (definition.valueType === "secret-reference") {
      const existing = this.secretReference(row.assignedValue);
      let provider: SecretReference["provider"] = existing?.provider ?? "environment";
      setting.addDropdown(dropdown => dropdown
        .addOption("environment", "Environment")
        .addOption("os-keychain", "OS keychain")
        .addOption("external-vault", "External vault")
        .setValue(provider)
        .onChange(value => { provider = value as SecretReference["provider"]; }));
      setting.addText(text => {
        text.setPlaceholder(existing
          ? "Configured — enter a new reference locator to replace"
          : "Reference locator — never paste the secret value");
        text.inputEl.type = "text";
        text.inputEl.autocomplete = "off";
        text.inputEl.addEventListener("change", () => void this.mutate(async () => {
          const locator = text.getValue().trim();
          if (!locator) return;
          await this.llmWiki.updateSetting(scope, definition.key, { provider, locator });
          text.setValue("");
        }));
      });
    } else if (definition.valueType === "enum" && definition.validator.enum?.length) {
      setting.addDropdown(dropdown => {
        dropdown.addOption("", "Inherit");
        for (const value of definition.validator.enum ?? []) dropdown.addOption(value, value);
        dropdown.setValue(assignedHere ? String(row.assignedValue) : "");
        dropdown.onChange(value => this.mutate(() => value
          ? this.llmWiki.updateSetting(scope, definition.key, value)
          : this.llmWiki.unsetSetting(scope, definition.key)));
      });
    } else {
      setting.addText(text => {
        const assignedValue = row.assignedValue;
        text.setPlaceholder(definition.placeholder ?? "").setValue(
          assignedHere && (typeof assignedValue === "string" || typeof assignedValue === "number")
            ? String(assignedValue)
            : "",
        );
        text.inputEl.addEventListener("change", () => void this.mutate(async () => {
          const value = text.getValue();
          if (!value.trim() && !definition.validator.required) await this.llmWiki.unsetSetting(scope, definition.key);
          else await this.llmWiki.updateSetting(scope, definition.key, parseSettingInput(definition.valueType, value));
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
    if (definition.valueType === "secret-reference") return redactedSecretLabel(effective.value);
    return JSON.stringify(effective.value);
  }

  private secretReference(value: unknown): SecretReference | undefined {
    if (isSecretReference(value)) return value;
    if (value && typeof value === "object" && !Array.isArray(value) && "secretRef" in value) {
      const secretRef = (value as { secretRef?: unknown }).secretRef;
      return isSecretReference(secretRef) ? secretRef : undefined;
    }
    return undefined;
  }
}
