/**
 * End-to-end MCP JSON-RPC smoke test.
 *
 * Spawns the built stdio server as a child process and speaks real MCP
 * protocol to it via the SDK client. Validates:
 *   1. `initialize` succeeds (handshake completes).
 *   2. `tools/list` returns a non-empty tool set including the core vault
 *      operations (`vault.list`, `vault.read`, `vault.exists`).
 *   3. `tools/call` round-trips: `vault.list` on a seeded temp vault
 *      reports the seeded note.
 *
 * Carry-forward from Step 1 (deferred three sessions). This covers the
 * surface that pure unit tests can't: the stdio framing, the Server SDK
 * glue, the tool-name bridge, and the config loader reading
 * VAULT_MIND_VAULT_PATH from env.
 *
 * Uses the already-built bundle.js (npm run rebuild) so this test runs
 * the exact artifact shipped in the package.
 */

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// This file compiles to mcp-server/dist/smoke.test.js, so bundle.js is one level up.
const BUNDLE_PATH = resolve(__dirname, '..', 'bundle.js');

let vaultRoot: string;
let client: Client;
let transport: StdioClientTransport;

before(async () => {
  if (!existsSync(BUNDLE_PATH)) {
    throw new Error(
      `smoke test: bundle.js missing at ${BUNDLE_PATH}. Run "npm run rebuild" first.`,
    );
  }

  vaultRoot = join(tmpdir(), `obsidian-llm-wiki-smoke-${randomUUID()}`);
  mkdirSync(vaultRoot, { recursive: true });
  writeFileSync(
    join(vaultRoot, 'hello.md'),
    '---\ntitle: Hello\n---\n\nsmoke test seed note.\n',
    'utf-8',
  );
  writeFileSync(
    join(vaultRoot, 'team-board.md'),
    [
      '---',
      'kanban-plugin: board',
      '---',
      '',
      '## Backlog',
      '',
      '- [ ] Capture markdown memory ^capture-memory',
      '',
      '## Done',
      '',
      '- [x] Wire kanban adapter',
      '',
      '***',
      '',
      '## Archive',
      '',
      '- [ ] Archived card should stay archived',
      '',
      '%% kanban:settings',
      '```json',
      '{"kanban-plugin":"board"}',
      '```',
      '%%',
      '',
    ].join('\n'),
    'utf-8',
  );
  // loadConfig() precedence is env > ./vault-mind.yaml > ../vault-mind.yaml,
  // so setting VAULT_MIND_VAULT_PATH below is sufficient -- no yaml drop
  // required. Default adapter list is fine post pglite-externalize fix.
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE_PATH],
    cwd: vaultRoot,
    env: { ...process.env, VAULT_MIND_VAULT_PATH: vaultRoot },
    stderr: 'pipe',
  });

  client = new Client(
    { name: 'smoke-test', version: '0.0.1' },
    { capabilities: {} },
  );

  await client.connect(transport);
});

after(async () => {
  try { await client?.close(); } catch { /* best effort */ }
  try { await transport?.close(); } catch { /* best effort */ }
  if (vaultRoot && existsSync(vaultRoot)) {
    rmSync(vaultRoot, { recursive: true, force: true });
  }
});

test('tools/list returns the core vault operations', async () => {
  const res = await client.listTools();
  assert.ok(Array.isArray(res.tools), 'tools array present');
  assert.ok(res.tools.length > 0, 'at least one tool registered');
  const names = new Set(res.tools.map((t) => t.name));
  for (const required of ['vault.list', 'vault.read', 'vault.exists']) {
    assert.ok(names.has(required), `missing required tool: ${required}`);
  }
});

test('tools/list includes markdown memory operations', async () => {
  const res = await client.listTools();
  const names = new Set(res.tools.map((t) => t.name));
  for (const required of [
    'memory.passport.get',
    'memory.passport.upsert',
    'memory.handoff.latest',
    'memory.handoff.write',
    'memory.session.save',
    'memory.session.list',
  ]) {
    assert.ok(names.has(required), `missing required tool: ${required}`);
  }
});

test('tools/list includes conversation decision operations', async () => {
  const res = await client.listTools();
  const names = new Set(res.tools.map((t) => t.name));
  for (const required of [
    'conversation.decision.capture',
    'conversation.decision.list',
    'conversation.decision.get',
  ]) {
    assert.ok(names.has(required), `missing required tool: ${required}`);
  }
});

