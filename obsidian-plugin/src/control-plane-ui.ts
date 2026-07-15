import { App, Modal, Notice } from "obsidian";
import {
  AgentControlPlaneClient,
  AgentControlPlaneProjection,
  AgentProfileCreate,
  AgentProfileId,
  ArtifactProjection,
  ConsultExecutionRequest,
  ConsultProjection,
  DelegationPlanProjection,
  DreamTimeProposalProjection,
  HostAuthorizationSnapshot,
  HostAssignmentPlanResponse,
  HostCapabilityDescriptionResponse,
  HostCapabilitySearchResult,
  ProjectAgentBindingCreate,
  ProjectId,
  projectHostCapabilityRows,
  refreshAgentControlPlaneProjection,
  safePresentationText,
  safeSummary,
  validatedHostAuthorizationSnapshot,
} from "./control-plane-client";

const ACTOR = "obsidian-control-plane";

export interface AgentControlPlaneHost {
  client: AgentControlPlaneClient;
  defaultProjectId?: string;
}

interface ControlQuery {
  project: string;
  profileId: string;
  threadId: string;
  proposalId: string;
  delegationId: string;
  bindingId: string;
  grantId: string;
}

interface HostFlowState {
  searchQuery: string;
  searchResults: HostCapabilitySearchResult[];
  description: HostCapabilityDescriptionResponse | null;
  plan: HostAssignmentPlanResponse | null;
  invocation: unknown;
  requirementJson: string;
  policyJson: string;
  inputJson: string;
  operation: string;
}

export class AgentControlPlaneModal extends Modal {
  private query: ControlQuery;
  private projection: AgentControlPlaneProjection | null = null;
  private consult: ConsultProjection | null = null;
  private error: string | null = null;
  private loading = false;
  private hostAuthorizationSnapshot: HostAuthorizationSnapshot | null = null;
  private hostFlow: HostFlowState = {
    searchQuery: "",
    searchResults: [],
    description: null,
    plan: null,
    invocation: null,
    requirementJson: JSON.stringify({
      schemaVersion: "1.0.0",
      requirementId: "requirement/obsidian-host",
      projectId: "",
      workRunId: "work-run/",
      capabilities: [],
      operations: [],
    }, null, 2),
    policyJson: JSON.stringify({
      schemaVersion: "1.0.0",
      policyId: "policy/obsidian-host",
      policyVersion: "1.0.0",
      allowedSideEffectClasses: ["none", "local-read", "external-read"],
      allowDegradedHealth: false,
      allowUnknownCost: false,
    }, null, 2),
    inputJson: "{}",
    operation: "",
  };

  constructor(app: App, private readonly host: AgentControlPlaneHost) {
    super(app);
    this.query = {
      project: host.defaultProjectId ?? "",
      profileId: "",
      threadId: "",
      proposalId: "",
      delegationId: "",
      bindingId: "",
      grantId: "",
    };
  }

  onOpen(): void {
    this.modalEl.addClass("llmwiki-control-plane-modal");
    this.render();
    if (this.query.project) void this.refresh();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Agent control plane" });
    contentEl.createEl("p", {
      cls: "llmwiki-control-plane-intro",
      text: "Backend-owned Project, Agent, Room, Dream Time, collaboration, connector, and Usage projections. This surface keeps no approval ledger.",
    });
    this.renderQuery(contentEl);
    if (this.error) contentEl.createEl("p", { cls: "llmwiki-control-plane-error", text: this.error });
    if (this.loading) {
      contentEl.createEl("p", { text: "Refreshing backend projections…" });
      return;
    }
    if (!this.projection) {
      contentEl.createEl("p", { cls: "llmwiki-control-plane-empty", text: "Enter a canonical Project ID and refresh." });
      return;
    }
    this.renderDiagnostics(contentEl);
    this.renderProfilesAndBindings(contentEl);
    this.renderRoomAndThreads(contentEl);
    this.renderDreamTime(contentEl);
    this.renderCollaboration(contentEl);
    this.renderCapabilitiesAndUsage(contentEl);
  }

  private renderQuery(container: HTMLElement): void {
    const grid = container.createDiv({ cls: "llmwiki-control-query" });
    this.textField(grid, "Project", "project/example", this.query.project, value => { this.updateHostScopeQuery("project", value); });
    this.textField(grid, "Agent", "agent/reviewer", this.query.profileId, value => { this.query.profileId = value; });
    this.textField(grid, "Thread", "thread/… (optional)", this.query.threadId, value => { this.query.threadId = value; });
    this.textField(grid, "Proposal", "memory-proposal/… (optional)", this.query.proposalId, value => { this.query.proposalId = value; });
    this.textField(grid, "Delegation", "delegation/… (optional)", this.query.delegationId, value => { this.query.delegationId = value; });
    this.textField(grid, "Host Binding", "binding/project/agent", this.query.bindingId, value => { this.updateHostScopeQuery("bindingId", value); });
    this.textField(grid, "Host Grant", "grant/child-…", this.query.grantId, value => { this.updateHostScopeQuery("grantId", value); });
    const refresh = grid.createEl("button", { text: "Refresh", cls: "mod-cta" });
    refresh.disabled = this.loading;
    refresh.onclick = () => void this.refresh();
  }

