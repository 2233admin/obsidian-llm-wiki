import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintRecoveryValue } from '../project-hub/contract-support.js';
import { makeRecoveryApplyOperation, RECOVERY_APPLY_REQUEST_SCHEMA_VERSION, type RecoveryApplyDependencies } from './recovery-apply.js';
import type { WorkRunStore } from './work-run-store.js';

const projectId = 'project/alpha';
const planBase = {
  schemaVersion: 'project-hub-recovery-plan/v2' as const,
  projectId,
  rootOpenFlowFingerprint: `sha256:${'1'.repeat(64)}` as `sha256:${string}`,
  searchedBasisFlowFingerprint: `sha256:${'2'.repeat(64)}` as `sha256:${string}`,
  recoveryFingerprint: `sha256:${'3'.repeat(64)}` as `sha256:${string}`,
  searchInputFingerprint: `sha256:${'4'.repeat(64)}` as `sha256:${string}`,
  searchFingerprint: `sha256:${'5'.repeat(64)}` as `sha256:${string}`,
  candidateSetFingerprint: `sha256:${'6'.repeat(64)}` as `sha256:${string}`,
  candidateId: 'create:project/alpha/issue/build',
  kind: 'create' as const,
  workItemId: 'project/alpha/issue/build',
  workRunId: null,
  agentSelection: { role: 'builder', bindingId: 'binding/alpha/builder', bindingRevision: 2, profileId: 'agent/builder', profileRevision: 3 },
  ownerLocks: [
    'project', 'work-os', 'workflow', 'project-memory', 'session-record', 'source-evidence', 'agent-domain', 'settings',
  ].map((owner) => ({ owner, revision: 1, fingerprint: `sha256:${'a'.repeat(64)}` as `sha256:${string}`, state: 'current' as const })),
  capabilityFacts: [{ capability: 'workflow.recovery.plan', state: 'available' as const }],
  citationTargets: ['issue:build'],
  owningOperation: 'workflow.recovery.apply' as const,
  createdAt: '2026-08-28T00:00:00.000Z',
  expiresAt: '2026-08-28T00:05:00.000Z',
  leaseDurationMs: 900000 as const,
};
const plan = { ...planBase, fingerprint: fingerprintRecoveryValue(planBase) };

function memoryStore(): WorkRunStore & { claims: Map<string, Record<string, unknown>>; tokens: Map<string, Record<string, unknown>> } {
  const claims = new Map<string, Record<string, unknown>>();
  const tokens = new Map<string, Record<string, unknown>>();
  return {
    claims,
    tokens,
    withLock<T>(action: () => T): T { return action(); },
    readRun: () => null,
    writeRunAtomic: () => {},
    readLocalLease: () => null,
    writeLocalLeaseAtomic: () => {},
    readRecoveryClaim: (_project, fingerprint) => claims.get(fingerprint) ?? null,
    writeRecoveryClaimAtomic: (_project, fingerprint, value) => { claims.set(fingerprint, value); },
    readRecoveryToken: (_project, digest) => tokens.get(digest) ?? null,
    writeRecoveryTokenAtomic: (_project, digest, value) => { tokens.set(digest, value); },
    readOutputClaim: () => null,
    writeOutputClaimAtomic: () => {},
    readOutputToken: () => null,
    writeOutputTokenAtomic: () => {},
  };
}

function ctx(actor = 'codex') {
  return { vault: null as never, adapters: null, config: { vault_path: 'vault', collaboration: { actor } }, logger: { info() {}, warn() {}, error() {} }, dryRun: false };
}

function request(token = 'apply:one') {
  return { schemaVersion: RECOVERY_APPLY_REQUEST_SCHEMA_VERSION, plan, planFingerprint: plan.fingerprint, planningInput: { query: 'recovery', limit: 5 }, transitionToken: token };
}

function dependencies(store: WorkRunStore, owner: (token: string) => Promise<Record<string, unknown>>, now = Date.parse('2026-08-28T00:01:00.000Z')): RecoveryApplyDependencies {
  return { store, recomputeCurrentPlanBasis: async () => {}, join: async (_plan, _actor, token) => owner(token), createAndJoin: async (_plan, _actor, token) => owner(token), now: () => now };
}

test('apply is unavailable before its capability is registered and creates no claim', async () => {
  const store = memoryStore();
  const operation = makeRecoveryApplyOperation(undefined);
  const result = await operation.handler(ctx(), { request: request() });
  assert.equal((result as { state: string }).state, 'unavailable');
  assert.equal(store.claims.size, 0);
  assert.equal(store.tokens.size, 0);
});