test('tools/list includes context stack operations', async () => {
  const res = await client.listTools();
  const names = new Set(res.tools.map((t) => t.name));
  for (const required of [
    'context.wakeup',
    'context.recall',
    'context.deep_search',
  ]) {
    assert.ok(names.has(required), `missing required tool: ${required}`);
  }
});

test('tools/list includes local project management operations', async () => {
  const res = await client.listTools();
  const names = new Set(res.tools.map((t) => t.name));
  for (const required of [
    'project.init',
    'project.issue.create',
    'project.issue.list',
    'project.issue.get',
    'project.issue.update',
    'project.issue.link',
    'project.comment.add',
    'project.board.get',
'project.canvas.export',
'project.base.export',
  ]) {
    assert.ok(names.has(required), `missing required tool: ${required}`);
  }
});
test('tools/list includes OPENCLI and MEDIA_TRANSCRIBE ingest preflight operations', async () => {
  const res = await client.listTools();
  const names = new Set(res.tools.map((t) => t.name));
  for (const required of ['ingest.providers', 'ingest.link.preflight']) {
    assert.ok(names.has(required), `missing required tool: ${required}`);
  }
});

test('project tools create work-OS searchable local issues', async () => {
  const init = await client.callTool({ name: 'project.init', arguments: { project: 'smokeproj' } });
  assert.ok(!init.isError, `project.init errored: ${JSON.stringify(init.content)}`);

  // Work-OS create: title -> slug, summary -> description (searchable token).
  const created = await client.callTool({
    name: 'project.issue.create',
    arguments: {
      project: 'smokeproj',
      title: 'Local Linear smoke',
      summary: 'local-linear-smoke-token',
      state: 'in-progress',
      priority: 'high',
    },
  });
  assert.ok(!created.isError, `project.issue.create errored: ${JSON.stringify(created.content)}`);
  const createdPayload = JSON.parse((created.content as Array<{ text: string }>)[0].text) as {
    slug: string;
    id: string;
    path: string;
  };
  assert.equal(createdPayload.slug, 'local-linear-smoke');
  assert.equal(createdPayload.id, 'smokeproj/local-linear-smoke');

  // Work-OS update drives by slug + canonical state (NOT id:ISSUE-1 / status:Done).
  const updated = await client.callTool({
    name: 'project.issue.update',
    arguments: { project: 'smokeproj', slug: createdPayload.slug, state: 'done' },
  });
  assert.ok(!updated.isError, `project.issue.update errored: ${JSON.stringify(updated.content)}`);

  // Comment.add appends to a sibling comments file by slug.
  const commented = await client.callTool({
    name: 'project.comment.add',
    arguments: { project: 'smokeproj', slug: createdPayload.slug, body: 'Comment from smoke test' },
  });
  assert.ok(!commented.isError, `project.comment.add errored: ${JSON.stringify(commented.content)}`);

  const search = await client.callTool({
    name: 'query.unified',
    arguments: { query: 'local-linear-smoke-token', adapters: ['filesystem'], maxResults: 10 },
  });
  assert.ok(!search.isError, `query.unified project errored: ${JSON.stringify(search.content)}`);
  const payload = JSON.parse((search.content as Array<{ text: string }>)[0].text) as {
    results: Array<{ path: string }>
  };
  // Single source of truth: the work-OS note under 01-Projects/<proj>/issues/<slug>.md.
  assert.ok(
    payload.results.some((result) => result.path.replaceAll('\\', '/') === '01-Projects/smokeproj/issues/local-linear-smoke.md'),
    `project issue not searchable: ${JSON.stringify(payload)}`,
  );
});

