import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fingerprintRecoveryValue } from '../project-hub/contract-support.js';
import { makeRecoveryApplyOperation, RECOVERY_APPLY_REQUEST_SCHEMA_VERSION, type RecoveryApplyDependencies } from './recovery-apply.js';
import { createDefaultRecoveryApplyDependencies } from './workflow.js';
import { createFileWorkRunStore, type WorkRunStore } from './work-run-store.js';

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
  return {
    store,
    recomputeCurrentPlanBasis: async () => {},
    join: async (_plan, _actor, token) => owner(token),
    createAndJoin: async (_plan, _actor, token) => owner(token),
    now: () => now,
    loadApplyCapability: async () => ({ capability: 'workflow.recovery.apply', state: 'available' }),
  };
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

test('apply capability is independently required even when the Plan capability is available', async () => {
  const store = memoryStore();
  let calls = 0;
  const operation = makeRecoveryApplyOperation({
    ...dependencies(store, async () => { calls += 1; return { ok: true }; }),
    loadApplyCapability: async () => ({ capability: 'workflow.recovery.apply', state: 'degraded' }),
  });
  const result = await operation.handler(ctx(), { request: request() }) as { state: string };
  assert.equal(result.state, 'unavailable');
  assert.equal(calls, 0);
  assert.equal(store.claims.size, 0);
  assert.equal(store.tokens.size, 0);
});

test('default Recovery apply composition is unavailable without an injected apply capability', async () => {
  const store = memoryStore();
  const dependencies = createDefaultRecoveryApplyDependencies('vault', store, {
    capabilityFact: { capability: 'workflow.recovery.plan', state: 'available' },
    plan: async () => ({ stage: 'planned', payload: { plan } } as any),
  });
  const result = await makeRecoveryApplyOperation(dependencies).handler(ctx(), { request: request() }) as { state: string };
  assert.equal(result.state, 'unavailable');
  assert.equal(store.claims.size, 0);
  assert.equal(store.tokens.size, 0);
});

test('same-token concurrent requests share one owner invocation and receipt', async () => {
  const store = memoryStore();
  let calls = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const operation = makeRecoveryApplyOperation(dependencies(store, async () => {
    calls += 1;
    await barrier;
    return { ok: true, projectId, workItemId: plan.workItemId, workRunId: 'work-run/current' };
  }));
  const first = operation.handler(ctx(), { request: request() });
  while (calls === 0) await Promise.resolve();
  const second = operation.handler(ctx(), { request: request() });
  release();
  const [left, right] = await Promise.all([first, second]) as Array<{ state: string; receipt: unknown }>;
  assert.equal(calls, 1);
  assert.equal(left.state, 'applied');
  assert.equal(right.state, 'applied');
  assert.deepEqual(left.receipt, right.receipt);
});

test('owner receipt uses a safe allowlist and drops canary material under benign keys', async () => {
  const store = memoryStore();
  const canaries = ['RAW_QUERY_CANARY', 'RAW_TOKEN_CANARY', 'RAW_PATH_CANARY', 'RAW_SECRET_CANARY', 'RAW_PROMPT_CANARY', 'RAW_TRANSCRIPT_CANARY', 'RAW_ARBITRARY_CANARY'];
  const deterministicWorkRunId = `work-run/recovery-${plan.fingerprint.slice('sha256:'.length, 'sha256:'.length + 32)}`;
  const operation = makeRecoveryApplyOperation(dependencies(store, async () => ({
    ok: true,
    projectId,
    workItemId: plan.workItemId,
    workRunId: deterministicWorkRunId,
    query: canaries[0],
    transition: canaries[1],
    path: canaries[2],
    description: canaries[3],
    arbitrary: canaries[6],
    lifetime: {
      projectId,
      workItemId: plan.workItemId,
      workRunId: deterministicWorkRunId,
      agent: 'codex',
      stage: canaries[0],
      prompt: canaries[4],
      transcript: canaries[5],
    },
  })));
  const result = await operation.handler(ctx(), { request: request() }) as { receipt: unknown };
  const serialized = JSON.stringify({ result, claims: [...store.claims.values()], tokens: [...store.tokens.values()] });
  for (const canary of canaries) assert.equal(serialized.includes(canary), false, canary);
  assert.deepEqual((result.receipt as any).ownerReceipt, { ok: true, projectId, workItemId: plan.workItemId, workRunId: deterministicWorkRunId, lifetime: { projectId, workItemId: plan.workItemId, workRunId: deterministicWorkRunId, agent: 'codex' } });
});

