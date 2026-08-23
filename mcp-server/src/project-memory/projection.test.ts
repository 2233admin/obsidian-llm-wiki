import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectContextFromRecords,
  projectContextFromSource,
  renderProjectContextText,
} from './projection.js';
import { type ProjectContextProjectionInput } from './contracts.js';

const PROJECT_ID = 'project/alpha';

function baseInput(): ProjectContextProjectionInput {
  return {
    projectId: PROJECT_ID,
    generatedAt: '2026-08-19T12:00:00.000Z',
    sessions: [{
      schemaVersion: 'session-record/v1',
      sessionId: 'session/alpha-1',
      projectId: PROJECT_ID,
      source: 'import',
      sourceRef: 'fixtures/session-1.json',
      capturedAt: '2026-08-18T12:00:00.000Z',
      host: 'codex',
      status: 'indexed',
      revision: 1,
      sourceRefs: [{ ref: 'session/alpha-1', kind: 'session', status: 'available' }],
    }],
    researchRecords: [{
      schemaVersion: 'research-record/v1',
      recordId: 'research/alpha-1',
      projectId: PROJECT_ID,
      sessionRefs: ['session/alpha-1'],
      question: 'How should the project memory loop resume a task?',
      sources: [{ ref: 'docs/designs/project-memory-loop.md', kind: 'vaultPath', status: 'available' }],
      observations: ['The context must be derived and cited.'],
      nextHandoff: 'Validate the fresh-agent resume path.',
      reviewStatus: 'draft',
      revision: 1,
    }],
  };
}

test('Project Context fingerprint is deterministic across input ordering and generatedAt', () => {
  const first = projectContextFromRecords(baseInput());
  const original = baseInput();
  const secondInput: ProjectContextProjectionInput = {
    ...original,
    generatedAt: '2026-08-20T12:00:00.000Z',
    researchRecords: [...original.researchRecords!].reverse(),
    sessions: [...original.sessions!].reverse(),
  };
  const second = projectContextFromRecords(secondInput);

  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.revision, second.revision);
  assert.notEqual(first.generatedAt, second.generatedAt);
});

test('competing claims remain visible and unresolved without a silent winner', () => {
  const input: ProjectContextProjectionInput = {
    ...baseInput(),
    claims: [
    {
      claimId: 'claim/current-phase-a',
      section: 'currentState',
      key: 'phase',
      value: 'Phase 0',
      sourceId: 'session/alpha-1',
      authority: 'source',
      evidenceRefs: ['session/alpha-1'],
    },
    {
      claimId: 'claim/current-phase-b',
      section: 'currentState',
      key: 'phase',
      value: 'Phase 1',
      sourceId: 'research/alpha-1',
      authority: 'derived',
      evidenceRefs: ['docs/designs/project-memory-loop.md'],
    },
    ],
  };
  const context = projectContextFromRecords(input);
  const conflict = context.sections.conflicts.find((item) => item.key === 'phase');
  assert.ok(conflict);
  assert.equal(conflict!.state, 'unresolved');
  assert.deepEqual(conflict!.claims.map((claim) => claim.state), ['unresolved', 'unresolved']);
  assert.equal(context.sections.currentState.filter((claim) => claim.key === 'phase').length, 2);
  assert.equal(context.sections.currentState.find((claim) => claim.value === 'Phase 0')?.state, 'unresolved');
});

test('explicit supersession is represented while retaining both claims', () => {
  const input: ProjectContextProjectionInput = {
    ...baseInput(),
    researchRecords: [],
    claims: [
    {
      claimId: 'claim/old-goal',
      section: 'goal',
      key: 'project-goal',
      value: 'Archive chat only',
      sourceId: 'research/old',
      evidenceRefs: [{ ref: 'research/old', status: 'available' }],
    },
    {
      claimId: 'claim/new-goal',
      section: 'goal',
      key: 'project-goal',
      value: 'Archive Sessions and compile Project Context',
      sourceId: 'research/new',
      evidenceRefs: [{ ref: 'research/new', status: 'available' }],
      supersedes: ['claim/old-goal'],
    },
    ],
  };
  const context = projectContextFromRecords(input);
  const conflict = context.sections.conflicts.find((item) => item.key === 'project-goal');
  assert.ok(conflict);
  assert.equal(conflict!.state, 'current');
  assert.equal(conflict!.claims.find((claim) => claim.claimId === 'claim/old-goal')?.state, 'superseded');
  assert.equal(conflict!.claims.find((claim) => claim.claimId === 'claim/new-goal')?.state, 'current');
});

test('stale and unavailable evidence are explicit and cited', () => {
  const base = baseInput();
  const input: ProjectContextProjectionInput = {
    ...base,
    sessions: [{
    ...base.sessions![0]!,
    sessionId: 'session/unavailable',
    status: 'unavailable',
    sourceRefs: [{ ref: 'deleted/session.json', status: 'deleted_or_unavailable' }],
    }],
    claims: [{
    claimId: 'claim/stale-status',
    section: 'currentState',
    key: 'status',
    value: 'Old status',
    sourceId: 'session/unavailable',
    evidenceRefs: [{ ref: 'deleted/session.json', status: 'deleted_or_unavailable' }],
    }],
  };
  const context = projectContextFromRecords(input);
  assert.equal(context.sections.sessions[0]?.freshness, 'stale');
  assert.equal(context.sections.currentState.find((claim) => claim.key === 'status')?.state, 'stale');
  assert.equal(context.freshness.bySection.sessions, 'stale');
  assert.ok(context.evidenceRefs.some((evidence) => evidence.ref === 'deleted/session.json' && evidence.status === 'deleted_or_unavailable'));
  assert.match(renderProjectContextText(context), /deleted\/session\.json/);
});

test('empty projects produce a valid read-only projection', () => {
  const context = projectContextFromRecords({
    projectId: PROJECT_ID,
    generatedAt: '2026-08-19T12:00:00.000Z',
  });
  assert.equal(context.schemaVersion, 'project-context/v1');
  assert.equal(context.readOnly, true);
  assert.deepEqual(context.sections.goal, []);
  assert.deepEqual(context.sections.conflicts, []);
  assert.equal(context.freshness.state, 'unknown');
  assert.equal(context.authority.state, 'unknown');
});

test('narrow source adapter compiles records and render output includes citations', async () => {
  const source = {
    listSessions: () => baseInput().sessions!,
    listResearchRecords: () => baseInput().researchRecords!,
    listClaims: async () => [{
      claimId: 'claim/adapter-open-work',
      section: 'openWork' as const,
      key: 'next',
      value: 'Run the resume test',
      sourceId: 'research/alpha-1',
      evidenceRefs: [{ ref: 'session/alpha-1', kind: 'session' as const }],
    }],
  };
  const context = await projectContextFromSource(source, PROJECT_ID, { generatedAt: '2026-08-19T12:00:00.000Z' });
  const rendered = renderProjectContextText(context);
  assert.equal(context.sections.openWork[0]?.value, 'Run the resume test');
  assert.match(rendered, /Claim: claim\/adapter-open-work/);
  assert.match(rendered, /session\/alpha-1/);
  assert.match(rendered, /project-context\/v1/);
});
