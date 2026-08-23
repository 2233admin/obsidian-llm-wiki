import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeProjectMemoryOps } from './project-memory-operations.js';
import type { OperationContext } from './types.js';

test('durable Project Memory operations survive a fresh operation factory', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'llmwiki-project-memory-ops-'));
  try {
    mkdirSync(join(vault, 'Projects'), { recursive: true });
    mkdirSync(join(vault, 'fixtures'), { recursive: true });
    writeFileSync(
      join(vault, 'Projects', 'sprachwelt.md'),
      '---\ntype: project\nentity: project/sprachwelt\nstatus: active\naliases: [LanguageWorld]\n---\n',
      'utf8',
    );
    writeFileSync(
      join(vault, 'fixtures', 'session.json'),
      JSON.stringify({
        schemaVersion: 'provider-session/v1',
        sessionId: 'fixture-session-1',
        capturedAt: '2026-08-19T09:30:00.000Z',
        host: 'codex',
        messages: [{ role: 'user', content: 'Recover the Sprachwelt experiment.' }],
        sourceRefs: ['https://example.com/research'],
      }),
      'utf8',
    );

    const context = operationContext(vault);
    const firstOps = new Map(makeProjectMemoryOps(vault).map((operation) => [operation.name, operation]));
    const imported = await firstOps.get('memory.session.record.import')!.handler(context, {
      project: 'LanguageWorld',
      filePath: 'fixtures/session.json',
    });
    const importedPayload = imported as { record: { projectId: string; sessionId: string }; recordPath: string };
    assert.equal(importedPayload.record.projectId, 'project/sprachwelt');
    assert.match(importedPayload.recordPath, /10-Projects[\\/]sprachwelt[\\/]sessions[\\/]records/);

    writeFileSync(
      join(vault, 'fixtures', 'session.json'),
      JSON.stringify({
        schemaVersion: 'provider-session/v1',
        sessionId: 'fixture-session-1',
        capturedAt: '2026-08-19T09:30:00.000Z',
        host: 'codex',
        messages: [{ role: 'user', content: 'Continue the Sprachwelt experiment.' }],
        sourceRefs: ['https://example.com/research'],
      }),
      'utf8',
    );
    const revised = await firstOps.get('memory.session.record.import')!.handler(context, {
      project: 'project/sprachwelt',
      filePath: 'fixtures/session.json',
    });
    assert.equal((revised as { record: { revision: number } }).record.revision, 2);
    assert.equal((revised as { idempotent: boolean }).idempotent, false);
    assert.ok(existsSync(join(vault, '10-Projects', 'sprachwelt', 'sessions', 'records', 'history', importedPayload.record.sessionId, 'revision-1.json')));
    assert.ok(existsSync(join(vault, '10-Projects', 'sprachwelt', 'sessions', 'records', 'history', importedPayload.record.sessionId, 'revision-2.json')));

    const saved = await firstOps.get('memory.research.record.save')!.handler(context, {
      project: 'project/sprachwelt',
      recordId: 'experiment-001',
      sessionRefs: [importedPayload.record.sessionId],
      question: 'Can the experiment be resumed from the captured Session?',
      observations: ['The local record is available to a fresh operation factory.'],
      uncertainties: ['The next host adapter is not selected yet.'],
      nextHandoff: 'Compile the next experiment after reviewing the evidence.',
    });
    assert.equal((saved as { record: { revision: number } }).record.revision, 1);

    const freshOps = new Map(makeProjectMemoryOps(vault).map((operation) => [operation.name, operation]));
    const compiled = await freshOps.get('project.context.compile')!.handler(operationContext(vault), {
      project: 'project/sprachwelt',
    });
    const payload = compiled as {
      context: {
        schemaVersion: string;
        projectId: string;
        sections: { sessions: unknown[]; goal: unknown[]; currentState: unknown[]; openWork: unknown[]; conflicts: unknown[] };
      };
    };
    assert.equal(payload.context.schemaVersion, 'project-context/v1');
    assert.equal(payload.context.projectId, 'project/sprachwelt');
    assert.equal(payload.context.sections.sessions.length, 1);
    assert.equal(payload.context.sections.goal.length, 1);
    assert.equal(payload.context.sections.currentState.length, 2);
    assert.equal(payload.context.sections.openWork.length, 1);
    assert.equal(payload.context.sections.conflicts.length, 1);

    const evidence = readFileSync(join(vault, '10-Projects', 'sprachwelt', 'sessions', 'evidence', `${importedPayload.record.sessionId}.json`), 'utf8');
    assert.match(evidence, /session-evidence\/v1/);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

function operationContext(vaultPath: string): OperationContext {
  return {
    vault: { execute: async () => ({}) },
    adapters: null,
    config: { vault_path: vaultPath, collaboration: { actor: 'agent', role: 'agent' } },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: false,
  };
}
