import { App, Modal } from "obsidian";
import {
  CompilePublishRunResult,
  lastPublishLabel,
  lastRunTimestampLabel,
  summarizeOutcome,
  todaysCostLabel,
} from "./compile-publish";

/** Independent modal, laid out like AgentControlPlaneModal's section/card/fact
 * dashboard (src/control-plane-ui.ts) but NOT grafted into that modal: this
 * one is a local, ephemeral, execFile-triggered side effect (Pattern A),
 * while AgentControlPlaneModal renders backend-owned dispatcher projections
 * (Pattern B). Different data source, different modal. */
export interface CompilePublishModalHost {
  /** Non-null when the feature cannot run on this device (mobile, non-
   * filesystem vault) -- mirrors askMateRuntimeUnavailableReason's shape. */
  unavailableReason(): string | null;
  isBusy(): boolean;
  /** Most recent known result: either this session's own trigger, or (if
   * none yet) a best-effort read of the on-disk status file the Python side
   * maintains -- see `source` on CompilePublishRunResult. */
  lastResult(): CompilePublishRunResult | null;
  triggerRun(mode: "run" | "dry-run"): Promise<void>;
  /** Best-effort background load of the on-disk status file. Host decides
   * whether to skip it (e.g. a live session result already exists). Never
   * throws; resolves once lastResult() may have changed. */
  loadStatusFromDisk(): Promise<void>;
}

export class CompilePublishStatusModal extends Modal {
  constructor(app: App, private readonly host: CompilePublishModalHost) {
    super(app);
  }

  onOpen(): void {
    this.render();
    void this.host.loadStatusFromDisk().then(() => this.render());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Compile & publish" });

    const unavailable = this.host.unavailableReason();
    if (unavailable) {
      contentEl.createEl("p", { cls: "llmwiki-compile-publish-error", text: unavailable });
      return;
    }

    const busy = this.host.isBusy();
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const runButton = buttons.createEl("button", { text: "Compile & publish now", cls: "mod-cta" });
    runButton.disabled = busy;
    runButton.onclick = () => void this.runAndRerender("run");
    const dryButton = buttons.createEl("button", { text: "Dry run (no push)" });
    dryButton.disabled = busy;
    dryButton.onclick = () => void this.runAndRerender("dry-run");
    if (busy) contentEl.createEl("p", { text: "Running…" });

    const section = this.section(
      contentEl,
      "Status",
      "Reflects this Obsidian session's most recent manual trigger only. "
        + "Scheduled (schtasks) runs are not visible here unless also triggered from this panel — "
        + "scheduling stays owned by schtasks, not the plugin.",
    );
    const result = this.host.lastResult();
    const card = this.card(section, result ? `Last run · ${summarizeOutcome(result)}` : "No known run yet");
    this.fact(card, "Source", result
      ? (result.source === "status-file" ? "Last known status on disk (may predate this session)" : "This session")
      : "—");
    this.fact(card, "Last run time", lastRunTimestampLabel(result));
    this.fact(card, "Mode", result ? (result.dryRun ? "Dry run (no push)" : "Run") : "—");
    this.fact(card, "Today's compile cost", todaysCostLabel(result));
    const publish = lastPublishLabel(result);
    this.fact(card, "Last publish time", publish.at);
    this.fact(card, "Last publish commit", publish.commit);

    if (result) {
      const raw = this.card(card, "Raw report (ground truth while the JSON schema settles)");
      raw.createEl("pre", {
        text: result.report
          ? JSON.stringify(result.report, null, 2)
          : (result.invocationError ?? result.rawStdout ?? "(no output captured)"),
      });
    }
  }

  private async runAndRerender(mode: "run" | "dry-run"): Promise<void> {
    await this.host.triggerRun(mode);
    this.render();
  }

  private section(container: HTMLElement, title: string, description: string): HTMLElement {
    const section = container.createEl("section", { cls: "llmwiki-control-section" });
    section.createEl("h3", { text: title });
    section.createEl("p", { text: description });
    return section;
  }

  private card(container: HTMLElement, title: string): HTMLElement {
    const card = container.createDiv({ cls: "llmwiki-control-card" });
    card.createEl("h4", { text: title });
    return card;
  }

  private fact(container: HTMLElement, name: string, value: string): void {
    const row = container.createDiv({ cls: "llmwiki-control-fact" });
    row.createEl("strong", { text: name });
    row.createEl("span", { text: value });
  }
}
