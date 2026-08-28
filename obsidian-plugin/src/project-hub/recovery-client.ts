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

export const RECOVERY_FLOW_OPERATION = "project.hub.recovery.flow" as const;
export const RECOVERY_FLOW_REQUEST_SCHEMA_VERSION = "project-hub-recovery-flow-request/v2" as const;

export type RecoveryPlanRequestV2 = RecoveryPlanFromSearchRequestV2 | RecoveryPlanOverrideRequestV2;
export type RecoveryProjectId = `project/${string}`;
export type ProjectId = RecoveryProjectId;
export type { RecoveryFlowResponseV2, RecoverySearchRequestV2, RecoveryRefreshPlanRequestV2, RecoveryRestartRequestV2 };

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

  private invoke(request: RecoveryFlowRequestV2): Promise<RecoveryFlowResponseV2> {
    return this.transport.invoke<RecoveryFlowResponseV2>(RECOVERY_FLOW_OPERATION, { request: { ...request } });
  }
}