test('project visual exports are searchable', async () => {
const init = await client.callTool({ name: 'project.init', arguments: { project: 'visualsmoke' } });
assert.ok(!init.isError, `project.init errored: ${JSON.stringify(init.content)}`);

const created = await client.callTool({
name: 'project.issue.create',
arguments: {
project: 'visualsmoke',
title: 'Visual smoke issue',
summary: 'visual-smoke-issue-token',
state: 'in-progress',
},
});
assert.ok(!created.isError, `project.issue.create errored: ${JSON.stringify(created.content)}`);

const canvas = await client.callTool({
name: 'project.canvas.export',
arguments: { project: 'visualsmoke', dryRun: false },
});
assert.ok(!canvas.isError, `project.canvas.export errored: ${JSON.stringify(canvas.content)}`);

const base = await client.callTool({
name: 'project.base.export',
arguments: { project: 'visualsmoke', dryRun: false },
});
assert.ok(!base.isError, `project.base.export errored: ${JSON.stringify(base.content)}`);

const canvasSearch = await client.callTool({
name: 'vault.search',
arguments: { query: 'LLMwiki project map', glob: '**/*.canvas', maxResults: 5 },
});
assert.ok(!canvasSearch.isError, `vault.search canvas errored: ${JSON.stringify(canvasSearch.content)}`);
const canvasPayload = JSON.parse((canvasSearch.content as Array<{ text: string }>)[0].text) as { results: Array<{ path: string }> };
assert.ok(
  canvasPayload.results.some((file) => file.path.replaceAll('\\', '/') === '01-Projects/visualsmoke/views/project-map.canvas'),
  `visual canvas not searchable: ${JSON.stringify(canvasPayload)}`,
);

const baseSearch = await client.callTool({
name: 'vault.search',
arguments: { query: 'Obsidian Bases dashboard', glob: '**/*.base', maxResults: 5 },
});
assert.ok(!baseSearch.isError, `vault.search base errored: ${JSON.stringify(baseSearch.content)}`);
const basePayload = JSON.parse((baseSearch.content as Array<{ text: string }>)[0].text) as { results: Array<{ path: string }> };
assert.ok(
  basePayload.results.some((file) => file.path.replaceAll('\\', '/') === '01-Projects/visualsmoke/views/issues.base'),
  `visual base not searchable: ${JSON.stringify(basePayload)}`,
);
});

test('query.trace exposes retrieval plan and ranked evidence', async () => {
  const token = `trace-evidence-${randomUUID()}`;
  const path = `query-trace-${randomUUID()}.md`;
  const write = await client.callTool({
    name: 'vault.create',
    arguments: {
      path,
      content: `# Query Trace Probe\n\n${token}\n`,
      dryRun: false,
    },
  });
  assert.ok(!write.isError, `vault.create errored: ${JSON.stringify(write.content)}`);

  const res = await client.callTool({
    name: 'query.trace',
    arguments: {
      query: token,
      maxResults: 3,
      adapters: ['filesystem'],
    },
  });
  assert.ok(!res.isError, `query.trace errored: ${JSON.stringify(res.content)}`);
  const payload = JSON.parse((res.content as Array<{ text: string }>)[0].text) as {
    query: string;
    mode: string;
    plan: {
      selectedAdapters: string[];
      fusion: { algorithm: string; k: number; rankBase: number };
      branches: Array<{ adapter: string; status: string; count: number }>;
    };
    evidence: Array<{ rank: number; source: string; path: string; snippet: string; rrfSources: string[] }>;
    limitations: string[];
  };
  assert.equal(payload.query, token);
  assert.equal(payload.mode, 'keyword');
  assert.deepEqual(payload.plan.selectedAdapters, ['filesystem']);
  assert.equal(payload.plan.fusion.algorithm, 'reciprocal_rank_fusion');
  assert.equal(payload.plan.fusion.k, 60);
  assert.equal(payload.plan.fusion.rankBase, 1);
  assert.ok(
    payload.plan.branches.some((branch) => branch.adapter === 'filesystem' && branch.status === 'ok' && branch.count > 0),
    `filesystem trace branch missing: ${JSON.stringify(payload.plan.branches)}`,
  );
  assert.ok(
    payload.evidence.some((item) => item.source === 'filesystem' && item.path === path && item.snippet.includes(token)),
    `trace evidence missing seeded note: ${JSON.stringify(payload.evidence)}`,
  );
  assert.ok(
    payload.limitations.some((item) => item.includes('not BM25')),
    `trace limitations should disclose non-BM25 filesystem search: ${JSON.stringify(payload.limitations)}`,
  );
});

