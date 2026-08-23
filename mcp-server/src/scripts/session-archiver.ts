#!/usr/bin/env node
/**
 * session-archiver -- Multi-source session archiver
 *
 * Reads from ALL session sources:
 * 1. ~/.claude/history.jsonl         - prompt entries
 * 2. ~/.claude/projects/(dir)/      - transcript files
 * 3. ~/.codex/session_index.jsonl   - Codex sessions
 * 4. ~/.claude-mem/claude-mem.db   - session summaries
 *
 * Usage:
 *   node dist/scripts/session-archiver.js --vault PATH [--dry-run]
 *
 * State: ~/.vault-mind/session-archiver/state.json
 */

import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

// --- Types ---

interface ArchivableSession {
  id: string;
  sessionId: string;
  timestamp: number;
  project: string;
  prompt?: string;
  threadName?: string;
  platform: 'claude' | 'codex';
  source: 'history' | 'transcript' | 'codex' | 'claude-mem';
}

interface SyncState {
  lastSyncAt: string;
  stats: {
    historyLinesRead: number;
    historySessions: number;
    transcriptFilesScanned: number;
    transcriptSessions: number;
    codexSessions: number;
    claudeMemSessions: number;
    totalArchived: number;
    duplicates: number;
  };
  archived: string[]; // session IDs
}

// --- CLI ---

interface CliOpts {
  vault?: string;
  dryRun: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const out: CliOpts = { dryRun: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vault') out.vault = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '-v' || a === '--verbose') out.verbose = true;
  }
  return out;
}

// --- Paths ---

function resolveVaultPath(explicit?: string): string {
  if (explicit) return explicit;
  const env = process.env.VAULT_MIND_VAULT_PATH || process.env.VAULT_BRIDGE_VAULT;
  if (env) return env;
  throw new Error('vault path not set: pass --vault PATH or set VAULT_MIND_VAULT_PATH');
}

function stateFilePath(): string {
  return join(homedir(), '.vault-mind', 'session-archiver', 'state.json').split('\\').join('/');
}

// --- State ---

function defaultState(): SyncState {
  return {
    lastSyncAt: '',
    stats: {
      historyLinesRead: 0,
      historySessions: 0,
      transcriptFilesScanned: 0,
      transcriptSessions: 0,
      codexSessions: 0,
      claudeMemSessions: 0,
      totalArchived: 0,
      duplicates: 0,
    },
    archived: [],
  };
}

function readState(): SyncState {
  try {
    return JSON.parse(readFileSync(stateFilePath(), 'utf-8'));
  } catch {
    return defaultState();
  }
}

function writeState(state: SyncState): void {
  const p = stateFilePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2));
}

// --- JSONL Reader ---

async function* readJsonlLines(filePath: string): AsyncGenerator<string> {
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield line;
  }
  rl.close();
}

// --- Source Readers ---

async function collectHistorySessions(state: SyncState, verbose: boolean): Promise<ArchivableSession[]> {
  const historyPath = join(homedir(), '.claude', 'history.jsonl').split('\\').join('/');
  if (!existsSync(historyPath)) {
    verbose && console.error('[history] not found');
    return [];
  }

  const sessions: ArchivableSession[] = [];
  const knownIds = new Set(state.archived);
  let lineNum = 0;

  for await (const line of readJsonlLines(historyPath)) {
    lineNum++;
    try {
      const entry = JSON.parse(line);
      if (!entry.sessionId || knownIds.has(entry.sessionId)) continue;

      sessions.push({
        id: entry.sessionId,
        sessionId: entry.sessionId,
        timestamp: entry.timestamp,
        project: entry.project || 'unknown',
        prompt: entry.display?.slice(0, 500),
        platform: 'claude',
        source: 'history',
      });
      knownIds.add(entry.sessionId);
    } catch {
      // Skip malformed
    }
  }

  state.stats.historyLinesRead = lineNum;
  state.stats.historySessions = sessions.length;
  verbose && console.error(`[history] ${lineNum} lines, ${sessions.length} new sessions`);
  return sessions;
}

