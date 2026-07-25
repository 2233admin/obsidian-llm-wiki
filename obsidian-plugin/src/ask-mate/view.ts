import { ItemView, Notice, WorkspaceLeaf, type ViewStateResult } from "obsidian";
import type {
  MindMapDocument,
  Sha256Digest,
} from "../../../packages/visual-workspace/dist/src/index.js";
import {
  AskMateOperationClient,
  type AskMateContextReadResult,
  type AskMateContributionAction,
  type AskMateExternalContributionPlan,
  type AskMateIssueChangePlan,
} from "./client";
import {
  AskMateInteractionModel,
  describeAskMateContext,
  parseRestoredAskMateContext,
  restorableAskMateContext,
  type AskMateContext,
  type AskMateIntent,
} from "./interaction-model";
import { AskMateOutlineModel, renderTextualTree } from "./outline-model";
import { safePresentationText, safeSummary } from "../control-plane-client";

export const ASK_MATE_VIEW_TYPE = "llmwiki-ask-mate";

export interface AskMateActors {
  /** The identity recorded as the proposer in plan provenance. */
  proposalActor: string;
  /** The authenticated human-host identity used for the confirmed apply. */
  confirmationActor: string;
}

type ProblemWorkflowAction =
  | "local_issue"
  | "local_only"
  | "create_issue"
  | "push_branch"
  | "create_draft_pull_request"
  | "mark_ready_for_review";

type ProblemReviewPlan =
  | { kind: "issue"; plan: AskMateIssueChangePlan }
  | {
    kind: "contribution";
    action: Exclude<ProblemWorkflowAction, "local_issue">;
    plan: AskMateExternalContributionPlan;
  };

interface ProblemDraft {
  observationId: string;
  repository: string;
  title: string;
  body: string;
  labels: string;
  reason: string;
}

interface ExternalStageAuthority {
  workRunId: string;
  approvalToken: string;
  pullRequestId: string;
  expectedPullRequestRevision: string;
}

const MAX_RENDERED_OUTLINE_NODES = 200;
const MAX_RENDERED_OUTLINE_DEPTH = 12;

function transitionToken(planFingerprint: Sha256Digest): string {
  const entropy = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `ask-mate:${planFingerprint.slice("sha256:".length, "sha256:".length + 16)}:${entropy}`;
}

