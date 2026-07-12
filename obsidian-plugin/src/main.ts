/*
 * LLM Wiki's Obsidian-native control surface. System settings use a versioned,
 * scoped contract; capability checks are read-only. The original governed
 * Promote gesture remains a thin client over kb_meta and retains its dry-run,
 * base-head lock, and explicit-confirmation boundaries.
 */

import {
  App, Plugin, PluginSettingTab, Setting, Modal, Notice,
  TFile, TAbstractFile, Menu, FileSystemAdapter,
} from "obsidian";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import { access } from "fs/promises";
import { dirname, resolve } from "path";
import {
  EffectiveSetting,
  getEffectiveValue,
  LLMWikiSettingsData,
  migrateSettings,
  resolveSettings,
  SETTING_DEFINITIONS,
  SettingDefinition,
  SettingScope,
  setAssignment,
  validateSettings,
} from "./settings";

const pexec = promisify(exec);
const pexecFile = promisify(execFile);

type HealthState = "available" | "degraded" | "unavailable" | "disabled";

interface HealthCheck {
  capability: string;
  state: HealthState;
  summary: string;
}

// Shape of `kb_meta promote` JSON (compiler/kb_meta.cmd_promote).
interface PromoteResult {
  outcome: string;            // MATERIALIZED | HEAD_MISMATCH | NOT_DRAFT | ERROR
  entity?: string;
  head_note_id?: string | null;
  snapshot_note_id?: string | null;
  reason?: string;
  plan?: string;              // dry-run: the materialized snapshot text
  written?: string;           // apply: the written snapshot path
  error?: string;
}

export default class LLMWikiPlugin extends Plugin {
  settings!: LLMWikiSettingsData;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Command palette entry -- enabled only for the active markdown note.
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

