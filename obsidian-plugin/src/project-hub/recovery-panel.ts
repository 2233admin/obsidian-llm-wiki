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
import {
  ProjectHubRecoveryClient,
  RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
  type RecoveryPlanRequestV2,
  type RecoveryProjectId,
} from "./recovery-client";

const SEARCH_LIMIT = 25;
const STAGES = ["open", "searched", "needs-agent-selection", "planned", "stale", "unavailable"] as const;

export interface RecoveryPanelState {
  projectId: RecoveryProjectId;
  flow: RecoveryFlowResponseV2 | null;
  query: string;
  selectedCandidateId: string | null;
  selectedBinding: RecoveryAgentSelectionV2 | null;
  busy: boolean;
  error: string | null;
}

type CitationHandler = (target: string) => void;

/** Ephemeral Ask Mate presentation for the read-only Recovery Flow. */
export class ProjectHubRecoveryPanel {
  #state: RecoveryPanelState;
  #generation = 0;
  #disposed = false;

  constructor(
    private readonly client: ProjectHubRecoveryClient,
    private container: HTMLElement | null = null,
    private readonly onCitation?: CitationHandler,
  ) {
    this.#state = this.emptyState("project/unknown");
  }

  get state(): RecoveryPanelState {
    return this.#state;
  }

  async open(projectId: RecoveryProjectId): Promise<void> {
    this.#disposed = false;
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
    const request = flow.nextRequests.find(item => item.action === "refresh-plan");
    if (!request) {
      this.fail("The server did not provide an exact Plan refresh request.");
      return;
    }
    await this.execute(() => this.client.refreshPlan(request));
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
    if (!this.#state.busy) return;
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
    status.setAttr("aria-live", this.#state.error ? "assertive" : "polite");
    status.setText(this.#state.busy ? "Working…" : this.#state.error ?? this.#state.flow?.stage ?? "Ready");
    if (this.#state.error) status.addClass("llmwiki-control-plane-error");

    const progress = target.createEl("ol", { cls: "llmwiki-recovery-stages", attr: { "aria-label": "Recovery Flow stages" } });
    for (const stage of STAGES) {
      const item = progress.createEl("li", { text: stage, cls: stage === this.#state.flow?.stage ? "is-current" : undefined });
      item.setAttr("aria-current", stage === this.#state.flow?.stage ? "step" : "false");
    }
    if (this.#state.busy) {
      const cancel = target.createEl("button", { text: "Cancel" });
      cancel.onclick = () => this.cancel();
    }
    const flow = this.#state.flow;
    if (!flow) return;
    this.renderFlowFacts(target, flow);
    switch (flow.stage) {
      case "open": this.renderOpen(target, flow.payload); break;
      case "searched": this.renderSearched(target, flow.payload); break;
      case "needs-agent-selection": this.renderBindingSelection(target, flow.payload); break;
      case "planned": this.renderPlanned(target, flow.payload.plan, flow.payload.candidates); break;
      case "stale": this.renderStale(target, flow.payload); break;
      case "unavailable": this.renderUnavailable(target, flow.payload.reason, flow.payload.remediation); break;
    }
    this.renderDiagnostics(target, flow);
    if (focusKey) {
      for (const element of target.querySelectorAll<HTMLElement>("[data-recovery-focus]")) {
        if (element.getAttribute("data-recovery-focus") === focusKey) {
          element.focus();
          break;
        }
      }
    }
  }

  dispose(): void {
    this.#generation += 1;
    this.#disposed = true;
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
    } finally {
      if (!this.#disposed && generation === this.#generation) {
        this.#state.busy = false;
        this.render();
      }
    }
  }

  private fail(message: string): void {
    this.#state.error = message;
    this.render();
  }

  private emptyState(projectId: RecoveryProjectId): RecoveryPanelState {
    return { projectId, flow: null, query: "", selectedCandidateId: null, selectedBinding: null, busy: false, error: null };
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
    this.fact(section, "Plan fingerprint", plan.fingerprint);
    this.fact(section, "Apply boundary", plan.owningOperation);
    this.fact(section, "Owner locks", `${plan.ownerLocks.length} bound owner revisions`);
    for (const capability of plan.capabilityFacts.slice(0, 16)) this.fact(section, `Capability ${capability.capability}`, capability.state);
    this.renderCitations(section, plan.citationTargets);
    if (Date.parse(plan.expiresAt) <= Date.now()) {
      const expired = section.createEl("p", { cls: "llmwiki-recovery-expired", text: "This Plan is expired. Refresh Plan explicitly to obtain a new Plan." });
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
        button.disabled = !request || this.#state.busy || Date.parse(plan.expiresAt) <= Date.now();
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
    const refresh = section.createEl("button", { text: "Refresh Plan" });
    refresh.disabled = this.#state.busy;
    refresh.onclick = () => void this.refreshPlan();
    section.createEl("p", { text: "S06A is preview-only. No apply or success receipt is available here." });
  }

  private renderStale(container: HTMLElement, proof: RecoveryStaleProofV2): void {
    const section = this.section(container, "Flow is stale");
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
