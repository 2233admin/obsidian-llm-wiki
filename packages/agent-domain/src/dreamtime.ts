import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import { canonicalDigest, canonicalJson, deepClone, digestTransitionToken } from "./canonical.js";
import {
  DomainConflictError,
  DomainNotFoundError,
  DomainValidationError,
} from "./errors.js";
import { withRecoverableFileLock } from "./locks.js";
import { assertSafeSharedState, assertSafeSingleSegment } from "./security.js";
import type {
  ActorAuthorization,
  ApprovalDecision,
  CandidateDiff,
  DreamTimeDecisionResult,
  DreamTimeWorker,
  DreamTimeWorkerInput,
  MemoryEvent,
  MemoryProposal,
  MemoryProposalCandidate,
  MemoryProposalId,
  MemoryRevision,
  MemoryScopeName,
  MemorySections,
  ProjectId,
  AgentProfileId,
} from "./types.js";
import {
  makeMemorySection,
  proposalFingerprintMaterial,
  revisionFingerprintMaterial,
  validateApprovalDecision,
  validateMemoryEvent,
  validateMemoryProposal,
  validateMemoryRevision,
  parseAgentProfileId,
  parseProjectId,
} from "./validation.js";

export type DreamTimeTransitionAction = "approve" | "reject";

export interface DreamTimeAuthorizationContext {
  actor: string;
  action: DreamTimeTransitionAction;
  proposal: Readonly<MemoryProposal>;
}

export interface DreamTimeTransitionRequest {
  presentedFingerprint: string;
  expectedRevision: number;
  transitionToken: string;
  actor: string;
  reason?: string;
  authorize(context: DreamTimeAuthorizationContext): ActorAuthorization | Promise<ActorAuthorization>;
}

export interface DreamTimeStoreOptions {
  memoryRoot: string;
  projectId: ProjectId;
  profileId: AgentProfileId;
  clock?: () => string;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
  staleLockMs?: number;
  faultInjector?: (point: "after-revision-write" | "after-event-write" | "after-decision-write") => void | Promise<void>;
}

interface TransitionReceipt {
  schemaVersion: 1;
  action: DreamTimeTransitionAction;
  proposalId: MemoryProposalId;
  proposalFingerprint: string;
  transitionTokenHash: string;
  decisionId: string;
  eventId: string;
  revisionId: MemoryRevision["revisionId"] | null;
  actor: string;
}

interface FinalizeInput {
  transitionAction: DreamTimeTransitionAction;
  action: Exclude<ApprovalDecision["state"], "approved">;
  proposal: MemoryProposal;
  transitionTokenHash: string;
  actor: string;
  policy: ActorAuthorization;
  reason: string;
}

const MEMORY_SCOPES: MemoryScopeName[] = ["recentContext", "openItems", "stableMemory"];

export function dreamTimeSourceFingerprint(input: DreamTimeWorkerInput): string {
  return canonicalDigest({
    operation: input.operation,
    projectId: input.projectId,
    profileId: input.profileId,
    sourceIdentities: input.sourceIdentities,
    expectedRevision: input.expectedRevision,
    currentSections: input.currentSections,
    protectedDirectives: input.protectedDirectives,
    unresolvedConflicts: input.unresolvedConflicts,
    modelLock: input.modelLock,
  });
}

export async function runDreamTimeProposalWorker(
  store: DreamTimeStore,
  worker: DreamTimeWorker,
  rawInput: DreamTimeWorkerInput,
  actor: string,
): Promise<MemoryProposal> {
  const input = deepClone(rawInput);
  if (input.sourceFingerprint !== dreamTimeSourceFingerprint(input)) {
    throw new DomainValidationError("Dream Time worker input source fingerprint does not lock the exact input");
  }
  assertSafeSharedState(input, "DreamTimeWorkerInput");
  const candidate = await worker.generate(deepFreeze(input));
  assertWorkerOutputLocked(input, candidate);
  return store.createProposal(candidate, actor);
}

export class DreamTimeStore {
  readonly projectId: ProjectId;
  readonly profileId: AgentProfileId;

