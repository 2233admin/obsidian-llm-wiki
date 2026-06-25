import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeContextOps } from './context.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { Operation, OperationContext } from '../core/types.js';

function ctx(actor = 'codex'): OperationContext {
  return {
    vault: null as never,
    adapters: null,
    config: { vault_path: '', collaboration: { actor } },
    logger: console,
    dryRun: false,
  };
}

function fakeRegistry(): AdapterRegistry {
  const adapter = {
    name: 'fake',
    capabilities: ['search'] as const,
    init: async () => {},
    dispose: async () => {},
    search: async (query: string, opts?: { glob?: string; maxResults?: number }) => {
      if (!query.trim()) return [];
      return [
        {
          source: 'fake',
          path: opts?.glob ? `${opts.glob.replace('/**', '')}/evidence.md` : 'evidence.md',
          content: `Evidence for ${query}`,
          score: 1,
        },
      ].slice(0, opts?.maxResults ?? 20);
    },
  };
  return {
    getByCapability: (capability: string) => (capability === 'search' ? [adapter] : []),
    list: () => [adapter],
  } as unknown as AdapterRegistry;
}

function op(ops: Operation[], name: string): Operation {
  const found = ops.find((item) => item.name === name);
  assert.ok(found, `${name} operation must exist`);
  return found;
}

test('context.wakeup returns L0 passport when no memory files exist', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-context-'));
  try {
    const wakeup = op(makeContextOps(root, fakeRegistry()), 'context.wakeup');
    const res = (await wakeup.handler(ctx('codex'), {})) as {
      actor: string;
      layers: { l0Identity: { path: string; exists: boolean; content: string } };
      truncated: boolean;
    };
    assert.equal(res.actor, 'codex');
    assert.equal(res.layers.l0Identity.exists, false);
    assert.equal(res.layers.l0Identity.path, '00-Inbox/Agent-Memory/codex/passport.md');
    assert.match(res.layers.l0Identity.content, /# Passport/);
    assert.equal(res.truncated, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('context.wakeup reads project-scoped handoff sessions and decisions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-context-'));
  try {
    const base = join(root, '10-Projects', 'alpha', 'agents', 'codex', 'memory');
    mkdirSync(join(base, 'sessions'), { recursive: true });
    mkdirSync(join(base, 'decisions'), { recursive: true });
    writeFileSync(join(base, 'passport.md'), '# Passport\n\n## Goal\n\nShip context stack.\n', 'utf-8');
    writeFileSync(join(base, 'handoff.md'), '# Handoff\n\n## Current State\n\nContext stack active.\n', 'utf-8');
    writeFileSync(join(base, 'sessions', '2026-session.md'), '# Session Alpha\n\nSession context details.\n', 'utf-8');
    writeFileSync(
      join(base, 'decisions', '2026-decision.md'),
      [
        '---',
        'conversation-decision: true',
        'title: "Decision Alpha"',
        'status: captured',
        'captured-at: "2026-01-01T00:00:00.000Z"',
        'tags: ["context"]',
        '---',
        '',
        '# Decision Alpha',
        '',
        'Use context wakeup.',
        '',
      ].join('\n'),
      'utf-8',
    );
    const wakeup = op(makeContextOps(root, fakeRegistry()), 'context.wakeup');
    const res = (await wakeup.handler(ctx('codex'), { project: 'alpha', includeRecall: false })) as {
      layers: {
        l0Identity: { exists: boolean; content: string };
        l1EssentialStory: {
          handoff: { exists: boolean; content: string };
          decisions: Array<{ title: string; tags: string[] }>;
          sessions: Array<{ title: string }>;
        };
      };
    };
    assert.equal(res.layers.l0Identity.exists, true);
    assert.match(res.layers.l0Identity.content, /Ship context stack/);
    assert.equal(res.layers.l1EssentialStory.handoff.exists, true);
    assert.match(res.layers.l1EssentialStory.handoff.content, /Context stack active/);
    assert.equal(res.layers.l1EssentialStory.sessions[0].title, 'Session Alpha');
    assert.equal(res.layers.l1EssentialStory.decisions[0].title, 'Decision Alpha');
    assert.deepEqual(res.layers.l1EssentialStory.decisions[0].tags, ['context']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('context.wakeup reads fallback Agent-Memory path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-context-'));
  try {
    const base = join(root, '00-Inbox', 'Agent-Memory', 'codex');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'passport.md'), '# Passport\n\nFallback identity.\n', 'utf-8');
    const wakeup = op(makeContextOps(root, fakeRegistry()), 'context.wakeup');
    const res = (await wakeup.handler(ctx('codex'), {})) as { layers: { l0Identity: { exists: boolean; content: string } } };
    assert.equal(res.layers.l0Identity.exists, true);
    assert.match(res.layers.l0Identity.content, /Fallback identity/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('context.wakeup rejects unsafe project and truncates deterministically', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-context-'));
  try {
    const base = join(root, '10-Projects', 'alpha', 'agents', 'codex', 'memory');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'passport.md'), `# Passport\n\n${'large '.repeat(1000)}\n`, 'utf-8');
    const wakeup = op(makeContextOps(root, fakeRegistry()), 'context.wakeup');
    await assert.rejects(() => wakeup.handler(ctx('codex'), { project: '../alpha' }), /project must be single safe path segment/);
    const res = (await wakeup.handler(ctx('codex'), { project: 'alpha', maxChars: 1000 })) as {
      truncated: boolean;
      layers: { l0Identity: { content: string } };
    };
    assert.equal(res.truncated, true);
    assert.ok(res.layers.l0Identity.content.length < 'large '.repeat(1000).length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('context.recall rejects empty query', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-context-'));
  try {
    const recall = op(makeContextOps(root, fakeRegistry()), 'context.recall');
    await assert.rejects(() => recall.handler(ctx('codex'), { query: '' }), /query required/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('context.deep_search includes answer and full trace contract', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-context-'));
  try {
    const deep = op(makeContextOps(root, fakeRegistry()), 'context.deep_search');
    const res = (await deep.handler(ctx('codex'), { query: 'context stack', project: 'alpha' })) as {
      scope: { project: string; glob: string };
      answer: string;
      citations: Array<{ path: string }>;
      trace: { plan: { selectedAdapters: string[] }; evidence: unknown[] };
    };
    assert.equal(res.scope.project, 'alpha');
    assert.equal(res.scope.glob, '10-Projects/alpha/**');
    assert.match(res.answer, /context stack/);
    assert.equal(res.citations[0].path, '10-Projects/alpha/evidence.md');
    assert.deepEqual(res.trace.plan.selectedAdapters, ['fake']);
    assert.ok(res.trace.evidence.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