    // Right-click on any markdown note -> promote.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) =>
            item
              .setTitle("Promote candidate (LLM Wiki)")
              .setIcon("check-circle")
              .onClick(() => void this.promote(file)),
          );
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

  // Run `kb_meta promote --note <id> [--apply]` from the vault root, parse JSON.
  private async runPromote(noteId: string, apply: boolean): Promise<PromoteResult> {
    const pythonPath = getEffectiveValue<string>(this.settings, "runtime.python.path");
    const kbMetaPath = getEffectiveValue<string>(this.settings, "runtime.kb_meta.path");
    if (!kbMetaPath) {
      return { outcome: "ERROR", error: "Set the LLM Wiki runtime entry in plugin settings." };
    }
    const cwd = this.vaultBasePath();
    if (!cwd) {
      return { outcome: "ERROR", error: "Vault is not on the local filesystem (desktop only)." };
    }
    const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
    const parts = [q(pythonPath), q(kbMetaPath),
      "promote", "--note", q(noteId)];
    if (apply) parts.push("--apply");
    try {
      const { stdout } = await pexec(parts.join(" "), {
        cwd, env: { ...process.env, PYTHONUTF8: "1" },
      });
      return JSON.parse(stdout) as PromoteResult;
    } catch (e) {
      // kb_meta prints {"error": ...} and exits 1 on failure -- recover its stdout.
      const out = (e as { stdout?: string })?.stdout;
      if (typeof out === "string") {
        try { return JSON.parse(out) as PromoteResult; } catch { /* fall through */ }
      }
      return { outcome: "ERROR", error: String((e as Error)?.message ?? e) };
    }
  }

  private async promote(file: TFile): Promise<void> {
    const noteId = file.path; // vault-relative POSIX path == note_id
    new Notice("LLM Wiki: computing promote plan…");
    const dry = await this.runPromote(noteId, false);
    if (dry.error) { new Notice(`LLM Wiki: ${dry.error}`); return; }
    if (dry.outcome !== "MATERIALIZED") {
      new Notice(`LLM Wiki: cannot promote — ${dry.outcome}${dry.reason ? `: ${dry.reason}` : ""}`);
      return;
    }
    new PromotePlanModal(this.app, noteId, dry, async () => {
      const res = await this.runPromote(noteId, true);
      if (res.error || res.outcome !== "MATERIALIZED") {
        new Notice(`LLM Wiki: promote failed — ${res.error ?? res.outcome}`);
        return;
      }
      new Notice(`LLM Wiki: promoted → ${res.snapshot_note_id ?? "(written)"}. Review & commit via git.`);
    }).open();
  }

  async loadSettings(): Promise<void> {
    const { data, migrated } = migrateSettings(await this.loadData());
    this.settings = data;
    if (migrated) await this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async updateSetting(scope: SettingScope, key: string, value: string | boolean): Promise<void> {
    this.settings = setAssignment(this.settings, scope, key, value);
    await this.saveSettings();
  }

  async unsetSetting(scope: SettingScope, key: string): Promise<void> {
    this.settings = setAssignment(this.settings, scope, key, undefined);
    await this.saveSettings();
  }

  async runSettingsDoctor(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    const validation = validateSettings(this.settings);
    const pythonPath = getEffectiveValue<string>(this.settings, "runtime.python.path");
    const kbMetaPath = getEffectiveValue<string>(this.settings, "runtime.kb_meta.path");
    const semanticQuery = getEffectiveValue<boolean>(this.settings, "query.semantic.enabled");
    const obcSemantic = getEffectiveValue<boolean>(this.settings, "diagnostics.obc.semantic.enabled");
    const webSearchEnabled = getEffectiveValue<boolean>(this.settings, "providers.web_search.enabled");
    const secretRef = getEffectiveValue<string>(this.settings, "providers.web_search.secret_ref");

    try {
      await pexecFile(pythonPath, ["--version"], { env: { ...process.env, PYTHONUTF8: "1" } });
      checks.push({ capability: "Python runtime", state: "available", summary: pythonPath });
    } catch {
      checks.push({ capability: "Python runtime", state: "unavailable", summary: `Cannot execute ${pythonPath}` });
    }

    if (!kbMetaPath) {
      checks.push({ capability: "LLM Wiki runtime", state: "unavailable", summary: "Runtime entry is not configured." });
    } else {
      try {
        await access(kbMetaPath);
        checks.push({ capability: "LLM Wiki runtime", state: "available", summary: kbMetaPath });
      } catch {
        checks.push({ capability: "LLM Wiki runtime", state: "unavailable", summary: `File not found: ${kbMetaPath}` });
      }
    }

    checks.push({
      capability: "Semantic query",
      state: semanticQuery ? "available" : "disabled",
      summary: semanticQuery ? "Enabled for the current effective scope." : "Disabled by effective settings.",
    });

    if (!obcSemantic) {
      checks.push({ capability: "OBC", state: "available", summary: "Deterministic diagnostics enabled; semantic suggestions disabled." });
    } else if (!kbMetaPath) {
      checks.push({ capability: "OBC", state: "degraded", summary: "Semantic suggestions enabled, but runtime entry is unavailable." });
    } else {
      try {
        await access(resolve(dirname(dirname(kbMetaPath)), "obc"));
        await pexecFile(pythonPath, ["-c", "import sklearn"], { env: { ...process.env, PYTHONUTF8: "1" } });
        checks.push({ capability: "OBC", state: "available", summary: "Deterministic diagnostics and semantic suggestions are available." });
      } catch {
        checks.push({ capability: "OBC", state: "degraded", summary: "Deterministic diagnostics remain available; semantic runtime dependencies are incomplete." });
      }
    }

    const envName = secretRef.startsWith("env:") ? secretRef.slice(4) : "";
    checks.push({
      capability: "Web search provider",
      state: !webSearchEnabled ? "disabled" : envName && process.env[envName] ? "available" : "unavailable",
      summary: !webSearchEnabled
        ? "Disabled by effective settings."
        : envName && process.env[envName]
        ? `${secretRef} resolves without exposing its value.`
        : `${secretRef || "Secret reference"} does not resolve in the Obsidian process.`,
    });

    const errors = validation.filter(issue => issue.severity === "error");
    const warnings = validation.filter(issue => issue.severity === "warning");
    if (errors.length) {
      checks.unshift({ capability: "Settings contract", state: "unavailable", summary: errors.map(issue => issue.message).join(" ") });
    } else if (warnings.length) {
      checks.unshift({ capability: "Settings contract", state: "degraded", summary: warnings.map(issue => issue.message).join(" ") });
    } else {
      checks.unshift({ capability: "Settings contract", state: "available", summary: `Schema v${this.settings.schemaVersion}, revision ${this.settings.revision}.` });
    }
    return checks;
  }
}