  private async refresh(): Promise<void> {
    const project = this.query.project.trim();
    if (!project.startsWith("project/")) {
      this.error = "Project must use the canonical project/<slug> form.";
      this.render();
      return;
    }
    this.loading = true;
    this.error = null;
    this.invalidateHostWorkflow();
    this.render();
    try {
      const hostAuthorization = this.hostAuthorization(true);
      const projection = await refreshAgentControlPlaneProjection(this.host.client, {
        project: project as ProjectId,
        ...(this.query.profileId.trim() ? { profileId: this.query.profileId.trim() as AgentProfileId } : {}),
        ...(this.query.threadId.trim() ? { threadId: this.query.threadId.trim() as `thread/${string}` } : {}),
        ...(this.query.proposalId.trim() ? { proposalId: this.query.proposalId.trim() as `memory-proposal/${string}` } : {}),
        ...(this.query.delegationId.trim() ? { delegationId: this.query.delegationId.trim() } : {}),
        ...(hostAuthorization ? { hostAuthorization } : {}),
      });
      if (!this.matchesHostScopeQuery(project, hostAuthorization)) {
        this.error = "Host Project, Binding, or Grant changed while refreshing; refresh again.";
        return;
      }
      this.projection = projection;
      this.adoptSingleBackendAuthorization(projection);
      this.hostAuthorizationSnapshot = validatedHostAuthorizationSnapshot(
        project as ProjectId,
        hostAuthorization,
        projection.host,
      );
      if (hostAuthorization && projection.host && !this.hostAuthorizationSnapshot) {
        this.error = "Host authorization refresh returned a mismatched Project, Binding, or Grant projection.";
      }
    } catch (error) {
      this.error = safePresentationText((error as Error)?.message ?? error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private renderDiagnostics(container: HTMLElement): void {
    const projection = this.projection!;
    const section = this.section(container, "Diagnostics", `Refreshed ${projection.refreshedAt}`);
    if (!projection.diagnostics.length) {
      section.createEl("p", { text: "All requested backend projections responded." });
      return;
    }
    for (const item of projection.diagnostics) {
      const row = section.createDiv({ cls: `llmwiki-diagnostic llmwiki-diagnostic-${item.severity}` });
      row.createEl("strong", { text: item.code });
      row.createEl("span", { text: safePresentationText(item.message ?? item.remediationKey ?? "No detail") });
    }
  }

  private renderProfilesAndBindings(container: HTMLElement): void {
    const projection = this.projection!;
    const section = this.section(container, "Profiles and Project bindings", "Versioned backend records; model credentials remain Secret References in Settings.");
    const actions = section.createDiv({ cls: "llmwiki-control-actions" });
    actions.createEl("button", { text: "Create Agent Profile" }).onclick = () => {
      new AgentProfileEditorModal(this.app, this.host.client, () => this.refresh()).open();
    };
    actions.createEl("button", { text: "Create Project Binding" }).onclick = () => {
      new ProjectBindingEditorModal(this.app, this.host.client, this.query.project, this.query.profileId, () => this.refresh()).open();
    };
    const grid = section.createDiv({ cls: "llmwiki-control-grid" });
    const profiles = this.card(grid, `Profiles (${projection.profiles.length})`);
    for (const profile of projection.profiles) {
      const row = profiles.createDiv({ cls: "llmwiki-control-record" });
      row.createEl("strong", { text: profile.displayName });
      row.createEl("code", { text: `${profile.profileId} · r${profile.revision}` });
      row.createEl("small", { text: `${profile.role} · model ${profile.defaultModelPolicy.mode}` });
    }
    const bindings = this.card(grid, `Bindings (${projection.bindings.length})`);
    for (const binding of projection.bindings) {
      const row = bindings.createDiv({ cls: "llmwiki-control-record" });
      row.createEl("strong", { text: binding.role });
      row.createEl("code", { text: `${binding.bindingId} · r${binding.revision}` });
      row.createEl("small", { text: `${binding.enabled ? "enabled" : "disabled"} · profile r${binding.profileRevision} · ${binding.memoryScopes.join(", ")}` });
    }
  }

  private renderRoomAndThreads(container: HTMLElement): void {
    const projection = this.projection!;
    const section = this.section(container, "Room and Threads", "Read-only canonical identities; Room is derived, not an independent project store.");
    const room = projection.room;
    if (room) {
      const grid = section.createDiv({ cls: "llmwiki-control-grid" });
      const identity = this.card(grid, "Room identity");
      this.fact(identity, "Project", room.identity.projectId);
      this.fact(identity, "Agent", `${room.identity.profileId} · r${room.identity.profileRevision}`);
      this.fact(identity, "Binding", `${room.identity.bindingId} · r${room.identity.bindingRevision}`);
      this.fact(identity, "Thread", `${room.identity.threadId} · r${room.identity.threadRevision}`);
      this.fact(identity, "Lifecycle", room.lifecycle);
      const runtime = this.card(grid, "Runtime and memory");
      this.fact(runtime, "Work Runs", room.relatedWorkRunIds.join(", ") || "none");
      this.fact(runtime, "Memory", room.approvedMemory
        ? `${room.approvedMemory.revisionId} · r${room.approvedMemory.revision} · ${room.approvedMemory.fingerprint}`
        : "no approved revision");
      const connectors = this.card(grid, "Connector diagnostics");
      for (const connector of room.connectorSummaries) {
        this.fact(connectors, connector.connectorId, `${connector.status}${connector.grantRef ? ` · ${connector.grantRef}` : ""}${connector.remediationKey ? ` · ${connector.remediationKey}` : ""}`);
      }
      for (const diagnostic of room.diagnostics) this.fact(connectors, diagnostic.code, `${diagnostic.severity}${diagnostic.remediationKey ? ` · ${diagnostic.remediationKey}` : ""}`);
    } else {
      section.createEl("p", { text: "Select an Agent to resolve its Room projection." });
    }
    const threads = this.card(section, `Threads (${projection.threads.length})`);
    for (const thread of projection.threads) {
      const row = threads.createDiv({ cls: "llmwiki-control-record" });
      row.createEl("strong", { text: thread.title });
      row.createEl("code", { text: `${thread.threadId} · r${thread.revision}` });
      row.createEl("small", { text: `${thread.lifecycle} · ${thread.references.length} ordered references` });
    }
  }

  private renderDreamTime(container: HTMLElement): void {
    const projection = this.projection!;
    const section = this.section(container, "Dream Time", "Proposal review and backend-owned approval/revision history.");
    const doctor = projection.dreamTimeDoctor;
    if (doctor) {
      this.fact(section, "Doctor", `${doctor.state} · ${doctor.diagnostics.length} diagnostics`);
      for (const summary of doctor.proposalSummaries ?? []) {
        const row = section.createDiv({ cls: "llmwiki-proposal-summary" });
        row.createEl("code", { text: summary.proposalId });
        row.createEl("span", { text: `${summary.operation} · ${summary.lifecycle} · ${summary.warningCount} warnings` });
        row.createEl("button", { text: "Inspect" }).onclick = () => {
          this.query.proposalId = summary.proposalId;
          void this.refresh();
        };
      }
    }
    if (projection.proposal) this.renderProposal(section, projection.proposal);
    const history = projection.revisionHistory;
    if (history) {
      const card = this.card(section, `Revision history (${history.revisions.length})`);
      for (const revision of [...history.revisions].reverse()) {
        const row = card.createDiv({ cls: "llmwiki-control-record" });
        row.createEl("strong", { text: `Revision ${revision.revision}` });
        row.createEl("code", { text: `${revision.revisionId} · ${revision.fingerprint}` });
        row.createEl("small", { text: `${revision.createdAt} · ${revision.exactDiff.length} exact changes` });
      }
    }
  }

  private renderProposal(container: HTMLElement, proposal: DreamTimeProposalProjection): void {
    const stale = proposal.lifecycle === "stale";
    const card = this.card(container, `Proposal · ${proposal.lifecycle}`, stale ? "llmwiki-stale" : undefined);
    this.fact(card, "Identity", `${proposal.proposalId} · ${proposal.fingerprint}`);
    this.fact(card, "Operation", proposal.operation);
    this.fact(card, "Expected memory", `${proposal.expectedRevision.revisionId ?? "none"} · r${proposal.expectedRevision.revision} · ${proposal.expectedRevision.fingerprint ?? "none"}`);
    this.fact(card, "Source lock", proposal.sourceFingerprint);
    if (stale) card.createEl("p", { cls: "llmwiki-control-plane-error", text: "This proposal is stale. Refresh and create a new proposal against the current revision." });
    const warnings = card.createDiv({ cls: "llmwiki-proposal-warnings" });
    warnings.createEl("strong", { text: `Warnings (${proposal.warnings.length})` });
    for (const warning of proposal.warnings) warnings.createEl("p", { text: `${warning.severity} · ${warning.code} · ${warning.message}` });
    const diff = card.createDiv({ cls: "llmwiki-proposal-diff" });
    diff.createEl("strong", { text: `Candidate diff (${proposal.candidateDiff.length})` });
    for (const change of proposal.candidateDiff) {
      const block = diff.createDiv({ cls: "llmwiki-proposal-change" });
      block.createEl("code", { text: `${change.operation} ${change.section} · before ${change.beforeHash ?? "empty"}` });
      block.createEl("pre", { text: change.after?.content ?? "(section removed)" });
      if (change.after?.citations.length) block.createEl("small", { text: `Citations: ${change.after.citations.join(", ")}` });
    }
    const actions = card.createDiv({ cls: "llmwiki-control-actions" });
    const approve = actions.createEl("button", { text: "Approve", cls: "mod-cta" });
    approve.disabled = proposal.lifecycle !== "proposed";
    approve.onclick = () => void this.decideProposal(proposal, "approve");
    const reject = actions.createEl("button", { text: "Reject" });
    reject.disabled = proposal.lifecycle !== "proposed";
    reject.onclick = () => void this.decideProposal(proposal, "reject");
    const handoff = actions.createEl("button", { text: "Promotion handoff" });
    handoff.onclick = () => void this.runAction(async () => {
      const result = await this.host.client.handoffPromotion({
        project: proposal.projectId,
        profileId: proposal.profileId,
        proposalId: proposal.proposalId,
        proposalFingerprint: proposal.fingerprint,
        candidateDiff: proposal.candidateDiff,
        provenance: proposal.provenance,
        actor: ACTOR,
      });
      this.notify(`LLM Wiki: Promotion handoff ${result.status} · ${result.candidateId}`);
    });
  }

  private async decideProposal(proposal: DreamTimeProposalProjection, action: "approve" | "reject"): Promise<void> {
    await this.runAction(async () => {
      const request = {
        project: proposal.projectId,
        profileId: proposal.profileId,
        proposalId: proposal.proposalId,
        presentedFingerprint: proposal.fingerprint,
        expectedRevision: proposal.expectedRevision.revision,
        actor: ACTOR,
      };
      const result = action === "approve"
        ? await this.host.client.approveDreamTime(request)
        : await this.host.client.rejectDreamTime(request);
      this.notify(`LLM Wiki: Dream Time ${result.status}${result.idempotent ? " (replay)" : ""}`);
      await this.refresh();
    });
  }

  private renderCollaboration(container: HTMLElement): void {
    const projection = this.projection!;
    const section = this.section(container, "Consult and delegation", "Consult is read-only; delegation authority is granted only by the backend approval operation.");
    this.renderConsultControls(section);
    if (this.consult) {
      const card = this.card(section, `Consult · ${this.consult.consultId}`);
      this.fact(card, "Target", `${this.consult.targetProfileId} · ${this.consult.targetRevisionId}`);
      this.fact(card, "As-of fingerprint", this.consult.targetFingerprint);
      this.fact(card, "Freshness", this.consult.stale ? "stale" : "current at execution");
      this.renderArtifact(card, this.consult.artifact);
    }
    if (projection.delegation) this.renderDelegation(section, projection.delegation);
    else section.createEl("p", { text: "Enter a Delegation Plan ID above to review capability, budget, device, side effects, child state, and artifacts." });
  }

  private renderConsultControls(container: HTMLElement): void {
    const controls = container.createDiv({ cls: "llmwiki-consult-controls" });
    controls.createEl("p", {
      text: "Consult execution consumes a workflow-prepared request, scoped Capability Grant, invocation token, and worker output. This UI never mints its own authority.",
    });
    const field = controls.createEl("label", { cls: "llmwiki-editor-field" });
    field.createEl("span", { text: "Prepared consult execution envelope (JSON)" });
    const input = field.createEl("textarea", {
      placeholder: '{"project":"project/example","request":{...},"invocationToken":"...","grant":{...},"workerOutput":{...},"inputArtifactIds":[],"actor":"obsidian-control-plane"}',
    });
    input.rows = 8;
    controls.createEl("button", { text: "Run read-only consult" }).onclick = () => void this.runAction(async () => {
      const envelope = JSON.parse(input.value) as unknown;
      if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) throw new Error("Prepared consult envelope must be a JSON object");
      this.consult = await this.host.client.executeConsult(envelope as ConsultExecutionRequest);
      this.render();
    });
  }

  private renderDelegation(container: HTMLElement, plan: DelegationPlanProjection): void {
    const card = this.card(container, `Delegation · ${plan.approval.status}`);
    this.fact(card, "Plan", `${plan.planId} · ${plan.fingerprint}`);
    this.fact(card, "Parent", plan.parentWorkRunId);
    this.fact(card, "Agent", plan.candidateProfileId);
    this.fact(card, "Objective", plan.objective);
    this.fact(card, "Capabilities", plan.capabilityScope.join(", ") || "none");
    this.fact(card, "Budget", [plan.budget.amount, plan.budget.currency, plan.budget.decision, plan.budget.policyVersion].filter(Boolean).join(" · ") || "not reported");
    this.fact(card, "Device", [plan.device?.deviceId, plan.device?.resourceClass, plan.device?.health].filter(Boolean).join(" · ") || "not assigned");
    this.fact(card, "Side effects", plan.sideEffectClasses.join(", "));
    this.fact(card, "Child", plan.child ? `${plan.child.workRunId} · ${plan.child.status}` : "not created");
    for (const artifact of plan.artifacts) this.renderArtifact(card, artifact);
    if (plan.approval.status === "pending") {
      const approve = card.createEl("button", { text: "Approve delegation", cls: "mod-cta" });
      approve.onclick = () => void this.runAction(async () => {
        const result = await this.host.client.approveDelegation({
          project: plan.projectId,
          planId: plan.planId,
          presentedFingerprint: plan.fingerprint,
          expectedRevision: plan.revision,
          approvedExternalClasses: plan.sideEffectClasses
            .filter((item): item is "external-write" | "external-delete" | "external-execute" =>
              item === "external-write" || item === "external-delete" || item === "external-execute")
            .sort(),
          actor: ACTOR,
        });
        this.notify(`LLM Wiki: Child Work Run ${result.child.workRunId}${result.idempotent ? " (replay)" : ""}`);
        await this.refresh();
      });
    }
  }

  private renderArtifact(container: HTMLElement, artifact: ArtifactProjection): void {
    const card = this.card(container, `Artifact · ${artifact.artifactId}`);
    this.fact(card, "Producer", `${artifact.producerProfileId} · ${artifact.sourceWorkRunId}`);
    this.fact(card, "Context", artifact.contextFingerprint);
    this.fact(card, "Hash", artifact.contentHash);
    this.fact(card, "Classification", `${artifact.outputClassification} · ${artifact.reviewState}`);
    this.fact(card, "Inputs", artifact.inputReferences.join(", ") || "none");
    this.fact(card, "Provenance", artifact.provenance.map(item => `${item.kind}:${item.id}${item.revision ? `@${item.revision}` : ""}`).join(", "));
  }

  private renderCapabilitiesAndUsage(container: HTMLElement): void {
    const projection = this.projection!;
    const section = this.section(container, "Connector health and Usage", "Read-only facts from Project Hub, Host Capability, and Usage backends.");
    const capabilities = projection.projectHub?.sections.capabilities;
    if (capabilities) {
      const card = this.card(section, `Capabilities · ${capabilities.health}`);
      this.fact(card, "Owner", capabilities.owner);
      this.fact(card, "Freshness", capabilities.freshness ?? "not reported");
      this.fact(card, "Drift", capabilities.drift.join(", ") || "none");
      card.createEl("pre", { text: safeSummary(capabilities.data) });
    }
    const hostCapabilities = projection.projectHub?.sections.hostCapabilities;
    if (hostCapabilities) {
      const card = this.card(section, `Host capabilities · ${hostCapabilities.health}`);
      this.fact(card, "Owner", hostCapabilities.owner);
      this.fact(card, "Freshness", hostCapabilities.freshness ?? "not reported");
      this.fact(card, "Drift", hostCapabilities.drift.join(", ") || "none");
      const rows = projectHostCapabilityRows(hostCapabilities.data);
      const experts = this.card(card, `Experts (${rows.experts.length})`);
      for (const expert of rows.experts) {
        this.fact(
          experts,
          expert.displayName,
          [
            expert.health,
            expert.id,
            expert.capabilities.join(", "),
            expert.connectorRef ? `connector ${expert.connectorRef}` : undefined,
          ].filter(Boolean).join(" · "),
        );
      }
      if (!rows.experts.length) experts.createEl("p", { text: "No expert descriptors registered." });
      const connectorCard = this.card(card, `Connectors (${rows.connectors.length})`);
      for (const connector of rows.connectors) {
        this.fact(
          connectorCard,
          connector.displayName,
          [
            connector.health,
            connector.kind,
            connector.transport,
            connector.secretReferenceConfigured === true ? "secret reference configured" : "no secret reference",
          ].filter(Boolean).join(" · "),
        );
      }
      if (!rows.connectors.length) connectorCard.createEl("p", { text: "No connectors registered." });
      const assignmentCard = this.card(card, `Assignments (${rows.assignments.length})`);
      assignmentCard.createEl("pre", { text: rows.assignments.length ? safeSummary(rows.assignments) : "No host assignment plans for this Project." });
    }
    if (projection.host) {
      const card = this.card(section, "Host project projection");
      card.createEl("pre", { text: safeSummary(projection.host) });
    }
    if (projection.hostDoctor) {
      const doctor = projection.hostDoctor;
      const card = this.card(section, `Host connector doctor · ${doctor.ok ? "healthy" : "attention required"}`);
      this.fact(card, "Descriptors", String(doctor.counts.descriptors));
      this.fact(card, "Connectors", String(doctor.counts.connectors));
      this.fact(card, "Assignments", String(doctor.counts.assignments));
      card.createEl("pre", { text: doctor.findings.length ? safeSummary(doctor.findings) : "No connector findings." });
    }
    this.renderHostWorkflow(section);
    const usage = projection.usage?.projection ?? projection.projectHub?.sections.usage?.data;
    const usageCard = this.card(section, "Usage summary");
    usageCard.createEl("pre", { text: usage ? safeSummary(usage) : "Usage projection unavailable" });
  }

  private async runAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.error = safePresentationText((error as Error)?.message ?? error);
      this.notify(`LLM Wiki: ${this.error}`);
      this.render();
    }
  }

