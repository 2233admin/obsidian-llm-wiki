import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Operation } from '../core/types.js';
import type { ContextCoreLoader, Holon } from './loader.js';

interface GraphNode {
  id: string;
  title: string;
  kind: string;
  depth: number;
  edges: Array<{ target_id: string; relation: string; confidence: number }>;
}

function bfsGraph(loader: ContextCoreLoader, startId: string, maxDepth: number): GraphNode[] {
  const start = loader.byId(startId);
  if (!start) return [];
  const visited = new Set<string>();
  const queue: Array<{ holon: Holon; depth: number }> = [{ holon: start, depth: 0 }];
  const nodes: GraphNode[] = [];
  while (queue.length > 0) {
    const { holon, depth } = queue.shift()!;
    if (visited.has(holon.id)) continue;
    visited.add(holon.id);
    nodes.push({
      id: holon.id,
      title: holon.title,
      kind: holon.kind,
      depth,
      edges: holon.causal_edges.map(e => ({
        target_id: e.target_id,
        relation: e.relation,
        confidence: e.confidence,
      })),
    });
    if (depth < maxDepth) {
      for (const edge of holon.causal_edges) {
        const target = loader.byId(edge.target_id);
        if (target && !visited.has(target.id)) {
          queue.push({ holon: target, depth: depth + 1 });
        }
      }
    }
  }
  return nodes;
}

function mermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

function toMermaid(nodes: GraphNode[]): string {
  const lines = ['graph LR'];
  const nodeIds = new Set(nodes.map(n => n.id));
  for (const node of nodes) {
    const label = node.title.replace(/"/g, "'");
    lines.push(`  ${mermaidId(node.id)}["${label}"]`);
  }
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const edge of node.edges) {
      if (!nodeIds.has(edge.target_id)) continue;
      const key = `${node.id}→${edge.target_id}`;
      if (!seen.has(key)) {
        seen.add(key);
        lines.push(`  ${mermaidId(node.id)} -->|${edge.relation}| ${mermaidId(edge.target_id)}`);
      }
    }
  }
  return lines.join('\n');
}

// Maps kind → Obsidian canvas color index (1-6)
const KIND_COLOR: Record<string, string> = {
  research: '1', decision: '2', 'knowledge-task': '3',
  meeting: '4', concept: '5', event: '4',
};

function toCanvas(nodes: GraphNode[]): object {
  const W = 260, H = 80, COLS = 4, GAP_X = 60, GAP_Y = 40;
  const nodeIds = new Set(nodes.map(n => n.id));
  const canvasNodes = nodes.map((n, i) => ({
    id: n.id,
    type: 'text',
    text: `## ${n.title}\n*${n.kind}*`,
    x: (i % COLS) * (W + GAP_X),
    y: Math.floor(i / COLS) * (H + GAP_Y),
    width: W,
    height: H,
    color: KIND_COLOR[n.kind] ?? '6',
  }));
  const canvasEdges: object[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const edge of node.edges) {
      if (!nodeIds.has(edge.target_id)) continue;
      const key = `${node.id}→${edge.target_id}`;
      if (!seen.has(key)) {
        seen.add(key);
        canvasEdges.push({
          id: key,
          fromNode: node.id,
          fromSide: 'right',
          toNode: edge.target_id,
          toSide: 'left',
          label: `${edge.relation} (${edge.confidence.toFixed(2)})`,
        });
      }
    }
  }
  return { nodes: canvasNodes, edges: canvasEdges };
}

function toDot(nodes: GraphNode[]): string {
  const nodeIds = new Set(nodes.map(n => n.id));
  const lines = ['digraph G {', '  rankdir=LR;', '  node [shape=box fontname=Helvetica];'];
  for (const node of nodes) {
    const label = node.title.replace(/"/g, "'");
    lines.push(`  "${node.id}" [label="${label}" tooltip="${node.kind}"];`);
  }
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const edge of node.edges) {
      if (!nodeIds.has(edge.target_id)) continue;
      const key = `${node.id}→${edge.target_id}`;
      if (!seen.has(key)) {
        seen.add(key);
        lines.push(`  "${node.id}" -> "${edge.target_id}" [label="${edge.relation}"];`);
      }
    }
  }
  lines.push('}');
  return lines.join('\n');
}

function notReady(path: string) {
  return { error: 'context-core.json not found', hint: `Run: python -m compiler <vault_path> -o ${path}` };
}

export function makeGraphOps(loader: ContextCoreLoader, vaultPath: string): Operation[] {
  return [
    {
      name: 'graph.export',
      namespace: 'graph' as Operation['namespace'],
      description:
        'Export a causal subgraph as Mermaid diagram, Obsidian Canvas JSON, or Graphviz DOT. ' +
        'When format=canvas and output_path is given, writes the .canvas file into the vault.',
      mutating: false,
      params: {
        id:          { type: 'string', required: true,  description: 'Starting holon ID' },
        depth:       { type: 'number', required: false, description: 'BFS depth (default: 3)', default: 3 },
        format:      { type: 'string', required: false, description: 'mermaid | canvas | dot (default: mermaid)', enum: ['mermaid', 'canvas', 'dot'], default: 'mermaid' },
        output_path: { type: 'string', required: false, description: 'Vault-relative path to write canvas file (e.g. "graphs/attention.canvas"). Only used when format=canvas.' },
      },
      handler: async (_ctx, params) => {
        if (!loader.get()) return notReady(loader.path);
        const id     = params.id     as string;
        const depth  = (params.depth  as number | undefined) ?? 3;
        const format = (params.format as string | undefined) ?? 'mermaid';
        if (!loader.byId(id)) return { error: `Holon not found: ${id}` };

        const nodes     = bfsGraph(loader, id, depth);
        const edgeCount = nodes.reduce((s, n) => s + n.edges.length, 0);

        if (format === 'mermaid') {
          return { format, content: toMermaid(nodes), nodes_count: nodes.length, edge_count: edgeCount };
        }
        if (format === 'dot') {
          return { format, content: toDot(nodes), nodes_count: nodes.length, edge_count: edgeCount };
        }
        // canvas
        const canvas  = toCanvas(nodes);
        const content = JSON.stringify(canvas, null, 2);
        const outRel  = params.output_path as string | undefined;
        let writtenTo: string | undefined;
        if (outRel) {
          const safe = outRel.trim().replace(/\\/g, '/').replace(/^\/+/, '');
          if (!safe || safe.split('/').some(p => p === '..')) {
            return { error: 'Invalid output_path — must be vault-relative with no ".."' };
          }
          const full = join(vaultPath, safe);
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content, 'utf-8');
          writtenTo = safe;
        }
        return {
          format,
          content,
          nodes_count: nodes.length,
          edge_count: edgeCount,
          ...(writtenTo ? { written_to: writtenTo } : {}),
        };
      },
    },
  ];
}