test('query.answer returns citation-backed claims and gaps', async () => {
  const token = `answer-evidence-${randomUUID()}`;
  const path = `query-answer-${randomUUID()}.md`;
  const sentence = `The ${token} migration is blocked by missing reranker evaluation.`;
  const write = await client.callTool({
    name: 'vault.create',
    arguments: {
      path,
      content: `# Query Answer Probe\n\n${sentence}\n`,
      dryRun: false,
    },
  });
  assert.ok(!write.isError, `vault.create errored: ${JSON.stringify(write.content)}`);

  const res = await client.callTool({
    name: 'query.answer',
    arguments: {
      query: token,
      maxResults: 3,
      adapters: ['filesystem'],
    },
  });
  assert.ok(!res.isError, `query.answer errored: ${JSON.stringify(res.content)}`);
  const payload = JSON.parse((res.content as Array<{ text: string }>)[0].text) as {
    query: string;
    answer: string;
    claims: Array<{ text: string; citations: string[]; confidence: string }>;
    citations: Array<{ id: string; source: string; path: string; snippet: string }>;
    gaps: Array<{ type: string; message: string }>;
    contradictions: unknown[];
    confidence: string;
    trace: { plan: { selectedAdapters: string[] } };
  };
  assert.equal(payload.query, token);
  assert.ok(payload.answer.includes('[C1]'), `answer missing citation marker: ${payload.answer}`);
  assert.ok(
    payload.claims.some((claim) => claim.text.includes(token) && claim.citations.includes('C1')),
    `answer claims missing cited token: ${JSON.stringify(payload.claims)}`,
  );
  assert.ok(
    payload.citations.some((citation) => citation.id === 'C1' && citation.source === 'filesystem' && citation.path === path && citation.snippet.includes(token)),
    `answer citations missing seeded note: ${JSON.stringify(payload.citations)}`,
  );
  assert.ok(
    payload.gaps.some((gap) => gap.type === 'semantic_review_missing'),
    `answer gaps should disclose Phase A semantic review boundary: ${JSON.stringify(payload.gaps)}`,
  );
  assert.deepEqual(payload.contradictions, []);
  assert.notEqual(payload.confidence, 'low');
  assert.deepEqual(payload.trace.plan.selectedAdapters, ['filesystem']);
});

test('conversation decision capture is searchable and answer-citable', async () => {
  const token = `conversation-decision-${randomUUID()}`;
  const capture = await client.callTool({
    name: 'conversation.decision.capture',
    arguments: {
      title: `Capture ${token}`,
      summary: 'Conversation produced a durable implementation decision.',
      decision: `Use append-only decision notes for ${token}.`,
      why: 'Chat decisions otherwise disappear into transcript history.',
      rejectedOptions: ['Keep decisions only in handoff notes'],
      constraints: ['Do not store full transcripts by default'],
      actions: ['Wire automatic capture later'],
      tags: ['conversation', 'decision'],
      source: { client: 'smoke-test', threadId: token },
    },
  });
  assert.ok(!capture.isError, `conversation.decision.capture errored: ${JSON.stringify(capture.content)}`);
  const capturePayload = JSON.parse((capture.content as Array<{ text: string }>)[0].text) as { path: string };
  assert.match(capturePayload.path, /^00-Inbox\/Agent-Memory\/agent\/decisions\/.+\.md$/);

  const unified = await client.callTool({
    name: 'query.unified',
    arguments: {
      query: token,
      maxResults: 5,
      adapters: ['filesystem'],
    },
  });
  assert.ok(!unified.isError, `query.unified errored: ${JSON.stringify(unified.content)}`);
  const unifiedPayload = JSON.parse((unified.content as Array<{ text: string }>)[0].text) as {
    results: Array<{ path: string; content: string }>;
  };
  assert.ok(
    unifiedPayload.results.some((item) => item.path === capturePayload.path && item.content.includes(token)),
    `captured decision not found by query.unified: ${JSON.stringify(unifiedPayload.results)}`,
  );

  const answer = await client.callTool({
    name: 'query.answer',
    arguments: {
      query: token,
      maxResults: 5,
      adapters: ['filesystem'],
    },
  });
  assert.ok(!answer.isError, `query.answer errored: ${JSON.stringify(answer.content)}`);
  const answerPayload = JSON.parse((answer.content as Array<{ text: string }>)[0].text) as {
    citations: Array<{ path: string; snippet: string }>;
  };
  assert.ok(
    answerPayload.citations.some((citation) => citation.path === capturePayload.path && citation.snippet.includes(token)),
    `captured decision not cited by query.answer: ${JSON.stringify(answerPayload.citations)}`,
  );
});