  private hostAuthorization(requireComplete = false): { bindingId: string; grantId: string } | undefined {
    const bindingId = this.query.bindingId.trim();
    const grantId = this.query.grantId.trim();
    if (!bindingId && !grantId) return undefined;
    if (!bindingId.startsWith("binding/") || !grantId.startsWith("grant/")) {
      if (requireComplete) throw new Error("Host access requires one backend Binding ID and one server-issued Grant ID");
      return undefined;
    }
    return { bindingId, grantId };
  }

  private updateHostScopeQuery(field: "project" | "bindingId" | "grantId", value: string): void {
    if (this.query[field] === value) return;
    this.query[field] = value;
    this.invalidateHostWorkflow();
  }

  private matchesHostScopeQuery(
    project: string,
    authorization: { bindingId: string; grantId: string } | undefined,
  ): boolean {
    return this.query.project.trim() === project
      && this.query.bindingId.trim() === (authorization?.bindingId ?? "")
      && this.query.grantId.trim() === (authorization?.grantId ?? "");
  }

  private invalidateHostWorkflow(): void {
    this.hostAuthorizationSnapshot = null;
    this.hostFlow.searchResults = [];
    this.hostFlow.description = null;
    this.hostFlow.plan = null;
    this.hostFlow.invocation = null;
    this.hostFlow.operation = "";
  }