export class AskMateView extends ItemView {
  readonly model = new AskMateOutlineModel();
  readonly interaction = new AskMateInteractionModel();
  #context: AskMateContext | null = null;
  #read: AskMateContextReadResult | null = null;
  #busy = false;
  #error: string | null = null;
  #confirmedFingerprint: Sha256Digest | null = null;
  #confirmedProblemAction: ProblemWorkflowAction | null = null;
  #reviewPlan: ProblemReviewPlan | null = null;
  #problemAction: ProblemWorkflowAction = "local_issue";
  #problemUnavailable: string | null = null;
  #lastProblemResult: string | null = null;
  #renderedNodeCount = 0;
  #contributionDraft: ProblemDraft = {
    observationId: "",
    repository: "",
    title: "",
    body: "",
    labels: "",
    reason: "",
  };
  #externalAuthority: ExternalStageAuthority = {
    workRunId: "",
    approvalToken: "",
    pullRequestId: "",
    expectedPullRequestRevision: "",
  };

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
    return restorableAskMateContext(this.#context);
  }

  async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    this.model.dispose();
    this.interaction.reset();
    this.#read = null;
    this.#reviewPlan = null;
    this.#problemUnavailable = null;
    this.#lastProblemResult = null;
    this.clearExternalAuthority();
    this.#confirmedFingerprint = null;
    const context = parseRestoredAskMateContext(state);
    if (context) await this.openContext(context);
    else {
      this.#context = null;
      this.render();
    }
  }

  async onClose(): Promise<void> {
    this.model.dispose();
    this.interaction.reset();
    this.#context = null;
    this.#read = null;
    this.#reviewPlan = null;
    this.#problemUnavailable = null;
    this.#lastProblemResult = null;
    this.clearExternalAuthority();
    this.#confirmedFingerprint = null;
  }

  async openContext(context: AskMateContext): Promise<void> {
    this.#context = context;
    this.#busy = true;
    this.#error = null;
    this.#reviewPlan = null;
    this.#problemUnavailable = null;
    this.#lastProblemResult = null;
    this.clearExternalAuthority();
    this.#confirmedFingerprint = null;
    this.render();
    try {
      const read = await this.client.readContext(context);
      this.#read = read;
      this.interaction.setClarifications(read.clarifications);
      this.interaction.setCapabilities(read.capabilities);
      if (read.document) this.model.load(read.document);
      else this.model.dispose();
      // Graphify is important context but remains optional. It loads after the
      // editable outline so a missing CLI or stale cache cannot block manual
      // editing, preview, or apply.
      if (read.document && read.documentFingerprint && context.path) {
        void this.refreshGraphEvidence(context, read.documentFingerprint);
      }
    } catch (error) {
      this.#read = null;
      this.model.dispose();
      this.interaction.setClarifications([]);
      this.#error = safeError(error);
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  async previewChanges(): Promise<void> {
    const context = this.requireContext();
    const read = this.requireRead();
    if (!this.interaction.canPlan) {
      throw new Error("Answer the required structure clarification before previewing a write");
    }
    if (!read.targetPath) {
      throw new Error("This context has no reviewed managed-map target");
    }
    this.#busy = true;
    this.#error = null;
    this.#confirmedFingerprint = null;
    this.render();
    try {
      const result = await this.client.planMap({
        project: context.projectId,
        path: read.targetPath,
        nextDocument: this.model.documentForPlan,
        actor: this.actors.proposalActor,
        origin: read.adoptionRequired ? "import" : "user",
        warnings: read.warnings,
        acceptedGraphEvidence: [...this.model.selectedSuggestions],
        clarificationAnswers: { ...this.interaction.answers },
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

  selectIntent(intent: AskMateIntent): void {
    this.interaction.selectIntent(intent);
    this.#reviewPlan = null;
    this.#confirmedFingerprint = null;
    this.#confirmedProblemAction = null;
    this.clearExternalAuthority();
    this.render();
  }

  answerClarification(clarificationId: string, optionId: string): void {
    this.interaction.answerClarification(clarificationId, optionId);
    this.model.clearPlan();
    this.#confirmedFingerprint = null;
    this.render();
  }

  setProblemDraft(input: Partial<ProblemDraft>): void {
    if (this.hasImmutablePullRequestPlan()) {
      throw new Error("Discard the current immutable pull-request plan before changing its inputs");
    }
    this.#contributionDraft = { ...this.#contributionDraft, ...input };
    this.#reviewPlan = null;
    this.#problemUnavailable = null;
    this.#confirmedFingerprint = null;
    this.#confirmedProblemAction = null;
    this.clearExternalAuthority();
    this.render();
  }

  setExternalAuthority(input: Partial<ExternalStageAuthority>): void {
    this.#externalAuthority = { ...this.#externalAuthority, ...input };
    this.#confirmedFingerprint = null;
    this.#confirmedProblemAction = null;
    this.render();
  }

  async previewProblemAction(action: ProblemWorkflowAction): Promise<void> {
    const context = this.requireContext();
    const observationId = this.#contributionDraft.observationId.trim();
    if (!observationId) throw new Error("Select a reviewed Problem Observation before planning");
    if (this.retainPullRequestPlanForAction(action)) {
      this.render();
      return;
    }
    this.#problemAction = action;
    this.#reviewPlan = null;
    this.#problemUnavailable = null;
    this.#lastProblemResult = null;
    this.#confirmedFingerprint = null;
    this.#confirmedProblemAction = null;
    this.clearExternalAuthority();
    this.#busy = true;
    this.#error = null;
    this.render();
    try {
      if (action === "local_issue") {
        const plan = await this.client.planIssue({
          projectId: context.projectId,
          observationId,
          actor: this.actors.proposalActor,
        });
        this.#reviewPlan = { kind: "issue", plan };
        return;
      }
      const choice = action === "local_only"
        ? "local_only"
        : action === "create_issue"
          ? "submit_issue"
          : "prepare_pull_request";
      const result = await this.client.planContribution({
        projectId: context.projectId,
        observationId,
        choice,
        actor: this.actors.proposalActor,
        ...(this.#contributionDraft.reason.trim()
          ? { reason: this.#contributionDraft.reason.trim() }
          : {}),
        ...(choice === "local_only"
          ? {}
          : {
            repository: this.#contributionDraft.repository.trim(),
            title: this.#contributionDraft.title.trim(),
            body: this.#contributionDraft.body,
            labels: this.#contributionDraft.labels
              .split(",")
              .map(label => label.trim())
              .filter(Boolean),
          }),
      });
      if (!result.available) {
        this.#problemUnavailable = `${result.reason} Fallback: ${result.fallback}. ${result.warnings.join(" ")}`.trim();
        return;
      }
      this.#reviewPlan = { kind: "contribution", action, plan: result.plan };
    } catch (error) {
      this.#error = safeError(error);
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  async previewProblemDisposition(
    disposition: "local_only" | "submit_issue" | "prepare_pull_request",
  ): Promise<void> {
    return this.previewProblemAction(disposition === "submit_issue"
      ? "create_issue"
      : disposition === "prepare_pull_request"
        ? "push_branch"
        : "local_only");
  }

  async applyConfirmedProblemPlan(): Promise<void> {
    const reviewed = this.#reviewPlan;
    const plan = reviewed?.plan;
    if (!reviewed || !plan) {
      throw new Error("Confirm the exact current problem plan before applying");
    }
    const reviewedAction = problemReviewAction(reviewed);
    if (
      this.#confirmedFingerprint !== plan.fingerprint
      || this.#confirmedProblemAction !== reviewedAction
    ) {
      throw new Error("Confirm the exact current problem plan before applying");
    }
    if (reviewed.kind === "contribution" && reviewed.action === "local_only") {
      throw new Error("A local-only contribution plan has no external apply step");
    }
    this.#busy = true;
    this.#error = null;
    this.render();
    try {
      let result: Record<string, unknown>;
      if (reviewed.kind === "issue") {
        result = await this.client.applyIssue({
          plan: reviewed.plan,
          presentedFingerprint: reviewed.plan.fingerprint,
          actor: this.actors.confirmationActor,
          transitionToken: transitionToken(reviewed.plan.fingerprint),
        });
      } else {
        const workRunId = this.#externalAuthority.workRunId.trim();
        const approvalToken = this.#externalAuthority.approvalToken.trim();
        if (!workRunId || !approvalToken) {
          throw new Error("This external stage requires a Work Run ID and fresh approval token");
        }
        if (
          reviewed.action === "mark_ready_for_review"
          && (!this.#externalAuthority.pullRequestId.trim()
            || !this.#externalAuthority.expectedPullRequestRevision.trim())
        ) {
          throw new Error("Mark ready requires the exact pull request ID and expected revision");
        }
        result = await this.client.applyContribution({
          plan: reviewed.plan,
          presentedFingerprint: reviewed.plan.fingerprint,
          approved: true,
          actor: this.actors.confirmationActor,
          workRunId,
          approvalToken,
          transitionToken: transitionToken(reviewed.plan.fingerprint),
          action: reviewed.action as AskMateContributionAction,
          ...(reviewed.action === "mark_ready_for_review"
            ? {
              pullRequestId: this.#externalAuthority.pullRequestId.trim(),
              expectedPullRequestRevision:
                this.#externalAuthority.expectedPullRequestRevision.trim(),
            }
            : {}),
        });
      }
      this.#lastProblemResult = safeSummary(result);
      this.#confirmedFingerprint = null;
      this.#confirmedProblemAction = null;
      this.clearExternalAuthority();
      if (
        reviewed.kind === "contribution"
        && reviewed.plan.disposition.choice === "prepare_pull_request"
      ) {
        const nextAction = nextPullRequestAction(reviewed.action);
        this.#problemAction = nextAction ?? reviewed.action;
        this.#reviewPlan = {
          kind: "contribution",
          action: nextAction ?? reviewed.action,
          plan: reviewed.plan,
        };
      } else {
        this.#reviewPlan = null;
      }
      new Notice(reviewed.kind === "issue"
        ? "LLM Wiki: local Work-OS issue plan applied."
        : reviewed.plan.disposition.choice === "prepare_pull_request"
          ? nextPullRequestAction(reviewed.action)
            ? `LLM Wiki: approved ${problemActionLabel(reviewed.action)} stage applied. The immutable plan is retained; the next stage needs fresh authority and confirmation.`
            : `LLM Wiki: approved ${problemActionLabel(reviewed.action)} stage applied. The immutable plan remains available as receipt context; merge is not offered.`
          : `LLM Wiki: approved ${problemActionLabel(reviewed.action)} stage applied.`);
    } catch (error) {
      this.#error = safeError(error);
      this.#confirmedFingerprint = null;
      this.#confirmedProblemAction = null;
      this.clearExternalAuthority();
      throw error;
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  setApplyConfirmed(confirmed: boolean): void {
    const plan = this.model.plan;
    this.#confirmedFingerprint = confirmed && plan ? plan.fingerprint : null;
    this.#confirmedProblemAction = null;
    this.render();
  }

  setProblemPlanConfirmed(confirmed: boolean): void {
    this.#confirmedFingerprint = confirmed && this.#reviewPlan
      ? this.#reviewPlan.plan.fingerprint
      : null;
    this.#confirmedProblemAction = confirmed && this.#reviewPlan
      ? problemReviewAction(this.#reviewPlan)
      : null;
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
    container.style.maxWidth = "100%";
    container.style.overflowX = "auto";
    container.createEl("h2", { text: "Ask Mate", attr: { id: "llmwiki-ask-mate-title" } });
    const liveRegion = container.createEl("p", { cls: "llmwiki-ask-mate-status" });
    liveRegion.setAttr("role", "status");
    liveRegion.setAttr("aria-live", "polite");
    liveRegion.setText(this.#busy ? "Working…" : this.#error ?? "Ready");
    if (!this.#context) {
      container.createEl("p", {
        cls: "llmwiki-ask-mate-empty",
        text: "Choose an active Markdown note, selected text, a supported Obsidian core Canvas, a managed Mind Map Document, or the current Project Context. Ask Mate never scans the vault implicitly.",
      });
      return;
    }
    container.createEl("p", {
      cls: "llmwiki-ask-mate-context",
      text: `Reads only: ${describeAskMateContext(this.#context)}`,
    });
    if (this.#error) liveRegion.addClass("llmwiki-control-plane-error");
    if (this.#read) {
      for (const warning of this.#read.warnings) {
        container.createEl("p", { cls: "llmwiki-proposal-warnings", text: warning });
      }
      const capabilities = this.interaction.capabilities;
      container.createEl("p", {
        cls: "llmwiki-ask-mate-capabilities",
        text: `Model: ${capabilities.model} · Graphify: ${capabilities.graphify} · Problem Intake: ${capabilities.problemIntake}`,
      });
      for (const message of capabilities.messages) {
        container.createEl("p", { cls: "llmwiki-ask-mate-degraded", text: message });
      }
    }

    const intents = container.createEl("nav", { cls: "llmwiki-ask-mate-intents" });
    intents.setAttr("aria-label", "Ask Mate intent");
    const intentOptions: Array<[AskMateIntent, string]> = [
      ["understand", "Understand this"],
      ["make_map", "Make or revise a map"],
      ["report_problem", "Report or fix a problem"],
    ];
    for (const [intent, label] of intentOptions) {
      const button = intents.createEl("button", { text: label });
      button.setAttr("aria-pressed", String(this.interaction.intent === intent));
      button.disabled = this.#busy;
      button.onclick = () => this.selectIntent(intent);
    }

    this.renderClarifications(container);

    if (this.interaction.intent === "report_problem") {
      this.renderProblemIntent(container);
      return;
    }
    if (!this.model.hasDocument) {
      container.createEl("p", {
        text: this.#read?.readOnly
          ? "This context is read-only and has no safely interpreted map."
          : "No supported map structure is available for this context.",
      });
      return;
    }

    this.renderUnderstandIntent(container);
    if (this.interaction.intent === "make_map") this.renderMapIntent(container);
  }

  private renderClarifications(container: HTMLElement): void {
    const clarifications = this.interaction.clarifications;
    if (!clarifications.length) return;
    const section = container.createEl("section", { cls: "llmwiki-ask-mate-panel" });
    section.createEl("h3", { text: "Clarify structure" });
    for (const clarification of clarifications) {
      const fieldset = section.createEl("fieldset");
      fieldset.createEl("legend", {
        text: `${clarification.prompt}${clarification.required ? " (required)" : ""}`,
      });
      for (const option of clarification.options) {
        const row = fieldset.createEl("label");
        const radio = row.createEl("input", { type: "radio" });
        radio.name = `ask-mate-${clarification.id}`;
        radio.value = option.id;
        radio.checked = this.interaction.answers[clarification.id] === option.id;
        radio.onchange = () => this.answerClarification(clarification.id, option.id);
        row.createSpan({
          text: `${option.label}${option.evidenceRefs.length
            ? ` · evidence ${option.evidenceRefs.join(", ")}`
            : ""}`,
        });
      }
    }
    if (!this.interaction.canPlan) {
      section.createEl("p", { text: "A write plan waits for the required choices; reading and manual review remain available." });
    }
  }

  private renderUnderstandIntent(container: HTMLElement): void {
    const section = container.createEl("section", { cls: "llmwiki-ask-mate-panel" });
    section.createEl("h3", { text: "Interpreted structure" });
    section.createEl("p", {
      text: this.#read?.adoptionRequired
        ? "This is a read-only adoption candidate. The source remains unchanged until a canonical map plan is explicitly applied."
        : "This textual representation exposes the same hierarchy without depending on spatial rendering.",
    });
    section.createEl("pre", { text: this.model.snapshot.textualPreview });
    this.renderGraphEvidence(container, this.interaction.intent === "make_map");
  }

  private renderGraphEvidence(container: HTMLElement, selectable: boolean): void {
    const evidence = container.createEl("section", { cls: "llmwiki-ask-mate-panel" });
    evidence.createEl("h3", { text: "Optional Graphify evidence" });
    evidence.createEl("p", {
      text: selectable
        ? "Select only relations that should be carried into the reviewed plan. They never enter canonical structure silently."
        : "Relation, confidence, adapter provenance, and source remain inspectable context.",
    });
    if (!this.model.suggestions.length) {
      evidence.createEl("p", { text: "Graphify is unavailable, stale, or found no relevant relation. Core outline work remains available." });
    }
    for (const suggestion of this.model.suggestions) {
      const row = evidence.createEl("label", { cls: "llmwiki-ask-mate-evidence" });
      if (selectable) {
        const checkbox = row.createEl("input", { type: "checkbox" });
        checkbox.checked = this.model.snapshot.selectedSuggestionIds.includes(suggestion.id);
        checkbox.onchange = () => {
          this.model.selectSuggestion(suggestion.id, checkbox.checked);
          this.#confirmedFingerprint = null;
          this.render();
        };
      }
      const source = suggestion.evidenceRefs.length ? ` · source ${suggestion.evidenceRefs.join(", ")}` : "";
      row.createSpan({
        text: `${suggestion.from} —${suggestion.relation}→ ${suggestion.to} · ${suggestion.confidence} · ${suggestion.adapter}${source}`,
      });
    }
  }

  private renderMapIntent(container: HTMLElement): void {
    const outline = container.createEl("section", { cls: "llmwiki-ask-mate-panel" });
    outline.createEl("h3", { text: "Structured outline" });
    outline.createEl("p", { text: "Keyboard-editable hierarchy. Draft edits are ephemeral and do not write files." });
    this.#renderedNodeCount = 0;
    this.renderNodeEditor(outline, this.model.document.rootId, 0);

    const snapshot = this.model.snapshot;
    const changes = outline.createEl("fieldset");
    changes.createEl("legend", { text: "Selectable structural changes" });
    if (!snapshot.structuralChanges.length) changes.createEl("p", { text: "No structural changes yet." });
    for (const change of snapshot.structuralChanges) {
      const row = changes.createEl("label");
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = snapshot.selectedChangeIds.includes(change.id);
      checkbox.onchange = () => {
        try {
          this.model.setChangeSelected(change.id, checkbox.checked);
          this.#error = null;
          this.#confirmedFingerprint = null;
        } catch (error) {
          this.#error = safeError(error);
        }
        this.render();
      };
      row.createSpan({ text: change.summary });
    }

    const preview = container.createEl("section", { cls: "llmwiki-ask-mate-panel" });
    preview.createEl("h3", { text: "Live deterministic preview" });
    preview.createEl("pre", { text: renderSelectedPreview(this.model) });
    const previewButton = preview.createEl("button", { text: "Preview exact plan", cls: "mod-cta" });
    previewButton.disabled = this.#busy || !this.interaction.canPlan;
    previewButton.onclick = () => void this.previewChanges().catch(error => {
      this.#error = safeError(error);
      this.render();
    });

    const plan = this.model.plan;
    if (!plan) return;
    const planSection = container.createEl("section", { cls: "llmwiki-ask-mate-panel llmwiki-ask-mate-plan" });
    planSection.createEl("h3", { text: "Exact change plan" });
    planSection.createEl("code", { text: plan.fingerprint });
    planSection.createEl("p", { text: `Affected: ${plan.affectedPaths.join(", ")}` });
    planSection.createEl("pre", {
      text: `${plan.preview.before.managedMarkdown}\n\n→\n\n${plan.preview.after.managedMarkdown}`,
    });
    for (const warning of plan.warnings) {
      planSection.createEl("p", { cls: "llmwiki-proposal-warnings", text: warning });
    }
    const confirm = planSection.createEl("label", { cls: "llmwiki-ask-mate-confirm" });
    const checkbox = confirm.createEl("input", { type: "checkbox" });
    checkbox.checked = this.#confirmedFingerprint === plan.fingerprint;
    checkbox.onchange = () => this.setApplyConfirmed(checkbox.checked);
    confirm.createSpan({ text: "I confirm this exact plan, selected evidence, and affected file." });
    const apply = planSection.createEl("button", { text: "Apply confirmed plan", cls: "mod-cta" });
    apply.disabled = this.#busy || this.#confirmedFingerprint !== plan.fingerprint;
    apply.onclick = () => void this.applyConfirmedPlan().catch(() => undefined);
  }

  private renderProblemIntent(container: HTMLElement): void {
    const section = container.createEl("section", { cls: "llmwiki-ask-mate-panel" });
    section.createEl("h3", { text: "Reviewed problem workflow" });
    section.createEl("p", {
      text: "A pull-request workflow creates one immutable canonical plan. Branch push, draft creation, and ready transition reuse that fingerprint, while every stage still requires a separate action preview, fresh authority, exact confirmation, and transition token. Merge is never offered.",
    });
    this.renderProblemField(section, "observationId", "Reviewed Problem Observation ID", "input");
    const choices: Array<[ProblemWorkflowAction, string]> = [
      ["local_issue", "Create or update local Work-OS issue"],
      ["local_only", "Keep local; no external apply"],
      ["create_issue", "Create upstream Issue"],
      ["push_branch", "Push verified branch"],
      ["create_draft_pull_request", "Create draft pull request"],
      ["mark_ready_for_review", "Mark pull request ready"],
    ];
    for (const [action, label] of choices) {
      const button = section.createEl("button", { text: label });
      button.setAttr("aria-pressed", String(this.#problemAction === action));
      button.disabled = this.#busy || this.interaction.capabilities.problemIntake === "unavailable";
      button.onclick = () => {
        if (this.retainPullRequestPlanForAction(action)) {
          this.render();
          return;
        }
        this.#problemAction = action;
        this.#reviewPlan = null;
        this.#problemUnavailable = null;
        this.#lastProblemResult = null;
        this.#confirmedFingerprint = null;
        this.#confirmedProblemAction = null;
        this.clearExternalAuthority();
        this.render();
      };
    }
    if (this.#problemAction !== "local_issue") {
      this.renderContributionFields(section);
    }
    const preview = section.createEl("button", {
      text: `Preview exact ${problemActionLabel(this.#problemAction)} plan`,
      cls: "mod-cta",
    });
    preview.disabled = this.#busy || this.interaction.capabilities.problemIntake === "unavailable";
    preview.onclick = () => void this.previewProblemAction(this.#problemAction).catch(error => {
      this.#error = safeError(error);
      this.render();
    });

    if (this.#problemUnavailable) {
      section.createEl("p", {
        cls: "llmwiki-proposal-warnings",
        text: this.#problemUnavailable,
      });
    }
    if (this.#lastProblemResult) {
      section.createEl("h4", { text: "Last backend result" });
      section.createEl("pre", { text: this.#lastProblemResult });
    }

    const reviewed = this.#reviewPlan;
    const plan = reviewed?.plan;
    if (!reviewed || !plan) return;
    const reviewedAction = problemReviewAction(reviewed);
    if (
      reviewed.kind === "contribution"
      && reviewed.plan.disposition.choice === "prepare_pull_request"
    ) {
      section.createEl("p", {
        text: "This canonical pull-request plan is locked for the full push → draft → ready receipt chain. Stage changes do not regenerate it.",
      });
    }
    section.createEl("h4", { text: `Exact ${problemActionLabel(this.#problemAction)} plan` });
    section.createEl("code", { text: plan.fingerprint });
    section.createEl("pre", { text: safeSummary(plan) });
    for (const warning of plan.warnings) {
      section.createEl("p", { cls: "llmwiki-proposal-warnings", text: warning });
    }
    if (reviewed.kind === "contribution" && reviewed.action === "local_only") {
      section.createEl("p", {
        text: "This immutable local-only plan contains no target, content, patch, remote authority, or apply step. It grants no remote consent.",
      });
      return;
    }
    const externalAction = reviewed.kind === "contribution"
      && reviewed.action !== "local_only"
      ? reviewed.action
      : null;
    if (externalAction) {
      this.renderExternalAuthorityFields(section, externalAction);
    }
    const confirm = section.createEl("label", { cls: "llmwiki-ask-mate-confirm" });
    const checkbox = confirm.createEl("input", { type: "checkbox" });
    checkbox.checked = this.#confirmedFingerprint === plan.fingerprint
      && this.#confirmedProblemAction === reviewedAction;
    checkbox.onchange = () => this.setProblemPlanConfirmed(checkbox.checked);
    confirm.createSpan({
      text: reviewed.kind === "issue"
        ? "I confirm this exact local Work-OS issue plan."
        : `I approve only this exact ${problemActionLabel(reviewed.action)} stage. No later stage or merge is authorized.`,
    });
    const apply = section.createEl("button", {
      text: reviewed.kind === "issue"
        ? "Apply local Work-OS issue plan"
        : `Apply approved ${problemActionLabel(reviewed.action)} stage`,
      cls: "mod-cta",
    });
    apply.disabled = this.#busy
      || this.#confirmedFingerprint !== plan.fingerprint
      || this.#confirmedProblemAction !== reviewedAction
      || (externalAction !== null
        && !this.externalAuthorityReady(externalAction));
    apply.onclick = () => void this.applyConfirmedProblemPlan().catch(() => undefined);
  }

  private renderContributionFields(container: HTMLElement): void {
    const fields: Array<[keyof ProblemDraft, string, "input" | "textarea"]> = [
      ["reason", "Disposition reason (optional)", "input"],
      ["repository", "Repository target", "input"],
      ["title", "Title", "input"],
      ["body", "Body and bounded evidence", "textarea"],
      ["labels", "Labels (comma separated)", "input"],
    ];
    for (const [field, label, kind] of fields) {
      if (
        this.#problemAction === "local_only"
        && field !== "reason"
      ) continue;
      this.renderProblemField(container, field, label, kind);
    }
  }

  private renderProblemField(
    container: HTMLElement,
    field: keyof ProblemDraft,
    label: string,
    kind: "input" | "textarea",
  ): void {
    const row = container.createEl("label");
    row.createSpan({ text: label });
    const input = kind === "textarea"
      ? row.createEl("textarea")
      : row.createEl("input", { type: "text" });
    input.value = this.#contributionDraft[field];
    input.disabled = this.hasImmutablePullRequestPlan();
    input.oninput = () => {
      this.#contributionDraft[field] = input.value;
      this.#reviewPlan = null;
      this.#problemUnavailable = null;
      this.#confirmedFingerprint = null;
      this.#confirmedProblemAction = null;
    };
  }

  private renderExternalAuthorityFields(
    container: HTMLElement,
    action: Exclude<ProblemWorkflowAction, "local_issue" | "local_only">,
  ): void {
    container.createEl("p", {
      text: "Authority is ephemeral, applies only to this stage, and is cleared after apply or stage change.",
    });
    const fields: Array<readonly [
      keyof ExternalStageAuthority,
      string,
    ]> = [
      ["workRunId", "Approved Work Run ID"],
      ["approvalToken", "Per-run approval token"],
      ...(action === "mark_ready_for_review"
        ? [
          ["pullRequestId", "Exact pull request ID"] as const,
          ["expectedPullRequestRevision", "Expected pull request revision"] as const,
        ]
        : []),
    ];
    for (const [field, label] of fields) {
      const row = container.createEl("label");
      row.createSpan({ text: label });
      const input = row.createEl("input", {
        type: field === "approvalToken" ? "password" : "text",
      });
      input.value = this.#externalAuthority[field];
      input.setAttr("autocomplete", "off");
      input.oninput = () => {
        this.#externalAuthority[field] = input.value;
        this.#confirmedFingerprint = null;
        this.#confirmedProblemAction = null;
      };
    }
  }

  private renderNodeEditor(container: HTMLElement, nodeId: string, depth: number): void {
    if (this.#renderedNodeCount >= MAX_RENDERED_OUTLINE_NODES) {
      if (this.#renderedNodeCount === MAX_RENDERED_OUTLINE_NODES) {
        container.createEl("p", {
          text: `Outline editor limited to ${MAX_RENDERED_OUTLINE_NODES} nodes on this surface. The textual review remains available.`,
        });
        this.#renderedNodeCount += 1;
      }
      return;
    }
    if (depth > MAX_RENDERED_OUTLINE_DEPTH) {
      container.createEl("p", {
        text: `Deeper nodes are collapsed after level ${MAX_RENDERED_OUTLINE_DEPTH} on this surface.`,
      });
      return;
    }
    this.#renderedNodeCount += 1;
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

  private requireRead(): AskMateContextReadResult {
    if (!this.#read) throw new Error("Ask Mate has no inspected context");
    return this.#read;
  }

  private clearExternalAuthority(): void {
    this.#externalAuthority = {
      workRunId: "",
      approvalToken: "",
      pullRequestId: "",
      expectedPullRequestRevision: "",
    };
  }

  private hasImmutablePullRequestPlan(): boolean {
    return this.#reviewPlan?.kind === "contribution"
      && this.#reviewPlan.plan.disposition.choice === "prepare_pull_request";
  }

  private retainPullRequestPlanForAction(action: ProblemWorkflowAction): boolean {
    if (!isPullRequestAction(action) || !this.hasImmutablePullRequestPlan()) return false;
    const reviewed = this.#reviewPlan;
    if (!reviewed || reviewed.kind !== "contribution") return false;
    this.#problemAction = action;
    this.#reviewPlan = { kind: "contribution", action, plan: reviewed.plan };
    this.#problemUnavailable = null;
    this.#confirmedFingerprint = null;
    this.#confirmedProblemAction = null;
    this.clearExternalAuthority();
    return true;
  }

  private externalAuthorityReady(
    action: Exclude<ProblemWorkflowAction, "local_issue" | "local_only">,
  ): boolean {
    if (
      !this.#externalAuthority.workRunId.trim()
      || !this.#externalAuthority.approvalToken.trim()
    ) return false;
    return action !== "mark_ready_for_review"
      || (
        Boolean(this.#externalAuthority.pullRequestId.trim())
        && Boolean(this.#externalAuthority.expectedPullRequestRevision.trim())
      );
  }

  private async refreshGraphEvidence(
    context: AskMateContext,
    documentFingerprint: Sha256Digest,
  ): Promise<void> {
    if (!context.path) return;
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

function descendantsOf(document: MindMapDocument, nodeId: string): Set<string> {
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

function renderSelectedPreview(model: AskMateOutlineModel): string {
  return renderTextualTree(model.documentForPlan);
}

function problemActionLabel(action: ProblemWorkflowAction): string {
  switch (action) {
    case "local_issue": return "local Work-OS issue";
    case "local_only": return "local-only disposition";
    case "create_issue": return "upstream Issue create";
    case "push_branch": return "branch push";
    case "create_draft_pull_request": return "draft pull request create";
    case "mark_ready_for_review": return "ready-for-review transition";
  }
}

function problemReviewAction(reviewed: ProblemReviewPlan): ProblemWorkflowAction {
  return reviewed.kind === "issue" ? "local_issue" : reviewed.action;
}

function isPullRequestAction(
  action: ProblemWorkflowAction,
): action is "push_branch" | "create_draft_pull_request" | "mark_ready_for_review" {
  return action === "push_branch"
    || action === "create_draft_pull_request"
    || action === "mark_ready_for_review";
}

function nextPullRequestAction(
  action: Exclude<ProblemWorkflowAction, "local_issue">,
): "create_draft_pull_request" | "mark_ready_for_review" | null {
  if (action === "push_branch") return "create_draft_pull_request";
  if (action === "create_draft_pull_request") return "mark_ready_for_review";
  return null;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return safePresentationText(message).slice(0, 500);
}
