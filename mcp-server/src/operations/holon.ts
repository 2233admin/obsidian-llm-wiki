import { findHolon, loadContextCore, makeContextCorePath, type Operation } from './context-core.js';

export function makeHolonOperations(vaultPath: string, contextCorePath?: string): Operation[] {
  const rootPath = makeContextCorePath(vaultPath, contextCorePath);
  return [
    {
      name: 'vault.holon',
      namespace: 'vault',
      description: 'Read a compiled Context Core holon by id, including facts, relations, and provenance.',
      mutating: false,
      params: {
        id: { type: 'string', required: true, description: 'Holon id, for example trading/macro-2026' },
      },
      handler: async (_ctx, params) => {
        const id = String(params.id ?? '');
        if (!id) throw new Error('id required');
        const store = loadContextCore(rootPath);
        if (!store) return { error: 'context_core_not_found', path: rootPath };
        const holon = findHolon(store, id);
        if (!holon) return { error: 'holon_not_found', id };
        return holon;
      },
    },
  ];
}
