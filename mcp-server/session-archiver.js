#!/usr/bin/env node

// dist/scripts/session-archiver.js
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

// dist/runtime-env.js
var CANONICAL_VAULT_ENV = "VAULT_MIND_VAULT_PATH";
var LEGACY_VAULT_ENV = "VAULT_BRIDGE_VAULT";
function readVaultEnvironment(environment = process.env) {
  return environment[CANONICAL_VAULT_ENV] || environment[LEGACY_VAULT_ENV];
}

// dist/scripts/session-archiver.js
function parseArgs(argv) {
  const out = { dryRun: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault")
      out.vault = argv[++i];
    else if (a === "--dry-run")
      out.dryRun = true;
    else if (a === "-v" || a === "--verbose")
      out.verbose = true;
  }
  return out;
}
function resolveVaultPath(explicit) {
  if (explicit)
    return explicit;
  const env = readVaultEnvironment();
  if (env)
    return env;
  throw new Error("vault path not set: pass --vault PATH or set VAULT_MIND_VAULT_PATH");
}
function stateFilePath() {
  return join(homedir(), ".vault-mind", "session-archiver", "state.json").split("\\").join("/");
}
function defaultState() {
  return {
    lastSyncAt: "",
    stats: {
      historyLinesRead: 0,
      historySessions: 0,
      transcriptFilesScanned: 0,
      transcriptSessions: 0,
      codexSessions: 0,
      claudeMemSessions: 0,
      totalArchived: 0,
      duplicates: 0
    },
    archived: []
  };
}
function readState() {
  try {
    return JSON.parse(readFileSync(stateFilePath(), "utf-8"));
  } catch {
    return defaultState();
  }
}
function writeState(state) {
  const p = stateFilePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2));
}
async function* readJsonlLines(filePath) {
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim())
      yield line;
  }
  rl.close();
}
async function collectHistorySessions(state, verbose) {
  const historyPath = join(homedir(), ".claude", "history.jsonl").split("\\").join("/");
  if (!existsSync(historyPath)) {
    verbose && console.error("[history] not found");
    return [];
  }
  const sessions = [];
  const knownIds = new Set(state.archived);
  let lineNum = 0;
  for await (const line of readJsonlLines(historyPath)) {
    lineNum++;
    try {
      const entry = JSON.parse(line);
      if (!entry.sessionId || knownIds.has(entry.sessionId))
        continue;
      sessions.push({
        id: entry.sessionId,
        sessionId: entry.sessionId,
        timestamp: entry.timestamp,
        project: entry.project || "unknown",
        prompt: entry.display?.slice(0, 500),
        platform: "claude",
        source: "history"
      });
      knownIds.add(entry.sessionId);
    } catch {
    }
  }
  state.stats.historyLinesRead = lineNum;
  state.stats.historySessions = sessions.length;
  verbose && console.error(`[history] ${lineNum} lines, ${sessions.length} new sessions`);
  return sessions;
}
async function collectTranscriptSessions(state, verbose) {
  const projectsDir = join(homedir(), ".claude", "projects").split("\\").join("/");
  if (!existsSync(projectsDir)) {
    verbose && console.error("[transcripts] projects dir not found");
    return [];
  }
  const sessions = [];
  const knownIds = new Set(state.archived);
  const { readdirSync, statSync } = await import("node:fs");
  let filesScanned = 0;
  function scanDir(dir) {
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith("."))
          continue;
        const full = join(dir, entry);
        try {
          const stat = statSync(full);
          if (stat.isDirectory()) {
            scanDir(full);
          } else if (entry.endsWith(".jsonl")) {
            filesScanned++;
            processTranscript(full, entry);
          }
        } catch {
        }
      }
    } catch {
    }
  }
  function extractSessionId(filename) {
    const match = filename.match(/^([0-9a-f-]+)\.jsonl$/i);
    return match ? match[1] : null;
  }
  function processTranscript(filePath, filename) {
    const sessionId = extractSessionId(filename);
    if (!sessionId || knownIds.has(sessionId))
      return;
    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      let timestamp = Date.now();
      let project = "unknown";
      let platform = "claude";
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const type = entry.type || entry.sessionType;
          if (type === "session-start" || type === "session_start") {
            if (entry.timestamp)
              timestamp = new Date(entry.timestamp).getTime();
            if (entry.cwd) {
              const match = entry.cwd.match(/[^/\\]+$/);
              project = match ? match[0] : "unknown";
            }
          } else if (type === "last-prompt" && entry.timestamp) {
            timestamp = new Date(entry.timestamp).getTime();
          } else if (entry.sessionId && !sessionId) {
          }
        } catch {
        }
      }
      sessions.push({
        id: sessionId,
        sessionId,
        timestamp,
        project,
        platform,
        source: "transcript"
      });
      knownIds.add(sessionId);
    } catch {
    }
  }
  scanDir(projectsDir);
  state.stats.transcriptFilesScanned = filesScanned;
  state.stats.transcriptSessions = sessions.length;
  verbose && console.error(`[transcripts] ${filesScanned} files, ${sessions.length} new sessions`);
  return sessions;
}
async function collectCodexSessions(state, verbose) {
  const codexPath = join(homedir(), ".codex", "session_index.jsonl").split("\\").join("/");
  if (!existsSync(codexPath)) {
    verbose && console.error("[codex] not found");
    return [];
  }
  const sessions = [];
  const knownIds = new Set(state.archived);
  for await (const line of readJsonlLines(codexPath)) {
    try {
      const entry = JSON.parse(line);
      if (!entry.id || knownIds.has(entry.id))
        continue;
      sessions.push({
        id: entry.id,
        sessionId: entry.id,
        timestamp: new Date(entry.updated_at).getTime(),
        project: "codex",
        threadName: entry.thread_name,
        platform: "codex",
        source: "codex"
      });
      knownIds.add(entry.id);
    } catch {
    }
  }
  state.stats.codexSessions = sessions.length;
  verbose && console.error(`[codex] ${sessions.length} new sessions`);
  return sessions;
}
function oneLine(value, max = 200) {
  const s = (value || "").replace(/\r?\n/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}
var REDACTION_BACKSLASH = String.fromCharCode(92);
var REDACTION_BACKSLASH_PATTERN = REDACTION_BACKSLASH.repeat(2);
var REDACTION_SLASH = String.fromCharCode(47);
var REDACTION_PATTERNS = [
  // Bearer / token / api-key style headers and assignments
  /(?:bearer|api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key|token)\s*[=:]\s*["']?[A-Za-z0-9._\-+/=]{16,}/gi,
  // Anthropic / OpenAI / GitHub PAT style
  /\bsk-(?:ant-|or-|proj-)?[A-Za-z0-9_\-]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bxox[abp]-[A-Za-z0-9-]{10,}\b/g,
  // Provider-key env-like assignments
  /\b(?:ANTHROPIC_[A-Z_]*KEY|OPENAI_[A-Z_]*KEY|GOOGLE_[A-Z_]*KEY|AWS_[A-Z_]*KEY|VAULT_[A-Z_]*KEY)\s*=\s*[^\s'"]{12,}/g,
  // Windows absolute paths under user profile
  new RegExp(String.raw`C:` + String.raw`\\Users\\[^\\\s'"<>|]+`, "g"),
  // Unix absolute paths under home
  new RegExp(`${REDACTION_SLASH}(?:home|Users)${REDACTION_SLASH}[^${REDACTION_SLASH}\\s'"<>|]+`, "g")
];
function redact(value, vaultPath) {
  if (!value)
    return value;
  let out = value;
  for (const pat of REDACTION_PATTERNS) {
    out = out.replace(pat, "<REDACTED>");
  }
  if (vaultPath)
    out = out.replace(configuredVaultPathPattern(vaultPath), "<REDACTED>");
  return out;
}
function configuredVaultPathPattern(vaultPath) {
  const separator = `[${REDACTION_BACKSLASH_PATTERN}${REDACTION_SLASH}]`;
  const escapedPath = escapeRegExp(resolve(vaultPath)).replaceAll(REDACTION_BACKSLASH_PATTERN, separator);
  return new RegExp(`(?<![A-Za-z0-9_])${escapedPath}(?:${separator}[^\\s'"<>|]*)?(?=$|[\\s'"<>|])`, "g");
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function projectSlug(raw) {
  const fallback = "inbox";
  if (!raw)
    return fallback;
  const lower = raw.toLowerCase().trim();
  if (!lower)
    return fallback;
  const slug = lower.replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
  return slug || fallback;
}
function isoDate(epoch) {
  return new Date(epoch || Date.now()).toISOString().slice(0, 10);
}
function formatTimestamp(epoch) {
  return new Date(epoch).toISOString().replace("T", " ").slice(0, 16);
}
function renderIssueNote(fields) {
  const { slug, description, platform, source, sessionId, timestamp, prompt, threadName, project } = fields;
  const date = isoDate(timestamp);
  const entity = `project/sessions/issue/${slug}`;
  const body = [
    `# ${platform === "codex" ? "Codex" : "Claude"} Session`,
    "",
    `**Session ID:** \`${sessionId}\``,
    `**Source:** ${source.toUpperCase()}`,
    `**Timestamp:** ${formatTimestamp(timestamp)}`,
    `**Project:** ${project}`,
    "",
    "## Prompt",
    "",
    prompt ? oneLine(prompt, 2e3) : "(no prompt recorded)",
    "",
    threadName ? `## Thread Name

${threadName}
` : ""
  ].join("\n");
  return [
    "---",
    "type: issue",
    `entity: ${entity}`,
    "state: done",
    "review: reviewed",
    "kind: knowledge-task",
    `id: sessions/${slug}`,
    `description: ${description}`,
    "status: active",
    "priority: 0",
    "blocked-by: []",
    "assignee: agent/session-archiver",
    `last-verified: ${isoDate()}`,
    `platform: ${platform}`,
    `source: ${source}`,
    `session-id: ${sessionId}`,
    `timestamp: ${timestamp}`,
    "---",
    "",
    body,
    ""
  ].join("\n");
}
function ensureSessionsAnchor(vaultPath, project) {
  const anchorPath = join(vaultPath, "01-Projects", project, "_project.md");
  const relPath = `01-Projects/${project}/_project.md`;
  if (!existsSync(anchorPath)) {
    const content = [
      "---",
      "type: project",
      `entity: project/${project}`,
      "kind: knowledge-task",
      `id: ${project}/project`,
      "description: Work-OS project created by session-archiver",
      "status: active",
      `last-verified: ${isoDate()}`,
      "---",
      "",
      `# ${project}`,
      "",
      "Sessions archived under this project by session-archiver.",
      ""
    ].join("\n");
    writeVaultBytes(vaultPath, relPath, content);
  }
}
function writeVaultBytes(vaultPath, relPath, content) {
  const fullPath = join(vaultPath, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, Buffer.from(content, "utf-8"));
}
function archiveSession(vaultPath, session, state) {
  const date = isoDate(session.timestamp);
  const sessionSlug = `${date}-${session.id.slice(0, 8)}`;
  const project = projectSlug(session.project);
  const relPath = `01-Projects/${project}/sessions/${sessionSlug}.md`;
  const description = oneLine(redact(session.threadName, vaultPath) || redact(session.prompt, vaultPath) || `Session ${session.id.slice(0, 8)}`, 200);
  const content = renderIssueNote({
    slug: sessionSlug,
    description,
    platform: session.platform,
    source: session.source,
    sessionId: session.id,
    timestamp: session.timestamp,
    prompt: redact(session.prompt, vaultPath),
    threadName: redact(session.threadName, vaultPath),
    project
  });
  writeVaultBytes(vaultPath, relPath, content);
  state.archived.push(session.id);
  state.stats.totalArchived++;
  return relPath;
}
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const vaultPath = resolveVaultPath(opts.vault);
  const state = readState();
  console.error(`[session-archiver] Sync to ${vaultPath}`);
  console.error(`[session-archiver] Last sync: ${state.lastSyncAt || "never"}`);
  const [historySessions, transcriptSessions, codexSessions] = await Promise.all([
    collectHistorySessions(state, opts.verbose),
    collectTranscriptSessions(state, opts.verbose),
    collectCodexSessions(state, opts.verbose)
  ]);
  const allSessions = [...historySessions, ...transcriptSessions, ...codexSessions];
  const byId = /* @__PURE__ */ new Map();
  for (const s of allSessions) {
    const existing = byId.get(s.id);
    if (!existing || (s.prompt?.length || 0) > (existing.prompt?.length || 0)) {
      byId.set(s.id, s);
    }
  }
  const newSessions = Array.from(byId.values()).filter((s) => !state.archived.includes(s.id)).sort((a, b) => b.timestamp - a.timestamp);
  console.error(`[session-archiver] ${newSessions.length} new sessions to archive`);
  if (opts.dryRun) {
    for (const s of newSessions.slice(0, 10)) {
      console.log(`[dry-run] archive: ${s.id.slice(0, 8)} (${s.platform}/${s.source})`);
    }
    if (newSessions.length > 10) {
      console.log(`[dry-run] ... and ${newSessions.length - 10} more`);
    }
  } else {
    const ensuredProjects = /* @__PURE__ */ new Set();
    for (const session of newSessions) {
      const project = projectSlug(session.project);
      if (!ensuredProjects.has(project)) {
        ensureSessionsAnchor(vaultPath, project);
        ensuredProjects.add(project);
      }
      try {
        const path = archiveSession(vaultPath, session, state);
        console.error(`[archiver] ${session.id.slice(0, 8)} -> ${path}`);
      } catch (err) {
        console.error(`[archiver] ERROR ${session.id.slice(0, 8)}: ${err}`);
        state.stats.duplicates++;
      }
    }
  }
  state.lastSyncAt = (/* @__PURE__ */ new Date()).toISOString();
  writeState(state);
  console.error(`[session-archiver] Done. archived=${state.stats.totalArchived}, dups=${state.stats.duplicates}`);
  console.error(`[session-archiver] Stats: history=${state.stats.historySessions}, transcripts=${state.stats.transcriptSessions}, codex=${state.stats.codexSessions}`);
}
main().catch((err) => {
  console.error(`[session-archiver] FATAL: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
