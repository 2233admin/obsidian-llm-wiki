#!/usr/bin/env bun
// circleback-collector.ts — Circleback AI meeting notes collector
// Fetches meeting notes since last run and writes daily digests with summaries + action items.
// API docs: https://docs.circleback.ai

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Attendee {
  name: string;
  email?: string;
}

interface ActionItem {
  text: string;
  assignee?: string;
  due_date?: string;
}

interface CirclebackNote {
  id: string;
  title: string;
  /** ISO 8601 meeting date/time */
  date: string;
  attendees?: Attendee[];
  summary?: string;
  action_items?: ActionItem[];
  next_steps?: string;
}

interface NotesPage {
  data: CirclebackNote[];
  /** Cursor for next page; absent when no more pages */
  next_cursor?: string;
}

interface CollectorState {
  last_synced: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_KEY = process.env.CIRCLEBACK_API_KEY ?? '';
const LOOKBACK_DAYS = parseInt(process.env.CIRCLEBACK_LOOKBACK_DAYS ?? '7', 10);
const BASE_URL = 'https://api.circleback.ai/v1';
const PAGE_LIMIT = 50;

const BASE_DIR = join(homedir(), '.vault-mind', 'recipes', 'circleback-to-vault');
const STATE_FILE = join(BASE_DIR, 'state.json');
const DIGESTS_DIR = join(BASE_DIR, 'digests');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDirs(): void {
  mkdirSync(BASE_DIR, { recursive: true });
  mkdirSync(DIGESTS_DIR, { recursive: true });
}

function loadState(): CollectorState | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as CollectorState;
  } catch {
    return null;
  }
}

function saveState(state: CollectorState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function appendHeartbeat(line: string): void {
  const heartbeatFile = join(BASE_DIR, 'heartbeat.log');
  appendFileSync(heartbeatFile, `${new Date().toISOString()} ${line}\n`, 'utf-8');
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function datePart(iso: string): string {
  return iso.slice(0, 10);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchNotesPage(after: string, cursor?: string): Promise<NotesPage> {
  const url = new URL(`${BASE_URL}/notes`);
  url.searchParams.set('created_after', after);
  url.searchParams.set('limit', String(PAGE_LIMIT));
  if (cursor) url.searchParams.set('cursor', cursor);

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from Circleback API: ${body.slice(0, 200)}`);
  }

  return (await res.json()) as NotesPage;
}

async function fetchAllNotes(after: string): Promise<CirclebackNote[]> {
  const all: CirclebackNote[] = [];
  let cursor: string | undefined;

  do {
    const page = await fetchNotesPage(after, cursor);
    all.push(...page.data);
    cursor = page.next_cursor;
  } while (cursor);

  return all;
}

// ---------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------

function formatAttendees(attendees: Attendee[] | undefined): string {
  if (!attendees || attendees.length === 0) return '';
  const names = attendees.map(a => a.name).join(', ');
  return `**Attendees:** ${names}\n`;
}

function formatActionItems(items: ActionItem[] | undefined): string {
  if (!items || items.length === 0) return '';
  const lines = items.map(item => {
    const assignee = item.assignee ? ` (${item.assignee})` : '';
    const due = item.due_date ? ` — due ${item.due_date}` : '';
    return `  - [ ] ${item.text}${assignee}${due}`;
  });
  return `**Action Items:**\n${lines.join('\n')}\n`;
}

function formatNote(note: CirclebackNote): string {
  const parts: string[] = [`### ${note.title}`];
  parts.push(`> ${datePart(note.date)}\n`);

  const attendees = formatAttendees(note.attendees);
  if (attendees) parts.push(attendees);

  if (note.summary) {
    parts.push(`**Summary:**\n${note.summary}\n`);
  }

  if (note.next_steps) {
    parts.push(`**Next Steps:**\n${note.next_steps}\n`);
  }

  const actionItems = formatActionItems(note.action_items);
  if (actionItems) parts.push(actionItems);

  return parts.join('\n');
}

function buildDigest(notes: CirclebackNote[]): string {
  const date = todayStr();

  // Group by meeting date
  const byDate = new Map<string, CirclebackNote[]>();
  for (const note of notes) {
    const d = datePart(note.date);
    const group = byDate.get(d) ?? [];
    group.push(note);
    byDate.set(d, group);
  }

  const frontmatter = [
    '---',
    `date: ${date}`,
    `source: circleback-to-vault`,
    `type: digest`,
    `meetings: ${notes.length}`,
    '---',
    '',
    `# Meeting Digest — ${date}`,
    '',
  ].join('\n');

  const sortedDates = [...byDate.keys()].sort().reverse();
  const sections = sortedDates.map(d => {
    const dayNotes = byDate.get(d)!;
    const header = `## ${d} (${dayNotes.length} meeting${dayNotes.length > 1 ? 's' : ''})`;
    return [header, '', ...dayNotes.map(formatNote)].join('\n');
  });

  return frontmatter + sections.join('\n\n') + '\n';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!API_KEY) {
    process.stderr.write(
      '[circleback] error: CIRCLEBACK_API_KEY is required.\n' +
      'Generate a key at https://app.circleback.ai/settings -> API\n' +
      'Set it with: export CIRCLEBACK_API_KEY=cb_xxx\n',
    );
    process.exit(1);
  }

  ensureDirs();

  const state = loadState();
  const syncAfter = state?.last_synced
    ?? new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  process.stdout.write(`[circleback] fetching notes created after ${syncAfter}\n`);

  const notes = await fetchAllNotes(syncAfter);

  if (notes.length === 0) {
    process.stdout.write('[circleback] no new notes found\n');
    saveState({ last_synced: new Date().toISOString() });
    appendHeartbeat('ok notes=0');
    return;
  }

  process.stdout.write(`[circleback] fetched ${notes.length} note(s)\n`);

  const digest = buildDigest(notes);
  const digestPath = join(DIGESTS_DIR, `${todayStr()}.md`);

  // Append to today's digest if it already exists (multiple runs same day)
  if (existsSync(digestPath)) {
    appendFileSync(digestPath, '\n---\n\n' + digest, 'utf-8');
  } else {
    writeFileSync(digestPath, digest, 'utf-8');
  }

  process.stdout.write(`[circleback] digest written to ${digestPath}\n`);

  saveState({ last_synced: new Date().toISOString() });
  appendHeartbeat(`ok notes=${notes.length}`);
}

main().catch(err => {
  process.stderr.write(
    `[circleback] fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
