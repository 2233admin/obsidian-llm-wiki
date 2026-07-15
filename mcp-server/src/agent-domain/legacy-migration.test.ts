import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planLegacyAgentMigration } from './legacy-migration.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-agent-migration-'));
  roots.push(root);
  mkdirSync(join(root, 'Projects'), { recursive: true });
  mkdirSync(join(root, '01-Projects', 'alpha'), { recursive: true });
  mkdirSync(join(root, '10-Projects', 'alpha', 'agents', 'codex', 'memory', 'sessions'), { recursive: true });
  writeFileSync(join(root, 'Projects', 'alpha.md'), [
    '---',
    'type: project',
    'entity: project/alpha',
    'aliases: [alpha]',
    'lifecycle: active',
    '---',
    '',
  ].join('\n'));
  writeFileSync(join(root, '01-Projects', 'alpha', '_project.md'), '---\nentity: project/alpha\n---\n');
  writeFileSync(join(root, '10-Projects', 'alpha', 'agents', 'codex', 'memory', 'passport.md'), '# Passport\n\n## Goal\n\nShip beta.\n');
  writeFileSync(join(root, '10-Projects', 'alpha', 'agents', 'codex', 'memory', 'handoff.md'), '# Handoff\n\n## Next Steps\n\n- Verify.\n');
  writeFileSync(join(root, '10-Projects', 'alpha', 'agents', 'codex', 'memory', 'sessions', '001.md'), '# Session\n\nIntegrated fleet.\n');
  return root;
}

describe('legacy Agent migration dry-run', () => {
  test('builds deterministic reviewed proposals without touching source bytes', () => {
    const root = fixture();
    const passportPath = join(root, '10-Projects', 'alpha', 'agents', 'codex', 'memory', 'passport.md');
    const before = readFileSync(passportPath, 'utf8');
    const beforeRoot = readdirSync(root).sort();
    const first = planLegacyAgentMigration({ vaultPath: root, projectRef: 'alpha', actor: 'codex', now: '2026-07-15T00:00:00.000Z' });
    const second = planLegacyAgentMigration({ vaultPath: root, projectRef: 'alpha', actor: 'codex', now: '2026-07-15T00:00:00.000Z' });

    assert.deepEqual(second, first);
    assert.equal(first.mode, 'dry-run');
    assert.equal(first.project.projectId, 'project/alpha');
    assert.equal(first.proposals.binding.enabled, false);
    assert.equal(first.proposals.binding.requiresReview, true);
    assert.equal(first.proposals.initialMemoryRevision.state, 'proposal-only');
    assert.equal(first.proposals.initialMemoryRevision.approvalRequired, true);
    assert.equal(first.sources.length, 3);
    assert.equal(first.rollback.writesApplied, false);
    assert.equal(first.rollback.sourceBytesPreserved, true);
    assert.deepEqual(first.rollback.restoreActions, []);
    assert.equal(readFileSync(passportPath, 'utf8'), before);
    assert.deepEqual(readdirSync(root).sort(), beforeRoot);
  });

  test('omits unsafe legacy content from candidate hashes and reports the source', () => {
    const root = fixture();
    const handoffPath = join(root, '10-Projects', 'alpha', 'agents', 'codex', 'memory', 'handoff.md');
    writeFileSync(handoffPath, '# Handoff\n\napi_token=sk-1234567890abcdefghijkl\nC:\\Users\\someone\\secret.txt\n');
    const plan = planLegacyAgentMigration({ vaultPath: root, projectRef: 'alpha', actor: 'codex', now: '2026-07-15T00:00:00.000Z' });

    assert.equal(plan.proposals.initialMemoryRevision.candidateSections.openItems.omitted, true);
    assert.equal(plan.proposals.initialMemoryRevision.candidateSections.openItems.sourcePaths.length, 0);
    assert.equal(plan.diagnostics.some((item) => item.code === 'unsafe_legacy_content_omitted' && item.path?.endsWith('/handoff.md')), true);
    assert.equal(JSON.stringify(plan).includes('sk-1234567890abcdefghijkl'), false);
    assert.equal(JSON.stringify(plan).includes('C:\\Users\\someone'), false);
  });

  test('reports an empty migration without inventing durable state', () => {
    const root = fixture();
    rmSync(join(root, '10-Projects', 'alpha', 'agents'), { recursive: true, force: true });
    const plan = planLegacyAgentMigration({ vaultPath: root, projectRef: 'alpha', actor: 'codex', now: '2026-07-15T00:00:00.000Z' });
    assert.equal(plan.sources.length, 0);
    assert.equal(plan.diagnostics.some((item) => item.code === 'no_legacy_agent_memory_found'), true);
    assert.equal(plan.rollback.proposedWrites.length, 4);
  });
});
