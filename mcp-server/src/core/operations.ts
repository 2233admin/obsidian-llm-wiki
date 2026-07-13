import { execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { Operation, OperationWritePolicy } from './types.js';
import { resultPath, staticTargets, targetOrWildcard, targetParams, touchMarkdown } from './write-policy.js';
import { scanRecipes, findRecipe } from '../recipes/_registry.js';
import { getRecipeStatus, runHealthCheck, appendHeartbeat } from '../recipes/_framework.js';
import { answerQuery, traceUnifiedQuery, unifiedQuery, unifiedQueryByVector } from '../unified-query.js';
import { embed } from '../embedding-client.js';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { VaultBrainAdapter } from '../adapters/vaultbrain/index.js';
import { ensureBackfill, recallGaps } from '../adapters/vaultbrain/lazy-index.js';
import type { RAGAnythingAdapter } from '../adapters/raganything.js';
import type { LightRAGAdapter } from '../adapters/lightrag.js';
import type { CompileTrigger } from '../compile-trigger.js';
import { ContextCoreLoader } from '../holons/loader.js';
import { makeHolonOps } from '../holons/holon.js';
import { makeCausalOps } from '../holons/causal.js';
import { makeProvenanceOps } from '../holons/provenance.js';
import { makeGraphOps } from '../holons/graph.js';
import { makeVaultWriteOps } from '../holons/write.js';
import { makeMemoryOps } from '../memory/memory.js';
import { makeProjectOps } from '../project/project.js';
import { makeProjectHubOps } from '../project/project-hub.js';
import { makeIngestOps } from '../ingest/ingest.js';
import { makeSourceOps } from '../source/source.js';
import { makeConversationOps } from '../conversation/conversation.js';
import { makeContextOps } from '../context/context.js';
import { makeWorkflowOps } from '../workflow/workflow.js';
import { resolveProjectContext } from '../project/project-context.js';
import { makeProjectMigrationOps } from '../project/project-migration.js';

const execAsync = promisify(execFile);
const PROTECTED_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

const _thisDir = dirname(fileURLToPath(import.meta.url));
const _projectRoot = join(_thisDir, '..', '..', '..');

const dryRunPathPolicy = (event: 'create' | 'modify' | 'delete' = 'modify'): OperationWritePolicy => ({
  realWrite: 'dryRunFalse',
  targets: targetParams('path'),
  audit: 'required',
  effects: (_ctx, params, result) => [touchMarkdown(params.path ?? resultPath(result), event)],
});

const dryRunStaticPolicy = (...targets: string[]): OperationWritePolicy => ({
  realWrite: 'dryRunFalse',
  targets: staticTargets(...targets),
  audit: 'required',
  effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), 'modify')],
});

const batchWritePolicy = (): OperationWritePolicy => ({
  realWrite: 'always',
  targets: staticTargets(),
  audit: 'required',
});