async function collectTranscriptSessions(state: SyncState, verbose: boolean): Promise<ArchivableSession[]> {
  const projectsDir = join(homedir(), '.claude', 'projects').split('\\').join('/');
  if (!existsSync(projectsDir)) {
    verbose && console.error('[transcripts] projects dir not found');
    return [];
  }

  const sessions: ArchivableSession[] = [];
  const knownIds = new Set(state.archived);
  const { readdirSync, statSync } = await import('node:fs');
  let filesScanned = 0;

  function scanDir(dir: string): void {
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith('.')) continue;
        const full = join(dir, entry);
        try {
          const stat = statSync(full);
          if (stat.isDirectory()) {
            scanDir(full);
          } else if (entry.endsWith('.jsonl')) {
            filesScanned++;
            processTranscript(full, entry);
          }
        } catch {
          // Skip
        }
      }
    } catch {
      // Skip
    }
  }

  // Extract session ID from filename (e.g., "01f37f80-9df6-4ad3-9cc2-d9da129f2879.jsonl")
  function extractSessionId(filename: string): string | null {
    const match = filename.match(/^([0-9a-f-]+)\.jsonl$/i);
    return match ? match[1] : null;
  }

  function processTranscript(filePath: string, filename: string): void {
    const sessionId = extractSessionId(filename);
    if (!sessionId || knownIds.has(sessionId)) return;

    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      // Extract metadata from session-start or last-prompt entries
      let timestamp = Date.now();
      let project = 'unknown';
      let platform: 'claude' | 'codex' = 'claude';

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const type = entry.type || entry.sessionType;

          if (type === 'session-start' || type === 'session_start') {
            if (entry.timestamp) timestamp = new Date(entry.timestamp).getTime();
            if (entry.cwd) {
              const match = entry.cwd.match(/[^/\\]+$/);
              project = match ? match[0] : 'unknown';
            }
          } else if (type === 'last-prompt' && entry.timestamp) {
            timestamp = new Date(entry.timestamp).getTime();
          } else if (entry.sessionId && !sessionId) {
            // Fallback: use sessionId from entries
          }
        } catch {
          // Skip malformed lines
        }
      }

      sessions.push({
        id: sessionId,
        sessionId,
        timestamp,
        project,
        platform,
        source: 'transcript',
      });
      knownIds.add(sessionId);
    } catch {
      // Skip unreadable files
    }
  }

  scanDir(projectsDir);

  state.stats.transcriptFilesScanned = filesScanned;
  state.stats.transcriptSessions = sessions.length;
  verbose && console.error(`[transcripts] ${filesScanned} files, ${sessions.length} new sessions`);
  return sessions;
}

async function collectCodexSessions(state: SyncState, verbose: boolean): Promise<ArchivableSession[]> {
  const codexPath = join(homedir(), '.codex', 'session_index.jsonl').split('\\').join('/');
  if (!existsSync(codexPath)) {
    verbose && console.error('[codex] not found');
    return [];
  }

  const sessions: ArchivableSession[] = [];
  const knownIds = new Set(state.archived);

  for await (const line of readJsonlLines(codexPath)) {
    try {
      const entry = JSON.parse(line);
      if (!entry.id || knownIds.has(entry.id)) continue;

      sessions.push({
        id: entry.id,
        sessionId: entry.id,
        timestamp: new Date(entry.updated_at).getTime(),
        project: 'codex',
        threadName: entry.thread_name,
        platform: 'codex',
        source: 'codex',
      });
      knownIds.add(entry.id);
    } catch {
      // Skip malformed
    }
  }

  state.stats.codexSessions = sessions.length;
  verbose && console.error(`[codex] ${sessions.length} new sessions`);
  return sessions;
}

// --- Vault Writing ---

