#!/usr/bin/env node
/**
 * obsidian-llm-wiki MCP server -- stdio transport
 */

import { createMcpServer, startStdioServer } from "./runtime/mcp-runtime.js";
import {
  readFileSync, existsSync, readdirSync, statSync, realpathSync,
  writeFileSync, appendFileSync, rmSync, renameSync, mkdirSync,
} from "node:fs";
import { resolve, join, basename, extname, relative, dirname, posix, isAbsolute as pathIsAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { FilesystemAdapter } from "./adapters/filesystem.js";
import { MemUAdapter } from "./adapters/memu.js";
import { GitNexusAdapter } from "./adapters/gitnexus.js";
import { ObsidianAdapter } from "./adapters/obsidian.js";
import { KanbanAdapter } from "./adapters/kanban.js";
import { QmdAdapter } from "./adapters/qmd.js";
import { LightRAGAdapter } from "./adapters/lightrag.js";
import { RAGAnythingAdapter } from "./adapters/raganything.js";
import { VaultBrainAdapter } from "./adapters/vaultbrain/index.js";
import { GraphifyAdapter } from "./adapters/graphify.js";
import { AdapterRegistry } from "./adapters/registry.js";
import { CompileTrigger } from "./compile-trigger.js";
import type { VaultMindAdapter } from "./adapters/interface.js";
import { makeAllOperations } from "./core/operations.js";
import type { OperationContext, Logger, VaultExecutor, VaultMindConfig } from "./core/types.js";
import { validateParams, rejectDangerousRegex } from "./core/validate.js";

// Precompiled regex patterns for performance (avoid recompilation on every call)
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;
const TAG_RE = /(?:^|\s)#([a-zA-Z_一-鿿][\w/一-鿿-]*)/gm;
const CODE_FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]*`/g;

/** Markdown heading: # through ###### followed by space and text */
const HEADING_RE = /^(#{1,6})\s+(.+)/;
/** YAML history key (flow-style) */
const HISTORY_KEY_RE = /^history:\s*$/m;
/** YAML history key on a single line (used inline) */
const HISTORY_LINE_RE = /^history:\s*$/;
/** YAML array item under a key (two leading spaces + dash) */
const HISTORY_ITEM_RE = /^ {2}- /;
/** Strip trailing newlines */
const TRAILING_NL_RE = /\n+$/;
/** Escape regex special chars in plain-text vault.search queries */
const SEARCH_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
/** Detect single shell-command queries (writeAIOutput guard) */
const SINGLE_CMD_RE = /^\s*(pwd|ls|cd|cat|rg|grep|echo|git\s+status|git\s+diff)\b[^\n]*$/i;
/** Detect existing #user-confirmed tag */
const USER_CONFIRMED_RE = /(^|\s)#user-confirmed(\s|$)/m;
/** Flip status: draft → stale in frontmatter (multiline) */
const STATUS_FLIP_RE = /(^---[\s\S]*?\nstatus: )draft(\n[\s\S]*?^---$)/m;
/** Escape glob special characters for use in a RegExp */
const GLOB_ESCAPE_RE = /[.+^${}()|[\]\\]/g;
/** Normalize Windows backslash to forward slash */
const PATHSEP_RE = /\\/g;
/** Detect Windows absolute-path prefix (e.g. C:\) */
const WIN_ABS_RE = /^[A-Za-z]:[\\/]/;
/** Remove fenced code blocks (alias for CODE_FENCE_RE for API compat) */
const CODE_BLOCK_RE = CODE_FENCE_RE;


// Simple LRU cache for frontmatter parsing (keyed by content hash)
const FRONTMATTER_CACHE = new Map<string, Record<string, unknown> | null>();
const FRONTMATTER_CACHE_MAX = 100;

function getCachedFrontmatter(key: string): Record<string, unknown> | null | undefined {
  return FRONTMATTER_CACHE.get(key);
}

function setCachedFrontmatter(key: string, value: Record<string, unknown> | null): void {
  if (FRONTMATTER_CACHE.size >= FRONTMATTER_CACHE_MAX) {
    const firstKey = FRONTMATTER_CACHE.keys().next().value;
    if (firstKey !== undefined) FRONTMATTER_CACHE.delete(firstKey);
  }
  FRONTMATTER_CACHE.set(key, value);
}

// Config

function loadConfig(): VaultMindConfig {
  // Precedence: env var > ./vault-mind.yaml > ../vault-mind.yaml. An explicit
  // env var is a declaration of intent and must not be silently shadowed by an
  // abandoned yaml in cwd or parent -- prior to this fix a stale dev-workspace
  // yaml could quietly redirect the server away from the user's chosen vault.
  const envVault = process.env.VAULT_MIND_VAULT_PATH || process.env.VAULT_BRIDGE_VAULT;
  if (envVault) {
    const envWeights = process.env.VAULT_MIND_ADAPTER_WEIGHTS;
    const envAdapters = process.env.VAULT_MIND_ADAPTERS;
    return {
      vault_path: envVault,
      auth_token: process.env.VAULT_MIND_AUTH_TOKEN,
      adapters: envAdapters?.split(",").map((s) => s.trim()).filter(Boolean),
      collaboration: loadEnvCollaboration(),
      adapter_weights: envWeights ? (JSON.parse(envWeights) as Record<string, number>) : undefined,
      config_path: undefined,
    };
  }
  const candidates = [
    resolve(process.cwd(), "vault-mind.yaml"),
    resolve(process.cwd(), "../vault-mind.yaml"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return { ...parseSimpleYaml(readFileSync(p, "utf-8")), config_path: p };
  }
  throw new Error("No vault-mind.yaml found and VAULT_MIND_VAULT_PATH not set");
}

function parseSimpleYaml(raw: string): VaultMindConfig {
  const result: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    result[key] = val;
  }
  const adapterWeights: Record<string, number> = {};
  for (const [k, v] of Object.entries(result)) {
    if (k.startsWith("adapter_weight_")) {
      const n = Number(v);
      if (!isNaN(n)) adapterWeights[k.slice("adapter_weight_".length)] = n;
    }
  }
  return {
    vault_path: result["vault_path"] || "",
    auth_token: result["auth_token"],
    adapters: result["adapters"]?.split(",").map((s) => s.trim()),
    collaboration: loadEnvCollaboration(result),
    adapter_weights: Object.keys(adapterWeights).length > 0 ? adapterWeights : undefined,
  };
}

function loadEnvCollaboration(result: Record<string, string> = {}): VaultMindConfig["collaboration"] | undefined {
  const actor = process.env.VAULT_MIND_ACTOR || result["collaboration_actor"];
  const role = process.env.VAULT_MIND_ROLE || result["collaboration_role"];
  const allowed = process.env.VAULT_MIND_ALLOWED_WRITE_PATHS || result["collaboration_allowed_write_paths"];
  const protectedPaths = process.env.VAULT_MIND_PROTECTED_PATHS || result["collaboration_protected_paths"];
  const enforceRaw = process.env.VAULT_MIND_COLLAB_ENFORCE || result["collaboration_enforce"];
  if (!actor && !role && !allowed && !protectedPaths && !enforceRaw) return undefined;
  return {
    actor,
    role,
    allowed_write_paths: allowed?.split(",").map((s) => s.trim()).filter(Boolean),
    protected_paths: protectedPaths?.split(",").map((s) => s.trim()).filter(Boolean),
    enforce: enforceRaw === undefined ? undefined : enforceRaw !== "false",
  };
}

// Helpers

const PROTECTED_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules"]);
const VERSION = "0.3.0";

function err(code: number, message: string): { code: number; message: string } {
  return { code, message };
}

const LOCK_TTL_MS = 60_000;

function withFileLock<T>(fullPath: string, fn: () => T): T {
  const lockPath = fullPath + ".lock";
  const acquire = () =>
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, timestamp: Date.now() }), { encoding: "utf-8", flag: "wx" });
  try {
    acquire();
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const ageMs = Date.now() - statSync(lockPath).mtimeMs;
    if (ageMs < LOCK_TTL_MS) {
      let holder = "unknown";
      try { holder = readFileSync(lockPath, "utf-8").trim(); } catch {}
      throw err(-32010, `Lock conflict on ${basename(fullPath)}: held by ${holder}, ttl remaining ${LOCK_TTL_MS - ageMs}ms`);
    }
    rmSync(lockPath, { force: true });
    acquire();
  }
  try {
    return fn();
  } finally {
    try { rmSync(lockPath, { force: true }); } catch {}
  }
}

type CollabPolicy = {
  team?: string[];
  agents?: string[];
  allowed_write_paths?: string[];
  protected_paths?: string[];
};

const DEFAULT_PROTECTED_PATHS = ["20-Decisions/**", "30-Architecture/**", "40-Runbooks/**", "README.md"];
const globCache = new Map<string, RegExp>();

function readVaultCollabPolicy(vaultPath: string): CollabPolicy {
  const policyPath = resolve(vaultPath, ".vault-collab.json");
  if (!existsSync(policyPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(policyPath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected a JSON object");
    }
    return parsed as CollabPolicy;
  } catch (e) {
    throw err(-32602, `.vault-collab.json is invalid JSON: ${(e as Error).message}`);
  }
}

function globToRegExp(glob: string): RegExp {
  const cached = globCache.get(glob);
  if (cached) return cached;
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      pattern += ".*";
      i++;
    } else if (ch === "*") {
      pattern += "[^/]*";
    } else if (ch === "?") {
      pattern += "[^/]";
    } else {
      pattern += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  const re = new RegExp(`^${pattern}$`);
  globCache.set(glob, re);
  return re;
}

function matchAny(path: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(path));
}

function normalizePolicyPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function safeMemorySegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    /^[A-Za-z]:/.test(trimmed) ||
    trimmed.startsWith("//")
  ) {
    throw err(-32602, `${label} must be a single safe path segment`);
  }
  return trimmed;
}

function memoryPolicyBasePath(config: VaultMindConfig, args: Record<string, unknown>): string {
  const actor = safeMemorySegment(config.collaboration?.actor || process.env.VAULT_MIND_ACTOR || "agent", "actor");
  const project = typeof args.project === "string" && args.project.trim()
    ? safeMemorySegment(args.project, "project")
    : undefined;
  return project
    ? `10-Projects/${project}/agents/${actor}/memory`
    : `00-Inbox/Agent-Memory/${actor}`;
}

function projectPolicyBasePath(args: Record<string, unknown>): string {
  const project = typeof args.project === "string" && args.project.trim()
    ? safeMemorySegment(args.project, "project")
    : "*";
  return `10-Projects/${project}`;
}

function sourcePolicyTargetPaths(args: Record<string, unknown>): string[] {
  const project = typeof args.project === "string" && args.project.trim()
    ? safeMemorySegment(args.project, "project")
    : undefined;
  const platform = typeof args.platform === "string" && args.platform.trim()
    ? safeMemorySegment(args.platform, "platform")
    : "*";
  const sourceNotePath = project
    ? `10-Projects/${project}/sources/${platform}/**`
    : `00-Inbox/Sources/${platform}/**`;
  return ["_llmwiki/source-registry.json", sourceNotePath];
}
function defaultAllowedPaths(actor: string, role: string | undefined): string[] {
  if (!actor) return [];
  if (role === "human") return [`00-Inbox/${actor}`, `00-Inbox/${actor}/**`];
  return [
    `00-Inbox/AI-Output/${actor}`,
    `00-Inbox/AI-Output/${actor}/**`,
    `00-Inbox/Agent-Memory/${actor}`,
    `00-Inbox/Agent-Memory/${actor}/**`,
    `10-Projects/*/agents/${actor}`,
    `10-Projects/*/agents/${actor}/**`,
    `10-Projects/*/project.md`,
    `10-Projects/*/docket/**`,
  ];
}

function writeTargetPaths(config: VaultMindConfig, toolName: string, args: Record<string, unknown>): string[] {
  if (toolName === "vault.rename") {
    return [args.from, args.to].filter((p): p is string => typeof p === "string");
  }
  if (toolName === "vault.writeAIOutput") {
    const persona = typeof args.persona === "string" ? args.persona : "*";
    return [`00-Inbox/AI-Output/${persona}/**`];
  }
  if (toolName === "multimodal.ingest") {
    return typeof args.outputPath === "string"
      ? [args.outputPath]
      : ["00-Inbox/Multimodal/**"];
  }
  if (toolName === "memory.passport.upsert") return [`${memoryPolicyBasePath(config, args)}/passport.md`];
  if (toolName === "memory.handoff.write") return [`${memoryPolicyBasePath(config, args)}/handoff.md`];
  if (toolName === "memory.session.save") return [`${memoryPolicyBasePath(config, args)}/sessions/**`];
  if (toolName === "source.register") return sourcePolicyTargetPaths(args);
  if (toolName === "project.init") return [`${projectPolicyBasePath(args)}/project.md`, `${projectPolicyBasePath(args)}/docket/**`];
  if (toolName === "project.issue.create") return [`${projectPolicyBasePath(args)}/docket/**`];
  if (toolName === "project.issue.update") return [`${projectPolicyBasePath(args)}/docket/**`];
  if (toolName === "project.issue.link") return [`${projectPolicyBasePath(args)}/docket/**`];
  if (toolName === "project.comment.add") return [`${projectPolicyBasePath(args)}/docket/comments/**`];
  if (toolName === "project.canvas.export" || toolName === "project.base.export") return [`${projectPolicyBasePath(args)}/views/**`];
  return typeof args.path === "string" ? [args.path] : [];
}

function enforceCollaborationPolicy(config: VaultMindConfig, toolName: string, args: Record<string, unknown>): void {
  if (toolName === "vault.batch") {
    if (!Array.isArray(args.operations)) return;
    for (const op of args.operations) {
      if (!op || typeof op !== "object") continue;
      const batchOp = op as { method?: unknown; params?: unknown };
      if (typeof batchOp.method !== "string") continue;
      if (batchOp.method === "vault.batch") throw err(-32602, "Recursive batch not allowed");
      const opArgs = {
        ...((batchOp.params && typeof batchOp.params === "object" && !Array.isArray(batchOp.params)) ? batchOp.params as Record<string, unknown> : {}),
      };
      if (args.dryRun !== undefined && opArgs.dryRun === undefined) opArgs.dryRun = args.dryRun;
      if (args.dry_run !== undefined && opArgs.dry_run === undefined) opArgs.dry_run = args.dry_run;
      enforceCollaborationPolicy(config, batchOp.method, opArgs);
    }
    return;
  }

  const mutatingTargets = new Set([
    "vault.create", "vault.modify", "vault.append", "vault.delete", "vault.rename", "vault.mkdir", "vault.writeAIOutput",
    "multimodal.ingest",
    "source.register",
    "memory.passport.upsert", "memory.handoff.write", "memory.session.save",
  ]);
  if (!mutatingTargets.has(toolName)) return;
  const alwaysRealWriteTargets = new Set([
    "source.register",
    "memory.passport.upsert",
    "memory.handoff.write",
    "memory.session.save",
  ]);
  if (!alwaysRealWriteTargets.has(toolName) && args.dryRun !== false && args.dry_run !== false) return;

  const collab = config.collaboration;
  const actor = collab?.actor;
  if (!actor || collab?.enforce === false) return;

  const policy = readVaultCollabPolicy(config.vault_path);
  const role = collab?.role || (policy.agents?.includes(actor) ? "agent" : policy.team?.includes(actor) ? "human" : "agent");
  const allowed = [
    ...defaultAllowedPaths(actor, role),
    ...(policy.allowed_write_paths ?? []),
    ...(collab?.allowed_write_paths ?? []),
  ];
  const protectedPaths = [
    ...DEFAULT_PROTECTED_PATHS,
    ...(policy.protected_paths ?? []),
    ...(collab?.protected_paths ?? []),
  ];

  for (const rawTarget of writeTargetPaths(config, toolName, args)) {
    const target = normalizePolicyPath(rawTarget);
    const protectedHit = matchAny(target, protectedPaths);
    const allowedHit = allowed.length > 0 && matchAny(target, allowed);
    if (protectedHit && !allowedHit) {
      throw err(-32403, `Collaboration policy blocked ${toolName} by ${actor}: protected path ${target}`);
    }
    if (!allowedHit) {
      throw err(-32403, `Collaboration policy blocked ${toolName} by ${actor}: ${target} is outside allowed write paths`);
    }
  }
}

function shouldAuditWrite(toolName: string, args: Record<string, unknown>): boolean {
  if (toolName === "vault.batch") return args.dryRun === false || args.dry_run === false;
  const alwaysRealWriteTargets = new Set([
    "memory.passport.upsert",
    "memory.handoff.write",
    "memory.session.save",
  ]);
  if (alwaysRealWriteTargets.has(toolName)) return true;
  const mutatingTargets = new Set([
    "vault.create", "vault.modify", "vault.append", "vault.delete", "vault.rename", "vault.mkdir", "vault.writeAIOutput",
    "multimodal.ingest",
  ]);
  return mutatingTargets.has(toolName) && (args.dryRun === false || args.dry_run === false);
}

function auditWrite(config: VaultMindConfig, toolName: string, args: Record<string, unknown>, result: unknown): void {
  const actor = config.collaboration?.actor;
  if (!actor || config.collaboration?.enforce === false || !shouldAuditWrite(toolName, args)) return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const auditDir = resolve(config.vault_path, ".wiki-audit");
    mkdirSync(auditDir, { recursive: true });
    const entry = {
      ts: new Date().toISOString(),
      actor,
      role: config.collaboration?.role,
      tool: toolName,
      targets: writeTargetPaths(config, toolName, args).map(normalizePolicyPath),
      ok: true,
      resultPath: typeof result === "object" && result !== null && "path" in result ? (result as { path?: unknown }).path : undefined,
    };
    appendFileSync(resolve(auditDir, `${day}.jsonl`), JSON.stringify(entry) + "\n", "utf-8");
  } catch (e) {
    process.stderr.write(`obsidian-llm-wiki: [warn] audit write failed: ${(e as Error).message}\n`);
  }
}

/**
 * Append a flow-style history item to a note's frontmatter block.
 *
 * Contract: `content` starts with `---\n<yaml>\n---\n...`. Returns content with
 * a new `  - {...}` line under the `history:` array. If `history:` is absent,
 * initialises it at the end of the YAML block. Flow-style keeps the existing
 * scalar-array parser byte-compatible with older entries.
 */
