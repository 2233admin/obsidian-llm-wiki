import {
  composeRecoveryPlannedStage,
} from './action-plan.js';
import type {
  RecoveryCapabilityFactV2,
  RecoveryPlanFromSearchRequestV2,
  RecoveryPlanOverrideRequestV2,
  RecoveryRefreshPlanRequestV2,
  RecoveryPlannedResponseV2,
  RecoveryStaleResponseV2,
  RecoveryUnavailableResponseV2,
} from './recovery-flow.js';
import type { RecoveryOpenOwners } from './recovery-open.js';
import type { ProjectSearchSource } from './search-source.js';
import type { RecoveryAgentSelectionSource } from './agent-selection.js';

export interface RecoveryPlanDependencies {
  openOwners: RecoveryOpenOwners;
  searchSource?: ProjectSearchSource;
  agentSelection?: RecoveryAgentSelectionSource;
  now?: () => number;
  currentPlanned?: RecoveryPlannedResponseV2;
}

export interface RecoveryPlanningService {
  readonly capabilityFact: RecoveryCapabilityFactV2;
  plan(
    request:
      | RecoveryPlanFromSearchRequestV2
      | RecoveryPlanOverrideRequestV2
      | RecoveryRefreshPlanRequestV2,
  ): Promise<
    | RecoveryPlannedResponseV2
    | RecoveryStaleResponseV2
    | RecoveryUnavailableResponseV2
  >;
}

export function createRecoveryPlanningService(
  dependencies: RecoveryPlanDependencies,
): RecoveryPlanningService {
  return {
    capabilityFact: {
      capability: 'workflow.recovery.plan',
      state: 'available',
    },
    plan: (request) => composeRecoveryPlannedStage(request, dependencies) as Promise<
      | RecoveryPlannedResponseV2
      | RecoveryStaleResponseV2
      | RecoveryUnavailableResponseV2
    >,
  };
}
