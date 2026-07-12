import {
  asRecordArray,
  contextEdges,
  loadContextCore,
  makeContextCorePath,
  matchesTopic,
  type ContextCoreStore,
  type Operation,
} from './context-core.js';

export function makeProvenanceOperations(vaultPath: string, contextCorePath?: string): Operation[] {
  const rootPath = makeContextCorePath(vaultPath, contextCorePath);
  const readStore = () => loadContextCore(rootPath);

  return [
    {
      name: 'fact.provenance',
      namespace: 'fact',
      description: 'Return provenance for a fact or claim id from Context Core provenance and holon fact records.',
      mutating: false,
      params: {
        claim_id: { type: 'string', required: true, description: 'Fact, claim, or causal edge id' },
      },
      handler: async (_ctx, params) => factProvenance(readStore(), String(params.claim_id ?? '')),
    },
    {
      name: 'context.export',
      namespace: 'context',
      description: 'Export the loaded Context Core JSON payload, optionally filtered by domain.',
      mutating: false,
      params: {
        domain: { type: 'string', required: false, description: 'Optional domain filter' },
      },
      handler: async (_ctx, params) => contextExport(readStore(), params.domain ? String(params.domain) : undefined),
    },
  ];
}

function factProvenance(store: ContextCoreStore | null, claimId: string): unknown {
  if (!store) return { error: 'context_core_not_found' };
  if (!claimId) throw new Error('claim_id required');

  const direct = store.provenance[claimId];
  const fact = store.holons
    .flatMap((holon) => asRecordArray(holon.facts).map((item) => ({ ...item, holon_id: holon.id })))
    .find((item: Record<string, unknown>) => String(item.id ?? item.claim_id ?? '') === claimId);
  const edge = contextEdges(store).find((item) => item.id === claimId || item.provenance_id === claimId);

  if (!direct && !fact && !edge) return { error: 'provenance_not_found', claim_id: claimId };

  return {
    claim_id: claimId,
    provenance: direct ?? null,
    fact: fact ?? edge?.raw ?? null,
    source_note: valueFrom(direct, 'source_note') ?? valueFrom(fact, 'source_note') ?? valueFrom(edge?.raw, 'source_note'),
    paragraph_index: valueFrom(direct, 'paragraph_index') ?? valueFrom(fact, 'paragraph_index') ?? valueFrom(edge?.raw, 'paragraph_index'),
    extracted_by: valueFrom(direct, 'extracted_by') ?? valueFrom(fact, 'extracted_by') ?? valueFrom(edge?.raw, 'extracted_by'),
    context_core: store.rootPath,
  };
}

function contextExport(store: ContextCoreStore | null, domain?: string): unknown {
  if (!store) return { error: 'context_core_not_found' };
  const holons = domain
    ? store.holons.filter((holon) => matchesTopic(store, domain, [holon.domain, store.manifest.domain]))
    : store.holons;
  return {
    manifest: store.manifest,
    ontology: store.ontology,
    holons,
    causal_graph: store.causalGraph,
    provenance: store.provenance,
  };
}

function valueFrom(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}
