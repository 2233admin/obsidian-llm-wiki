import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fingerprintRecoveryValue, type RecoveryFingerprint } from '../project-hub/contract-support.js';
import type { OperationContext } from '../core/types.js';
import { createFileWorkRunStore, type WorkRunStore } from './work-run-store.js';
import { governWorkRunOutput, validateWorkflowAgentLeaveRequestV2, type WorkRunOutputV1 } from './output-governance.js';

const ids = { project: 'project/alpha', workItem: 'project/alpha/issue/build', workRun: 'work-run/run-1' };
const ctx: OperationContext = { vault: null as never, adapters: null, config: { vault_path: 'vault', collaboration: { actor: 'codex' } }, logger: { info() {}, warn() {}, error() {} }, dryRun: false };

function output(): WorkRunOutputV1 {
  const material = { schemaVersion: 'work-run-output/v1' as const, projectId: ids.project, workItemId: ids.workItem, workRunId: ids.workRun, outputClass: 'view' as const, payload: { artifactId: 'artifact/result' }, citations: ['issue:build'], provenance: ['test:output-governance'], producedAt: '2026-08-28T00:00:00.000Z' };
  return { ...material, fingerprint: fingerprintRecoveryValue(material) };
}

function store(): WorkRunStore & { claims: Map<string, Record<string, unknown>>; tokens: Map<string, Record<string, unknown>>; runs: Map<string, Record<string, unknown>> } {
  const claims = new Map<string, Record<string, unknown>>();
  const tokens = new Map<string, Record<string, unknown>>();
  const runs = new Map<string, Record<string, unknown>>();
  return {
    claims, tokens, runs, withLock: <T>(action: () => T) => action(), readRun: () => null, writeRunAtomic() {}, readLocalLease: () => null, writeLocalLeaseAtomic() {},
    readRecoveryClaim: () => null, writeRecoveryClaimAtomic() {}, readRecoveryToken: () => null, writeRecoveryTokenAtomic() {},
    readOutputClaim: (_project, fp) => claims.get(fp) ?? null, writeOutputClaimAtomic: (_project, fp, value) => { claims.set(fp, value); },
    readOutputToken: (_project, fp) => tokens.get(fp) ?? null, writeOutputTokenAtomic: (_project, fp, value) => { tokens.set(fp, value); },
    readOutputRun: (_project, fp) => runs.get(fp) ?? null, writeOutputRunAtomic: (_project, fp, value) => { runs.set(fp, value); },
    listOutputClaims: () => [...claims.values()],
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
    const dependencies = { store: workStore, owner: async () => { calls += 1; return { ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true, workRunId: ids.workRun } }; }, reconcile: async () => ({ state: 'accepted' as const, ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true, workRunId: ids.workRun } }) };
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
    const dependencies = { store: workStore, owner: async () => { calls += 1; await barrier; return { ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }; }, reconcile: async () => ({ state: 'accepted' as const, ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }) };
    const left = governWorkRunOutput(dependencies, ctx, request());
    const right = governWorkRunOutput(dependencies, ctx, request());
    await new Promise((resolve) => setTimeout(resolve, 0)); release();
    const [first, second] = await Promise.all([left, right]);
    assert.equal(calls, 1); assert.equal(first.fingerprint, second.fingerprint);
    await assert.rejects(() => governWorkRunOutput(dependencies, ctx, { ...request(), target_state: 'awaiting_review' }), /already bound/);
  });

  test('distinct valid outputs for one Work Run have one canonical winner', async () => {
    const workStore = store(); let calls = 0; let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const dependencies = { store: workStore, owner: async () => { calls += 1; await barrier; return { ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }; }, reconcile: async () => ({ state: 'accepted' as const, ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }) };
    const first = governWorkRunOutput(dependencies, ctx, request());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const material = { ...output(), payload: { artifactId: 'artifact/other' } } as Record<string, unknown>;
    delete material.fingerprint;
    const changedOutput = { ...material, fingerprint: fingerprintRecoveryValue(material) } as WorkRunOutputV1;
    const changedRequest: Record<string, unknown> = { ...request(), transition_token: 'leave:other', submission: { ...(request().submission as Record<string, unknown>), output: changedOutput, quarantine: null } };
    await assert.rejects(() => governWorkRunOutput(dependencies, ctx, changedRequest), /already bound/);
    release();
    assert.equal((await first).state, 'accepted');
    assert.equal(calls, 1);
  });

  test('missing token index repairs from the receipt without repeating the owner effect', async () => {
    const workStore = store(); let calls = 0; let tokenWrites = 0;
    const writeToken = workStore.writeOutputTokenAtomic;
    workStore.writeOutputTokenAtomic = (project, token, value) => {
      tokenWrites += 1;
      if (tokenWrites === 3) { workStore.tokens.delete(token); throw new Error('token index interrupted'); }
      writeToken(project, token, value);
    };
    const dependencies = { store: workStore, owner: async () => { calls += 1; return { ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }; }, reconcile: async () => ({ state: 'accepted' as const, ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }) };
    const first = await governWorkRunOutput(dependencies, ctx, request());
    assert.equal(first.state, 'accepted');
    assert.equal(workStore.tokens.size, 0);
    const replay = await governWorkRunOutput(dependencies, ctx, request());
    assert.equal(replay.fingerprint, first.fingerprint);
    assert.equal(workStore.tokens.size, 1);
    assert.equal(calls, 1);
  });

  test('pre-owner token write failure preserves a claimed retry and runs one owner effect', async () => {
    const workStore = store(); let calls = 0; let tokenWrites = 0;
    const writeToken = workStore.writeOutputTokenAtomic;
    workStore.writeOutputTokenAtomic = (project, token, value) => {
      tokenWrites += 1;
      if (tokenWrites === 1) throw new Error('token index interrupted before owner start');
      writeToken(project, token, value);
    };
    const dependencies = { store: workStore, owner: async () => { calls += 1; return { ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }; }, reconcile: async () => ({ state: 'accepted' as const, ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }) };
    const first = await governWorkRunOutput(dependencies, ctx, request());
    assert.equal(first.state, 'outcome-unknown');
    const claimed = [...workStore.claims.values()][0];
    assert.equal(claimed?.state, 'claimed');
    assert.equal(claimed?.ownerStarted, false);
    const replay = await governWorkRunOutput(dependencies, ctx, request());
    assert.equal(replay.state, 'accepted');
    assert.equal(calls, 1);
    const changed = { ...request(), target_state: 'awaiting_review' };
    await assert.rejects(() => governWorkRunOutput(dependencies, ctx, changed), /already bound/);
  });

  test('initial split index rebound finds the token claim before a second owner effect', async () => {
    const workStore = store(); let calls = 0; let tokenWrites = 0;
    const writeToken = workStore.writeOutputTokenAtomic;
    workStore.writeOutputTokenAtomic = (project, token, value) => {
      tokenWrites += 1;
      if (tokenWrites === 1) throw new Error('interrupted token index');
      writeToken(project, token, value);
    };
    const dependencies = { store: workStore, owner: async () => { calls += 1; return { ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }; } };
    const first = await governWorkRunOutput(dependencies, ctx, request());
    assert.equal(first.state, 'outcome-unknown');
    const changedMaterial = { ...output(), payload: { artifactId: 'artifact/changed' } };
    delete (changedMaterial as { fingerprint?: unknown }).fingerprint;
    const changed = { ...request(), submission: { ...(request().submission as Record<string, unknown>), output: { ...changedMaterial, fingerprint: fingerprintRecoveryValue(changedMaterial) }, quarantine: null } };
    await assert.rejects(() => governWorkRunOutput(dependencies, ctx, changed), /already bound/);
    assert.equal(calls, 0);
  });

  test('quarantine is a review receipt with bounded diagnostics and no owner effect', async () => {
    const workStore = store(); let calls = 0;
    const diagnostic = { owner: 'workflow', code: 'invalid-output', severity: 'error', message: 'Output was malformed.', remediation: 'Review and resubmit.', citationTargets: [] };
    const material = { schemaVersion: 'work-run-output-quarantine/v1' as const, projectId: ids.project, workItemId: ids.workItem, workRunId: ids.workRun, observedClass: null, payloadFingerprint: null, provenance: ['test:quarantine'], diagnostics: [diagnostic], producedAt: '2026-08-28T00:00:00.000Z' };
    const quarantine = { ...material, fingerprint: fingerprintRecoveryValue(material) };
    const quarantined = { ...request(), submission: { schemaVersion: 'work-run-output-submission/v1', result: 'quarantine', output: null, quarantine } };
    const dependencies = { store: workStore, owner: async () => { calls += 1; return { ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }; } };
    const first = await governWorkRunOutput(dependencies, ctx, quarantined);
    const replay = await governWorkRunOutput({ ...dependencies, owner: async () => { calls += 1; throw new Error('must not run'); } }, ctx, quarantined);
    assert.equal(first.state, 'review-required');
    assert.equal(replay.fingerprint, first.fingerprint);
    assert.equal(calls, 1);
    assert.equal(JSON.stringify([...workStore.claims.values(), ...workStore.tokens.values()]).includes('malformed raw payload'), false);
    assert.throws(() => validateWorkflowAgentLeaveRequestV2({ ...quarantined, submission: { ...quarantined.submission, quarantine: { ...quarantine, diagnostics: [{ ...diagnostic, citationTargets: 'not-an-array', message: 'malformed raw payload' }] } } }), /citationTargets must be an array/);
  });

  test('effect-free quarantine interruption reconciles to review instead of unknown', async () => {
    const workStore = store();
    const diagnostic = { owner: 'workflow', code: 'invalid-output', severity: 'error', message: 'Review required.', remediation: 'Inspect the bounded diagnostics.', citationTargets: [] };
    const material = { schemaVersion: 'work-run-output-quarantine/v1' as const, projectId: ids.project, workItemId: ids.workItem, workRunId: ids.workRun, observedClass: 'view' as const, payloadFingerprint: null, provenance: ['test:quarantine-restart'], diagnostics: [diagnostic], producedAt: '2026-08-28T00:00:00.000Z' };
    const quarantine = { ...material, fingerprint: fingerprintRecoveryValue(material) };
    const quarantined = { ...request(), submission: { schemaVersion: 'work-run-output-submission/v1', result: 'quarantine', output: null, quarantine } };
    const first = await governWorkRunOutput({
      store: workStore,
      owner: async () => { throw new Error('interrupted before safe route response'); },
      reconcile: async () => ({ state: 'review-required' as const, ownerOperation: null, ownerReceipt: null, diagnostics: [{ ...diagnostic, owner: 'workflow' as const, severity: 'error' as const }] }),
    }, ctx, quarantined);
    assert.equal(first.state, 'review-required');
    assert.equal((await governWorkRunOutput({ store: workStore, owner: async () => { throw new Error('must not retry'); } }, ctx, quarantined)).fingerprint, first.fingerprint);
  });

  test('malformed nonmatching claims fail closed during strict recovery scan', async () => {
    const workStore = store();
    workStore.claims.set('f'.repeat(64), { schemaVersion: 'work-run-output-route/v1', invalid: true });
    let calls = 0;
    const result = await governWorkRunOutput({ store: workStore, owner: async () => { calls += 1; return { ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }; } }, ctx, request());
    assert.equal(result.state, 'outcome-unknown');
    assert.equal(calls, 0);
  });

  test('accepted replay requires exact reconciled owner proof and rejects forgery', async () => {
    const workStore = store();
    const first = await governWorkRunOutput({ store: workStore, owner: async () => ({ ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }), reconcile: async () => ({ state: 'accepted' as const, ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }) }, ctx, request());
    assert.equal(first.state, 'accepted');
    const claim = [...workStore.runs.values()][0]!;
    const forged = JSON.parse(JSON.stringify(claim)) as Record<string, unknown>;
    const forgedReceipt = { ...(forged.receipt as Record<string, unknown>), ownerOperation: 'forged.owner', ownerReceiptFingerprint: fingerprintRecoveryValue({ ok: true, forged: true }) } as Record<string, unknown>;
    const forgedReceiptMaterial = { ...forgedReceipt };
    delete forgedReceiptMaterial.fingerprint;
    forgedReceipt.fingerprint = fingerprintRecoveryValue(forgedReceiptMaterial);
    forged.receipt = forgedReceipt;
    for (const target of [workStore.runs, workStore.claims, workStore.tokens]) target.set([...target.keys()][0]!, forged);
    const replay = await governWorkRunOutput({ store: workStore, owner: async () => { throw new Error('must not re-execute'); }, reconcile: async () => ({ state: 'accepted' as const, ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }) }, ctx, request());
    assert.equal(replay.state, 'outcome-unknown');
    assert.equal((workStore.runs.values().next().value as Record<string, unknown>).state, 'outcome-unknown');

    const nullOwnerStore = store();
    await governWorkRunOutput({ store: nullOwnerStore, owner: async () => ({ ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }), reconcile: async () => ({ state: 'accepted' as const, ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }) }, ctx, request());
    const nullClaim = JSON.parse(JSON.stringify([...nullOwnerStore.runs.values()][0]!)) as Record<string, unknown>;
    const nullReceipt = { ...(nullClaim.receipt as Record<string, unknown>), ownerOperation: null, ownerReceiptFingerprint: null } as Record<string, unknown>;
    const nullReceiptMaterial = { ...nullReceipt };
    delete nullReceiptMaterial.fingerprint;
    nullReceipt.fingerprint = fingerprintRecoveryValue(nullReceiptMaterial);
    nullClaim.receipt = nullReceipt;
    for (const target of [nullOwnerStore.runs, nullOwnerStore.claims, nullOwnerStore.tokens]) target.set([...target.keys()][0]!, nullClaim);
    const nullReplay = await governWorkRunOutput({ store: nullOwnerStore, owner: async () => { throw new Error('must not re-execute'); }, reconcile: async () => ({ state: 'accepted' as const, ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true } }) }, ctx, request());
    assert.equal(nullReplay.state, 'outcome-unknown');
  });

  test('file-store restart replays the canonical Work Run receipt without re-executing', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'llmwiki-output-restart-'));
    try {
      let calls = 0;
      const first = await governWorkRunOutput({ store: createFileWorkRunStore(vault), owner: async () => { calls += 1; return { ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true, workRunId: ids.workRun } }; }, reconcile: async () => ({ state: 'accepted' as const, ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true, workRunId: ids.workRun } }) }, { ...ctx, config: { ...ctx.config, vault_path: vault } }, request());
      const replay = await governWorkRunOutput({ store: createFileWorkRunStore(vault), owner: async () => { calls += 1; throw new Error('must not re-execute'); }, reconcile: async () => ({ state: 'accepted' as const, ownerOperation: 'workflow.agent.leave', ownerReceipt: { ok: true, workRunId: ids.workRun } }) }, { ...ctx, config: { ...ctx.config, vault_path: vault } }, request());
      assert.equal(first.state, 'accepted');
      assert.equal(replay.fingerprint, first.fingerprint);
      assert.equal(calls, 1);
    } finally {
      rmSync(vault, { recursive: true, force: true });
    }
  });
});
