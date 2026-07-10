#!/usr/bin/env node
/**
 * claude-mem-sync -- archive Claude Code session summaries (from claude-mem's
 * SQLite store) into the work-OS project board as real issue notes.
 *
 * Reuses the canonical work-OS writers (renderIssueNote/writeVaultBytes/
 * projectNote from project.ts, scanWorkNotes/renderKanbanBoard from
 * workos.ts) instead of hand-rolling frontmatter, so output is byte-identical
 * to what project.issue.create / project.board.get would produce over MCP.
 *
 * Usage:
 *   node dist/scripts/claude-mem-sync.js --project tdxcli-rs [--vault PATH]
 *     [--claude-mem-db PATH] [--dry-run] [--backfill]
 *
 * Intended to be invoked from a Claude Code SessionEnd hook. Best-effort:
 * never throws past main() and never blocks session shutdown.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

import { renderIssueNote, writeVaultBytes, projectNote, type IssueFields } from '../project/project.js';
import { scanWorkNotes, isAuthoritative, renderKanbanBoard, detectVaultLang } from '../project/workos.js';

interface SessionSummaryRow {
  id: number;
  memory_session_id: string | null;
  project: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  files_read: string | null;
  files_edited: string | null;
  notes: string | null;
  created_at: string | null;
}

type SyncState = Record<string, number>; // project -> last archived session_summaries.id

function parseArgs(argv: string[]) {
  const out: { project?: string; vault?: string; dbPath?: string; dryRun: boolean; backfill: boolean; all: boolean } = {
    dryRun: false,
    backfill: false,
    all: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') out.project = argv[++i];
    else if (a === '--vault') out.vault = argv[++i];
    else if (a === '--claude-mem-db') out.dbPath = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--backfill') out.backfill = true;
    else if (a === '--all') out.all = true;
  }
  return out;
}

function resolveVaultPath(explicit: string | undefined): string {
  if (explicit) return explicit;
  const env = process.env.VAULT_MIND_VAULT_PATH || process.env.VAULT_BRIDGE_VAULT;
  if (env) return env;
  throw new Error('vault path not set: pass --vault PATH or set VAULT_MIND_VAULT_PATH');
}

function resolveDbPath(explicit: string | undefined): string {
  if (explicit) return explicit;
  return join(homedir(), '.claude-mem', 'claude-mem.db').split('\\').join('/');
}

function stateFilePath(): string {
  return join(homedir(), '.vault-mind', 'claude-mem-sync', 'state.json').split('\\').join('/');
}

function readState(): SyncState {
  try {
    return JSON.parse(readFileSync(stateFilePath(), 'utf-8'));
  } catch {
    return {};
  }
}

function writeState(state: SyncState): void {
  const p = stateFilePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2));
}

function oneLine(value: string, max = 200): string {
  const s = value.replace(/\r?\n/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function mdBody(text: string | null): string {
  return (text || '(none)').replace(/\r\n/g, '\n');
}

function dateSlug(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2');
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function hasSubstance(row: SessionSummaryRow): boolean {
  return Boolean((row.completed && row.completed.trim()) || (row.investigated && row.investigated.trim()));
}

function issueBody(row: SessionSummaryRow): string {
  const title = oneLine(row.request || `Session ${row.id}`, 120);
  return [
    title,
    '',
    `# Session ${row.created_at || isoDate()}`,
    '',
    '## Request',
    mdBody(row.request),
    '',
    '## Investigated',
    mdBody(row.investigated),
    '',
    '## Learned',
    mdBody(row.learned),
    '',
    '## Completed',
    mdBody(row.completed),
    '',
    '## Next steps',
    mdBody(row.next_steps),
    '',
    '## Files',
    `- read: ${mdBody(row.files_read)}`,
    `- edited: ${mdBody(row.files_edited)}`,
    '',
  ].join('\n');
}

function ensureProjectAnchor(vaultPath: string, project: string): void {
  const notePath = `01-Projects/${project}/_project.md`;
  if (!existsSync(join(vaultPath, notePath))) {
    writeVaultBytes(vaultPath, notePath, projectNote(project, `Work-OS project ${project}`));
  }
  mkdirSync(join(vaultPath, `01-Projects/${project}/issues`), { recursive: true });
}

function writeSessionIssue(vaultPath: string, row: SessionSummaryRow): string {
  const project = row.project;
  const slug = `session-${dateSlug(row.created_at)}-${row.id}`;
  const fields: IssueFields = {
    slug,
    project,
    state: 'done',
    review: 'reviewed',
    priority: 0,
    description: oneLine(row.request || `Session ${row.id}`, 200),
    blockedBy: [],
    assignee: 'agent/claude-mem',
    lastVerified: isoDate(),
    status: 'active',
    extra: {
      source: 'claude-mem',
      'session-summary-id': String(row.id),
      'memory-session-id': row.memory_session_id || '',
    },
  };
  const path = `01-Projects/${project}/issues/${slug}.md`;
  writeVaultBytes(vaultPath, path, renderIssueNote(fields, issueBody(row)));
  return path;
}

function rewriteBoard(vaultPath: string, project: string): void {
  const notes = scanWorkNotes(vaultPath);
  const authoritative = notes.filter((n) => isAuthoritative(n.raw));
  const lang = process.env.VAULT_MIND_LANG || detectVaultLang(notes);
  const board = renderKanbanBoard(authoritative, project, lang);
  writeVaultBytes(vaultPath, `01-Projects/${project}/board.md`, board);
}

function syncProject(db: InstanceType<typeof DatabaseSync>, vaultPath: string, project: string, state: SyncState, opts: { dryRun: boolean; backfill: boolean }): void {
  const watermark = state[project] ?? 0;
  let effectiveWatermark = watermark;
  if (watermark === 0 && !opts.backfill) {
    const maxRow = db.prepare('select max(id) as maxId from session_summaries where project = ?').get(project) as { maxId: number | null };
    effectiveWatermark = maxRow?.maxId ?? 0;
    process.stderr.write(`claude-mem-sync: no prior state for ${project}, seeding watermark at ${effectiveWatermark} (skip backfill; pass --backfill to import history)\n`);
    if (!opts.dryRun) {
      state[project] = effectiveWatermark;
      writeState(state);
    }
    return;
  }

  const rows = db
    .prepare('select * from session_summaries where project = ? and id > ? order by id asc')
    .all(project, effectiveWatermark) as unknown as SessionSummaryRow[];

  if (rows.length === 0) {
    process.stderr.write(`claude-mem-sync: no new session_summaries for ${project} since id ${effectiveWatermark}\n`);
    return;
  }

  if (!opts.dryRun) ensureProjectAnchor(vaultPath, project);

  let lastId = effectiveWatermark;
  let written = 0;
  for (const row of rows) {
    lastId = row.id;
    if (!hasSubstance(row)) continue;
    if (opts.dryRun) {
      process.stderr.write(`[dry-run] would archive session_summaries id ${row.id} (${project})\n`);
    } else {
      const path = writeSessionIssue(vaultPath, row);
      process.stderr.write(`claude-mem-sync: archived session_summaries id ${row.id} -> ${path}\n`);
    }
    written++;
  }

  if (!opts.dryRun) {
    if (written > 0) rewriteBoard(vaultPath, project);
    state[project] = lastId;
    writeState(state);
  }
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.project && !opts.all) {
    process.stderr.write('claude-mem-sync: --project NAME or --all required\n');
    process.exitCode = 2;
    return;
  }

  const dbPath = resolveDbPath(opts.dbPath);
  if (!existsSync(dbPath)) {
    process.stderr.write(`claude-mem-sync: claude-mem.db not found at ${dbPath}, skipping\n`);
    return;
  }

  const vaultPath = resolve(resolveVaultPath(opts.vault));
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const state = readState();

  const projects = opts.all
    ? ((db.prepare('select distinct project from session_summaries').all() as unknown as { project: string }[]).map((r) => r.project))
    : [opts.project as string];

  for (const project of projects) {
    syncProject(db, vaultPath, project, state, { dryRun: opts.dryRun, backfill: opts.backfill });
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`claude-mem-sync: ERROR: ${err instanceof Error ? (err.stack || err.message) : String(err)}\n`);
}