test('future-created Plans are rejected before a new claim', async () => {
  const store = memoryStore();
  const futureBase = { ...planBase, createdAt: '2026-08-28T00:02:00.000Z', expiresAt: '2026-08-28T00:07:00.000Z' };
  const futurePlan = { ...futureBase, fingerprint: fingerprintRecoveryValue(futureBase) };
  const futureRequest = { ...request(), plan: futurePlan, planFingerprint: futurePlan.fingerprint };
  let recomputes = 0;
  const operation = makeRecoveryApplyOperation({ ...dependencies(store, async () => ({ ok: true })), recomputeCurrentPlanBasis: async () => { recomputes += 1; } });
  const result = await operation.handler(ctx(), { request: futureRequest }) as { state: string };
  assert.equal(result.state, 'unavailable');
  assert.equal(recomputes, 0);
  assert.equal(store.claims.size, 0);
});

test('a missing token index is repaired from the canonical Plan without a second owner call', async () => {
  const store = memoryStore();
  let failTokenWrite = true;
  const originalTokenWrite = store.writeRecoveryTokenAtomic.bind(store);
  store.writeRecoveryTokenAtomic = (project, digest, value) => {
    if (failTokenWrite) { failTokenWrite = false; throw new Error('interrupted before token index'); }
    originalTokenWrite(project, digest, value);
  };
  let calls = 0;
  const operation = makeRecoveryApplyOperation(dependencies(store, async () => { calls += 1; return { ok: true, projectId, workItemId: plan.workItemId, workRunId: 'work-run/current' }; }));
  const first = await operation.handler(ctx(), { request: request() }) as { state: string };
  assert.equal(first.state, 'claimed');
  assert.equal(calls, 0);
  assert.equal(store.tokens.size, 0);
  const second = await operation.handler(ctx(), { request: request() }) as { state: string };
  assert.equal(second.state, 'applied');
  assert.equal(calls, 1);
  assert.equal(store.tokens.size, 1);
});

test('token index without its canonical Plan fails closed as outcome-unknown', async () => {
  const store = memoryStore();
  const token = 'apply:orphan';
  const tokenDigest = `sha256:${createHash('sha256').update(token, 'utf8').digest('hex')}` as `sha256:${string}`;
  store.tokens.set(tokenDigest, {
    schemaVersion: 'recovery-apply/v2', planFingerprint: plan.fingerprint, tokenDigest,
    planningInputDigest: fingerprintRecoveryValue({ query: 'recovery', limit: 5 }), actorId: 'codex', projectId,
    kind: plan.kind, workItemId: plan.workItemId, workRunId: plan.workRunId, state: 'applied', receipt: { unsafe: true },
    claimedAt: plan.createdAt, updatedAt: plan.createdAt, ownerStarted: true,
  });
  let calls = 0;
  const operation = makeRecoveryApplyOperation(dependencies(store, async () => { calls += 1; return { ok: true }; }));
  const result = await operation.handler(ctx(), { request: request(token) }) as { state: string };
  assert.equal(result.state, 'outcome-unknown');
  assert.equal(calls, 0);
  assert.equal(store.claims.size, 0);
});

