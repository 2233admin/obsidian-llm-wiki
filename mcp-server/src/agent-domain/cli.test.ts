import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, test } from 'node:test';

import {
  AgentDomainService,
  DreamTimeStore,
  canonicalDigest,
  makeMemorySection,
  type MemoryRevision,
} from '../../../packages/agent-domain/dist/src/index.js';
import { OperationError } from '../core/types.js';
import {
  normalizedProjectContext,
  resolveProjectContext,
} from '../project/project-context.js';
import { AGENT_DOMAIN_RELATIVE_ROOT } from './operations.js';
import { runAgentDomainCli } from './cli.js';

const roots: string[] = [];
const NOW = '2026-07-15T00:00:00.000Z';
const LATER = '2099-07-16T00:00:00.000Z';
const MODEL_LOCK = {
  provider: 'local',
  model: 'fixture-model',
  contextWindow: 32_768,
  tokenizer: 'fixture-tokenizer/v1',
  policyFingerprint: canonicalDigest({ policy: 'agent-domain-cli-test/v1' }),
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  inputFile: string;
  input: Record<string, unknown>;
  memoryStore: DreamTimeStore;
  approvedMemory: MemoryRevision;
}

async function fixture(): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-agent-domain-cli-'));
  roots.push(root);
  mkdirSync(join(root, 'Projects'), { recursive: true });
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

  const stateRoot = join(root, ...AGENT_DOMAIN_RELATIVE_ROOT.split('/'));
  const service = new AgentDomainService({ stateRoot, clock: () => NOW });
  const projectContext = normalizedProjectContext(
    resolveProjectContext(root, 'project/alpha'),
  );
  const projectContextFingerprint = canonicalDigest(projectContext);

  const createdProfile = await service.createProfile({
    profileId: 'agent/researcher',
    displayName: 'Researcher',
    role: 'Project researcher',
    responsibilities: ['Preserve governed context'],
    capabilityClaims: ['source-synthesis'],
    constitution: {
      principles: ['Cite sources'],
      instructions: ['Preserve provenance'],
    },
    defaultModelPolicy: {
      mode: 'local',
      provider: 'local',
      model: 'fixture-model',
    },
    actor: 'human/cli-test',
  });
  assert.equal(createdProfile.status, 'committed');
  if (createdProfile.status !== 'committed') throw new Error('Profile fixture conflicted');

  const createdBinding = await service.createBinding({
    projectId: 'project/alpha',
    projectContextFingerprint,
    profileId: 'agent/researcher',
    profileRevision: createdProfile.record.revision,
    role: 'Project researcher',
    connectorGrantRefs: [],
    actor: 'human/cli-test',
  });
  assert.equal(createdBinding.status, 'committed');
  if (createdBinding.status !== 'committed') throw new Error('Binding fixture conflicted');

  const createdThread = await service.createThread({
    threadId: 'thread/cli-resume',
    projectId: 'project/alpha',
    bindingId: createdBinding.record.bindingId,
    bindingRevision: createdBinding.record.revision,
    profileId: 'agent/researcher',
    profileRevision: createdProfile.record.revision,
    title: 'CLI resume',
    actor: 'human/cli-test',
  });
  assert.equal(createdThread.status, 'committed');
  if (createdThread.status !== 'committed') throw new Error('Thread fixture conflicted');

  const memoryStore = new DreamTimeStore({
    memoryRoot: join(stateRoot, 'dreamtime'),
    projectId: 'project/alpha',
    profileId: 'agent/researcher',
    clock: () => NOW,
  });
  const proposal = await memoryStore.createProposal({
    proposalId: 'memory-proposal/cli-approved',
    operation: 'checkpoint',
    projectId: 'project/alpha',
    profileId: 'agent/researcher',
    sourceIdentities: {
      threadId: 'thread/cli-resume',
      revisionIds: [],
      artifactIds: [],
      cutoffAt: NOW,
    },
    expectedRevision: { revisionId: null, revision: 0, fingerprint: null },
    sourceFingerprint: canonicalDigest({ source: 'thread/cli-resume', revision: 1 }),
    candidateDiff: [{
      operation: 'replace',
      section: 'recentContext',
      beforeHash: null,
      after: makeMemorySection('Approved CLI context', ['thread/cli-resume']),
    }],
    protectedDirectives: [],
    unresolvedConflicts: [],
    provenance: [{ kind: 'thread', id: 'thread/cli-resume', revision: 1 }],
    warnings: [],
    modelLock: MODEL_LOCK,
    expiresAt: LATER,
  }, 'human/cli-test');
  const approved = await memoryStore.approve(proposal.proposalId, {
    presentedFingerprint: proposal.fingerprint,
    expectedRevision: 0,
    transitionToken: 'approve-agent-domain-cli-fixture',
    actor: 'human/cli-test',
    authorize: async () => ({
      allowed: true,
      policyVersion: 'cli-test/v1',
      reason: 'Fixture approval',
    }),
  });
  assert.ok(approved.revision);

  const input: Record<string, unknown> = {
    project: 'project/alpha',
    envelopeId: 'envelope/cli-resume',
    compiledAt: '2026-07-15T01:00:00.000Z',
    tokenBudget: 30_000,
    profileId: createdProfile.record.profileId,
    expectedProfileRevision: createdProfile.record.revision,
    bindingId: createdBinding.record.bindingId,
    expectedBindingRevision: createdBinding.record.revision,
    memoryRevisionId: approved.revision.revisionId,
    expectedMemoryRevision: approved.revision.revision,
    expectedMemoryFingerprint: approved.revision.fingerprint,
    threadId: createdThread.record.threadId,
    expectedThreadRevision: createdThread.record.revision,
    capabilityGrantIds: [],
  };
  const inputFile = join(root, 'context-input.json');
  writeFileSync(inputFile, JSON.stringify(input));
  return { root, inputFile, input, memoryStore, approvedMemory: approved.revision };
}