// Shows the dry-run promote plan; promotes only on explicit confirm (dry-run
// default -- §0 #3, the user sees the snapshot before anything is written).
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
    contentEl.createEl("p", {
      text: `${this.noteId}  →  ${this.result.snapshot_note_id ?? "reviewed snapshot"}`,
    });
    if (this.result.head_note_id) {
      contentEl.createEl("p", { text: `Supersedes current head: ${this.result.head_note_id}` });
    }
    const pre = contentEl.createEl("pre", { cls: "vault-mind-promote-plan" });
    pre.setText(this.result.plan ?? "(no plan)");

    const btns = contentEl.createDiv({ cls: "modal-button-container" });
    const confirm = btns.createEl("button", {
      text: "Promote (writes reviewed snapshot)", cls: "mod-cta",
    });
    confirm.onclick = async () => { this.close(); await this.onConfirm(); };
    btns.createEl("button", { text: "Cancel" }).onclick = () => this.close();
  }

  onClose(): void { this.contentEl.empty(); }
}

const CATEGORY_LABELS: Record<SettingDefinition["category"], string> = {
  runtime: "Runtime",
  vault: "Vault",
  query: "Query and index",
  diagnostics: "Diagnostics",
  providers: "Providers and connectors",
};

const SCOPE_LABELS: Record<SettingScope, string> = {
  "user-device": "This device",
  vault: "This vault",
  "workspace-project": "Workspace / project",
  session: "Current session",
};

class LLMWikiSettingTab extends PluginSettingTab {
  private health: HealthCheck[] | null = null;