test('context stack wakes up and recalls conversation decisions', async () => {
  const project = `contextsmoke-${randomUUID()}`;
  const token = `context-stack-${randomUUID()}`;
  const passport = await client.callTool({
    name: 'memory.passport.upsert',
    arguments: {
      project,
      goal: `Wake up with ${token}`,
      decisions: [`Keep ${token} visible in startup context`],
    },
  });
  assert.ok(!passport.isError, `memory.passport.upsert errored: ${JSON.stringify(passport.content)}`);
  const handoff = await client.callTool({
    name: 'memory.handoff.write',
    arguments: {
      project,
      currentState: `Context stack is testing ${token}`,
      nextSteps: ['Run recall after wakeup'],
    },
  });
  assert.ok(!handoff.isError, `memory.handoff.write errored: ${JSON.stringify(handoff.content)}`);
  const session = await client.callTool({
    name: 'memory.session.save',
    arguments: {
      project,
      title: 'Context Stack Session',
      summary: `Session summary mentions ${token}`,
      decisions: [`Session preserves ${token}`],
    },
  });
  assert.ok(!session.isError, `memory.session.save errored: ${JSON.stringify(session.content)}`);
  const decision = await client.callTool({
    name: 'conversation.decision.capture',
    arguments: {
      project,
      title: `Context decision ${token}`,
      summary: `Decision summary mentions ${token}`,
      decision: `Use context.wakeup for ${token}`,
      tags: ['context'],
    },
  });
  assert.ok(!decision.isError, `conversation.decision.capture errored: ${JSON.stringify(decision.content)}`);

  const wakeup = await client.callTool({
    name: 'context.wakeup',
    arguments: {
      project,
      topic: token,
      maxChars: 8000,
    },
  });
  assert.ok(!wakeup.isError, `context.wakeup errored: ${JSON.stringify(wakeup.content)}`);
  const wakeupPayload = JSON.parse((wakeup.content as Array<{ text: string }>)[0].text) as {
    project: string;
    layers: {
      l0Identity: { content: string };
      l1EssentialStory: {
        handoff: { content: string };
        sessions: Array<{ preview: string }>;
        decisions: Array<{ preview: string }>;
      };
      l2RoomRecall?: { citations: Array<{ path: string; snippet: string }> };
    };
  };
  assert.equal(wakeupPayload.project, project);
  assert.match(wakeupPayload.layers.l0Identity.content, new RegExp(token));
  assert.match(wakeupPayload.layers.l1EssentialStory.handoff.content, new RegExp(token));
  assert.ok(wakeupPayload.layers.l1EssentialStory.sessions.some((item) => item.preview.includes(token)));
  assert.ok(wakeupPayload.layers.l1EssentialStory.decisions.some((item) => item.preview.includes(token)));
  assert.ok(wakeupPayload.layers.l2RoomRecall?.citations.some((citation) => citation.snippet.includes(token)));

  const recall = await client.callTool({
    name: 'context.recall',
    arguments: {
      project,
      query: token,
      adapters: ['filesystem'],
    },
  });
  assert.ok(!recall.isError, `context.recall errored: ${JSON.stringify(recall.content)}`);
  const recallPayload = JSON.parse((recall.content as Array<{ text: string }>)[0].text) as {
    scope: { project: string; glob: string };
    citations: Array<{ path: string; snippet: string }>;
    traceSummary: { selectedAdapters: string[] };
  };
  assert.equal(recallPayload.scope.project, project);
  assert.equal(recallPayload.scope.glob, `10-Projects/${project}/**`);
  assert.deepEqual(recallPayload.traceSummary.selectedAdapters, ['filesystem']);
  assert.ok(
    recallPayload.citations.some((citation) => citation.path.includes('/decisions/') && citation.snippet.includes(token)),
    `context.recall did not cite decision: ${JSON.stringify(recallPayload.citations)}`,
  );

  const deep = await client.callTool({
    name: 'context.deep_search',
    arguments: {
      project,
      query: token,
      adapters: ['filesystem'],
    },
  });
  assert.ok(!deep.isError, `context.deep_search errored: ${JSON.stringify(deep.content)}`);
  const deepPayload = JSON.parse((deep.content as Array<{ text: string }>)[0].text) as {
    trace: { evidence: Array<{ path: string; snippet: string }> };
    citations: Array<{ path: string; snippet: string }>;
  };
  assert.ok(deepPayload.trace.evidence.length > 0, 'context.deep_search should include full trace evidence');
  assert.ok(deepPayload.citations.some((citation) => citation.snippet.includes(token)));
});

