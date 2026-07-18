import { ItemView, Notice, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import type { Sha256Digest } from "../../../packages/visual-workspace/dist/src/index.js";
import { AskMateOperationClient, type AskMateMapReadResult } from "./client";
import { AskMateOutlineModel } from "./outline-model";

export const ASK_MATE_VIEW_TYPE = "llmwiki-ask-mate";

export interface AskMateContext {
  projectId: `project/${string}`;
  path: string;
}

export interface AskMateActors {
  /** The identity recorded as the proposer in plan provenance. */
  proposalActor: string;
  /** The authenticated human-host identity used for the confirmed apply. */
  confirmationActor: string;
}

function transitionToken(planFingerprint: Sha256Digest): string {
  const entropy = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `ask-mate:${planFingerprint.slice("sha256:".length, "sha256:".length + 16)}:${entropy}`;
}

export class AskMateView extends ItemView {
  readonly model = new AskMateOutlineModel();
  #context: AskMateContext | null = null;
  #read: AskMateMapReadResult | null = null;
  #busy = false;
  #error: string | null = null;
  #confirmedFingerprint: Sha256Digest | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly client: AskMateOperationClient,
    private readonly actors: AskMateActors,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return ASK_MATE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Ask Mate";
  }

  getIcon(): string {
    return "git-fork";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  getState(): Record<string, unknown> {
    return this.#context
      ? { projectId: this.#context.projectId, path: this.#context.path }
      : {};
  }

  async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    this.model.dispose();
    this.#read = null;
    this.#confirmedFingerprint = null;
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      this.#context = null;
      this.render();
      return;
    }
    const candidate = state as Record<string, unknown>;
    if (
      typeof candidate.projectId === "string"
      && /^project\/[a-z0-9][a-z0-9-]*$/.test(candidate.projectId)
      && typeof candidate.path === "string"
    ) {
      await this.openContext({
        projectId: candidate.projectId as `project/${string}`,
        path: candidate.path,
      });
      return;
    }
    this.#context = null;
    this.render();
  }

  async onClose(): Promise<void> {
    this.model.dispose();
    this.#context = null;
    this.#read = null;
    this.#confirmedFingerprint = null;
  }

  async openContext(context: AskMateContext): Promise<void> {
    this.#context = context;
    this.#busy = true;
    this.#error = null;
    this.#confirmedFingerprint = null;
    this.render();
    try {
      const read = await this.client.readMap(context.projectId, context.path);
      this.#read = read;
      this.model.load(read.document);
      // Graphify is important context but remains optional. It loads after the
      // editable outline so a missing CLI or stale cache cannot block manual
      // editing, preview, or apply.
      void this.refreshGraphEvidence(context, read.documentFingerprint);
    } catch (error) {
      this.#read = null;
      this.model.dispose();
      this.#error = safeError(error);
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  async previewChanges(): Promise<void> {
    const context = this.requireContext();
    this.#busy = true;
    this.#error = null;
    this.#confirmedFingerprint = null;
    this.render();
    try {
      const result = await this.client.planMap({
        project: context.projectId,
        path: context.path,
        nextDocument: this.model.document,
        actor: this.actors.proposalActor,
        origin: "user",
      });
      this.model.acceptPlan(result.plan);
    } catch (error) {
      this.model.clearPlan();
      this.#error = safeError(error);
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  setApplyConfirmed(confirmed: boolean): void {
    const plan = this.model.plan;
    this.#confirmedFingerprint = confirmed && plan ? plan.fingerprint : null;
    this.render();
  }

  async applyConfirmedPlan(): Promise<void> {
    const context = this.requireContext();
    const plan = this.model.plan;
    if (!plan || this.#confirmedFingerprint !== plan.fingerprint) {
      throw new Error("Confirm the exact current plan before applying");
    }
    this.#busy = true;
    this.#error = null;
    this.render();
    try {
      await this.client.applyMap({
        project: context.projectId,
        plan,
        presentedFingerprint: plan.fingerprint,
        actor: this.actors.confirmationActor,
        transitionToken: transitionToken(plan.fingerprint),
      });
      // Re-read through the Operation boundary so the view reflects the
      // backend-authoritative bytes and revision after apply.
      await this.openContext(context);
      new Notice("LLM Wiki: Ask Mate map changes applied.");
    } catch (error) {
      this.#error = safeError(error);
      this.#busy = false;
      this.render();
      throw error;
    }
  }

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("llmwiki-ask-mate");
    container.createEl("h2", { text: "Ask Mate" });
    if (!this.#context) {
      container.createEl("p", {
        cls: "llmwiki-ask-mate-empty",
        text: "Open Ask Mate from an active Markdown note. The first slice edits managed maps under the current Project maps folder.",
      });
      return;
    }
    container.createEl("p", {
      cls: "llmwiki-ask-mate-context",
      text: `Reads: ${this.#context.path} · ${this.#context.projectId}`,
    });
    if (this.#busy) container.createEl("p", { text: "Working…" });
    if (this.#error) container.createEl("p", { cls: "llmwiki-control-plane-error", text: this.#error });
    if (!this.model.hasDocument) return;

    const outline = container.createEl("section", { cls: "llmwiki-ask-mate-panel" });
    outline.createEl("h3", { text: "Structured outline" });
    outline.createEl("p", { text: "Keyboard-editable hierarchy. Rename, add, remove, or move nodes; no file changes occur here." });
    this.renderNodeEditor(outline, this.model.document.rootId, 0);

    const evidence = container.createEl("section", { cls: "llmwiki-ask-mate-panel" });
    evidence.createEl("h3", { text: "Optional Graphify evidence" });
    evidence.createEl("p", {
      text: "Relationship evidence is opt-in review context. Selecting it does not change the hierarchy or enter the current plan.",
    });
    if (!this.model.suggestions.length) {
      evidence.createEl("p", { text: "No relevant Graphify evidence is available. Outline editing remains fully available." });
    }
    for (const suggestion of this.model.suggestions) {
      const row = evidence.createEl("label", { cls: "llmwiki-ask-mate-evidence" });
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = this.model.snapshot.selectedSuggestionIds.includes(suggestion.id);
      checkbox.onchange = () => {
        this.model.selectSuggestion(suggestion.id, checkbox.checked);
        this.#confirmedFingerprint = null;
        this.render();
      };
      const source = suggestion.evidenceRefs.length ? ` · source ${suggestion.evidenceRefs.join(", ")}` : "";
      row.createSpan({
        text: `${suggestion.from} —${suggestion.relation}→ ${suggestion.to} · ${suggestion.confidence} · ${suggestion.adapter}${source}`,
      });
    }

    const preview = container.createEl("section", { cls: "llmwiki-ask-mate-panel" });
    preview.createEl("h3", { text: "Deterministic textual preview" });
    preview.createEl("pre", { text: this.model.snapshot.textualPreview });
    const previewButton = preview.createEl("button", { text: "Preview changes", cls: "mod-cta" });
    previewButton.disabled = this.#busy;
    previewButton.onclick = () => void this.previewChanges();

    const plan = this.model.plan;
    if (!plan) return;
    const changes = container.createEl("section", { cls: "llmwiki-ask-mate-panel llmwiki-ask-mate-plan" });
    changes.createEl("h3", { text: "Exact change plan" });
    changes.createEl("code", { text: plan.fingerprint });
    changes.createEl("p", { text: `Affected: ${plan.affectedPaths.join(", ")}` });
    changes.createEl("pre", {
      text: `${plan.preview.before.managedMarkdown}\n\n→\n\n${plan.preview.after.managedMarkdown}`,
    });
    for (const warning of plan.warnings) changes.createEl("p", { cls: "llmwiki-proposal-warnings", text: warning });
    const confirm = changes.createEl("label", { cls: "llmwiki-ask-mate-confirm" });
    const checkbox = confirm.createEl("input", { type: "checkbox" });
    checkbox.checked = this.#confirmedFingerprint === plan.fingerprint;
    checkbox.onchange = () => this.setApplyConfirmed(checkbox.checked);
    confirm.createSpan({ text: "I confirm this exact plan and affected file." });
    const apply = changes.createEl("button", { text: "Apply confirmed plan", cls: "mod-cta" });
    apply.disabled = this.#busy || this.#confirmedFingerprint !== plan.fingerprint;
    apply.onclick = () => void this.applyConfirmedPlan().catch(() => undefined);
  }

  private renderNodeEditor(container: HTMLElement, nodeId: string, depth: number): void {
    const document = this.model.document;
    const node = document.nodes.find(candidate => candidate.id === nodeId);
    if (!node) return;
    const row = container.createDiv({ cls: "llmwiki-ask-mate-node" });
    row.style.setProperty("--llmwiki-outline-depth", String(depth));
    const label = row.createEl("input", { type: "text", value: node.label });
    label.setAttr("aria-label", `Label for ${node.label}`);
    label.onchange = () => {
      try {
        this.model.rename(nodeId, label.value);
        this.#confirmedFingerprint = null;
        this.render();
      } catch (error) {
        this.#error = safeError(error);
        this.render();
      }
    };
    const add = row.createEl("button", { text: "Add child" });
    add.onclick = () => {
      this.model.add(nodeId, "New node");
      this.#confirmedFingerprint = null;
      this.render();
    };
    if (nodeId !== document.rootId) {
      const parent = row.createEl("select");
      parent.setAttr("aria-label", `Parent for ${node.label}`);
      const currentParent = document.edges.find(edge => edge.to === nodeId)?.from;
      const blocked = descendantsOf(document, nodeId);
      for (const candidate of document.nodes) {
        if (candidate.id === nodeId || blocked.has(candidate.id)) continue;
        const option = parent.createEl("option", { value: candidate.id, text: `Parent: ${candidate.label}` });
        option.selected = candidate.id === currentParent;
      }
      parent.onchange = () => {
        this.model.reparent(nodeId, parent.value);
        this.#confirmedFingerprint = null;
        this.render();
      };
      const remove = row.createEl("button", { text: "Remove" });
      remove.onclick = () => {
        this.model.remove(nodeId);
        this.#confirmedFingerprint = null;
        this.render();
      };
    }
    for (const childId of document.edges.filter(edge => edge.from === nodeId).map(edge => edge.to)) {
      this.renderNodeEditor(container, childId, depth + 1);
    }
  }

  private requireContext(): AskMateContext {
    if (!this.#context) throw new Error("Ask Mate has no selected context");
    return this.#context;
  }

  private async refreshGraphEvidence(
    context: AskMateContext,
    documentFingerprint: Sha256Digest,
  ): Promise<void> {
    const suggestions = await this.client.queryGraphEvidence(context.path).catch(() => []);
    if (
      this.#context?.projectId !== context.projectId
      || this.#context.path !== context.path
      || this.#read?.documentFingerprint !== documentFingerprint
      || !this.model.hasDocument
    ) return;
    this.model.replaceSuggestions(suggestions);
    this.render();
  }
}

function descendantsOf(document: AskMateMapReadResult["document"], nodeId: string): Set<string> {
  const result = new Set<string>();
  const visit = (parent: string): void => {
    for (const edge of document.edges) {
      if (edge.from !== parent || result.has(edge.to)) continue;
      result.add(edge.to);
      visit(edge.to);
    }
  };
  visit(nodeId);
  return result;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Za-z]:[\\/][^\s]+/g, "[local path]").slice(0, 500);
}
