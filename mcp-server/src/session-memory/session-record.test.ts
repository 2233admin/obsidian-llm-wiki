import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createSessionRecordStore,
  importSessionFixture,
  SessionRecordError,
  type SessionFixture,
} from './session-record.js';

test('imports a canonical Session Record idempotently and increments revision on new content', () => {
  const vault = tempVault();
  try {
    registerProject(vault, 'sprachwelt', 'LanguageWorld');
    const filePath = writeFixture(vault, 'fixtures/session.json', fixture());
    const store = createSessionRecordStore();

    const first = importSessionFixture({
      vaultPath: vault,
      filePath,
      project: 'LanguageWorld',
      store,
    });
    const second = importSessionFixture({
      vaultPath: vault,
      filePath,
      project: 'project/sprachwelt',
      store,
    });

    assert.equal(first.record.schemaVersion, 'session-record/v1');
    assert.equal(first.record.projectId, 'project/sprachwelt');
    assert.equal(first.record.source, 'import');
    assert.equal(first.record.sourceRef, 'vaultPath:fixtures/session.json');
    assert.match(first.record.contentHash ?? '', /^sha256:[a-f0-9]{64}$/);
    assert.equal(first.record.revision, 1);
    assert.equal(first.idempotent, false);
    assert.equal(second.record.sessionId, first.record.sessionId);
    assert.equal(second.record.contentHash, first.record.contentHash);
    assert.equal(second.record.revision, 1);
    assert.equal(second.idempotent, true);

    writeFixture(vault, filePath, fixture({ messages: [
      { role: 'user', content: 'Continue the experiment with the second fixture revision.' },
    ] }));
    const third = importSessionFixture({
      vaultPath: vault,
      filePath,
      project: 'project/sprachwelt',
      store,
    });

    assert.equal(third.record.sessionId, first.record.sessionId);
    assert.notEqual(third.record.contentHash, first.record.contentHash);
    assert.equal(third.record.revision, 2);
    assert.equal(third.idempotent, false);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('binds an imported fixture through the canonical Project ID resolver', () => {
  const vault = tempVault();
  try {
    registerProject(vault, 'sprachwelt', 'LanguageWorld');
    const filePath = writeFixture(vault, 'fixtures/session.json', fixture());

    const result = importSessionFixture({
      vaultPath: vault,
      filePath,
      project: { kind: 'name', value: 'LanguageWorld' },
    });

    assert.equal(result.record.projectId, 'project/sprachwelt');
    assert.equal(result.project.resolvedBy, 'alias');
    writeFixture(vault, filePath, fixture({ projectId: 'project/another-project' }));
    assert.throws(
      () => importSessionFixture({
        vaultPath: vault,
        filePath,
        project: 'project/sprachwelt',
      }),
      /does not match resolved Project ID/,
    );
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('rejects malformed local fixtures without exposing fixture content', () => {
  const vault = tempVault();
  try {
    registerProject(vault, 'sprachwelt');
    const filePath = join('fixtures', 'malformed.json');
    mkdirSync(join(vault, 'fixtures'), { recursive: true });
    writeFileSync(join(vault, filePath), '{"messages": [', 'utf8');

    assert.throws(
      () => importSessionFixture({ vaultPath: vault, filePath, project: 'project/sprachwelt' }),
      (error: unknown) => error instanceof SessionRecordError
        && error.code === 'malformed_fixture'
        && !error.message.includes('messages'),
    );
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('represents a deleted or unavailable fixture without inventing raw content', () => {
  const vault = tempVault();
  try {
    registerProject(vault, 'sprachwelt');
    const result = importSessionFixture({
      vaultPath: vault,
      filePath: 'fixtures/deleted-session.json',
      project: 'project/sprachwelt',
      capturedAt: '2026-08-19T10:00:00.000Z',
      store: createSessionRecordStore(),
    });

    assert.equal(result.record.status, 'unavailable');
    assert.equal(result.record.sourceAvailability, 'deleted_or_unavailable');
    assert.equal(result.record.contentHash, null);
    assert.deepEqual(result.record.sourceRefs, ['vaultPath:fixtures/deleted-session.json']);
    assert.equal(result.evidence.status, 'unavailable');
    assert.equal(result.evidence.accessContext, 'deleted_or_unavailable');
    assert.equal(result.evidence.content, null);
    assert.equal(result.record.revision, 1);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('redacts secrets in raw evidence and keeps the Session Record metadata-only', () => {
  const vault = tempVault();
  try {
    registerProject(vault, 'sprachwelt');
    const filePath = writeFixture(vault, 'fixtures/secret-session.json', fixture({
      apiKey: 'sk-test-secret-123456789012345',
      authorization: 'Bearer bearer-secret-value',
      nested: { password: 'password-secret-value' },
      messages: [
        { role: 'user', content: 'token=inline-secret-value' },
        { role: 'tool', content: '-----BEGIN PRIVATE KEY-----\nprivate-key-secret\n-----END PRIVATE KEY-----' },
      ],
    }));

    const result = importSessionFixture({
      vaultPath: vault,
      filePath,
      project: 'project/sprachwelt',
    });
    const evidenceJson = JSON.stringify(result.evidence);

    for (const secret of [
      'sk-test-secret-123456789012345',
      'bearer-secret-value',
      'password-secret-value',
      'inline-secret-value',
      'private-key-secret',
    ]) {
      assert.equal(evidenceJson.includes(secret), false, `secret leaked: ${secret}`);
    }
    assert.ok(result.evidence.redactions >= 4);
    assert.equal('messages' in result.record, false);
    assert.equal('raw' in result.record, false);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('blocks absolute and traversal fixture paths before reading the filesystem', () => {
  const vault = tempVault();
  try {
    registerProject(vault, 'sprachwelt');
    assert.throws(
      () => importSessionFixture({ vaultPath: vault, filePath: '../outside.json', project: 'project/sprachwelt' }),
      /vault-relative|traversal blocked/,
    );
    assert.throws(
      () => importSessionFixture({ vaultPath: vault, filePath: vault, project: 'project/sprachwelt' }),
      /vault-relative|traversal blocked/,
    );
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

function fixture(overrides: Record<string, unknown> = {}): SessionFixture {
  return {
    schemaVersion: 'provider-session/v1',
    sessionId: 'codex-session-001',
    capturedAt: '2026-08-19T09:30:00.000Z',
    host: 'codex',
    workspace: 'workspace/sprachwelt',
    branch: 'codex/session-memory',
    sourceRefs: ['Notes/experiment.md', 'https://example.com/research'],
    messages: [
      { role: 'user', content: 'Recover the experiment context for Sprachwelt.' },
      { role: 'assistant', content: 'The current experiment is the session archive MVP.' },
    ],
    ...overrides,
  };
}

function tempVault(): string {
  return mkdtempSync(join(tmpdir(), 'llmwiki-session-record-'));
}

function registerProject(vault: string, slug: string, alias?: string): void {
  mkdirSync(join(vault, 'Projects'), { recursive: true });
  writeFileSync(
    join(vault, 'Projects', `${slug}.md`),
    `---\ntype: project\nentity: project/${slug}\nstatus: active\n${alias ? `aliases: [${alias}]\n` : ''}---\n`,
    'utf8',
  );
}

function writeFixture(vault: string, filePath: string, value: SessionFixture): string {
  const fullPath = join(vault, ...filePath.replaceAll('\\', '/').split('/'));
  mkdirSync(join(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, JSON.stringify(value, null, 2), 'utf8');
  return filePath;
}