function appendHistoryInYaml(content: string, flowItem: string): string {
  if (!content.startsWith("---\n")) return content;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return content;
  const yamlBlock = content.slice(4, end);
  const after = content.slice(end);

  // uses HISTORY_KEY_RE (module-level)
  let newBlock: string;
  if (HISTORY_KEY_RE.test(yamlBlock)) {
    // Insert after the last `  - ` item following history:
    const lines = yamlBlock.split("\n");
    let hIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (HISTORY_LINE_RE.test(lines[i])) { hIdx = i; break; }
    }
    let insertAt = hIdx + 1;
    while (insertAt < lines.length && HISTORY_ITEM_RE.test(lines[insertAt])) insertAt++;
    lines.splice(insertAt, 0, `  - ${flowItem}`);
    newBlock = lines.join("\n");
  } else {
    const trimmed = yamlBlock.replace(/\n+$/, "");
    newBlock = `${trimmed}\nhistory:\n  - ${flowItem}`;
  }
  return `---\n${newBlock}${after}`;
}

function parseYamlValue(s: string): unknown {
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
    return s.slice(1, -1);
  return s;
}

// VaultFs -- filesystem operations

export class VaultFs {
  private readonly vault: string;
  private readonly realVault: string;
  constructor(vaultPath: string) {
    this.vault = resolve(vaultPath);
    this.realVault = realpathSync(this.vault);
  }

  normalizeVaultPath(p: string, opts: { allowRoot?: boolean } = {}): string {
    if (typeof p !== "string") throw err(-32602, "path required");
    const raw = p.trim();
    if (opts.allowRoot && (raw === "" || raw === "." || raw === "/" || raw === "./" || raw === ".\\")) {
      return "";
    }
    if (!raw) throw err(-32602, "path required");
    if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\") || raw.startsWith("//") || pathIsAbsolute(raw))
      throw err(-32602, "path traversal blocked");
    const normalized = raw.replace(/\\/g, "/").replace(/\/+/g, "/");
    if (normalized.split("/").some((s) => s === ".." || s === "."))
      throw err(-32602, "path traversal blocked");
    const topSegment = normalized.split("/")[0];
    if (PROTECTED_DIRS.has(topSegment)) throw err(-32602, `protected path: ${topSegment}`);
    return normalized;
  }

  resolve(p: string, opts: { allowRoot?: boolean } = {}): string {
    const normalized = this.normalizeVaultPath(p, opts);
    const full = resolve(this.vault, normalized);
    const rel = relative(this.vault, full);
    if (rel.startsWith("..") || pathIsAbsolute(rel)) throw err(-32602, "path escapes vault");
    this.assertRealPathInsideVault(full);
    return full;
  }

  private assertRealPathInsideVault(full: string): void {
    const realTarget = existsSync(full)
      ? realpathSync(full)
      : this.realpathExistingAncestor(dirname(full));
    const rel = relative(this.realVault, realTarget);
    if (rel.startsWith("..") || pathIsAbsolute(rel)) throw err(-32602, "path traversal blocked");
  }

  private realpathExistingAncestor(start: string): string {
    let current = start;
    while (!existsSync(current)) {
      const parent = dirname(current);
      if (parent === current) throw err(-32602, "path traversal blocked");
      current = parent;
    }
    return realpathSync(current);
  }

