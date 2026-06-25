import type { Operation } from '../core/types.js';
import type { ContextCoreLoader } from './loader.js';

function notReady(path: string) {
  return { error: 'context-core.json not found', hint: `Run: python -m compiler <vault_path> -o ${path}` };
}

export function makeProvenanceOps(loader: ContextCoreLoader): Operation[] {
  return [
    {
      name: 'provenance.get',
      namespace: 'provenance' as Operation['namespace'],
      description: 'Get provenance for a holon: content hash, wikilinks, and annotated causal edges',
      mutating: false,
      params: {
        id: { type: 'string', required: true, description: 'Holon ID' },
      },
      handler: async (_ctx, params) => {
        const cc = loader.get();
        if (!cc) return notReady(loader.path);
        const id = params.id as string;
        const h  = loader.byId(id);
        if (!h) return { error: `Holon not found: ${id}` };
        const causal_edges = h.causal_edges.map(e => ({
          ...e,
          target_title: loader.byId(e.target_id)?.title ?? e.target_id,
        }));
        return {
          id:           h.id,
          title:        h.title,
          kind:         h.kind,
          status:       h.status,
          content_hash: h.content_hash,
          wikilinks:    h.wikilinks,
          causal_edges,
          exported_at:  cc.exported_at,
          context_core: loader.path,
        };
      },
    },
  ];
}
