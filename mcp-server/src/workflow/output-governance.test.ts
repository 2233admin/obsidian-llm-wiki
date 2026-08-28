import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fingerprintRecoveryValue, type RecoveryFingerprint } from '../project-hub/contract-support.js';
import type { OperationContext } from '../core/types.js';
import type { WorkRunStore } from './work-run-store.js';
import { governWorkRunOutput, validateWorkflowAgentLeaveRequestV2, type WorkRunOutputV1 } from './output-governance.js';

const ids = { project: 'project/alpha', workItem: 'project/alpha/issue/build', workRun: 'work-run/run-1' };
const ctx: OperationContext = { vault: null as never, adapters: null, config: { vault_path: 'vault', collaboration: { actor: 'codex' } }, logger: { info() {}, warn() {}, error() {} }, dryRun: false };

function output(): WorkRunOutputV1 {
  const material = { schemaVersion: 'work-run-output/v1' as const, projectId: ids.project, workItemId: ids.workItem, workRunId: ids.workRun, outputClass: 'view' as const, payload: { artifactId: 'artifact/result' }, citations: ['issue:build'], provenance: ['test:output-governance'], producedAt: '2026-08-28T00:00:00.000Z' };
  return { ...material, fingerprint: fingerprintRecoveryValue(material) };
}

function store(): WorkRunStore & { claims: Map<string, Record<string, unknown>>; tokens: Map<string, Record<string, unknown>> } {
  const claims = new Map<string, Record<string, unknown>>();
  const tokens = new Map<string, Record<string, unknown>>();
  return {
    claims, tokens, withLock: <T>(action: () => T) => action(), readRun: () => null, writeRunAtomic() {}, readLocalLease: () => null, writeLocalLeaseAtomic() {},
    readRecoveryClaim: () => null, writeRecoveryClaimAtomic() {}, readRecoveryToken: () => null, writeRecoveryTokenAtomic() {},
    readOutputClaim: (_project, fp) => claims.get(fp) ?? null, writeOutputClaimAtomic: (_project, fp, value) => { claims.set(fp, value); },
    readOutputToken: (_project, fp) => tokens.get(fp) ?? null, writeOutputTokenAtomic: (_project, fp, value) => { tokens.set(fp, value); },
  };
}

function request(): Record<string, unknown> {
  return { mode: 'complete', project: ids.project, agent: 'codex', work_run_id: ids.workRun, transition_token: 'leave:one', target_state: 'completed', submission: { schemaVersion: 'work-run-output-submission/v1', result: 'output', output: output(), quarantine: null }, summary: 'completed' };
}

describe('claimed Work Run output governance', () => {
  test('closed leave union rejects legacy fields and invalid arms', () => {
    assert.throws(() => validateWorkflowAgentLeaveRequestV2({ ...request(), output_class: 'view' }), /unknown field/);
    assert.throws(() => validateWorkflowAgentLeaveRequestV2({ ...request(), mode: 'terminate', target_state: 'failed', submission: request().submission }), /submission:null/);
    assert.throws(() => validateWorkflowAgentLeaveRequestV2({ ...request(), mode: 'complete', target_state: 'failed' }), /target_state/);
  });

  test('claims before one owner effect and replays one durable receipt', async () => {
    const workStore = store(); let calls = 0;
    const dependencies = { store: workStore, owner: async () => { calls += 1; return { ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true, workRunId: ids.workRun } }; } };
    const first = await governWorkRunOutput(dependencies, ctx, request());
    const replay = await governWorkRunOutput(dependencies, ctx, request());
    assert.equal(first.state, 'accepted'); assert.equal(replay.fingerprint, first.fingerprint); assert.equal(calls, 1);
    assert.equal(JSON.stringify([...workStore.claims.values(), ...workStore.tokens.values()]).includes('leave:one'), false);
  });

  test('owner failure becomes outcome-unknown and cannot replay', async () => {
    const workStore = store(); let calls = 0;
    const dependencies = { store: workStore, owner: async () => { calls += 1; throw new Error('owner unavailable'); } };
    const first = await governWorkRunOutput(dependencies, ctx, request());
    const replay = await governWorkRunOutput(dependencies, ctx, request());
    assert.equal(first.state, 'outcome-unknown'); assert.equal(replay.state, 'outcome-unknown'); assert.equal(calls, 1);
  });

  test('same-token race shares one owner and rebound is rejected', async () => {
    const workStore = store(); let calls = 0; let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const dependencies = { store: workStore, owner: async () => { calls += 1; await barrier; return { ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }; } };
    const left = governWorkRunOutput(dependencies, ctx, request());
    const right = governWorkRunOutput(dependencies, ctx, request());
    await new Promise((resolve) => setTimeout(resolve, 0)); release();
    const [first, second] = await Promise.all([left, right]);
    assert.equal(calls, 1); assert.equal(first.fingerprint, second.fingerprint);
    await assert.rejects(() => governWorkRunOutput(dependencies, ctx, { ...request(), target_state: 'awaiting_review' }), /already bound/);
  });
});
