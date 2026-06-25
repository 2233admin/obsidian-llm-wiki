import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface CausalEdge {
  source_id: string;
  target_id: string;
  relation: string;
  confidence: number;
  llm_confidence: number;
  cooccur_weight: number;
  provenance_id: string;
}

export interface Holon {
  id: string;
  kind: string;
  entity_type: string;
  title: string;
  summary: string;
  content_hash: string;
  status: string;
  wikilinks: string[];
  causal_edges: CausalEdge[];
}

export interface HyperEdge {
  participants: string[];  // ≥2 holon IDs
  relation: string;
  confidence: number;
  provenance_id: string;
}

export interface ContextCore {
  schema_version: string;
  version: string;
  vault_path: string;
  holon_count: number;
  hyper_edge_count: number;
  exported_at: string;
  holons: Holon[];
  hyper_edges: HyperEdge[];
}

/**
 * Lazy-loading in-memory cache for context-core.json.
 * Call invalidate() after a recompile to force a reload on the next access.
 */
export class ContextCoreLoader {
  private _cache: ContextCore | null = null;
  private _byId: Map<string, Holon> | null = null;
  readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
  }

  available(): boolean {
    return existsSync(this.path);
  }

  private _load(): void {
    const raw = readFileSync(this.path, 'utf-8');
    const data = JSON.parse(raw) as ContextCore;
    this._cache = data;
    this._byId = new Map(data.holons.map(h => [h.id, h]));
  }

  get(): ContextCore | null {
    if (this._cache) return this._cache;
    if (!this.available()) return null;
    this._load();
    return this._cache;
  }

  byId(id: string): Holon | undefined {
    if (!this._byId) {
      if (!this.available()) return undefined;
      this._load();
    }
    return this._byId!.get(id);
  }

  hyperEdgesFor(holonId: string): HyperEdge[] {
    const core = this.get();
    if (!core) return [];
    return (core.hyper_edges ?? []).filter(e => e.participants.includes(holonId));
  }

  invalidate(): void {
    this._cache = null;
    this._byId = null;
  }
}
