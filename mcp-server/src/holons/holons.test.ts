/**
 * Unit tests for Phase 6 MCP tools: holon.*, causal.*, provenance.*
 *
 * Uses a synthetic ContextCore fixture (no real vault / disk I/O) by
 * monkey-patching ContextCoreLoader.get() and .byId() after construction.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ContextCoreLoader } from './loader.js';
import type { ContextCore, Holon, HyperEdge } from './loader.js';
import { makeHolonOps } from './holon.js';
import { makeCausalOps } from './causal.js';
import { makeProvenanceOps } from './provenance.js';
import type { OperationContext } from '../core/types.js';

// ── Fixture ────────────────────────────────────────────────────────────────

const FIXTURE_HYPEREDGES: HyperEdge[] = [
  {
    participants: ['concepts/attention', 'concepts/transformer', 'decisions/use-rope'],
    relation: 'co-decided',
    confidence: 1.0,
    provenance_id: 'events/arch-meeting',
  },
  {
    participants: ['concepts/attention', 'tasks/kv-cache'],
    relation: 'meeting',
    confidence: 0.9,
    provenance_id: 'events/kv-kickoff',
  },
];

const FIXTURE: ContextCore = {
  schema_version: '1',
  version: '0',
  vault_path: '/fake/vault',
  holon_count: 5,
  hyper_edge_count: 2,
  exported_at: '2026-01-01T00:00:00Z',
  hyper_edges: FIXTURE_HYPEREDGES,
  holons: [
    {
      id: 'concepts/attention',
      kind: 'research',
      entity_type: 'Finding',
      title: 'Attention Mechanism',
      summary: 'Self-attention lets tokens attend to all positions.',
      content_hash: 'aa',
      status: 'active',
      wikilinks: ['concepts/transformer'],
      causal_edges: [
        { source_id: 'concepts/attention', target_id: 'concepts/transformer',
          relation: 'enables', confidence: 0.9, llm_confidence: 0.9, cooccur_weight: 0.5,
          provenance_id: 'concepts/attention' },
      ],
    },
    {
      id: 'concepts/transformer',
      kind: 'research',
      entity_type: 'Finding',
      title: 'Transformer Architecture',
      summary: 'Stack of attention + FFN layers.',
      content_hash: 'bb',
      status: 'active',
      wikilinks: [],
      causal_edges: [
        { source_id: 'concepts/transformer', target_id: 'decisions/use-rope',
          relation: 'motivates', confidence: 0.7, llm_confidence: 0.7, cooccur_weight: 0.3,
          provenance_id: 'concepts/transformer' },
      ],
    },
    {
      id: 'decisions/use-rope',
      kind: 'decision',
      entity_type: 'Decision',
      title: 'Use RoPE embeddings',
      summary: 'Rotary position encoding chosen over learned.',
      content_hash: 'cc',
      status: 'frozen',
      wikilinks: [],
      causal_edges: [],
    },
    {
      id: 'tasks/kv-cache',
      kind: 'knowledge-task',
      entity_type: 'Concept',
      title: 'Implement KV Cache',
      summary: 'Speed up inference with key-value caching.',
      content_hash: 'dd',
      status: 'active',
      wikilinks: [],
      causal_edges: [],
    },
    {
      id: 'tasks/rope-docs',
      kind: 'knowledge-task',
      entity_type: 'Concept',
      title: 'Write RoPE docs',
      summary: '',
      content_hash: 'ee',
      status: 'frozen',
      wikilinks: [],
      causal_edges: [],
    },
  ],
};

function makeLoader(): ContextCoreLoader {
  const loader = new ContextCoreLoader('/fake/context-core.json');
  // Bypass disk I/O — inject fixture directly
  (loader as unknown as Record<string, unknown>)['_cache'] = FIXTURE;
  const byIdMap = new Map<string, Holon>(FIXTURE.holons.map(h => [h.id, h]));
  (loader as unknown as Record<string, unknown>)['_byId'] = byIdMap;
  return loader;
}

// Minimal OperationContext (handlers don't use ctx for holon/causal/provenance ops)
const CTX = {} as OperationContext;

// ── holon.* ────────────────────────────────────────────────────────────────

describe('holon.get', () => {
  const ops = makeHolonOps(makeLoader());
  const get = ops.find(o => o.name === 'holon.get')!;

  test('returns holon by id', async () => {
    const result = await get.handler(CTX, { id: 'concepts/attention' }) as Holon;
    assert.equal(result.id, 'concepts/attention');
    assert.equal(result.title, 'Attention Mechanism');
  });

  test('returns error for unknown id', async () => {
    const result = await get.handler(CTX, { id: 'nope' }) as Record<string, string>;
    assert.ok(result.error);
    assert.ok(result.error.includes('not found'));
  });
});

describe('holon.list', () => {
  const ops = makeHolonOps(makeLoader());
  const list = ops.find(o => o.name === 'holon.list')!;

  test('returns all holons without filter', async () => {
    const r = await list.handler(CTX, {}) as { holons: Holon[]; total: number };
    assert.equal(r.total, 5);
  });

  test('filters by kind', async () => {
    const r = await list.handler(CTX, { kind: 'knowledge-task' }) as { holons: Holon[]; total: number };
    assert.equal(r.total, 2);
    assert.ok(r.holons.every(h => h.kind === 'knowledge-task'));
  });

  test('filters by status', async () => {
    const r = await list.handler(CTX, { status: 'frozen' }) as { holons: Holon[]; total: number };
    assert.equal(r.total, 2);
    assert.ok(r.holons.every(h => h.status === 'frozen'));
  });

  test('respects limit', async () => {
    const r = await list.handler(CTX, { limit: 2 }) as { holons: Holon[] };
    assert.equal(r.holons.length, 2);
  });
});

describe('holon.search', () => {
  const ops = makeHolonOps(makeLoader());
  const search = ops.find(o => o.name === 'holon.search')!;

  test('matches title substring (case-insensitive)', async () => {
    const r = await search.handler(CTX, { query: 'rope' }) as { holons: Holon[]; total: number };
    assert.equal(r.total, 2); // "Use RoPE embeddings" + "Write RoPE docs"
  });

  test('matches summary substring', async () => {
    const r = await search.handler(CTX, { query: 'self-attention' }) as { holons: Holon[]; total: number };
    assert.equal(r.total, 1);
    assert.equal(r.holons[0].id, 'concepts/attention');
  });

  test('returns empty for no match', async () => {
    const r = await search.handler(CTX, { query: 'zzznomatch' }) as { holons: Holon[]; total: number };
    assert.equal(r.total, 0);
  });

  // Phase 8 BM25 + hybrid regression tests (fix: standard IDF formula + expose score)

  test('bm25 mode returns hits ordered by score, not insertion order', async () => {
    const r = await search.handler(CTX, { query: 'rope', mode: 'bm25' }) as {
      holons: Array<Holon & { score?: number }>; total: number; mode: string;
    };
    assert.equal(r.mode, 'bm25');
    assert.equal(r.total, 2);
    // Both hits carry a numeric score (regression: previously score was stripped)
    for (const h of r.holons) {
      assert.equal(typeof h.score, 'number');
      assert.ok((h.score ?? 0) > 0);
    }
    // Scores must be monotonically non-increasing (BM25 ranking property)
    const s0 = r.holons[0].score ?? 0;
    const s1 = r.holons[1].score ?? 0;
    assert.ok(s0 >= s1, `expected desc order, got ${s0} < ${s1}`);
  });

  test('bm25 mode ranks doc-with-higher-tf higher than doc-with-lower-tf', async () => {
    // Build a corpus where the standard BM25 IDF and the broken formula
    // give different rankings. Then assert the standard-formula order.
    const sparseFixture: ContextCore = {
      ...FIXTURE,
      holons: [
        { ...FIXTURE.holons[0], id: 'high-tf', title: 'attention attention attention', summary: 'noise' },
        { ...FIXTURE.holons[0], id: 'low-tf',  title: 'noise noise',                 summary: 'attention' },
      ],
    };
    const loader = makeLoader();
    (loader as unknown as Record<string, unknown>)['_cache']    = sparseFixture;
    (loader as unknown as Record<string, unknown>)['_byId']     = new Map(sparseFixture.holons.map(h => [h.id, h]));
    const sparseOps     = makeHolonOps(loader);
    const sparseSearch  = sparseOps.find(o => o.name === 'holon.search')!;
    const r = await sparseSearch.handler(CTX, { query: 'attention', mode: 'bm25' }) as {
      holons: Array<Holon & { score?: number }>; total: number;
    };
    assert.equal(r.total, 2);
    assert.equal(r.holons[0].id, 'high-tf', 'high-tf doc must rank first under standard BM25');
    const s0 = r.holons[0].score ?? 0;
    const s1 = r.holons[1].score ?? 0;
    assert.ok(s0 > s1);
  });

  test('hybrid mode union: BM25 matches first, then substring-only matches', async () => {
    // 'rope' matches both RoPE-bearing docs by BM25 AND substring.
    const r = await search.handler(CTX, { query: 'rope', mode: 'hybrid' }) as {
      holons: Array<Holon & { score?: number }>; total: number; mode: string;
    };
    assert.equal(r.mode, 'hybrid');
    assert.equal(r.total, 2);
    for (const h of r.holons) {
      assert.equal(typeof h.score, 'number');
    }
    // Hybrid boost (+1000) means BM25 hits sort first, but within the
    // BM25-ranked tier the relative order should match the bm25 mode.
    const bm25Only = await search.handler(CTX, { query: 'rope', mode: 'bm25' }) as {
      holons: Array<Holon & { score?: number }>;
    };
    assert.deepEqual(
      r.holons.map(h => h.id),
      bm25Only.holons.map(h => h.id),
    );
  });

  test('substring mode does not attach score field', async () => {
    const r = await search.handler(CTX, { query: 'rope' }) as {
      holons: Array<Holon & { score?: number }>;
    };
    for (const h of r.holons) {
      assert.equal(h.score, undefined, 'substring mode should not attach score');
    }
  });
});

describe('holon.tasks', () => {
  const ops = makeHolonOps(makeLoader());
  const tasks = ops.find(o => o.name === 'holon.tasks')!;

  test('returns only knowledge-task holons', async () => {
    const r = await tasks.handler(CTX, {}) as { tasks: Holon[]; stats: { total: number; by_status: Record<string, number> } };
    assert.equal(r.stats.total, 2);
    assert.ok(r.tasks.every(h => h.kind === 'knowledge-task'));
  });

  test('tasks sorted by id', async () => {
    const r = await tasks.handler(CTX, {}) as { tasks: Holon[] };
    const ids = r.tasks.map(h => h.id);
    assert.deepEqual(ids, [...ids].sort());
  });

  test('filters by status', async () => {
    const r = await tasks.handler(CTX, { status: 'frozen' }) as { tasks: Holon[] };
    assert.equal(r.tasks.length, 1);
    assert.equal(r.tasks[0].id, 'tasks/rope-docs');
  });

  test('stats include by_status breakdown', async () => {
    const r = await tasks.handler(CTX, {}) as { stats: { by_status: Record<string, number> } };
    assert.equal(r.stats.by_status['active'], 1);
    assert.equal(r.stats.by_status['frozen'], 1);
  });
});

// ── causal.* ──────────────────────────────────────────────────────────────

describe('causal.chain', () => {
  const ops = makeCausalOps(makeLoader());
  const chain = ops.find(o => o.name === 'causal.chain')!;

  test('returns start node at depth 0', async () => {
    const r = await chain.handler(CTX, { id: 'concepts/attention', max_depth: 3, min_confidence: 0 }) as {
      nodes: Array<{ id: string; depth: number }>;
    };
    const start = r.nodes.find(n => n.id === 'concepts/attention')!;
    assert.equal(start.depth, 0);
  });

  test('traverses edges transitively', async () => {
    const r = await chain.handler(CTX, { id: 'concepts/attention', max_depth: 3, min_confidence: 0 }) as {
      nodes: Array<{ id: string }>;
    };
    const ids = new Set(r.nodes.map(n => n.id));
    assert.ok(ids.has('concepts/transformer'));
    assert.ok(ids.has('decisions/use-rope'));
  });

  test('respects max_depth', async () => {
    const r = await chain.handler(CTX, { id: 'concepts/attention', max_depth: 1, min_confidence: 0 }) as {
      nodes: Array<{ id: string; depth: number }>;
    };
    assert.ok(r.nodes.every(n => n.depth <= 1));
    const ids = new Set(r.nodes.map(n => n.id));
    assert.ok(!ids.has('decisions/use-rope')); // depth 2 — pruned
  });

  test('respects min_confidence', async () => {
    // attention→transformer = 0.9; transformer→use-rope = 0.7; threshold 0.8 prunes second hop
    const r = await chain.handler(CTX, { id: 'concepts/attention', max_depth: 3, min_confidence: 0.8 }) as {
      nodes: Array<{ id: string }>;
    };
    const ids = new Set(r.nodes.map(n => n.id));
    assert.ok(ids.has('concepts/transformer'));
    assert.ok(!ids.has('decisions/use-rope'));
  });

  test('returns error for unknown id', async () => {
    const r = await chain.handler(CTX, { id: 'nope', max_depth: 3, min_confidence: 0 }) as Record<string, string>;
    assert.ok(r.error);
  });
});

describe('causal.neighbors', () => {
  const ops = makeCausalOps(makeLoader());
  const neighbors = ops.find(o => o.name === 'causal.neighbors')!;

  test('outbound edges include target_title', async () => {
    const r = await neighbors.handler(CTX, { id: 'concepts/attention', direction: 'outbound' }) as {
      outbound: Array<{ target_id: string; target_title: string; relation: string }>;
    };
    assert.equal(r.outbound.length, 1);
    assert.equal(r.outbound[0].target_id, 'concepts/transformer');
    assert.equal(r.outbound[0].relation, 'enables');
    assert.equal(r.outbound[0].target_title, 'Transformer Architecture');
  });

  test('inbound edges', async () => {
    const r = await neighbors.handler(CTX, { id: 'concepts/transformer', direction: 'inbound' }) as {
      inbound: Array<{ source_id: string; relation: string }>;
    };
    assert.equal(r.inbound.length, 1);
    assert.equal(r.inbound[0].source_id, 'concepts/attention');
  });

  test('both direction returns outbound and inbound', async () => {
    const r = await neighbors.handler(CTX, { id: 'concepts/transformer', direction: 'both' }) as {
      outbound: unknown[]; inbound: unknown[];
    };
    assert.equal(r.outbound.length, 1);
    assert.equal(r.inbound.length, 1);
  });

  test('use-rope has one inbound', async () => {
    const r = await neighbors.handler(CTX, { id: 'decisions/use-rope', direction: 'inbound' }) as {
      inbound: Array<{ source_id: string }>;
    };
    assert.equal(r.inbound.length, 1);
    assert.equal(r.inbound[0].source_id, 'concepts/transformer');
  });

  test('returns error for unknown id', async () => {
    const r = await neighbors.handler(CTX, { id: 'nope' }) as Record<string, string>;
    assert.ok(r.error);
  });
});

// ── provenance.* ──────────────────────────────────────────────────────────

describe('provenance.get', () => {
  const ops = makeProvenanceOps(makeLoader());
  const prov = ops.find(o => o.name === 'provenance.get')!;

  test('returns content_hash', async () => {
    const r = await prov.handler(CTX, { id: 'concepts/attention' }) as Record<string, unknown>;
    assert.equal(r['content_hash'], 'aa');
  });

  test('returns wikilinks', async () => {
    const r = await prov.handler(CTX, { id: 'concepts/attention' }) as Record<string, unknown>;
    assert.deepEqual(r['wikilinks'], ['concepts/transformer']);
  });

  test('causal edges enriched with target_title', async () => {
    const r = await prov.handler(CTX, { id: 'concepts/attention' }) as {
      causal_edges: Array<{ target_id: string; target_title: string }>;
    };
    assert.equal(r.causal_edges.length, 1);
    assert.equal(r.causal_edges[0].target_title, 'Transformer Architecture');
  });

  test('includes exported_at', async () => {
    const r = await prov.handler(CTX, { id: 'concepts/attention' }) as Record<string, unknown>;
    assert.equal(r['exported_at'], '2026-01-01T00:00:00Z');
  });

  test('returns error for unknown id', async () => {
    const r = await prov.handler(CTX, { id: 'nope' }) as Record<string, string>;
    assert.ok(r.error);
  });
});

// ── causal.hyperedges ─────────────────────────────────────────────────────

describe('causal.hyperedges', () => {
  const ops = makeCausalOps(makeLoader());
  const hyper = ops.find(o => o.name === 'causal.hyperedges')!;

  test('returns all hyperedges when no id given', async () => {
    const r = await hyper.handler(CTX, {}) as { count: number; hyper_edges: unknown[] };
    assert.equal(r.count, 2);
    assert.equal(r.hyper_edges.length, 2);
  });

  test('filters by holon id', async () => {
    const r = await hyper.handler(CTX, { id: 'tasks/kv-cache' }) as {
      count: number;
      hyper_edges: Array<{ relation: string; participants: Array<{ id: string; title: string }> }>;
    };
    assert.equal(r.count, 1);
    assert.equal(r.hyper_edges[0].relation, 'meeting');
    const participantIds = r.hyper_edges[0].participants.map(p => p.id);
    assert.ok(participantIds.includes('tasks/kv-cache'));
  });

  test('enriches participant titles', async () => {
    const r = await hyper.handler(CTX, { id: 'concepts/attention' }) as {
      hyper_edges: Array<{ participants: Array<{ id: string; title: string }> }>;
    };
    assert.ok(r.hyper_edges.length > 0);
    const attentionPart = r.hyper_edges[0].participants.find(p => p.id === 'concepts/attention');
    assert.equal(attentionPart?.title, 'Attention Mechanism');
  });

  test('filters by relation', async () => {
    const r = await hyper.handler(CTX, { relation: 'meeting' }) as { count: number };
    assert.equal(r.count, 1);
  });

  test('returns error for unknown id', async () => {
    const r = await hyper.handler(CTX, { id: 'nope' }) as Record<string, string>;
    assert.ok(r.error);
  });

  test('hyperedgesFor helper on loader', () => {
    const loader = makeLoader();
    const edges = loader.hyperEdgesFor('tasks/kv-cache');
    assert.equal(edges.length, 1);
    assert.equal(edges[0].relation, 'meeting');
  });
});