  private readonly scopeRoot: string;
  private readonly now: () => string;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryMs: number;
  private readonly staleLockMs?: number;
  private readonly faultInjector?: DreamTimeStoreOptions["faultInjector"];

  constructor(options: DreamTimeStoreOptions) {
    if (!options.memoryRoot) throw new DomainValidationError("Dream Time memoryRoot is required");
    this.projectId = parseProjectId(options.projectId);
    this.profileId = parseAgentProfileId(options.profileId);
    this.scopeRoot = join(
      options.memoryRoot,
      this.projectId.slice("project/".length),
      this.profileId.slice("agent/".length),
    );
    this.now = options.clock ?? (() => new Date().toISOString());
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    this.lockRetryMs = options.lockRetryMs ?? 15;
    this.staleLockMs = options.staleLockMs;
    this.faultInjector = options.faultInjector;
  }

  async createProposal(rawCandidate: MemoryProposalCandidate, actor: string): Promise<MemoryProposal> {
    const candidate = deepClone(rawCandidate);
    assertSafeSharedState({ candidate, actor }, "MemoryProposalCandidate");
    if (candidate.projectId !== this.projectId || candidate.profileId !== this.profileId) {
      throw new DomainConflictError("Memory Proposal is outside this Project/Profile scope", {
        expectedProjectId: this.projectId,
        expectedProfileId: this.profileId,
        proposalProjectId: candidate.projectId,
        proposalProfileId: candidate.profileId,
      });
    }
    const createdAt = this.now();
    const material: Omit<MemoryProposal, "fingerprint"> = {
      ...candidate,
      schemaVersion: 1,
      proposalId: candidate.proposalId ?? `memory-proposal/${randomUUID()}`,
      lifecycle: "proposed",
      approvalPolicy: {
        mode: "manual",
        autoApprovalHook: {
          enabled: false,
          warningFreeOnly: true,
          workingMemoryOnly: true,
        },
      },
      createdAt,
      createdBy: actor,
    };
    const proposal = validateMemoryProposal({
      ...material,
      fingerprint: canonicalDigest(proposalFingerprintMaterial(material as MemoryProposal)),
    });
    await this.withScopeLock(async () => {
      await atomicCreate(this.proposalPath(proposal.proposalId), `${canonicalJson(proposal)}\n`);
    });
    return deepClone(proposal);
  }

  async readProposal(proposalId: MemoryProposalId): Promise<MemoryProposal | null> {
    const proposal = await readValidated(this.proposalPath(proposalId), validateMemoryProposal);
    if (proposal && (proposal.proposalId !== proposalId || proposal.projectId !== this.projectId || proposal.profileId !== this.profileId)) {
      throw new DomainConflictError("Memory Proposal file identity does not match its scoped path", { proposalId });
    }
    return proposal;
  }

  async readCurrentRevision(): Promise<MemoryRevision | null> {
    const revisions = await this.listRevisions();
    return revisions.at(-1) ?? null;
  }

  async readRevision(revisionId: MemoryRevision["revisionId"]): Promise<MemoryRevision | null> {
    const revisions = await this.listRevisions();
    return revisions.find((revision) => revision.revisionId === revisionId) ?? null;
  }

  async listRevisions(): Promise<MemoryRevision[]> {
    const files = await listFiles(join(this.scopeRoot, "revisions"), /^\d{12}-[A-Za-z0-9._-]+\.json$/);
    const revisions = await Promise.all(files.map((file) => readValidated(join(this.scopeRoot, "revisions", file), validateMemoryRevision)));
    const result = revisions.filter((revision): revision is MemoryRevision => revision !== null)
      .sort((left, right) => left.revision - right.revision);
    for (let index = 0; index < result.length; index += 1) {
      const revision = result[index]!;
      if (revision.projectId !== this.projectId || revision.profileId !== this.profileId || revision.revision !== index + 1) {
        throw new DomainConflictError("Dream Time revision chain is non-contiguous or outside its scope", {
          revisionId: revision.revisionId,
          revision: revision.revision,
        });
      }
      const previous = result[index - 1] ?? null;
      if (revision.previousRevisionId !== (previous?.revisionId ?? null)
        || revision.previousFingerprint !== (previous?.fingerprint ?? null)) {
        throw new DomainConflictError("Dream Time revision predecessor lock is broken", {
          revisionId: revision.revisionId,
          previousRevisionId: revision.previousRevisionId,
        });
      }
    }
    return result;
  }