test('claim-first apply records only digests and replays one receipt', async () => {
  const store = memoryStore();
  let calls = 0;
  let recomputes = 0;
  const operation = makeRecoveryApplyOperation({ ...dependencies(store, async (token) => { calls += 1; return { ok: true, workRunId: 'work-run/deterministic', token }; }), recomputeCurrentPlanBasis: async () => { recomputes += 1; } });
  const first = await operation.handler(ctx(), { request: request() }) as { state: string; receipt: Record<string, unknown> };
  assert.equal(first.state, 'applied');
  assert.equal(calls, 1);
  assert.equal(recomputes, 1);
  const persisted = JSON.stringify([...store.claims.values(), ...store.tokens.values()]);
  assert.equal(persisted.includes('apply:one'), false);
  assert.equal(persisted.includes('query'), false);
  const replay = await operation.handler(ctx(), { request: request() }) as { state: string; receipt: Record<string, unknown> };
  assert.equal(replay.state, 'applied');
  assert.deepEqual(replay.receipt, first.receipt);
  assert.equal(calls, 1);
  assert.equal(recomputes, 1);
});

test('planning-input rebound conflicts before another owner call', async () => {
  const store = memoryStore();
  let calls = 0;
  const operation = makeRecoveryApplyOperation(dependencies(store, async () => { calls += 1; return { ok: true }; }));
  await operation.handler(ctx(), { request: request() });
  await assert.rejects(() => operation.handler(ctx(), { request: { ...request(), planningInput: { query: 'different', limit: 5 } } }), /fingerprint|planning input/);
  assert.equal(calls, 1);
});

test('actor rebound and receipt-write interruption fail closed without replaying the owner', async () => {
  const store = memoryStore();
  let calls = 0;
  let failed = false;
  const writeClaim = store.writeRecoveryClaimAtomic.bind(store);
  const flakyStore = {
    ...store,
    writeRecoveryClaimAtomic(project: string, fingerprint: `sha256:${string}`, value: Record<string, unknown>) {
      if (!failed && value.state === 'applied') { failed = true; throw new Error('receipt write interrupted'); }
      writeClaim(project, fingerprint, value);
    },
  } as WorkRunStore;
  const operation = makeRecoveryApplyOperation(dependencies(flakyStore, async () => { calls += 1; return { ok: true }; }));
  const interrupted = await operation.handler(ctx(), { request: request() }) as { state: string };
  assert.equal(interrupted.state, 'outcome-unknown');
  assert.equal(calls, 1);
  await assert.rejects(() => operation.handler(ctx('other-actor'), { request: request() }), /actor|bound/);
  const replay = await operation.handler(ctx(), { request: request() }) as { state: string };
  assert.equal(replay.state, 'outcome-unknown');
  assert.equal(calls, 1);
});

test('claimed replay ignores Plan expiry and owner failure becomes outcome-unknown', async () => {
  const store = memoryStore();
  let now = Date.parse('2026-08-28T00:01:00.000Z');
  let calls = 0;
  const operation = makeRecoveryApplyOperation({ ...dependencies(store, async () => { calls += 1; throw new Error('owner unavailable'); }), now: () => now });
  const result = await operation.handler(ctx(), { request: request() }) as { state: string };
  assert.equal(result.state, 'outcome-unknown');
  now = Date.parse('2026-08-28T00:06:00.000Z');
  const replay = await operation.handler(ctx(), { request: request() }) as { state: string };
  assert.equal(replay.state, 'outcome-unknown');
  assert.equal(calls, 1);
});

test('unclaimed expired Plan is unavailable and two tokens cannot both claim it', async () => {
  const store = memoryStore();
  const operation = makeRecoveryApplyOperation(dependencies(store, async () => ({ ok: true }), Date.parse('2026-08-28T00:06:00.000Z')));
  const expired = await operation.handler(ctx(), { request: request('apply:expired') }) as { state: string };
  assert.equal(expired.state, 'unavailable');
  assert.equal(store.claims.size, 0);

  const winner = makeRecoveryApplyOperation(dependencies(store, async () => ({ ok: true, workRunId: 'work-run/one' })));
  const first = await winner.handler(ctx(), { request: request('apply:first') }) as { state: string };
  assert.equal(first.state, 'applied');
  await assert.rejects(() => winner.handler(ctx(), { request: request('apply:second') }), /already bound|claim identity conflict/);
  assert.equal(store.claims.size, 1);
});