  private requireHostAuthorizationSnapshot(): HostAuthorizationSnapshot {
    const selected = this.hostAuthorization(true);
    const project = this.query.project.trim();
    const snapshot = this.hostAuthorizationSnapshot;
    if (
      !selected
      || !snapshot
      || snapshot.project !== project
      || snapshot.bindingId !== selected.bindingId
      || snapshot.grantId !== selected.grantId
    ) {
      throw new Error("Host Project, Binding, or Grant changed; refresh successfully before using Host Capability operations");
    }
    return snapshot;
  }

  private adoptSingleBackendAuthorization(projection: AgentControlPlaneProjection): void {
    if (this.query.bindingId || this.query.grantId) return;
    const candidates = projection.bindings
      .filter(binding => binding.projectId === projection.projectId && binding.enabled)
      .flatMap(binding => binding.connectorGrantRefs.map(grantId => ({ bindingId: binding.bindingId, grantId })));
    if (candidates.length !== 1) return;
    this.query.bindingId = candidates[0]!.bindingId;
    this.query.grantId = candidates[0]!.grantId;
  }

  private renderHostWorkflow(container: HTMLElement): void {
    const card = this.card(container, "Use Host Capability");
    if (!this.hostAuthorizationSnapshot) {
      card.createEl("p", { text: "Select or enter a backend Binding ID and server-issued Grant ID, then complete a successful refresh. No Binding or Grant object is accepted here." });
      return;
    }
    this.textField(card, "Search", "issue, review, diagnose…", this.hostFlow.searchQuery, value => { this.hostFlow.searchQuery = value; });
    card.createEl("button", { text: "Search granted capabilities" }).onclick = () => void this.runAction(async () => {
      const authorization = this.requireHostAuthorizationSnapshot();
      const response = await this.host.client.searchHostCapabilities({
        ...authorization,
        ...(this.hostFlow.searchQuery.trim() ? { query: this.hostFlow.searchQuery.trim() } : {}),
      });
      this.hostFlow.searchResults = response.results;
      this.hostFlow.description = null;
      this.hostFlow.plan = null;
      this.hostFlow.invocation = null;
      this.render();
    });
    for (const result of this.hostFlow.searchResults) {
      const row = card.createDiv({ cls: "llmwiki-control-record" });
      row.createEl("strong", { text: safePresentationText(result.displayName) });
      row.createEl("code", { text: `${result.descriptorId}@${result.descriptorVersion}` });
      row.createEl("small", { text: safePresentationText(result.operations.join(", ")) });
      row.createEl("button", { text: "Describe" }).onclick = () => void this.runAction(async () => {
        const authorization = this.requireHostAuthorizationSnapshot();
        this.hostFlow.description = await this.host.client.describeHostCapability({
          ...authorization,
          descriptorId: result.descriptorId,
          descriptorVersion: result.descriptorVersion,
        });
        this.hostFlow.operation = result.operations[0] ?? "";
        this.hostFlow.plan = null;
        this.hostFlow.invocation = null;
        this.render();
      });
    }
    const description = this.hostFlow.description;
    if (!description) return;
    card.createEl("pre", { text: safeSummary(description.description) });
    this.textField(card, "Operation", "provider.operation", this.hostFlow.operation, value => { this.hostFlow.operation = value; });
    this.jsonField(card, "Assignment requirement", this.hostFlow.requirementJson, value => { this.hostFlow.requirementJson = value; });
    this.jsonField(card, "Project capability policy", this.hostFlow.policyJson, value => { this.hostFlow.policyJson = value; });
    card.createEl("button", { text: "Plan assignment" }).onclick = () => void this.runAction(async () => {
      const authorization = this.requireHostAuthorizationSnapshot();
      const requirement = parseJsonObject(this.hostFlow.requirementJson, "Assignment requirement");
      if (!requirement.projectId) requirement.projectId = authorization.project;
      if (!Array.isArray(requirement.operations) || requirement.operations.length === 0) requirement.operations = [this.hostFlow.operation];
      this.hostFlow.plan = await this.host.client.planHostAssignment({
        ...authorization,
        requirement,
        policy: parseJsonObject(this.hostFlow.policyJson, "Project capability policy"),
        devices: [],
      });
      this.hostFlow.invocation = null;
      this.render();
    });
    const plan = this.hostFlow.plan;
    if (!plan) return;
    card.createEl("pre", { text: safeSummary(plan.plan) });
    const planId = typeof plan.plan.planId === "string" ? plan.plan.planId : "";
    const approvalStatus = plan.plan.approval?.status;
    if (planId && approvalStatus === "pending") {
      card.createEl("button", { text: "Approve exact assignment", cls: "mod-cta" }).onclick = () => void this.runAction(async () => {
        const authorization = this.requireHostAuthorizationSnapshot();
        this.hostFlow.plan = await this.host.client.approveHostAssignment({
          ...authorization,
          planId,
          expectedFingerprint: plan.planFingerprint,
          approvedBy: ACTOR,
        });
        this.render();
      });
    }
    if (!planId || approvalStatus !== "approved") return;
    this.jsonField(card, "Invocation input", this.hostFlow.inputJson, value => { this.hostFlow.inputJson = value; });
    card.createEl("button", { text: "Invoke approved capability", cls: "mod-cta" }).onclick = () => void this.runAction(async () => {
      const authorization = this.requireHostAuthorizationSnapshot();
      const descriptor = description.description.descriptor;
      if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) throw new Error("Host description is missing its descriptor identity");
      const descriptorId = (descriptor as Record<string, unknown>).descriptorId;
      const descriptorVersion = (descriptor as Record<string, unknown>).descriptorVersion;
      const descriptorFingerprint = description.description.descriptorFingerprint;
      if (typeof descriptorId !== "string" || typeof descriptorVersion !== "string" || typeof descriptorFingerprint !== "string") {
        throw new Error("Host description is missing its descriptor fingerprint");
      }
      this.hostFlow.invocation = await this.host.client.invokeHostCapability({
        ...authorization,
        planId,
        descriptorId,
        descriptorVersion,
        operation: this.hostFlow.operation.trim(),
        describedDescriptorFingerprint: descriptorFingerprint,
        input: parseJsonObject(this.hostFlow.inputJson, "Invocation input"),
      });
      this.render();
    });
    if (this.hostFlow.invocation !== null) card.createEl("pre", { text: safeSummary(this.hostFlow.invocation) });
  }

  private jsonField(container: HTMLElement, label: string, value: string, update: (value: string) => void): void {
    const wrapper = container.createEl("label", { cls: "llmwiki-editor-field" });
    wrapper.createEl("span", { text: label });
    const input = wrapper.createEl("textarea", { text: value });
    input.rows = 6;
    input.addEventListener("input", () => update(input.value));
  }

  private notify(message: unknown): void {
    new Notice(safePresentationText(message));
  }

  private textField(container: HTMLElement, label: string, placeholder: string, value: string, update: (value: string) => void): HTMLInputElement {
    const wrapper = container.createEl("label");
    wrapper.createEl("span", { text: label });
    const input = wrapper.createEl("input", { type: "text", placeholder, value });
    input.autocomplete = "off";
    input.oninput = () => update(input.value);
    return input;
  }

  private section(container: HTMLElement, title: string, description: string): HTMLElement {
    const section = container.createEl("section", { cls: "llmwiki-control-section" });
    section.createEl("h3", { text: title });
    section.createEl("p", { text: description });
    return section;
  }

  private card(container: HTMLElement, title: string, extraClass?: string): HTMLElement {
    const card = container.createDiv({ cls: `llmwiki-control-card${extraClass ? ` ${extraClass}` : ""}` });
    card.createEl("h4", { text: title });
    return card;
  }

  private fact(container: HTMLElement, name: string, value: string): void {
    const row = container.createDiv({ cls: "llmwiki-control-fact" });
    row.createEl("strong", { text: name });
    row.createEl("span", { text: value });
  }
}

