import type { Operation } from '../core/types.js';
import type { ContextCoreLoader, Holon } from './loader.js';

interface ChainNode {
  id: string;
  title: string;
  kind: string;
  depth: number;
  via_edge?: { relation: string; confidence: number };
}

function bfsChain(
  loader: ContextCoreLoader,
  startId: string,
  maxDepth: number,
  minConf: number,
): ChainNode[] {
  const start = loader.byId(startId);
  if (!start) return [];
  const visited = new Set<string>();
  const queue: Array<{ holon: Holon; depth: number; via?: { relation: string; confidence: number } }> = [
    { holon: start, depth: 0 },
  ];
  const result: ChainNode[] = [];
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (visited.has(item.holon.id)) continue;
    visited.add(item.holon.id);
    result.push({
      id:    item.holon.id,
      title: item.holon.title,
      kind:  item.holon.kind,
      depth: item.depth,
      ...(item.via ? { via_edge: item.via } : {}),
    });
    if (item.depth < maxDepth) {
      for (const edge of item.holon.causal_edges) {
        if (edge.confidence < minConf) continue;
        const target = loader.byId(edge.target_id);
        if (target && !visited.has(target.id)) {
          queue.push({
            holon: target,
            depth: item.depth + 1,
            via:   { relation: edge.relation, confidence: edge.confidence },
          });
        }
      }
    }
  }
  return result;
}

function notReady(path: string) {
  return { error: 'context-core.json not found', hint: `Run: python -m compiler <vault_path> -o ${path}` };
}

export function makeCausalOps(loader: ContextCoreLoader): Operation[] {
  return [
    {
      name: 'causal.chain',
      namespace: 'causal' as Operation['namespace'],
      description: 'BFS-traverse the causal graph outward from a starting holon',
      mutating: false,
      params: {
        id:             { type: 'string', required: true,  description: 'Starting holon ID' },
        max_depth:      { type: 'number', required: false, description: 'Max traversal depth (default: 3)', default: 3 },
        min_confidence: { type: 'number', required: false, description: 'Min edge confidence 0–1 (default: 0)', default: 0 },
      },
      handler: async (_ctx, params) => {
        if (!loader.get()) return notReady(loader.path);
        const id       = params.id as string;
        const maxDepth = (params.max_depth      as number | undefined) ?? 3;
        const minConf  = (params.min_confidence as number | undefined) ?? 0;
        if (!loader.byId(id)) return { error: `Holon not found: ${id}` };
        const nodes = bfsChain(loader, id, maxDepth, minConf);
        return { start_id: id, node_count: nodes.length, nodes };
      },
    },

    {
      name: 'causal.neighbors',
      namespace: 'causal' as Operation['namespace'],
      description: 'Get direct causal neighbors (depth 1) of a holon',
      mutating: false,
      params: {
        id:        { type: 'string', required: true,  description: 'Holon ID' },
        direction: {
          type: 'string', required: false,
          description: 'outbound | inbound | both (default: outbound)',
          enum: ['outbound', 'inbound', 'both'],
          default: 'outbound',
        },
      },
      handler: async (_ctx, params) => {
        const cc = loader.get();
        if (!cc) return notReady(loader.path);
        const id  = params.id as string;
        const dir = (params.direction as string | undefined) ?? 'outbound';
        const h   = loader.byId(id);
        if (!h) return { error: `Holon not found: ${id}` };

        const outbound = (dir === 'outbound' || dir === 'both')
          ? h.causal_edges.map(e => ({
              target_id:    e.target_id,
              target_title: loader.byId(e.target_id)?.title ?? e.target_id,
              relation:     e.relation,
              confidence:   e.confidence,
            }))
          : [];

        const inbound = (dir === 'inbound' || dir === 'both')
          ? cc.holons.flatMap(src =>
              src.causal_edges
                .filter(e => e.target_id === id)
                .map(e => ({
                  source_id:    src.id,
                  source_title: src.title,
                  relation:     e.relation,
                  confidence:   e.confidence,
                }))
            )
          : [];

        return { id, outbound, inbound };
      },
    },

    {
      name: 'causal.hyperedges',
      namespace: 'causal' as Operation['namespace'],
      description: 'List all n-ary hyperedges (meetings, events, collaborations) involving a holon, or all hyperedges if no id given',
      mutating: false,
      params: {
        id:       { type: 'string', required: false, description: 'Holon ID to filter by (omit for all hyperedges)' },
        relation: { type: 'string', required: false, description: 'Filter by relation type (e.g. "meeting")' },
      },
      handler: async (_ctx, params) => {
        const cc = loader.get();
        if (!cc) return notReady(loader.path);
        const id       = params.id as string | undefined;
        const relation = params.relation as string | undefined;

        let edges = cc.hyper_edges ?? [];
        if (id) {
          if (!loader.byId(id)) return { error: `Holon not found: ${id}` };
          edges = edges.filter(e => e.participants.includes(id));
        }
        if (relation) {
          edges = edges.filter(e => e.relation === relation);
        }

        const enriched = edges.map(e => ({
          participants: e.participants.map(pid => ({
            id:    pid,
            title: loader.byId(pid)?.title ?? pid,
          })),
          relation:      e.relation,
          confidence:    e.confidence,
          provenance_id: e.provenance_id,
          provenance_title: loader.byId(e.provenance_id)?.title ?? e.provenance_id,
        }));

        return { count: enriched.length, hyper_edges: enriched };
      },
    },
  ];
}
