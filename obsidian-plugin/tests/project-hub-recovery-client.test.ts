import test from "node:test";
import assert from "node:assert/strict";
import {
  ProjectHubRecoveryClient,
  RECOVERY_FLOW_OPERATION,
  RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
} from "../src/project-hub/recovery-client";
import type {
  RecoveryPlanFromSearchRequestV2,
  RecoveryRefreshPlanRequestV2,
  RecoveryRestartRequestV2,
  RecoverySearchRequestV2,
} from "../../mcp-server/src/project-hub/recovery-flow";

const projectId = "project/alpha" as const;
const fingerprint = `sha256:${"a".repeat(64)}` as const;
const staleProof = {
  schemaVersion: "project-hub-recovery-stale-proof/v2" as const,
  projectId,
  rootOpenFlowFingerprint: fingerprint,
  priorFlowFingerprint: fingerprint,
  priorActionInputFingerprint: fingerprint,
  recoveryFingerprint: fingerprint,
  changedOwners: ["project" as const],
  citationTargets: ["issue:alpha"],
  fingerprint,
};
const plan = {
  schemaVersion: "project-hub-recovery-plan/v2" as const,
  projectId,
  rootOpenFlowFingerprint: fingerprint,
  searchedBasisFlowFingerprint: fingerprint,
  recoveryFingerprint: fingerprint,
  searchInputFingerprint: fingerprint,
  searchFingerprint: fingerprint,
  candidateSetFingerprint: fingerprint,
  candidateId: "resume:work-run/one",
  kind: "resume" as const,
  workItemId: "project/alpha/issue/alpha",
  workRunId: "work-run/one",
  agentSelection: { bindingId: "binding/alpha/builder", bindingRevision: 2, role: "builder", profileId: "agent/builder", profileRevision: 3 },
  ownerLocks: [],
  capabilityFacts: [],
  citationTargets: ["issue:alpha"],
  owningOperation: "workflow.recovery.apply" as const,
  createdAt: "2026-08-28T00:00:00.000Z",
  expiresAt: "2026-08-28T00:05:00.000Z",
  leaseDurationMs: 0 as const,
  fingerprint,
};

test("Recovery client forwards only the pinned read-only Operation payloads", async () => {
  const calls: Array<{ operation: string; args: Record<string, unknown> }> = [];
  const client = new ProjectHubRecoveryClient({
    async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ operation, args });
      return {} as T;
    },
  });
  await client.open(projectId);
  const search: RecoverySearchRequestV2 = {
    schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
    projectId,
    action: "search",
    openFlowFingerprint: fingerprint,
    query: " recovery ",
    limit: 5,
  };
  await client.search(search);
  const fromSearch: RecoveryPlanFromSearchRequestV2 = {
    schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
    projectId,
    action: "plan",
    mode: "from-search",
    openFlowFingerprint: fingerprint,
    searchedBasisFlowFingerprint: fingerprint,
    plannedFlowFingerprint: null,
    query: "recovery",
    limit: 5,
    candidateId: "resume:work-run/one",
    agentSelection: { bindingId: "binding/alpha/builder", bindingRevision: 2 },
    priorPlan: null,
  };
  await client.plan(fromSearch);
  const refresh: RecoveryRefreshPlanRequestV2 = {
    schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
    projectId,
    action: "refresh-plan",
    openFlowFingerprint: fingerprint,
    searchedBasisFlowFingerprint: fingerprint,
    plannedFlowFingerprint: fingerprint,
    query: "recovery",
    limit: 5,
    priorPlan: plan,
  };
  await client.refreshPlan(refresh);
  const restart: RecoveryRestartRequestV2 = {
    schemaVersion: RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
    projectId,
    action: "restart",
    staleProof,
  };
  await client.restart(restart);

  assert.deepEqual(calls.map(call => call.operation), [
    RECOVERY_FLOW_OPERATION,
    RECOVERY_FLOW_OPERATION,
    RECOVERY_FLOW_OPERATION,
    RECOVERY_FLOW_OPERATION,
    RECOVERY_FLOW_OPERATION,
  ]);
  assert.deepEqual(calls.map(call => (call.args.request as { action: string }).action), ["open", "search", "plan", "refresh-plan", "restart"]);
  assert.equal("apply" in client, false, "the preview client exposes no mutation method");
  assert.equal(JSON.stringify(calls).includes("token"), false);
});