test('query.adapters includes kanban by default', async () => {
  const res = await client.callTool({ name: 'query.adapters', arguments: {} });
  assert.ok(!res.isError, `query.adapters errored: ${JSON.stringify(res.content)}`);
  const payload = JSON.parse((res.content as Array<{ text: string }>)[0].text) as {
    adapters: Array<{ name: string; isAvailable: boolean }>;
  };
  assert.ok(
    payload.adapters.some((adapter) => adapter.name === 'kanban' && adapter.isAvailable),
    `kanban adapter missing: ${JSON.stringify(payload)}`,
  );
});

test('query.unified can find kanban cards and markdown memory files', async () => {
  const memoryWrite = await client.callTool({
    name: 'memory.handoff.write',
    arguments: {
      currentState: 'Smoke searchable markdown memory',
      nextSteps: ['Search for smoke-memory-token'],
      files: ['team-board.md'],
    },
  });
  assert.ok(!memoryWrite.isError, `memory.handoff.write errored: ${JSON.stringify(memoryWrite.content)}`);

  const kanbanRes = await client.callTool({
    name: 'query.unified',
    arguments: { query: 'Capture markdown memory', adapters: ['kanban'], maxResults: 5 },
  });
  assert.ok(!kanbanRes.isError, `query.unified kanban errored: ${JSON.stringify(kanbanRes.content)}`);
  const kanbanPayload = JSON.parse((kanbanRes.content as Array<{ text: string }>)[0].text) as {
    results: Array<{ path: string; metadata?: Record<string, unknown> }>;
  };
  assert.ok(
    kanbanPayload.results.some(
      (result) =>
        result.path.startsWith('team-board.md') &&
        result.metadata?.entityType === 'card' &&
        result.metadata?.lane === 'Backlog',
    ),
    `kanban card not found: ${JSON.stringify(kanbanPayload)}`,
  );

  const memoryRes = await client.callTool({
    name: 'query.unified',
    arguments: { query: 'smoke-memory-token', adapters: ['filesystem'], maxResults: 10 },
  });
  assert.ok(!memoryRes.isError, `query.unified memory errored: ${JSON.stringify(memoryRes.content)}`);
  const memoryPayload = JSON.parse((memoryRes.content as Array<{ text: string }>)[0].text) as {
    results: Array<{ path: string }>;
  };
  assert.ok(
    memoryPayload.results.some((result) => result.path.replaceAll('\\', '/') === '00-Inbox/Agent-Memory/agent/handoff.md'),
    `markdown memory file not found: ${JSON.stringify(memoryPayload)}`,
  );
});

test('tools/list includes query.vector (pgvector semantic search)', async () => {
  const res = await client.listTools();
  const names = new Set(res.tools.map((t) => t.name));
  assert.ok(names.has('query.vector'), 'query.vector tool must be registered');
});

test('tools/list includes query.semantic (text -> embed -> vector search)', async () => {
  const res = await client.listTools();
  const names = new Set(res.tools.map((t) => t.name));
  assert.ok(names.has('query.semantic'), 'query.semantic tool must be registered');
});

test('tools/call query.semantic rejects empty query string', async () => {
  const res = await client.callTool({
    name: 'query.semantic',
    arguments: { query: '' },
  });
  assert.ok(res.isError, 'empty query must produce an error response');
});

test('tools/call query.vector rejects empty vector with -32602', async () => {
  const res = await client.callTool({
    name: 'query.vector',
    arguments: { vector: [] },
  });
  // Server should reject; SDK surfaces JSON-RPC errors via isError=true.
  assert.ok(res.isError, 'empty vector must produce an error response');
});

test('tools/call query.vector rejects non-numeric vector', async () => {
  const res = await client.callTool({
    name: 'query.vector',
    arguments: { vector: [1, 2, 'three' as unknown as number] },
  });
  assert.ok(res.isError, 'non-numeric vector must produce an error response');
});

test('tools/call vault.list round-trips the seeded note', async () => {
  const res = await client.callTool({
    name: 'vault.list',
    arguments: { path: '' },
  });
  assert.ok(!res.isError, `vault.list returned an error: ${JSON.stringify(res.content)}`);
  const content = res.content as Array<{ type: string; text: string }>;
  assert.ok(content.length > 0, 'content array populated');
  const payload = JSON.parse(content[0].text);
  // vault.list returns `{ files: string[]; folders: string[] }` (see
  // FsTransport). Keep the assertion tolerant -- accept top-level array
  // or any of files/entries/items -- so a future shape change still
  // exercises the round-trip without a brittle schema lock.
  const buckets: unknown[] = Array.isArray(payload)
    ? payload
    : [payload.files, payload.folders, payload.entries, payload.items].filter(Array.isArray);
  const flat = JSON.stringify(buckets);
  assert.ok(flat.includes('hello.md'), `seed note missing from listing: ${JSON.stringify(payload)}`);
});

