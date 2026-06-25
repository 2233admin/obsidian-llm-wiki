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
      description: 'Search holons by title or summary. Supports substring (default), BM25 keyword ranking, and hybrid (BM25 + substring merged) modes.',
      mutating: false,
      params: {
        query: { type: 'string', required: true,  description: 'Search string' },
        limit: { type: 'number', required: false, description: 'Max results (default: 20)', default: 20 },
        mode:  { type: 'string', required: false, description: 'substring | bm25 | hybrid (default: substring)', enum: ['substring', 'bm25', 'hybrid'], default: 'substring' },
      },
      handler: async (_ctx, params) => {
        const cc = loader.get();
        if (!cc) return notReady(loader.path);
        const query = params.query as string;
        const limit = (params.limit as number | undefined) ?? 20;
        const mode  = (params.mode  as string | undefined) ?? 'substring';
        const q     = query.toLowerCase();

        if (mode === 'substring') {
          const hits = cc.holons.filter(h =>
            h.title.toLowerCase().includes(q) || h.summary.toLowerCase().includes(q)
          );
          return { holons: hits.slice(0, limit), total: hits.length, query, mode };
        }

        // BM25 helpers
        const tokenize = (text: string) => text.toLowerCase().split(/\W+/).filter(t => t.length > 1);
        const terms    = tokenize(query);
        if (terms.length === 0) return { holons: [], total: 0, query, mode };

        const docs     = cc.holons.map(h => tokenize(`${h.title} ${h.summary}`));
        const avgLen   = docs.reduce((s, d) => s + d.length, 0) / (docs.length || 1);
        const K1 = 1.5, B = 0.75;

        const bm25Score = (docTokens: string[]) => {
          const dl = docTokens.length;
          return terms.reduce((sum, term) => {
            const freq = docTokens.filter(t => t === term).length;
            if (freq === 0) return sum;
            const idf = Math.log((1 + avgLen) / freq + 1);
            const tf  = (freq * (K1 + 1)) / (freq + K1 * (1 - B + B * dl / avgLen));
            return sum + idf * tf;
          }, 0);
        };

        if (mode === 'bm25') {
          const scored = cc.holons
            .map((h, i) => ({ h, score: bm25Score(docs[i]) }))
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score);
          return { holons: scored.slice(0, limit).map(x => x.h), total: scored.length, query, mode };
        }

        // hybrid: union of substring matches + BM25, deduped, BM25-ranked first
        const substringIds = new Set(
          cc.holons.filter(h => h.title.toLowerCase().includes(q) || h.summary.toLowerCase().includes(q)).map(h => h.id)
        );
        const scored = cc.holons
          .map((h, i) => ({
            h,
            score: bm25Score(docs[i]) + (substringIds.has(h.id) ? 1000 : 0),
          }))
          .filter(x => x.score > 0)
          .sort((a, b) => b.score - a.score);
        return { holons: scored.slice(0, limit).map(x => x.h), total: scored.length, query, mode };
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