  parseFrontmatter(content: string): Record<string, unknown> | null {
    if (!content.startsWith("---")) return null;
    // Use cache key based on first 200 chars of frontmatter block
    const end = content.indexOf("\n---", 3);
    if (end === -1) return null;
    const cacheKey = content.slice(0, Math.min(end, 200));
    const cached = getCachedFrontmatter(cacheKey);
    if (cached !== undefined) return cached;
    const block = content.slice(4, end);
    const fm: Record<string, unknown> = {};
    let currentKey: string | null = null;
    let inArray = false;
    let arrayItems: unknown[] = [];
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (inArray && trimmed.startsWith("- ")) {
        arrayItems.push(parseYamlValue(trimmed.slice(2).trim()));
        continue;
      }
      if (inArray && currentKey) {
        fm[currentKey] = arrayItems;
        inArray = false;
        arrayItems = [];
      }
      const colon = trimmed.indexOf(":");
      if (colon === -1) continue;
      const key = trimmed.slice(0, colon).trim();
      const rawVal = trimmed.slice(colon + 1).trim();
      currentKey = key;
      if (rawVal === "") { inArray = true; arrayItems = []; continue; }
      if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
        fm[key] = rawVal.slice(1, -1).split(",").map((s) => parseYamlValue(s.trim()));
      } else {
        fm[key] = parseYamlValue(rawVal);
      }
    }
    if (inArray && currentKey) fm[currentKey] = arrayItems;
    setCachedFrontmatter(cacheKey, fm);
    return fm;
  }

  parseWikilinks(content: string): Array<{ link: string; displayText: string }> {
    const links: Array<{ link: string; displayText: string }> = [];
    // Use precompiled regex from module level
    WIKILINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_RE.exec(content)) !== null) {
      links.push({ link: m[1], displayText: m[2] || m[1] });
    }
    return links;
  }

  parseTags(content: string): string[] {
    const cleaned = content.replace(CODE_BLOCK_RE, "").replace(INLINE_CODE_RE, "");
    const tags: string[] = [];
    // Use precompiled regex from module level
    TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAG_RE.exec(cleaned)) !== null) { tags.push("#" + m[1]); }
    return [...new Set(tags)];
  }

  parseHeadings(content: string): Array<{ heading: string; level: number; position: { line: number } }> {
    const headings: Array<{ heading: string; level: number; position: { line: number } }> = [];
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const hm = lines[i].match(/^(#{1,6})\s+(.+)/);
      if (hm) headings.push({ heading: hm[2].trim(), level: hm[1].length, position: { line: i } });
    }
    return headings;
  }

  walkMd(fn: (relPath: string, content: string) => void): void {
    const walk = (d: string): void => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, ent.name);
        if (ent.isDirectory() && !PROTECTED_DIRS.has(ent.name)) walk(full);
        else if (ent.isFile() && ent.name.endsWith(".md")) {
          const rel = relative(this.vault, full).replace(/\\/g, "/");
          fn(rel, readFileSync(full, "utf-8"));
        }
      }
    };
    walk(this.vault);
  }


  walkSearchableText(fn: (relPath: string, content: string) => void): void {
    const searchableExts = new Set([".md", ".canvas", ".base"]);
    const walk = (d: string): void => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, ent.name);
        if (ent.isDirectory() && !PROTECTED_DIRS.has(ent.name)) walk(full);
        if (ent.isFile() && searchableExts.has(extname(ent.name))) {
const rel = relative(this.vault, full).replace(/\\/g, "/");
          fn(rel, readFileSync(full, "utf-8"));
        }
      }
    };
    walk(this.vault);
  }

  matchGlob(p: string, glob: string): boolean {
const re = new RegExp(
"^" + glob
.replace(/[.+^${}()|[\]\\]/g, "\\$&")
.replace(/\*\*/g, "\0")
.replace(/\*/g, "[^/]*")
.replace(/\0/g, ".*")
.replace(/\?/g, ".") + "$",
);
    return re.test(p);
  }

  dispatch(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case "vault.read": {
        const full = this.resolve(p.path as string);
        if (!existsSync(full)) throw err(-32001, `Not found: ${p.path}`);
        return { content: readFileSync(full, "utf-8") };
      }
      case "vault.exists": {
        const existsPath = this.normalizeVaultPath((p.path as string) ?? "", { allowRoot: true });
        return { exists: existsSync(this.resolve(existsPath, { allowRoot: true })) };
      }
      case "vault.list": {
        const listPath = this.normalizeVaultPath((p.path as string) ?? "", { allowRoot: true });
        const dir = this.resolve(listPath, { allowRoot: true });
        if (!existsSync(dir)) throw err(-32001, `Not found: ${p.path}`);
        const hidden = new Set([".obsidian", ".trash", "node_modules"]);
        const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => !hidden.has(e.name));
        return {
          files: entries.filter((e) => e.isFile()).map((e) => posix.join(listPath, e.name)).sort(),
          folders: entries.filter((e) => e.isDirectory()).map((e) => posix.join(listPath, e.name)).sort(),
        };
      }
      case "vault.stat": {
        const statPath = this.normalizeVaultPath((p.path as string) ?? "", { allowRoot: true });
        const full = this.resolve(statPath, { allowRoot: true });
        if (!existsSync(full)) throw err(-32001, `Not found: ${p.path}`);
        const st = statSync(full);
        const displayName = statPath === "" ? basename(this.vault) : basename(statPath);
        if (st.isDirectory())
          return { type: "folder", path: statPath, name: displayName, children: readdirSync(full).length };
        return {
          type: "file", path: statPath, name: displayName,
          ext: extname(statPath).slice(1), size: st.size, ctime: st.ctimeMs, mtime: st.mtimeMs,
        };
      }
      case "vault.create": {
        const full = this.resolve(p.path as string);
        if (existsSync(full)) throw err(-32002, `Already exists: ${p.path}`);
        if (p.dryRun !== false) return { dryRun: true, action: "create", path: p.path };
        return withFileLock(full, () => {
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, (p.content as string) || "", "utf-8");
          return { ok: true, path: p.path };
        });
      }
      case "vault.modify": {
        const full = this.resolve(p.path as string);
        if (!existsSync(full)) throw err(-32001, `Not found: ${p.path}`);
        if (p.dryRun !== false) return { dryRun: true, action: "modify", path: p.path };
        return withFileLock(full, () => {
          writeFileSync(full, p.content as string, "utf-8");
          return { ok: true, path: p.path };
        });
      }
      case "vault.append": {
        const full = this.resolve(p.path as string);
        if (!existsSync(full)) throw err(-32001, `Not found: ${p.path}`);
        if (p.dryRun !== false) return { dryRun: true, action: "append", path: p.path };
        return withFileLock(full, () => {
          appendFileSync(full, p.content as string, "utf-8");
          return { ok: true, path: p.path };
        });
      }
      case "vault.delete": {
        const full = this.resolve(p.path as string);
        if (!existsSync(full)) throw err(-32001, `Not found: ${p.path}`);
        if (p.dryRun !== false) return { dryRun: true, action: "delete", path: p.path };
        return withFileLock(full, () => {
          rmSync(full, { recursive: true });
          return { ok: true, path: p.path };
        });
      }
      case "vault.rename": {
        const from = this.resolve(p.from as string);
        const to = this.resolve(p.to as string);
        if (!existsSync(from)) throw err(-32001, `Not found: ${p.from}`);
        if (existsSync(to)) throw err(-32002, `Already exists: ${p.to}`);
        if (p.dryRun !== false) return { dryRun: true, action: "rename", from: p.from, to: p.to };
        return withFileLock(from, () => {
          mkdirSync(dirname(to), { recursive: true });
          return withFileLock(to, () => {
            renameSync(from, to);
            return { ok: true, from: p.from, to: p.to };
          });
        });
      }
      case "vault.search": {
        if (typeof p.query !== "string" || (p.query as string).length > 500)
          throw err(-32602, "query must be a string under 500 chars");
        const results: Array<{ path: string; matches: Array<{ line: number; text: string }> }> = [];
        const max = (p.maxResults as number) || 50;
        let total = 0;
        const flags = p.caseSensitive ? "g" : "gi";
        if (p.regex) rejectDangerousRegex(p.query as string);
        const escaped = p.regex
          ? (p.query as string)
          : (p.query as string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(escaped, flags);
        this.walkSearchableText((relPath, content) => {
          if (total >= max) return;
          if (p.glob && !this.matchGlob(relPath, p.glob as string)) return;
          const lines = content.split("\n");
          const matches: Array<{ line: number; text: string }> = [];
          for (let i = 0; i < lines.length && total < max; i++) {
            pattern.lastIndex = 0;
            if (pattern.test(lines[i])) {
              matches.push({ line: i + 1, text: lines[i] });
              total++;
            }
          }
          if (matches.length) results.push({ path: relPath, matches });
        });
        return { results, totalMatches: total };
      }
      case "vault.searchByTag": {
        if (!p.tag) throw err(-32602, "tag required");
        const bare = (p.tag as string).startsWith("#") ? (p.tag as string).slice(1) : (p.tag as string);
        const hashTag = "#" + bare;
        const files: string[] = [];
        this.walkMd((relPath, content) => {
          const tags = this.parseTags(content);
          if (tags.includes(hashTag)) { files.push(relPath); return; }
          const fm = this.parseFrontmatter(content);
          const fmTags = (fm as Record<string, unknown> | null)?.tags ?? (fm as Record<string, unknown> | null)?.tag;
          if (Array.isArray(fmTags) && fmTags.includes(bare)) files.push(relPath);
          else if (typeof fmTags === "string" && fmTags === bare) files.push(relPath);
        });
        return { files: files.sort() };
      }
      case "vault.searchByFrontmatter": {
        if (!p.key) throw err(-32602, "key required");
        const op = (p.op as string) || "eq";
        const validOps = ["eq", "ne", "gt", "lt", "gte", "lte", "contains", "regex", "exists"];
        if (!validOps.includes(op)) throw err(-32602, `Unknown op: ${op}`);
        const results: Array<{ path: string; value: unknown; mtime: number }> = [];
        const pushWithMtime = (relPath: string, v: unknown): void => {
          const st = statSync(this.resolve(relPath));
          results.push({ path: relPath, value: v, mtime: st.mtimeMs });
        };
        this.walkMd((relPath, content) => {
          const fm = this.parseFrontmatter(content);
          if (!fm) return;
          if (op === "exists") {
            if ((p.key as string) in fm) pushWithMtime(relPath, fm[p.key as string]);
            return;
          }
          if (!((p.key as string) in fm)) return;
          const v = fm[p.key as string];
          let match = false;
          switch (op) {
            case "eq": match = v === p.value; break;
            case "ne": match = v !== p.value; break;
            case "gt": match = typeof v === "number" && typeof p.value === "number" && v > p.value; break;
            case "lt": match = typeof v === "number" && typeof p.value === "number" && v < p.value; break;
            case "gte": match = typeof v === "number" && typeof p.value === "number" && v >= p.value; break;
            case "lte": match = typeof v === "number" && typeof p.value === "number" && v <= p.value; break;
            case "contains": match = typeof v === "string" && typeof p.value === "string" && v.includes(p.value); break;
            case "regex":
              try {
                if (typeof p.value === "string") rejectDangerousRegex(p.value);
                match = typeof v === "string" && typeof p.value === "string" && new RegExp(p.value).test(v);
              }
              catch { match = false; }
              break;
          }
          if (match) pushWithMtime(relPath, v);
        });
        return { files: results.sort((a, b) => a.path.localeCompare(b.path)) };
      }
      case "vault.graph": {
        const linkType = (p.type as string) || "both";
        if (!["resolved", "unresolved", "both"].includes(linkType))
          throw err(-32602, `Unknown type: ${linkType} (expected resolved|unresolved|both)`);
        const nodeSet = new Set<string>();
        const edgeMap = new Map<string, number>();
        const inbound = new Set<string>();
        this.walkMd((relPath, content) => {
          nodeSet.add(relPath);
          for (const l of this.parseWikilinks(content)) {
            if (l.link.startsWith("#")) continue;
            let target = l.link.split("#")[0];
            if (!target) continue;
            if (!target.includes("/")) {
              const withMd = target.endsWith(".md") ? target : target + ".md";
              try { if (existsSync(this.resolve(withMd))) target = withMd; } catch {}
            }
            if (!target.endsWith(".md")) target += ".md";
            nodeSet.add(target);
            inbound.add(target);
            const key = relPath + "\u0000" + target;
            edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
          }
        });
        let edges = Array.from(edgeMap.entries()).map(([key, count]) => {
          const [from, to] = key.split("\u0000");
          return { from, to, count };
        });
        const nodes = Array.from(nodeSet).sort().map((np) => ({
          path: np, exists: (() => { try { return existsSync(this.resolve(np)); } catch { return false; } })(),
        }));
        const existsMap = new Map(nodes.map((n) => [n.path, n.exists]));
        if (linkType === "resolved") edges = edges.filter((e) => existsMap.get(e.to) === true);
        else if (linkType === "unresolved") edges = edges.filter((e) => existsMap.get(e.to) !== true);
        const orphans = nodes.filter((n) => n.exists && n.path.endsWith(".md") && !inbound.has(n.path)).map((n) => n.path);
        const unresolvedLinks = nodes.filter((n) => !n.exists).length;
        return { nodes, edges, orphans, unresolvedLinks, type: linkType };
      }
      case "vault.backlinks": {
        if (!p.path) throw err(-32602, "path required");
        const target = (p.path as string).endsWith(".md") ? (p.path as string) : (p.path as string) + ".md";
        const targetBase = basename(target, ".md");
        const results: Array<{ from: string; count: number }> = [];
        this.walkMd((relPath, content) => {
          if (relPath === target) return;
          let count = 0;
          for (const l of this.parseWikilinks(content)) {
            const linkPath = l.link.split("#")[0];
            if (!linkPath) continue;
            if (linkPath === target || linkPath === targetBase || linkPath + ".md" === target) count++;
          }
          if (count > 0) results.push({ from: relPath, count });
        });
        return { backlinks: results.sort((a, b) => a.from.localeCompare(b.from)) };
      }
      case "vault.batch": {
        if (!Array.isArray(p.operations)) throw err(-32602, "operations must be an array");
        type BatchOp = { method: string; params?: Record<string, unknown> };
        const ops = p.operations as BatchOp[];
        const results: Array<{ index: number; ok: boolean; result?: unknown; error?: { code: number; message: string } }> = [];
        let succeeded = 0;
        let failed = 0;
        for (let i = 0; i < ops.length; i++) {
          const op = ops[i];
          if (!op.method?.startsWith("vault.")) throw err(-32602, `Batch only supports vault.* methods (index ${i})`);
          if (op.method === "vault.batch") throw err(-32602, "Recursive batch not allowed");
          try {
            const params = { ...(op.params || {}) };
            if (p.dryRun !== undefined) params.dryRun = p.dryRun;
            const result = this.dispatch(op.method, params);
            results.push({ index: i, ok: true, result });
            succeeded++;
          } catch (e: unknown) {
            const ex = e as { code?: number; message?: string };
            results.push({ index: i, ok: false, error: { code: ex.code || -32000, message: ex.message || String(e) } });
            failed++;
          }
        }
        return { results, summary: { total: ops.length, succeeded, failed } };
      }
      case "vault.lint": {
        const requiredFm = Array.isArray(p.requiredFrontmatter) ? (p.requiredFrontmatter as string[]) : [];
        const allFiles: Array<{ path: string; size: number; content: string }> = [];
        const linkMap = new Map<string, Map<string, number>>();
        const inbound = new Set<string>();
        this.walkMd((relPath, content) => {
          const st = statSync(this.resolve(relPath));
          allFiles.push({ path: relPath, size: st.size, content });
          const targets = new Map<string, number>();
          for (const l of this.parseWikilinks(content)) {
            const t = l.link.endsWith(".md") ? l.link : l.link + ".md";
            targets.set(t, (targets.get(t) || 0) + 1);
          }
          linkMap.set(relPath, targets);
          for (const t of targets.keys()) inbound.add(t);
        });
        const orphans = allFiles.filter((fi) => !inbound.has(fi.path)).map((fi) => fi.path).sort();
        const brokenLinks: Array<{ from: string; to: string }> = [];
        for (const [from, targets] of linkMap) {
          for (const [to] of targets) {
            try { if (!existsSync(this.resolve(to))) brokenLinks.push({ from, to }); } catch { brokenLinks.push({ from, to }); }
          }
        }
        const emptyFiles = allFiles.filter((fi) => fi.size === 0).map((fi) => fi.path).sort();
        const missingFm: Array<{ path: string; missing: string[] }> = [];
        if (requiredFm.length > 0) {
          for (const fi of allFiles) {
            const fm = this.parseFrontmatter(fi.content) || {};
            const missing = requiredFm.filter((k) => !(k in fm));
            if (missing.length > 0) missingFm.push({ path: fi.path, missing });
          }
        }
        const titleMap = new Map<string, string[]>();
        for (const fi of allFiles) {
          const t = basename(fi.path, ".md").toLowerCase();
          const arr = titleMap.get(t) || [];
          arr.push(fi.path);
          titleMap.set(t, arr);
        }
        const duplicates = Array.from(titleMap.entries())
          .filter(([, paths]) => paths.length > 1)
          .map(([title, files]) => ({ title, files: files.sort() }));
        let totalLinks = 0;
        for (const targets of linkMap.values()) for (const c of targets.values()) totalLinks += c;
        return {
          orphans, brokenLinks, emptyFiles, missingFrontmatter: missingFm, duplicateTitles: duplicates,
          stats: {
            totalFiles: allFiles.length, totalLinks, totalOrphans: orphans.length,
            totalBroken: brokenLinks.length, totalEmpty: emptyFiles.length, totalDuplicates: duplicates.length,
          },
        };
      }
      case "vault.daily": {
        const today = new Date().toISOString().slice(0, 10);
        const path = `Daily/${today}.md`;
        const full = this.resolve(path);
        const mood = (p.mood as string) || "";
        const energy = (p.energy as string) || "";
        const summary = (p.summary as string) || "";
        const tags = Array.isArray(p.tags) ? (p.tags as string[]) : [];
        const tagLine = ["daily", ...tags].map(t => `  - ${t}`).join("\n");
        const preamble = summary ? `\n## For future Claude\n${summary}\n` : "";
        const content = `---\ndate: ${today}\ntype: daily\nai-first: true\nmood: ${mood}\nenergy: ${energy}\ntags:\n${tagLine}\n---\n${preamble}\n## ${today}\n\n${summary ? `> ${summary}\n\n` : ""}## Log\n\n## Decisions\n\n## Tomorrow\n`;
        if (p.dryRun !== false) return { dryRun: true, action: "create", path, preview: content.slice(0, 200) };
        return withFileLock(full, () => {
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content, "utf-8");
          return { ok: true, path };
        });
      }
      case "vault.person": {
        if (!p.name) throw err(-32602, "name required");
        const name = p.name as string;
        const path = `People/${name}.md`;
        const full = this.resolve(path);
        const today = new Date().toISOString().slice(0, 10);
        const role = (p.role as string) || "";
        const company = (p.company as string) || "";
        const relationship = (p.relationship as string) || "";
        const notes = (p.notes as string) || "";
        const companyLink = company ? `[[${company}]]` : "";
        const preamble = `${name}${role ? `, ${role}` : ""}${company ? ` at ${companyLink}` : ""}. ${relationship ? `Relationship: ${relationship}.` : ""}`;
        const content = `---\nname: ${name}\ntype: person\nai-first: true\nrole: "${role}"\ncompany: "${company}"\nrelationship: "${relationship}"\ncreated: ${today}\n---\n\n## For future Claude\n${preamble}\n\n## Background\n\n${notes}\n\n## Interactions\n\n## Related Projects\n\n## Notes\n`;
        const alreadyExists = existsSync(full);
        if (p.dryRun !== false) return { dryRun: true, action: alreadyExists ? "update" : "create", path, preview: content.slice(0, 200) };
        return withFileLock(full, () => {
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content, "utf-8");
          return { ok: true, path, action: alreadyExists ? "updated" : "created" };
        });
      }
      case "vault.project": {
        if (!p.name) throw err(-32602, "name required");
        const name = p.name as string;
        const path = `Projects/${name}.md`;
        const full = this.resolve(path);
        const today = new Date().toISOString().slice(0, 10);
        const status = (p.status as string) || "active";
        const summary = (p.summary as string) || "";
        const team = Array.isArray(p.team) ? (p.team as string[]) : [];
        const tags = Array.isArray(p.tags) ? (p.tags as string[]) : [];
        const tagLine = ["project", ...tags].map(t => `  - ${t}`).join("\n");
        const teamLinks = team.map(m => `- [[${m}]]`).join("\n");
        const preamble = summary || `Project: ${name}. Status: ${status}${team.length ? `. Team: ${team.join(", ")}` : ""}.`;
        // Task 7C: stamp currency fields so the project joins the status-drift
        // guard + project-status view (compiler/kb_meta.py currency). A project
        // is anchored by its own activity, so it needs no `source`.
        const slugE = (s: string) => s.trim().replace(/[:[\]\r\n]+/g, "").replace(/\s+/g, "-").toLowerCase();
        const entity = (p.entity as string) || `project/${slugE(name)}`;
        const content = `---\nname: "${name}"\ntype: project\nai-first: true\nstatus: ${status}\nentity: ${entity}\nlast-verified: ${today}\ncreated: ${today}\nupdated: ${today}\ntags:\n${tagLine}\n---\n\n## For future Claude\n${preamble}\n\n## Overview\n\n${summary}\n\n## Team\n\n${teamLinks || "- TBD"}\n\n## Milestones\n\n## Decisions\n\n## Metrics\n\n## Notes\n`;
        if (p.dryRun !== false) return { dryRun: true, action: existsSync(full) ? "update" : "create", path, preview: content.slice(0, 200) };
        return withFileLock(full, () => {
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content, "utf-8");
          return { ok: true, path };
        });
      }
      case "vault.decide": {
        if (!p.title) throw err(-32602, "title required");
        if (!p.context) throw err(-32602, "context required");
        if (!p.decision) throw err(-32602, "decision required");
        const today = new Date().toISOString().slice(0, 10);
        const title = p.title as string;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const path = `Decisions/${today} -- ${slug}.md`;
        const full = this.resolve(path);
        const status = (p.status as string) || "accepted";
        const rationale = (p.rationale as string) || "";
        const consequences = (p.consequences as string) || "";
        const tags = Array.isArray(p.tags) ? (p.tags as string[]) : [];
        const tagLine = ["decision", "adr", ...tags].map(t => `  - ${t}`).join("\n");
        // Task 7C: stamp currency fields. If a `project` is given, namespace the
        // entity under it so the decision surfaces in that project's status view.
        const slugE = (s: string) => s.trim().replace(/[:[\]\r\n]+/g, "").replace(/\s+/g, "-").toLowerCase();
        const proj = (p.project as string) || "";
        const entity = (p.entity as string) || (proj ? `project/${slugE(proj)}/decision/${slug}` : `decision/${slug}`);
        const srcLine = p.source ? `\nsource: ${String(p.source).replace(/[\r\n]+/g, " ").trim()}` : "";
        const content = `---\ntitle: "${title}"\ntype: decision\nai-first: true\nstatus: ${status}\nentity: ${entity}\nlast-verified: ${today}${srcLine}\ndate: ${today}\ntags:\n${tagLine}\n---\n\n## For future Claude\nDecision: ${p.decision as string}. Status: ${status} (${today}).\n\n## Context\n\n${p.context as string}\n\n## Decision\n\n${p.decision as string}\n\n## Rationale\n\n${rationale}\n\n## Consequences\n\n${consequences}\n`;
        if (p.dryRun !== false) return { dryRun: true, action: "create", path, preview: content.slice(0, 200) };
        return withFileLock(full, () => {
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content, "utf-8");
          return { ok: true, path };
        });
      }
      case "vault.meeting": {
        if (!p.title) throw err(-32602, "title required");
        const today = new Date().toISOString().slice(0, 10);
        const title = p.title as string;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const path = `Meetings/${today} -- ${slug}.md`;
        const full = this.resolve(path);
        const attendees = Array.isArray(p.attendees) ? (p.attendees as string[]) : [];
        const decisions = Array.isArray(p.decisions) ? (p.decisions as string[]) : [];
        const actions = Array.isArray(p.actions) ? (p.actions as string[]) : [];
        const summary = (p.summary as string) || "";
        const attendeeLines = attendees.map(a => `- [[${a}]]`).join("\n");
        const decisionLines = decisions.map(d => `- ${d}`).join("\n");
        const actionLines = actions.map(a => `- [ ] ${a}`).join("\n");
        const preamble = summary || `Meeting: ${title} (${today})${attendees.length ? `. Attendees: ${attendees.join(", ")}` : ""}.`;
        const content = `---\ntitle: "${title}"\ntype: meeting\nai-first: true\ndate: ${today}\nattendees: [${attendees.map(a => `"${a}"`).join(", ")}]\n---\n\n## For future Claude\n${preamble}\n\n## Attendees\n\n${attendeeLines || "- TBD"}\n\n## Summary\n\n${summary}\n\n## Decisions\n\n${decisionLines || "- None recorded"}\n\n## Action Items\n\n${actionLines || "- None assigned"}\n\n## Notes\n`;
        if (p.dryRun !== false) return { dryRun: true, action: "create", path, preview: content.slice(0, 200) };
        return withFileLock(full, () => {
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content, "utf-8");
          return { ok: true, path };
        });
      }
      case "vault.ingest": {
        if (!p.title) throw err(-32602, "title required");
        if (!p.content) throw err(-32602, "content required");
        const today = new Date().toISOString().slice(0, 10);
        const title = p.title as string;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const path = `00-Inbox/${slug}.md`;
        const full = this.resolve(path);
        const source = (p.source as string) || "";
        const type = (p.type as string) || "note";
        const tags = Array.isArray(p.tags) ? (p.tags as string[]) : [];
        const tagLine = [type, "inbox", ...tags].map(t => `  - ${t}`).join("\n");
        const preamble = (p.preamble as string) || `Ingested: ${title}${source ? ` from ${source}` : ""} (${today}).`;
        const sourceTag = source ? `\nsource: "${source}"` : "";
        const content = `---\ntitle: "${title}"\ntype: ${type}\nai-first: true\ndate: ${today}${sourceTag}\ntags:\n${tagLine}\n---\n\n## For future Claude\n${preamble}\n\n## Content\n\n${p.content as string}\n`;
        if (p.dryRun !== false) return { dryRun: true, action: "create", path, preview: content.slice(0, 200) };
        return withFileLock(full, () => {
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content, "utf-8");
          return { ok: true, path };
        });
      }
      case "vault.mkdir": {
        const full = this.resolve(p.path as string);
        if (existsSync(full)) throw err(-32002, `Already exists: ${p.path}`);
        if (p.dryRun !== false) return { dryRun: true, action: "mkdir", path: p.path };
        mkdirSync(full, { recursive: true });
        return { ok: true, path: p.path };
      }
      case "vault.init": {
        if (typeof p.methodology === "string") {
          const scaffolds: Record<string, Array<[string, string]>> = {
            generic: [
              ["00-Inbox", "Capture zone for unprocessed notes"],
              ["Daily", "Daily notes (YYYY-MM-DD.md)"],
              ["People", "Person notes with relationships and context"],
              ["Projects", "Project notes with status and milestones"],
              ["Decisions", "Decision logs (ADRs)"],
              ["Meetings", "Meeting notes with attendees and actions"],
              ["Research", "Research notes and findings"],
              ["Knowledge", "Distilled evergreen knowledge"],
              ["Wiki", "Compiled wiki articles and indexes"],
            ],
            para: [
              ["1-Projects", "Active projects with goals and deadlines"],
              ["2-Areas", "Ongoing areas of responsibility"],
              ["3-Resources", "Topics and references of lasting interest"],
              ["4-Archive", "Inactive items from the other categories"],
              ["00-Inbox", "Capture zone for unprocessed notes"],
            ],
            lyt: [
              ["Atlas", "Maps of Content (MOCs) linking ideas together"],
              ["Calendar", "Time-based notes (daily, weekly, reviews)"],
              ["Cards", "Atomic idea notes"],
              ["Extras", "Templates, attachments, and supporting files"],
              ["00-Inbox", "Capture zone for unprocessed notes"],
            ],
            zettelkasten: [
              ["fleeting", "Quick transient captures awaiting processing"],
              ["literature", "Notes on sources in your own words"],
              ["permanent", "Evergreen atomic ideas linked into the web"],
              ["references", "Bibliographic metadata for sources"],
              ["00-Inbox", "Capture zone for unprocessed notes"],
            ],
          };
          const methodologyNotes: Record<string, string> = {
            generic: "Generic second-brain layout: inbox capture, daily logs, and typed notes (people, projects, decisions, meetings) feeding research, knowledge, and wiki layers.",
            para: "PARA (Tiago Forte): organize by actionability -- Projects (active), Areas (ongoing), Resources (interesting), Archive (inactive).",
            lyt: "LYT (Nick Milo): Atlas holds Maps of Content that link Cards (atomic notes); Calendar anchors notes in time.",
            zettelkasten: "Zettelkasten (Luhmann): fleeting captures get processed into literature notes, then distilled into permanent atomic notes linked into a web.",
          };
          const methodology = p.methodology as string;
          const scaffold = scaffolds[methodology];
          if (!scaffold) throw err(-32602, `methodology must be one of ${Object.keys(scaffolds).join("|")}`);
          const dryRun = p.dryRun !== false;
          const created: string[] = [];
          const skipped: string[] = [];
          const today = new Date().toISOString().slice(0, 10);
          for (const [dir] of scaffold) {
            const full = this.resolve(dir);
            if (existsSync(full)) { skipped.push(dir); continue; }
            if (!dryRun) mkdirSync(full, { recursive: true });
            created.push(dir);
          }
          const folderLines = scaffold.map(([dir, purpose]) => `- [[${dir}/README|${dir}]] -- ${purpose}`).join("\n");
          const homeContent = `---\ntype: index\nai-first: true\nmethodology: ${methodology}\ncreated: ${today}\n---\n\n# Home\n\n## For future Claude\n${methodologyNotes[methodology]}\n\n## Folders\n\n${folderLines}\n`;
          const homeFull = this.resolve("Home.md");
          if (existsSync(homeFull)) {
            skipped.push("Home.md");
          } else {
            if (!dryRun) writeFileSync(homeFull, homeContent, "utf-8");
            created.push("Home.md");
          }
          return { ok: true, dryRun, methodology, created, skipped, summary: `Created ${created.length}, skipped ${skipped.length}` };
        }
        if (!p.topic || typeof p.topic !== "string") throw err(-32602, "topic or methodology required");
        if ((p.topic as string).split("/").some((s: string) => s === ".." || s === "."))
          throw err(-32602, "path traversal blocked");
        const created: string[] = [];
        const skipped: string[] = [];
        const base = p.topic as string;
        const now = new Date().toISOString().slice(0, 10);
        const ensureDir = (rel: string) => {
          const full = this.resolve(rel);
          if (existsSync(full)) { skipped.push(rel); return; }
          mkdirSync(full, { recursive: true });
          created.push(rel);
        };
        const ensureFile = (rel: string, content: string) => {
          const r = rel.endsWith(".md") ? rel : rel + ".md";
          const full = this.resolve(r);
          if (existsSync(full)) { skipped.push(r); return; }
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content, "utf-8");
          created.push(r);
        };
        ensureDir(base);
        for (const sub of ["raw", "raw/articles", "raw/papers", "raw/notes", "raw/transcripts", "wiki", "wiki/summaries", "wiki/concepts", "wiki/queries", "schema"])
          ensureDir(`${base}/${sub}`);
        ensureFile(`${base}/wiki/_index.md`, `---\ntopic: "${p.topic}"\nupdated: ${now}\n---\n\n# ${p.topic} -- Knowledge Index\n\nNo articles compiled yet.\n`);
        ensureFile(`${base}/wiki/_sources.md`, `---\ntopic: "${p.topic}"\nupdated: ${now}\n---\n\n# Sources\n\nNo sources compiled yet.\n`);
        ensureFile(`${base}/wiki/_categories.md`, `---\ntopic: "${p.topic}"\nupdated: ${now}\n---\n\n# Categories\n\nAuto-generated during compilation.\n`);
        ensureFile(`${base}/Log.md`, `# ${p.topic} -- Operation Log\n\n- ${now}: KB initialized\n`);
        ensureFile(`${base}/schema/CLAUDE.md`, `# ${p.topic} -- KB Schema\n\nFollows llm-wiki opinionated workflow.\nSee root CLAUDE.md for full documentation.\n`);
        const yamlPath = `${base}/kb.yaml`;
        if (existsSync(this.resolve(yamlPath))) {
          skipped.push(yamlPath);
        } else {
          writeFileSync(this.resolve(yamlPath), `topic: "${p.topic}"\nvault_path: "${this.vault.replace(/\\\\/g, "/")}"\ncreated: ${now}\n`, "utf-8");
          created.push(yamlPath);
        }
        return { ok: true, topic: p.topic, created, skipped, summary: `Created ${created.length}, skipped ${skipped.length}` };
      }
      case "vault.enforceDiscipline": {
        const dryRun = p.dryRun !== false;
        const topLevelOnly = p.topLevelOnly !== false;
        const extraSkip = new Set(
          Array.isArray(p.skipDirs) ? (p.skipDirs as string[]) : [],
        );
        const CATALOG_NAMES = new Set([
          "_index.md", "home.md", "index.md", "readme.md",
        ]);
        const CHRONICLE_NAMES = new Set([
          "log.md", "chronicle.md", "_log.md",
        ]);
        const now = new Date().toISOString().slice(0, 10);

        type DirReport = {
          path: string;
          hasCatalog: string | null;
          hasChronicle: string | null;
          created: string[];
          skipped: string[];
        };

        const processDir = (relDir: string, absDir: string): DirReport => {
          const report: DirReport = {
            path: relDir, hasCatalog: null, hasChronicle: null,
            created: [], skipped: [],
          };
          const entries = readdirSync(absDir, { withFileTypes: true });
          for (const ent of entries) {
            if (!ent.isFile()) continue;
            const lower = ent.name.toLowerCase();
            if (CATALOG_NAMES.has(lower)) report.hasCatalog = ent.name;
            if (CHRONICLE_NAMES.has(lower)) report.hasChronicle = ent.name;
          }
          const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name).sort();
          const subDirs = entries.filter(
            (e) => e.isDirectory() && !PROTECTED_DIRS.has(e.name) && !extraSkip.has(e.name),
          ).map((e) => e.name).sort();
          const topicName = basename(relDir || this.vault);

          if (!report.hasCatalog) {
            const catalogPath = relDir ? posix.join(relDir, "_index.md") : "_index.md";
            const absCatalog = this.resolve(catalogPath);
            const body =
              `---\ntopic: "${topicName}"\nupdated: ${now}\n---\n\n` +
              `# ${topicName} -- Knowledge Index\n\n` +
              (mdFiles.length
                ? "## Notes in this topic\n\n" +
                  mdFiles.map((f) => `- [[${f.replace(/\.md$/, "")}]]`).join("\n") + "\n\n"
                : "") +
              (subDirs.length
                ? "## Subtopics\n\n" +
                  subDirs.map((d) => `- \`${d}/\``).join("\n") + "\n"
                : "");
            if (!dryRun) {
              writeFileSync(absCatalog, body, "utf-8");
            }
            report.created.push(catalogPath);
          } else {
            report.skipped.push(`${relDir}/${report.hasCatalog} (catalog exists)`);
          }

          if (!report.hasChronicle) {
            const chroniclePath = relDir ? posix.join(relDir, "log.md") : "log.md";
            const absChronicle = this.resolve(chroniclePath);
            const body =
              `---\ntopic: "${topicName}"\nupdated: ${now}\n---\n\n` +
              `# ${topicName} -- Operation Log\n\n` +
              `- ${now}: Karpathy LLM Wiki discipline enforced (retroactive).\n`;
            if (!dryRun) {
              writeFileSync(absChronicle, body, "utf-8");
            }
            report.created.push(chroniclePath);
          } else {
            report.skipped.push(`${relDir}/${report.hasChronicle} (chronicle exists)`);
          }

          return report;
        };

        const inspectedDirs: string[] = [];
        const allCreated: string[] = [];
        const allSkipped: string[] = [];
        const errors: Array<{ path: string; message: string }> = [];

        try {
          const topEntries = readdirSync(this.vault, { withFileTypes: true });
          for (const ent of topEntries) {
            if (!ent.isDirectory()) continue;
            if (PROTECTED_DIRS.has(ent.name) || extraSkip.has(ent.name)) continue;
            if (ent.name.startsWith(".")) continue;
            const relDir = ent.name;
            inspectedDirs.push(relDir);
            try {
              const rep = processDir(relDir, this.resolve(relDir));
              allCreated.push(...rep.created);
              allSkipped.push(...rep.skipped);
            } catch (e: unknown) {
              errors.push({ path: relDir, message: (e as Error).message });
            }
          }
        } catch (e: unknown) {
          throw err(-32000, `enforceDiscipline failed to scan vault: ${(e as Error).message}`);
        }

        return {
          dryRun,
          topLevelOnly,
          inspectedDirs,
          created: allCreated,
          skipped: allSkipped,
          errors,
          summary: {
            dirsInspected: inspectedDirs.length,
            filesCreated: allCreated.length,
            filesSkipped: allSkipped.length,
            errorCount: errors.length,
          },
        };
      }
      case "vault.writeAIOutput": {
        const persona = p.persona as string;
        if (typeof persona !== "string" || !/^vault-[a-z]+$/.test(persona))
          throw err(-32602, "persona must match ^vault-[a-z]+$");
        const parentQueryRaw = p.parentQuery as string;
        if (typeof parentQueryRaw !== "string") throw err(-32602, "parentQuery required");
        const sourceNodes = p.sourceNodes as string[];
        if (!Array.isArray(sourceNodes)) throw err(-32602, "sourceNodes required (array)");
        const agent = p.agent as string;
        if (typeof agent !== "string" || agent === "") throw err(-32602, "agent required");
        const body = p.body as string;
        if (typeof body !== "string") throw err(-32602, "body required");

        // Step 2 governance: scope (namespace) + quarantine-state (trust gate).
        // Both optional on write; defaults keep old callers byte-compatible with Step 1.
        const SCOPE_VALUES = ["project", "global", "cross-project", "host-local"] as const;
        const QSTATE_VALUES = ["new", "reviewed", "promoted", "discarded"] as const;
        const scopeRaw = p.scope;
        const scope: string = scopeRaw === undefined ? "project" : String(scopeRaw);
        if (!(SCOPE_VALUES as readonly string[]).includes(scope))
          throw err(-32602, `scope must be one of ${SCOPE_VALUES.join("|")}`);
        const qStateRaw = p.quarantineState;
        const quarantineState: string = qStateRaw === undefined ? "new" : String(qStateRaw);
        if (!(QSTATE_VALUES as readonly string[]).includes(quarantineState))
          throw err(-32602, `quarantineState must be one of ${QSTATE_VALUES.join("|")}`);

        // review-status: routed to an Obsidian body tag (#user-confirmed) rather
        // than a frontmatter field. Lets the native Obsidian tag index carry
        // the signal; vault.searchByTag picks up user-confirmed entries for
        // free. Enum excludes "reviewed" to avoid collision with quarantine-state.
        const REVIEW_STATUS_VALUES = ["none", "user-confirmed"] as const;
        const reviewStatusRaw = p.reviewStatus;
        const reviewStatus: string = reviewStatusRaw === undefined ? "none" : String(reviewStatusRaw);
        if (!(REVIEW_STATUS_VALUES as readonly string[]).includes(reviewStatus))
          throw err(-32602, `reviewStatus must be one of ${REVIEW_STATUS_VALUES.join("|")}`);

        // Step 2.6 input gate: downgraded from reject to warning. Step 2.5 chose
        // thresholds (body>=50 chars, single-shell-cmd reject, query+sourceNodes
        // both-empty reject) as guesses. Hard-throw blocked short-but-legitimate
        // analyses before we had distribution data. Now we emit warnings instead,
        // let the write land, and collect evidence for 2-4 weeks before retuning.
        const SINGLE_CMD_RE = /^\s*(pwd|ls|cd|cat|rg|grep|echo|git\s+status|git\s+diff)\b[^\n]*$/i;
        const bodyTrim = body.trim();
        const queryTrim = parentQueryRaw.trim();
        const warnings: string[] = [];
        if (bodyTrim.length < 50) warnings.push("body-too-short");
        if (SINGLE_CMD_RE.test(queryTrim)) warnings.push("query-looks-like-shell-cmd");
        if (queryTrim === "" && sourceNodes.length === 0) warnings.push("no-anchor");
        if (warnings.length > 0)
          process.stderr.write(`[writeAIOutput] low-signal persona=${persona} warnings=${warnings.join(",")}\n`);

        // Sanitize parent-query: truncate to 200 chars, replace " with right-double-quote
        const parentQuery = parentQueryRaw.slice(0, 200).replace(/"/g, "\u201D");

        // Derive slug
        const deriveSlug = (src: string): string => {
          const cleaned = src
            .replace(/[<>:"/\\|?*]/g, " ")
            .replace(/\s+/g, "-")
            .toLowerCase()
            .replace(/^-+|-+$/g, "");
          if (!cleaned) return "";
          const words = cleaned.split("-").filter((w) => w.length > 0).slice(0, 6);
          const joined = words.join("-");
          return joined.slice(0, 60).replace(/-+$/, "");
        };
        let slug = typeof p.slug === "string" && p.slug !== "" ? deriveSlug(p.slug) : deriveSlug(parentQueryRaw);
        if (!slug) {
          const nowT = new Date();
          const hh = String(nowT.getUTCHours()).padStart(2, "0");
          const mm = String(nowT.getUTCMinutes()).padStart(2, "0");
          const ss = String(nowT.getUTCSeconds()).padStart(2, "0");
          slug = `note-${hh}${mm}${ss}`;
        }

        const nowIso = new Date().toISOString();
        const datePrefix = nowIso.slice(0, 10);
        const relDir = `00-Inbox/AI-Output/${persona}`;
        const baseName = `${datePrefix}-${slug}`;

        // Collision loop: append -2, -3, ... up to -99
        let chosenName = `${baseName}.md`;
        let relPath = `${relDir}/${chosenName}`;
        let fullPath = join(this.vault, relDir, chosenName);
        if (existsSync(fullPath)) {
          let found = false;
          for (let i = 2; i <= 99; i++) {
            chosenName = `${baseName}-${i}.md`;
            relPath = `${relDir}/${chosenName}`;
            fullPath = join(this.vault, relDir, chosenName);
            if (!existsSync(fullPath)) { found = true; break; }
          }
          if (!found) throw err(-32002, `Could not find free filename after 99 collisions for ${baseName}`);
        }

        const frontmatterObj = {
          "generated-by": persona,
          "generated-at": nowIso,
          "agent": agent,
          "parent-query": parentQuery,
          "source-nodes": sourceNodes,
          "status": "draft",
          "scope": scope,
          "quarantine-state": quarantineState,
        };

        // Body tag injection for human-confirmed entries. Obsidian treats
        // repeated tags as one, but we skip duplicate writes to keep diffs clean.
        const bodyWithTag = reviewStatus === "user-confirmed" && !USER_CONFIRMED_RE.test(body)
          ? `${body.replace(/\n+$/, "")}\n\n#user-confirmed`
          : body;

        if (p.dryRun !== false) {
          return { dryRun: true, action: "writeAIOutput", path: relPath, frontmatter: frontmatterObj, warnings };
        }

        // Serialize YAML subset compatible with parseFrontmatter
        const yamlLines: string[] = [];
        yamlLines.push(`generated-by: ${persona}`);
        yamlLines.push(`generated-at: ${nowIso}`);
        yamlLines.push(`agent: ${agent}`);
        yamlLines.push(`parent-query: "${parentQuery}"`);
        if (sourceNodes.length === 0) {
          yamlLines.push(`source-nodes: []`);
        } else {
          yamlLines.push(`source-nodes:`);
          for (const node of sourceNodes) {
            const escaped = String(node).replace(/"/g, "\u201D");
            yamlLines.push(`  - "${escaped}"`);
          }
        }
        yamlLines.push(`status: draft`);
        yamlLines.push(`scope: ${scope}`);
        yamlLines.push(`quarantine-state: ${quarantineState}`);

        const contentOut = `---\n${yamlLines.join("\n")}\n---\n\n${bodyWithTag}\n`;
        mkdirSync(dirname(fullPath), { recursive: true });
        return withFileLock(fullPath, () => {
          writeFileSync(fullPath, contentOut, "utf-8");
          return { ok: true, path: relPath, frontmatter: frontmatterObj, warnings };
        });
      }
      case "vault.sweepAIOutput": {
        const STALE_THRESHOLDS: Record<string, number> = {
          "vault-architect": 45,
          "vault-gardener": 30,
          "vault-historian": 180,
          "vault-librarian": 60,
        };
        const DEFAULT_THRESHOLD = 60;
        const dryRun = p.dry_run !== false;
        const nowMs = typeof p.now === "string" ? Date.parse(p.now as string) : Date.now();
        const nowValid = !isNaN(nowMs) ? nowMs : Date.now();

        const aiRootRel = "00-Inbox/AI-Output";
        const aiRootAbs = join(this.vault, aiRootRel);
        const emptyMetrics = {
          totalEntries: 0,
          byPersona: {} as Record<string, number>,
          byStatus: {} as Record<string, number>,
          byQuarantineState: {} as Record<string, number>,
          realBacklinkHitRate: 0,
        };
        if (!existsSync(aiRootAbs)) {
          return { staleCandidates: [], supersedeCandidates: [], applied: [], metrics: emptyMetrics };
        }

        type Entry = {
          relPath: string;
          absPath: string;
          content: string;
          fm: Record<string, unknown>;
          mtimeMs: number;
          entryMs: number; // frontmatter date primary, mtime fallback
          persona: string;
          status: string;
          sourceNodes: string[];
        };

        const entries: Entry[] = [];
        const walkSubtree = (d: string): void => {
          if (!existsSync(d)) return;
          for (const ent of readdirSync(d, { withFileTypes: true })) {
            const full = join(d, ent.name);
            if (ent.isDirectory() && !PROTECTED_DIRS.has(ent.name)) walkSubtree(full);
            else if (ent.isFile() && ent.name.endsWith(".md")) {
              const content = readFileSync(full, "utf-8");
              const fm = this.parseFrontmatter(content);
              if (!fm) continue;
              const persona = typeof fm["generated-by"] === "string" ? (fm["generated-by"] as string) : "";
              if (!persona) continue;
              const status = typeof fm["status"] === "string" ? (fm["status"] as string) : "";
              const relPath = relative(this.vault, full).replace(/\\/g, "/");
              const st = statSync(full);
              const mtimeMs = st.mtimeMs;
              let entryMs = mtimeMs;
              const ga = fm["generated-at"];
              if (typeof ga === "string") {
                const parsed = Date.parse(ga);
                if (!isNaN(parsed)) entryMs = parsed;
              }
              const sn = fm["source-nodes"];
              const sourceNodes = Array.isArray(sn) ? sn.map((x) => String(x)) : [];
              entries.push({ relPath, absPath: full, content, fm, mtimeMs, entryMs, persona, status, sourceNodes });
            }
          }
        };
        walkSubtree(aiRootAbs);

        const aiOutputPaths = new Set(entries.map((e) => e.relPath));

        // Inline backlink computation: for a target path, find non-AI-Output sources
        const hasRealBacklink = (targetRel: string): boolean => {
          const targetBase = basename(targetRel, ".md");
          let found = false;
          this.walkMd((relPath, content) => {
            if (found) return;
            if (relPath === targetRel) return;
            if (aiOutputPaths.has(relPath)) return; // AI-Output -> AI-Output doesn't anchor
            for (const l of this.parseWikilinks(content)) {
              const linkPath = l.link.split("#")[0];
              if (!linkPath) continue;
              if (linkPath === targetRel || linkPath === targetBase || linkPath + ".md" === targetRel) {
                found = true;
                return;
              }
            }
          });
          return found;
        };

        const staleCandidates: Array<{ path: string; persona: string; ageDays: number; threshold: number }> = [];

        for (const e of entries) {
          if (e.status !== "draft") continue;
          const ageDays = (nowValid - e.entryMs) / 86_400_000;
          const threshold = STALE_THRESHOLDS[e.persona] ?? DEFAULT_THRESHOLD;
          if (ageDays < threshold) continue;
          if (hasRealBacklink(e.relPath)) continue;
          staleCandidates.push({ path: e.relPath, persona: e.persona, ageDays, threshold });
        }

        // Supersede detection: pairs of reviewed same-persona entries
        const reviewed = entries.filter((e) => e.status === "reviewed");
        const supersedeCandidates: Array<{ older: string; newer: string; overlap: number }> = [];
        const jaccard = (a: string[], b: string[]): number => {
          if (a.length === 0 && b.length === 0) return 0;
          const sa = new Set(a);
          const sb = new Set(b);
          let inter = 0;
          for (const x of sa) if (sb.has(x)) inter++;
          const uni = sa.size + sb.size - inter;
          return uni === 0 ? 0 : inter / uni;
        };
        for (let i = 0; i < reviewed.length; i++) {
          for (let j = i + 1; j < reviewed.length; j++) {
            const a = reviewed[i];
            const b = reviewed[j];
            if (a.persona !== b.persona) continue;
            if (a.sourceNodes.length === 0 || b.sourceNodes.length === 0) continue;
            const overlap = jaccard(a.sourceNodes, b.sourceNodes);
            if (overlap < 0.6) continue;
            const olderEntry = a.entryMs <= b.entryMs ? a : b;
            const newerEntry = a.entryMs <= b.entryMs ? b : a;
            supersedeCandidates.push({ older: olderEntry.relPath, newer: newerEntry.relPath, overlap });
          }
        }

        const applied: Array<{ path: string; change: string }> = [];
        if (!dryRun) {
          const flipIso = new Date(nowValid).toISOString();
          for (const sc of staleCandidates) {
            const absPath = join(this.vault, sc.path);
            // Step 2 governance: append a structured history entry for audit.
            // YAML flow-style so the Step-1 frontmatter parser (scalar-only arrays)
            // still round-trips the entry as an opaque string without loss.
            // Step 2.7: axis makes from/to unambiguous. A future
            // manual-promote entry like {from: reviewed, to: promoted} could
            // refer to either status or quarantine-state; axis names the one
            // that moved. Gardener only auto-flips status, so axis: status.
            const historyEntry =
              `{ts: "${flipIso}", axis: status, from: draft, to: stale, trigger: auto-stop-summary, ` +
              `evidence_level: low, human_in_loop: false, note: "gardener sweep"}`;
            const flipped = withFileLock(absPath, () => {
              const original = readFileSync(absPath, "utf-8");
              const withStatusFlipped = original.replace(
                /(^---[\s\S]*?\nstatus: )draft(\n[\s\S]*?^---$)/m,
                (_m, g1: string, g2: string) => g1 + "stale" + g2,
              );
              if (withStatusFlipped === original) return false;
              const replaced = appendHistoryInYaml(withStatusFlipped, historyEntry);
              writeFileSync(absPath, replaced, "utf-8");
              return true;
            });
            if (flipped) applied.push({ path: sc.path, change: "draft→stale" });
          }
        }

        // Step 2.5 metrics: answer "is the sweep finding anything? where does it land?"
        // without needing a separate vault.stats call. Drives future threshold tuning.
        const metrics = {
          totalEntries: entries.length,
          byPersona: {} as Record<string, number>,
          byStatus: {} as Record<string, number>,
          byQuarantineState: {} as Record<string, number>,
          realBacklinkHitRate: 0,
        };
        let withRealBacklink = 0;
        for (const e of entries) {
          metrics.byPersona[e.persona] = (metrics.byPersona[e.persona] ?? 0) + 1;
          metrics.byStatus[e.status || "(none)"] = (metrics.byStatus[e.status || "(none)"] ?? 0) + 1;
          const qs = typeof e.fm["quarantine-state"] === "string"
            ? (e.fm["quarantine-state"] as string) : "(none)";
          metrics.byQuarantineState[qs] = (metrics.byQuarantineState[qs] ?? 0) + 1;
          if (hasRealBacklink(e.relPath)) withRealBacklink++;
        }
        metrics.realBacklinkHitRate = entries.length === 0 ? 0 : withRealBacklink / entries.length;

        // Step 2.8: append a trend-log line per real sweep so threshold tuning
        // has a time-series (not just the latest snapshot). Skipped on dry_run
        // to keep no-write-on-dry-run invariant. Only appends when there is
        // something to report — empty vaults leave the log alone.
        if (!dryRun && entries.length > 0) {
          const sweepLogRel = "00-Inbox/AI-Output/sweep.log.md";
          const sweepLogAbs = join(this.vault, sweepLogRel);
          const stamp = new Date(nowValid).toISOString();
          const logLine =
            `- {ts: "${stamp}", totalEntries: ${metrics.totalEntries}, ` +
            `staleHits: ${staleCandidates.length}, supersedeHits: ${supersedeCandidates.length}, ` +
            `realBacklinkHitRate: ${metrics.realBacklinkHitRate.toFixed(3)}}\n`;
          withFileLock(sweepLogAbs, () => {
            if (!existsSync(sweepLogAbs)) {
              mkdirSync(dirname(sweepLogAbs), { recursive: true });
              writeFileSync(sweepLogAbs, "# Sweep trend log\n\n", "utf-8");
            }
            appendFileSync(sweepLogAbs, logLine, "utf-8");
          });
        }

        return { staleCandidates, supersedeCandidates, applied, metrics };
      }
      case "vault.getMetadata": {
        const full = this.resolve(p.path as string);
        if (!existsSync(full)) throw err(-32001, `Not found: ${p.path}`);
        const content = readFileSync(full, "utf-8");
        const out: Record<string, unknown> = {};
        const links = this.parseWikilinks(content);
        if (links.length) out.links = links.map((l) => ({ link: l.link, displayText: l.displayText }));
        const tags = this.parseTags(content);
        if (tags.length) out.tags = tags.map((t) => ({ tag: t }));
        const headings = this.parseHeadings(content);
        if (headings.length) out.headings = headings;
        const fm = this.parseFrontmatter(content);
        if (fm) out.frontmatter = fm;
        return out;
      }
      default:
        throw err(-32601, `Unknown method: ${method}`);
    }
  }

  async execute(method: string, params: Record<string, unknown>): Promise<unknown> {
    return this.dispatch(method, params);
  }
}

function checkAuth(config: VaultMindConfig, args: Record<string, unknown>): void {
  if (!config.auth_token) return;
  const provided = (args._auth_token as string) || (args._token as string);
  if (provided !== config.auth_token) {
    throw err(-32403, "Authentication failed: invalid or missing token");
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  // --- Adapter registry ---
  const registry = new AdapterRegistry();

  if (config.vault_path) {
    const fsAdapter = new FilesystemAdapter(config.vault_path);
    await fsAdapter.init();
    registry.register(fsAdapter);
  }

  // Optional adapters -- init gracefully, don't block if unavailable
  const enabledAdapters = new Set(config.adapters ?? ["filesystem", "memu", "gitnexus", "obsidian", "kanban", "qmd", "lightrag", "raganything", "vaultbrain", "graphify"]);

  if (enabledAdapters.has("memu")) {
    const memuAdapter = new MemUAdapter();
    await memuAdapter.init();
    if (memuAdapter.isAvailable) registry.register(memuAdapter);
  }

  if (enabledAdapters.has("gitnexus")) {
    const gnAdapter = new GitNexusAdapter();
    await gnAdapter.init();
    if (gnAdapter.isAvailable) registry.register(gnAdapter);
  }

  if (enabledAdapters.has("obsidian")) {
    const obsAdapter = new ObsidianAdapter();
    await obsAdapter.init();
    if (obsAdapter.isAvailable) registry.register(obsAdapter);
  }

  if (enabledAdapters.has("kanban")) {
    const kanbanAdapter = new KanbanAdapter({
      vaultPath: config.vault_path,
      glob: process.env.VAULT_MIND_KANBAN_GLOB,
    });
    await kanbanAdapter.init();
    if (kanbanAdapter.isAvailable) {
      registry.register(kanbanAdapter);
      process.stderr.write("obsidian-llm-wiki: [kanban] adapter ready\n");
    }
  }

  if (enabledAdapters.has("qmd")) {
    const qmdCollection = process.env.VAULT_MIND_QMD_COLLECTION || undefined;
    const qmdAdapter = new QmdAdapter({ collection: qmdCollection });
    await qmdAdapter.init();
    if (qmdAdapter.isAvailable) {
      registry.register(qmdAdapter);
      process.stderr.write("obsidian-llm-wiki: [qmd] adapter ready\n");
    }
  }

  if (enabledAdapters.has("lightrag")) {
    const lightragAdapter = new LightRAGAdapter();
    await lightragAdapter.init();
    if (lightragAdapter.isAvailable) {
      registry.register(lightragAdapter);
      process.stderr.write("obsidian-llm-wiki: [lightrag] adapter ready\n");
    }
  }

  if (enabledAdapters.has("raganything")) {
    const ragAnythingAdapter = new RAGAnythingAdapter();
    await ragAnythingAdapter.init();
    if (ragAnythingAdapter.isAvailable) {
      registry.register(ragAnythingAdapter);
      process.stderr.write("obsidian-llm-wiki: [raganything] adapter ready\n");
    }
  }

  let vaultBrainAdapter: VaultBrainAdapter | null = null;
  if (enabledAdapters.has("vaultbrain")) {
    const vbAdapter = new VaultBrainAdapter();
    try {
      await vbAdapter.init();
      registry.register(vbAdapter);
      vaultBrainAdapter = vbAdapter;
      process.stderr.write("obsidian-llm-wiki: [vaultbrain] adapter ready\n");
    } catch (e) {
      process.stderr.write(`obsidian-llm-wiki: [vaultbrain] init failed (continuing without): ${(e as Error).message}\n`);
    }
  }

  if (enabledAdapters.has("graphify")) {
    const graphifyAdapter = new GraphifyAdapter({ vaultPath: config.vault_path });
    await graphifyAdapter.init();
    if (graphifyAdapter.isAvailable) {
      registry.register(graphifyAdapter);
      process.stderr.write("obsidian-llm-wiki: [graphify] adapter ready\n");
    }
  }

  // --- Compile trigger ---
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const compilerPath = resolve(__dirname, "../../compiler");
  const python = process.env.VAULT_MIND_PYTHON ?? process.env.PYTHON ?? "python";
  const compileTrigger = new CompileTrigger({
    vaultPath: config.vault_path,
    compilerPath,
    python,
    onCompileSuccess: (wikiPaths: string[]) => {
      if (!vaultBrainAdapter) return;
      for (const fullPath of wikiPaths) {
        try {
          const relPath = relative(config.vault_path, fullPath).replace(/\\/g, "/");
          const content = readFileSync(fullPath, "utf-8");
          vaultBrainAdapter.ingest(relPath, content).catch((err: Error) =>
            process.stderr.write(`obsidian-llm-wiki: [vaultbrain] ingest error: ${err.message}\n`)
          );
        } catch { /* ignore */ }
      }
    },
  });

  // Wire Obsidian file events into compile trigger (when Obsidian is running)
  const obsidianAdapter = registry.get("obsidian");
  if (obsidianAdapter?.isAvailable && typeof obsidianAdapter.onFileChange === "function") {
    obsidianAdapter.onFileChange((e) => {
      if (e.type === "create" || e.type === "modify") {
        compileTrigger.onFileChange(e.path, e.type);
        if (vaultBrainAdapter && e.path.endsWith(".md")) {
          try {
            const fullPath = join(config.vault_path, e.path.replace(/\\/g, "/"));
            const content = readFileSync(fullPath, "utf-8");
            vaultBrainAdapter.ingest(e.path, content).catch((err) =>
              process.stderr.write(`obsidian-llm-wiki: [vaultbrain] ingest error: ${(err as Error).message}\n`)
            );
          } catch { /* file may not exist yet */ }
        }
      }
    });
  }

  // Populate dirty set from kb_meta diff (files changed while server was offline)
  await compileTrigger.loadInitialDirty();

  // --- Dispatchers ---
  const vaultFs = new VaultFs(config.vault_path);

  const stderrLogger: Logger = {
    info: (msg) => process.stderr.write(`[INFO] ${msg}\n`),
    warn: (msg) => process.stderr.write(`[WARN] ${msg}\n`),
    error: (msg) => process.stderr.write(`[ERROR] ${msg}\n`),
  };

  // Single source of truth: all tool definitions come from operations
  const allOps = makeAllOperations({
    compileTrigger,
    registry,
    defaultWeights: config.adapter_weights,
    python,
    compilerPath,
    vaultPath: config.vault_path,
    configPath: config.config_path,
  });

  const ctx: OperationContext = {
    vault: vaultFs as VaultExecutor,
    adapters: registry,
    config,
    logger: stderrLogger,
    dryRun: false,
  };

  const ingestMarkdownIntoVaultBrain = (relPath: string): void => {
    if (!vaultBrainAdapter || !relPath.endsWith(".md")) return;
    try {
      const fullPath = join(config.vault_path, relPath.replace(/\\/g, "/"));
      if (!existsSync(fullPath)) return;
      const content = readFileSync(fullPath, "utf-8");
      vaultBrainAdapter.ingest(relPath, content).catch((err) =>
        process.stderr.write(`obsidian-llm-wiki: [vaultbrain] ingest error: ${(err as Error).message}\n`)
      );
    } catch { /* ignore */ }
  };

  const resultPath = (result: unknown): string | undefined => {
    if (typeof result !== "object" || result === null) return undefined;
    const path = (result as { path?: unknown; outputPath?: unknown }).path;
    if (typeof path === "string") return path;
    const outputPath = (result as { outputPath?: unknown }).outputPath;
    return typeof outputPath === "string" ? outputPath : undefined;
  };

  const isRealWrite = (params: Record<string, unknown>): boolean =>
    params.dryRun === false || params.dry_run === false;

  const touchMarkdown = (relPath: unknown, event: "create" | "modify" | "delete"): void => {
    if (typeof relPath !== "string" || !relPath.endsWith(".md")) return;
    compileTrigger.onFileChange(relPath, event);
    if (event !== "delete") ingestMarkdownIntoVaultBrain(relPath);
  };

  const handleWriteSideEffects = (toolName: string, params: Record<string, unknown>, result: unknown): void => {
    if (toolName === "source.register") {
      touchMarkdown(resultPath(result), "create");
      return;
    }

    if (toolName === "vault.rename" && isRealWrite(params)) {
      touchMarkdown(params.from, "delete");
      touchMarkdown(params.to, "create");
      return;
    }

    if (!isRealWrite(params)) return;

    if (toolName === "vault.delete") {
      touchMarkdown(params.path, "delete");
      return;
    }

    if (
      toolName === "vault.create" ||
      toolName === "vault.modify" ||
      toolName === "vault.write" ||
      toolName === "vault.append" ||
      toolName === "vault.writeAIOutput"
    ) {
      touchMarkdown(params.path ?? resultPath(result), toolName === "vault.create" ? "create" : "modify");
      return;
    }

    if (toolName === "multimodal.ingest") {
      touchMarkdown(params.outputPath ?? resultPath(result), "create");
    }
  };

  const server = createMcpServer({
    name: "obsidian-llm-wiki",
    version: VERSION,
    operations: allOps,
    ctx,
    logger: stderrLogger,
    prepareParams: (operation, toolArgs) => {
      checkAuth(config, toolArgs);
      const validatedArgs = validateParams(operation.params, toolArgs);
      enforceCollaborationPolicy(config, operation.name, validatedArgs);
      return validatedArgs;
    },
    afterOperation: (operation, validatedArgs, result) => {
      auditWrite(config, operation.name, validatedArgs, result);
      handleWriteSideEffects(operation.name, validatedArgs, result);
    },
  });

  await startStdioServer(server);

  const adapterNames = registry.list().map((a) => a.name).join(", ");
  process.stderr.write(`obsidian-llm-wiki: MCP server running (stdio, v${VERSION}, adapters: ${adapterNames})\n`);
  process.stderr.write(`obsidian-llm-wiki: try "what do I know about <topic>" to invoke vault-librarian\n`);
}

// Only run main() when invoked as the entrypoint, not on import (e.g. test harness).
// Compare as file:// URLs -- canonical and cross-platform. Path-string comparison
// (fileURLToPath vs resolve) mismatched on Windows (slash/drive-case), so the bundled
// entry (bundle.js) failed the check and silently never started the server.
const _isEntry = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (_isEntry) {
  main().catch((e) => {
    process.stderr.write("obsidian-llm-wiki: fatal: " + (e as Error).message + "\n");
    process.exit(1);
  });
}
