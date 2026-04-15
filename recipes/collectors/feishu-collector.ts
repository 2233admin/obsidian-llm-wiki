#!/usr/bin/env bun
/**
 * feishu-collector.ts -- Feishu group messages -> vault digest
 *
 * Fetches IM messages from Feishu group chats via REST API and writes
 * a dated digest to ~/.vault-mind/recipes/feishu-to-vault/digests/.
 *
 * Required Feishu app scopes: im:message:readonly, im:chat:readonly
 *
 * Usage:
 *   bun run recipes/collectors/feishu-collector.ts
 *   FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx bun run ...
 *
 * Environment:
 *   FEISHU_APP_ID         - required: Feishu app ID (cli_xxx)
 *   FEISHU_APP_SECRET     - required: Feishu app secret
 *   FEISHU_CHATS          - optional comma-separated chat IDs; omit = auto-discover all
 *   FEISHU_LOOKBACK_DAYS  - optional, default 1: days to look back on first run
 *   VAULT_MIND_DIR        - optional project root override
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// -- Types -------------------------------------------------------------------

interface FeishuMessage {
  message_id: string;
  create_time: string;  // Unix seconds as string
  chat_id: string;
  msg_type: string;
  content: string;      // JSON-encoded string
  sender: {
    id: string;
    id_type: string;
    sender_type: string;
  };
  deleted?: boolean;
}

interface ChatInfo {
  chat_id: string;
  name: string;
  chat_type: string;   // 'group' | 'p2p'
}

interface ChatState {
  since_time: number;  // Unix seconds; fetch messages with create_time > this
  last_run?: string;
  chat_name?: string;  // cached name for display
}

interface CollectorState {
  chats: Record<string, ChatState>;
  last_run?: string;
}

interface CollectorStats {
  chats_scanned: number;
  chats_with_new: number;
  messages: number;
}

// -- Config ------------------------------------------------------------------

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_CHATS_ENV = process.env.FEISHU_CHATS;
const LOOKBACK_DAYS = parseInt(process.env.FEISHU_LOOKBACK_DAYS ?? '1', 10);

if (!APP_ID || !APP_SECRET) {
  process.stderr.write('[feishu-collector] ERROR: FEISHU_APP_ID and FEISHU_APP_SECRET must be set\n');
  process.stderr.write('[feishu-collector] Create a Feishu app at https://open.feishu.cn/app\n');
  process.stderr.write('[feishu-collector] Required scopes: im:message:readonly, im:chat:readonly\n');
  process.exit(1);
}

const BASE = 'https://open.feishu.cn/open-apis';

const OUTPUT_DIR = join(homedir(), '.vault-mind', 'recipes', 'feishu-to-vault');
const DIGESTS_DIR = join(OUTPUT_DIR, 'digests');
const STATE_FILE = join(OUTPUT_DIR, 'state.json');
const HEARTBEAT_FILE = join(OUTPUT_DIR, 'heartbeat.jsonl');

const MAX_MESSAGES_PER_CHAT = 500;
const DIGEST_TAIL = 30;

// -- Auth --------------------------------------------------------------------

let _tokenCache: { token: string; expires: number } | null = null;

async function getToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_tokenCache && now < _tokenCache.expires) return _tokenCache.token;

  const resp = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  if (!resp.ok) throw new Error(`Auth failed: HTTP ${resp.status}`);

  const data = await resp.json() as {
    code: number;
    msg: string;
    tenant_access_token: string;
    expire: number;
  };
  if (data.code !== 0) throw new Error(`Auth failed: code=${data.code} msg=${data.msg}`);

  _tokenCache = { token: data.tenant_access_token, expires: now + data.expire - 60 };
  return _tokenCache.token;
}

async function feishuGet(path: string, params: Record<string, string> = {}): Promise<unknown> {
  const token = await getToken();
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Feishu GET ${path} -> HTTP ${resp.status}`);
  return resp.json();
}

// -- API queries -------------------------------------------------------------

async function discoverChats(): Promise<ChatInfo[]> {
  const chats: ChatInfo[] = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, string> = { page_size: '100' };
    if (pageToken) params.page_token = pageToken;

    const r = await feishuGet('/im/v1/chats', params) as {
      code: number;
      msg?: string;
      data: { items: ChatInfo[]; page_token?: string; has_more: boolean };
    };
    if (r.code !== 0) throw new Error(`List chats failed: code=${r.code} msg=${r.msg}`);

    chats.push(...(r.data.items ?? []));
    pageToken = r.data.has_more ? r.data.page_token : undefined;
  } while (pageToken);

  // Only group chats; p2p are noisy and usually irrelevant for digests
  return chats.filter(c => c.chat_type === 'group');
}

async function fetchMessages(chatId: string, startTime: number): Promise<FeishuMessage[]> {
  const messages: FeishuMessage[] = [];
  let pageToken: string | undefined;
  const endTime = Math.floor(Date.now() / 1000);

  do {
    const params: Record<string, string> = {
      container_id_type: 'chat',
      container_id: chatId,
      start_time: String(startTime),
      end_time: String(endTime),
      page_size: '50',
    };
    if (pageToken) params.page_token = pageToken;

    const r = await feishuGet('/im/v1/messages', params) as {
      code: number;
      msg?: string;
      data: { items: FeishuMessage[]; page_token?: string; has_more: boolean };
    };

    if (r.code !== 0) {
      // 230002 = bot not in chat; 230003 = no permission -- warn and skip
      process.stderr.write(
        `[feishu-collector] WARN: chat ${chatId} messages unavailable: code=${r.code} msg=${r.msg}\n`,
      );
      break;
    }

    const items = (r.data.items ?? []).filter(m => !m.deleted);
    messages.push(...items);
    pageToken = r.data.has_more ? r.data.page_token : undefined;

    if (messages.length >= MAX_MESSAGES_PER_CHAT) break;
  } while (pageToken);

  return messages.slice(0, MAX_MESSAGES_PER_CHAT);
}

// -- Content extraction ------------------------------------------------------

function extractText(msg: FeishuMessage): string {
  try {
    const c = JSON.parse(msg.content) as Record<string, unknown>;

    switch (msg.msg_type) {
      case 'text':
        return String(c.text ?? '').replace(/\n/g, ' ').slice(0, 120);

      case 'post': {
        // Rich text: { title, content: [[{tag, text, ...}]] }
        const parts: string[] = [];
        if (c.title) parts.push(String(c.title));
        for (const line of (c.content as Array<Array<{ tag: string; text?: string; user_name?: string }>> ?? [])) {
          for (const el of line) {
            if (el.text) parts.push(el.text);
            else if (el.tag === 'at' && el.user_name) parts.push(`@${el.user_name}`);
          }
        }
        return parts.join(' ').replace(/\n/g, ' ').slice(0, 120);
      }

      case 'image':   return '[image]';
      case 'file':    return `[file: ${String(c.file_name ?? 'unknown')}]`;
      case 'audio':   return '[audio]';
      case 'video':   return '[video]';
      case 'sticker': return '[sticker]';
      case 'system':  return `[system: ${String(c.type ?? 'event')}]`;
      default:        return `[${msg.msg_type}]`;
    }
  } catch {
    return '[parse error]';
  }
}

function shortId(openId: string): string {
  // ou_abcdef123456789 -> ou_..456789 (readable without exposing full ID)
  return openId.length > 12 ? `${openId.slice(0, 3)}..${openId.slice(-6)}` : openId;
}

// -- Digest ------------------------------------------------------------------

function buildChatBlock(
  chatId: string,
  chatName: string,
  messages: FeishuMessage[],
): string[] {
  const lines: string[] = [
    `## ${chatName || chatId} (${messages.length} new)`,
    '',
  ];

  const tail = messages.slice(-DIGEST_TAIL);
  if (tail.length < messages.length) {
    lines.push(`*... ${messages.length - tail.length} earlier messages omitted ...*`, '');
  }
  lines.push('### Messages', '');

  for (const m of tail) {
    const ts = parseInt(m.create_time, 10);
    const time = new Date(ts * 1000).toISOString().slice(11, 16);
    const sender = shortId(m.sender.id);
    const text = extractText(m);
    lines.push(`- [${time}] ${sender}: ${text}`);
  }
  lines.push('');

  return lines;
}

function buildDigest(date: string, blocks: string[][], stats: CollectorStats): string {
  const frontmatter = [
    '---',
    `date: ${date}`,
    'source: feishu-to-vault',
    'type: digest',
    `channels: ${stats.chats_with_new}`,
    `total_messages: ${stats.messages}`,
    '---',
    '',
    `# Feishu Digest -- ${date}`,
    '',
  ];
  return [...frontmatter, ...blocks.flat()].join('\n');
}

// -- Helpers -----------------------------------------------------------------

function ensureDirs(): void {
  for (const dir of [OUTPUT_DIR, DIGESTS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function loadState(): CollectorState {
  if (!existsSync(STATE_FILE)) return { chats: {} };
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as CollectorState;
  } catch {
    return { chats: {} };
  }
}

function saveState(state: CollectorState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function appendHeartbeat(event: string, data: Record<string, unknown>): void {
  const entry = JSON.stringify({ ts: new Date().toISOString(), event, data }) + '\n';
  appendFileSync(HEARTBEAT_FILE, entry, 'utf8');
}

// -- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  ensureDirs();
  const state = loadState();
  const stats: CollectorStats = { chats_scanned: 0, chats_with_new: 0, messages: 0 };

  // Resolve chat list: specified > auto-discovered
  let chatList: Array<{ chat_id: string; name: string }>;
  try {
    if (FEISHU_CHATS_ENV) {
      chatList = FEISHU_CHATS_ENV.split(',')
        .map(id => id.trim())
        .filter(Boolean)
        .map(chat_id => ({ chat_id, name: state.chats[chat_id]?.chat_name ?? chat_id }));
      process.stderr.write(`[feishu-collector] Using specified chats: ${chatList.map(c => c.chat_id).join(', ')}\n`);
    } else {
      const discovered = await discoverChats();
      chatList = discovered.map(c => ({ chat_id: c.chat_id, name: c.name }));
      process.stderr.write(`[feishu-collector] Auto-discovered ${chatList.length} group chat(s)\n`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[feishu-collector] ERROR: ${msg}\n`);
    appendHeartbeat('error', { reason: 'api_error', message: msg });
    process.exit(1);
  }

  if (chatList.length === 0) {
    process.stderr.write('[feishu-collector] No group chats found. Add the bot to a Feishu group and retry.\n');
    appendHeartbeat('skip', { reason: 'no_chats' });
    return;
  }

  const lookbackSec = LOOKBACK_DAYS * 86400;
  const blocks: string[][] = [];

  for (const { chat_id, name } of chatList) {
    stats.chats_scanned++;
    const chatState = state.chats[chat_id];
    const startTime = chatState
      ? chatState.since_time + 1  // +1 avoids re-fetching the last seen message
      : Math.floor(Date.now() / 1000) - lookbackSec;

    const messages = await fetchMessages(chat_id, startTime);
    if (messages.length === 0) continue;

    blocks.push(buildChatBlock(chat_id, name, messages));

    // Advance cursor to newest message timestamp
    const newestTime = Math.max(...messages.map(m => parseInt(m.create_time, 10)));
    state.chats[chat_id] = {
      since_time: newestTime,
      last_run: new Date().toISOString(),
      chat_name: name,
    };
    stats.messages += messages.length;
    stats.chats_with_new++;

    saveState(state); // checkpoint after each chat (safe to interrupt and resume)
  }

  if (stats.messages === 0) {
    process.stderr.write('[feishu-collector] No new messages across all chats.\n');
    appendHeartbeat('noop', { chats_scanned: stats.chats_scanned });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const content = buildDigest(today, blocks, stats);
  const digestPath = join(DIGESTS_DIR, `${today}.md`);
  writeFileSync(digestPath, content, 'utf8');

  state.last_run = new Date().toISOString();
  saveState(state);
  appendHeartbeat('sync', { stats, digest: digestPath });

  process.stderr.write(
    `[feishu-collector] Done. chats=${stats.chats_with_new}/${stats.chats_scanned}` +
    ` messages=${stats.messages} digest=${digestPath}\n`,
  );
}

main().catch(err => {
  process.stderr.write(`[feishu-collector] FATAL: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
