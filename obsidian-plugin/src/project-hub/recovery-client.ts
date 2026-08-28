import { createHash } from "node:crypto";
import { fingerprintRecoveryValue } from "../../../mcp-server/src/project-hub/contract-support";
import { safePresentationText } from "../control-plane-client";
import type { SettingsOperationTransport } from "../settings-client";
import type {
  RecoveryFlowResponseV2,
  RecoveryFlowRequestV2,
  RecoverySearchRequestV2,
  RecoveryPlanFromSearchRequestV2,
  RecoveryPlanOverrideRequestV2,
  RecoveryRefreshPlanRequestV2,
  RecoveryRestartRequestV2,
} from "../../../mcp-server/src/project-hub/recovery-flow";
import type {
  RecoveryApplyRequestV2,
  RecoveryApplyResponseV2,
} from "../../../mcp-server/src/workflow/recovery-apply";

export const RECOVERY_FLOW_OPERATION = "project.hub.recovery.flow" as const;
export const RECOVERY_FLOW_REQUEST_SCHEMA_VERSION = "project-hub-recovery-flow-request/v2" as const;
export const RECOVERY_APPLY_OPERATION = "workflow.recovery.apply" as const;
export const RECOVERY_APPLY_REQUEST_SCHEMA_VERSION = "recovery-apply-request/v2" as const;

export type RecoveryPlanRequestV2 = RecoveryPlanFromSearchRequestV2 | RecoveryPlanOverrideRequestV2;
export type RecoveryProjectId = `project/${string}`;
export type ProjectId = RecoveryProjectId;
export type {
  RecoveryFlowResponseV2,
  RecoverySearchRequestV2,
  RecoveryRefreshPlanRequestV2,
  RecoveryRestartRequestV2,
  RecoveryApplyResponseV2,
};

export interface RecoveryApplyPlanningInput {
  query: string;
  limit: number;
}

export interface RecoveryApplyTokenInput {
  projectId: string;
  planFingerprint: string;
  confirmationActor: string;
}

const APPLY_STATES = ["claimed", "applied", "outcome-unknown", "unavailable"] as const;
const APPLY_KINDS = ["resume", "create"] as const;
const APPLY_RESPONSE_KEYS = [
  "schemaVersion", "state", "projectId", "planFingerprint", "tokenDigest", "actorId",
  "kind", "workRunId", "receipt", "diagnostics", "fingerprint",
] as const;
const APPLY_RECEIPT_KEYS = [
  "schemaVersion", "planFingerprint", "tokenDigest", "projectId", "kind", "workItemId",
  "workRunId", "ownerOperation", "ownerReceiptFingerprint", "ownerReceipt", "recordedAt", "fingerprint",
] as const;
const OWNER_RECEIPT_KEYS = ["ok", "idempotent", "projectId", "workItemId", "workRunId", "agent", "lifetime"] as const;
const OWNER_LIFETIME_KEYS = ["projectId", "workItemId", "workRunId", "agent", "workRunState", "stage", "status"] as const;
const MAX_APPLY_DIAGNOSTICS = 32;
const MAX_APPLY_DIAGNOSTIC_CHARS = 512;
const MAX_APPLY_TEXT_CHARS = 512;
const SAFE_LIFETIME_VALUES = {
  workRunState: new Set(["planned", "leased", "running", "awaiting_review", "completed", "failed", "cancelled"]),
  stage: new Set(["think", "plan", "build", "review", "test", "ship", "reflect"]),
  status: new Set(["active", "blocked", "done", "archived"]),
} as const;

function closedObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
  const objectValue = value as Record<string, unknown>;
  const allowed = new Set(keys);
  if (Object.keys(objectValue).some(key => !allowed.has(key))) throw new Error("unknown field");
  return objectValue;
}

function boundedText(value: unknown, max = MAX_APPLY_TEXT_CHARS): string {
  if (typeof value !== "string" || !value || value.length > max || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new Error("bounded text required");
  }
  return value;
}