  async listEvents(): Promise<MemoryEvent[]> {
    const files = await listFiles(join(this.scopeRoot, "events"), /^\d{12}-[A-Za-z0-9._-]+\.json$/);
    const events = await Promise.all(files.map((file) => readValidated(join(this.scopeRoot, "events", file), validateMemoryEvent)));
    const result = events.filter((event): event is MemoryEvent => event !== null)
      .sort((left, right) => left.ordinal - right.ordinal);
    for (let index = 0; index < result.length; index += 1) {
      if (result[index]!.ordinal !== index + 1) {
        throw new DomainConflictError("Dream Time event log is not append-only and contiguous");
      }
    }
    return result;
  }

  async readDecision(proposalId: MemoryProposalId): Promise<ApprovalDecision | null> {
    const decision = await readValidated(this.decisionPath(proposalId), validateApprovalDecision);
    if (decision && decision.proposalId !== proposalId) {
      throw new DomainConflictError("Approval Decision file identity does not match its proposal path", { proposalId });
    }
    return decision;
  }

  approve(proposalId: MemoryProposalId, request: DreamTimeTransitionRequest): Promise<DreamTimeDecisionResult> {
    return this.transition("approve", proposalId, request);
  }

  reject(proposalId: MemoryProposalId, request: DreamTimeTransitionRequest): Promise<DreamTimeDecisionResult> {
    return this.transition("reject", proposalId, request);
  }