const externalSideEffectPolicy = (target: string): OperationWritePolicy => ({
  realWrite: 'always',
  targets: staticTargets(`external/${target}`),
  audit: 'required',
});

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
 writePolicy: dryRunPathPolicy('create'),
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
 writePolicy: dryRunPathPolicy('modify'),
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
 writePolicy: dryRunPathPolicy('modify'),
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
 writePolicy: dryRunPathPolicy('delete'),
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
 writePolicy: {
 realWrite: 'dryRunFalse',
 targets: targetParams('from', 'to'),
 audit: 'required',
 effects: (_ctx, params) => [touchMarkdown(params.from, 'delete'), touchMarkdown(params.to, 'create')],
 },
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
 writePolicy: dryRunPathPolicy(),
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
    mutating: true,
    writePolicy: batchWritePolicy(),
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
 name: 'vault.daily',
    namespace: 'vault',
    description: "Create or update today's daily note with AI-First frontmatter (date, mood, energy, summary). Path: Daily/YYYY-MM-DD.md",
 mutating: true,
 writePolicy: dryRunStaticPolicy('Daily/**'),
 params: {
      summary: { type: 'string', required: false, description: '1-3 sentence day summary' },
      mood: { type: 'string', required: false, description: 'Mood rating', enum: ['great', 'good', 'neutral', 'low', 'bad'] },
      energy: { type: 'string', required: false, description: 'Energy level', enum: ['high', 'medium', 'low'] },
      tags: { type: 'array', required: false, description: 'Extra tags' },
      dryRun: { type: 'boolean', required: false, description: 'Simulate without writing (default: true)', default: true },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.daily', params),
  },
  {
 name: 'vault.person',
    namespace: 'vault',
    description: 'Create or update a person note with AI-First frontmatter. Path: People/{name}.md',
 mutating: true,
 writePolicy: dryRunStaticPolicy('People/**'),
 params: {
      name: { type: 'string', required: true, description: "Person's full name" },
      role: { type: 'string', required: false, description: 'Job title or role' },
      company: { type: 'string', required: false, description: 'Organization' },
      relationship: { type: 'string', required: false, description: 'How you know them' },
      notes: { type: 'string', required: false, description: 'Additional context' },
      dryRun: { type: 'boolean', required: false, description: 'Simulate without writing (default: true)', default: true },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.person', params),
  },
  {
 name: 'vault.project',
    namespace: 'vault',
    description: 'Deprecated compatibility update for an already-registered Project. Unknown names are rejected; use project.init to create a Project ID and Work-OS anchor.',
 mutating: true,
 writePolicy: dryRunStaticPolicy('Projects/**'),
 params: {
      name: { type: 'string', required: true, description: 'Project name' },
      status: { type: 'string', required: false, description: 'Project status', default: 'active', enum: ['active', 'paused', 'completed', 'archived', 'planned'] },
      summary: { type: 'string', required: false, description: '1-3 sentence project summary' },
      team: { type: 'array', required: false, description: 'Team member names (wikilinked in content)' },
      tags: { type: 'array', required: false, description: 'Extra tags' },
      entity: { type: 'string', required: false, description: 'Currency entity key (default: project/<name-slug>); drives the status-drift guard' },
      dryRun: { type: 'boolean', required: false, description: 'Simulate without writing (default: true)', default: true },
    },
    handler: async (ctx, params) => {
      const name = params.name;
      if (typeof name !== 'string' || !name.trim()) throw makeErr(-32602, 'name required');
      const project = resolveProjectContext(ctx.config.vault_path, name, 'vault.project');
      const result = await ctx.vault.execute('vault.project', {
        ...params,
        name: project.slug,
        entity: project.projectId,
      });
      return {
        result,
        projectId: project.projectId,
        diagnostics: [{
          code: 'vault_project_deprecated',
          severity: 'warning',
          message: 'vault.project is a compatibility operation; use project.init and Project domain operations.',
        }, ...project.diagnostics],
      };
    },
  },
  {
 name: 'vault.decide',
    namespace: 'vault',
    description: 'Create a structured decision log (ADR). Path: Decisions/YYYY-MM-DD -- {title-slug}.md',
 mutating: true,
 writePolicy: dryRunStaticPolicy('Decisions/**'),
 params: {
      title: { type: 'string', required: true, description: 'Decision title' },
      context: { type: 'string', required: true, description: 'Situation and constraints' },
      decision: { type: 'string', required: true, description: 'What was decided' },
      rationale: { type: 'string', required: false, description: 'Why this decision' },
      consequences: { type: 'string', required: false, description: 'Trade-offs and outcomes' },
      status: { type: 'string', required: false, description: 'Decision status', default: 'accepted', enum: ['proposed', 'accepted', 'deprecated', 'superseded'] },
      tags: { type: 'array', required: false, description: 'Extra tags' },
      project: { type: 'string', required: false, description: 'Owning project (namespaces the currency entity as project/<slug>/decision/<title>)' },
      entity: { type: 'string', required: false, description: 'Currency entity key override (default derived from project + title)' },
      source: { type: 'string', required: false, description: 'Verifiable source (commit:/path:/test:/url:); without it the decision shows UNSUPPORTED in the currency view' },
      dryRun: { type: 'boolean', required: false, description: 'Simulate without writing (default: true)', default: true },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.decide', params),
  },
  {
 name: 'vault.meeting',
    namespace: 'vault',
    description: 'Create a meeting note with attendees, decisions, and action items. Path: Meetings/YYYY-MM-DD -- {title-slug}.md',
 mutating: true,
 writePolicy: dryRunStaticPolicy('Meetings/**'),
 params: {
      title: { type: 'string', required: true, description: 'Meeting title' },
      attendees: { type: 'array', required: false, description: 'Attendee names (wikilinked)' },
      decisions: { type: 'array', required: false, description: 'List of decisions made' },
      actions: { type: 'array', required: false, description: 'Action items (strings)' },
      summary: { type: 'string', required: false, description: 'Meeting summary' },
      dryRun: { type: 'boolean', required: false, description: 'Simulate without writing (default: true)', default: true },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.meeting', params),
  },
  {
 name: 'vault.ingest',
    namespace: 'vault',
    description: 'Ingest content into vault with AI-First frontmatter (ai-first: true, source, recency markers). Path: 00-Inbox/{title-slug}.md',
 mutating: true,
 writePolicy: dryRunStaticPolicy('00-Inbox/**'),
 params: {
      content: { type: 'string', required: true, description: 'Content to ingest (text, URL, or pasted article)' },
      title: { type: 'string', required: true, description: 'Note title' },
      source: { type: 'string', required: false, description: 'Source URL if from web' },
      type: { type: 'string', required: false, description: 'Content type', default: 'note', enum: ['article', 'research', 'note', 'reference'] },
      tags: { type: 'array', required: false, description: 'Extra tags' },
      preamble: { type: 'string', required: false, description: '2-3 sentence "For future Claude" preamble' },
      dryRun: { type: 'boolean', required: false, description: 'Simulate without writing (default: true)', default: true },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.ingest', params),
  },
  {
 name: 'vault.init',
    namespace: 'vault',
    description: 'Scaffold the vault. methodology mode creates the folder layout (generic|para|lyt|zettelkasten) plus a Home.md index with AI-First frontmatter, dry-run by default, existing folders are skipped; topic mode scaffolds a knowledge base topic directory (writes immediately).',
 mutating: true,
 writePolicy: {
 realWrite: 'always',
 shouldWrite: (_ctx, params) => typeof params.topic === 'string' || params.dryRun === false,
 targets: staticTargets('**'),
 audit: 'required',
 },
 params: {
      topic: { type: 'string', required: false, description: 'Topic name (used as directory name and KB title); topic mode' },
      methodology: { type: 'string', required: false, description: 'Vault folder scaffold to create; methodology mode', enum: ['generic', 'para', 'lyt', 'zettelkasten'] },
      dryRun: { type: 'boolean', required: false, description: 'Simulate without writing (methodology mode only, default: true)', default: true },
    },
    handler: async (ctx, params) => ctx.vault.execute('vault.init', params),
  },
  {
 name: 'vault.enforceDiscipline',
    namespace: 'vault',
    description: "Retroactively enforce Karpathy LLM Wiki discipline: ensure each top-level topic folder has _index.md (catalog) and log.md (chronicle). Skips folders that already have a recognized catalog (Home.md/INDEX.md/README.md) or chronicle (Log.md). Dry-run by default.",
 mutating: true,
 writePolicy: {
 realWrite: 'dryRunFalse',
 targets: staticTargets('**'),
 audit: 'required',
 },
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
 writePolicy: {
 realWrite: 'dryRunFalse',
 targets: (_ctx, params) => {
 const persona = typeof params.persona === 'string' ? params.persona : '*';
 return [`00-Inbox/AI-Output/${persona}/**`];
 },
 audit: 'required',
 effects: (_ctx, params, result) => [touchMarkdown(params.path ?? resultPath(result), 'modify')],
 },
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
 writePolicy: {
 realWrite: 'dryRunFalse',
 targets: staticTargets('00-Inbox/AI-Output/**'),
 audit: 'required',
 },
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
    writePolicy: externalSideEffectPolicy('recipe/**'),
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
    writePolicy: externalSideEffectPolicy('recipe/**'),
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
  contextCorePath?: string;
}

export function makeAllOperations(deps: AllOperationsDeps): Operation[] {
  const { compileTrigger, registry, defaultWeights, python, compilerPath, vaultPath, configPath } = deps;
  const ccPath = deps.contextCorePath
    ?? process.env['CONTEXT_CORE_PATH']
    ?? join(dirname(compilerPath), 'context-core.json');
  const contextCoreLoader = new ContextCoreLoader(ccPath);

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
      writePolicy: externalSideEffectPolicy('compile/**'),
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
      writePolicy: externalSideEffectPolicy('compile/**'),
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
      description: 'Reciprocal Rank Fusion (RRF) search across all active adapters (filesystem, obsidian, kanban, memu, gitnexus). Each adapter returns its ranked top-N; results are merged by RRF score = sum over sources (weight / (60 + rank_in_source)), so a doc that appears in top-5 of multiple sources beats a doc at top-1 of just one. Weights now scale each source\'s rank contribution (not raw score), so weight=2 doubles a source\'s influence on tied docs. Use when you want best answers anywhere; for single-adapter ranked search use query.search, for raw grep use vault.search.',
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
    name: 'query.trace',
    namespace: 'query',
    description: 'Transparent retrieval trace for query.unified. Returns the query plan, selected adapters, per-adapter branch stats, RRF fusion settings, ranked evidence snippets, and known limitations. Use before evidence-backed answers when you need to explain why results were chosen.',
    mutating: false,
    params: {
      query: { type: 'string', required: true, description: 'Search query string' },
      maxResults: { type: 'number', required: false, description: 'Maximum evidence items return (default: 10)', default: 10 },
      adapters: { type: 'array', required: false, description: 'Limit specific adapters by name' },
      weights: { type: 'object', required: false, description: 'Per-adapter score weight multipliers, e.g. {"obsidian":1.2,"filesystem":0.8}' },
      caseSensitive: { type: 'boolean', required: false, description: 'Case-sensitive matching', default: false },
      context: { type: 'number', required: false, description: 'Lines surrounding context per match' },
    },
    handler: async (_ctx, params) => {
      const query = params.query as string;
      if (!query) throw makeErr(-32602, 'query required');
      const weights = {
        ...defaultWeights,
        ...(params.weights as Record<string, number> | undefined),
      };
      return traceUnifiedQuery(registry, query, {
        maxResults: (params.maxResults as number) ?? 10,
        caseSensitive: (params.caseSensitive as boolean) ?? false,
        context: params.context as number | undefined,
        adapters: params.adapters as string[] | undefined,
        weights: Object.keys(weights).length > 0 ? weights : undefined,
      });
    },
  },
  {
    name: 'query.answer',
    namespace: 'query',
    description: 'Citation-backed extractive answer built on query.trace. Returns answer, claims, citations, gaps, contradictions, confidence, and the underlying trace. Phase A is deterministic and conservative: it cites retrieved snippets and reports gaps instead of inventing missing context.',
    mutating: false,
    params: {
      query: { type: 'string', required: true, description: 'Question or search query to answer from vault evidence' },
      maxResults: { type: 'number', required: false, description: 'Maximum evidence items to cite (default: 5)', default: 5 },
      adapters: { type: 'array', required: false, description: 'Limit specific adapters by name' },
      weights: { type: 'object', required: false, description: 'Per-adapter score weight multipliers, e.g. {"obsidian":1.2,"filesystem":0.8}' },
      caseSensitive: { type: 'boolean', required: false, description: 'Case-sensitive matching', default: false },
      context: { type: 'number', required: false, description: 'Lines surrounding context per match' },
    },
    handler: async (_ctx, params) => {
      const query = params.query as string;
      if (!query) throw makeErr(-32602, 'query required');
      const weights = {
        ...defaultWeights,
        ...(params.weights as Record<string, number> | undefined),
      };
      // Lazy backfill (13B): first recall against an empty vaultbrain store
      // triggers a one-time index so NL recall works without a manual reindex.
      const backfill = await ensureBackfill();
      const answer = await answerQuery(registry, query, {
        maxResults: (params.maxResults as number) ?? 5,
        caseSensitive: (params.caseSensitive as boolean) ?? false,
        context: params.context as number | undefined,
        adapters: params.adapters as string[] | undefined,
        weights: Object.keys(weights).length > 0 ? weights : undefined,
      });
      for (const g of await recallGaps(backfill)) answer.gaps.unshift(g);
      return answer;
    },
  },
  {
    name: 'query.search',
    namespace: 'query',
      description: 'Filesystem-only RRF-ranked knowledge search. Same fusion pipeline as query.unified restricted to the filesystem adapter (single-source RRF degenerates to rank preservation). Use for deterministic filesystem-rooted results without memu/gitnexus noise; use vault.search for raw grep-style matching without ranking.',
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
      name: 'query.semantic',
      namespace: 'query',
      description: 'Text-input semantic search. Embeds the query via an OpenAI-compatible embedding endpoint (default: ollama qwen3-embedding:0.6b at localhost:11434 -- the same model that produced memU\'s stored 1024-dim vectors), then fans out to all embeddings-capable adapters (currently memu, pgvector cosine). Use this for natural-language queries that should match by meaning rather than keyword. Override endpoint/model via VAULT_MIND_EMBED_URL and VAULT_MIND_EMBED_MODEL env. For pre-computed vectors use query.vector; for keyword matching use query.unified (RRF fusion of keyword adapters).',
      mutating: false,
      params: {
        query: { type: 'string', required: true, description: 'Natural-language text to embed and semantic-search' },
        maxResults: { type: 'number', required: false, description: 'Maximum results to return (default: 50)', default: 50 },
        adapters: { type: 'array', required: false, description: 'Limit to specific embedding-capable adapters by name' },
        weights: { type: 'object', required: false, description: 'Per-adapter score weight multipliers' },
      },
      handler: async (_ctx, params) => {
        const query = params.query as string;
        if (typeof query !== 'string' || query.length === 0) {
          throw makeErr(-32602, 'query required (non-empty string)');
        }
        let vector: number[];
        try {
          vector = await embed(query);
        } catch (e) {
          throw makeErr(-32603, `embedding failed: ${(e as Error).message}`);
        }
        return unifiedQueryByVector(registry, vector, {
          maxResults: (params.maxResults as number) ?? 50,
          adapters: params.adapters as string[] | undefined,
          weights: params.weights as Record<string, number> | undefined,
        });
      },
    },
    {
      name: 'query.vector',
      namespace: 'query',
      description: 'Weighted multi-adapter semantic search via pre-computed query vector. Fans out to adapters declaring the "embeddings" capability (currently memu via pgvector cosine). Caller supplies the vector -- adapters are model-agnostic, so callers must produce an embedding matching the adapter\'s stored vector space (memu: 1024-dim). Use for vector-similarity ranking when you already have an embedding; for text-input semantic search use query.semantic; for keyword fusion use query.unified (RRF).',
      mutating: false,
      params: {
        vector: { type: 'array', required: true, description: 'Pre-computed query embedding as number[] (memu expects 1024-dim)' },
        maxResults: { type: 'number', required: false, description: 'Maximum results to return (default: 50)', default: 50 },
        adapters: { type: 'array', required: false, description: 'Limit to specific embedding-capable adapters by name' },
        weights: { type: 'object', required: false, description: 'Per-adapter score weight multipliers' },
      },
      handler: async (_ctx, params) => {
        const vector = params.vector as unknown;
        if (!Array.isArray(vector) || vector.length === 0) {
          throw makeErr(-32602, 'vector required (non-empty number[])');
        }
        const nums = vector as number[];
        for (const n of nums) {
          if (typeof n !== 'number' || !Number.isFinite(n)) {
            throw makeErr(-32602, 'vector must contain finite numbers only');
          }
        }
        return unifiedQueryByVector(registry, nums, {
          maxResults: (params.maxResults as number) ?? 50,
          adapters: params.adapters as string[] | undefined,
          weights: params.weights as Record<string, number> | undefined,
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

  const multimodalOps: Operation[] = [
    {
 name: 'multimodal.ingest',
      namespace: 'multimodal',
      description: 'Parse a vault-relative multimodal document through the RAG-Anything HTTP bridge and write the extracted Markdown back into the vault. Dry-run by default. Requires RAGANYTHING_URL and a running wrapper service.',
 mutating: true,
 writePolicy: {
 realWrite: 'dryRunFalse',
 targets: targetOrWildcard('outputPath', '00-Inbox/Multimodal/**'),
 audit: 'required',
 effects: (_ctx, params, result) => [touchMarkdown(params.outputPath ?? resultPath(result), 'create')],
 },
 params: {
        path: { type: 'string', required: true, description: 'Vault-relative source file path, e.g. attachments/report.pdf' },
        outputPath: { type: 'string', required: false, description: 'Vault-relative Markdown output path. Defaults to 00-Inbox/Multimodal/<source-name>.md' },
        parser: { type: 'string', required: false, description: 'Parser hint passed to RAG-Anything, e.g. mineru, docling, paddleocr' },
        docId: { type: 'string', required: false, description: 'Optional document id passed through to the processing service' },
        dryRun: { type: 'boolean', required: false, default: true, description: 'Return extracted Markdown without writing (default: true)' },
      },
      handler: async (_ctx, params) => {
        const adapter = registry.get('raganything') as RAGAnythingAdapter | undefined;
        if (!adapter || !adapter.isAvailable || typeof adapter.processDocument !== 'function') {
          throw makeErr(-32001, 'RAG-Anything adapter not available or not initialized');
        }

        const inputPath = params.path as string;
        if (!inputPath) throw makeErr(-32602, 'path required');
        const normalizedInput = normalizeVaultRelPath(inputPath);
        const fullInput = join(vaultPath, normalizedInput);
        if (!existsSync(fullInput)) throw makeErr(-32001, `Source file not found: ${normalizedInput}`);

        const outputPath = normalizeVaultRelPath(
          typeof params.outputPath === 'string' && params.outputPath.length > 0
            ? params.outputPath
            : defaultMultimodalOutputPath(normalizedInput),
        );
        if (!outputPath.endsWith('.md')) throw makeErr(-32602, 'outputPath must end with .md');

        const result = await adapter.processDocument({
          filePath: fullInput,
          sourcePath: normalizedInput,
          parser: params.parser as string | undefined,
          docId: params.docId as string | undefined,
          outputFormat: 'markdown',
        });
        if (!result.markdown.trim()) {
          throw makeErr(-32603, 'RAG-Anything returned no markdown content');
        }

        const content = multimodalMarkdown({
          sourcePath: normalizedInput,
          parser: params.parser as string | undefined,
          metadata: result.metadata,
          markdown: result.markdown,
        });

        const dryRun = (params.dryRun as boolean | undefined) ?? true;
        if (dryRun) {
          return {
            dryRun: true,
            sourcePath: normalizedInput,
            outputPath,
            markdownBytes: Buffer.byteLength(content, 'utf-8'),
            metadata: result.metadata,
            preview: content.slice(0, 2000),
          };
        }

        const fullOutput = join(vaultPath, outputPath);
        mkdirSync(dirname(fullOutput), { recursive: true });
        writeFileSync(fullOutput, content, 'utf-8');

        const vba = registry.get('vaultbrain') as VaultBrainAdapter | undefined;
        if (vba) await vba.ingest(outputPath, content);

        return {
          dryRun: false,
          sourcePath: normalizedInput,
          outputPath,
          markdownBytes: Buffer.byteLength(content, 'utf-8'),
          metadata: result.metadata,
        };
      },
    },
  ];

  const lightRagOps: Operation[] = [
    {
 name: 'lightrag.ingest',
      namespace: 'lightrag',
      description: 'Send a vault-relative file into an external LightRAG server. Markdown/text files use /documents/text; other files use /documents/upload. Dry-run by default. Requires LIGHTRAG_URL.',
 mutating: true,
 writePolicy: {
 realWrite: 'dryRunFalse',
        targets: staticTargets('external/lightrag/**'),
        audit: 'required',
 },
 params: {
        path: { type: 'string', required: true, description: 'Vault-relative source file path' },
        mode: { type: 'string', required: false, default: 'auto', enum: ['auto', 'text', 'upload'], description: 'Ingest mode. auto sends .md/.txt as text and other files as upload.' },
        dryRun: { type: 'boolean', required: false, default: true, description: 'Return the planned LightRAG request without sending it (default: true)' },
      },
      handler: async (_ctx, params) => {
        const adapter = registry.get('lightrag') as LightRAGAdapter | undefined;
        if (!adapter || !adapter.isAvailable) {
          throw makeErr(-32001, 'LightRAG adapter not available or not initialized');
        }

        const inputPath = params.path as string;
        if (!inputPath) throw makeErr(-32602, 'path required');
        const normalizedInput = normalizeVaultRelPath(inputPath);
        const fullInput = join(vaultPath, normalizedInput);
        if (!existsSync(fullInput)) throw makeErr(-32001, `Source file not found: ${normalizedInput}`);

        const mode = params.mode as string | undefined ?? 'auto';
        const effectiveMode = mode === 'auto'
          ? /\.(md|markdown|txt)$/i.test(normalizedInput) ? 'text' : 'upload'
          : mode;
        const dryRun = (params.dryRun as boolean | undefined) ?? true;

        if (dryRun) {
          return {
            dryRun: true,
            sourcePath: normalizedInput,
            mode: effectiveMode,
            endpoint: effectiveMode === 'text' ? '/documents/text' : '/documents/upload',
          };
        }

        if (effectiveMode === 'text') {
          const text = readFileSync(fullInput, 'utf-8');
          const result = await adapter.insertText({ text, fileSource: normalizedInput });
          return { dryRun: false, sourcePath: normalizedInput, mode: effectiveMode, result };
        }

        const result = await adapter.uploadFile({ filePath: fullInput, fileName: normalizedInput.split('/').pop() });
        return { dryRun: false, sourcePath: normalizedInput, mode: effectiveMode, result };
      },
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
      writePolicy: externalSideEffectPolicy('agent/**'),
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

  const holonOps = [
    ...makeHolonOps(contextCoreLoader),
    ...makeCausalOps(contextCoreLoader),
    ...makeProvenanceOps(contextCoreLoader),
    ...makeGraphOps(contextCoreLoader, vaultPath),
    ...makeVaultWriteOps(vaultPath, contextCoreLoader),
    ...makeMemoryOps(vaultPath),
    ...makeProjectOps(vaultPath),
    ...makeProjectHubOps(registry),
    ...makeProjectMigrationOps({ python, compilerPath, vaultPath }),
    ...makeIngestOps(),
    ...makeSourceOps(vaultPath),
    ...makeConversationOps(vaultPath),
    ...makeWorkflowOps(vaultPath),
    ...makeContextOps(vaultPath, registry, defaultWeights),
  ];
  return [...operations, ...compileOps, ...queryOps, ...multimodalOps, ...lightRagOps, ...agentOps, ...holonOps];
}

function normalizeVaultRelPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
  if (
    !normalized
    || /^[A-Za-z]:/.test(normalized)
    || normalized.startsWith('//')
    || normalized.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw makeErr(-32602, 'path traversal blocked');
  }
  return normalized;
}

function defaultMultimodalOutputPath(sourcePath: string): string {
  const name = sourcePath.split('/').pop() ?? 'document';
  const stem = name.replace(/\.[^.]+$/, '') || 'document';
  return `00-Inbox/Multimodal/${stem}.md`;
}

function multimodalMarkdown(opts: {
  sourcePath: string;
  parser?: string;
  metadata: Record<string, unknown>;
  markdown: string;
}): string {
  const generatedAt = new Date().toISOString();
  const metadata = JSON.stringify(opts.metadata).replace(/'/g, "''");
  const parser = opts.parser ?? 'raganything';
  return [
    '---',
    `source: "${opts.sourcePath.replace(/"/g, '\\"')}"`,
    'generated-by: raganything',
    `generated-at: "${generatedAt}"`,
    `parser: "${parser.replace(/"/g, '\\"')}"`,
    `metadata-json: '${metadata}'`,
    'status: draft',
    '---',
    '',
    opts.markdown.replace(/\n+$/, ''),
    '',
  ].join('\n');
}
