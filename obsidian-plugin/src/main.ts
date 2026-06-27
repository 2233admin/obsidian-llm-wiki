/*
 * Task 10C-C -- vault-mind Promote: an Obsidian plugin that promotes a draft
 * candidate through the work-OS base-head lock, from a command or the file menu.
 *
 * Approach C (per TASK10C-DRAFT): the gesture lives on STABLE Obsidian APIs
 * (addCommand + the `file-menu` event), NOT the unstable Canvas node API. It
 * shells out to `kb_meta promote` (Node child_process; desktop-only): a dry-run
 * first shows the materialized snapshot PLAN in a modal, and only on confirm does
 * it `--apply` (which appends the reviewed snapshot). It never auto-commits --
 * the real promote stays the git review gate (the user commits the new snapshot).
 */

import {
  App, Plugin, PluginSettingTab, Setting, Modal, Notice,
  TFile, TAbstractFile, Menu, FileSystemAdapter,
} from "obsidian";
import { exec } from "child_process";
import { promisify } from "util";

const pexec = promisify(exec);

interface VaultMindPromoteSettings {
  pythonPath: string;
  kbMetaPath: string;
}

const DEFAULT_SETTINGS: VaultMindPromoteSettings = {
  pythonPath: "python",
  kbMetaPath: "",
};

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

export default class VaultMindPromotePlugin extends Plugin {
  settings!: VaultMindPromoteSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Command palette entry -- enabled only for the active markdown note.
    this.addCommand({
      id: "promote-candidate",
      name: "Promote candidate (vault-mind)",
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
              .setTitle("Promote candidate (vault-mind)")
              .setIcon("check-circle")
              .onClick(() => void this.promote(file)),
          );
        }
      }),
    );

    this.addSettingTab(new VaultMindPromoteSettingTab(this.app, this));
  }

  onunload(): void {}

  private vaultBasePath(): string | null {
    const adapter = this.app.vault.adapter;
    return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
  }

  // Run `kb_meta promote --note <id> [--apply]` from the vault root, parse JSON.
  private async runPromote(noteId: string, apply: boolean): Promise<PromoteResult> {
    if (!this.settings.kbMetaPath) {
      return { outcome: "ERROR", error: "Set the kb_meta.py path in plugin settings." };
    }
    const cwd = this.vaultBasePath();
    if (!cwd) {
      return { outcome: "ERROR", error: "Vault is not on the local filesystem (desktop only)." };
    }
    const q = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
    const parts = [q(this.settings.pythonPath), q(this.settings.kbMetaPath),
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
    new Notice("vault-mind: computing promote plan…");
    const dry = await this.runPromote(noteId, false);
    if (dry.error) { new Notice(`vault-mind: ${dry.error}`); return; }
    if (dry.outcome !== "MATERIALIZED") {
      new Notice(`vault-mind: cannot promote — ${dry.outcome}${dry.reason ? `: ${dry.reason}` : ""}`);
      return;
    }
    new PromotePlanModal(this.app, noteId, dry, async () => {
      const res = await this.runPromote(noteId, true);
      if (res.error || res.outcome !== "MATERIALIZED") {
        new Notice(`vault-mind: promote failed — ${res.error ?? res.outcome}`);
        return;
      }
      new Notice(`vault-mind: promoted → ${res.snapshot_note_id ?? "(written)"}. Review & commit via git.`);
    }).open();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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

class VaultMindPromoteSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: VaultMindPromotePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Python path")
      .setDesc("Interpreter that runs kb_meta.py (e.g. python, python3, or an absolute path).")
      .addText((t) => t
        .setValue(this.plugin.settings.pythonPath)
        .onChange(async (v) => {
          this.plugin.settings.pythonPath = v.trim() || "python";
          await this.plugin.saveSettings();
        }));
    new Setting(containerEl)
      .setName("kb_meta.py path")
      .setDesc("Absolute path to vault-mind's compiler/kb_meta.py.")
      .addText((t) => t
        .setValue(this.plugin.settings.kbMetaPath)
        .onChange(async (v) => {
          this.plugin.settings.kbMetaPath = v.trim();
          await this.plugin.saveSettings();
        }));
  }
}