  private async transition(
    action: DreamTimeTransitionAction,
    proposalId: MemoryProposalId,
    request: DreamTimeTransitionRequest,
  ): Promise<DreamTimeDecisionResult> {
    if (!request.transitionToken || request.transitionToken !== request.transitionToken.trim()) {
      throw new DomainValidationError("Transition token must be non-empty and trimmed");
    }
    if (!Number.isInteger(request.expectedRevision) || request.expectedRevision < 0) {
      throw new DomainValidationError("Expected revision must be a non-negative integer");
    }
    const proposal = await this.readProposal(proposalId);
    if (!proposal) throw new DomainNotFoundError(`Memory Proposal ${proposalId} does not exist`);
    if (proposal.fingerprint !== request.presentedFingerprint) {
      throw new DomainConflictError("Presented Memory Proposal fingerprint does not match immutable proposal", {
        proposalId,
        presentedFingerprint: request.presentedFingerprint,
        actualFingerprint: proposal.fingerprint,
      });
    }
    const transitionTokenHash = digestTransitionToken(request.transitionToken);
    return this.withScopeLock(async () => {
      const replay = await this.replayOrRecover(action, proposal, transitionTokenHash, request.actor);
      if (replay) return replay;

      const existingDecision = await this.readDecision(proposalId);
      if (existingDecision) {
        throw new DomainConflictError("Memory Proposal already has a terminal decision under a different transition token", {
          proposalId,
          state: existingDecision.state,
        });
      }

      const authorization = await request.authorize({ actor: request.actor, action, proposal: deepFreeze(deepClone(proposal)) });
      validateAuthorization(authorization);
      if (!authorization.allowed) {
        throw new DomainConflictError("Actor is not authorized for this Dream Time transition", {
          proposalId,
          actor: request.actor,
          action,
          policyVersion: authorization.policyVersion,
          reason: authorization.reason,
        });
      }

      const now = this.now();
      if (Date.parse(now) >= Date.parse(proposal.expiresAt)) {
        return this.finalizeWithoutRevision({
          transitionAction: action,
          action: "expired",
          proposal,
          transitionTokenHash,
          actor: request.actor,
          policy: authorization,
          reason: "Proposal expiry elapsed before transition",
        });
      }

      const current = await this.readCurrentRevision();
      if (!expectedRevisionMatches(proposal, current) || request.expectedRevision !== proposal.expectedRevision.revision) {
        return this.finalizeWithoutRevision({
          transitionAction: action,
          action: "stale",
          proposal,
          transitionTokenHash,
          actor: request.actor,
          policy: authorization,
          reason: `Expected revision ${request.expectedRevision}; current revision is ${current?.revision ?? 0}`,
        });
      }

      if (action === "reject") {
        return this.finalizeWithoutRevision({
          transitionAction: action,
          action: "rejected",
          proposal,
          transitionTokenHash,
          actor: request.actor,
          policy: authorization,
          reason: request.reason?.trim() || "Proposal rejected by authorized actor",
        });
      }

      const sections = applyCandidateDiff(proposal, current, now);
      const revisionNumber = (current?.revision ?? 0) + 1;
      const revisionMaterial: Omit<MemoryRevision, "fingerprint"> = {
        schemaVersion: 1,
        revisionId: `memory-revision/${String(revisionNumber).padStart(12, "0")}-${randomUUID()}`,
        revision: revisionNumber,
        previousRevisionId: current?.revisionId ?? null,
        previousFingerprint: current?.fingerprint ?? null,
        projectId: this.projectId,
        profileId: this.profileId,
        lifecycle: "approved",
        sections,
        protectedDirectives: deepClone(proposal.protectedDirectives),
        unresolvedConflicts: deepClone(proposal.unresolvedConflicts),
        exactDiff: deepClone(proposal.candidateDiff),
        provenance: deepClone(proposal.provenance),
        approval: {
          proposalId: proposal.proposalId,
          transitionTokenHash,
          actor: request.actor,
          policyVersion: authorization.policyVersion,
          policyResult: "allowed",
        },
        createdAt: now,
      };
      const revision = validateMemoryRevision({
        ...revisionMaterial,
        fingerprint: canonicalDigest(revisionFingerprintMaterial(revisionMaterial as MemoryRevision)),
      });
      await atomicCreate(this.revisionPath(revision), `${canonicalJson(revision)}\n`);
      await this.faultInjector?.("after-revision-write");
      return this.persistTerminalResult({
        transitionAction: "approve",
        action: "approved",
        proposal,
        revision,
        transitionTokenHash,
        actor: request.actor,
        policy: authorization,
        reason: "Proposal approved and committed as a new immutable revision",
      });
    });
  }

