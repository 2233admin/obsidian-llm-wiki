import { assertClosedRecoveryObject } from '../project-hub/contract-support.js';
import {
  RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
  validateRecoveryFlowRequestV2,
  type RecoveryPlanFromSearchRequestV2,
  type RecoveryPlanOverrideRequestV2,
  type RecoveryRefreshPlanRequestV2,
} from '../project-hub/recovery-flow.js';
import type { RecoveryPlanningService } from '../project-hub/recovery-planning-service.js';
import type { Operation } from '../core/types.js';

export const WORKFLOW_RECOVERY_PLAN_REQUEST_SCHEMA_VERSION =
  'workflow-recovery-plan-request/v1' as const;

export interface WorkflowRecoveryPlanEnvelopeV1 {
  schemaVersion: typeof WORKFLOW_RECOVERY_PLAN_REQUEST_SCHEMA_VERSION;
  request:
    | RecoveryPlanFromSearchRequestV2
    | RecoveryPlanOverrideRequestV2
    | RecoveryRefreshPlanRequestV2;
}

export function validateWorkflowRecoveryPlanEnvelopeV1(
  value: unknown,
): WorkflowRecoveryPlanEnvelopeV1 {
  const entry = assertClosedRecoveryObject(
    value,
    ['schemaVersion', 'request'],
    'Workflow Recovery Plan request',
  );
  if (entry.schemaVersion !== WORKFLOW_RECOVERY_PLAN_REQUEST_SCHEMA_VERSION) {
    throw new Error('Workflow Recovery Plan request.schemaVersion has an invalid schema version');
  }
  const request = validateRecoveryFlowRequestV2(entry.request);
  if (request.action !== 'plan' && request.action !== 'refresh-plan') {
    throw new Error('Workflow Recovery Plan request.request must be a plan or refresh-plan action');
  }
  return {
    schemaVersion: WORKFLOW_RECOVERY_PLAN_REQUEST_SCHEMA_VERSION,
    request: request as WorkflowRecoveryPlanEnvelopeV1['request'],
  };
}

export function makeRecoveryPlanOperation(
  planningService: RecoveryPlanningService | undefined,
): Operation {
  return {
    name: 'workflow.recovery.plan',
    namespace: 'workflow',
    description: 'Compose a read-only Recovery Plan from a closed Project Hub Flow plan request.',
    mutating: false,
    params: {
      request: {
        type: 'object',
        required: true,
        description: `Closed ${WORKFLOW_RECOVERY_PLAN_REQUEST_SCHEMA_VERSION} envelope containing ${RECOVERY_FLOW_REQUEST_SCHEMA_VERSION} plan/from-search, plan/override, or refresh-plan request.`,
      },
    },
    handler: async (_ctx, params) => {
      if (!planningService) throw new Error('workflow.recovery.plan runtime is unavailable');
      const envelope = validateWorkflowRecoveryPlanEnvelopeV1(params.request);
      return planningService.plan(envelope.request);
    },
  };
}