export class AgentProfileEditorModal extends Modal {
  constructor(
    app: App,
    private readonly client: AgentControlPlaneClient,
    private readonly afterSave: () => Promise<void>,
  ) { super(app); }

  onOpen(): void {
    const values: Record<string, string> = {
      profileId: "agent/",
      displayName: "",
      role: "",
      responsibilities: "",
      capabilities: "",
      principles: "",
      instructions: "",
      modelMode: "inherit",
      provider: "",
      model: "",
    };
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Create Agent Profile" });
    contentEl.createEl("p", { text: "The Profile stores versioned role and constitution metadata only. Configure provider credentials with the Secret Reference selectors in LLM Wiki Settings." });
    for (const [key, label, placeholder] of [
      ["profileId", "Profile ID", "agent/reviewer"],
      ["displayName", "Display name", "Reviewer"],
      ["role", "Role", "reviewer"],
      ["responsibilities", "Responsibilities", "comma-separated"],
      ["capabilities", "Capability claims", "comma-separated"],
      ["principles", "Constitution principles", "one per line"],
      ["instructions", "Constitution instructions", "one per line"],
      ["provider", "Model provider", "optional"],
      ["model", "Model", "optional"],
    ] as const) editorField(contentEl, label, placeholder, values[key], value => { values[key] = value; }, key === "principles" || key === "instructions");
    const mode = contentEl.createEl("label", { cls: "llmwiki-editor-field" });
    mode.createEl("span", { text: "Model policy" });
    const select = mode.createEl("select");
    for (const item of ["inherit", "local", "cloud"]) select.createEl("option", { text: item, value: item });
    select.onchange = () => { values.modelMode = select.value; };
    const save = contentEl.createEl("button", { text: "Create Profile", cls: "mod-cta" });
    save.onclick = async () => {
      try {
        const input: AgentProfileCreate = {
          profileId: values.profileId.trim() as AgentProfileCreate["profileId"],
          displayName: values.displayName.trim(),
          role: values.role.trim(),
          responsibilities: csv(values.responsibilities),
          capabilityClaims: csv(values.capabilities),
          constitution: { principles: lines(values.principles), instructions: lines(values.instructions) },
          defaultModelPolicy: {
            mode: values.modelMode as "inherit" | "local" | "cloud",
            ...(values.provider.trim() ? { provider: values.provider.trim() } : {}),
            ...(values.model.trim() ? { model: values.model.trim() } : {}),
          },
          actor: ACTOR,
        };
        const result = await this.client.createProfile(input);
        if (result.status === "conflict") throw new Error(`Profile revision conflict: ${result.actualRevision}`);
        new Notice(safePresentationText(`LLM Wiki: created ${result.record.profileId} r${result.record.revision}`));
        this.close();
        await this.afterSave();
      } catch (error) {
        new Notice(safePresentationText(`LLM Wiki: ${(error as Error)?.message ?? error}`));
      }
    };
  }