  constructor(app: App, private readonly plugin: LLMWikiPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("llmwiki-settings");
    containerEl.createEl("h1", { text: "LLM Wiki" });
    containerEl.createEl("p", {
      cls: "llmwiki-settings-intro",
      text: "Configure the LLM Wiki system from inside Obsidian. Values are resolved by scope; diagnostics and capability operations remain separate from settings.",
    });

    this.renderOverview(containerEl);
    this.renderScopeSelector(containerEl);

    const effective = resolveSettings(this.plugin.settings);
    const selectedScope = this.plugin.settings.presentation.selectedScope;
    for (const category of Object.keys(CATEGORY_LABELS) as SettingDefinition["category"][]) {
      const definitions = SETTING_DEFINITIONS.filter(definition =>
        definition.category === category
        && definition.allowedScopes.includes(selectedScope)
        && (this.plugin.settings.presentation.showAdvanced || !definition.advanced),
      );
      if (!definitions.length) continue;
      containerEl.createEl("h2", { text: CATEGORY_LABELS[category] });
      for (const definition of definitions) {
        this.renderDefinition(containerEl, definition, effective.get(definition.key)!);
      }
    }

    new Setting(containerEl)
      .setName("Show advanced settings")
      .setDesc("Reveal provider bindings and other settings intended for operators.")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.presentation.showAdvanced)
        .onChange(async value => {
          this.plugin.settings.presentation.showAdvanced = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    containerEl.createEl("h2", { text: "Knowledge operations" });
    new Setting(containerEl)
      .setName("Promote reviewed knowledge")
      .setDesc("Use “Promote candidate (LLM Wiki)” from the command palette or file menu. It remains governed by dry-run, base-head lock, and explicit confirmation; it is an operation, not a setting.");
  }

  private renderOverview(containerEl: HTMLElement): void {
    const overview = containerEl.createDiv({ cls: "llmwiki-settings-overview" });
    const heading = overview.createDiv({ cls: "llmwiki-settings-overview-heading" });
    heading.createEl("strong", { text: "System status" });
    heading.createEl("span", { text: `Schema v${this.plugin.settings.schemaVersion} · revision ${this.plugin.settings.revision}` });

    if (this.health) {
      const list = overview.createDiv({ cls: "llmwiki-health-list" });
      for (const check of this.health) {
        const item = list.createDiv({ cls: `llmwiki-health llmwiki-health-${check.state}` });
        item.createEl("span", { cls: "llmwiki-health-dot" });
        const copy = item.createDiv();
        copy.createEl("strong", { text: check.capability });
        copy.createEl("small", { text: check.summary });
      }
    } else {
      overview.createEl("p", { text: "Run Doctor to verify runtime paths, effective settings, OBC, and provider references." });
    }

    const actions = overview.createDiv({ cls: "llmwiki-settings-actions" });
    const doctor = actions.createEl("button", { text: "Run Doctor", cls: "mod-cta" });
    doctor.onclick = async () => {
      doctor.disabled = true;
      doctor.setText("Checking…");
      this.health = await this.plugin.runSettingsDoctor();
      this.display();
    };
  }

  private renderScopeSelector(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Editing scope")
      .setDesc("More specific scopes override less specific ones. Empty values inherit from the next scope.")
      .addDropdown(dropdown => {
        dropdown
          .addOption("user-device", SCOPE_LABELS["user-device"])
          .addOption("vault", SCOPE_LABELS.vault)
          .setValue(this.plugin.settings.presentation.selectedScope)
          .onChange(async value => {
            this.plugin.settings.presentation.selectedScope = value as SettingScope;
            await this.plugin.saveSettings();
            this.display();
          });
      });
  }

  private renderDefinition(containerEl: HTMLElement, definition: SettingDefinition, effective: EffectiveSetting): void {
    const scope = this.plugin.settings.presentation.selectedScope;
    const assigned = this.plugin.settings.assignments[scope][definition.key];
    const description = `${definition.description} Effective: ${this.displayValue(effective)} · source: ${SCOPE_LABELS[effective.winningScope as SettingScope] ?? "Product default"} · apply: ${definition.applyMode}.`;
    const setting = new Setting(containerEl).setName(definition.name).setDesc(description);

    if (definition.valueType === "boolean") {
      setting.addToggle(toggle => toggle
        .setValue(typeof assigned === "boolean" ? assigned : Boolean(effective.value))
        .onChange(async value => {
          await this.plugin.updateSetting(scope, definition.key, value);
          this.health = null;
          this.display();
        }));
    } else {
      setting.addText(text => {
        text
          .setPlaceholder(definition.placeholder ?? "")
          .setValue(typeof assigned === "string" ? assigned : "");
        text.inputEl.addEventListener("change", async () => {
          const value = text.getValue();
          if (!value.trim() && !definition.required) await this.plugin.unsetSetting(scope, definition.key);
          else await this.plugin.updateSetting(scope, definition.key, value);
          this.health = null;
          this.display();
        });
        if (definition.valueType === "secret-reference") text.inputEl.type = "text";
      });
    }

    if (assigned !== undefined) {
      setting.addExtraButton(button => button
        .setIcon("reset")
        .setTooltip("Remove this assignment and inherit the next effective value")
        .onClick(async () => {
          await this.plugin.unsetSetting(scope, definition.key);
          this.health = null;
          this.display();
        }));
    }
  }

  private displayValue(effective: EffectiveSetting): string {
    if (effective.definition.valueType === "secret-reference") {
      return effective.value ? String(effective.value) : "not configured";
    }
    return JSON.stringify(effective.value);
  }
}
