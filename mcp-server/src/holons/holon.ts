import type { Operation } from '../core/types.js';
import type { ContextCoreLoader, Holon } from './loader.js';

function notReady(path: string) {
  return { error: 'context-core.json not found', hint: `Run: python -m compiler <vault_path> -o ${path}` };
}

export function makeHolonOps(loader: ContextCoreLoader): Operation[] {
  return [
    {
      name: 'holon.get',
      namespace: 'holon' as Operation['namespace'],
      description: 'Get a compiled holon by ID',
      mutating: false,
      params: {
        id: { type: 'string', required: true, description: 'Holon ID (e.g. concepts/attention)' },
      },
      handler: async (_ctx, params) => {
        const cc = loader.get();
        if (!cc) return notReady(loader.path);
        const h = loader.byId(params.id as string);
        if (!h) return { error: `Holon not found: ${params.id as string}` };
        return h;
      },
    },

    {
      name: 'holon.list',
      namespace: 'holon' as Operation['namespace'],
      description: 'List compiled holons with optional kind/status filter',
      mutating: false,
      params: {
        kind:   { type: 'string', required: false, description: 'Filter by kind (research, decision, note, knowledge-task, …)' },
        status: { type: 'string', required: false, description: 'Filter by status (active, frozen, …)' },
        limit:  { type: 'number', required: false, description: 'Max results (default: 50)', default: 50 },
      },
      handler: async (_ctx, params) => {
        const cc = loader.get();
        if (!cc) return notReady(loader.path);
        const kind   = params.kind   as string | undefined;
        const status = params.status as string | undefined;
        const limit  = (params.limit  as number | undefined) ?? 50;
        let holons: Holon[] = cc.holons;
        if (kind)   holons = holons.filter(h => h.kind   === kind);
        if (status) holons = holons.filter(h => h.status === status);
        return { holons: holons.slice(0, limit), total: holons.length, exported_at: cc.exported_at };
      },
    },

    {
      name: 'holon.search',
      namespace: 'holon' as Operation['namespace'],
      description: 'Search holons by title or summary (case-insensitive substring)',
      mutating: false,
      params: {
        query: { type: 'string', required: true,  description: 'Search string' },
        limit: { type: 'number', required: false, description: 'Max results (default: 20)', default: 20 },
      },
      handler: async (_ctx, params) => {
        const cc = loader.get();
        if (!cc) return notReady(loader.path);
        const q     = (params.query as string).toLowerCase();
        const limit = (params.limit as number | undefined) ?? 20;
        const hits  = cc.holons.filter(h =>
          h.title.toLowerCase().includes(q) || h.summary.toLowerCase().includes(q)
        );
        return { holons: hits.slice(0, limit), total: hits.length, query: params.query };
      },
    },

    {
      name: 'holon.tasks',
      namespace: 'holon' as Operation['namespace'],
      description: 'List knowledge-task holons with task stats',
      mutating: false,
      params: {
        status: { type: 'string', required: false, description: 'Filter by status (active, frozen, …)' },
      },
      handler: async (_ctx, params) => {
        const cc = loader.get();
        if (!cc) return notReady(loader.path);
        const status = params.status as string | undefined;
        const allTasks = cc.holons.filter(h => h.kind === 'knowledge-task');
        const byStatus: Record<string, number> = {};
        for (const t of allTasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
        let tasks = allTasks.sort((a, b) => a.id.localeCompare(b.id));
        if (status) tasks = tasks.filter(h => h.status === status);
        return {
          tasks,
          stats: { total: allTasks.length, by_status: byStatus },
        };
      },
    },
  ];
}