  onClose(): void { this.contentEl.empty(); }
}

export class ProjectBindingEditorModal extends Modal {
  constructor(
    app: App,
    private readonly client: AgentControlPlaneClient,
    private readonly project: string,
    private readonly profile: string,
    private readonly afterSave: () => Promise<void>,
  ) { super(app); }

  onOpen(): void {
    const values: Record<string, string> = {
      projectId: this.project || "project/",
      fingerprint: "sha256:",
      profileId: this.profile || "agent/",
      profileRevision: "1",
      role: "",
      memoryScopes: "recentContext, openItems, stableMemory",
      grantRefs: "",
    };
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Create Project Agent Binding" });
    contentEl.createEl("p", { text: "Binding records contain logical grant references only. Usable grant tokens and connector secrets never enter plugin data." });
    for (const [key, label, placeholder] of [
      ["projectId", "Project ID", "project/example"],
      ["fingerprint", "Project context fingerprint", "sha256:…"],
      ["profileId", "Profile ID", "agent/reviewer"],
      ["profileRevision", "Profile revision", "1"],
      ["role", "Project role", "reviewer"],
      ["memoryScopes", "Memory scopes", "comma-separated"],
      ["grantRefs", "Connector grant references", "grant/… comma-separated"],
    ] as const) editorField(contentEl, label, placeholder, values[key], value => { values[key] = value; });
    const save = contentEl.createEl("button", { text: "Create Binding", cls: "mod-cta" });
    save.onclick = async () => {
      try {
        const input: ProjectAgentBindingCreate = {
          projectId: values.projectId.trim() as ProjectAgentBindingCreate["projectId"],
          projectContextFingerprint: values.fingerprint.trim(),
          profileId: values.profileId.trim() as ProjectAgentBindingCreate["profileId"],
          profileRevision: Number(values.profileRevision),
          role: values.role.trim(),
          enabled: true,
          memoryScopes: csv(values.memoryScopes) as ProjectAgentBindingCreate["memoryScopes"],
          connectorGrantRefs: csv(values.grantRefs) as ProjectAgentBindingCreate["connectorGrantRefs"],
          actor: ACTOR,
        };
        const result = await this.client.createBinding(input);
        if (result.status === "conflict") throw new Error(`Binding revision conflict: ${result.actualRevision}`);
        new Notice(safePresentationText(`LLM Wiki: created ${result.record.bindingId} r${result.record.revision}`));
        this.close();
        await this.afterSave();
      } catch (error) {
        new Notice(safePresentationText(`LLM Wiki: ${(error as Error)?.message ?? error}`));
      }
    };
  }

  onClose(): void { this.contentEl.empty(); }
}

function editorField(container: HTMLElement, label: string, placeholder: string, value: string, update: (value: string) => void, multiline = false): void {
  const wrapper = container.createEl("label", { cls: "llmwiki-editor-field" });
  wrapper.createEl("span", { text: label });
  const input = multiline
    ? wrapper.createEl("textarea", { placeholder, text: value })
    : wrapper.createEl("input", { type: "text", placeholder, value });
  input.addEventListener("input", () => update(input.value));
}

function csv(value: string): string[] {
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

function lines(value: string): string[] {
  return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed as Record<string, unknown>;
}