  private async replayOrRecover(
    action: DreamTimeTransitionAction,
    proposal: MemoryProposal,
    transitionTokenHash: string,
    actor: string,
  ): Promise<DreamTimeDecisionResult | null> {
    const receipt = await this.readReceipt(transitionTokenHash);
    if (receipt) {
      assertReceiptMatches(receipt, action, proposal, transitionTokenHash, actor);
      return this.resultFromReceipt(receipt, true);
    }

    const decision = await this.readDecision(proposal.proposalId);
    if (decision?.transitionTokenHash === transitionTokenHash) {
      if (decision.actor !== actor) throw new DomainConflictError("Transition replay actor does not match the committed actor");
      const event = (await this.listEvents()).find((candidate) =>
        candidate.proposalId === proposal.proposalId && candidate.transitionTokenHash === transitionTokenHash);
      if (!event) throw new DomainConflictError("Terminal decision exists without its append-only event");
      const revision = decision.revisionId ? await this.readRevision(decision.revisionId) : null;
      const reconstructed = makeReceipt(actionForDecision(decision), proposal, decision, event, revision, actor);
      await atomicCreate(this.receiptPath(transitionTokenHash), `${canonicalJson(reconstructed)}\n`);
      return { status: decision.state, idempotent: true, decision, revision, event };
    }

    const orphanEvent = (await this.listEvents()).find((event) => event.transitionTokenHash === transitionTokenHash);
    if (orphanEvent) {
      if (orphanEvent.proposalId !== proposal.proposalId
        || orphanEvent.transitionAction !== action
        || orphanEvent.actor !== actor) {
        throw new DomainConflictError("Transition event is already bound to a different immutable transition");
      }
      const revision = orphanEvent.revisionId ? await this.readRevision(orphanEvent.revisionId) : null;
      if (orphanEvent.revisionId && !revision) throw new DomainConflictError("Orphan transition event refers to a missing revision");
      const recoveredDecision = validateApprovalDecision({
        schemaVersion: 1,
        decisionId: `memory-decision/${randomUUID()}`,
        proposalId: proposal.proposalId,
        transitionAction: orphanEvent.transitionAction,
        state: orphanEvent.action,
        revisionId: orphanEvent.revisionId,
        transitionTokenHash,
        actor,
        decidedAt: orphanEvent.occurredAt,
        proposalFingerprint: proposal.fingerprint,
        policyVersion: orphanEvent.policyResult.policyVersion,
        reason: "Recovered terminal decision from append-only event after interrupted commit",
      });
      const recoveredReceipt = makeReceipt(action, proposal, recoveredDecision, orphanEvent, revision, actor);
      await atomicCreate(this.decisionPath(proposal.proposalId), `${canonicalJson(recoveredDecision)}\n`);
      await atomicCreate(this.receiptPath(transitionTokenHash), `${canonicalJson(recoveredReceipt)}\n`);
      return {
        status: recoveredDecision.state,
        idempotent: true,
        decision: recoveredDecision,
        revision,
        event: orphanEvent,
      };
    }

    const revisions = await this.listRevisions();
    const committedRevision = revisions.find((revision) => revision.approval.transitionTokenHash === transitionTokenHash);
    if (committedRevision) {
      if (action !== "approve" || committedRevision.approval.proposalId !== proposal.proposalId) {
        throw new DomainConflictError("Transition token hash is already committed to a different operation or proposal");
      }
      if (committedRevision.approval.actor !== actor) {
        throw new DomainConflictError("Transition recovery actor does not match the committed actor");
      }
      return this.persistTerminalResult({
        transitionAction: "approve",
        action: "approved",
        proposal,
        revision: committedRevision,
        transitionTokenHash,
        actor,
        policy: {
          allowed: true,
          policyVersion: committedRevision.approval.policyVersion,
          reason: "Recovered authorization recorded at the immutable revision commit point",
        },
        reason: "Recovered terminal records after interruption following revision commit",
        idempotent: true,
      });
    }

    const committedForProposal = revisions.find((revision) => revision.approval.proposalId === proposal.proposalId);
    if (committedForProposal) {
      throw new DomainConflictError("Memory Proposal was already committed under a different transition token", {
        proposalId: proposal.proposalId,
        revisionId: committedForProposal.revisionId,
      });
    }
    return null;
  }

  private async finalizeWithoutRevision(input: FinalizeInput): Promise<DreamTimeDecisionResult> {
    return this.persistTerminalResult({ ...input, revision: null });
  }

