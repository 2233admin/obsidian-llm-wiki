import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeConversationOps } from './conversation.js';
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

function op(ops: Operation[], name: string): Operation {
  const found = ops.find((item) => item.name === name);
  assert.ok(found, `${name} operation must exist`);
  return found;
}

function registerProject(root: string): void {
  mkdirSync(join(root, 'Projects'), { recursive: true });
  writeFileSync(
    join(root, 'Projects', 'alpha.md'),
    '---\ntype: project\nentity: project/alpha\nlifecycle: active\naliases: [Alpha App]\n---\n',
    'utf-8',
  );
}

test('conversation decision capture renders project-scoped template', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-conversation-'));
  try {
    registerProject(root);
    const capture = op(makeConversationOps(root), 'conversation.decision.capture');
    const result = (await capture.handler(ctx('alice'), {
      project: 'alpha',
      title: 'Use query answer for evidence',
      summary: 'The team chose extractive cited answers first.',
      decision: 'Ship query.answer before LLM synthesis.',
      why: 'Stable citations matter more than fluent synthesis.',
      rejectedOptions: ['Generate uncited prose directly'],
      constraints: ['No full transcript capture'],
      assumptions: ['Agents can call MCP tools explicitly'],
      risks: ['May miss implicit decisions'],
      actions: ['Add automatic capture later'],
      references: ['mcp-server/src/unified-query.ts'],
      excerpts: ['"Do not bury this in chat."'],
      tags: ['decision', 'query-answer'],
      source: { client: 'codex', threadId: 'thread-1', url: 'https://example.test/thread' },
      dryRun: true,
    })) as { path: string; preview: string; dryRun: boolean };

    assert.equal(result.dryRun, true);
    assert.match(result.path, /^10-Projects\/alpha\/agents\/alice\/memory\/decisions\/.+-use-query-answer-for-evidence\.md$/);
    assert.match(result.preview, /llmwiki-memory: decision/);
    assert.match(result.preview, /conversation-decision: true/);
    assert.match(result.preview, /actor: "alice"/);
    assert.match(result.preview, /project: "alpha"/);
    assert.match(result.preview, /source-client: "codex"/);
    assert.match(result.preview, /thread-id: "thread-1"/);
    for (const heading of [
      '## Summary',
      '## Decision',
      '## Why',
      '## Rejected Options',
      '## Constraints Snapshot',
      '## Assumptions',
      '## Risks',
      '## Actions',
      '## References',
      '## Conversation Excerpts',
    ]) {
      assert.match(result.preview, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('conversation decision capture uses fallback actor path and list newest first', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-conversation-'));
  try {
    const ops = makeConversationOps(root);
    const capture = op(ops, 'conversation.decision.capture');
    const list = op(ops, 'conversation.decision.list');
    const first = (await capture.handler(ctx('agent'), {
      title: 'First decision',
      decision: 'Older decision',
      tags: ['memory'],
    })) as { path: string };
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = (await capture.handler(ctx('agent'), {
      title: 'Second decision',
      decision: 'Newer decision',
      tags: ['memory', 'latest'],
    })) as { path: string };

    assert.match(first.path, /^00-Inbox\/Agent-Memory\/agent\/decisions\/.+-first-decision\.md$/);
    const all = (await list.handler(ctx('agent'), { limit: 10 })) as {
      count: number;
      decisions: Array<{ path: string; tags: string[] }>;
    };
    assert.equal(all.count, 2);
    assert.equal(all.decisions[0].path, second.path);
    assert.equal(all.decisions[1].path, first.path);

    const filtered = (await list.handler(ctx('agent'), { tag: 'latest' })) as {
      count: number;
      decisions: Array<{ path: string; tags: string[] }>;
    };
    assert.equal(filtered.count, 1);
    assert.equal(filtered.decisions[0].path, second.path);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('conversation decision get enforces vault-safe decision paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-conversation-'));
  try {
    const ops = makeConversationOps(root);
    const capture = op(ops, 'conversation.decision.capture');
    const get = op(ops, 'conversation.decision.get');
    const written = (await capture.handler(ctx('codex'), {
      title: 'Readable decision',
      decision: 'This should be readable.',
    })) as { path: string };

    const found = (await get.handler(ctx('codex'), { path: written.path })) as { path: string; content: string };
    assert.equal(found.path, written.path);
    assert.match(found.content, /# Readable decision/);

    await assert.rejects(() => get.handler(ctx('codex'), { path: '../outside.md' }), /path traversal blocked/);
    writeFileSync(join(root, 'plain.md'), '# Plain\n', 'utf-8');
    await assert.rejects(() => get.handler(ctx('codex'), { path: 'plain.md' }), /conversation decision/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('conversation decision rejects unsafe project and actor segments', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-conversation-'));
  try {
    const capture = op(makeConversationOps(root), 'conversation.decision.capture');
    await assert.rejects(
      () => capture.handler(ctx('codex'), { project: '../alpha', title: 'Unsafe project' }),
      /Project not found: \.\.\/alpha/,
    );
    await assert.rejects(
      () => capture.handler(ctx('../agent'), { title: 'Unsafe actor' }),
      /actor must be single safe path segment/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('conversation decisions resolve aliases and reject unknown projects before path creation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'llmwiki-conversation-'));
  try {
    registerProject(root);
    const capture = op(makeConversationOps(root), 'conversation.decision.capture');
    const resolved = (await capture.handler(ctx('codex'), {
      project: 'Alpha App',
      title: 'Canonical project path',
      decision: 'Use the resolver output.',
    })) as { path: string };
    assert.match(resolved.path, /^10-Projects\/alpha\/agents\/codex\/memory\/decisions\//);
    assert.equal(existsSync(join(root, '10-Projects', 'Alpha App')), false);

    await assert.rejects(
      () => capture.handler(ctx('codex'), { project: 'missing', title: 'Must not write' }),
      /Project not found: missing/,
    );
    assert.equal(existsSync(join(root, '10-Projects', 'missing')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
