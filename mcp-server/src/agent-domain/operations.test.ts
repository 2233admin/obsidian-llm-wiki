import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, test } from 'node:test';

import {
  AgentDomainService,
  DreamTimeStore,
  canonicalDigest,
  dreamTimeSourceFingerprint,
  makeMemorySection,
  type DreamTimeWorkerInput,
  type MemoryProposal,
  type MemoryProposalCandidate,
  type MemoryRevision,
} from '../../../packages/agent-domain/dist/src/index.js';
import type { Operation, OperationContext } from '../core/types.js';
import { validateParams } from '../core/validate.js';
import { adjudicateOperationWrite } from '../core/write-policy.js';
import { normalizedProjectContext, resolveProjectContext } from '../project/project-context.js';
import { createSettingsService } from '../settings/settings.js';
import { UsageLedger } from '../usage/ledger.js';
import {
  AGENT_DOMAIN_RELATIVE_ROOT,
  USAGE_RELATIVE_ROOT,
  appendGovernedUsage,
  makeAgentDomainOps,
} from './operations.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = join(tmpdir(), `llmwiki-agent-ops-${randomUUID()}`);
  roots.push(root);
  mkdirSync(join(root, 'Projects'), { recursive: true });
  mkdirSync(join(root, '01-Projects', 'alpha', 'runs'), { recursive: true });
  writeFileSync(join(root, 'Projects', 'alpha.md'), [
    '---',
    'entity: project/alpha',
    'type: project',
    'status: active',
    '---',
    '',
    '# Alpha',
    '',
  ].join('\n'));
  writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'parent.json'), JSON.stringify({
    schema_version: 2,
    work_run_id: 'work-run/parent',
    project_id: 'project/alpha',
    state: 'running',
    artifact_projections: [{ artifact_id: 'artifact/run-input' }],
  }));
  return root;
}

function context(
  root: string,
  execute: OperationContext['vault']['execute'] = async () => ({}),
  allowedWritePaths: string[] = [],
  role = 'human',
  authenticatedActor = 'codex',
): OperationContext {
  return {
    vault: { execute },
    adapters: null,
    config: {
      vault_path: root,
      collaboration: { actor: authenticatedActor, role, allowed_write_paths: allowedWritePaths },
    },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: false,
  };
}

function operation(root: string, name: string): Operation {
  const item = makeAgentDomainOps(root).find((candidate) => candidate.name === name);
  assert.ok(item, `${name} operation exists`);
  return item;
}

async function invokeRegistered(
  registry: Map<string, Operation>,
  ctx: OperationContext,
  name: string,
  rawParams: Record<string, unknown>,
): Promise<unknown> {
  const item = registry.get(name);
  assert.ok(item, `${name} operation exists`);
  const params = validateParams(item.params, rawParams);
  adjudicateOperationWrite(ctx, item, params, registry);
  return item.handler(ctx, params);
}

async function seedAgentState(root: string, includePlanner = false): Promise<AgentDomainService> {
  const service = new AgentDomainService({ stateRoot: join(root, ...AGENT_DOMAIN_RELATIVE_ROOT.split('/')), clock: () => '2026-07-15T00:00:00.000Z' });
  const createProfile = (profileId: 'agent/researcher' | 'agent/planner', displayName: string) => service.createProfile({
    profileId, displayName, role: displayName, responsibilities: ['Preserve governed context'], capabilityClaims: ['source-synthesis'],
    constitution: { principles: ['Cite sources'], instructions: ['Preserve provenance'] },
    defaultModelPolicy: { mode: 'local' as const, provider: 'local', model: 'fixture-model' }, actor: 'codex',
  });
  await createProfile('agent/researcher', 'Researcher');
  if (includePlanner) await createProfile('agent/planner', 'Planner');
  await service.createBinding({
    projectId: 'project/alpha',
    projectContextFingerprint: canonicalDigest(normalizedProjectContext(resolveProjectContext(root, 'project/alpha'))),
    profileId: 'agent/researcher', profileRevision: 1, role: 'Project researcher', connectorGrantRefs: [], actor: 'codex',
  });
  if (includePlanner) {
    await service.createBinding({
      projectId: 'project/alpha',
      projectContextFingerprint: canonicalDigest(normalizedProjectContext(resolveProjectContext(root, 'project/alpha'))),
      profileId: 'agent/planner', profileRevision: 1, role: 'Project planner', connectorGrantRefs: [], actor: 'codex',
    });
  }
  return service;
}

const modelLock = {
  provider: 'local',
  model: 'fixture-model',
  contextWindow: 32_768,
  tokenizer: 'fixture-tokenizer/v1',
  policyFingerprint: canonicalDigest({ policy: 'fixture' }),
};

function scopedMemoryStore(root: string): DreamTimeStore {
  return new DreamTimeStore({
    memoryRoot: join(root, ...AGENT_DOMAIN_RELATIVE_ROOT.split('/'), 'dreamtime'),
    projectId: 'project/alpha',
    profileId: 'agent/researcher',
  });
}

async function proposeMemory(
  root: string,
  dreamOperation: DreamTimeWorkerInput['operation'],
  proposalId: `memory-proposal/${string}`,
  sourceIdentities: DreamTimeWorkerInput['sourceIdentities'],
  candidateDiff: MemoryProposalCandidate['candidateDiff'],
  options: Partial<Pick<MemoryProposalCandidate, 'provenance' | 'warnings'>> = {},
): Promise<MemoryProposal> {
  const current = await scopedMemoryStore(root).readCurrentRevision();
  const workerInput: DreamTimeWorkerInput = {
    operation: dreamOperation,
    projectId: 'project/alpha',
    profileId: 'agent/researcher',
    sourceIdentities,
    expectedRevision: current
      ? { revisionId: current.revisionId, revision: current.revision, fingerprint: current.fingerprint }
      : { revisionId: null, revision: 0, fingerprint: null },
    sourceFingerprint: '' as never,
    currentSections: current?.sections ?? {
      recentContext: makeMemorySection(),
      openItems: makeMemorySection(),
      stableMemory: makeMemorySection(),
    },
    protectedDirectives: current?.protectedDirectives ?? [],
    unresolvedConflicts: current?.unresolvedConflicts ?? [],
    modelLock,
    expiresAt: '2099-07-16T00:00:00.000Z',
  };
  workerInput.sourceFingerprint = dreamTimeSourceFingerprint(workerInput);
  const { currentSections: _currentSections, ...lockedCandidate } = workerInput;
  return operation(root, `dreamtime.${dreamOperation}.propose`).handler(context(root), {
    project: 'project/alpha',
    profileId: 'agent/researcher',
    workerInput,
    candidate: {
      ...lockedCandidate,
      proposalId,
      candidateDiff,
      provenance: options.provenance ?? sourceIdentities.revisionIds.map((id) => ({ kind: 'memoryRevision', id })),
      warnings: options.warnings ?? [],
    },
    actor: 'codex',
  }) as Promise<MemoryProposal>;
}

async function approveMemory(root: string, proposal: MemoryProposal, transitionToken: string): Promise<MemoryRevision> {
  const result = await operation(root, 'dreamtime.approve').handler(context(root), {
    project: 'project/alpha',
    profileId: 'agent/researcher',
    proposalId: proposal.proposalId,
    presentedFingerprint: proposal.fingerprint,
    expectedRevision: proposal.expectedRevision.revision,
    transitionToken,
    actor: 'codex',
  }) as { revision: MemoryRevision | null };
  assert.ok(result.revision);
  return result.revision;
}