  private async persistTerminalResult(input: {
    transitionAction: DreamTimeTransitionAction;
    action: ApprovalDecision["state"];
    proposal: MemoryProposal;
    revision: MemoryRevision | null;
    transitionTokenHash: string;
    actor: string;
    policy: ActorAuthorization;
    reason: string;
    idempotent?: boolean;
  }): Promise<DreamTimeDecisionResult> {
    const existingDecision = await this.readDecision(input.proposal.proposalId);
    if (existingDecision) {
      if (existingDecision.transitionTokenHash !== input.transitionTokenHash || existingDecision.state !== input.action) {
        throw new DomainConflictError("Proposal has a conflicting terminal decision");
      }
      const existingEvent = (await this.listEvents()).find((event) =>
        event.proposalId === input.proposal.proposalId && event.transitionTokenHash === input.transitionTokenHash);
      if (!existingEvent) throw new DomainConflictError("Terminal decision exists without matching event");
      const receipt = makeReceipt(existingDecision.transitionAction, input.proposal, existingDecision, existingEvent, input.revision, input.actor);
      if (!(await exists(this.receiptPath(input.transitionTokenHash)))) {
        await atomicCreate(this.receiptPath(input.transitionTokenHash), `${canonicalJson(receipt)}\n`);
      }
      return {
        status: existingDecision.state,
        idempotent: true,
        decision: existingDecision,
        revision: input.revision,
        event: existingEvent,
      };
    }

    const occurredAt = this.now();
    const ordinal = (await this.listEvents()).length + 1;
    const event = validateMemoryEvent({
      schemaVersion: 1,
      eventId: `memory-event/${String(ordinal).padStart(12, "0")}-${randomUUID()}`,
      ordinal,
      transitionAction: input.transitionAction,
      action: input.action,
      proposalId: input.proposal.proposalId,
      revisionId: input.revision?.revisionId ?? null,
      transitionTokenHash: input.transitionTokenHash,
      actor: input.actor,
      occurredAt,
      exactDiff: deepClone(input.proposal.candidateDiff),
      provenance: deepClone(input.proposal.provenance),
      policyResult: {
        allowed: input.policy.allowed,
        policyVersion: input.policy.policyVersion,
        reason: input.policy.reason,
      },
    });
    const decision = validateApprovalDecision({
      schemaVersion: 1,
      decisionId: `memory-decision/${randomUUID()}`,
      proposalId: input.proposal.proposalId,
      transitionAction: input.transitionAction,
      state: input.action,
      revisionId: input.revision?.revisionId ?? null,
      transitionTokenHash: input.transitionTokenHash,
      actor: input.actor,
      decidedAt: occurredAt,
      proposalFingerprint: input.proposal.fingerprint,
      policyVersion: input.policy.policyVersion,
      reason: input.reason,
    });
    const receipt = makeReceipt(decision.transitionAction, input.proposal, decision, event, input.revision, input.actor);

    await atomicCreate(this.eventPath(event), `${canonicalJson(event)}\n`);
    await this.faultInjector?.("after-event-write");
    await atomicCreate(this.decisionPath(input.proposal.proposalId), `${canonicalJson(decision)}\n`);
    await this.faultInjector?.("after-decision-write");
    await atomicCreate(this.receiptPath(input.transitionTokenHash), `${canonicalJson(receipt)}\n`);
    return {
      status: decision.state,
      idempotent: input.idempotent ?? false,
      decision,
      revision: input.revision,
      event,
    };
  }

  private async resultFromReceipt(receipt: TransitionReceipt, idempotent: boolean): Promise<DreamTimeDecisionResult> {
    const decision = await this.readDecision(receipt.proposalId);
    const event = (await this.listEvents()).find((candidate) => candidate.eventId === receipt.eventId);
    const revision = receipt.revisionId ? await this.readRevision(receipt.revisionId) : null;
    if (!decision
      || !event
      || (receipt.revisionId !== null && !revision)
      || decision.decisionId !== receipt.decisionId
      || decision.proposalId !== receipt.proposalId
      || decision.transitionAction !== receipt.action
      || decision.transitionTokenHash !== receipt.transitionTokenHash
      || decision.proposalFingerprint !== receipt.proposalFingerprint
      || event.proposalId !== receipt.proposalId
      || event.transitionAction !== receipt.action
      || event.transitionTokenHash !== receipt.transitionTokenHash
      || event.actor !== receipt.actor
      || (revision?.revisionId ?? null) !== receipt.revisionId) {
      throw new DomainConflictError("Transition receipt refers to missing terminal records", { transitionTokenHash: receipt.transitionTokenHash });
    }
    return { status: decision.state, idempotent, decision, revision, event };
  }

