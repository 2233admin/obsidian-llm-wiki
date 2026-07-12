import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface Operation {
  name: string;
  namespace: string;
  description: string;
  mutating: boolean;
  params: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    required?: boolean;
    description?: string;
    default?: unknown;
    enum?: string[];
  }>;
  handler: (_ctx: unknown, params: Record<string, unknown>) => Promise<unknown>;
}

export interface ContextCoreStore {
  rootPath: string;
  manifest: Record<string, unknown>;
  ontology: unknown;
  holons: Record<string, unknown>[];
  causalGraph: Record<string, unknown>;
  provenance: Record<string, unknown>;
}

export interface CausalEdge {
  id?: string;
  source: string;
  target: string;
  relation: string;
  confidence: number;
  claim?: string;
  provenance_id?: string;
  raw: Record<string, unknown>;
}

export function makeContextCorePath(vaultPath: string, explicitPath?: string): string {
  if (explicitPath) return resolve(explicitPath);
  if (process.env.CONTEXT_CORE_PATH) return resolve(process.env.CONTEXT_CORE_PATH);
  const kbContextCore = resolve(vaultPath, 'KB', 'context-core');
  if (existsSync(kbContextCore)) return kbContextCore;
  return resolve(dirname(vaultPath), 'context-core.json');
}

export function loadContextCore(rootPath: string): ContextCoreStore | null {
  if (!existsSync(rootPath)) return null;
  const st = statSync(rootPath);
  if (st.isDirectory()) {
    const manifest = objectOrEmpty(readJsonIfExists(join(rootPath, 'manifest.json')));
    return {
      rootPath,
      manifest,
      ontology: readJsonIfExists(join(rootPath, 'ontology.json')) ?? null,
      holons: readHolonsDirectory(join(rootPath, 'holons')),
      causalGraph: objectOrEmpty(readJsonIfExists(join(rootPath, 'causal-graph.json'))),
      provenance: objectOrEmpty(readJsonIfExists(join(rootPath, 'provenance.json'))),
    };
  }

  const data = objectOrEmpty(readJsonIfExists(rootPath));
  return {
    rootPath,
    manifest: objectOrEmpty(data.manifest ?? data),
    ontology: data.ontology ?? null,
    holons: asRecordArray(data.holons),
    causalGraph: objectOrEmpty(data.causalGraph ?? data.causal_graph ?? data.graph ?? { edges: data.causal_edges }),
    provenance: objectOrEmpty(data.provenance),
  };
}

export function requireContextCore(rootPath: string): ContextCoreStore {
  const store = loadContextCore(rootPath);
  if (!store) {
    throw new Error(`Context Core not found at ${rootPath}`);
  }
  return store;
}

export function findHolon(store: ContextCoreStore, id: string): Record<string, unknown> | undefined {
  return store.holons.find((holon) => String(holon.id ?? '') === id);
}

export function holonTitle(store: ContextCoreStore, id: string): string {
  const holon = findHolon(store, id);
  return String(holon?.title ?? holon?.name ?? id);
}

export function contextEdges(store: ContextCoreStore): CausalEdge[] {
  const graphEdges = [
    ...asRecordArray(store.causalGraph.edges),
    ...asRecordArray(store.causalGraph.causal_edges),
    ...asRecordArray(store.causalGraph.relations),
  ];
  const holonEdges = store.holons.flatMap((holon) => {
    const source = String(holon.id ?? '');
    return [
      ...asRecordArray(holon.relations),
      ...asRecordArray(holon.causal_edges),
      ...asRecordArray(holon.facts),
    ].map((edge) => ({ ...edge, source_id: edge.source_id ?? edge.source ?? edge.from ?? source }));
  });

  const seen = new Set<string>();
  return [...graphEdges, ...holonEdges]
    .map(normalizeEdge)
    .filter((edge): edge is CausalEdge => {
      if (!edge) return false;
      const key = `${edge.source}\0${edge.target}\0${edge.relation}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function matchesTopic(store: ContextCoreStore, topic: string, values: unknown[]): boolean {
  const needle = topic.toLowerCase();
  return values.some((value) => {
    const text = String(value ?? '').toLowerCase();
    if (text.includes(needle)) return true;
    const holon = findHolon(store, String(value ?? ''));
    return JSON.stringify(holon ?? {}).toLowerCase().includes(needle);
  });
}

export function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> => isRecord(item));
  }
  if (isRecord(value)) return Object.values(value).filter((item): item is Record<string, unknown> => isRecord(item));
  return [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readHolonsDirectory(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      const data = readJsonIfExists(join(path, name));
      return Array.isArray(data) ? asRecordArray(data) : isRecord(data) ? [data] : [];
    });
}

function readJsonIfExists(path: string): unknown {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function normalizeEdge(edge: Record<string, unknown>): CausalEdge | null {
  const source = String(edge.source_id ?? edge.source ?? edge.from ?? '');
  const target = String(edge.target_id ?? edge.target ?? edge.to ?? '');
  const relation = String(edge.relation ?? edge.predicate ?? edge.type ?? '');
  if (!source || !target || !relation) return null;
  const confidenceRaw = Number(edge.confidence ?? edge.weight ?? 1);
  return {
    id: typeof edge.id === 'string' ? edge.id : undefined,
    source,
    target,
    relation,
    confidence: Number.isFinite(confidenceRaw) ? confidenceRaw : 1,
    claim: typeof edge.claim === 'string' ? edge.claim : undefined,
    provenance_id: typeof edge.provenance_id === 'string' ? edge.provenance_id : undefined,
    raw: edge,
  };
}