async function approveNextMemory(memoryStore: DreamTimeStore, current: MemoryRevision): Promise<void> {
  const proposal = await memoryStore.createProposal({
    proposalId: 'memory-proposal/cli-newer',
    operation: 'checkpoint',
    projectId: 'project/alpha',
    profileId: 'agent/researcher',
    sourceIdentities: {
      threadId: 'thread/cli-resume',
      revisionIds: [current.revisionId],
      artifactIds: [],
      cutoffAt: '2026-07-15T02:00:00.000Z',
    },
    expectedRevision: {
      revisionId: current.revisionId,
      revision: current.revision,
      fingerprint: current.fingerprint,
    },
    sourceFingerprint: canonicalDigest({ source: 'thread/cli-resume', revision: 2 }),
    candidateDiff: [{
      operation: 'replace',
      section: 'recentContext',
      beforeHash: current.sections.recentContext.contentHash,
      after: makeMemorySection('Newer approved context', ['thread/cli-resume']),
    }],
    protectedDirectives: [],
    unresolvedConflicts: [],
    provenance: [{ kind: 'thread', id: 'thread/cli-resume', revision: 2 }],
    warnings: [],
    modelLock: MODEL_LOCK,
    expiresAt: LATER,
  }, 'human/cli-test');
  const approved = await memoryStore.approve(proposal.proposalId, {
    presentedFingerprint: proposal.fingerprint,
    expectedRevision: current.revision,
    transitionToken: 'approve-agent-domain-cli-newer',
    actor: 'human/cli-test',
    authorize: async () => ({
      allowed: true,
      policyVersion: 'cli-test/v1',
      reason: 'Fixture approval',
    }),
  });
  assert.equal(approved.status, 'approved');
}

async function expectConflict(action: () => Promise<unknown>, message: RegExp): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof OperationError);
    assert.equal(error.code, -32010);
    assert.match(error.message, message);
    return true;
  });
}

describe('Agent Domain CLI', () => {
  test('rooms and compiles context from the same stored approved Memory fingerprint', async () => {
    const state = await fixture();

    const room = await runAgentDomainCli([
      'room',
      '--vault', state.root,
      '--project', 'project/alpha',
      '--profile-id', 'agent/researcher',
      '--thread-id', 'thread/cli-resume',
    ]);
    const roomProjection = room.result as {
      readOnly: boolean;
      approvedMemory: { revisionId: string; revision: number; fingerprint: string };
    };
    assert.equal(roomProjection.readOnly, true);
    assert.equal(roomProjection.approvedMemory.fingerprint, state.approvedMemory.fingerprint);

    const compiled = await runAgentDomainCli([
      'context-compile',
      '--vault', state.root,
      '--input-file', state.inputFile,
    ]);
    const envelope = compiled.result as {
      fingerprint: string;
      layers: Array<{
        name: string;
        provenance: Array<{ kind: string; id: string; fingerprint?: string }>;
      }>;
    };
    assert.match(envelope.fingerprint, /^sha256:[a-f0-9]{64}$/);
    const memoryLayer = envelope.layers.find((layer) => layer.name === 'governedWorkingMemory');
    assert.ok(memoryLayer);
    assert.deepEqual(memoryLayer.provenance, [{
      kind: 'memoryRevision',
      id: state.approvedMemory.revisionId,
      revision: state.approvedMemory.revision,
      fingerprint: state.approvedMemory.fingerprint,
    }]);
  });

  test('fails closed for an expected fingerprint mismatch and stale Memory input bytes', async () => {
    const state = await fixture();

    const untrustedInputFile = join(state.root, 'untrusted-context-input.json');
    writeFileSync(untrustedInputFile, JSON.stringify({
      ...state.input,
      platformKernel: [{ content: { rules: ['client override'] } }],
      runtime: { capabilityGrants: [{ content: { allowed: true } }] },
    }));
    await assert.rejects(
      () => runAgentDomainCli([
        'context-compile',
        '--vault', state.root,
        '--input-file', untrustedInputFile,
      ]),
      (error: unknown) => error instanceof OperationError
        && error.code === -32602
        && /Unsupported Agent Domain parameter/.test(error.message),
    );

    await expectConflict(
      () => runAgentDomainCli([
        'context-compile',
        '--vault', state.root,
        '--input-file', state.inputFile,
        '--expected-fingerprint', `sha256:${'0'.repeat(64)}`,
      ]),
      /fingerprint drift requires an explicit new execution attempt/,
    );

    await approveNextMemory(state.memoryStore, state.approvedMemory);
    await expectConflict(
      () => runAgentDomainCli([
        'context-compile',
        '--vault', state.root,
        '--input-file', state.inputFile,
      ]),
      /memory reference is not the current approved revision/,
    );
  });
});
