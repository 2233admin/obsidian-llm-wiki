import {
  contextEdges,
  findHolon,
  holonTitle,
  loadContextCore,
  makeContextCorePath,
  matchesTopic,
  type CausalEdge,
  type ContextCoreStore,
  type Operation,
} from './context-core.js';

type Direction = 'outbound' | 'inbound';

export function makeCausalOperations(vaultPath: string, contextCorePath?: string): Operation[] {
  const rootPath = makeContextCorePath(vaultPath, contextCorePath);
  const readStore = () => loadContextCore(rootPath);

  return [
    {
      name: 'graph.causes',
      namespace: 'graph',
      description: 'Return the concepts caused by a concept, traversing outbound causal edges by breadth-first search.',
      mutating: false,
      params: {
        concept: { type: 'string', required: true, description: 'Source holon id or concept string' },
        depth: { type: 'number', required: false, default: 2, description: 'Maximum traversal depth' },
      },
      handler: async (_ctx, params) => traverse(readStore(), String(params.concept ?? ''), Number(params.depth ?? 2), 'outbound'),
    },
    {
      name: 'graph.caused_by',
      namespace: 'graph',
      description: 'Return the concepts that cause a concept, traversing inbound causal edges by breadth-first search.',
      mutating: false,
      params: {
        concept: { type: 'string', required: true, description: 'Target holon id or concept string' },
        depth: { type: 'number', required: false, default: 2, description: 'Maximum traversal depth' },
      },
      handler: async (_ctx, params) => traverse(readStore(), String(params.concept ?? ''), Number(params.depth ?? 2), 'inbound'),
    },
    {
      name: 'graph.causal_chain',
      namespace: 'graph',
      description: 'Find a causal path between two holons with cumulative confidence pruning.',
      mutating: false,
      params: {
        from: { type: 'string', required: true, description: 'Starting holon id' },
        to: { type: 'string', required: true, description: 'Target holon id' },
        max_depth: { type: 'number', required: false, default: 5, description: 'Maximum path length' },
        min_confidence: { type: 'number', required: false, default: 0.3, description: 'Minimum cumulative confidence' },
      },
      handler: async (_ctx, params) => causalChain(
        readStore(),
        String(params.from ?? ''),
        String(params.to ?? ''),
        Number(params.max_depth ?? 5),
        Number(params.min_confidence ?? 0.3),
      ),
    },
    {
      name: 'graph.contradict_check',
      namespace: 'graph',
      description: 'Find contradiction records and opposing causal claims related to a topic.',
      mutating: false,
      params: {
        topic: { type: 'string', required: true, description: 'Topic text or holon id' },
      },
      handler: async (_ctx, params) => contradictCheck(readStore(), String(params.topic ?? '')),
    },
  ];
}

function traverse(store: ContextCoreStore | null, concept: string, depth: number, direction: Direction): unknown {
  if (!store) return { error: 'context_core_not_found' };
  if (!concept) throw new Error('concept required');
  const maxDepth = boundedDepth(depth);
  const edges = contextEdges(store);
  const results: Array<Record<string, unknown>> = [];
  const seen = new Set<string>([concept]);
  const queue: Array<{ id: string; depth: number; cumulative: number }> = [{ id: concept, depth: 0, cumulative: 1 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;
    for (const edge of adjacent(edges, current.id, direction)) {
      const next = direction === 'outbound' ? edge.target : edge.source;
      const cumulativeConfidence = current.cumulative * edge.confidence;
      results.push(edgeResult(store, edge, next, current.depth + 1, cumulativeConfidence));
      if (!seen.has(next)) {
        seen.add(next);
        queue.push({ id: next, depth: current.depth + 1, cumulative: cumulativeConfidence });
      }
    }
  }

  return { concept, direction, depth: maxDepth, count: results.length, results };
}

function causalChain(
  store: ContextCoreStore | null,
  from: string,
  to: string,
  maxDepth: number,
  minConfidence: number,
): unknown {
  if (!store) return { error: 'context_core_not_found' };
  if (!from || !to) throw new Error('from and to required');
  const edges = contextEdges(store);
  const queue: Array<{ id: string; path: CausalEdge[]; cumulative: number }> = [{ id: from, path: [], cumulative: 1 }];
  const bestSeen = new Map<string, number>([[from, 1]]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.id === to) {
      return {
        from,
        to,
        status: 'complete',
        cumulative_confidence: current.cumulative,
        path: current.path.map((edge) => edgeResult(store, edge, edge.target, current.path.indexOf(edge) + 1, current.cumulative)),
      };
    }
    if (current.path.length >= boundedDepth(maxDepth)) continue;
    for (const edge of adjacent(edges, current.id, 'outbound')) {
      const cumulative = current.cumulative * edge.confidence;
      if (cumulative < minConfidence) continue;
      if ((bestSeen.get(edge.target) ?? 0) >= cumulative) continue;
      bestSeen.set(edge.target, cumulative);
      queue.push({ id: edge.target, path: [...current.path, edge], cumulative });
    }
  }

  return { from, to, status: 'not_found', max_depth: boundedDepth(maxDepth), min_confidence: minConfidence, path: [] };
}

function contradictCheck(store: ContextCoreStore | null, topic: string): unknown {
  if (!store) return { error: 'context_core_not_found' };
  if (!topic) throw new Error('topic required');
  const explicit = [
    ...records(store.causalGraph.contradictions),
    ...records(store.causalGraph.contradiction),
  ].filter((item) => matchesTopic(store, topic, Object.values(item)));

  const edges = contextEdges(store).filter((edge) => matchesTopic(store, topic, [edge.source, edge.target, edge.claim]));
  const opposing: Array<Record<string, unknown>> = [];
  for (const causes of edges.filter((edge) => edge.relation === 'causes')) {
    for (const prevents of edges.filter((edge) => edge.relation === 'prevents')) {
      if (causes.source === prevents.source && causes.target === prevents.target) {
        opposing.push({ kind: 'opposing_relations', causes: causes.raw, prevents: prevents.raw });
      }
    }
  }

  const contradicts = edges
    .filter((edge) => edge.relation === 'contradicts')
    .map((edge) => edge.raw);
  const contradictions = [...explicit, ...opposing, ...contradicts];
  return { topic, count: contradictions.length, contradictions };
}

function adjacent(edges: CausalEdge[], id: string, direction: Direction): CausalEdge[] {
  return edges.filter((edge) => direction === 'outbound' ? edge.source === id : edge.target === id);
}

function edgeResult(
  store: ContextCoreStore,
  edge: CausalEdge,
  reachedId: string,
  depth: number,
  cumulativeConfidence: number,
): Record<string, unknown> {
  return {
    id: reachedId,
    title: holonTitle(store, reachedId),
    depth,
    cumulative_confidence: cumulativeConfidence,
    edge: {
      source: edge.source,
      source_title: holonTitle(store, edge.source),
      target: edge.target,
      target_title: holonTitle(store, edge.target),
      relation: edge.relation,
      confidence: edge.confidence,
      claim: edge.claim,
      provenance_id: edge.provenance_id,
    },
  };
}

function boundedDepth(depth: number): number {
  if (!Number.isFinite(depth) || depth < 1) return 1;
  return Math.min(Math.floor(depth), 25);
}

function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  if (typeof value === 'object' && value !== null) return Object.values(value).filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  return [];
}