describe('Agent Domain MCP operations', () => {
  test('publishes the complete Agent, Dream Time, Consult, and Delegation backend surface', () => {
    const root = fixture();
    const names = makeAgentDomainOps(root).map((item) => item.name);
    for (const name of [
      'agent.profile.create', 'agent.profile.read', 'agent.profile.list', 'agent.profile.update',
      'agent.binding.create', 'agent.binding.read', 'agent.binding.list', 'agent.binding.update',
      'agent.thread.create', 'agent.thread.read', 'agent.thread.list', 'agent.thread.append', 'agent.thread.transition',
      'agent.room.get', 'agent.context.compile',
      'dreamtime.checkpoint.propose', 'dreamtime.learn.propose', 'dreamtime.review.propose', 'dreamtime.proposal.read',
      'dreamtime.approve', 'dreamtime.reject', 'dreamtime.revision.current', 'dreamtime.revision.read',
      'dreamtime.revision.history', 'dreamtime.doctor', 'dreamtime.promotion.handoff',
      'dreamtime.cadence.status', 'dreamtime.cadence.run',
      'consult.execute', 'delegation.plan', 'delegation.approve', 'delegation.read', 'delegation.transition', 'delegation.artifact.project',
    ]) assert.ok(names.includes(name), `${name} is registered`);
  });

  test('registry vertical slice carries one approved Memory fingerprint across Room, replay, history, new Thread, and another device Context Envelope', async () => {
    const root = fixture();
    const ctx = context(root);
    const registry = new Map(makeAgentDomainOps(root).map((item) => [item.name, item]));
    const projectContext = normalizedProjectContext(resolveProjectContext(root, 'project/alpha'));
    const projectContextFingerprint = canonicalDigest(projectContext);

    const profileMutation = await invokeRegistered(registry, ctx, 'agent.profile.create', { input: {
      profileId: 'agent/researcher', displayName: 'Researcher', role: 'Project researcher', responsibilities: ['Gather evidence'],
      capabilityClaims: ['source-synthesis'], constitution: { principles: ['Cite sources'], instructions: ['Preserve provenance'] },
      defaultModelPolicy: { mode: 'local', provider: 'local', model: 'fixture-model' }, actor: 'codex',
    } }) as { status: string; record: Record<string, unknown> };
    assert.equal(profileMutation.status, 'committed');

    const bindingMutation = await invokeRegistered(registry, ctx, 'agent.binding.create', { input: {
      projectId: 'project/alpha', projectContextFingerprint, profileId: 'agent/researcher', profileRevision: 1,
      role: 'Project researcher', connectorGrantRefs: [], actor: 'codex',
    } }) as { status: string; record: Record<string, unknown> };
    assert.equal(bindingMutation.status, 'committed');

    const firstThread = await invokeRegistered(registry, ctx, 'agent.thread.create', { input: {
      threadId: 'thread/vertical-source', projectId: 'project/alpha', bindingId: 'binding/alpha/researcher', bindingRevision: 1,
      profileId: 'agent/researcher', profileRevision: 1, title: 'Vertical source', actor: 'codex',
    } }) as { status: string; record: { revision: number } };
    assert.equal(firstThread.status, 'committed');
    const appended = await invokeRegistered(registry, ctx, 'agent.thread.append', {
      threadId: 'thread/vertical-source', expectedRevision: firstThread.record.revision,
      reference: { kind: 'artifact', referenceId: 'artifact/vertical-input', recordedAt: '2026-07-15T00:00:00.000Z', citations: ['source/vertical-input'] },
      actor: 'codex',
    }) as { status: string; record: { revision: number } };
    assert.equal(appended.status, 'committed');

    const room = await invokeRegistered(registry, ctx, 'agent.room.get', {
      project: 'project/alpha', profileId: 'agent/researcher', threadId: 'thread/vertical-source',
    }) as { readOnly: boolean; identity: { threadRevision: number }; approvedMemory: null };
    assert.equal(room.readOnly, true);
    assert.equal(room.identity.threadRevision, appended.record.revision);
    assert.equal(room.approvedMemory, null);

    const sections = { recentContext: makeMemorySection(), openItems: makeMemorySection(), stableMemory: makeMemorySection() };
    const workerInput: DreamTimeWorkerInput = {
      operation: 'checkpoint', projectId: 'project/alpha', profileId: 'agent/researcher',
      sourceIdentities: {
        threadId: 'thread/vertical-source', revisionIds: [], artifactIds: ['artifact/vertical-input'], cutoffAt: '2026-07-15T00:00:00.000Z',
      },
      expectedRevision: { revisionId: null, revision: 0, fingerprint: null }, sourceFingerprint: '' as never,
      currentSections: sections, protectedDirectives: [], unresolvedConflicts: [], modelLock, expiresAt: '2099-07-16T00:00:00.000Z',
    };
    workerInput.sourceFingerprint = dreamTimeSourceFingerprint(workerInput);
    const { currentSections: _currentSections, ...candidateLocks } = workerInput;
    const proposal = await invokeRegistered(registry, ctx, 'dreamtime.checkpoint.propose', {
      project: 'project/alpha', profileId: 'agent/researcher', workerInput,
      candidate: {
        ...candidateLocks, proposalId: 'memory-proposal/vertical',
        candidateDiff: [{
          operation: 'replace', section: 'recentContext', beforeHash: null,
          after: makeMemorySection('Approved cross-device checkpoint', ['artifact/vertical-input']),
        }],
        provenance: [{ kind: 'thread', id: 'thread/vertical-source', revision: appended.record.revision }], warnings: [],
      },
      actor: 'codex',
    }) as { proposalId: string; fingerprint: string };

    const approvalParams = {
      project: 'project/alpha', profileId: 'agent/researcher', proposalId: proposal.proposalId,
      presentedFingerprint: proposal.fingerprint, expectedRevision: 0, transitionToken: 'approve-vertical-lost-response', actor: 'codex',
    };
    await invokeRegistered(registry, ctx, 'dreamtime.approve', approvalParams);
    const replay = await invokeRegistered(registry, ctx, 'dreamtime.approve', approvalParams) as { idempotent: boolean; revision: { fingerprint: string } };
    assert.equal(replay.idempotent, true);

    const current = await invokeRegistered(registry, ctx, 'dreamtime.revision.current', {
      project: 'project/alpha', profileId: 'agent/researcher',
    }) as { revisionId: string; revision: number; fingerprint: string; sections: { recentContext: { content: string } } };
    assert.equal(current.fingerprint, replay.revision.fingerprint);
    assert.equal(current.sections.recentContext.content, 'Approved cross-device checkpoint');
    const history = await invokeRegistered(registry, ctx, 'dreamtime.revision.history', {
      project: 'project/alpha', profileId: 'agent/researcher',
    }) as { revisions: Array<{ fingerprint: string }>; events: Array<{ action: string }> };
    assert.equal(history.revisions.length, 1);
    assert.equal(history.revisions[0]?.fingerprint, current.fingerprint);
    assert.equal(history.events.filter((event) => event.action === 'approved').length, 1);

    const resumedThread = await invokeRegistered(registry, ctx, 'agent.thread.create', { input: {
      threadId: 'thread/vertical-resume', projectId: 'project/alpha', bindingId: 'binding/alpha/researcher', bindingRevision: 1,
      profileId: 'agent/researcher', profileRevision: 1, title: 'Resume on test-5090', actor: 'codex',
    } }) as { status: string; record: { revision: number } };
    assert.equal(resumedThread.status, 'committed');

    const envelope = await invokeRegistered(registry, ctx, 'agent.context.compile', {
      project: 'project/alpha', envelopeId: 'envelope/vertical-5090', compiledAt: '2026-07-15T01:00:00.000Z', tokenBudget: 30_000,
      profileId: 'agent/researcher', expectedProfileRevision: 1,
      bindingId: 'binding/alpha/researcher', expectedBindingRevision: 1,
      memoryRevisionId: current.revisionId, expectedMemoryRevision: current.revision, expectedMemoryFingerprint: current.fingerprint,
      threadId: 'thread/vertical-resume', expectedThreadRevision: resumedThread.record.revision,
      capabilityGrantIds: [],
    }) as { fingerprint: string; layers: Array<{ name: string; chunks: Array<{ content: unknown }> }> };
    assert.match(envelope.fingerprint, /^sha256:[a-f0-9]{64}$/);
    const memoryLayer = envelope.layers.find((layer) => layer.name === 'governedWorkingMemory');
    assert.ok(memoryLayer);
    assert.equal(JSON.stringify(memoryLayer.chunks).includes(current.fingerprint), true);
    assert.equal(JSON.stringify(memoryLayer.chunks).includes('Approved cross-device checkpoint'), true);
  });

  test('Room returns one redacted repair matrix when its locked Profile and execution dependencies are unhealthy', async () => {
    const root = fixture();
    const service = await seedAgentState(root);
    const createdMutation = await service.createThread({
      threadId: 'thread/doctor-matrix', projectId: 'project/alpha', bindingId: 'binding/alpha/researcher', bindingRevision: 1,
      profileId: 'agent/researcher', profileRevision: 1, title: 'Doctor matrix', actor: 'codex',
    });
    assert.equal(createdMutation.status, 'committed');
    if (createdMutation.status !== 'committed') assert.fail('doctor matrix Thread creation must commit');
    await service.appendThreadReference('thread/doctor-matrix', createdMutation.record.revision, {
      kind: 'workRun', referenceId: 'work-run/parent', recordedAt: '2026-07-15T00:00:00.000Z', citations: [],
    }, 'codex');
    await service.updateBinding('binding/alpha/researcher', 1, {
      enabled: false,
      connectorGrantRefs: ['grant/unavailable-cloud'],
    }, 'codex');
    writeFileSync(join(root, 'Projects', 'alpha.md'), [
      '---', 'entity: project/alpha', 'type: project', 'status: active', 'aliases: [alpha-renamed]', '---', '', '# Alpha renamed', '',
    ].join('\n'));
    writeFileSync(join(root, '01-Projects', 'alpha', 'runs', 'parent.json'), JSON.stringify({
      schema_version: 2,
      work_run_id: 'work-run/parent',
      project_id: 'project/alpha',
      state: 'running',
      prompt_body: 'PRIVATE PROMPT MUST NOT LEAK',
      authorization: 'Bearer room-doctor-super-secret-token',
      workspace_path: 'C:\\Users\\someone\\private-repo',
    }));
    rmSync(join(root, ...AGENT_DOMAIN_RELATIVE_ROOT.split('/'), 'profiles', 'researcher', 'revisions', '000000000001.json'));

    const room = await operation(root, 'agent.room.get').handler(context(root), {
      project: 'project/alpha', profileId: 'agent/researcher', threadId: 'thread/doctor-matrix',
    }) as {
      state: string;
      identity: { profileId: string; profileRevision: number; bindingRevision: number };
      diagnostics: Array<{ code: string; severity: string; remediationKey: string }>;
    };
    assert.equal(room.state, 'degraded');
    assert.equal(room.identity.profileId, 'agent/researcher');
    assert.equal(room.identity.profileRevision, 1);
    assert.equal(room.identity.bindingRevision, 1);
    assert.deepEqual(room.diagnostics.map((diagnostic) => diagnostic.code), [
      'profile-revision-missing',
      'project-context-fingerprint-stale',
      'binding-revision-superseded',
      'work-run-unresolved',
    ]);
    for (const diagnostic of room.diagnostics) {
      assert.deepEqual(Object.keys(diagnostic).sort(), ['code', 'remediationKey', 'severity']);
    }
    const serialized = JSON.stringify(room);
    assert.doesNotMatch(serialized, /PRIVATE PROMPT|Bearer |C:\\\\Users|super-secret-token/);
  });

  test('checkpoint locks exact baseline bytes and canonical Thread artifacts before appending one Usage Event', async () => {
    const root = fixture();
    const service = await seedAgentState(root);
    await service.createThread({
      threadId: 'thread/checkpoint', projectId: 'project/alpha', bindingId: 'binding/alpha/researcher', bindingRevision: 1,
      profileId: 'agent/researcher', profileRevision: 1, title: 'Checkpoint source', actor: 'codex',
    });
    await service.appendThreadReference('thread/checkpoint', 1, {
      kind: 'artifact', referenceId: 'artifact/thread-input', recordedAt: '2026-07-15T00:00:00.000Z', citations: ['source/thread-input'],
    }, 'codex');

    const sections = {
      recentContext: makeMemorySection(),
      openItems: makeMemorySection(),
      stableMemory: makeMemorySection(),
    };
    const workerInput: DreamTimeWorkerInput = {
      operation: 'checkpoint', projectId: 'project/alpha', profileId: 'agent/researcher',
      sourceIdentities: {
        threadId: 'thread/checkpoint', revisionIds: [], artifactIds: ['artifact/thread-input'], cutoffAt: '2026-07-15T00:00:00.000Z',
      },
      expectedRevision: { revisionId: null, revision: 0, fingerprint: null },
      sourceFingerprint: '' as never,
      currentSections: sections,
      protectedDirectives: [], unresolvedConflicts: [], modelLock, expiresAt: '2099-07-16T00:00:00.000Z',
    };
    workerInput.sourceFingerprint = dreamTimeSourceFingerprint(workerInput);
    const { currentSections: _currentSections, ...candidateLocks } = workerInput;
    const candidate: MemoryProposalCandidate = {
      ...candidateLocks,
      proposalId: 'memory-proposal/checkpoint-operation',
      candidateDiff: [{
        operation: 'replace', section: 'recentContext', beforeHash: null,
        after: makeMemorySection('Checkpoint result', ['artifact/thread-input']),
      }],
      provenance: [{ kind: 'thread', id: 'thread/checkpoint', revision: 2 }], warnings: [],
    };
    const proposalParams = {
      project: 'project/alpha', profileId: 'agent/researcher', workerInput, candidate, actor: 'codex',
    };
    const created = await operation(root, 'dreamtime.checkpoint.propose').handler(context(root), proposalParams) as { proposalId: string; fingerprint: string };
    const replay = await operation(root, 'dreamtime.checkpoint.propose').handler(context(root), proposalParams) as { proposalId: string; fingerprint: string };
    assert.equal(created.proposalId, 'memory-proposal/checkpoint-operation');
    assert.equal(replay.fingerprint, created.fingerprint);

    const events = new UsageLedger(join(root, ...USAGE_RELATIVE_ROOT.split('/'))).list();
    assert.equal(events.length, 1);
    assert.equal(events[0]?.idempotencyKey, 'dreamtime-proposal:memory-proposal/checkpoint-operation');
    assert.deepEqual(events[0]?.providerFacts.inputTokens, { state: 'unknown', reason: 'not-reported' });
    assert.deepEqual(events[0]?.dimensions.device, { state: 'unknown', reason: 'unattributed' });

    const driftedInput = structuredClone(workerInput);
    driftedInput.currentSections.recentContext = makeMemorySection('unapproved drift');
    driftedInput.sourceFingerprint = dreamTimeSourceFingerprint(driftedInput);
    await assert.rejects(
      () => operation(root, 'dreamtime.checkpoint.propose').handler(context(root), {
        project: 'project/alpha', profileId: 'agent/researcher', workerInput: driftedInput,
        candidate: { ...candidate, sourceFingerprint: driftedInput.sourceFingerprint }, actor: 'codex',
      }),
      { code: -32010 },
    );
  });

  test('Dream Time cadence stays off by default and creates one replay-safe pending Work Run plus proposal when enabled', async () => {
    const root = fixture();
    const service = await seedAgentState(root);
    const thread = await service.createThread({
      threadId: 'thread/cadence-source', projectId: 'project/alpha', bindingId: 'binding/alpha/researcher', bindingRevision: 1,
      profileId: 'agent/researcher', profileRevision: 1, title: 'Cadence source', actor: 'codex',
    });
    assert.equal(thread.status, 'committed');
    if (thread.status !== 'committed') assert.fail('cadence source Thread must commit');
    await service.appendThreadReference('thread/cadence-source', thread.record.revision, {
      kind: 'artifact', referenceId: 'artifact/cadence-source', recordedAt: '2026-07-15T00:00:00.000Z', citations: ['source/cadence'],
    }, 'codex');

    const bootstrap = await proposeMemory(root, 'checkpoint', 'memory-proposal/cadence-bootstrap', {
      threadId: 'thread/cadence-source', revisionIds: [], artifactIds: ['artifact/cadence-source'], cutoffAt: '2026-07-15T00:00:00.000Z',
    }, [{
      operation: 'replace', section: 'recentContext', beforeHash: null,
      after: makeMemorySection('Bootstrap reviewed context', ['artifact/cadence-source']),
    }], { provenance: [{ kind: 'thread', id: 'thread/cadence-source', revision: 2 }] });
    const approved = await approveMemory(root, bootstrap, 'approve-cadence-bootstrap');

    const statusParams = {
      project: 'project/alpha', profileId: 'agent/researcher', cadence: 'daily', asOf: '2026-07-15T12:00:00.000Z',
    };
    const disabled = await operation(root, 'dreamtime.cadence.status').handler(context(root), statusParams) as Record<string, unknown>;
    assert.equal(disabled.projectId, 'project/alpha');
    assert.equal(disabled.operation, 'checkpoint');
    assert.equal(disabled.periodKey, '2026-07-15');
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.due, false);
    assert.equal(disabled.reason, 'disabled');
    assert.match(String(disabled.invocationId), /^dreamtime-cadence\/daily-2026-07-15-[a-f0-9]{24}$/);

    const settings = createSettingsService({
      vaultPath: root, workspaceProjectId: 'project/alpha', sessionId: 'cadence-test', clock: () => '2026-07-15T12:00:00.000Z',
    });
    const enabled = await settings.assignmentSet({
      scope: 'workspace-project', targetId: 'project/alpha', key: 'agents.dream_time.cadence.daily.enabled',
      value: true, expectedRevision: 0, updatedBy: 'codex',
    });
    assert.equal(enabled.status, 'committed');

    const due = await operation(root, 'dreamtime.cadence.status').handler(context(root), statusParams) as Record<string, unknown>;
    assert.equal(due.enabled, true);
    assert.equal(due.due, true);
    assert.equal(due.reason, 'due');

    const runParams = {
      ...statusParams,
      tokenBudget: 32_768,
      sourceIdentities: {
        threadId: 'thread/cadence-source', revisionIds: [], artifactIds: ['artifact/cadence-source'], cutoffAt: '2026-07-15T12:00:00.000Z',
      },
      candidateDiff: [{
        operation: 'replace', section: 'recentContext', beforeHash: approved.sections.recentContext.contentHash,
        after: makeMemorySection('Daily reviewed context', ['artifact/cadence-source']),
      }],
      provenance: [{ kind: 'thread', id: 'thread/cadence-source', revision: 2 }],
      warnings: [], expiresAt: '2026-07-16T12:00:00.000Z', actor: 'codex',
    };
    await assert.rejects(
      () => operation(root, 'dreamtime.cadence.run').handler(context(root), { ...runParams, expiresAt: 'not-a-timestamp' }),
      { code: -32602 },
    );
    const runDirectory = join(root, '01-Projects', 'alpha', 'runs');
    const cadenceRunsBeforeValidProposal = existsSync(runDirectory)
      ? readdirSync(runDirectory).filter(file => file.endsWith('.json')).filter((file) => {
        const value = JSON.parse(readFileSync(join(runDirectory, file), 'utf8')) as Record<string, unknown>;
        return Array.isArray(value.provenance) && value.provenance.includes(`dreamtime-cadence:${due.invocationId}`);
      })
      : [];
    assert.deepEqual(cadenceRunsBeforeValidProposal, []);

    const firstRegistry = new Map(makeAgentDomainOps(root).map((item) => [item.name, item]));
    const secondRegistry = new Map(makeAgentDomainOps(root).map((item) => [item.name, item]));
    const expectedCadenceWritePaths = [
      `${AGENT_DOMAIN_RELATIVE_ROOT}/**`,
      `${USAGE_RELATIVE_ROOT}/**`,
      '01-Projects/alpha/runs/**',
      '10-Projects/alpha/agents/**',
    ];
    const cadenceOperation = firstRegistry.get('dreamtime.cadence.run');
    assert.ok(cadenceOperation);
    for (const role of ['human', 'approver', 'admin']) {
      const verdict = adjudicateOperationWrite(
        context(root, undefined, [], role),
        cadenceOperation,
        runParams,
        firstRegistry,
      );
      assert.deepEqual(verdict.targets, expectedCadenceWritePaths);
    }
    assert.throws(
      () => adjudicateOperationWrite(
        context(root, undefined, expectedCadenceWritePaths, 'agent'),
        cadenceOperation,
        runParams,
        firstRegistry,
      ),
      /authenticated human, approver, or admin required/,
    );
    const unauthenticatedContext = context(root);
    unauthenticatedContext.config.collaboration = undefined;
    assert.throws(
      () => adjudicateOperationWrite(unauthenticatedContext, cadenceOperation, runParams, firstRegistry),
      /authenticated human, approver, or admin required/,
    );
    assert.throws(
      () => adjudicateOperationWrite(
        context(root),
        cadenceOperation,
        { ...runParams, project: 'alpha' },
        firstRegistry,
      ),
      /canonical Project ID/,
    );
    for (const unauthorizedTarget of ['01-Projects/beta/runs/**', 'README.md']) {
      const overbroadOperation: Operation = {
        ...cadenceOperation,
        mutating: true,
        writePolicy: {
          ...cadenceOperation.writePolicy!,
          targets: () => [
            `${AGENT_DOMAIN_RELATIVE_ROOT}/**`,
            `${USAGE_RELATIVE_ROOT}/**`,
            unauthorizedTarget,
            '10-Projects/alpha/agents/**',
          ],
        },
      };
      assert.throws(
        () => adjudicateOperationWrite(context(root), overbroadOperation, runParams, firstRegistry),
        /write targets exceed exact Project Context authority/,
      );
    }
    const [firstRequest, secondRequest] = await Promise.all([
      invokeRegistered(firstRegistry, context(root), 'dreamtime.cadence.run', runParams),
      invokeRegistered(secondRegistry, context(root), 'dreamtime.cadence.run', runParams),
    ]) as Array<{
      idempotent: boolean; workRunId: string; contextEnvelopeFingerprint: string;
      proposal: MemoryProposal;
    }>;
    assert.deepEqual([firstRequest.idempotent, secondRequest.idempotent].sort(), [false, true]);
    assert.equal(secondRequest.workRunId, firstRequest.workRunId);
    assert.equal(secondRequest.proposal.proposalId, firstRequest.proposal.proposalId);
    assert.equal(secondRequest.proposal.fingerprint, firstRequest.proposal.fingerprint);
    assert.equal(secondRequest.contextEnvelopeFingerprint, firstRequest.contextEnvelopeFingerprint);
    const created = firstRequest.idempotent ? secondRequest : firstRequest;
    const replay = await operation(root, 'dreamtime.cadence.run').handler(context(root), runParams) as typeof created;
    assert.equal(replay.idempotent, true);
    assert.equal(replay.workRunId, created.workRunId);
    assert.equal(replay.proposal.fingerprint, created.proposal.fingerprint);
    await assert.rejects(
      () => operation(root, 'dreamtime.cadence.run').handler(context(root), { ...runParams, tokenBudget: 16_384 }),
      { code: -32010 },
    );
    assert.match(created.contextEnvelopeFingerprint, /^sha256:[a-f0-9]{64}$/);
    assert.equal(created.proposal.approvalPolicy.mode, 'manual');
    assert.equal(created.proposal.approvalPolicy.autoApprovalHook.enabled, false);
    assert.equal((await scopedMemoryStore(root).readCurrentRevision())?.revisionId, approved.revisionId);

    const runPath = join(root, '01-Projects', 'alpha', 'runs', `${created.workRunId.slice('work-run/'.length)}.json`);
    assert.equal(existsSync(runPath), true);
    const workRun = JSON.parse(readFileSync(runPath, 'utf8')) as Record<string, unknown>;
    assert.equal(workRun.project_id, 'project/alpha');
    assert.equal(workRun.state, 'awaiting_review');
    assert.equal(workRun.output_class, 'knowledge-claim');
    assert.equal(workRun.approval_status, 'pending');
    assert.ok((workRun.provenance as string[]).includes(`dreamtime-proposal:${created.proposal.proposalId}`));
    const cadenceRuns = readdirSync(runDirectory).filter(file => file.endsWith('.json')).filter((file) => {
      const value = JSON.parse(readFileSync(join(runDirectory, file), 'utf8')) as Record<string, unknown>;
      return Array.isArray(value.provenance) && value.provenance.includes(`dreamtime-cadence:${due.invocationId}`);
    });
    assert.equal(cadenceRuns.length, 1);
    const proposalDirectory = join(root, ...AGENT_DOMAIN_RELATIVE_ROOT.split('/'), 'dreamtime', 'alpha', 'researcher', 'proposals');
    const cadenceProposalFile = `${created.proposal.proposalId.slice('memory-proposal/'.length)}.json`;
    assert.equal(readdirSync(proposalDirectory).filter(file => file === cadenceProposalFile).length, 1);

    const usage = new UsageLedger(join(root, ...USAGE_RELATIVE_ROOT.split('/'))).list();
    assert.equal(usage.length, 3);
    assert.equal(usage.filter(event => event.idempotencyKey === `dreamtime-proposal:${created.proposal.proposalId}`).length, 1);
    assert.equal(usage.filter(event => event.idempotencyKey === `dreamtime-cadence:${due.invocationId}`).length, 1);

    const completed = await operation(root, 'dreamtime.cadence.status').handler(context(root), statusParams) as Record<string, unknown>;
    assert.equal(completed.due, false);
    assert.equal(completed.reason, 'proposal-exists');
    assert.equal((completed.proposal as Record<string, unknown>).proposalId, created.proposal.proposalId);
  });

  test('learn and review operate only on approved revision citations and project complete history/doctor evidence', async () => {
    const root = fixture();
    const service = await seedAgentState(root);
    const thread = await service.createThread({
      threadId: 'thread/learn-review', projectId: 'project/alpha', bindingId: 'binding/alpha/researcher', bindingRevision: 1,
      profileId: 'agent/researcher', profileRevision: 1, title: 'Learn and review', actor: 'codex',
    });
    assert.equal(thread.status, 'committed');
    if (thread.status !== 'committed') assert.fail('learn/review source Thread must commit');
    await service.appendThreadReference('thread/learn-review', thread.record.revision, {
      kind: 'artifact', referenceId: 'artifact/learn-review-input', recordedAt: '2026-07-15T00:00:00.000Z', citations: ['source/learn-review-input'],
    }, 'codex');

    const checkpoint = await proposeMemory(root, 'checkpoint', 'memory-proposal/lifecycle-checkpoint', {
      threadId: 'thread/learn-review', revisionIds: [], artifactIds: ['artifact/learn-review-input'], cutoffAt: '2026-07-15T00:00:00.000Z',
    }, [{
      operation: 'replace', section: 'recentContext', beforeHash: null,
      after: makeMemorySection('Reviewed recent evidence', ['artifact/learn-review-input']),
    }], { provenance: [{ kind: 'thread', id: 'thread/learn-review', revision: 2 }] });
    const checkpointRevision = await approveMemory(root, checkpoint, 'approve-lifecycle-checkpoint');

    const learn = await proposeMemory(root, 'learn', 'memory-proposal/lifecycle-learn', {
      revisionIds: [checkpointRevision.revisionId], artifactIds: [], cutoffAt: '2026-07-15T00:30:00.000Z',
    }, [{
      operation: 'replace', section: 'stableMemory', beforeHash: checkpointRevision.sections.stableMemory.contentHash,
      after: makeMemorySection('Stable cited working fact', [checkpointRevision.revisionId]),
    }], {
      provenance: [{ kind: 'memoryRevision', id: checkpointRevision.revisionId, fingerprint: checkpointRevision.fingerprint }],
      warnings: [{ code: 'compression-review', severity: 'warning', message: 'Human review retained the source citation.', sourceRef: checkpointRevision.revisionId }],
    });
    const learnedRevision = await approveMemory(root, learn, 'approve-lifecycle-learn');

    await assert.rejects(
      () => proposeMemory(root, 'review', 'memory-proposal/review-citation-drift', {
        revisionIds: [checkpointRevision.revisionId, learnedRevision.revisionId], artifactIds: [], cutoffAt: '2026-07-15T01:00:00.000Z',
      }, [{
        operation: 'replace', section: 'stableMemory', beforeHash: learnedRevision.sections.stableMemory.contentHash,
        after: makeMemorySection('Citation drift', [learnedRevision.revisionId]),
      }]),
      (error: unknown) => (error as { code?: number; message?: string }).code === -32602
        && (error as { message?: string }).message?.includes('preserve the exact stable-memory citation set') === true,
    );

    const review = await proposeMemory(root, 'review', 'memory-proposal/lifecycle-review', {
      revisionIds: [checkpointRevision.revisionId, learnedRevision.revisionId], artifactIds: [], cutoffAt: '2026-07-15T01:00:00.000Z',
    }, [{
      operation: 'replace', section: 'stableMemory', beforeHash: learnedRevision.sections.stableMemory.contentHash,
      after: makeMemorySection('Stable cited fact', learnedRevision.sections.stableMemory.citations),
    }], { provenance: [{ kind: 'memoryRevision', id: learnedRevision.revisionId, fingerprint: learnedRevision.fingerprint }] });
    const reviewedRevision = await approveMemory(root, review, 'approve-lifecycle-review');

    const history = await operation(root, 'dreamtime.revision.history').handler(context(root), {
      project: 'project/alpha', profileId: 'agent/researcher',
    }) as { revisions: MemoryRevision[]; events: Array<{ action: string; exactDiff: unknown[]; provenance: unknown[] }> };
    assert.deepEqual(history.revisions.map((revision) => revision.revisionId), [
      checkpointRevision.revisionId, learnedRevision.revisionId, reviewedRevision.revisionId,
    ]);
    assert.deepEqual(history.revisions.map((revision) => revision.exactDiff[0]?.section), ['recentContext', 'stableMemory', 'stableMemory']);
    assert.deepEqual(history.events.map((event) => event.action), ['approved', 'approved', 'approved']);
    assert.ok(history.events.every((event) => event.exactDiff.length === 1 && event.provenance.length > 0));

    const doctor = await operation(root, 'dreamtime.doctor').handler(context(root), {
      project: 'project/alpha', profileId: 'agent/researcher',
    }) as {
      state: string;
      revisionCount: number;
      proposalSummaries: Array<{
        operation: string; lifecycle: string; warningCount: number; conflictCount: number;
        modelLock: typeof modelLock; provenance: Array<{ id: string }>;
      }>;
    };
    assert.equal(doctor.state, 'healthy');
    assert.equal(doctor.revisionCount, 3);
    assert.deepEqual(doctor.proposalSummaries.map((summary) => summary.operation).sort(), ['checkpoint', 'learn', 'review']);
    const learnSummary = doctor.proposalSummaries.find((summary) => summary.operation === 'learn');
    assert.ok(learnSummary);
    assert.equal(learnSummary.lifecycle, 'approved');
    assert.equal(learnSummary.warningCount, 1);
    assert.equal(learnSummary.conflictCount, 0);
    assert.deepEqual(learnSummary.modelLock, modelLock);
    assert.equal(learnSummary.provenance[0]?.id, checkpointRevision.revisionId);
  });

  test('learn rejects uncited claims and cross-section mutation before proposal persistence', async () => {
    const root = fixture();
    await seedAgentState(root);
    const store = scopedMemoryStore(root);
    const checkpoint = await store.createProposal({
      proposalId: 'memory-proposal/fail-closed-checkpoint', operation: 'checkpoint', projectId: 'project/alpha', profileId: 'agent/researcher',
      sourceIdentities: { threadId: 'thread/source', revisionIds: [], artifactIds: ['artifact/source'], cutoffAt: '2026-07-15T00:00:00.000Z' },
      expectedRevision: { revisionId: null, revision: 0, fingerprint: null }, sourceFingerprint: canonicalDigest({ source: 'fail-closed' }),
      candidateDiff: [{ operation: 'replace', section: 'recentContext', beforeHash: null, after: makeMemorySection('Approved source', ['artifact/source']) }],
      protectedDirectives: [], unresolvedConflicts: [], provenance: [{ kind: 'artifact', id: 'artifact/source' }], warnings: [],
      modelLock, expiresAt: '2099-07-16T00:00:00.000Z',
    }, 'codex');
    const approved = await store.approve(checkpoint.proposalId, {
      presentedFingerprint: checkpoint.fingerprint, expectedRevision: 0, transitionToken: 'approve-fail-closed-checkpoint', actor: 'codex',
      authorize: async () => ({ allowed: true, policyVersion: 'test/v1', reason: 'Fixture approval' }),
    });
    assert.ok(approved.revision);

    await assert.rejects(
      () => proposeMemory(root, 'learn', 'memory-proposal/uncited-claim', {
        revisionIds: [approved.revision!.revisionId], artifactIds: [], cutoffAt: '2026-07-15T00:30:00.000Z',
      }, [{
        operation: 'replace', section: 'stableMemory', beforeHash: approved.revision!.sections.stableMemory.contentHash,
        after: makeMemorySection('Unsupported new claim'),
      }]),
      (error: unknown) => (error as { code?: number; message?: string }).code === -32602
        && (error as { message?: string }).message?.includes('requires artifact or revision citations') === true,
    );
    await assert.rejects(
      () => proposeMemory(root, 'learn', 'memory-proposal/cross-section', {
        revisionIds: [approved.revision!.revisionId], artifactIds: [], cutoffAt: '2026-07-15T00:30:00.000Z',
      }, [{
        operation: 'replace', section: 'recentContext', beforeHash: approved.revision!.sections.recentContext.contentHash,
        after: makeMemorySection('Cross-section mutation', [approved.revision!.revisionId]),
      }]),
      (error: unknown) => (error as { code?: number; message?: string }).code === -32602
        && (error as { message?: string }).message?.includes('learn cannot mutate recentContext') === true,
    );
    assert.equal((await store.listRevisions()).length, 1);
    assert.equal(await store.readProposal('memory-proposal/uncited-claim'), null);
    assert.equal(await store.readProposal('memory-proposal/cross-section'), null);
  });

  test('learn rejects an approved source revision that has no Recent Context evidence', async () => {
    const root = fixture();
    await seedAgentState(root);
    const store = scopedMemoryStore(root);
    const openItemsOnly = await store.createProposal({
      proposalId: 'memory-proposal/open-items-only', operation: 'checkpoint', projectId: 'project/alpha', profileId: 'agent/researcher',
      sourceIdentities: { threadId: 'thread/source', revisionIds: [], artifactIds: ['artifact/source'], cutoffAt: '2026-07-15T00:00:00.000Z' },
      expectedRevision: { revisionId: null, revision: 0, fingerprint: null }, sourceFingerprint: canonicalDigest({ source: 'open-items-only' }),
      candidateDiff: [{ operation: 'replace', section: 'openItems', beforeHash: null, after: makeMemorySection('Unfinished task', ['artifact/source']) }],
      protectedDirectives: [], unresolvedConflicts: [], provenance: [{ kind: 'artifact', id: 'artifact/source' }], warnings: [],
      modelLock, expiresAt: '2099-07-16T00:00:00.000Z',
    }, 'codex');
    const approved = await store.approve(openItemsOnly.proposalId, {
      presentedFingerprint: openItemsOnly.fingerprint, expectedRevision: 0, transitionToken: 'approve-open-items-only', actor: 'codex',
      authorize: async () => ({ allowed: true, policyVersion: 'test/v1', reason: 'Fixture approval' }),
    });
    assert.ok(approved.revision);

    await assert.rejects(
      () => proposeMemory(root, 'learn', 'memory-proposal/no-recent-context', {
        revisionIds: [approved.revision!.revisionId], artifactIds: [], cutoffAt: '2026-07-15T00:30:00.000Z',
      }, [{
        operation: 'replace', section: 'stableMemory', beforeHash: approved.revision!.sections.stableMemory.contentHash,
        after: makeMemorySection('Cannot learn from open items alone', [approved.revision!.revisionId]),
      }]),
      (error: unknown) => (error as { code?: number; message?: string }).code === -32602
        && (error as { message?: string }).message?.includes('non-empty approved Recent Context') === true,
    );
    assert.equal(await store.readProposal('memory-proposal/no-recent-context'), null);
  });

  test('review cannot delete a protected section and approval leaves the revision chain unchanged', async () => {
    const root = fixture();
    await seedAgentState(root);
    const store = scopedMemoryStore(root);
    const protectedCheckpoint = await store.createProposal({
      proposalId: 'memory-proposal/protected-checkpoint', operation: 'checkpoint', projectId: 'project/alpha', profileId: 'agent/researcher',
      sourceIdentities: { threadId: 'thread/source', revisionIds: [], artifactIds: ['artifact/source'], cutoffAt: '2026-07-15T00:00:00.000Z' },
      expectedRevision: { revisionId: null, revision: 0, fingerprint: null }, sourceFingerprint: canonicalDigest({ source: 'protected' }),
      candidateDiff: [{ operation: 'replace', section: 'recentContext', beforeHash: null, after: makeMemorySection('Protected baseline', ['artifact/source']) }],
      protectedDirectives: [{ directiveId: 'directive/stable-memory', kind: 'must-keep', section: 'stableMemory', reason: 'Retain stable memory even while empty.' }],
      unresolvedConflicts: [], provenance: [{ kind: 'artifact', id: 'artifact/source' }], warnings: [],
      modelLock, expiresAt: '2099-07-16T00:00:00.000Z',
    }, 'codex');
    const approved = await store.approve(protectedCheckpoint.proposalId, {
      presentedFingerprint: protectedCheckpoint.fingerprint, expectedRevision: 0, transitionToken: 'approve-protected-checkpoint', actor: 'codex',
      authorize: async () => ({ allowed: true, policyVersion: 'test/v1', reason: 'Fixture approval' }),
    });
    assert.ok(approved.revision);
    const review = await proposeMemory(root, 'review', 'memory-proposal/protected-deletion', {
      revisionIds: [approved.revision!.revisionId], artifactIds: [], cutoffAt: '2026-07-15T00:30:00.000Z',
    }, [{
      operation: 'remove', section: 'stableMemory', beforeHash: approved.revision!.sections.stableMemory.contentHash, after: null,
    }]);

    await assert.rejects(
      () => operation(root, 'dreamtime.approve').handler(context(root), {
        project: 'project/alpha', profileId: 'agent/researcher', proposalId: review.proposalId,
        presentedFingerprint: review.fingerprint, expectedRevision: 1, transitionToken: 'reject-protected-deletion', actor: 'codex',
      }),
      (error: unknown) => (error as { code?: number; message?: string }).code === -32010
        && (error as { message?: string }).message?.includes('protected memory section') === true,
    );
    assert.equal((await store.readCurrentRevision())?.fingerprint, approved.revision!.fingerprint);
    assert.equal((await store.listRevisions()).length, 1);
    assert.equal(await store.readDecision(review.proposalId), null);
  });

  test('Context Consult replays one as-of artifact and one Usage Event without mutating memory', async () => {
    const root = fixture();
    const service = await seedAgentState(root, true);
    const memoryStore = new DreamTimeStore({
      memoryRoot: join(root, ...AGENT_DOMAIN_RELATIVE_ROOT.split('/'), 'dreamtime'),
      projectId: 'project/alpha', profileId: 'agent/researcher', clock: () => '2026-07-15T00:00:00.000Z',
    });
    const proposal = await memoryStore.createProposal({
      proposalId: 'memory-proposal/consult-source', operation: 'checkpoint', projectId: 'project/alpha', profileId: 'agent/researcher',
      sourceIdentities: { threadId: 'thread/source', revisionIds: [], artifactIds: ['artifact/source'], cutoffAt: '2026-07-15T00:00:00.000Z' },
      expectedRevision: { revisionId: null, revision: 0, fingerprint: null }, sourceFingerprint: canonicalDigest({ consult: 'source' }),
      candidateDiff: [{ operation: 'replace', section: 'recentContext', beforeHash: null, after: makeMemorySection('Consultable context', ['artifact/source']) }],
      protectedDirectives: [], unresolvedConflicts: [], provenance: [{ kind: 'artifact', id: 'artifact/source' }], warnings: [],
      modelLock, expiresAt: '2099-07-16T00:00:00.000Z',
    }, 'codex');
    const approved = await memoryStore.approve(proposal.proposalId, {
      presentedFingerprint: proposal.fingerprint, expectedRevision: 0, transitionToken: 'approve-consult-source', actor: 'codex',
      authorize: async () => ({ allowed: true, policyVersion: 'test/v1', reason: 'Fixture approval' }),
    });
    assert.ok(approved.revision);
    const consultPlanInput = {
      planId: 'delegation-plan/consult-operation', projectId: 'project/alpha', parentWorkRunId: 'work-run/parent',
      objective: 'Consult one exact approved target memory revision',
      assignment: {
        assignmentPlanId: 'assignment-plan/consult-operation', assignmentPlanVersion: 1,
        assignmentPlanFingerprint: canonicalDigest({ assignment: 'consult-operation' }),
        deviceSnapshot: {
          snapshotId: 'device-snapshot/consult-operation', deviceId: 'device/test-5090', revision: 1,
          fingerprint: canonicalDigest({ device: 'consult-operation' }), capturedAt: '2026-07-15T00:00:00.000Z', expiresAt: '2099-07-16T00:00:00.000Z',
        },
        profileId: 'agent/planner', profileRevision: 1, bindingId: 'binding/alpha/planner', bindingRevision: 1,
        contextEnvelopeFingerprint: canonicalDigest({ context: 'consult-operation' }),
      },
      inputArtifactIds: [],
      requestedCapabilityScope: {
        connectors: ['agent-memory'], operations: ['context.consult'],
        resources: [`agent/researcher@${approved.revision.revisionId}`], sideEffectClasses: ['read-only'],
      },
      budget: { policyVersion: 'budget/v1', maxInputTokens: 1000, maxOutputTokens: 500, maxDurationMs: 60_000 },
      expiresAt: '2099-07-16T00:00:00.000Z',
      expectedOutput: { outputClass: 'run-output', mediaType: 'application/json', requiredArtifactCount: 1, acceptanceCriteria: ['Read only'] },
      sideEffectPolicy: { externalEffectsRequirePerRunApproval: true, requestedExternalClasses: [] },
      provenance: [{ kind: 'workRun', id: 'work-run/parent' }], createdAt: '2026-07-15T00:00:00.000Z', createdBy: 'codex',
    };
    const consultPlan = await operation(root, 'delegation.plan').handler(context(root), {
      project: 'project/alpha', input: consultPlanInput, actor: 'codex',
    }) as { fingerprint: string };
    const issued = await operation(root, 'delegation.approve').handler(context(root), {
      project: 'project/alpha', planId: 'delegation-plan/consult-operation', presentedFingerprint: consultPlan.fingerprint,
      expectedRevision: 1, transitionToken: 'approve-consult-operation', approvedExternalClasses: [], actor: 'codex',
    }) as { child: { workRunId: string }; grant: { grantId: string; policyDecision: Record<string, unknown> } };
    const params = {
      project: 'project/alpha',
      request: {
        requestId: 'context-consult/operation', projectId: 'project/alpha',
        requestingAgent: { profileId: 'agent/planner', profileRevision: 1, workRunId: issued.child.workRunId },
        targetAgent: { profileId: 'agent/researcher', profileRevision: 1 }, attachTo: { kind: 'workRun', id: 'work-run/parent' },
        objective: 'Read approved context only', requestedSections: ['recentContext'],
        asOf: { revisionId: approved.revision.revisionId, revision: approved.revision.revision, fingerprint: approved.revision.fingerprint },
        contextFingerprint: canonicalDigest({ context: 'requester' }), capabilityGrantId: issued.grant.grantId,
        authorizationDecision: issued.grant.policyDecision, provenance: [{ kind: 'workRun', id: issued.child.workRunId }],
        createdAt: '2026-07-15T00:00:00.000Z', expiresAt: '2099-07-16T00:00:00.000Z',
      },
      invocationToken: 'consult-operation-token',
      workerOutput: {
        content: { answer: 'Consultable context' }, mediaType: 'application/json', outputClass: 'durable-knowledge-candidate',
        provenance: [{ kind: 'memoryRevision', id: approved.revision.revisionId, fingerprint: approved.revision.fingerprint }],
      },
      inputArtifactIds: [], actor: 'codex',
    };
    const first = await operation(root, 'consult.execute').handler(context(root), params) as { idempotent: boolean; result: { fingerprint: string } };
    const replay = await operation(root, 'consult.execute').handler(context(root), params) as { idempotent: boolean; result: { fingerprint: string } };
    assert.equal(first.idempotent, false);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.result.fingerprint, first.result.fingerprint);
    assert.equal((await memoryStore.readCurrentRevision())?.fingerprint, approved.revision.fingerprint);
    const events = new UsageLedger(join(root, ...USAGE_RELATIVE_ROOT.split('/'))).list();
    assert.equal(events.filter((event) => event.idempotencyKey === 'context-consult:context-consult/operation').length, 1);
    await assert.rejects(
      () => operation(root, 'consult.execute').handler(context(root), {
        ...params,
        invocationToken: 'consult-forged-authorization-token',
        request: {
          ...params.request,
          requestId: 'context-consult/forged-authorization',
          authorizationDecision: { ...params.request.authorizationDecision, reason: 'Client-forged authorization' },
        },
      }),
      (error: unknown) => (error as { code?: number; message?: string }).code === -32010
        && (error as { message?: string }).message?.includes('does not match the server-issued') === true,
    );
    await assert.rejects(
      () => operation(root, 'consult.execute').handler(context(root), { ...params, grant: issued.grant }),
      (error: unknown) => (error as { code?: number; message?: string }).code === -32602
        && (error as { message?: string }).message?.includes('Unsupported Agent Domain parameter: grant') === true,
    );
    await service.updateBinding('binding/alpha/planner', 1, { role: 'Superseded planner assignment' }, 'codex');
    await assert.rejects(
      () => operation(root, 'consult.execute').handler(context(root), {
        ...params,
        invocationToken: 'consult-inactive-assignment-token',
        request: { ...params.request, requestId: 'context-consult/inactive-assignment' },
      }),
      (error: unknown) => (error as { code?: number; message?: string }).code === -32010
        && (error as { message?: string }).message?.includes('not the active Binding/Profile revision') === true,
    );
  });

  test('Delegation plan and approval replay one plan, one child, and exactly two Usage Events', async () => {
    const root = fixture();
    await seedAgentState(root);
    const input = {
      planId: 'delegation-plan/operation', projectId: 'project/alpha', parentWorkRunId: 'work-run/parent',
      objective: 'Produce one governed artifact',
      assignment: {
        assignmentPlanId: 'assignment-plan/operation', assignmentPlanVersion: 1,
        assignmentPlanFingerprint: canonicalDigest({ assignment: 1 }),
        deviceSnapshot: {
          snapshotId: 'device-snapshot/operation', deviceId: 'device/test-5090', revision: 1,
          fingerprint: canonicalDigest({ device: 1 }), capturedAt: '2026-07-15T00:00:00.000Z', expiresAt: '2099-07-16T00:00:00.000Z',
        },
        profileId: 'agent/researcher', profileRevision: 1, bindingId: 'binding/alpha/researcher', bindingRevision: 1,
        contextEnvelopeFingerprint: canonicalDigest({ context: 'locked' }),
      },
      inputArtifactIds: ['artifact/run-input'],
      requestedCapabilityScope: { connectors: [], operations: [], resources: [], sideEffectClasses: ['read-only'] },
      budget: { policyVersion: 'budget/v1', maxInputTokens: 1000, maxOutputTokens: 500, maxDurationMs: 60_000 },
      expiresAt: '2099-07-16T00:00:00.000Z',
      expectedOutput: { outputClass: 'run-output', mediaType: 'application/json', requiredArtifactCount: 1, acceptanceCriteria: ['Preserve provenance'] },
      sideEffectPolicy: { externalEffectsRequirePerRunApproval: true, requestedExternalClasses: [] },
      provenance: [{ kind: 'workRun', id: 'work-run/parent' }, { kind: 'artifact', id: 'artifact/run-input' }],
      createdAt: '2026-07-15T00:00:00.000Z', createdBy: 'codex',
    };
    const planned = await operation(root, 'delegation.plan').handler(context(root), { project: 'project/alpha', input, actor: 'codex' }) as { fingerprint: string };
    const planReplay = await operation(root, 'delegation.plan').handler(context(root), { project: 'project/alpha', input, actor: 'codex' }) as { fingerprint: string };
    assert.equal(planReplay.fingerprint, planned.fingerprint);
    const approval = {
      project: 'project/alpha', planId: 'delegation-plan/operation', presentedFingerprint: planned.fingerprint,
      expectedRevision: 1, transitionToken: 'approve-delegation-operation', approvedExternalClasses: [], actor: 'codex',
    };
    const first = await operation(root, 'delegation.approve').handler(context(root), approval) as { idempotent: boolean; child: { workRunId: string } };
    const replay = await operation(root, 'delegation.approve').handler(context(root), approval) as { idempotent: boolean; child: { workRunId: string } };
    assert.equal(first.idempotent, false);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.child.workRunId, first.child.workRunId);
    const events = new UsageLedger(join(root, ...USAGE_RELATIVE_ROOT.split('/'))).list();
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((event) => event.idempotencyKey).sort(), [
      `delegation-approval:${first.child.workRunId}`,
      'delegation-plan:delegation-plan/operation',
    ].sort());
  });

  test('governed usage append is byte-identical and idempotent for proposal, request, plan, and child identities', () => {
    const root = fixture();
    const identities = [
      ['dreamtime', 'dreamtime-proposal:memory-proposal/a', 'dreamtime-run:memory-proposal/a'],
      ['consult', 'context-consult:context-consult/a', 'invocation:context-consult/a'],
      ['delegation', 'delegation-plan:delegation-plan/a', 'invocation:delegation-plan/a'],
      ['delegation', 'delegation-approval:work-run/child-a', 'work-run:work-run/child-a'],
    ] as const;
    for (const [kind, idempotencyKey, provenance] of identities) {
      const input = {
        kind, idempotencyKey, occurredAt: '2026-07-15T00:00:00.000Z', projectId: 'project/alpha' as const,
        profileId: 'agent/researcher' as const, operation: 'agent.operation', provenance: [provenance],
      };
      assert.equal(appendGovernedUsage(root, input).status, 'created');
      assert.equal(appendGovernedUsage(root, input).status, 'replayed');
    }
    assert.equal(new UsageLedger(join(root, ...USAGE_RELATIVE_ROOT.split('/'))).list().length, 4);
  });

  test('Promotion handoff uses the quarantined vault.writeAIOutput path and preserves immutable proposal bytes', async () => {
    const root = fixture();
    const stateRoot = join(root, ...AGENT_DOMAIN_RELATIVE_ROOT.split('/'));
    const store = new DreamTimeStore({ memoryRoot: join(stateRoot, 'dreamtime'), projectId: 'project/alpha', profileId: 'agent/researcher' });
    const candidate: MemoryProposalCandidate = {
      proposalId: 'memory-proposal/promotion', operation: 'checkpoint', projectId: 'project/alpha', profileId: 'agent/researcher',
      sourceIdentities: { threadId: 'thread/source', revisionIds: [], artifactIds: ['artifact/source'], cutoffAt: '2026-07-15T00:00:00.000Z' },
      expectedRevision: { revisionId: null, revision: 0, fingerprint: null }, sourceFingerprint: canonicalDigest({ source: 'promotion' }),
      candidateDiff: [{ operation: 'replace', section: 'recentContext', beforeHash: null, after: makeMemorySection('Candidate', ['artifact/source']) }],
      protectedDirectives: [], unresolvedConflicts: [], provenance: [{ kind: 'artifact', id: 'artifact/source' }], warnings: [],
      modelLock, expiresAt: '2099-07-16T00:00:00.000Z',
    };
    const proposal = await store.createProposal(candidate, 'codex');
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const result = await operation(root, 'dreamtime.promotion.handoff').handler(context(root, async (method, params) => {
      calls.push({ method, params });
      return { path: '00-Inbox/AI-Output/vault-dreamtime/promotion.md' };
    }), {
      project: 'project/alpha', profileId: 'agent/researcher', proposalId: proposal.proposalId,
      proposalFingerprint: proposal.fingerprint, candidateDiff: proposal.candidateDiff, provenance: proposal.provenance, actor: 'codex',
    }) as { reviewPath: string };
    assert.equal(result.reviewPath, '00-Inbox/AI-Output/vault-dreamtime/promotion.md');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, 'vault.writeAIOutput');
    assert.equal(calls[0]?.params.persona, 'vault-dreamtime');
    assert.equal(calls[0]?.params.quarantineState, 'new');
    assert.equal(calls[0]?.params.dryRun, false);
  });
});