test('production recovery apply persists real resume/create/replay files with injected clock and privacy', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-recovery-apply-'));
  const now = Date.parse('2026-08-28T00:01:00.000Z');
  try {
    mkdirSync(join(vault, 'Projects'), { recursive: true });
    mkdirSync(join(vault, '01-Projects', 'alpha', 'issues'), { recursive: true });
    writeFileSync(join(vault, 'Projects', 'alpha.md'), '---\ntype: project\nentity: project/alpha\nlifecycle: active\n---\n# Alpha\n');
    writeFileSync(join(vault, '01-Projects', 'alpha', '_project.md'), '---\ntype: project\nentity: project/alpha\n---\n');
    writeFileSync(join(vault, '01-Projects', 'alpha', 'issues', 'build.md'), '---\ntype: issue\nentity: project/alpha/issue/build\nstate: in-progress\n---\nBuild\n');
    const store = createFileWorkRunStore(vault);
    let currentPlan: any = plan;
    const planningService = {
      capabilityFact: { capability: 'workflow.recovery.plan' as const, state: 'available' as const },
      plan: async () => ({ stage: 'planned' as const, payload: { plan: currentPlan } }) as any,
    };
    const ctx = { vault: null as never, adapters: null, config: { vault_path: vault, collaboration: { actor: 'codex', role: 'agent' } }, logger: { info() {}, warn() {}, error() {} }, dryRun: false };
    const productionDependencies = createDefaultRecoveryApplyDependencies(vault, store, planningService, () => now, async () => ({ capability: 'workflow.recovery.apply', state: 'available' }));
    const apply = makeRecoveryApplyOperation(productionDependencies);

    const resumeRun = 'work-run/current';
    store.writeRunAtomic('alpha', resumeRun, {
      schema_version: 2, project_id: projectId, work_item_id: plan.workItemId, work_run_id: resumeRun, agent_id: 'codex', state: 'leased',
      output_class: 'view', approval_status: 'not-required', created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
      transitions: [], agent_profile_id: plan.agentSelection.profileId, agent_profile_revision: plan.agentSelection.profileRevision,
      project_agent_binding_id: plan.agentSelection.bindingId, project_agent_binding_revision: plan.agentSelection.bindingRevision,
    });
    store.writeLocalLeaseAtomic('codex', { agent_id: 'codex', project_id: projectId, work_item_id: plan.workItemId, work_run_id: resumeRun, acquired_at: now / 1000, expires_at: now / 1000 + 900 });
    const resumeBase = { ...planBase, kind: 'resume' as const, workRunId: resumeRun, candidateId: `resume:${resumeRun}`, leaseDurationMs: 0 as const };
    const resumePlan = { ...resumeBase, fingerprint: fingerprintRecoveryValue(resumeBase) };
    currentPlan = resumePlan;
    const resumeRequest = { schemaVersion: RECOVERY_APPLY_REQUEST_SCHEMA_VERSION, plan: resumePlan, planFingerprint: resumePlan.fingerprint, planningInput: { query: 'recovery', limit: 5 }, transitionToken: 'apply:resume' };
    const resumed = await apply.handler(ctx, { request: resumeRequest }) as any;
    assert.equal(resumed.state, 'applied');
    const resumeLifetime = readFileSync(join(vault, '01-Projects', 'alpha', 'agents', 'codex', 'lifetime.md'), 'utf8');
    assert.doesNotMatch(resumeLifetime, /apply:resume|RAW_QUERY_CANARY/);
    assert.ok(readFileSync(join(vault, '01-Projects', 'alpha', 'agents', 'codex', 'events.md'), 'utf8').includes('Agent Lifetime Events'));
    assert.ok(resumed.receipt);
    assert.deepEqual((await apply.handler(ctx, { request: resumeRequest }) as any).receipt, resumed.receipt);

    const createBase = { ...planBase, candidateId: 'create:project/alpha/issue/build', kind: 'create' as const, workRunId: null, leaseDurationMs: 900000 as const };
    const createPlan = { ...createBase, fingerprint: fingerprintRecoveryValue(createBase) };
    currentPlan = createPlan;
    const createRequest = { schemaVersion: RECOVERY_APPLY_REQUEST_SCHEMA_VERSION, plan: createPlan, planFingerprint: createPlan.fingerprint, planningInput: { query: 'recovery', limit: 5 }, transitionToken: 'apply:create' };
    const createCtx = { ...ctx, config: { ...ctx.config, collaboration: { actor: 'builder', role: 'agent' } } };
    const created = await apply.handler(createCtx, { request: createRequest }) as any;
    assert.equal(created.state, 'applied');
    const expectedRun = `work-run/recovery-${createPlan.fingerprint.slice('sha256:'.length, 'sha256:'.length + 32)}`;
    assert.ok(readFileSync(join(vault, '01-Projects', 'alpha', 'runs', `${expectedRun.slice('work-run/'.length)}.json`), 'utf8'));
    assert.doesNotMatch(readFileSync(join(vault, '01-Projects', 'alpha', 'agents', 'builder', 'events.md'), 'utf8'), /apply:create/);
    assert.equal((await apply.handler(createCtx, { request: createRequest }) as any).receipt.fingerprint, created.receipt.fingerprint);
    const persisted = readFileSync(join(vault, '01-Projects', 'alpha', 'runs', 'recovery-plans', `${createPlan.fingerprint.slice('sha256:'.length)}.json`), 'utf8');
    assert.doesNotMatch(persisted, /apply:create|RAW|query/i);

    const unavailable = makeRecoveryApplyOperation(createDefaultRecoveryApplyDependencies(vault, store, planningService, () => now, async () => ({ capability: 'workflow.recovery.apply', state: 'unavailable' })));
    const blockedPlanBase = { ...createBase, candidateId: 'create:project/alpha/issue/blocked' };
    const blockedPlan = { ...blockedPlanBase, fingerprint: fingerprintRecoveryValue(blockedPlanBase) };
    const blocked = await unavailable.handler(ctx, { request: { ...createRequest, plan: blockedPlan, planFingerprint: blockedPlan.fingerprint, transitionToken: 'apply:blocked' } }) as any;
    assert.equal(blocked.state, 'unavailable');
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});