function applyFingerprint(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function expectedCreatedWorkRunId(plan: RecoveryApplyRequestV2["plan"]): string {
  return `work-run/recovery-${plan.fingerprint.slice("sha256:".length, "sha256:".length + 32)}`;
}

function transitionTokenDigest(token: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

function validateOwnerReceipt(value: unknown, plan: RecoveryApplyRequestV2["plan"]): Record<string, unknown> {
  const owner = closedObject(value, OWNER_RECEIPT_KEYS);
  if (owner.ok !== true) throw new Error("owner receipt is not accepted");
  if (owner.idempotent !== undefined && typeof owner.idempotent !== "boolean") throw new Error("owner receipt flag is invalid");
  if (owner.projectId !== plan.projectId || owner.workItemId !== plan.workItemId) throw new Error("owner receipt identity conflict");
  boundedText(owner.projectId);
  boundedText(owner.workItemId);
  const expectedWorkRunId = plan.workRunId ?? expectedCreatedWorkRunId(plan);
  if (owner.workRunId !== expectedWorkRunId) throw new Error("owner receipt Work Run conflict");
  boundedText(owner.workRunId);
  if (owner.agent !== undefined) boundedText(owner.agent);
  if (owner.lifetime !== undefined) {
    const lifetime = closedObject(owner.lifetime, OWNER_LIFETIME_KEYS);
    for (const key of ["projectId", "workItemId", "workRunId", "agent"] as const) {
      if (lifetime[key] !== undefined) boundedText(lifetime[key]);
    }
    for (const key of ["workRunState", "stage", "status"] as const) {
      if (lifetime[key] !== undefined) {
        boundedText(lifetime[key], 64);
        if (!SAFE_LIFETIME_VALUES[key].has(lifetime[key] as string)) throw new Error("owner lifetime state is invalid");
      }
    }
    if (lifetime.projectId !== undefined && lifetime.projectId !== plan.projectId) throw new Error("owner lifetime Project conflict");
    if (lifetime.workItemId !== undefined && lifetime.workItemId !== plan.workItemId) throw new Error("owner lifetime Work Item conflict");
    if (lifetime.workRunId !== undefined && lifetime.workRunId !== expectedWorkRunId) throw new Error("owner lifetime Work Run conflict");
  }
  return owner;
}

/** Validate and bound the untrusted apply response before panel state can use it. */
export function validateRecoveryApplyResponse(
  value: unknown,
  plan: RecoveryApplyRequestV2["plan"],
  expectedTokenDigest?: `sha256:${string}`,
  expectedActor?: string,
): RecoveryApplyResponseV2 {
  try {
    if (!applyFingerprint(plan.fingerprint)) throw new Error("Plan fingerprint is invalid");
    const entry = closedObject(value, APPLY_RESPONSE_KEYS);
    if (entry.schemaVersion !== RECOVERY_APPLY_REQUEST_SCHEMA_VERSION.replace("request/", "")) {
      if (entry.schemaVersion !== "recovery-apply/v2") throw new Error("schema is invalid");
    }
    if (!(APPLY_STATES as readonly unknown[]).includes(entry.state)) throw new Error("state is invalid");
    if (entry.projectId !== plan.projectId || entry.planFingerprint !== plan.fingerprint) throw new Error("Plan identity conflict");
    if (!applyFingerprint(entry.planFingerprint) || !applyFingerprint(entry.tokenDigest) || !applyFingerprint(entry.fingerprint)) throw new Error("fingerprint is invalid");
    if (expectedTokenDigest && entry.tokenDigest !== expectedTokenDigest) throw new Error("token identity conflict");
    boundedText(entry.projectId);
    boundedText(entry.actorId);
    if (expectedActor !== undefined && entry.actorId !== expectedActor) throw new Error("response actor conflict");
    if (!(APPLY_KINDS as readonly unknown[]).includes(entry.kind) || entry.kind !== plan.kind) throw new Error("kind is invalid");
    if (entry.workRunId !== plan.workRunId && !(entry.workRunId === null && plan.workRunId === null)) throw new Error("Work Run identity conflict");
    if (!Array.isArray(entry.diagnostics) || entry.diagnostics.length > MAX_APPLY_DIAGNOSTICS) throw new Error("diagnostics are unbounded");
    for (const diagnostic of entry.diagnostics) {
      if (typeof diagnostic !== "string" || diagnostic.length > MAX_APPLY_DIAGNOSTIC_CHARS || /[\u0000-\u001f\u007f-\u009f]/u.test(diagnostic)) {
        throw new Error("diagnostic is malformed");
      }
      if (safePresentationText(diagnostic) !== diagnostic) throw new Error("diagnostic contains unsafe material");
    }
    const responseBase = { ...entry };
    delete responseBase.fingerprint;
    if (fingerprintRecoveryValue(responseBase) !== entry.fingerprint) throw new Error("response fingerprint conflict");

    let receipt: RecoveryApplyResponseV2["receipt"] = null;
    if (entry.state === "applied") {
      const rawReceipt = closedObject(entry.receipt, APPLY_RECEIPT_KEYS);
      if (rawReceipt.schemaVersion !== "recovery-apply/v2"
        || rawReceipt.planFingerprint !== plan.fingerprint
        || rawReceipt.projectId !== plan.projectId
        || rawReceipt.kind !== plan.kind
        || rawReceipt.workItemId !== plan.workItemId
        || rawReceipt.workRunId !== plan.workRunId
        || rawReceipt.ownerOperation !== (plan.kind === "resume" ? "workflow.agent.join" : "workflow.recovery.create-and-join")
        || !applyFingerprint(rawReceipt.tokenDigest)
        || rawReceipt.tokenDigest !== entry.tokenDigest
        || !applyFingerprint(rawReceipt.ownerReceiptFingerprint)
        || !applyFingerprint(rawReceipt.fingerprint)) throw new Error("applied receipt identity conflict");
      boundedText(rawReceipt.recordedAt);
      const ownerReceipt = validateOwnerReceipt(rawReceipt.ownerReceipt, plan);
      const ownerBase = { ...ownerReceipt };
      if (fingerprintRecoveryValue(ownerBase) !== rawReceipt.ownerReceiptFingerprint) throw new Error("owner receipt fingerprint conflict");
      const receiptBase = { ...rawReceipt };
      delete receiptBase.fingerprint;
      if (fingerprintRecoveryValue(receiptBase) !== rawReceipt.fingerprint) throw new Error("receipt fingerprint conflict");
      receipt = rawReceipt as unknown as RecoveryApplyResponseV2["receipt"];
    } else if (entry.receipt !== null) {
      throw new Error("non-applied response has a receipt");
    }
    return { ...entry, receipt } as RecoveryApplyResponseV2;
  } catch {
    throw new Error("Recovery apply response is unavailable");
  }
}

/**
 * Computes the apply token at the mutation boundary. The token is deliberately
 * not retained by the client or panel; the backend binds its digest to the
 * same Plan, planning input, and authenticated actor.
 */
export function recoveryApplyTransitionToken(input: RecoveryApplyTokenInput): string {
  const material = JSON.stringify({
    operation: RECOVERY_APPLY_OPERATION,
    projectId: input.projectId,
    planFingerprint: input.planFingerprint,
    confirmationActor: input.confirmationActor,
  });
  return `recovery-apply:${createHash("sha256").update(material, "utf8").digest("hex")}`;
}

/** Thin, stateless adapter over the shared read-only Operation transport. */
export class ProjectHubRecoveryClient {
  constructor(private readonly transport: SettingsOperationTransport) {}

  open(projectId: RecoveryProjectId): Promise<RecoveryFlowResponseV2> {
    return this.invoke({
      schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
      projectId,
      action: "open",
    });
  }

  search(request: RecoverySearchRequestV2): Promise<RecoveryFlowResponseV2> {
    return this.invoke(request);
  }

  plan(request: RecoveryPlanRequestV2): Promise<RecoveryFlowResponseV2> {
    return this.invoke(request);
  }

  refreshPlan(request: RecoveryRefreshPlanRequestV2): Promise<RecoveryFlowResponseV2> {
    return this.invoke(request);
  }

  restart(request: RecoveryRestartRequestV2): Promise<RecoveryFlowResponseV2> {
    return this.invoke(request);
  }

  apply(
    plan: RecoveryApplyRequestV2["plan"],
    planningInput: RecoveryApplyPlanningInput,
    confirmationActor: string,
  ): Promise<RecoveryApplyResponseV2> {
    if (typeof planningInput.query !== "string") throw new Error("Recovery apply query is unavailable");
    const query = planningInput.query.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (!query || query.length > 1_000 || new TextEncoder().encode(query).byteLength > 2_048
      || /[\u0000-\u001f\u007f-\u009f]/u.test(query) || safePresentationText(query) !== query) {
      throw new Error("Recovery apply query is unavailable");
    }
    if (!Number.isSafeInteger(planningInput.limit) || planningInput.limit < 1 || planningInput.limit > 25) {
      throw new Error("Recovery apply limit is unavailable");
    }
    const actor = confirmationActor.trim();
    if (!actor) throw new Error("Recovery confirmation actor is unavailable");
    const request: RecoveryApplyRequestV2 = {
      schemaVersion: RECOVERY_APPLY_REQUEST_SCHEMA_VERSION,
      plan,
      planFingerprint: plan.fingerprint,
      planningInput: { query, limit: planningInput.limit },
      transitionToken: recoveryApplyTransitionToken({
        projectId: plan.projectId,
        planFingerprint: plan.fingerprint,
        confirmationActor: actor,
      }),
    };
    return this.transport.invoke<unknown>(RECOVERY_APPLY_OPERATION, { request })
      .then(response => validateRecoveryApplyResponse(response, plan, transitionTokenDigest(request.transitionToken), actor));

  }
  private invoke(request: RecoveryFlowRequestV2): Promise<RecoveryFlowResponseV2> {
    return this.transport.invoke<RecoveryFlowResponseV2>(RECOVERY_FLOW_OPERATION, { request: { ...request } });
  }
}
