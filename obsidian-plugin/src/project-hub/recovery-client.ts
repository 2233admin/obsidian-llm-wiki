import { createHash } from "node:crypto";
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
    const query = planningInput.query.trim();
    if (!query) throw new Error("Recovery apply query is unavailable");
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
    return this.transport.invoke<RecoveryApplyResponseV2>(RECOVERY_APPLY_OPERATION, { request });
  }

  private invoke(request: RecoveryFlowRequestV2): Promise<RecoveryFlowResponseV2> {
    return this.transport.invoke<RecoveryFlowResponseV2>(RECOVERY_FLOW_OPERATION, { request: { ...request } });
  }
}