function oneLine(value: string, max = 200): string {
  const s = (value || '').replace(/\r?\n/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function isoDate(epoch?: number): string {
  return new Date(epoch || Date.now()).toISOString().slice(0, 10);
}

function formatTimestamp(epoch: number): string {
  return new Date(epoch).toISOString().replace('T', ' ').slice(0, 16);
}

function renderIssueNote(fields: {
  slug: string;
  description: string;
  platform: string;
  source: string;
  sessionId: string;
  timestamp: number;
  prompt?: string;
  threadName?: string;
  project: string;
}): string {
  const { slug, description, platform, source, sessionId, timestamp, prompt, threadName, project } = fields;
  const date = isoDate(timestamp);
  const entity = `project/sessions/issue/${slug}`;

  const body = [
    `# ${platform === 'codex' ? 'Codex' : 'Claude'} Session`,
    '',
    `**Session ID:** \`${sessionId}\``,
    `**Source:** ${source.toUpperCase()}`,
    `**Timestamp:** ${formatTimestamp(timestamp)}`,
    `**Project:** ${project}`,
    '',
    '## Prompt',
    '',
    prompt ? oneLine(prompt, 2000) : '(no prompt recorded)',
    '',
    threadName ? `## Thread Name\n\n${threadName}\n` : '',
  ].join('\n');

  return [
    '---',
    'type: issue',
    `entity: ${entity}`,
    'state: done',
    'review: reviewed',
    'kind: knowledge-task',
    `id: sessions/${slug}`,
    `description: ${description}`,
    'status: active',
    'priority: 0',
    'blocked-by: []',
    'assignee: agent/session-archiver',
    `last-verified: ${isoDate()}`,
    `platform: ${platform}`,
    `source: ${source}`,
    `session-id: ${sessionId}`,
    `timestamp: ${timestamp}`,
    '---',
    '',
    body,
    '',
  ].join('\n');
}

function ensureSessionsAnchor(vaultPath: string): void {
  const anchorPath = join(vaultPath, '01-Projects', 'sessions', '_sessions.md');
  if (!existsSync(anchorPath)) {
    const content = [
      '---',
      'type: project',
      'entity: project/sessions',
      'status: active',
      `last-verified: ${isoDate()}`,
      '---',
      '',
      '# Sessions',
      '',
      'Archived Claude Code and Codex sessions from all sources.',
      'Auto-generated by session-archiver.',
      '',
    ].join('\n');
    writeVaultBytes(vaultPath, '01-Projects/sessions/_sessions.md', content);
  }
}

function writeVaultBytes(vaultPath: string, relPath: string, content: string): void {
  const fullPath = join(vaultPath, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, Buffer.from(content, 'utf-8'));
}

function archiveSession(vaultPath: string, session: ArchivableSession, state: SyncState): string {
  const date = isoDate(session.timestamp);
  const slug = `${date}-${session.id.slice(0, 8)}`;
  const relPath = `01-Projects/sessions/${slug}.md`;

  const description = oneLine(
    session.threadName || session.prompt || `Session ${session.id.slice(0, 8)}`,
    200
  );

  const content = renderIssueNote({
    slug,
    description,
    platform: session.platform,
    source: session.source,
    sessionId: session.id,
    timestamp: session.timestamp,
    prompt: session.prompt,
    threadName: session.threadName,
    project: session.project,
  });

  writeVaultBytes(vaultPath, relPath, content);
  state.archived.push(session.id);
  state.stats.totalArchived++;

  return relPath;
}

// --- Main ---

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const vaultPath = resolveVaultPath(opts.vault);
  const state = readState();

  console.error(`[session-archiver] Sync to ${vaultPath}`);
  console.error(`[session-archiver] Last sync: ${state.lastSyncAt || 'never'}`);

  // Collect from all sources in parallel
  const [historySessions, transcriptSessions, codexSessions] = await Promise.all([
    collectHistorySessions(state, opts.verbose),
    collectTranscriptSessions(state, opts.verbose),
    collectCodexSessions(state, opts.verbose),
  ]);

  // Merge and deduplicate
  const allSessions = [...historySessions, ...transcriptSessions, ...codexSessions];
  const byId = new Map<string, ArchivableSession>();
  for (const s of allSessions) {
    const existing = byId.get(s.id);
    if (!existing || (s.prompt?.length || 0) > (existing.prompt?.length || 0)) {
      byId.set(s.id, s);
    }
  }

  const newSessions = Array.from(byId.values())
    .filter((s) => !state.archived.includes(s.id))
    .sort((a, b) => b.timestamp - a.timestamp);

  console.error(`[session-archiver] ${newSessions.length} new sessions to archive`);

  if (opts.dryRun) {
    for (const s of newSessions.slice(0, 10)) {
      console.log(`[dry-run] archive: ${s.id.slice(0, 8)} (${s.platform}/${s.source})`);
    }
    if (newSessions.length > 10) {
      console.log(`[dry-run] ... and ${newSessions.length - 10} more`);
    }
  } else {
    ensureSessionsAnchor(vaultPath);

    for (const session of newSessions) {
      try {
        const path = archiveSession(vaultPath, session, state);
        console.error(`[archiver] ${session.id.slice(0, 8)} -> ${path}`);
      } catch (err) {
        console.error(`[archiver] ERROR ${session.id.slice(0, 8)}: ${err}`);
        state.stats.duplicates++;
      }
    }
  }

  state.lastSyncAt = new Date().toISOString();
  writeState(state);

  console.error(`[session-archiver] Done. archived=${state.stats.totalArchived}, dups=${state.stats.duplicates}`);
  console.error(`[session-archiver] Stats: history=${state.stats.historySessions}, transcripts=${state.stats.transcriptSessions}, codex=${state.stats.codexSessions}`);
}

main().catch((err) => {
  console.error(`[session-archiver] FATAL: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