test('tools/call vault.exists agrees with vault.list on the seed', async () => {
  const res = await client.callTool({
    name: 'vault.exists',
    arguments: { path: 'hello.md' },
  });
  assert.ok(!res.isError, `vault.exists errored: ${JSON.stringify(res.content)}`);
  const payload = JSON.parse((res.content as Array<{ text: string }>)[0].text);
  // Accept either boolean or { exists: true }.
  const exists = typeof payload === 'boolean' ? payload : Boolean(payload?.exists);
  assert.equal(exists, true, 'seed note should exist');
});

// Regression guard for the bundled pglite/vector path bug. Spawns a
// SECOND server with the default adapter list (which includes
// vaultbrain) and verifies it boots without crashing. Pre-fix this
// threw "Extension bundle not found: .../vector.tar.gz" at startup.
test('server boots with vaultbrain enabled (pglite extension path regression guard)', async () => {
  const vbRoot = join(tmpdir(), `obsidian-llm-wiki-smoke-vb-${randomUUID()}`);
  mkdirSync(vbRoot, { recursive: true });
  writeFileSync(join(vbRoot, 'seed.md'), '# seed\n', 'utf-8');
  // VAULT_MIND_VAULT_PATH env is authoritative (loadConfig precedence:
  // env > ./yaml > ../yaml), and the server uses its default adapter list
  // which includes vaultbrain.
  const vbTransport = new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE_PATH],
    cwd: vbRoot,
    env: { ...process.env, VAULT_MIND_VAULT_PATH: vbRoot },
    stderr: 'pipe',
  });
  const vbClient = new Client(
    { name: 'smoke-test-vb', version: '0.0.1' },
    { capabilities: {} },
  );
  try {
    await vbClient.connect(vbTransport);
    const res = await vbClient.listTools();
    assert.ok(res.tools.length > 0, 'server with vaultbrain enabled must still register tools');
  } finally {
    try { await vbClient.close(); } catch { /* best effort */ }
    try { await vbTransport.close(); } catch { /* best effort */ }
    rmSync(vbRoot, { recursive: true, force: true });
  }
});

test('collaboration policy enforces actor write boundaries and audits writes', async () => {
  const policyRoot = join(tmpdir(), `obsidian-llm-wiki-policy-${randomUUID()}`);
  mkdirSync(join(policyRoot, '00-Inbox', 'AI-Output', 'codex'), { recursive: true });
  mkdirSync(join(policyRoot, '00-Inbox', 'AI-Output', 'claude'), { recursive: true });
  mkdirSync(join(policyRoot, '30-Architecture'), { recursive: true });
  writeFileSync(
    join(policyRoot, '.vault-collab.json'),
    JSON.stringify({ agents: ['codex', 'claude'], protected_paths: ['30-Architecture/**'] }),
    'utf-8',
  );
  const policyTransport = new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE_PATH],
    cwd: policyRoot,
    env: {
      ...process.env,
      VAULT_MIND_VAULT_PATH: policyRoot,
      VAULT_MIND_ADAPTERS: 'filesystem',
      VAULT_MIND_ACTOR: 'codex',
      VAULT_MIND_ROLE: 'agent',
    },
    stderr: 'pipe',
  });
  const policyClient = new Client(
    { name: 'smoke-test-policy', version: '0.0.1' },
    { capabilities: {} },
  );
  try {
    await policyClient.connect(policyTransport);
    const allowed = await policyClient.callTool({
      name: 'vault.create',
      arguments: { path: '00-Inbox/AI-Output/codex/ok.md', content: 'ok', dryRun: false },
    });
    assert.ok(!allowed.isError, `own actor path should be allowed: ${JSON.stringify(allowed.content)}`);

    const otherAgent = await policyClient.callTool({
      name: 'vault.create',
      arguments: { path: '00-Inbox/AI-Output/claude/no.md', content: 'no', dryRun: false },
    });
    assert.ok(otherAgent.isError, 'writing another agent namespace must be blocked');

    const batch = await policyClient.callTool({
      name: 'vault.batch',
      arguments: {
        dryRun: false,
        operations: [{ method: 'vault.create', params: { path: '30-Architecture/batch-hole.md', content: 'no' } }],
      },
    });
    assert.ok(batch.isError, 'batch must not bypass collaboration policy');

    const auditDir = join(policyRoot, '.wiki-audit');
    assert.ok(existsSync(auditDir), 'successful real write must create audit directory');
    const auditFiles = readdirSync(auditDir).filter((f) => f.endsWith('.jsonl'));
    assert.ok(auditFiles.length > 0, 'audit jsonl file must be present');
    const auditBody = readFileSync(join(auditDir, auditFiles[0]), 'utf-8');
    assert.ok(auditBody.includes('"actor":"codex"'), 'audit log records actor');
    assert.ok(auditBody.includes('00-Inbox/AI-Output/codex/ok.md'), 'audit log records target path');
  } finally {
    try { await policyClient.close(); } catch { /* best effort */ }
    try { await policyTransport.close(); } catch { /* best effort */ }
    rmSync(policyRoot, { recursive: true, force: true });
  }
});

