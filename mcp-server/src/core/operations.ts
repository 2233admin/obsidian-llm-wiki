import { execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Operation } from './types.js';
import { scanRecipes, findRecipe } from '../recipes/_registry.js';
import { getRecipeStatus, runHealthCheck, appendHeartbeat } from '../recipes/_framework.js';
import { unifiedQuery } from '../unified-query.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { VaultBrainAdapter } from '../adapters/vaultbrain/index.js';
import type { CompileTrigger } from '../compile-trigger.js';

const execAsync = promisify(execFile);
const PROTECTED_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

const _thisDir = dirname(fileURLToPath(import.meta.url));
const _projectRoot = join(_thisDir, '..', '..', '..');

function makeErr(code: number, message: string): { code: number; message: string } {
  return { code, message };
}

export const operations: Operation[] = [
  {
    name: 'vault.read',
    namespace: 'vault',
    description: "Read a note's content",
    mutating: false,
    params: {
      path: { type: 'string', required: true, description: 'Vault-relative path to the note' },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.read', params),
  },
  {
    name: 'vault.exists',
    namespace: 'vault',
    description: 'Check if a path exists',
    mutating: false,
    params: {
      path: { type: 'string', required: true, description: 'Vault-relative path to check' },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.exists', params),
  },
  {
    name: 'vault.list',
    namespace: 'vault',
    description: 'List files and folders',
    mutating: false,
    params: {
      path: { type: 'string', required: false, description: 'Vault-relative directory path (default: root)', default: '' },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.list', params),
  },
  {
    name: 'vault.stat',
    namespace: 'vault',
    description: 'Get file/folder metadata',
    mutating: false,
    params: {
      path: { type: 'string', required: true, description: 'Vault-relative path' },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.stat', params),
  },
  {
    name: 'vault.create',
    namespace: 'vault',
    description: 'Create a new note (dry-run by default)',
    mutating: true,
    params: {
      path: { type: 'string', required: true, description: 'Vault-relative path for the new note' },
      content: { type: 'string', required: false, description: 'Initial content' },
      dryRun: { type: 'boolean', required: false, description: 'Simulate without writing (default: true)', default: true },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.create', params),
  },
  {
    name: 'vault.modify',
    namespace: 'vault',
    description: 'Overwrite an existing note',
    mutating: true,
    params: {
      path: { type: 'string', required: true, description: 'Vault-relative path to the note' },
      content: { type: 'string', required: true, description: 'New content' },
      dryRun: { type: 'boolean', required: false, description: 'Simulate without writing (default: true)', default: true },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.modify', params),
  },
  {
    name: 'vault.append',
    namespace: 'vault',
    description: 'Append content to a note',
    mutating: true,
    params: {
      path: { type: 'string', required: true, description: 'Vault-relative path to the note' },
      content: { type: 'string', required: true, description: 'Content to append' },
      dryRun: { type: 'boolean', required: false, description: 'Simulate without writing (default: true)', default: true },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.append', params),
  },
  {
    name: 'vault.delete',
    namespace: 'vault',
    description: 'Delete a note or folder',
    mutating: true,
    params: {
      path: { type: 'string', required: true, description: 'Vault-relative path to delete' },
      dryRun: { type: 'boolean', required: false, description: 'Simulate without deleting (default: true)', default: true },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.delete', params),
  },
  {
    name: 'vault.rename',
    namespace: 'vault',
    description: 'Rename/move a file',
    mutating: true,
    params: {
      from: { type: 'string', required: true, description: 'Source vault-relative path' },
      to: { type: 'string', required: true, description: 'Destination vault-relative path' },
      dryRun: { type: 'boolean', required: false, description: 'Simulate without moving (default: true)', default: true },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.rename', params),
  },
  {
    name: 'vault.mkdir',
    namespace: 'vault',
    description: 'Create a directory',
    mutating: true,
    params: {
      path: { type: 'string', required: true, description: 'Vault-relative directory path to create' },
      dryRun: { type: 'boolean', required: false, description: 'Simulate without creating (default: true)', default: true },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.mkdir', params),
  },
  {
    name: 'vault.search',
    namespace: 'vault',
    description: 'Fulltext grep across vault .md files (filesystem-only, single-adapter). Returns matching lines with line numbers, not ranked results. Use regex=true for patterns, glob to restrict scope. For cross-adapter weighted search use query.unified.',
    mutating: false,
    params: {
      query: { type: 'string', required: true, description: 'Search query string' },
      regex: { type: 'boolean', required: false, description: 'Treat query as regex' },
      caseSensitive: { type: 'boolean', required: false, description: 'Case-sensitive matching' },
      maxResults: { type: 'number', required: false, description: 'Maximum results to return (default: 50)', default: 50 },
      glob: { type: 'string', required: false, description: 'Glob pattern to restrict search scope' },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.search', params),
  },
  {
    name: 'vault.searchByTag',
    namespace: 'vault',
    description: 'Find notes with a given tag',
    mutating: false,
    params: {
      tag: { type: 'string', required: true, description: 'Tag to search for (with or without leading #)' },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.searchByTag', params),
  },
  {
    name: 'vault.searchByFrontmatter',
    namespace: 'vault',
    description: 'Find notes by frontmatter key-value',
    mutating: false,
    params: {
      key: { type: 'string', required: true, description: 'Frontmatter key to filter on' },
      value: { type: 'string', required: false, description: 'Value to compare against' },
      op: { type: 'string', required: false, description: 'Comparison operator (default: eq)', default: 'eq', enum: ['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'contains', 'regex', 'exists'] },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.searchByFrontmatter', params),
  },
  {
    name: 'vault.graph',
    namespace: 'vault',
    description: 'Build full wikilink graph of the vault. Returns nodes (with exists flag), edges (from/to/count), orphans (.md files with no inbound links), and unresolvedLinks count. Filter edges with type=resolved|unresolved|both (default both).',
    mutating: false,
    params: {
      type: { type: 'string', required: false, description: 'Link type filter (default: both)', default: 'both', enum: ['resolved', 'unresolved', 'both'] },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.graph', params),
  },
  {
    name: 'vault.backlinks',
    namespace: 'vault',
    description: 'Find notes linking to a note',
    mutating: false,
    params: {
      path: { type: 'string', required: true, description: 'Vault-relative path of the target note' },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.backlinks', params),
  },
  {
    name: 'vault.batch',
    namespace: 'vault',
    description: 'Execute multiple vault operations',
    mutating: false,
    params: {
      operations: { type: 'array', required: true, description: 'Array of {method, params} objects to execute' },
      dryRun: { type: 'boolean', required: false, description: 'Apply dryRun to all mutating operations in the batch' },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.batch', params),
  },
  {
    name: 'vault.lint',
    namespace: 'vault',
    description: 'Vault health audit: finds orphans (no inbound wikilinks), broken wikilinks, empty files, duplicate titles, and optionally missing required frontmatter keys. Read-only; does not check modification time.',
    mutating: false,
    params: {
      requiredFrontmatter: { type: 'array', required: false, description: 'List of frontmatter keys that every note must have' },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.lint', params),
  },
  {
    name: 'vault.init',
    namespace: 'vault',
    description: 'Scaffold a new knowledge base topic',
    mutating: true,
    params: {
      topic: { type: 'string', required: true, description: 'Topic name (used as directory name and KB title)' },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.init', params),
  },
  {
    name: 'vault.enforceDiscipline',
    namespace: 'vault',
    description: "Retroactively enforce Karpathy LLM Wiki discipline: ensure each top-level topic folder has _index.md (catalog) and log.md (chronicle). Skips folders that already have a recognized catalog (Home.md/INDEX.md/README.md) or chronicle (Log.md). Dry-run by default.",
    mutating: true,
    params: {
      dryRun: { type: 'boolean', required: false, description: 'Simulate without writing (default: true)', default: true },
      topLevelOnly: { type: 'boolean', required: false, description: 'Only process top-level directories (default: true)', default: true },
      skipDirs: { type: 'array', required: false, description: 'Additional directory names to skip beyond the built-in protected list' },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.enforceDiscipline', params),
  },
  {
    name: 'vault.writeAIOutput',
    namespace: 'vault',
    description: 'Write a persona-authored analysis into 00-Inbox/AI-Output/{persona}/YYYY-MM-DD-{slug}.md with the 8-field provenance frontmatter (generated-by, generated-at, agent, parent-query, source-nodes, status=draft, scope, quarantine-state). Human confirmation rides on an Obsidian body tag (#user-confirmed), not a frontmatter field. Dry-run by default.',
    mutating: true,
    params: {
      persona: { type: 'string', required: true, description: 'Persona identifier, must match ^vault-[a-z]+$' },
      parentQuery: { type: 'string', required: true, description: "User's original query (truncated to 200 chars)" },
      sourceNodes: { type: 'array', required: true, description: 'Wikilinks cited during analysis (empty array is valid)' },
      agent: { type: 'string', required: true, description: 'Model identifier (e.g. claude-opus-4-7)' },
      body: { type: 'string', required: true, description: 'Markdown body without frontmatter' },
      slug: { type: 'string', required: false, description: 'Optional filename slug; auto-derived from parentQuery if omitted' },
      scope: { type: 'string', required: false, description: 'Governance namespace for the entry (default: project)', default: 'project', enum: ['project', 'global', 'cross-project', 'host-local'] },
      quarantineState: { type: 'string', required: false, description: 'Trust-gate state in the candidate lifecycle (default: new)', default: 'new', enum: ['new', 'reviewed', 'promoted', 'discarded'] },
      reviewStatus: { type: 'string', required: false, description: 'When user-confirmed, appends #user-confirmed tag to the body so Obsidian tag search picks it up. Default: none (no tag appended).', default: 'none', enum: ['none', 'user-confirmed'] },
      dryRun: { type: 'boolean', required: false, description: 'Simulate without writing (default: true)', default: true },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.writeAIOutput', params),
  },
  {
    name: 'vault.sweepAIOutput',
    namespace: 'vault',
    description: 'Sweep 00-Inbox/AI-Output for stale drafts (age > persona threshold and no non-AI-Output backlinks) and supersede candidates (same-persona reviewed pairs with source-nodes Jaccard >= 0.6). Reports candidates; when dry_run=false flips draft→stale in place. Never auto-applies supersede.',
    mutating: true,
    params: {
      dry_run: { type: 'boolean', required: false, description: 'Report only without writing (default: true)', default: true },
      now: { type: 'string', required: false, description: 'Inject ISO 8601 timestamp for deterministic tests' },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.sweepAIOutput', params),
  },
  {
    name: 'vault.getMetadata',
    namespace: 'vault',
    description: 'Get parsed metadata for a note',
    mutating: false,
    params: {
      path: { type: 'string', required: true, description: 'Vault-relative path to the note' },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.getMetadata', params),
  },
  // ── recipe namespace ──────────────────────────────────────────
  {
    name: 'recipe.list',
    namespace: 'recipe',
    description: 'List all recipes with their status (secrets present/missing)',
    mutating: false,
    params: {},
    handler: async (_ctx, _params) => {
      const recipes = scanRecipes();
      return recipes.map(r => ({
        id: r.frontmatter.id,
        name: r.frontmatter.name,
        version: r.frontmatter.version,
        category: r.frontmatter.category,
        description: r.frontmatter.description,
        status: getRecipeStatus(r),
      }));
    },
  },
  {
    name: 'recipe.show',
    namespace: 'recipe',
    description: "Show a recipe's frontmatter and setup guide",
    mutating: false,
    params: {
      id: { type: 'string', required: true, description: 'Recipe id (e.g. x-to-vault)' },
    },
    handler: async (_ctx, params) => {
      const id = params.id;
      if (typeof id !== 'string' || id === '') throw new Error('Missing required param: id');
      const recipe = findRecipe(id);
      if (!recipe) throw new Error(`Recipe not found: ${id}`);
      return { frontmatter: recipe.frontmatter, body: recipe.body };
    },
  },
  {
    name: 'recipe.status',
    namespace: 'recipe',
    description: 'Check secret configuration status for a recipe',
    mutating: false,
    params: {
      id: { type: 'string', required: true, description: 'Recipe id' },
    },
    handler: async (_ctx, params) => {
      const id = params.id;
      if (typeof id !== 'string' || id === '') throw new Error('Missing required param: id');
      const recipe = findRecipe(id);
      if (!recipe) throw new Error(`Recipe not found: ${id}`);
      return getRecipeStatus(recipe);
    },
  },
  {
    name: 'recipe.doctor',
    namespace: 'recipe',
    description: 'Full diagnostic: secrets + health checks for a recipe',
    mutating: true, // writes heartbeat state — side-effecting even though it's diagnostic
    params: {
      id: { type: 'string', required: true, description: 'Recipe id' },
    },
    handler: async (_ctx, params) => {
      const id = params.id;
      if (typeof id !== 'string' || id === '') throw new Error('Missing required param: id');
      const recipe = findRecipe(id);
      if (!recipe) throw new Error(`Recipe not found: ${id}`);
      const status = getRecipeStatus(recipe);
      const checks: Array<{ command: string; ok: boolean; output: string }> = [];
      for (const hc of recipe.frontmatter.health_checks ?? []) {
        const result = runHealthCheck(hc.command);
        checks.push({ command: hc.command, ...result });
        appendHeartbeat(recipe.frontmatter.id, {
          ts: new Date().toISOString(),
          event: 'doctor',
          data: { ok: result.ok },
        });
      }
      return { status, health_checks: checks };
    },
  },
  {
    name: 'recipe.run',
    namespace: 'recipe',
    description: 'Run a recipe collector. Secrets must be set in the MCP server environment.',
    mutating: true,
    params: {
      id: { type: 'string', required: true, description: 'Recipe id (e.g. napcat-to-vault)' },
      timeout_ms: { type: 'number', required: false, description: 'Timeout ms (default 120000)' },
    },
    handler: async (_ctx, params) => {
      const id = params.id;
      if (typeof id !== 'string' || id === '') throw new Error('Missing required param: id');

      const recipe = findRecipe(id);
      if (!recipe) throw new Error(`Recipe not found: ${id}`);

      // Early-out: missing secrets
      const status = getRecipeStatus(recipe);
      if (status.secrets_missing.length > 0) {
        return {
          ok: false,
          exit_code: null,
          error: `Missing secrets: ${status.secrets_missing.join(', ')}`,
          stdout: '',
          stderr: '',
        };
      }

      // Collector path: napcat-to-vault -> napcat-collector.ts
      const stem = id.replace(/-to-vault$/, '');
      const collectorPath = join(_projectRoot, 'recipes', 'collectors', `${stem}-collector.ts`);
      if (!existsSync(collectorPath)) {
        return {
          ok: false,
          exit_code: null,
          error: `No collector at ${collectorPath}`,
          stdout: '',
          stderr: '',
        };
      }

      const timeoutMs = typeof params.timeout_ms === 'number' ? params.timeout_ms : 120_000;
      const result = spawnSync('bun', ['run', collectorPath], {
        timeout: timeoutMs,
        encoding: 'utf8',
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const ok = result.status === 0;
      appendHeartbeat(id, {
        ts: new Date().toISOString(),
        event: 'mcp_run',
        data: { ok, exit_code: result.status },
      });

      const TAIL = 2000;
      return {
        ok,
        exit_code: result.status,
        stdout: ((result.stdout as string) ?? '').slice(-TAIL),
        stderr: ((result.stderr as string) ?? '').slice(-TAIL),
      };
    },
  },
];

// ── compile / query / agent namespaces ───────────────────────────────────────
// These tools need runtime dependencies (CompileTrigger, AdapterRegistry, python
// path, compilerPath). They are constructed via makeAllOperations() so their
// handlers can close over the deps without polluting OperationContext.

export interface AllOperationsDeps {
  compileTrigger: CompileTrigger;
  registry: AdapterRegistry;
  defaultWeights?: Record<string, number>;
  python: string;
  compilerPath: string;
  vaultPath: string;
  configPath?: string;
}

export function makeAllOperations(deps: AllOperationsDeps): Operation[] {
  const { compileTrigger, registry, defaultWeights, python, compilerPath, vaultPath, configPath } = deps;

  const compileOps: Operation[] = [
    {
      name: 'compile.status',
      namespace: 'compile',
      description: 'Get compilation status',
      mutating: false,
      params: {},
      handler: async (_ctx, _params) => compileTrigger.status(),
    },
    {
      name: 'compile.run',
      namespace: 'compile',
      description: 'Run compilation',
      mutating: true,
      params: {
        topic: { type: 'string', required: false, description: 'Topic to compile' },
      },
      handler: async (_ctx, params) => compileTrigger.run(params.topic as string | undefined),
    },
    {
      name: 'compile.diff',
      namespace: 'compile',
      description: 'Show compilation diff',
      mutating: false,
      params: {
        topic: { type: 'string', required: false, description: 'Topic filter' },
      },
      handler: async (_ctx, _params) => ({ dirty: compileTrigger.status().dirty }),
    },
    {
      name: 'compile.abort',
      namespace: 'compile',
      description: 'Abort running compilation',
      mutating: true,
      params: {},
      handler: async (_ctx, _params) => compileTrigger.abort(),
    },
  ];

  const queryOps: Operation[] = [
    {
      name: 'vault.reindex',
      namespace: 'vault',
      description: 'Bulk-index all markdown files into VaultBrain semantic store. Use after initial setup or vault migration.',
      mutating: false,
      params: {
        dryRun: { type: 'boolean', required: false, default: false, description: 'Count files without ingesting (default: false)' },
        concurrency: { type: 'number', required: false, default: 4, description: 'Max concurrent ingest calls (default: 4)' },
      },
      handler: async (_ctx, params) => {
        const vba = (registry as AdapterRegistry).get('vaultbrain') as VaultBrainAdapter | undefined;
        if (!vba) throw makeErr(-32001, 'VaultBrain adapter not available or not initialized');
        const files: string[] = [];
        const walk = (dir: string): void => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
              if (!PROTECTED_DIRS.has(entry.name)) walk(join(dir, entry.name));
            } else if (entry.isFile() && entry.name.endsWith('.md')) {
              files.push(join(dir, entry.name));
            }
          }
        };
        walk(vaultPath);
        if ((params.dryRun as boolean | undefined) ?? false) {
          return { dryRun: true, total: files.length, message: 'Run with dryRun: false to index' };
        }
        const concurrency = Math.max(1, Math.floor((params.concurrency as number | undefined) ?? 4));
        let indexed = 0;
        const errors: string[] = [];
        for (let i = 0; i < files.length; i += concurrency) {
          const batch = files.slice(i, i + concurrency);
          const results = await Promise.allSettled(batch.map(async (fullPath) => {
            const content = readFileSync(fullPath, 'utf-8');
            const relPath = relative(vaultPath, fullPath).replace(/\\/g, '/');
            await vba.ingest(relPath, content);
          }));
          results.forEach((result, idx) => {
            if (result.status === 'fulfilled') indexed++;
            else errors.push(`${relative(vaultPath, batch[idx]).replace(/\\/g, '/')}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
          });
        }
        return { indexed, skipped: errors.length, errors, totalFiles: files.length };
      },
    },
    {
      name: 'query.unified',
      namespace: 'query',
      description: 'Weighted multi-adapter search across all active adapters (filesystem, obsidian, memu, gitnexus). Results merged and re-ranked by per-adapter weight. Use when you want best answers anywhere; for single-adapter search use query.search (filesystem-only, ranked) or vault.search (raw filesystem grep, unranked).',
      mutating: false,
      params: {
        query: { type: 'string', required: true, description: 'Search query string' },
        maxResults: { type: 'number', required: false, description: 'Maximum results to return (default: 50)', default: 50 },
        adapters: { type: 'array', required: false, description: 'Limit to specific adapters by name' },
        weights: { type: 'object', required: false, description: 'Per-adapter score weight multipliers, e.g. {"obsidian":1.2,"filesystem":0.8}' },
        caseSensitive: { type: 'boolean', required: false, description: 'Case-sensitive matching', default: false },
        context: { type: 'number', required: false, description: 'Lines of surrounding context per match' },
      },
      handler: async (_ctx, params) => {
        const query = params.query as string;
        if (!query) throw makeErr(-32602, 'query required');
        const weights = {
          ...defaultWeights,
          ...(params.weights as Record<string, number> | undefined),
        };
        return unifiedQuery(registry, query, {
          maxResults: (params.maxResults as number) ?? 50,
          caseSensitive: (params.caseSensitive as boolean) ?? false,
          context: params.context as number | undefined,
          adapters: params.adapters as string[] | undefined,
          weights: Object.keys(weights).length > 0 ? weights : undefined,
        });
      },
    },
    {
      name: 'query.search',
      namespace: 'query',
      description: 'Filesystem-only ranked knowledge search. Same scoring pipeline as query.unified but restricted to the filesystem adapter. Use for deterministic filesystem-rooted results without memu/gitnexus noise; use vault.search for raw grep-style matching without ranking.',
      mutating: false,
      params: {
        query: { type: 'string', required: true, description: 'Search query string' },
        maxResults: { type: 'number', required: false, description: 'Maximum results to return (default: 50)', default: 50 },
      },
      handler: async (_ctx, params) => {
        const query = params.query as string;
        if (!query) throw makeErr(-32602, 'query required');
        return unifiedQuery(registry, query, {
          maxResults: (params.maxResults as number) ?? 50,
          adapters: ['filesystem'],
        });
      },
    },
    {
      name: 'query.explain',
      namespace: 'query',
      description: 'Concept explanation via top-10 cross-adapter results with 3 lines of surrounding context per match. Same fan-out as query.unified but fixes maxResults=10 and context=3, tuned for paragraph-length summarization. Use when synthesizing prose, not browsing raw results.',
      mutating: false,
      params: {
        concept: { type: 'string', required: true, description: 'Concept to explain' },
      },
      handler: async (_ctx, params) => {
        const concept = params.concept as string;
        if (!concept) throw makeErr(-32602, 'concept required');
        const weights = { ...defaultWeights };
        return unifiedQuery(registry, concept, {
          maxResults: 10,
          context: 3,
          weights: Object.keys(weights).length > 0 ? weights : undefined,
        });
      },
    },
    {
      name: 'query.adapters',
      namespace: 'query',
      description: 'List registered adapters, their capabilities, and availability',
      mutating: false,
      params: {},
      handler: async (_ctx, _params) => ({
        adapters: registry.list().map((a) => ({
          name: a.name,
          capabilities: [...a.capabilities],
          isAvailable: a.isAvailable,
        })),
      }),
    },
  ];

  const agentOps: Operation[] = [
    {
      name: 'agent.status',
      namespace: 'agent',
      description: 'Get agent status',
      mutating: false,
      params: {
        mode: { type: 'string', required: false, description: 'Agent mode filter' },
      },
      handler: async (_ctx, params) => {
        const { resolve } = await import('node:path');
        const evaluatePy = resolve(compilerPath, 'evaluate.py');
        const baseArgs = [evaluatePy];
        if (configPath) baseArgs.push('--config', configPath);
        baseArgs.push('--vault', vaultPath);
        const args = [...baseArgs, '--status'];
        const mode = params.mode as string | undefined;
        if (mode) args.push('--mode', mode);
        try {
          const { stdout } = await execAsync(python, args, {
            timeout: 30_000,
            maxBuffer: 2 * 1024 * 1024,
            env: { ...process.env },
          });
          return JSON.parse(stdout);
        } catch (e) {
          throw makeErr(-32000, `agent.status failed: ${(e as Error).message}`);
        }
      },
    },
    {
      name: 'agent.trigger',
      namespace: 'agent',
      description: 'Trigger an agent action',
      mutating: true,
      params: {
        action: { type: 'string', required: true, description: 'Action to trigger (compile, emerge, reconcile, prune, challenge)' },
        mode: { type: 'string', required: false, description: 'Agent mode' },
      },
      handler: async (_ctx, params) => {
        const { resolve } = await import('node:path');
        const evaluatePy = resolve(compilerPath, 'evaluate.py');
        const baseArgs = [evaluatePy];
        if (configPath) baseArgs.push('--config', configPath);
        baseArgs.push('--vault', vaultPath);
        const action = params.action as string | undefined;
        if (!action) throw makeErr(-32602, 'action required');
        const validActions = ['compile', 'emerge', 'reconcile', 'prune', 'challenge'];
        if (!validActions.includes(action)) {
          throw makeErr(-32602, `Unknown action: ${action}. Valid: ${validActions.join(', ')}`);
        }
        const args = [...baseArgs, '--trigger', action];
        const mode = params.mode as string | undefined;
        if (mode) args.push('--mode', mode);
        try {
          const { stdout } = await execAsync(python, args, {
            timeout: 300_000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env },
          });
          return JSON.parse(stdout);
        } catch (e) {
          throw makeErr(-32000, `agent.trigger failed: ${(e as Error).message}`);
        }
      },
    },
    {
      name: 'agent.schedule',
      namespace: 'agent',
      description: 'Schedule an agent task',
      mutating: false,
      params: {
        task: { type: 'string', required: true, description: 'Task to schedule' },
        cron: { type: 'string', required: true, description: 'Cron expression' },
      },
      handler: async (_ctx, _params) => ({ status: 'not_implemented', message: 'agent.schedule is Phase 6 work' }),
    },
    {
      name: 'agent.history',
      namespace: 'agent',
      description: 'Get agent action history',
      mutating: false,
      params: {
        limit: { type: 'number', required: false, description: 'Maximum number of history entries (default: 20)', default: 20 },
      },
      handler: async (_ctx, params) => {
        const { resolve } = await import('node:path');
        const evaluatePy = resolve(compilerPath, 'evaluate.py');
        const baseArgs = [evaluatePy];
        if (configPath) baseArgs.push('--config', configPath);
        baseArgs.push('--vault', vaultPath);
        const args = [...baseArgs, '--history'];
        const limit = params.limit as number | undefined;
        if (limit !== undefined) args.push('--limit', String(limit));
        try {
          const { stdout } = await execAsync(python, args, {
            timeout: 10_000,
            maxBuffer: 2 * 1024 * 1024,
            env: { ...process.env },
          });
          return JSON.parse(stdout);
        } catch (e) {
          throw makeErr(-32000, `agent.history failed: ${(e as Error).message}`);
        }
      },
    },
  ];

  return [...operations, ...compileOps, ...queryOps, ...agentOps];
}