  private async readReceipt(transitionTokenHash: string): Promise<TransitionReceipt | null> {
    const path = this.receiptPath(transitionTokenHash);
    try {
      const receipt = JSON.parse(await readFile(path, "utf8")) as TransitionReceipt;
      assertSafeSharedState(receipt, "TransitionReceipt");
      if (receipt.schemaVersion !== 1 || receipt.transitionTokenHash !== transitionTokenHash) {
        throw new DomainConflictError("Invalid transition receipt", { transitionTokenHash });
      }
      return receipt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private proposalPath(proposalId: MemoryProposalId): string {
    const slug = idSlug(proposalId, "memory-proposal/");
    return join(this.scopeRoot, "proposals", `${slug}.json`);
  }

  private revisionPath(revision: MemoryRevision): string {
    const slug = idSlug(revision.revisionId, "memory-revision/");
    return join(this.scopeRoot, "revisions", `${String(revision.revision).padStart(12, "0")}-${slug}.json`);
  }

  private eventPath(event: MemoryEvent): string {
    const slug = idSlug(event.eventId, "memory-event/");
    return join(this.scopeRoot, "events", `${String(event.ordinal).padStart(12, "0")}-${slug}.json`);
  }

  private decisionPath(proposalId: MemoryProposalId): string {
    const slug = idSlug(proposalId, "memory-proposal/");
    return join(this.scopeRoot, "decisions", `${slug}.json`);
  }

  private receiptPath(transitionTokenHash: string): string {
    if (!/^sha256:[a-f0-9]{64}$/.test(transitionTokenHash)) throw new DomainValidationError("Invalid transition token hash");
    return join(this.scopeRoot, "receipts", `${transitionTokenHash.slice("sha256:".length)}.json`);
  }

  private async withScopeLock<R>(action: () => Promise<R>): Promise<R> {
    const lockPath = join(this.scopeRoot, ".lock");
    return withRecoverableFileLock({
      lockPath,
      now: this.now,
      timeoutMs: this.lockTimeoutMs,
      retryMs: this.lockRetryMs,
      staleLockMs: this.staleLockMs,
    }, action);
  }
}

function assertWorkerOutputLocked(input: DreamTimeWorkerInput, candidate: MemoryProposalCandidate): void {
  const lockedFields: Array<keyof DreamTimeWorkerInput & keyof MemoryProposalCandidate> = [
    "operation",
    "projectId",
    "profileId",
    "sourceIdentities",
    "expectedRevision",
    "sourceFingerprint",
    "protectedDirectives",
    "unresolvedConflicts",
    "modelLock",
    "expiresAt",
  ];
  for (const field of lockedFields) {
    if (canonicalJson(candidate[field]) !== canonicalJson(input[field])) {
      throw new DomainConflictError(`Dream Time proposal worker changed locked field ${field}`);
    }
  }
}

function validateAuthorization(value: ActorAuthorization): void {
  if (!value || typeof value.allowed !== "boolean" || !value.policyVersion?.trim() || !value.reason?.trim()) {
    throw new DomainValidationError("Authorization result must include allowed, policyVersion, and reason");
  }
  assertSafeSharedState(value, "ActorAuthorization");
}

function expectedRevisionMatches(proposal: MemoryProposal, current: MemoryRevision | null): boolean {
  if (!current) {
    return proposal.expectedRevision.revision === 0
      && proposal.expectedRevision.revisionId === null
      && proposal.expectedRevision.fingerprint === null;
  }
  return proposal.expectedRevision.revision === current.revision
    && proposal.expectedRevision.revisionId === current.revisionId
    && proposal.expectedRevision.fingerprint === current.fingerprint;
}

function applyCandidateDiff(proposal: MemoryProposal, current: MemoryRevision | null, now: string): MemorySections {
  const base: MemorySections = current ? deepClone(current.sections) : {
    recentContext: makeMemorySection(),
    openItems: makeMemorySection(),
    stableMemory: makeMemorySection(),
  };
  assertGovernanceRetained(current, proposal);
  for (const diff of proposal.candidateDiff) {
    const currentSection = base[diff.section];
    const expectedBefore = current ? currentSection.contentHash : null;
    if (diff.beforeHash !== expectedBefore) {
      throw new DomainConflictError("Candidate diff beforeHash does not match the exact expected section", {
        section: diff.section,
        expectedBefore,
        actualBefore: diff.beforeHash,
      });
    }
    assertSectionMutationAllowed(current, diff, currentSection.contentHash, now);
    base[diff.section] = diff.operation === "remove" ? makeMemorySection() : deepClone(diff.after!);
  }
  return base;
}

function assertGovernanceRetained(current: MemoryRevision | null, proposal: MemoryProposal): void {
  if (!current) return;
  for (const directive of current.protectedDirectives) {
    if (!proposal.protectedDirectives.some((candidate) => canonicalJson(candidate) === canonicalJson(directive))) {
      throw new DomainConflictError("Proposal silently removed or changed a protected directive", { directiveId: directive.directiveId });
    }
  }
  for (const conflict of current.unresolvedConflicts) {
    if (!proposal.unresolvedConflicts.some((candidate) => canonicalJson(candidate) === canonicalJson(conflict))) {
      throw new DomainConflictError("Proposal silently removed or changed an unresolved conflict", { conflictId: conflict.conflictId });
    }
  }
}

function assertSectionMutationAllowed(
  current: MemoryRevision | null,
  diff: CandidateDiff,
  currentContentHash: string,
  now: string,
): void {
  if (!current) return;
  const unresolved = current.unresolvedConflicts.find((conflict) => conflict.section === diff.section);
  if (unresolved) {
    throw new DomainConflictError("Candidate diff attempts to change a section with an unresolved conflict", {
      conflictId: unresolved.conflictId,
      section: diff.section,
    });
  }
  for (const directive of current.protectedDirectives.filter((candidate) => candidate.section === diff.section)) {
    if (directive.contentHash && directive.contentHash !== currentContentHash) {
      throw new DomainConflictError("Protected directive no longer matches its locked section hash", { directiveId: directive.directiveId });
    }
    const active = directive.kind !== "retain-until"
      || Date.parse(now) < Date.parse(directive.retainUntil!);
    if (active) {
      throw new DomainConflictError("Candidate diff attempts to change a protected memory section", {
        directiveId: directive.directiveId,
        section: diff.section,
      });
    }
  }
}

function makeReceipt(
  action: DreamTimeTransitionAction,
  proposal: MemoryProposal,
  decision: ApprovalDecision,
  event: MemoryEvent,
  revision: MemoryRevision | null,
  actor: string,
): TransitionReceipt {
  return {
    schemaVersion: 1,
    action,
    proposalId: proposal.proposalId,
    proposalFingerprint: proposal.fingerprint,
    transitionTokenHash: decision.transitionTokenHash,
    decisionId: decision.decisionId,
    eventId: event.eventId,
    revisionId: revision?.revisionId ?? null,
    actor,
  };
}

function assertReceiptMatches(
  receipt: TransitionReceipt,
  action: DreamTimeTransitionAction,
  proposal: MemoryProposal,
  transitionTokenHash: string,
  actor: string,
): void {
  if (receipt.action !== action
    || receipt.proposalId !== proposal.proposalId
    || receipt.proposalFingerprint !== proposal.fingerprint
    || receipt.transitionTokenHash !== transitionTokenHash
    || receipt.actor !== actor) {
    throw new DomainConflictError("Transition token is already bound to a different immutable transition");
  }
}

function actionForDecision(decision: ApprovalDecision): DreamTimeTransitionAction {
  return decision.transitionAction;
}

function idSlug(value: string, prefix: string): string {
  if (!value.startsWith(prefix)) throw new DomainValidationError(`ID must start with ${prefix}`);
  const slug = value.slice(prefix.length);
  assertSafeSingleSegment(slug, `${prefix} ID`);
  return slug;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

async function readValidated<T>(path: string, validate: (value: unknown) => T): Promise<T | null> {
  try {
    return validate(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function listFiles(directory: string, pattern: RegExp): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && pattern.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function atomicCreate(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (await exists(path)) throw new DomainConflictError("Immutable Dream Time record already exists");
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const directory = await open(path, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch {
    // Windows does not consistently support fsync on directory handles.
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
