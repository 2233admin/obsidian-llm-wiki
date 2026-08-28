import test from "node:test";
import assert from "node:assert/strict";
import {
  ProjectHubRecoveryClient,
  RECOVERY_APPLY_OPERATION,
  RECOVERY_APPLY_REQUEST_SCHEMA_VERSION,
  RECOVERY_FLOW_OPERATION,
  RECOVERY_FLOW_REQUEST_SCHEMA_VERSION,
  recoveryApplyTransitionToken,
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

test("Recovery client forwards Flow and exact apply Operation payloads", async () => {
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
  await client.apply(plan, { query: " recovery ", limit: 5 }, "obsidian-control-plane");

  assert.deepEqual(calls.map(call => call.operation), [
    RECOVERY_FLOW_OPERATION,
    RECOVERY_FLOW_OPERATION,
    RECOVERY_FLOW_OPERATION,
    RECOVERY_FLOW_OPERATION,
    RECOVERY_FLOW_OPERATION,
    RECOVERY_APPLY_OPERATION,
  ]);
  assert.deepEqual(calls.slice(0, 5).map(call => (call.args.request as { action: string }).action), ["open", "search", "plan", "refresh-plan", "restart"]);
  const apply = calls[5]?.args.request as {
    schemaVersion: string;
    plan: typeof plan;
    planFingerprint: string;
    planningInput: { query: string; limit: number };
    transitionToken: string;
  };
  assert.equal(apply.schemaVersion, RECOVERY_APPLY_REQUEST_SCHEMA_VERSION);
  assert.deepEqual(apply.plan, plan);
  assert.equal(apply.planFingerprint, plan.fingerprint);
  assert.deepEqual(apply.planningInput, { query: "recovery", limit: 5 });
  assert.equal(apply.transitionToken, recoveryApplyTransitionToken({
    projectId,
    planFingerprint: plan.fingerprint,
    confirmationActor: "obsidian-control-plane",
  }));
  assert.equal(apply.transitionToken, recoveryApplyTransitionToken({
    projectId,
    planFingerprint: plan.fingerprint,
    confirmationActor: "obsidian-control-plane",
  }));
  assert.notEqual(apply.transitionToken, recoveryApplyTransitionToken({
    projectId,
    planFingerprint: plan.fingerprint,
    confirmationActor: "another-actor",
  }));
});

test("Recovery apply token binds operation, canonical Project, Plan fingerprint, and actor", () => {
  const base = recoveryApplyTransitionToken({ projectId, planFingerprint: fingerprint, confirmationActor: "actor-a" });
  assert.match(base, /^recovery-apply:[a-f0-9]{64}$/);
  assert.notEqual(base, recoveryApplyTransitionToken({ projectId: "project/beta", planFingerprint: fingerprint, confirmationActor: "actor-a" }));
  assert.notEqual(base, recoveryApplyTransitionToken({ projectId, planFingerprint: `sha256:${"b".repeat(64)}`, confirmationActor: "actor-a" }));
  assert.notEqual(base, recoveryApplyTransitionToken({ projectId, planFingerprint: fingerprint, confirmationActor: "actor-b" }));
});
