import { safePresentationText } from "../control-plane-client";
import type {
  RecoveryAgentSelectionV2,
  RecoveryCandidateV2,
  RecoveryFlowResponseV2,
  RecoveryOpenPayloadV2,
  RecoveryPlanV2,
  RecoveryRefreshPlanRequestV2,
  RecoveryRestartRequestV2,
  RecoverySearchRequestV2,
  RecoverySearchedPayloadV2,
  RecoveryStaleProofV2,
} from "../../../mcp-server/src/project-hub/recovery-flow";
import type { RecoveryApplyResponseV2 } from "../../../mcp-server/src/workflow/recovery-apply";
import {
  ProjectHubRecoveryClient,
  RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
  validateRecoveryApplyResponse,
  type RecoveryApplyPlanningInput,
  type RecoveryPlanRequestV2,
  type RecoveryProjectId,
} from "./recovery-client";

const SEARCH_LIMIT = 25;
const STAGES = ["open", "searched", "needs-agent-selection", "planned", "stale", "unavailable"] as const;
const ABSOLUTE_PATH = /(?:^|[\s"'([{,;])(?:[A-Za-z]:[\\/]|[\\/]{1,2}|~[\\/])/u;

function safeReceiptPresentation(value: unknown): string {
  return ABSOLUTE_PATH.test(String(value ?? "")) ? "[redacted unsafe value]" : safePresentationText(value);
}

export interface RecoveryPanelState {
  projectId: RecoveryProjectId;
  flow: RecoveryFlowResponseV2 | null;
  query: string;
  selectedCandidateId: string | null;
  selectedBinding: RecoveryAgentSelectionV2 | null;
  applyResponse: RecoveryApplyResponseV2 | null;
  confirming: boolean;
  busy: boolean;
  error: string | null;
}

type CitationHandler = (target: string) => void;

/** Ephemeral Ask Mate presentation for the read-only Recovery Flow. */
export class ProjectHubRecoveryPanel {
  #state: RecoveryPanelState;
  #generation = 0;
  #disposed = false;
  #busyMutation = false;
  #applyBlocked = false;
  #focusTarget: string | null = null;

  constructor(
    private readonly client: ProjectHubRecoveryClient,
    private container: HTMLElement | null = null,
    private readonly onCitation?: CitationHandler,
    private readonly confirmationActor = "obsidian-control-plane",
    private readonly onSearchCompleted?: () => void,
  ) {
    this.#state = this.emptyState("project/unknown");
  }

  get state(): RecoveryPanelState {
    return this.#state;
  }

  async open(projectId: RecoveryProjectId): Promise<void> {
    if (this.#state.projectId !== projectId) this.#applyBlocked = false;
    this.#disposed = false;
    this.#busyMutation = false;
    this.#generation += 1;
    this.#state = this.emptyState(projectId);
    await this.execute(() => this.client.open(projectId));
  }

  async search(query: string): Promise<void> {
    const flow = this.#state.flow;
    if (!flow || flow.stage === "stale" || flow.stage === "unavailable") {
      this.fail("Open the current Project before searching.");
      return;
    }
    const normalized = query.trim();
    if (!normalized) {
      this.fail("Enter a search query before searching.");
      return;
    }
    this.#state.query = normalized;
    this.#state.selectedCandidateId = null;
    this.#state.selectedBinding = null;
    this.#state.applyResponse = null;
    this.#state.confirming = false;
    const request: RecoverySearchRequestV2 = {
      schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
      projectId: this.#state.projectId,
      action: "search",
      openFlowFingerprint: flow.rootOpenFlowFingerprint,
      query: normalized,
      limit: SEARCH_LIMIT,
    };
    await this.execute(() => this.client.search(request), response => {
      if (response.stage === "searched") {
        this.#state.query = response.payload.query;
        this.#state.selectedCandidateId = response.payload.recommendedCandidateId ?? null;
        if (response.payload.results.some(result => result.citationTargets.length > 0)) {
          this.onSearchCompleted?.();
        }
      }
    });
    if (this.isClosedRecommendation(this.#state.flow)) await this.followRecommended();
  }

  async followRecommended(): Promise<void> {
    const flow = this.#state.flow;
    if (!this.isClosedRecommendation(flow)) {
      this.fail("No single server-recommended recovery request is available.");
      return;
    }
    const request = flow.nextRequests.find(item => item.action === "plan"
      && item.mode === "from-search"
      && item.candidateId === flow.payload.recommendedCandidateId);
    if (!request) {
      this.fail("The server recommendation is unavailable; choose a candidate and Binding explicitly.");
      return;
    }
    await this.execute(() => this.client.plan(request), response => {
      this.#state.selectedCandidateId = response.stage === "planned" ? response.payload.plan.candidateId : null;
      this.#state.selectedBinding = response.stage === "planned" ? {
        bindingId: response.payload.plan.agentSelection.bindingId,
        bindingRevision: response.payload.plan.agentSelection.bindingRevision,
      } : null;
    });
  }

  async plan(candidateId: string, bindingId: string, bindingRevision: number): Promise<void> {
    const flow = this.#state.flow;
    if (!flow || (flow.stage !== "searched" && flow.stage !== "needs-agent-selection")) {
      this.fail("Search the current Project before planning recovery.");
      return;
    }
    const query = flow.stage === "searched" ? flow.payload.query : this.#state.query.trim();
    if (!query) {
      this.fail("Enter a search query before planning recovery.");
      return;
    }
    const request: RecoveryPlanRequestV2 = {
      schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
      projectId: this.#state.projectId,
      action: "plan",
      mode: "from-search",
      openFlowFingerprint: flow.rootOpenFlowFingerprint,
      searchedBasisFlowFingerprint: flow.flowFingerprint,
      plannedFlowFingerprint: null,
      query,
      limit: flow.stage === "searched" ? flow.payload.limit : SEARCH_LIMIT,
      candidateId: candidateId.trim(),
      agentSelection: { bindingId: bindingId.trim(), bindingRevision },
      priorPlan: null,
    };
    this.#state.selectedCandidateId = request.candidateId;
    this.#state.selectedBinding = request.agentSelection;
    await this.execute(() => this.client.plan(request));
  }

  async refreshPlan(): Promise<void> {
    const flow = this.#state.flow;
    if (!flow || flow.stage !== "planned") {
      this.fail("There is no current Plan to refresh.");
      return;
    }
    if (this.#applyBlocked || this.#state.applyResponse?.state === "outcome-unknown") {
      this.fail("Workflow outcome is unknown. Run Workflow doctor before refreshing or retrying recovery.");
      return;
    }
    const request = flow.nextRequests.find(item => item.action === "refresh-plan");
    if (!request) {
      this.fail("The server did not provide an exact Plan refresh request.");
      return;
    }
    this.#state.applyResponse = null;
    this.#state.confirming = false;
    this.#focusTarget = "status";
    await this.execute(() => this.client.refreshPlan(request));
  }

  beginConfirmation(): void {
    const flow = this.#state.flow;
    if (!flow || flow.stage !== "planned") {
      this.fail("Show the current Recovery Plan before confirming it.");
      return;
    }
    if (this.#applyBlocked || this.#state.applyResponse?.state === "outcome-unknown") {
      this.fail("Owner outcome is unknown. Apply and replay are disabled until Workflow doctor reconciliation.");
      return;
    }
    const expiry = Date.parse(flow.payload.plan.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      this.fail("This Plan is expired. Refresh Plan explicitly before confirming it.");
      return;
    }
    this.#state.error = null;
    this.#state.confirming = true;
    this.#focusTarget = "confirm-apply";
    this.render();
  }

  cancelConfirmation(): void {
    if (!this.#state.confirming) return;
    this.#state.confirming = false;
    this.#state.error = null;
    this.#focusTarget = "confirm-plan";
    this.render();
  }

  async apply(): Promise<void> {
    const flow = this.#state.flow;
    if (this.#state.busy || !this.#state.confirming) return;
    if (this.#applyBlocked || this.#state.applyResponse?.state === "outcome-unknown") {
      this.fail("Owner outcome is unknown. Apply and replay are disabled until Workflow doctor reconciliation.");
      return;
    }
    if (!flow || flow.stage !== "planned") {
      this.fail("Show the current Recovery Plan before applying it.");
      return;
    }
    const plan = flow.payload.plan;
    const expiry = Date.parse(plan.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      this.#state.confirming = false;
      this.fail("This Plan is expired. Refresh Plan explicitly before applying it.");
      return;
    }
    const refreshRequest = flow.nextRequests.find(request => request.action === "refresh-plan");
    if (!refreshRequest || refreshRequest.priorPlan.fingerprint !== plan.fingerprint) {
      this.#state.confirming = false;
      this.fail("The exact visible Plan planning input is unavailable; refresh the Plan explicitly.");
      return;
    }
    const planningInput: RecoveryApplyPlanningInput = {
      query: refreshRequest.query,
      limit: refreshRequest.limit,
    };
    this.#state.confirming = false;
    const response = await this.executeApply(() => this.client.apply(plan, planningInput, this.confirmationActor), plan);
    if (response?.state !== "applied" || this.#disposed) return;

    // An applied receipt is the only path that discards this Flow. The fresh
    // open is then sourced from current owners, not the old in-memory Plan.
    const projectId = this.#state.projectId;
    this.#state.flow = null;
    this.#state.query = "";
    this.#state.selectedCandidateId = null;
    this.#state.selectedBinding = null;
    this.#focusTarget = "open-stage";
    await this.execute(() => this.client.open(projectId));
  }

  async restart(): Promise<void> {
    const flow = this.#state.flow;
    if (!flow || flow.stage !== "stale") {
      this.fail("Restart is available only for a stale Flow.");
      return;
    }
    const request = flow.nextRequests.find(item => item.action === "restart");
    if (!request) {
      this.fail("The server did not provide an exact restart request.");
      return;
    }
    await this.execute(() => this.client.restart(request), response => {
      if (response.stage !== "open") return;
      this.#state.query = "";
      this.#state.selectedCandidateId = null;
      this.#state.selectedBinding = null;
    });
  }

  cancel(): void {
    if (!this.#state.busy || this.#busyMutation) return;
    this.#generation += 1;
    this.#state.busy = false;
    this.#state.error = "Request cancelled. No recovery data was written.";
    this.render();
  }

  render(container?: HTMLElement): void {
    const target = container ?? this.container;
    if (!target) return;
    const focused = target.ownerDocument?.activeElement as HTMLElement | null;
    const focusKey = focused?.getAttribute("data-recovery-focus");
    this.container = target;
    target.empty();
    target.addClass("llmwiki-ask-mate-recovery");
    const heading = target.createEl("h3", { text: "Project recovery preview" });
    heading.setAttr("id", "llmwiki-recovery-title");
    const status = target.createEl("p", { cls: "llmwiki-ask-mate-status" });
    status.setAttr("role", this.#state.error ? "alert" : "status");
    if (!this.#state.error) status.setAttr("aria-live", "polite");
    status.setAttr("data-recovery-focus", "status");
    status.setAttr("tabindex", "-1");
    status.setText(this.#state.busy ? "Working…" : this.#state.error ?? this.#state.flow?.stage ?? "Ready");
    if (this.#state.error) status.addClass("llmwiki-control-plane-error");

    const progress = target.createEl("ol", { cls: "llmwiki-recovery-stages", attr: { "aria-label": "Recovery Flow stages" } });
    for (const stage of STAGES) {
      const item = progress.createEl("li", { text: stage, cls: stage === this.#state.flow?.stage ? "is-current" : undefined });
      item.setAttr("aria-current", stage === this.#state.flow?.stage ? "step" : "false");
    }
    if (this.#state.busy && !this.#busyMutation) {
      const cancel = target.createEl("button", { text: "Cancel" });
      cancel.onclick = () => this.cancel();
    }
    const flow = this.#state.flow;
    if (!flow) {
      if (this.#state.applyResponse) this.renderApplyResponse(target, this.#state.applyResponse);
      if (this.#focusTarget || focusKey) {
        let focusedTarget = false;
        for (const element of target.querySelectorAll<HTMLElement>("[data-recovery-focus]")) {
          if (element.getAttribute("data-recovery-focus") === (this.#focusTarget ?? focusKey)) {
            element.focus();
            focusedTarget = true;
            break;
          }
        }
        if (focusedTarget || !this.#focusTarget) this.#focusTarget = null;
      }
      return;
    }
    this.renderFlowFacts(target, flow);
    switch (flow.stage) {
      case "open": this.renderOpen(target, flow.payload); break;
      case "searched": this.renderSearched(target, flow.payload); break;
      case "needs-agent-selection": this.renderBindingSelection(target, flow.payload); break;
      case "planned": this.renderPlanned(target, flow.payload.plan, flow.payload.candidates); break;
      case "stale": this.renderStale(target, flow.payload); break;
      case "unavailable": this.renderUnavailable(target, flow.payload.reason, flow.payload.remediation); break;
    }
    if (this.#state.applyResponse) this.renderApplyResponse(target, this.#state.applyResponse);
    this.renderDiagnostics(target, flow);
    if (this.#focusTarget || focusKey) {
      let focusedTarget = false;
      for (const element of target.querySelectorAll<HTMLElement>("[data-recovery-focus]")) {
        if (element.getAttribute("data-recovery-focus") === (this.#focusTarget ?? focusKey)) {
          element.focus();
          focusedTarget = true;
          break;
        }
      }
      if (focusedTarget || !this.#focusTarget) this.#focusTarget = null;
    }
  }

  dispose(): void {
    this.#generation += 1;
    this.#disposed = true;
    this.#applyBlocked = false;
    this.#state = this.emptyState(this.#state.projectId);
  }

  private async execute(
    operation: () => Promise<RecoveryFlowResponseV2>,
    beforeRender?: (response: RecoveryFlowResponseV2) => void,
  ): Promise<void> {
    const generation = ++this.#generation;
    this.#state.busy = true;
    this.#state.error = null;
    this.render();
    try {
      const response = await operation();
      if (this.#disposed || generation !== this.#generation) return;
      beforeRender?.(response);
      this.#state.flow = response;
    } catch (error) {
      if (this.#disposed || generation !== this.#generation) return;
      this.#state.error = safePresentationText(error instanceof Error ? error.message : error);
      this.#focusTarget = "status";
    } finally {
      if (!this.#disposed && generation === this.#generation) {
        this.#state.busy = false;
        this.render();
      }
    }
  }

  private async executeApply(operation: () => Promise<RecoveryApplyResponseV2>, plan: RecoveryPlanV2): Promise<RecoveryApplyResponseV2 | null> {
    const generation = ++this.#generation;
    this.#busyMutation = true;
    this.#state.busy = true;
    this.#state.error = null;
    this.render();
    try {
      const response = validateRecoveryApplyResponse(await operation(), plan);
      if (this.#disposed || generation !== this.#generation) return null;
      if (response.state === "outcome-unknown") this.#applyBlocked = true;
      this.#state.applyResponse = response;
      this.#focusTarget = "apply-status";
      return response;
    } catch (error) {
      if (!this.#disposed && generation === this.#generation) {
        this.#state.error = safePresentationText(error instanceof Error ? error.message : error);
        this.#state.applyResponse = null;
        this.#focusTarget = "status";
      }
      return null;
    } finally {
      if (!this.#disposed && generation === this.#generation) {
        this.#state.busy = false;
        this.render();
      }
      if (generation === this.#generation) this.#busyMutation = false;
    }
  }

  private fail(message: string): void {
    this.#state.error = message;
    this.render();
  }

  private emptyState(projectId: RecoveryProjectId): RecoveryPanelState {
    return {
      projectId,
      flow: null,
      query: "",
      selectedCandidateId: null,
      selectedBinding: null,
      applyResponse: null,
      confirming: false,
      busy: false,
      error: null,
    };
  }

  private isClosedRecommendation(flow: RecoveryFlowResponseV2 | null): flow is Extract<RecoveryFlowResponseV2, { stage: "searched" }> {
    if (!flow || flow.stage !== "searched" || !flow.payload.recommendedCandidateId || flow.payload.bindings?.length !== 1) return false;
    return flow.nextRequests.some(request => request.action === "plan"
      && request.mode === "from-search"
      && request.candidateId === flow.payload.recommendedCandidateId);
  }

  private renderFlowFacts(container: HTMLElement, flow: RecoveryFlowResponseV2): void {
    const section = this.section(container, "Flow facts");
    this.fact(section, "Project", flow.projectId);
    this.fact(section, "Flow fingerprint", flow.flowFingerprint);
    this.fact(section, "Generated", flow.generatedAt);
    this.fact(section, "Owner locks", `${flow.ownerLocks.length} observed`);
    this.renderCitations(section, flow.payload && "citations" in flow.payload ? flow.payload.citations : []);
  }

  private renderOpen(container: HTMLElement, payload: RecoveryOpenPayloadV2): void {
    const section = this.section(container, "Current work and context");
    section.firstElementChild?.setAttribute("id", "llmwiki-recovery-open-stage");
    section.firstElementChild?.setAttribute("data-recovery-focus", "open-stage");
    this.fact(section, "Work item", payload.workItemId ?? "None identified");
    this.fact(section, "Work run", payload.workRunId ?? "None identified");
    this.fact(section, "Context source", payload.contextSource);
    if (payload.currentStage) this.fact(section, "Current stage", `${payload.currentStage.value ?? "unset"} · ${payload.currentStage.state}`);
    for (const [label, items] of Object.entries(payload.workGroups ?? {})) {
      const group = section.createEl("section");
      group.createEl("h4", { text: label });
      for (const item of items.slice(0, 25)) {
        group.createEl("p", { text: `${safePresentationText(item.label)} · ${safePresentationText(item.state)}` });
        this.renderCitations(group, item.citationTargets);
      }
    }
    if (payload.context) {
      this.fact(section, "Prerequisites", payload.context.prerequisites.join(", ") || "None recorded");
      for (const decision of payload.context.decisions.slice(0, 25)) this.fact(section, `Decision ${decision.decisionId}`, decision.text);
      for (const checkpoint of payload.context.checkpoints.slice(0, 25)) this.fact(section, `Checkpoint ${checkpoint.checkpointId}`, `${checkpoint.stage} · ${checkpoint.status} · ${checkpoint.summary}`);
    }
    this.renderCitations(section, payload.context?.citations ?? []);
    const querySection = this.section(container, "Suggested queries");
    for (const query of (payload.suggestedQueries ?? []).slice(0, 16)) querySection.createEl("button", { text: safePresentationText(query) }).onclick = () => void this.search(query);
    if (!(payload.suggestedQueries ?? []).length) querySection.createEl("p", { text: "No suggested query was supplied; enter a focused query below." });
    this.renderSearchBox(container);
  }

  private renderSearched(container: HTMLElement, payload: RecoverySearchedPayloadV2): void {
    this.renderSearchBox(container);
    const section = this.section(container, "Search results and candidates");
    this.fact(section, "Query", payload.query);
    this.fact(section, "Results", `${payload.results.length} shown of bounded search`);
    for (const result of payload.results.slice(0, 25)) {
      const item = section.createEl("article", { cls: "llmwiki-recovery-result" });
      item.createEl("h4", { text: safePresentationText(result.label) });
      item.createEl("p", { text: `${safePresentationText(result.owner)} · ${safePresentationText(result.matchClass)} · ${result.score}` });
      this.renderCitations(item, result.citationTargets);
    }
    const candidates = payload.candidates ?? [];
    this.renderCandidates(section, candidates, payload.bindings ?? []);
    if (this.isClosedRecommendation(this.#state.flow)) {
      section.createEl("button", { text: "Follow server-recommended recovery", cls: "mod-cta" }).onclick = () => void this.followRecommended();
    }
    if (!payload.results.length && !candidates.length) section.createEl("p", { text: "No cited candidate is available; recovery cannot be planned from this search." });
  }

  private renderBindingSelection(container: HTMLElement, payload: Extract<RecoveryFlowResponseV2, { stage: "needs-agent-selection" }>['payload']): void {
    const section = this.section(container, "Choose a Project Agent Binding");
    section.createEl("p", { text: "Multiple compatible Bindings are available. Choose one explicitly before previewing a Plan." });
    for (const binding of payload.bindings) {
      const row = section.createEl("label");
      const input = row.createEl("input", { type: "radio" });
      input.name = "llmwiki-recovery-binding";
      input.checked = this.#state.selectedBinding?.bindingId === binding.bindingId && this.#state.selectedBinding.bindingRevision === binding.bindingRevision;
      input.onchange = () => {
        this.#state.selectedBinding = { bindingId: binding.bindingId, bindingRevision: binding.bindingRevision };
        this.render();
      };
      row.createSpan({ text: `${safePresentationText(binding.bindingId)} · revision ${binding.bindingRevision}` });
    }
    for (const candidateId of payload.candidates.slice(0, 16)) {
      const button = section.createEl("button", { text: `Preview ${safePresentationText(candidateId)}` });
      button.disabled = !this.#state.selectedBinding || this.#state.busy;
      button.onclick = () => void this.plan(candidateId, this.#state.selectedBinding!.bindingId, this.#state.selectedBinding!.bindingRevision);
    }
  }

  private renderCandidates(section: HTMLElement, candidates: RecoveryCandidateV2[], bindings: Array<{ bindingId: string; bindingRevision: number }>): void {
    if (!candidates.length) return;
    const list = section.createEl("ul", { cls: "llmwiki-recovery-candidates" });
    for (const candidate of candidates.slice(0, 16)) {
      const row = list.createEl("li");
      row.createEl("strong", { text: safePresentationText(candidate.candidateId) });
      row.createSpan({ text: ` · ${safePresentationText(candidate.kind)} · ${safePresentationText(candidate.workItemId)}` });
      if (candidate.recommended) row.createEl("small", { text: " · recommended" });
      if (bindings.length === 1) {
        const button = row.createEl("button", { text: "Preview Plan" });
        button.disabled = this.#state.busy;
        button.onclick = () => void this.plan(candidate.candidateId, bindings[0]!.bindingId, bindings[0]!.bindingRevision);
      }
    }
  }

  private renderPlanned(container: HTMLElement, plan: RecoveryPlanV2, candidates: string[]): void {
    const section = this.section(container, "Immutable Recovery Plan");
    section.addClass("llmwiki-ask-mate-plan");
    this.fact(section, "Candidate", plan.candidateId);
    this.fact(section, "Work item", plan.workItemId);
    this.fact(section, "Work run", plan.workRunId ?? "New run");
    this.fact(section, "Binding", `${plan.agentSelection.bindingId} · revision ${plan.agentSelection.bindingRevision}`);
    this.fact(section, "Profile", `${plan.agentSelection.profileId} · revision ${plan.agentSelection.profileRevision}`);
    this.fact(section, "Created", plan.createdAt);
    this.fact(section, "Expires", plan.expiresAt);
    this.fact(section, "Root open fingerprint", plan.rootOpenFlowFingerprint);
    this.fact(section, "Searched basis fingerprint", plan.searchedBasisFlowFingerprint);
    this.fact(section, "Recovery fingerprint", plan.recoveryFingerprint);
    this.fact(section, "Search input fingerprint", plan.searchInputFingerprint);
    this.fact(section, "Search fingerprint", plan.searchFingerprint);
    this.fact(section, "Candidate set fingerprint", plan.candidateSetFingerprint);
    this.fact(section, "Plan fingerprint", plan.fingerprint);
    this.fact(section, "Apply boundary", plan.owningOperation);
    this.fact(section, "Owner locks", `${plan.ownerLocks.length} bound owner revisions`);
    for (const capability of plan.capabilityFacts.slice(0, 16)) this.fact(section, `Capability ${capability.capability}`, capability.state);
    this.renderCitations(section, plan.citationTargets);
    const expiry = Date.parse(plan.expiresAt);
    const planExpired = !Number.isFinite(expiry) || expiry <= Date.now();
    if (planExpired) {
      const expired = section.createEl("p", { cls: "llmwiki-recovery-expired", text: "This Plan is expired or has an invalid expiry. Refresh Plan explicitly to obtain a new Plan." });
      expired.setAttr("role", "alert");
    }
    const alternatives = candidates.filter(candidate => candidate !== plan.candidateId);
    if (alternatives.length) {
      const choices = this.section(section, "Replace candidate");
      choices.createEl("p", { text: "Candidate replacement submits the complete prior Plan and replaces it with the server response." });
      for (const candidate of alternatives.slice(0, 16)) {
        const request = this.#state.flow?.stage === "planned"
          ? this.#state.flow.nextRequests.find(item => item.action === "plan" && item.mode === "override" && item.candidateId === candidate)
          : undefined;
        const button = choices.createEl("button", { text: `Use ${safePresentationText(candidate)}` });
        button.disabled = !request || this.#state.busy || planExpired;
        button.onclick = () => request && request.action === "plan" && void this.execute(() => this.client.plan(request), response => {
          if (response.stage !== "planned") return;
          this.#state.selectedCandidateId = response.payload.plan.candidateId;
          this.#state.selectedBinding = {
            bindingId: response.payload.plan.agentSelection.bindingId,
            bindingRevision: response.payload.plan.agentSelection.bindingRevision,
          };
        });
      }
    }
    const unknown = this.#applyBlocked || this.#state.applyResponse?.state === "outcome-unknown";
    const refresh = section.createEl("button", { text: "Refresh Plan" });
    refresh.disabled = this.#state.busy || unknown;
    refresh.onclick = () => void this.refreshPlan();
    const confirm = section.createEl("button", { text: "Confirm exact Plan", cls: "mod-cta" });
    confirm.disabled = this.#state.busy || unknown || planExpired;
    confirm.setAttr("data-recovery-focus", "confirm-plan");
    confirm.onclick = () => this.beginConfirmation();
    if (this.#state.confirming) {
      const confirmation = section.createEl("div", {
        cls: "llmwiki-recovery-confirmation",
        attr: { role: "group", "aria-labelledby": "llmwiki-recovery-confirmation-title" },
      });
      confirmation.createEl("h4", { text: "Confirm exact Plan" }).setAttr("id", "llmwiki-recovery-confirmation-title");
      confirmation.createEl("p", { text: `Apply the currently visible Plan ${safePresentationText(plan.fingerprint)} for ${safePresentationText(plan.projectId)}?` });
      confirmation.createEl("p", { text: "This is the only mutation step. Cancel performs no Workflow request." });
      const apply = confirmation.createEl("button", { text: "Confirm and apply", cls: "mod-cta" });
      apply.disabled = this.#state.busy || unknown;
      apply.setAttr("data-recovery-focus", "confirm-apply");
      apply.onclick = () => void this.apply();
      const cancel = confirmation.createEl("button", { text: "Cancel" });
      cancel.disabled = this.#state.busy;
      cancel.setAttr("data-recovery-focus", "cancel-confirmation");
      cancel.onclick = () => this.cancelConfirmation();
    }
  }

  private renderApplyResponse(container: HTMLElement, response: RecoveryApplyResponseV2): void {
    const section = this.section(container, "Recovery apply result");
    const status = section.createEl("p", { text: `Apply state: ${safePresentationText(response.state)}` });
    status.setAttr("role", response.state === "outcome-unknown" || response.state === "unavailable" ? "alert" : "status");
    if (response.state !== "outcome-unknown" && response.state !== "unavailable") status.setAttr("aria-live", "polite");
    status.setAttr("id", "llmwiki-recovery-apply-status");
    status.setAttr("data-recovery-focus", "apply-status");
    status.setAttr("tabindex", "-1");
    this.fact(section, "Applied Plan fingerprint", response.planFingerprint);
    this.fact(section, "Token digest", response.tokenDigest);
    for (const diagnostic of response.diagnostics) section.createEl("p", { text: safePresentationText(diagnostic) });
    if (response.receipt) {
      this.fact(section, "Owner operation", response.receipt.ownerOperation);
      this.fact(section, "Receipt fingerprint", response.receipt.fingerprint);
      const receipt = this.section(section, "Sanitized owner receipt");
      const owner = response.receipt.ownerReceipt;
      for (const key of ["ok", "idempotent", "projectId", "workItemId", "workRunId", "agent"] as const) {
        if (owner[key] !== undefined) this.fact(receipt, key, safeReceiptPresentation(owner[key]));
      }
      if (owner.lifetime && typeof owner.lifetime === "object" && !Array.isArray(owner.lifetime)) {
        for (const key of ["projectId", "workItemId", "workRunId", "agent", "workRunState", "stage", "status"] as const) {
          const value = (owner.lifetime as Record<string, unknown>)[key];
          if (value !== undefined) this.fact(receipt, `lifetime ${key}`, safeReceiptPresentation(value));
        }
      }
    }
    if (response.state === "outcome-unknown") {
      const remediation = section.createEl("p", {
        cls: "llmwiki-recovery-remediation",
        text: "Workflow outcome is unknown; apply and replay are disabled. Run Workflow doctor to reconcile the owner before any retry.",
      });
      remediation.setAttr("role", "alert");
    }
  }

  private renderStale(container: HTMLElement, proof: RecoveryStaleProofV2): void {
    const section = this.section(container, "Flow is stale");
    section.firstElementChild?.setAttribute("data-recovery-focus", "stale-stage");
    section.createEl("p", { text: "A recovery owner changed. Restart explicitly to recompute from the current Project." });
    this.fact(section, "Changed owners", proof.changedOwners.join(", "));
    this.renderCitations(section, proof.citationTargets);
    const restart = section.createEl("button", { text: "Restart Flow", cls: "mod-cta" });
    restart.disabled = this.#state.busy;
    restart.onclick = () => void this.restart();
  }

  private renderUnavailable(container: HTMLElement, reason: string, remediation: string): void {
    const section = this.section(container, "Recovery unavailable");
    section.createEl("p", { text: safePresentationText(reason) });
    const action = section.createEl("p", { cls: "llmwiki-recovery-remediation" });
    action.setAttr("role", "alert");
    action.setText(`Remediation: ${safePresentationText(remediation)}`);
  }

  private renderSearchBox(container: HTMLElement): void {
    const section = this.section(container, "Search Project context");
    const label = section.createEl("label");
    label.createSpan({ text: "Query" });
    const input = label.createEl("input", { type: "search" });
    input.value = this.#state.query;
    input.placeholder = "Search cited Project context";
    input.setAttr("aria-label", "Search cited Project context");
    input.setAttr("data-recovery-focus", "query");
    input.onkeydown = event => {
      if (event.key === "Enter") void this.search(input.value);
    };
    const button = section.createEl("button", { text: "Search" });
    button.disabled = this.#state.busy || !input.value.trim();
    input.oninput = () => {
      this.#state.query = input.value;
      button.disabled = this.#state.busy || !input.value.trim();
    };
    button.onclick = () => void this.search(input.value);
  }

  private renderDiagnostics(container: HTMLElement, flow: RecoveryFlowResponseV2): void {
    if (flow.diagnostics.length) {
      const section = this.section(container, "Diagnostics and remediation");
      for (const diagnostic of flow.diagnostics.slice(0, 32)) {
        const item = section.createEl("p", { cls: diagnostic.severity === "error" ? "llmwiki-control-plane-error" : "llmwiki-proposal-warnings" });
        item.setText(`${safePresentationText(diagnostic.message)} Remediation: ${safePresentationText(diagnostic.remediation)}`);
        this.renderCitations(section, diagnostic.citationTargets);
      }
    }
    if (flow.omitted.items || flow.omitted.citations || flow.omitted.diagnostics || flow.omitted.bytes) {
      const omissions = this.section(container, "Bounded omissions");
      omissions.createEl("p", { text: `Items ${flow.omitted.items} · citations ${flow.omitted.citations} · diagnostics ${flow.omitted.diagnostics} · bytes ${flow.omitted.bytes}` });
    }
  }

  private section(parent: HTMLElement, title: string): HTMLElement {
    const section = parent.createEl("section", { cls: "llmwiki-ask-mate-panel" });
    section.createEl("h3", { text: title });
    return section;
  }

  private fact(parent: HTMLElement, label: string, value: unknown): void {
    const row = parent.createEl("p", { cls: "llmwiki-recovery-fact" });
    row.createEl("strong", { text: `${label}: ` });
    row.createSpan({ text: safePresentationText(value) });
  }

  private renderCitations(parent: HTMLElement, citations: string[]): void {
    if (!citations.length) return;
    const section = parent.createEl("section", { cls: "llmwiki-ask-mate-citations" });
    section.createEl("h4", { text: "Citation Targets" });
    for (const target of [...new Set(citations)].slice(0, 32)) {
      const button = section.createEl("button", { text: safePresentationText(target), cls: "llmwiki-ask-mate-citation-action" });
      button.setAttr("aria-label", `Open citation target ${safePresentationText(target)}`);
      button.onclick = () => this.onCitation?.(target);
    }
  }
}