test('workflow agent policy slugifies default actor namespace', async () => {
  const policyRoot = join(tmpdir(), `obsidian-llm-wiki-workflow-policy-${randomUUID()}`);
  mkdirSync(policyRoot, { recursive: true });
  const policyTransport = new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE_PATH],
    cwd: policyRoot,
    env: {
      ...process.env,
      VAULT_MIND_VAULT_PATH: policyRoot,
      VAULT_MIND_ADAPTERS: 'filesystem',
      VAULT_MIND_ACTOR: 'Claude Code',
      VAULT_MIND_ROLE: 'agent',
    },
    stderr: 'pipe',
  });
  const policyClient = new Client(
    { name: 'smoke-test-workflow-policy', version: '0.0.1' },
    { capabilities: {} },
  );
  try {
    await policyClient.connect(policyTransport);
    const result = await policyClient.callTool({
      name: 'workflow.agent.join',
      arguments: { project: 'Policy Project', objective: 'policy path regression' },
    });
    assert.ok(!result.isError, `slugified default actor path should be allowed: ${JSON.stringify(result.content)}`);
    assert.ok(
      existsSync(join(policyRoot, '01-Projects', 'policy-project', 'agents', 'claude-code', 'lifetime.md')),
      'workflow lifetime should be written under the slugified actor namespace',
    );
  } finally {
    try { await policyClient.close(); } catch { /* best effort */ }
    try { await policyTransport.close(); } catch { /* best effort */ }
    rmSync(policyRoot, { recursive: true, force: true });
  }
});

test('collaboration policy rejects malformed policy JSON objects', async () => {
  const badPolicyRoot = join(tmpdir(), `obsidian-llm-wiki-bad-policy-${randomUUID()}`);
  mkdirSync(join(badPolicyRoot, '00-Inbox', 'AI-Output', 'codex'), { recursive: true });
  writeFileSync(join(badPolicyRoot, '.vault-collab.json'), 'null', 'utf-8');
  const badPolicyTransport = new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE_PATH],
    cwd: badPolicyRoot,
    env: {
      ...process.env,
      VAULT_MIND_VAULT_PATH: badPolicyRoot,
      VAULT_MIND_ADAPTERS: 'filesystem',
      VAULT_MIND_ACTOR: 'codex',
      VAULT_MIND_ROLE: 'agent',
    },
    stderr: 'pipe',
  });
  const badPolicyClient = new Client(
    { name: 'smoke-test-bad-policy', version: '0.0.1' },
    { capabilities: {} },
  );
  try {
    await badPolicyClient.connect(badPolicyTransport);
    const res = await badPolicyClient.callTool({
      name: 'vault.create',
      arguments: { path: '00-Inbox/AI-Output/codex/no.md', content: 'no', dryRun: false },
    });
    assert.ok(res.isError, 'non-object policy JSON must reject real writes');
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? '';
    assert.ok(text.includes('expected a JSON object'), `unexpected error: ${text}`);
  } finally {
    try { await badPolicyClient.close(); } catch { /* best effort */ }
    try { await badPolicyTransport.close(); } catch { /* best effort */ }
    rmSync(badPolicyRoot, { recursive: true, force: true });
  }
});
