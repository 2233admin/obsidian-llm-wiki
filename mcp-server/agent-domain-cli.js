#!/usr/bin/env node

// dist/agent-domain/cli.js
import { readFileSync as readFileSync9 } from "node:fs";
import { resolve as resolve4 } from "node:path";
import { pathToFileURL } from "node:url";

// dist/core/types.js
var OperationError = class extends Error {
  code;
  data;
  constructor(code, message, options) {
    super(message, { cause: options?.cause });
    this.name = "OperationError";
    this.code = code;
    this.data = options?.data;
  }
};
function isOperationError(value) {
  return value instanceof OperationError || typeof value === "object" && value !== null && typeof value.code === "number" && typeof value.message === "string";
}
function makeErr(code, message, data) {
  return new OperationError(code, message, { data });
}
function badRequest(message, data) {
  return makeErr(-32602, message, data);
}
function notFound(message, data) {
  return makeErr(-32004, message, data);
}
function conflict(message, data) {
  return makeErr(-32010, message, data);
}
function internal(message, data) {
  return makeErr(-32603, message, data);
}

// dist/core/validate.js
var ValidationError = class extends Error {
  code = -32602;
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
};
function validateParams(schema, raw) {
  const result = {};
  for (const [key, def] of Object.entries(schema)) {
    let val = raw[key];
    if (val === void 0 || val === null) {
      if (def.required) {
        throw new ValidationError(`Missing required param: ${key}`);
      }
      if (def.default !== void 0) {
        result[key] = def.default;
      }
      continue;
    }
    const actual = Array.isArray(val) ? "array" : typeof val;
    if (def.type !== "object" && def.type !== "array" && def.type !== "unknown") {
      if (actual !== def.type) {
        if (def.type === "number" && typeof val === "string" && !isNaN(Number(val))) {
          val = Number(val);
        } else if (def.type === "boolean" && typeof val === "string") {
          val = val === "true";
        } else {
          throw new ValidationError(`Param ${key}: expected ${def.type}, got ${actual}`);
        }
      }
    }
    if (def.enum && def.enum.length > 0) {
      if (!def.enum.includes(val)) {
        throw new ValidationError(`Param ${key}: must be one of [${def.enum.join(", ")}], got ${val}`);
      }
    }
    result[key] = val;
  }
  return result;
}

// dist/core/write-policy.js
import { appendFileSync, existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2 } from "node:fs";
import { resolve as resolve2 } from "node:path";

// dist/project/project-context.js
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

// dist/project/workos.js
var STATE_BACKLOG = "backlog";
var STATE_TODO = "todo";
var STATE_IN_PROGRESS = "in-progress";
var STATE_DONE = "done";
var STATE_CANCELED = "canceled";
var STATE_COLUMN = {
  [STATE_BACKLOG]: "Backlog",
  [STATE_TODO]: "Todo",
  [STATE_IN_PROGRESS]: "In Progress",
  [STATE_DONE]: "Done",
  [STATE_CANCELED]: "Canceled"
};
var FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
var KEY_RE = /^[A-Za-z_][\w-]*\s*:/;
var INDENTED_CHILD_RE = /^[ \t]+[A-Za-z_][\w-]*\s*:/;
function splitQuotedList(value) {
  const items = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (const ch of value) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote) {
      current += ch;
      escaped = true;
      continue;
    }
    if (ch === "'" || ch === '"') {
      if (quote === ch)
        quote = null;
      else if (quote === null)
        quote = ch;
      current += ch;
      continue;
    }
    if (ch === "," && quote === null) {
      const item = current.trim();
      if (item)
        items.push(item);
      current = "";
      continue;
    }
    current += ch;
  }
  const last = current.trim();
  if (last)
    items.push(last);
  return items;
}
function stripBracketListComment(value) {
  if (!value.startsWith("["))
    return value;
  const close = value.indexOf("]");
  const hashPos = value.indexOf("#");
  if (close !== -1 && hashPos !== -1 && close < hashPos) {
    return value.slice(0, hashPos).replace(/\s+$/, "");
  }
  return value;
}
function stripQuotes(s) {
  return s.replace(/^['"]+/, "").replace(/['"]+$/, "");
}
function parseFm(text2) {
  const m = FRONTMATTER_RE.exec(text2);
  if (!m)
    return {};
  const fm = m[0];
  const out = {};
  let currentKey = null;
  for (const rawLine of fm.split("\n")) {
    const raw = rawLine.replace(/\r$/, "");
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed === "---")
      continue;
    if (KEY_RE.test(raw)) {
      const idx = raw.indexOf(":");
      const k = raw.slice(0, idx).trim();
      let v = stripBracketListComment(raw.slice(idx + 1).trim());
      if (v.startsWith("[") && v.endsWith("]")) {
        out[k] = splitQuotedList(v.slice(1, -1)).filter((x) => x.trim()).map((x) => stripQuotes(x.trim()));
        currentKey = null;
      } else if (v) {
        out[k] = stripQuotes(v.trim());
        currentKey = null;
      } else {
        out[k] = [];
        currentKey = k;
      }
    } else if (currentKey && raw.replace(/^\s+/, "").startsWith("- ")) {
      const val = stripQuotes(raw.replace(/^\s+/, "").slice(2).trim());
      const lst = out[currentKey];
      if (Array.isArray(lst))
        lst.push(val);
    } else if (currentKey && (raw[0] === " " || raw[0] === "	") && INDENTED_CHILD_RE.test(raw)) {
      const trimmedRaw = raw.replace(/^\s+/, "");
      const cidx = trimmedRaw.indexOf(":");
      const ck = trimmedRaw.slice(0, cidx).trim();
      const cv = stripQuotes(stripBracketListComment(trimmedRaw.slice(cidx + 1).trim()).trim());
      let existing = out[currentKey];
      if (Array.isArray(existing) && existing.length === 0) {
        out[currentKey] = {};
        existing = out[currentKey];
      }
      if (existing && typeof existing === "object" && !Array.isArray(existing)) {
        existing[ck] = cv;
      }
    }
  }
  return out;
}

// dist/project/project-context.js
function normalizedProjectContext(context) {
  return {
    projectId: context.projectId,
    slug: context.slug,
    lifecycle: context.lifecycle,
    aliases: [...context.aliases].sort(),
    roots: {
      registryRecord: context.roots.registryRecord,
      workOs: context.roots.workOs,
      knowledge: context.roots.knowledge,
      runtime: context.roots.runtime
    },
    projections: context.projections.map((projection) => ({ ...projection })),
    resolvedBy: context.resolvedBy
  };
}
var PROJECT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
var PROJECT_ID_RE = /^project\/([a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?)$/;
var FORBIDDEN_SHARED_FIELDS = /* @__PURE__ */ new Set([
  "path",
  "workspace-path",
  "workspace_path",
  "repo-path",
  "repo_path",
  "secret",
  "token",
  "api-key",
  "api_key",
  "credentials"
]);
var SENSITIVE_PROJECTION_KINDS = /* @__PURE__ */ new Set(["secret", "token", "api-key", "api_key", "credential", "credentials"]);
var compatibilityReads = /* @__PURE__ */ new Map();
var compatibilityWindowStartedAt = Date.now();
function recordCompatibilityRead(operation, projectId2) {
  const key = `${operation}\0${projectId2}`;
  compatibilityReads.set(key, (compatibilityReads.get(key) ?? 0) + 1);
}
function isProjectId(value) {
  return typeof value === "string" && PROJECT_ID_RE.test(value);
}
function parseProjectId(value) {
  if (typeof value !== "string")
    throw badRequest("Project ID must be a string in the form project/<slug>");
  const normalized = value.trim();
  if (!PROJECT_ID_RE.test(normalized)) {
    throw badRequest("Project ID must use the canonical form project/<lowercase-kebab-slug>");
  }
  return normalized;
}
function projectIdFromSlug(value) {
  if (typeof value !== "string")
    throw badRequest("Project slug must be a string");
  const slug = value.trim();
  if (!PROJECT_SLUG_RE.test(slug))
    throw badRequest("Project slug must be lowercase kebab-case");
  return `project/${slug}`;
}
function projectSlug(projectId2) {
  return projectId2.slice("project/".length);
}
function normalizeProjectRef(value) {
  if (typeof value === "object" && value !== null) {
    const candidate = value;
    if (candidate.kind !== "id" && candidate.kind !== "name" && candidate.kind !== "workspace") {
      throw badRequest("Project reference kind must be id, name, or workspace");
    }
    if (typeof candidate.value !== "string" || !candidate.value.trim()) {
      throw badRequest("Project reference value is required");
    }
    const normalizedValue2 = candidate.value.trim();
    if (candidate.kind === "id")
      parseProjectId(normalizedValue2);
    if (candidate.kind === "workspace" && !isAbsolute(normalizedValue2)) {
      throw badRequest("Workspace Project references must be absolute paths");
    }
    return { kind: candidate.kind, value: normalizedValue2 };
  }
  if (typeof value !== "string" || !value.trim())
    throw badRequest("Project reference is required");
  const normalizedValue = value.trim();
  if (normalizedValue.startsWith("project/")) {
    parseProjectId(normalizedValue);
    return { kind: "id", value: normalizedValue };
  }
  return { kind: isAbsolute(normalizedValue) ? "workspace" : "name", value: normalizedValue };
}
function scalar(frontmatter, key) {
  const value = frontmatter[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function stringList(value) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const item of values) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized))
      continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
function projectionsOf(value) {
  if (!value)
    return [];
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).filter(([kind, target]) => kind.trim() && target.trim() && !unsafeProjection(kind, target)).sort(([left], [right]) => left.localeCompare(right)).map(([kind, target]) => ({ kind, target }));
  }
  return stringList(value).filter((reference) => !looksAbsolutePath(reference)).map((reference) => {
    const separator = reference.indexOf(":");
    return separator === -1 ? { kind: "reference", target: reference } : { kind: reference.slice(0, separator), target: reference.slice(separator + 1) };
  }).filter((descriptor) => descriptor.kind && descriptor.target && !unsafeProjection(descriptor.kind, descriptor.target)).sort((left, right) => left.kind.localeCompare(right.kind) || left.target.localeCompare(right.target));
}
function looksAbsolutePath(value) {
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
function unsafeProjection(kind, target) {
  return SENSITIVE_PROJECTION_KINDS.has(kind.trim().toLowerCase()) || looksAbsolutePath(target.trim());
}
function normalizeWorkspacePath(value) {
  const trimmed = value.trim();
  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\")) {
    return trimmed.replaceAll("\\", "/").replace(/\/$/, "");
  }
  return resolve(trimmed).replaceAll("\\", "/").replace(/\/$/, "");
}
function workspacePathKey(value) {
  const normalized = normalizeWorkspacePath(value);
  return process.platform === "win32" || /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}
function loadWorkspaceBindings(vaultPath) {
  const bindings = /* @__PURE__ */ new Map();
  const diagnostics = [];
  const relativePath2 = ".vault-mind/local-bindings.json";
  const fullPath2 = join(vaultPath, ".vault-mind", "local-bindings.json");
  if (!existsSync(fullPath2))
    return { bindings, diagnostics };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(fullPath2, "utf-8").replace(/^\uFEFF/, ""));
  } catch {
    diagnostics.push({
      code: "malformed_local_bindings",
      severity: "error",
      message: "Local workspace bindings are unreadable or malformed JSON.",
      path: relativePath2
    });
    return { bindings, diagnostics };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    diagnostics.push({
      code: "malformed_local_bindings",
      severity: "error",
      message: "Local workspace bindings must be a Project ID keyed object.",
      path: relativePath2
    });
    return { bindings, diagnostics };
  }
  for (const [rawProjectRef, rawBinding] of Object.entries(parsed).sort(([left], [right]) => left.localeCompare(right))) {
    let projectId2;
    if (isProjectId(rawProjectRef)) {
      projectId2 = rawProjectRef;
    } else if (PROJECT_SLUG_RE.test(rawProjectRef)) {
      projectId2 = projectIdFromSlug(rawProjectRef);
      diagnostics.push({
        code: "compatibility_binding_identity",
        severity: "warning",
        message: "A local binding uses a legacy bare slug; rewrite it with the canonical Project ID.",
        path: relativePath2,
        projectId: projectId2
      });
    } else {
      diagnostics.push({
        code: "invalid_binding_project_id",
        severity: "error",
        message: "A local binding uses a non-canonical Project ID.",
        path: relativePath2
      });
      continue;
    }
    if (bindings.has(projectId2)) {
      diagnostics.push({
        code: "duplicate_binding_identity",
        severity: "error",
        message: "Multiple local bindings normalize to the same Project ID.",
        path: relativePath2,
        projectId: projectId2
      });
      continue;
    }
    const rawPath = rawBinding && typeof rawBinding === "object" && !Array.isArray(rawBinding) ? rawBinding.path : void 0;
    if (typeof rawPath !== "string" || !rawPath.trim() || !looksAbsolutePath(rawPath.trim())) {
      diagnostics.push({
        code: "invalid_workspace_binding",
        severity: "error",
        message: "A local binding must contain one absolute workspace path.",
        path: relativePath2,
        projectId: projectId2
      });
      continue;
    }
    const normalizedPath = normalizeWorkspacePath(rawPath.trim());
    bindings.set(projectId2, { path: normalizedPath, available: existsSync(normalizedPath) });
  }
  return { bindings, diagnostics };
}
function scanProjectRegistry(vaultPath) {
  const projects = [];
  const diagnostics = [];
  const bindingSnapshot = loadWorkspaceBindings(vaultPath);
  diagnostics.push(...bindingSnapshot.diagnostics);
  const registryRoot = join(vaultPath, "Projects");
  if (!existsSync(registryRoot))
    return { projects, diagnostics };
  const files = readdirSync(registryRoot, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md")).sort((left, right) => left.name.localeCompare(right.name));
  for (const file of files) {
    const registryPath = `Projects/${file.name}`;
    let frontmatter;
    try {
      frontmatter = parseFm(readFileSync(join(registryRoot, file.name), "utf-8"));
    } catch {
      diagnostics.push({
        code: "unreadable_project_record",
        severity: "error",
        message: "A shared Project record could not be read.",
        path: registryPath
      });
      continue;
    }
    const recordType = scalar(frontmatter, "type");
    const rawId = scalar(frontmatter, "entity");
    if (!isProjectId(rawId)) {
      diagnostics.push({
        code: "invalid_project_id",
        severity: "error",
        message: "A shared Project record does not contain a canonical project/<slug> entity.",
        path: registryPath
      });
      continue;
    }
    const slug = projectSlug(rawId);
    if (recordType !== "project") {
      diagnostics.push({
        code: "project_record_type_mismatch",
        severity: "warning",
        message: "A shared Project record is missing type: project or uses a different type.",
        path: registryPath,
        projectId: rawId
      });
    }
    const expectedPath = `Projects/${slug}.md`;
    if (registryPath !== expectedPath) {
      diagnostics.push({
        code: "registry_path_mismatch",
        severity: "warning",
        message: `The shared Project record path does not match its logical slug; expected ${expectedPath}.`,
        path: registryPath,
        projectId: rawId
      });
    }
    for (const key of Object.keys(frontmatter)) {
      if (!FORBIDDEN_SHARED_FIELDS.has(key.toLowerCase()))
        continue;
      diagnostics.push({
        code: "forbidden_registry_field",
        severity: "error",
        message: `Shared Project records must not contain machine paths or secret fields (${key}).`,
        path: registryPath,
        projectId: rawId
      });
    }
    const aliases = [
      ...stringList(frontmatter.aliases),
      ...stringList(frontmatter.alias)
    ].filter((alias, index, all) => all.indexOf(alias) === index).sort();
    const projections = [
      ...projectionsOf(frontmatter["external-projections"]),
      ...projectionsOf(frontmatter.projections)
    ].filter((projection, index, all) => all.findIndex((candidate) => candidate.kind === projection.kind && candidate.target === projection.target) === index).sort((left, right) => left.kind.localeCompare(right.kind) || left.target.localeCompare(right.target));
    projects.push({
      projectId: rawId,
      slug,
      lifecycle: (scalar(frontmatter, "lifecycle") ?? scalar(frontmatter, "status") ?? "unknown").toLowerCase(),
      aliases,
      registryPath,
      workspace: bindingSnapshot.bindings.get(rawId) ?? null,
      projections
    });
  }
  const registeredIds = new Set(projects.map((project) => project.projectId));
  for (const projectId2 of bindingSnapshot.bindings.keys()) {
    if (registeredIds.has(projectId2))
      continue;
    diagnostics.push({
      code: "orphan_workspace_binding",
      severity: "warning",
      message: "A local workspace binding has no matching shared Project record.",
      path: ".vault-mind/local-bindings.json",
      projectId: projectId2
    });
  }
  return { projects, diagnostics };
}
function ambiguity(reference, matches) {
  const candidates = [...new Set(matches.map((match) => match.projectId))].sort();
  throw conflict(`Ambiguous Project reference: ${reference.value}`, { candidates });
}
function contextFromEntry(entry, diagnostics, resolvedBy) {
  const contextDiagnostics = diagnostics.filter((diagnostic) => !diagnostic.projectId || diagnostic.projectId === entry.projectId);
  if (entry.workspace && !entry.workspace.available) {
    contextDiagnostics.push({
      code: "workspace_unavailable",
      severity: "warning",
      message: "The Project is registered, but its local workspace is unavailable on this device.",
      path: ".vault-mind/local-bindings.json",
      projectId: entry.projectId
    });
  }
  return {
    projectId: entry.projectId,
    slug: entry.slug,
    lifecycle: entry.lifecycle,
    aliases: [...entry.aliases],
    roots: {
      registry: "Projects",
      registryRecord: `Projects/${entry.slug}.md`,
      workOs: `01-Projects/${entry.slug}`,
      knowledge: `10-Projects/${entry.slug}`,
      runtime: ".vault-mind"
    },
    workspace: entry.workspace ? { ...entry.workspace } : null,
    projections: entry.projections.map((projection) => ({ ...projection })),
    resolvedBy,
    diagnostics: contextDiagnostics
  };
}
function resolveProjectContext(vaultPath, input, operation = "internal", options = {}) {
  const reference = normalizeProjectRef(input);
  if (reference.kind !== "id" && process.env.LLMWIKI_PROJECT_COMPATIBILITY === "disabled") {
    throw badRequest("Legacy Project references are disabled; use the canonical project/<slug> Project ID");
  }
  const registry2 = scanProjectRegistry(vaultPath);
  let matches = [];
  let resolvedBy;
  if (reference.kind === "id") {
    const projectId2 = parseProjectId(reference.value);
    matches = registry2.projects.filter((project) => project.projectId === projectId2);
    resolvedBy = "project_id";
  } else if (reference.kind === "name") {
    const folded = reference.value.toLowerCase();
    matches = registry2.projects.filter((project) => project.slug.toLowerCase() === folded || project.aliases.some((alias) => alias.toLowerCase() === folded));
    resolvedBy = matches.some((project) => project.slug.toLowerCase() === folded) ? "slug" : "alias";
  } else {
    const normalizedPath = workspacePathKey(reference.value);
    matches = registry2.projects.filter((project) => project.workspace ? workspacePathKey(project.workspace.path) === normalizedPath : false);
    resolvedBy = "workspace_binding";
  }
  if (matches.length > 1)
    ambiguity(reference, matches);
  const entry = matches[0];
  if (!entry)
    throw notFound(`Project not found: ${reference.value}`);
  const diagnostics = [...registry2.diagnostics];
  if (reference.kind === "name") {
    if (options.recordCompatibility !== false)
      recordCompatibilityRead(operation, entry.projectId);
    diagnostics.push({
      code: "compatibility_reference",
      severity: "info",
      message: "A legacy project name or alias was resolved; callers should persist the canonical Project ID.",
      projectId: entry.projectId
    });
  } else if (reference.kind === "workspace") {
    if (options.recordCompatibility !== false)
      recordCompatibilityRead(operation, entry.projectId);
    diagnostics.push({
      code: "workspace_reference",
      severity: "info",
      message: "A machine-local workspace path was resolved to a canonical Project ID.",
      projectId: entry.projectId
    });
  }
  return contextFromEntry(entry, diagnostics, resolvedBy);
}

// dist/core/write-policy.js
var DEFAULT_PROTECTED_PATHS = ["20-Decisions/**", "30-Architecture/**", "40-Runbooks/**", "README.md"];
var DREAMTIME_CADENCE_AUTHORIZED_ROLES = /* @__PURE__ */ new Set(["human", "approver", "admin"]);
var globCache = /* @__PURE__ */ new Map();
function adjudicateOperationWrite(ctx, operation, params, registry2) {
  const verdict = operation.name === "vault.batch" ? adjudicateBatchWrite(ctx, operation, params, registry2) : adjudicateSingleWrite(ctx, operation, params);
  if (verdict.realWrite && verdict.targets.length === 0) {
    throw makeErr(-32602, `Operation Write Policy for ${operation.name} produced no write targets`);
  }
  if (verdict.realWrite) {
    enforceCollaborationPolicy(ctx.config, operation.name, verdict.params, verdict.targets);
  }
  return verdict;
}
function auditOperationWrite(ctx, verdict, result) {
  const actor2 = ctx.config.collaboration?.actor;
  if (!verdict.realWrite || verdict.audit === "none" || !actor2 || ctx.config.collaboration?.enforce === false)
    return;
  try {
    const day = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const auditDir = resolve2(ctx.config.vault_path, ".wiki-audit");
    mkdirSync(auditDir, { recursive: true });
    const auditResult = auditResultForVerdict(verdict, result);
    const entry = {
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      actor: actor2,
      role: ctx.config.collaboration?.role,
      tool: verdict.operation.name,
      targets: verdict.targets.map(normalizePolicyPath),
      ok: auditResult.ok,
      resultPaths: resultPaths(result),
      children: auditResult.children
    };
    appendFileSync(resolve2(auditDir, `${day}.jsonl`), JSON.stringify(entry) + "\n", "utf-8");
  } catch (e) {
    process.stderr.write(`obsidian-llm-wiki: [warn] audit write failed: ${e.message}
`);
  }
}
function dryRunFalse(params) {
  return params.dryRun === false || params.dry_run === false;
}
function resolvedPolicyProject(config, args, operation) {
  if (typeof args.project !== "string" || !args.project.trim()) {
    throw makeErr(-32602, "project required for write policy");
  }
  return resolveProjectContext(config.vault_path, args.project, operation, { recordCompatibility: false }).slug;
}
function workflowPolicyBasePath(config, args, operation) {
  return `01-Projects/${resolvedPolicyProject(config, args, operation)}/workflow`;
}
function workflowAgentPolicyBasePath(config, args, operation) {
  return `01-Projects/${resolvedPolicyProject(config, args, operation)}/agents/${workflowAgentPolicySegment(config, args)}`;
}
function touchMarkdown(path, event) {
  return { type: "touchMarkdown", path, event };
}
function resultPath(result) {
  if (typeof result !== "object" || result === null)
    return void 0;
  const path = result.path;
  if (typeof path === "string")
    return path;
  const outputPath = result.outputPath;
  if (typeof outputPath === "string")
    return outputPath;
  const writtenTo = result.written_to;
  if (typeof writtenTo === "string")
    return writtenTo;
  const written = result.written;
  return typeof written === "string" ? written : void 0;
}
function normalizePolicyPath(path) {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}
function adjudicateSingleWrite(ctx, operation, params) {
  if (!operation.mutating) {
    return { operation, params, realWrite: false, targets: [], audit: "none" };
  }
  const triggerAllowsWrite = operation.writePolicy.realWrite === "always" || dryRunFalse(params);
  const realWrite = triggerAllowsWrite && (operation.writePolicy.shouldWrite?.(ctx, params) ?? true);
  const targets = realWrite ? operation.writePolicy.targets(ctx, params).map(normalizePolicyPath) : [];
  return { operation, params, realWrite, targets, audit: operation.writePolicy.audit };
}
function adjudicateBatchWrite(ctx, operation, params, registry2) {
  if (!Array.isArray(params.operations)) {
    return { operation, params, realWrite: false, targets: [], audit: "none" };
  }
  const children = params.operations.map((item) => {
    if (!item || typeof item !== "object")
      throw makeErr(-32602, "Invalid batch operation");
    const method = item.method;
    if (typeof method !== "string")
      throw makeErr(-32602, "Batch operation method required");
    if (method === "vault.batch")
      throw makeErr(-32602, "Recursive batch not allowed");
    const child = registry2.get(method);
    if (!child)
      throw makeErr(-32602, `Unknown batch operation: ${method}`);
    const rawParams = item.params;
    const childParams = {
      ...rawParams && typeof rawParams === "object" && !Array.isArray(rawParams) ? rawParams : {}
    };
    if (params.dryRun !== void 0 && childParams.dryRun === void 0)
      childParams.dryRun = params.dryRun;
    if (params.dry_run !== void 0 && childParams.dry_run === void 0)
      childParams.dry_run = params.dry_run;
    const validated = validateParams(child.params, childParams);
    return adjudicateOperationWrite(ctx, child, validated, registry2);
  });
  return {
    operation,
    params,
    realWrite: children.some((child) => child.realWrite),
    targets: children.flatMap((child) => child.targets),
    audit: children.some((child) => child.realWrite && child.audit === "required") ? "required" : "none",
    children
  };
}
function enforceCollaborationPolicy(config, toolName, params, targets) {
  const collab = config.collaboration;
  const actor2 = collab?.actor;
  const cadenceTargets = toolName === "dreamtime.cadence.run" ? authorizedDreamTimeCadenceTargets(config, params, targets) : void 0;
  if (!actor2 || collab?.enforce === false || targets.length === 0)
    return;
  const policy = readVaultCollabPolicy(config.vault_path);
  const role = collab?.role || (policy.agents?.includes(actor2) ? "agent" : policy.team?.includes(actor2) ? "human" : "agent");
  const allowed = [
    ...defaultAllowedPaths(actor2, role),
    ...policy.allowed_write_paths ?? [],
    ...collab?.allowed_write_paths ?? []
  ];
  const protectedPaths = [
    ...DEFAULT_PROTECTED_PATHS,
    ...policy.protected_paths ?? [],
    ...collab?.protected_paths ?? []
  ];
  for (const target of targets) {
    const protectedHit = matchAny(target, protectedPaths);
    const allowedHit = settingsOperationAllowsTarget(toolName, target) || cadenceTargets?.has(normalizePolicyPath(target)) === true || governedBackendOperationAllowsTarget(toolName, target) || allowed.length > 0 && matchAny(target, allowed);
    if (protectedHit && !allowedHit) {
      throw makeErr(-32403, `Collaboration policy blocked ${toolName} by ${actor2}: protected path ${target}`);
    }
    if (!allowedHit) {
      throw makeErr(-32403, `Collaboration policy blocked ${toolName} by ${actor2}: ${target} is outside allowed write paths`);
    }
  }
}
function authorizedDreamTimeCadenceTargets(config, params, targets) {
  const actor2 = config.collaboration?.actor?.trim();
  const role = config.collaboration?.role ?? "";
  if (!actor2 || !DREAMTIME_CADENCE_AUTHORIZED_ROLES.has(role)) {
    throw makeErr(-32403, "Collaboration policy blocked dreamtime.cadence.run: authenticated human, approver, or admin required");
  }
  if (typeof params.actor !== "string" || params.actor.trim() !== actor2) {
    throw makeErr(-32403, "Collaboration policy blocked dreamtime.cadence.run: requested actor must match authenticated actor");
  }
  if (typeof params.project !== "string" || !params.project.trim()) {
    throw makeErr(-32602, "project required for write policy");
  }
  const project = resolveProjectContext(config.vault_path, params.project, "dreamtime.cadence.run", { recordCompatibility: false });
  if (params.project !== project.projectId) {
    throw makeErr(-32403, `Collaboration policy blocked dreamtime.cadence.run: canonical Project ID ${project.projectId} required`);
  }
  const allowed = /* @__PURE__ */ new Set([
    "_llmwiki/agent-domain/v1/**",
    "_llmwiki/usage/v1/**",
    `01-Projects/${project.slug}/runs/**`,
    `10-Projects/${project.slug}/agents/**`
  ]);
  const normalizedTargets = targets.map(normalizePolicyPath);
  if (normalizedTargets.length !== allowed.size || new Set(normalizedTargets).size !== allowed.size || normalizedTargets.some((target) => !allowed.has(target))) {
    throw makeErr(-32403, `Collaboration policy blocked dreamtime.cadence.run by ${actor2}: write targets exceed exact Project Context authority`);
  }
  return allowed;
}
function settingsOperationAllowsTarget(toolName, target) {
  if (toolName !== "settings.assignment.set" && toolName !== "settings.assignment.unset")
    return false;
  return /^_llmwiki\/settings\/(?:vault\.json|projects\/[A-Za-z0-9._-]+\.json|(?:user-device|session)\/[A-Za-z0-9._-]+)$/.test(normalizePolicyPath(target));
}
function governedBackendOperationAllowsTarget(toolName, target) {
  const normalized = normalizePolicyPath(target);
  if (toolName === "host.proxy.invoke")
    return normalized === "external/host-capability/**";
  if (toolName === "dreamtime.promotion.handoff") {
    return normalized === "00-Inbox/AI-Output/vault-dreamtime/**";
  }
  if ((/* @__PURE__ */ new Set([
    "dreamtime.checkpoint.propose",
    "dreamtime.learn.propose",
    "dreamtime.review.propose",
    "consult.execute",
    "delegation.plan",
    "delegation.approve"
  ])).has(toolName) && normalized === "_llmwiki/usage/v1/**") {
    return true;
  }
  if ((/* @__PURE__ */ new Set([
    "agent.profile.create",
    "agent.profile.update",
    "agent.binding.create",
    "agent.binding.update",
    "agent.thread.create",
    "agent.thread.append",
    "agent.thread.transition",
    "dreamtime.checkpoint.propose",
    "dreamtime.learn.propose",
    "dreamtime.review.propose",
    "dreamtime.approve",
    "dreamtime.reject",
    "consult.execute",
    "delegation.plan",
    "delegation.approve",
    "delegation.transition",
    "delegation.artifact.project"
  ])).has(toolName)) {
    return normalized === "_llmwiki/agent-domain/v1/**";
  }
  if (!(/* @__PURE__ */ new Set([
    "host.descriptor.register",
    "host.connector.register",
    "host.assignment.plan",
    "host.assignment.approve"
  ])).has(toolName))
    return false;
  return /^_llmwiki\/host-capabilities\/v1\/(?:descriptors|connectors|assignments)(?:\/[A-Za-z0-9._*-]+(?:\.json)?)?$/.test(normalized);
}
function readVaultCollabPolicy(vaultPath) {
  const policyPath = resolve2(vaultPath, ".vault-collab.json");
  if (!existsSync2(policyPath))
    return {};
  try {
    const parsed = JSON.parse(readFileSync2(policyPath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("expected a JSON object");
    return parsed;
  } catch (e) {
    throw makeErr(-32602, `.vault-collab.json invalid: ${e.message}`);
  }
}
function globToRegExp(glob) {
  const cached = globCache.get(glob);
  if (cached)
    return cached;
  let pattern = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    const next = glob[i + 1];
    if (ch === "*" && next === "*") {
      pattern += ".*";
      i += 1;
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
function matchAny(path, patterns) {
  return patterns.some((pattern) => globToRegExp(normalizePolicyPath(pattern)).test(path));
}
function slugPolicySegment(value, label) {
  const segment = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!segment)
    throw makeErr(-32602, `${label} must contain one [a-z0-9] character`);
  return segment;
}
function workflowAgentPolicySegment(config, args) {
  const raw = typeof args.agent === "string" && args.agent.trim() ? args.agent : config.collaboration?.actor || process.env.VAULT_MIND_ACTOR || "agent";
  return slugPolicySegment(raw, "agent");
}
function defaultAllowedPaths(actor2, role) {
  const workflowActor = slugPolicySegment(actor2, "actor");
  if (role === "human")
    return [`00-Inbox/${actor2}`, `00-Inbox/${actor2}/**`];
  return [
    `00-Inbox/AI-Output/${actor2}`,
    `00-Inbox/AI-Output/${actor2}/**`,
    `00-Inbox/Agent-Memory/${actor2}`,
    `00-Inbox/Agent-Memory/${actor2}/**`,
    `10-Projects/*/agents/${actor2}`,
    `10-Projects/*/agents/${actor2}/**`,
    `10-Projects/*/project.md`,
    `Projects/*.md`,
    `.vault-mind/project-migrations/**`,
    `01-Projects/*/_project.md`,
    `01-Projects/*/issues/**`,
    `01-Projects/*/views/**`,
    `01-Projects/*/workflow/**`,
    `01-Projects/*/runs/**`,
    `01-Projects/*/agents/${workflowActor}`,
    `01-Projects/*/agents/${workflowActor}/**`
  ];
}
function auditResultForVerdict(verdict, result) {
  if (!verdict.children)
    return { ok: resultSucceeded(result) };
  const batchResults = Array.isArray(result?.results) ? result.results : [];
  const children = verdict.children.map((child, index) => {
    const childResult = batchResults[index];
    const ok = childResult?.ok === true;
    return {
      tool: child.operation.name,
      ok,
      realWrite: child.realWrite,
      targets: child.targets.map(normalizePolicyPath),
      resultPaths: ok ? resultPaths(childResult?.result) : [],
      error: ok ? void 0 : childResult?.error
    };
  });
  return { ok: children.every((child) => child.ok), children };
}
function resultSucceeded(result) {
  if (typeof result !== "object" || result === null || !("ok" in result))
    return true;
  return result.ok !== false;
}
function resultPaths(result) {
  if (typeof result !== "object" || result === null)
    return [];
  const paths = [
    result.path,
    result.outputPath,
    result.written_to,
    result.written,
    result.eventsPath
  ];
  return paths.filter((path) => typeof path === "string").map(normalizePolicyPath);
}

// dist/control-plane/dispatcher.js
function createOperationDispatcher(operations, context) {
  const registry2 = new Map(operations.map((operation) => [operation.name, operation]));
  return {
    async invoke(name, args = {}) {
      const operation = registry2.get(name);
      if (!operation) {
        throw makeErr(-32601, `Unknown operation: ${name}`);
      }
      assertMutatingOperationIsGoverned(operation);
      const params = asOperationError(() => validateParams(operation.params, args));
      const verdict = asOperationError(() => adjudicateOperationWrite(context, operation, params, registry2));
      const result = await operation.handler(context, params);
      auditOperationWrite(context, verdict, result);
      return result;
    }
  };
}
function assertMutatingOperationIsGoverned(operation) {
  const writePolicy = operation.writePolicy;
  if (operation.mutating && !writePolicy) {
    throw internal(`Mutating operation ${operation.name} is missing an Operation Write Policy`);
  }
}
function asOperationError(action) {
  try {
    return action();
  } catch (error) {
    if (error instanceof ValidationError) {
      throw badRequest(error.message);
    }
    throw error;
  }
}

// dist/agent-domain/operations.js
import { existsSync as existsSync8, readFileSync as readFileSync8, readdirSync as readdirSync5 } from "node:fs";
import { basename as basename5, join as join11 } from "node:path";

// ../packages/agent-domain/dist/src/canonical.js
import { createHash } from "node:crypto";
function canonicalize(value) {
  if (Array.isArray(value))
    return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== void 0).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}
function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}
function canonicalDigest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
function digestTransitionToken(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

// ../packages/agent-domain/dist/src/errors.js
var DomainValidationError = class extends Error {
  path;
  code = "agent-domain-validation";
  constructor(message, path) {
    super(path ? `${message} at ${path}` : message);
    this.path = path;
    this.name = "DomainValidationError";
  }
};
var DomainConflictError = class extends Error {
  details;
  code = "agent-domain-conflict";
  constructor(message, details = {}) {
    super(message);
    this.details = details;
    this.name = "DomainConflictError";
  }
};
var DomainNotFoundError = class extends Error {
  code = "agent-domain-not-found";
  constructor(message) {
    super(message);
    this.name = "DomainNotFoundError";
  }
};
var DomainLockTimeoutError = class extends Error {
  code = "agent-domain-lock-timeout";
  constructor(lockPath, timeoutMs) {
    super(`Timed out after ${timeoutMs}ms waiting for an Agent Domain lock`);
    void lockPath;
    this.name = "DomainLockTimeoutError";
  }
};
var ContextBudgetError = class extends Error {
  mandatoryTokens;
  tokenBudget;
  code = "context-mandatory-budget-exceeded";
  constructor(mandatoryTokens, tokenBudget) {
    super(`Mandatory context requires ${mandatoryTokens} tokens but the budget is ${tokenBudget}`);
    this.mandatoryTokens = mandatoryTokens;
    this.tokenBudget = tokenBudget;
    this.name = "ContextBudgetError";
  }
};
var SimulatedInterruptionError = class extends Error {
  point;
  code = "dreamtime-simulated-interruption";
  constructor(point) {
    super(`Dream Time approval interrupted at ${point}`);
    this.point = point;
    this.name = "SimulatedInterruptionError";
  }
};

// ../packages/agent-domain/dist/src/security.js
var FORBIDDEN_KEYS = /* @__PURE__ */ new Set([
  "secret",
  "secretvalue",
  "secretmaterial",
  "apikey",
  "authorization",
  "authorizationheader",
  "oauthtoken",
  "refreshtoken",
  "accesstoken",
  "leasetoken",
  "handofftoken",
  "credential",
  "credentials",
  "password",
  "privatekey",
  "processid",
  "pid",
  "processhandle",
  "runtimesession",
  "workspacepath",
  "repopath",
  "filepath",
  "directorypath",
  "absolutepath",
  "cwd",
  "homedirectory",
  "environment",
  "headers"
]);
var ABSOLUTE_PATH_PATTERNS = [
  /^(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|file:\/\/|\/(?:[^/\s]+\/)+[^/\s]*)/,
  /(?:^|\s)(?:[A-Za-z]:[\\/]|\\\\[^\\]|\/(?:home|Users|var|tmp|etc|opt)\/|~[\\/])/
];
var SECRET_VALUE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bgh[opusr]_[A-Za-z0-9]{20,}\b/
];
function normalizedKey(value) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}
function assertSafeSharedState(value, label = "record") {
  const visit = (current, path) => {
    if (typeof current === "string") {
      if (ABSOLUTE_PATH_PATTERNS.some((pattern) => pattern.test(current))) {
        throw new DomainValidationError("Machine-local or absolute paths are forbidden in shared Agent Domain state", path);
      }
      if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(current))) {
        throw new DomainValidationError("Secret material is forbidden in shared Agent Domain state", path);
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!current || typeof current !== "object")
      return;
    for (const [key, child] of Object.entries(current)) {
      const childPath = `${path}.${key}`;
      if (FORBIDDEN_KEYS.has(normalizedKey(key))) {
        throw new DomainValidationError(`Forbidden sensitive or device-local field ${key}`, childPath);
      }
      visit(child, childPath);
    }
  };
  visit(value, label);
}
function assertSafeSingleSegment(value, label) {
  if (!value || value !== value.trim() || value === "." || value === ".." || /[\\/]/.test(value)) {
    throw new DomainValidationError(`${label} must be one safe path segment`);
  }
}

// ../packages/agent-domain/dist/src/validation.js
var PROFILE_ID_RE = /^agent\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
var PROJECT_ID_RE2 = /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
var BINDING_ID_RE = /^binding\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
var THREAD_ID_RE = /^thread\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var WORK_RUN_ID_RE = /^work-run\/[a-z0-9][a-z0-9-]*$/;
var ARTIFACT_ID_RE = /^artifact\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var GRANT_REF_RE = /^grant\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var PROPOSAL_ID_RE = /^memory-proposal\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var REVISION_ID_RE = /^memory-revision\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var EVENT_ID_RE = /^memory-event\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var DIGEST_RE = /^sha256:[a-f0-9]{64}$/;
var MEMORY_SCOPES = /* @__PURE__ */ new Set(["recentContext", "openItems", "stableMemory"]);
function fail(message, path) {
  throw new DomainValidationError(message, path);
}
function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("Expected object", path);
  return value;
}
function string(value, path, allowEmpty = false) {
  if (typeof value !== "string" || value !== value.trim() || !allowEmpty && !value)
    fail("Expected non-empty trimmed string", path);
  return value;
}
function exactString(value, path) {
  if (typeof value !== "string")
    fail("Expected string", path);
  return value;
}
function integer(value, path, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum)
    fail(`Expected integer >= ${minimum}`, path);
  return value;
}
function bool(value, path) {
  if (typeof value !== "boolean")
    fail("Expected boolean", path);
  return value;
}
function iso(value, path) {
  const parsed = string(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(parsed) || Number.isNaN(Date.parse(parsed))) {
    fail("Expected UTC ISO-8601 timestamp", path);
  }
  return parsed;
}
function digest(value, path) {
  const parsed = string(value, path);
  if (!DIGEST_RE.test(parsed))
    fail("Expected sha256 digest", path);
  return parsed;
}
function strings(value, path) {
  if (!Array.isArray(value))
    fail("Expected array", path);
  const parsed = value.map((item, index) => string(item, `${path}[${index}]`));
  if (new Set(parsed).size !== parsed.length)
    fail("Duplicate values are not allowed", path);
  return parsed;
}
function allowedKeys(value, allowed, path) {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (extra.length)
    fail(`Unknown fields are not allowed: ${extra.join(", ")}`, path);
}
function versioned(value, path) {
  if (value.schemaVersion !== 1)
    fail("Unsupported schemaVersion", `${path}.schemaVersion`);
  integer(value.revision, `${path}.revision`, 1);
  iso(value.createdAt, `${path}.createdAt`);
  string(value.createdBy, `${path}.createdBy`);
  iso(value.updatedAt, `${path}.updatedAt`);
  string(value.updatedBy, `${path}.updatedBy`);
  if (value.previousRevision !== void 0) {
    const previous = record(value.previousRevision, `${path}.previousRevision`);
    allowedKeys(previous, ["revision", "digest"], `${path}.previousRevision`);
    integer(previous.revision, `${path}.previousRevision.revision`, 1);
    digest(previous.digest, `${path}.previousRevision.digest`);
    if (previous.revision >= value.revision)
      fail("previous revision must be older", `${path}.previousRevision.revision`);
  }
}
function parseAgentProfileId(value, path = "profileId") {
  const parsed = string(value, path);
  if (!PROFILE_ID_RE.test(parsed))
    fail("Agent Profile ID must use agent/<lowercase-kebab-slug>", path);
  return parsed;
}
function parseProjectId2(value, path = "projectId") {
  const parsed = string(value, path);
  if (!PROJECT_ID_RE2.test(parsed))
    fail("Project ID must use project/<lowercase-kebab-slug>", path);
  return parsed;
}
function parseBindingId(value, path = "bindingId") {
  const parsed = string(value, path);
  if (!BINDING_ID_RE.test(parsed))
    fail("Binding ID must use binding/<project-slug>/<agent-slug>", path);
  return parsed;
}
function parseThreadId(value, path = "threadId") {
  const parsed = string(value, path);
  if (!THREAD_ID_RE.test(parsed))
    fail("Thread ID must use thread/<stable-id>", path);
  return parsed;
}
function bindingIdFor(projectId2, profileId) {
  parseProjectId2(projectId2);
  parseAgentProfileId(profileId);
  return `binding/${projectId2.slice("project/".length)}/${profileId.slice("agent/".length)}`;
}
function validateModelLock(value, path) {
  const item = record(value, path);
  allowedKeys(item, ["provider", "model", "contextWindow", "tokenizer", "policyFingerprint"], path);
  string(item.provider, `${path}.provider`);
  string(item.model, `${path}.model`);
  integer(item.contextWindow, `${path}.contextWindow`, 1);
  string(item.tokenizer, `${path}.tokenizer`);
  digest(item.policyFingerprint, `${path}.policyFingerprint`);
  return item;
}
function validateProvenance(value, path) {
  const item = record(value, path);
  allowedKeys(item, ["kind", "id", "revision", "fingerprint"], path);
  const kind = string(item.kind, `${path}.kind`);
  if (!(/* @__PURE__ */ new Set(["governance", "profile", "binding", "memoryRevision", "project", "workItem", "workRun", "thread", "settings", "deviceCapability", "grant", "artifact", "source"])).has(kind)) {
    fail("Invalid provenance kind", `${path}.kind`);
  }
  string(item.id, `${path}.id`);
  if (item.revision !== void 0) {
    if (typeof item.revision === "number")
      integer(item.revision, `${path}.revision`, 0);
    else
      string(item.revision, `${path}.revision`);
  }
  if (item.fingerprint !== void 0)
    digest(item.fingerprint, `${path}.fingerprint`);
  return item;
}
function validateWarning(value, path) {
  const item = record(value, path);
  allowedKeys(item, ["code", "severity", "message", "sourceRef"], path);
  string(item.code, `${path}.code`);
  if (!(/* @__PURE__ */ new Set(["info", "warning", "error"])).has(string(item.severity, `${path}.severity`)))
    fail("Invalid warning severity", `${path}.severity`);
  string(item.message, `${path}.message`);
  if (item.sourceRef !== void 0)
    string(item.sourceRef, `${path}.sourceRef`);
  return item;
}
function validateAgentProfile(value) {
  const item = record(value, "AgentProfile");
  allowedKeys(item, [
    "schemaVersion",
    "profileId",
    "revision",
    "displayName",
    "role",
    "responsibilities",
    "capabilityClaims",
    "constitution",
    "defaultModelPolicy",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy",
    "previousRevision"
  ], "AgentProfile");
  versioned(item, "AgentProfile");
  parseAgentProfileId(item.profileId, "AgentProfile.profileId");
  string(item.displayName, "AgentProfile.displayName");
  string(item.role, "AgentProfile.role");
  strings(item.responsibilities, "AgentProfile.responsibilities");
  strings(item.capabilityClaims, "AgentProfile.capabilityClaims");
  const constitution = record(item.constitution, "AgentProfile.constitution");
  allowedKeys(constitution, ["principles", "instructions"], "AgentProfile.constitution");
  strings(constitution.principles, "AgentProfile.constitution.principles");
  strings(constitution.instructions, "AgentProfile.constitution.instructions");
  const model = record(item.defaultModelPolicy, "AgentProfile.defaultModelPolicy");
  allowedKeys(model, ["mode", "provider", "model", "capabilityClass"], "AgentProfile.defaultModelPolicy");
  if (!(/* @__PURE__ */ new Set(["inherit", "local", "cloud"])).has(string(model.mode, "AgentProfile.defaultModelPolicy.mode"))) {
    fail("Invalid model policy mode", "AgentProfile.defaultModelPolicy.mode");
  }
  for (const key of ["provider", "model", "capabilityClass"]) {
    if (model[key] !== void 0)
      string(model[key], `AgentProfile.defaultModelPolicy.${key}`);
  }
  assertSafeSharedState(item, "AgentProfile");
  return item;
}
function validateProjectAgentBinding(value) {
  const item = record(value, "ProjectAgentBinding");
  allowedKeys(item, [
    "schemaVersion",
    "bindingId",
    "projectId",
    "projectContextFingerprint",
    "profileId",
    "profileRevision",
    "revision",
    "role",
    "enabled",
    "memoryScopes",
    "connectorGrantRefs",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy",
    "previousRevision"
  ], "ProjectAgentBinding");
  versioned(item, "ProjectAgentBinding");
  const projectId2 = parseProjectId2(item.projectId, "ProjectAgentBinding.projectId");
  const profileId = parseAgentProfileId(item.profileId, "ProjectAgentBinding.profileId");
  const bindingId = parseBindingId(item.bindingId, "ProjectAgentBinding.bindingId");
  if (bindingId !== bindingIdFor(projectId2, profileId))
    fail("Binding ID does not match Project/Profile identity", "ProjectAgentBinding.bindingId");
  digest(item.projectContextFingerprint, "ProjectAgentBinding.projectContextFingerprint");
  integer(item.profileRevision, "ProjectAgentBinding.profileRevision", 1);
  string(item.role, "ProjectAgentBinding.role");
  bool(item.enabled, "ProjectAgentBinding.enabled");
  const scopes = strings(item.memoryScopes, "ProjectAgentBinding.memoryScopes");
  for (const scope of scopes)
    if (!MEMORY_SCOPES.has(scope))
      fail("Invalid memory scope", "ProjectAgentBinding.memoryScopes");
  const grants = strings(item.connectorGrantRefs, "ProjectAgentBinding.connectorGrantRefs");
  for (const grant of grants)
    if (!GRANT_REF_RE.test(grant))
      fail("Grant ref must use grant/<stable-id>", "ProjectAgentBinding.connectorGrantRefs");
  assertSafeSharedState(item, "ProjectAgentBinding");
  return item;
}
function validateThread(value) {
  const item = record(value, "Thread");
  allowedKeys(item, [
    "schemaVersion",
    "threadId",
    "revision",
    "durability",
    "lifecycle",
    "projectId",
    "bindingId",
    "bindingRevision",
    "profileId",
    "profileRevision",
    "title",
    "references",
    "createdAt",
    "createdBy",
    "updatedAt",
    "updatedBy",
    "previousRevision"
  ], "Thread");
  versioned(item, "Thread");
  parseThreadId(item.threadId, "Thread.threadId");
  if (item.durability !== "durable")
    fail("Persisted Thread must be durable", "Thread.durability");
  if (!(/* @__PURE__ */ new Set(["open", "closed", "archived"])).has(string(item.lifecycle, "Thread.lifecycle")))
    fail("Invalid Thread lifecycle", "Thread.lifecycle");
  const projectId2 = parseProjectId2(item.projectId, "Thread.projectId");
  const profileId = parseAgentProfileId(item.profileId, "Thread.profileId");
  const bindingId = parseBindingId(item.bindingId, "Thread.bindingId");
  if (bindingId !== bindingIdFor(projectId2, profileId))
    fail("Thread binding does not match Project/Profile", "Thread.bindingId");
  integer(item.bindingRevision, "Thread.bindingRevision", 1);
  integer(item.profileRevision, "Thread.profileRevision", 1);
  string(item.title, "Thread.title");
  if (!Array.isArray(item.references))
    fail("Expected array", "Thread.references");
  item.references.forEach((raw, index) => {
    const ref = record(raw, `Thread.references[${index}]`);
    allowedKeys(ref, ["ordinal", "kind", "referenceId", "recordedAt", "contentHash", "citations"], `Thread.references[${index}]`);
    if (integer(ref.ordinal, `Thread.references[${index}].ordinal`, 1) !== index + 1)
      fail("Thread reference ordinals must be contiguous", `Thread.references[${index}].ordinal`);
    const kind = string(ref.kind, `Thread.references[${index}].kind`);
    if (!(/* @__PURE__ */ new Set(["message", "artifact", "workRun"])).has(kind))
      fail("Invalid Thread reference kind", `Thread.references[${index}].kind`);
    const referenceId = string(ref.referenceId, `Thread.references[${index}].referenceId`);
    if (kind === "artifact" && !ARTIFACT_ID_RE.test(referenceId))
      fail("Artifact reference must use artifact/<stable-id>", `Thread.references[${index}].referenceId`);
    if (kind === "workRun" && !WORK_RUN_ID_RE.test(referenceId))
      fail("Work Run reference must use work-run/<stable-id>", `Thread.references[${index}].referenceId`);
    iso(ref.recordedAt, `Thread.references[${index}].recordedAt`);
    if (ref.contentHash !== void 0)
      digest(ref.contentHash, `Thread.references[${index}].contentHash`);
    strings(ref.citations, `Thread.references[${index}].citations`);
  });
  assertSafeSharedState(item, "Thread");
  return item;
}
function memorySectionHash(section) {
  return canonicalDigest({ content: section.content, citations: section.citations });
}
function makeMemorySection(content = "", citations = []) {
  const material = { content, citations: [...citations] };
  return { ...material, contentHash: memorySectionHash(material) };
}
function validateMemorySection(value, path) {
  const item = record(value, path);
  allowedKeys(item, ["content", "citations", "contentHash"], path);
  const content = exactString(item.content, `${path}.content`);
  const citations = strings(item.citations, `${path}.citations`);
  const contentHash = digest(item.contentHash, `${path}.contentHash`);
  if (contentHash !== memorySectionHash({ content, citations }))
    fail("Memory section content hash mismatch", `${path}.contentHash`);
  return item;
}
function validateDirective(value, path) {
  const item = record(value, path);
  allowedKeys(item, ["directiveId", "kind", "section", "contentHash", "retainUntil", "reason"], path);
  string(item.directiveId, `${path}.directiveId`);
  const kind = string(item.kind, `${path}.kind`);
  if (!(/* @__PURE__ */ new Set(["must-keep", "protected", "retain-until"])).has(kind))
    fail("Invalid protected directive kind", `${path}.kind`);
  const section = string(item.section, `${path}.section`);
  if (!MEMORY_SCOPES.has(section))
    fail("Invalid directive section", `${path}.section`);
  if (item.contentHash !== void 0)
    digest(item.contentHash, `${path}.contentHash`);
  if (kind !== "retain-until" && item.retainUntil !== void 0)
    fail("retainUntil is valid only for retain-until", `${path}.retainUntil`);
  if (kind === "retain-until")
    iso(item.retainUntil, `${path}.retainUntil`);
  string(item.reason, `${path}.reason`);
  return item;
}
function validateConflict(value, path) {
  const item = record(value, path);
  allowedKeys(item, ["conflictId", "section", "reason", "sourceRefs", "resolved"], path);
  string(item.conflictId, `${path}.conflictId`);
  const section = string(item.section, `${path}.section`);
  if (!MEMORY_SCOPES.has(section))
    fail("Invalid conflict section", `${path}.section`);
  string(item.reason, `${path}.reason`);
  strings(item.sourceRefs, `${path}.sourceRefs`);
  if (item.resolved !== false)
    fail("Only unresolved conflicts belong in governed memory", `${path}.resolved`);
  return item;
}
function validateCandidateDiff(value, path) {
  const item = record(value, path);
  allowedKeys(item, ["operation", "section", "beforeHash", "after"], path);
  const operation = string(item.operation, `${path}.operation`);
  if (!(/* @__PURE__ */ new Set(["replace", "remove"])).has(operation))
    fail("Invalid candidate diff operation", `${path}.operation`);
  const section = string(item.section, `${path}.section`);
  if (!MEMORY_SCOPES.has(section))
    fail("Invalid candidate diff section", `${path}.section`);
  if (item.beforeHash !== null)
    digest(item.beforeHash, `${path}.beforeHash`);
  if (operation === "remove" && item.after !== null)
    fail("Remove diff must have null after", `${path}.after`);
  if (operation === "replace" && item.after === null)
    fail("Replace diff requires an after section", `${path}.after`);
  if (item.after !== null)
    validateMemorySection(item.after, `${path}.after`);
  return item;
}
function proposalFingerprintMaterial(proposal) {
  const { fingerprint: _fingerprint, ...material } = proposal;
  return material;
}
function validateMemoryProposal(value) {
  const item = record(value, "MemoryProposal");
  allowedKeys(item, [
    "schemaVersion",
    "proposalId",
    "lifecycle",
    "operation",
    "projectId",
    "profileId",
    "sourceIdentities",
    "expectedRevision",
    "sourceFingerprint",
    "candidateDiff",
    "protectedDirectives",
    "unresolvedConflicts",
    "provenance",
    "warnings",
    "modelLock",
    "approvalPolicy",
    "createdAt",
    "createdBy",
    "expiresAt",
    "fingerprint"
  ], "MemoryProposal");
  if (item.schemaVersion !== 1 || item.lifecycle !== "proposed")
    fail("Memory Proposal must be schema v1 and proposed", "MemoryProposal");
  if (!PROPOSAL_ID_RE.test(string(item.proposalId, "MemoryProposal.proposalId")))
    fail("Invalid proposal ID", "MemoryProposal.proposalId");
  const operation = string(item.operation, "MemoryProposal.operation");
  if (!(/* @__PURE__ */ new Set(["checkpoint", "learn", "review"])).has(operation))
    fail("Invalid Dream Time operation", "MemoryProposal.operation");
  parseProjectId2(item.projectId, "MemoryProposal.projectId");
  parseAgentProfileId(item.profileId, "MemoryProposal.profileId");
  const source = record(item.sourceIdentities, "MemoryProposal.sourceIdentities");
  allowedKeys(source, ["threadId", "workRunId", "revisionIds", "artifactIds", "cutoffAt"], "MemoryProposal.sourceIdentities");
  if (source.threadId !== void 0)
    parseThreadId(source.threadId, "MemoryProposal.sourceIdentities.threadId");
  if (source.workRunId !== void 0 && !WORK_RUN_ID_RE.test(string(source.workRunId, "MemoryProposal.sourceIdentities.workRunId")))
    fail("Invalid Work Run ID", "MemoryProposal.sourceIdentities.workRunId");
  const revisionIds = strings(source.revisionIds, "MemoryProposal.sourceIdentities.revisionIds");
  revisionIds.forEach((id2) => {
    if (!REVISION_ID_RE.test(id2))
      fail("Invalid Memory Revision ID", "MemoryProposal.sourceIdentities.revisionIds");
  });
  const artifactIds = strings(source.artifactIds, "MemoryProposal.sourceIdentities.artifactIds");
  artifactIds.forEach((id2) => {
    if (!ARTIFACT_ID_RE.test(id2))
      fail("Invalid Artifact ID", "MemoryProposal.sourceIdentities.artifactIds");
  });
  if (!source.threadId && !source.workRunId && revisionIds.length === 0 && artifactIds.length === 0)
    fail("Proposal requires at least one source identity", "MemoryProposal.sourceIdentities");
  iso(source.cutoffAt, "MemoryProposal.sourceIdentities.cutoffAt");
  const expected = record(item.expectedRevision, "MemoryProposal.expectedRevision");
  allowedKeys(expected, ["revisionId", "revision", "fingerprint"], "MemoryProposal.expectedRevision");
  const expectedNumber = integer(expected.revision, "MemoryProposal.expectedRevision.revision", 0);
  if (expectedNumber === 0) {
    if (expected.revisionId !== null || expected.fingerprint !== null)
      fail("Revision zero must use null identity and fingerprint", "MemoryProposal.expectedRevision");
  } else {
    if (!REVISION_ID_RE.test(string(expected.revisionId, "MemoryProposal.expectedRevision.revisionId")))
      fail("Invalid expected revision ID", "MemoryProposal.expectedRevision.revisionId");
    digest(expected.fingerprint, "MemoryProposal.expectedRevision.fingerprint");
  }
  digest(item.sourceFingerprint, "MemoryProposal.sourceFingerprint");
  if (!Array.isArray(item.candidateDiff) || item.candidateDiff.length === 0)
    fail("Candidate diff must be non-empty", "MemoryProposal.candidateDiff");
  const diffs = item.candidateDiff.map((diff, index) => validateCandidateDiff(diff, `MemoryProposal.candidateDiff[${index}]`));
  if (new Set(diffs.map((diff) => diff.section)).size !== diffs.length)
    fail("A proposal may mutate each section at most once", "MemoryProposal.candidateDiff");
  const allowedSections = operation === "checkpoint" ? /* @__PURE__ */ new Set(["recentContext", "openItems"]) : /* @__PURE__ */ new Set(["stableMemory"]);
  for (const diff of diffs)
    if (!allowedSections.has(diff.section))
      fail(`${operation} cannot mutate ${diff.section}`, "MemoryProposal.candidateDiff");
  if ((operation === "learn" || operation === "review") && diffs.some((diff) => diff.after && diff.after.citations.length === 0)) {
    fail(`${operation} changes require citations`, "MemoryProposal.candidateDiff");
  }
  if (!Array.isArray(item.protectedDirectives) || !Array.isArray(item.unresolvedConflicts) || !Array.isArray(item.provenance) || !Array.isArray(item.warnings)) {
    fail("Proposal governance collections must be arrays", "MemoryProposal");
  }
  const directives = item.protectedDirectives.map((directive, index) => validateDirective(directive, `MemoryProposal.protectedDirectives[${index}]`));
  const conflicts = item.unresolvedConflicts.map((conflict2, index) => validateConflict(conflict2, `MemoryProposal.unresolvedConflicts[${index}]`));
  if (new Set(directives.map((directive) => directive.directiveId)).size !== directives.length)
    fail("Duplicate protected directive IDs", "MemoryProposal.protectedDirectives");
  if (new Set(conflicts.map((conflict2) => conflict2.conflictId)).size !== conflicts.length)
    fail("Duplicate conflict IDs", "MemoryProposal.unresolvedConflicts");
  item.provenance.forEach((provenance, index) => validateProvenance(provenance, `MemoryProposal.provenance[${index}]`));
  item.warnings.forEach((warning, index) => validateWarning(warning, `MemoryProposal.warnings[${index}]`));
  validateModelLock(item.modelLock, "MemoryProposal.modelLock");
  const policy = record(item.approvalPolicy, "MemoryProposal.approvalPolicy");
  allowedKeys(policy, ["mode", "autoApprovalHook"], "MemoryProposal.approvalPolicy");
  const hook = record(policy.autoApprovalHook, "MemoryProposal.approvalPolicy.autoApprovalHook");
  allowedKeys(hook, ["enabled", "warningFreeOnly", "workingMemoryOnly"], "MemoryProposal.approvalPolicy.autoApprovalHook");
  if (policy.mode !== "manual" || hook.enabled !== false || hook.warningFreeOnly !== true || hook.workingMemoryOnly !== true) {
    fail("Dream Time approval policy must default to manual with disabled safe hook", "MemoryProposal.approvalPolicy");
  }
  const createdAt = iso(item.createdAt, "MemoryProposal.createdAt");
  iso(item.expiresAt, "MemoryProposal.expiresAt");
  if (Date.parse(item.expiresAt) <= Date.parse(createdAt))
    fail("Proposal expiry must follow creation", "MemoryProposal.expiresAt");
  string(item.createdBy, "MemoryProposal.createdBy");
  const fingerprint = digest(item.fingerprint, "MemoryProposal.fingerprint");
  if (fingerprint !== canonicalDigest(proposalFingerprintMaterial(item)))
    fail("Proposal fingerprint mismatch", "MemoryProposal.fingerprint");
  assertSafeSharedState(item, "MemoryProposal");
  return item;
}
function revisionFingerprintMaterial(revision) {
  const { fingerprint: _fingerprint, ...material } = revision;
  return material;
}
function validateMemoryRevision(value) {
  const item = record(value, "MemoryRevision");
  allowedKeys(item, [
    "schemaVersion",
    "revisionId",
    "revision",
    "previousRevisionId",
    "previousFingerprint",
    "projectId",
    "profileId",
    "lifecycle",
    "sections",
    "protectedDirectives",
    "unresolvedConflicts",
    "exactDiff",
    "provenance",
    "approval",
    "createdAt",
    "fingerprint"
  ], "MemoryRevision");
  if (item.schemaVersion !== 1 || item.lifecycle !== "approved")
    fail("Memory Revision must be approved schema v1", "MemoryRevision");
  if (!REVISION_ID_RE.test(string(item.revisionId, "MemoryRevision.revisionId")))
    fail("Invalid revision ID", "MemoryRevision.revisionId");
  const number = integer(item.revision, "MemoryRevision.revision", 1);
  if (number === 1) {
    if (item.previousRevisionId !== null || item.previousFingerprint !== null)
      fail("First revision must have null predecessor", "MemoryRevision");
  } else {
    if (!REVISION_ID_RE.test(string(item.previousRevisionId, "MemoryRevision.previousRevisionId")))
      fail("Invalid predecessor ID", "MemoryRevision.previousRevisionId");
    digest(item.previousFingerprint, "MemoryRevision.previousFingerprint");
  }
  parseProjectId2(item.projectId, "MemoryRevision.projectId");
  parseAgentProfileId(item.profileId, "MemoryRevision.profileId");
  const sections = record(item.sections, "MemoryRevision.sections");
  allowedKeys(sections, ["recentContext", "openItems", "stableMemory"], "MemoryRevision.sections");
  for (const name of MEMORY_SCOPES)
    validateMemorySection(sections[name], `MemoryRevision.sections.${name}`);
  if (!Array.isArray(item.protectedDirectives) || !Array.isArray(item.unresolvedConflicts) || !Array.isArray(item.exactDiff) || !Array.isArray(item.provenance))
    fail("Revision governance collections must be arrays", "MemoryRevision");
  const directives = item.protectedDirectives.map((directive, index) => validateDirective(directive, `MemoryRevision.protectedDirectives[${index}]`));
  const conflicts = item.unresolvedConflicts.map((conflict2, index) => validateConflict(conflict2, `MemoryRevision.unresolvedConflicts[${index}]`));
  if (new Set(directives.map((directive) => directive.directiveId)).size !== directives.length)
    fail("Duplicate protected directive IDs", "MemoryRevision.protectedDirectives");
  if (new Set(conflicts.map((conflict2) => conflict2.conflictId)).size !== conflicts.length)
    fail("Duplicate conflict IDs", "MemoryRevision.unresolvedConflicts");
  item.exactDiff.forEach((diff, index) => validateCandidateDiff(diff, `MemoryRevision.exactDiff[${index}]`));
  item.provenance.forEach((provenance, index) => validateProvenance(provenance, `MemoryRevision.provenance[${index}]`));
  const approval = record(item.approval, "MemoryRevision.approval");
  allowedKeys(approval, ["proposalId", "transitionTokenHash", "actor", "policyVersion", "policyResult"], "MemoryRevision.approval");
  if (!PROPOSAL_ID_RE.test(string(approval.proposalId, "MemoryRevision.approval.proposalId")))
    fail("Invalid proposal ID", "MemoryRevision.approval.proposalId");
  digest(approval.transitionTokenHash, "MemoryRevision.approval.transitionTokenHash");
  string(approval.actor, "MemoryRevision.approval.actor");
  string(approval.policyVersion, "MemoryRevision.approval.policyVersion");
  if (approval.policyResult !== "allowed")
    fail("Approved revision requires allowed policy", "MemoryRevision.approval.policyResult");
  iso(item.createdAt, "MemoryRevision.createdAt");
  const fingerprint = digest(item.fingerprint, "MemoryRevision.fingerprint");
  if (fingerprint !== canonicalDigest(revisionFingerprintMaterial(item)))
    fail("Revision fingerprint mismatch", "MemoryRevision.fingerprint");
  assertSafeSharedState(item, "MemoryRevision");
  return item;
}
function validateMemoryEvent(value) {
  const item = record(value, "MemoryEvent");
  allowedKeys(item, ["schemaVersion", "eventId", "ordinal", "transitionAction", "action", "proposalId", "revisionId", "transitionTokenHash", "actor", "occurredAt", "exactDiff", "provenance", "policyResult"], "MemoryEvent");
  if (item.schemaVersion !== 1 || !EVENT_ID_RE.test(string(item.eventId, "MemoryEvent.eventId")))
    fail("Invalid Memory Event identity", "MemoryEvent");
  integer(item.ordinal, "MemoryEvent.ordinal", 1);
  if (!(/* @__PURE__ */ new Set(["approve", "reject"])).has(string(item.transitionAction, "MemoryEvent.transitionAction")))
    fail("Invalid Memory Event transition action", "MemoryEvent.transitionAction");
  const action = string(item.action, "MemoryEvent.action");
  if (!(/* @__PURE__ */ new Set(["approved", "rejected", "stale", "expired"])).has(action))
    fail("Invalid Memory Event action", "MemoryEvent.action");
  if (action === "approved" && item.transitionAction !== "approve" || action === "rejected" && item.transitionAction !== "reject")
    fail("Memory Event action conflicts with transition action", "MemoryEvent.action");
  if (!PROPOSAL_ID_RE.test(string(item.proposalId, "MemoryEvent.proposalId")))
    fail("Invalid proposal ID", "MemoryEvent.proposalId");
  if (item.revisionId !== null && !REVISION_ID_RE.test(string(item.revisionId, "MemoryEvent.revisionId")))
    fail("Invalid revision ID", "MemoryEvent.revisionId");
  digest(item.transitionTokenHash, "MemoryEvent.transitionTokenHash");
  string(item.actor, "MemoryEvent.actor");
  iso(item.occurredAt, "MemoryEvent.occurredAt");
  if (!Array.isArray(item.exactDiff) || !Array.isArray(item.provenance))
    fail("Event diff/provenance must be arrays", "MemoryEvent");
  item.exactDiff.forEach((diff, index) => validateCandidateDiff(diff, `MemoryEvent.exactDiff[${index}]`));
  item.provenance.forEach((provenance, index) => validateProvenance(provenance, `MemoryEvent.provenance[${index}]`));
  const policy = record(item.policyResult, "MemoryEvent.policyResult");
  allowedKeys(policy, ["allowed", "policyVersion", "reason"], "MemoryEvent.policyResult");
  bool(policy.allowed, "MemoryEvent.policyResult.allowed");
  string(policy.policyVersion, "MemoryEvent.policyResult.policyVersion");
  string(policy.reason, "MemoryEvent.policyResult.reason");
  assertSafeSharedState(item, "MemoryEvent");
  return item;
}
function validateApprovalDecision(value) {
  const item = record(value, "ApprovalDecision");
  allowedKeys(item, ["schemaVersion", "decisionId", "proposalId", "transitionAction", "state", "revisionId", "transitionTokenHash", "actor", "decidedAt", "proposalFingerprint", "policyVersion", "reason"], "ApprovalDecision");
  if (item.schemaVersion !== 1)
    fail("Unsupported decision schema", "ApprovalDecision.schemaVersion");
  string(item.decisionId, "ApprovalDecision.decisionId");
  if (!PROPOSAL_ID_RE.test(string(item.proposalId, "ApprovalDecision.proposalId")))
    fail("Invalid proposal ID", "ApprovalDecision.proposalId");
  if (!(/* @__PURE__ */ new Set(["approve", "reject"])).has(string(item.transitionAction, "ApprovalDecision.transitionAction")))
    fail("Invalid decision transition action", "ApprovalDecision.transitionAction");
  const state = string(item.state, "ApprovalDecision.state");
  if (!(/* @__PURE__ */ new Set(["approved", "rejected", "stale", "expired"])).has(state))
    fail("Invalid decision state", "ApprovalDecision.state");
  if (state === "approved" && item.transitionAction !== "approve" || state === "rejected" && item.transitionAction !== "reject")
    fail("Decision state conflicts with transition action", "ApprovalDecision.state");
  if (item.revisionId !== null && !REVISION_ID_RE.test(string(item.revisionId, "ApprovalDecision.revisionId")))
    fail("Invalid revision ID", "ApprovalDecision.revisionId");
  digest(item.transitionTokenHash, "ApprovalDecision.transitionTokenHash");
  string(item.actor, "ApprovalDecision.actor");
  iso(item.decidedAt, "ApprovalDecision.decidedAt");
  digest(item.proposalFingerprint, "ApprovalDecision.proposalFingerprint");
  string(item.policyVersion, "ApprovalDecision.policyVersion");
  string(item.reason, "ApprovalDecision.reason");
  assertSafeSharedState(item, "ApprovalDecision");
  return item;
}
function validateContextChunk(value, path = "ContextChunk") {
  const item = record(value, path);
  allowedKeys(item, ["chunkId", "content", "provenance", "mandatory", "priority", "tokenCount", "contentHash"], path);
  string(item.chunkId, `${path}.chunkId`);
  if (!Array.isArray(item.provenance))
    fail("Expected provenance array", `${path}.provenance`);
  item.provenance.forEach((provenance, index) => validateProvenance(provenance, `${path}.provenance[${index}]`));
  bool(item.mandatory, `${path}.mandatory`);
  integer(item.priority, `${path}.priority`, 0);
  integer(item.tokenCount, `${path}.tokenCount`, 1);
  const hash = digest(item.contentHash, `${path}.contentHash`);
  if (hash !== canonicalDigest(item.content))
    fail("Context chunk content hash mismatch", `${path}.contentHash`);
  assertSafeSharedState(item.content, `${path}.content`);
  return item;
}
function validateContextLayer(value, path) {
  const item = record(value, path);
  allowedKeys(item, ["name", "provenance", "chunks", "tokenCount", "contentHash"], path);
  const name = string(item.name, `${path}.name`);
  if (!(/* @__PURE__ */ new Set(["platformKernel", "agentConstitution", "governedWorkingMemory", "runtimeEnvelope"])).has(name))
    fail("Invalid context layer", `${path}.name`);
  if (!Array.isArray(item.provenance) || !Array.isArray(item.chunks))
    fail("Layer provenance/chunks must be arrays", path);
  item.provenance.forEach((provenance, index) => validateProvenance(provenance, `${path}.provenance[${index}]`));
  const chunks = item.chunks.map((chunk, index) => validateContextChunk(chunk, `${path}.chunks[${index}]`));
  const tokenCount = integer(item.tokenCount, `${path}.tokenCount`, 0);
  if (tokenCount !== chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0))
    fail("Layer token count mismatch", `${path}.tokenCount`);
  const hash = digest(item.contentHash, `${path}.contentHash`);
  if (hash !== canonicalDigest(chunks))
    fail("Layer content hash mismatch", `${path}.contentHash`);
  return item;
}
function envelopeFingerprintMaterial(envelope) {
  const { fingerprint: _fingerprint, ...material } = envelope;
  return material;
}
function validateContextEnvelope(value) {
  const item = record(value, "ContextEnvelope");
  allowedKeys(item, ["schemaVersion", "envelopeId", "compiledAt", "modelLock", "tokenEstimator", "tokenBudget", "tokenCount", "layers", "omissions", "fingerprint"], "ContextEnvelope");
  if (item.schemaVersion !== 1)
    fail("Unsupported Context Envelope schema", "ContextEnvelope.schemaVersion");
  string(item.envelopeId, "ContextEnvelope.envelopeId");
  iso(item.compiledAt, "ContextEnvelope.compiledAt");
  const modelLock = validateModelLock(item.modelLock, "ContextEnvelope.modelLock");
  if (item.tokenEstimator !== "utf8-bytes-div4/v1")
    fail("Unsupported token estimator", "ContextEnvelope.tokenEstimator");
  const budget = integer(item.tokenBudget, "ContextEnvelope.tokenBudget", 1);
  if (budget > modelLock.contextWindow)
    fail("Context token budget exceeds locked model context window", "ContextEnvelope.tokenBudget");
  const count = integer(item.tokenCount, "ContextEnvelope.tokenCount", 0);
  if (!Array.isArray(item.layers) || item.layers.length !== 4)
    fail("Context Envelope requires exactly four layers", "ContextEnvelope.layers");
  const layers = item.layers.map((layer, index) => validateContextLayer(layer, `ContextEnvelope.layers[${index}]`));
  const names = layers.map((layer) => layer.name);
  if (names.join(",") !== "platformKernel,agentConstitution,governedWorkingMemory,runtimeEnvelope")
    fail("Context layers are out of canonical order", "ContextEnvelope.layers");
  if (count !== layers.reduce((sum, layer) => sum + layer.tokenCount, 0) || count > budget)
    fail("Envelope token accounting mismatch", "ContextEnvelope.tokenCount");
  if (!Array.isArray(item.omissions))
    fail("Context omissions must be an array", "ContextEnvelope.omissions");
  const includedChunkIds = layers.flatMap((layer) => layer.chunks.map((chunk) => chunk.chunkId));
  if (new Set(includedChunkIds).size !== includedChunkIds.length)
    fail("Context chunk IDs must be globally unique", "ContextEnvelope.layers");
  const omittedChunkIds = [];
  item.omissions.forEach((raw, index) => {
    const omission = record(raw, `ContextEnvelope.omissions[${index}]`);
    allowedKeys(omission, ["layer", "chunkId", "reason", "tokenCount", "mandatory"], `ContextEnvelope.omissions[${index}]`);
    if (!(/* @__PURE__ */ new Set(["platformKernel", "agentConstitution", "governedWorkingMemory", "runtimeEnvelope"])).has(string(omission.layer, `ContextEnvelope.omissions[${index}].layer`)))
      fail("Invalid omission layer", `ContextEnvelope.omissions[${index}].layer`);
    string(omission.chunkId, `ContextEnvelope.omissions[${index}].chunkId`);
    omittedChunkIds.push(omission.chunkId);
    if (includedChunkIds.includes(omission.chunkId))
      fail("Omitted context chunk is still present", `ContextEnvelope.omissions[${index}].chunkId`);
    integer(omission.tokenCount, `ContextEnvelope.omissions[${index}].tokenCount`, 1);
    if (omission.reason !== "token-budget" || omission.mandatory !== false)
      fail("Invalid context omission", `ContextEnvelope.omissions[${index}]`);
  });
  if (new Set(omittedChunkIds).size !== omittedChunkIds.length)
    fail("Duplicate context omissions are not allowed", "ContextEnvelope.omissions");
  const fingerprint = digest(item.fingerprint, "ContextEnvelope.fingerprint");
  if (fingerprint !== canonicalDigest(envelopeFingerprintMaterial(item)))
    fail("Context Envelope fingerprint mismatch", "ContextEnvelope.fingerprint");
  assertSafeSharedState(item, "ContextEnvelope");
  return item;
}

// ../packages/agent-domain/dist/src/cadence.js
var DREAM_TIME_CADENCES = ["daily", "weekly", "monthly"];
var OPERATION_BY_CADENCE = {
  daily: "checkpoint",
  weekly: "learn",
  monthly: "review"
};
function resolveDreamTimeCadenceWindow(cadence, asOf) {
  if (!DREAM_TIME_CADENCES.includes(cadence)) {
    throw new DomainValidationError("Dream Time cadence must be daily, weekly, or monthly");
  }
  const instant = canonicalUtcInstant(asOf);
  let startsAt;
  let endsAt;
  let periodKey;
  if (cadence === "daily") {
    startsAt = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
    endsAt = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate() + 1));
    periodKey = startsAt.toISOString().slice(0, 10);
  } else if (cadence === "weekly") {
    const daysSinceMonday = (instant.getUTCDay() + 6) % 7;
    startsAt = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate() - daysSinceMonday));
    endsAt = new Date(Date.UTC(startsAt.getUTCFullYear(), startsAt.getUTCMonth(), startsAt.getUTCDate() + 7));
    periodKey = startsAt.toISOString().slice(0, 10);
  } else {
    startsAt = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), 1));
    endsAt = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth() + 1, 1));
    periodKey = startsAt.toISOString().slice(0, 7);
  }
  return {
    cadence,
    operation: OPERATION_BY_CADENCE[cadence],
    periodKey,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    dueAt: startsAt.toISOString()
  };
}
function dreamTimeCadenceIdentity(projectId2, profileId, window) {
  const project = parseProjectId2(projectId2);
  const profile = parseAgentProfileId(profileId);
  const checked = resolveDreamTimeCadenceWindow(window.cadence, window.startsAt);
  if (checked.periodKey !== window.periodKey || checked.startsAt !== window.startsAt || checked.endsAt !== window.endsAt || checked.dueAt !== window.dueAt || checked.operation !== window.operation) {
    throw new DomainValidationError("Dream Time cadence window does not match its deterministic UTC period");
  }
  const digest3 = canonicalDigest({
    schemaVersion: 1,
    projectId: project,
    profileId: profile,
    cadence: checked.cadence,
    operation: checked.operation,
    periodKey: checked.periodKey,
    startsAt: checked.startsAt,
    endsAt: checked.endsAt
  }).slice("sha256:".length, "sha256:".length + 24);
  const suffix = `${checked.cadence}-${checked.periodKey}-${digest3}`;
  const invocationId = `dreamtime-cadence/${suffix}`;
  return {
    invocationId,
    proposalId: `memory-proposal/cadence-${suffix}`,
    agentId: `dreamtime-${checked.cadence}-${digest3}`,
    transitionToken: `dreamtime-cadence-${suffix}`
  };
}
function canonicalUtcInstant(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainValidationError("asOf must be a canonical UTC RFC3339 timestamp");
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new DomainValidationError("asOf must be a canonical UTC RFC3339 timestamp");
  }
  return new Date(timestamp);
}

// ../packages/agent-domain/dist/src/collaboration.js
import { randomUUID as randomUUID2 } from "node:crypto";
import { dirname as dirname2, join as join3 } from "node:path";
import { mkdir as mkdir2, open as open2, readFile as readFile2, rename as rename2, rm as rm2, stat as stat2 } from "node:fs/promises";

// ../packages/agent-domain/dist/src/locks.js
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, utimes } from "node:fs/promises";
import { dirname, join as join2 } from "node:path";
var DEFAULT_STALE_LOCK_MS = 5 * 6e4;
async function withRecoverableFileLock(options, action) {
  const staleLockMs = options.staleLockMs ?? DEFAULT_STALE_LOCK_MS;
  if (!Number.isFinite(staleLockMs) || staleLockMs < 1)
    throw new DomainValidationError("staleLockMs must be a positive number");
  const owner = {
    schemaVersion: 1,
    ownerId: randomUUID(),
    pid: process.pid,
    acquiredAt: options.now()
  };
  const serializedOwner = `${canonicalJson(owner)}
`;
  await mkdir(dirname(options.lockPath), { recursive: true });
  const deadline = Date.now() + options.timeoutMs;
  while (true) {
    try {
      const handle = await open(options.lockPath, "wx", 384);
      try {
        await handle.writeFile(serializedOwner, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if (error.code !== "EEXIST")
        throw error;
      if (await quarantineStaleLock(options.lockPath, staleLockMs))
        continue;
      if (Date.now() >= deadline)
        throw new DomainLockTimeoutError(options.lockPath, options.timeoutMs);
      await delay(Math.min(options.retryMs, Math.max(1, deadline - Date.now())));
    }
  }
  const heartbeatMs = Math.max(5, Math.floor(staleLockMs / 3));
  const heartbeat = setInterval(() => {
    void heartbeatOwnedLock(options.lockPath, owner.ownerId);
  }, heartbeatMs);
  heartbeat.unref?.();
  try {
    return await action();
  } finally {
    clearInterval(heartbeat);
    await releaseOwnedLock(options.lockPath, owner.ownerId);
  }
}
async function quarantineStaleLock(lockPath, staleLockMs) {
  let lockStat;
  let observed;
  try {
    lockStat = await stat(lockPath);
    if (Date.now() - lockStat.mtimeMs < staleLockMs)
      return false;
    observed = await readFile(lockPath, "utf8");
    if (ownerProcessIsAlive(observed))
      return false;
  } catch (error) {
    if (error.code === "ENOENT")
      return true;
    throw error;
  }
  const quarantinePath = join2(dirname(lockPath), `.stale-lock-${randomUUID()}`);
  try {
    await rename(lockPath, quarantinePath);
  } catch (error) {
    if (error.code === "ENOENT")
      return true;
    throw error;
  }
  const claimed = await readFile(quarantinePath, "utf8");
  const claimedStat = await stat(quarantinePath);
  if (claimed !== observed || Date.now() - claimedStat.mtimeMs < staleLockMs || ownerProcessIsAlive(claimed)) {
    try {
      await stat(lockPath);
    } catch (error) {
      if (error.code !== "ENOENT")
        throw error;
      try {
        await rename(quarantinePath, lockPath);
      } catch {
      }
    }
    return false;
  }
  await rm(quarantinePath, { force: true });
  return true;
}
function ownerProcessIsAlive(serializedOwner) {
  let owner;
  try {
    owner = JSON.parse(serializedOwner);
  } catch {
    return true;
  }
  if (!Number.isInteger(owner.pid) || owner.pid <= 0)
    return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    const code = error.code;
    return code === "EPERM";
  }
}
async function heartbeatOwnedLock(lockPath, ownerId) {
  try {
    if (await readOwnerId(lockPath) !== ownerId)
      return;
    const now = /* @__PURE__ */ new Date();
    await utimes(lockPath, now, now);
  } catch {
  }
}
async function releaseOwnedLock(lockPath, ownerId) {
  try {
    if (await readOwnerId(lockPath) === ownerId)
      await rm(lockPath, { force: true });
  } catch (error) {
    if (error.code !== "ENOENT")
      throw error;
  }
}
async function readOwnerId(lockPath) {
  const raw = JSON.parse(await readFile(lockPath, "utf8"));
  return typeof raw.ownerId === "string" ? raw.ownerId : null;
}
function delay(ms) {
  return new Promise((resolve5) => setTimeout(resolve5, ms));
}

// ../packages/agent-domain/dist/src/collaboration-validation.js
var DIGEST_RE2 = /^sha256:[a-f0-9]{64}$/;
var PROFILE_ID_RE2 = /^agent\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
var PROJECT_ID_RE3 = /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
var WORK_RUN_ID_RE2 = /^work-run\/[a-z0-9][a-z0-9-]*$/;
var BINDING_ID_RE2 = /^binding\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
var GRANT_ID_RE = /^grant\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var ARTIFACT_ID_RE2 = /^artifact\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var PROJECTION_ID_RE = /^artifact-projection\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var CONSULT_REQUEST_ID_RE = /^context-consult\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var CONSULT_RESULT_ID_RE = /^context-consult-result\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var PLAN_ID_RE = /^delegation-plan\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var ASSIGNMENT_ID_RE = /^assignment-plan\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var DEVICE_SNAPSHOT_ID_RE = /^device-snapshot\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
var SIDE_EFFECT_CLASSES = /* @__PURE__ */ new Set([
  "read-only",
  "local-write",
  "external-write",
  "external-delete",
  "external-execute"
]);
var OUTPUT_CLASSES = /* @__PURE__ */ new Set([
  "run-output",
  "durable-knowledge-candidate",
  "decision-candidate",
  "architecture-candidate",
  "runbook-candidate",
  "external-operation-result",
  "diagnostic"
]);
var DURABLE_OUTPUT_CLASSES = /* @__PURE__ */ new Set([
  "durable-knowledge-candidate",
  "decision-candidate",
  "architecture-candidate",
  "runbook-candidate"
]);
var EXTERNAL_SIDE_EFFECTS = /* @__PURE__ */ new Set([
  "external-write",
  "external-delete",
  "external-execute"
]);
function fail2(message, path) {
  throw new DomainValidationError(message, path);
}
function text(value, path) {
  if (typeof value !== "string" || !value || value !== value.trim())
    fail2("Expected non-empty trimmed string", path);
  return value;
}
function integer2(value, path, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum)
    fail2(`Expected integer >= ${minimum}`, path);
  return value;
}
function iso2(value, path) {
  const parsed = text(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(parsed) || Number.isNaN(Date.parse(parsed))) {
    fail2("Expected UTC ISO-8601 timestamp", path);
  }
  return parsed;
}
function digest2(value, path) {
  const parsed = text(value, path);
  if (!DIGEST_RE2.test(parsed))
    fail2("Expected sha256 digest", path);
  return parsed;
}
function id(value, pattern, path) {
  const parsed = text(value, path);
  if (!pattern.test(parsed))
    fail2("Invalid stable identity", path);
  return parsed;
}
function uniqueStrings(value, path, allowEmpty = true) {
  if (!Array.isArray(value) || !allowEmpty && value.length === 0)
    fail2("Expected array", path);
  const parsed = value.map((item, index) => text(item, `${path}[${index}]`));
  if (new Set(parsed).size !== parsed.length)
    fail2("Duplicate values are not allowed", path);
  return parsed;
}
function validateTimestampOrder(earlier, later, path) {
  if (Date.parse(later) <= Date.parse(earlier))
    fail2("Expiry must be later than creation", path);
}
function validateScope(scope, path) {
  uniqueStrings(scope.connectors, `${path}.connectors`);
  uniqueStrings(scope.operations, `${path}.operations`);
  uniqueStrings(scope.resources, `${path}.resources`);
  if (!Array.isArray(scope.sideEffectClasses))
    fail2("Expected array", `${path}.sideEffectClasses`);
  for (const [index, effect] of scope.sideEffectClasses.entries()) {
    if (!SIDE_EFFECT_CLASSES.has(effect))
      fail2("Unknown side-effect class", `${path}.sideEffectClasses[${index}]`);
  }
  if (new Set(scope.sideEffectClasses).size !== scope.sideEffectClasses.length)
    fail2("Duplicate values are not allowed", `${path}.sideEffectClasses`);
}
function validateAssignment(assignment, path) {
  id(assignment.assignmentPlanId, ASSIGNMENT_ID_RE, `${path}.assignmentPlanId`);
  integer2(assignment.assignmentPlanVersion, `${path}.assignmentPlanVersion`, 1);
  digest2(assignment.assignmentPlanFingerprint, `${path}.assignmentPlanFingerprint`);
  id(assignment.deviceSnapshot.snapshotId, DEVICE_SNAPSHOT_ID_RE, `${path}.deviceSnapshot.snapshotId`);
  text(assignment.deviceSnapshot.deviceId, `${path}.deviceSnapshot.deviceId`);
  integer2(assignment.deviceSnapshot.revision, `${path}.deviceSnapshot.revision`, 1);
  digest2(assignment.deviceSnapshot.fingerprint, `${path}.deviceSnapshot.fingerprint`);
  const capturedAt = iso2(assignment.deviceSnapshot.capturedAt, `${path}.deviceSnapshot.capturedAt`);
  const expiresAt = iso2(assignment.deviceSnapshot.expiresAt, `${path}.deviceSnapshot.expiresAt`);
  validateTimestampOrder(capturedAt, expiresAt, `${path}.deviceSnapshot.expiresAt`);
  id(assignment.profileId, PROFILE_ID_RE2, `${path}.profileId`);
  integer2(assignment.profileRevision, `${path}.profileRevision`, 1);
  id(assignment.bindingId, BINDING_ID_RE2, `${path}.bindingId`);
  integer2(assignment.bindingRevision, `${path}.bindingRevision`, 1);
  digest2(assignment.contextEnvelopeFingerprint, `${path}.contextEnvelopeFingerprint`);
}
function capabilityGrantFingerprintMaterial(grant) {
  const { fingerprint: _fingerprint, ...material } = grant;
  return material;
}
function artifactProjectionFingerprintMaterial(artifact) {
  const { fingerprint: _fingerprint, ...material } = artifact;
  return material;
}
function contextConsultRequestFingerprintMaterial(request) {
  const { fingerprint: _fingerprint, ...material } = request;
  return material;
}
function contextConsultResultFingerprintMaterial(result) {
  const { fingerprint: _fingerprint, ...material } = result;
  return material;
}
function delegationPlanFingerprintMaterial(plan) {
  const { fingerprint: _fingerprint, ...material } = plan;
  return material;
}
function childWorkRunFingerprintMaterial(child) {
  const { fingerprint: _fingerprint, ...material } = child;
  return material;
}
function validateCapabilityGrant(value) {
  assertSafeSharedState(value, "CapabilityGrant");
  if (value.schemaVersion !== 1)
    fail2("Unsupported schemaVersion", "CapabilityGrant.schemaVersion");
  id(value.grantId, GRANT_ID_RE, "CapabilityGrant.grantId");
  id(value.projectId, PROJECT_ID_RE3, "CapabilityGrant.projectId");
  id(value.profileId, PROFILE_ID_RE2, "CapabilityGrant.profileId");
  integer2(value.profileRevision, "CapabilityGrant.profileRevision", 1);
  id(value.workRunId, WORK_RUN_ID_RE2, "CapabilityGrant.workRunId");
  if (value.delegationPlanId !== void 0)
    id(value.delegationPlanId, PLAN_ID_RE, "CapabilityGrant.delegationPlanId");
  validateScope(value.scope, "CapabilityGrant.scope");
  const issuedAt = iso2(value.issuedAt, "CapabilityGrant.issuedAt");
  const expiresAt = iso2(value.expiresAt, "CapabilityGrant.expiresAt");
  validateTimestampOrder(issuedAt, expiresAt, "CapabilityGrant.expiresAt");
  text(value.issuedBy, "CapabilityGrant.issuedBy");
  if (value.policyDecision.allowed !== true)
    fail2("Only an allowed policy decision can issue a grant", "CapabilityGrant.policyDecision.allowed");
  text(value.policyDecision.policyVersion, "CapabilityGrant.policyDecision.policyVersion");
  text(value.policyDecision.reason, "CapabilityGrant.policyDecision.reason");
  iso2(value.policyDecision.decidedAt, "CapabilityGrant.policyDecision.decidedAt");
  text(value.policyDecision.actor, "CapabilityGrant.policyDecision.actor");
  const external = value.scope.sideEffectClasses.filter((effect) => EXTERNAL_SIDE_EFFECTS.has(effect));
  if (external.length > 0) {
    if (value.externalSideEffectApproval.mode !== "per-run" || value.externalSideEffectApproval.approvedWorkRunId !== value.workRunId || !value.externalSideEffectApproval.approvalFingerprint) {
      fail2("External effects require an explicit per-run approval bound to this Work Run", "CapabilityGrant.externalSideEffectApproval");
    }
    digest2(value.externalSideEffectApproval.approvalFingerprint, "CapabilityGrant.externalSideEffectApproval.approvalFingerprint");
    for (const effect of external) {
      if (!value.externalSideEffectApproval.approvedClasses.includes(effect)) {
        fail2("External effect is outside the explicit per-run approval", "CapabilityGrant.externalSideEffectApproval.approvedClasses");
      }
    }
  } else if (value.externalSideEffectApproval.mode !== "none" || value.externalSideEffectApproval.approvedClasses.length !== 0) {
    fail2("A non-external grant cannot claim external approval", "CapabilityGrant.externalSideEffectApproval");
  }
  digest2(value.fingerprint, "CapabilityGrant.fingerprint");
  if (value.fingerprint !== canonicalDigest(capabilityGrantFingerprintMaterial(value)))
    fail2("Capability Grant fingerprint mismatch", "CapabilityGrant.fingerprint");
  return value;
}
function authorizeCapabilityUse(grant, request) {
  validateCapabilityGrant(grant);
  assertSafeSharedState(request, "CapabilityUseRequest");
  const reasons = [];
  if (request.projectId !== grant.projectId)
    reasons.push("project");
  if (request.profileId !== grant.profileId || request.profileRevision !== grant.profileRevision)
    reasons.push("agent-profile-version");
  if (request.workRunId !== grant.workRunId)
    reasons.push("work-run");
  if (!grant.scope.connectors.includes(request.connector))
    reasons.push("connector");
  if (!grant.scope.operations.includes(request.operation))
    reasons.push("operation");
  if (!grant.scope.resources.includes(request.resource))
    reasons.push("resource");
  if (!grant.scope.sideEffectClasses.includes(request.sideEffectClass))
    reasons.push("side-effect-class");
  if (Date.parse(request.attemptedAt) >= Date.parse(grant.expiresAt))
    reasons.push("expired");
  if (EXTERNAL_SIDE_EFFECTS.has(request.sideEffectClass) && (grant.externalSideEffectApproval.mode !== "per-run" || grant.externalSideEffectApproval.approvedWorkRunId !== request.workRunId || !grant.externalSideEffectApproval.approvedClasses.includes(request.sideEffectClass))) {
    reasons.push("per-run-external-approval");
  }
  const allowed = reasons.length === 0;
  return {
    allowed,
    policyVersion: grant.policyDecision.policyVersion,
    reason: allowed ? "Capability use is inside the explicit expiring grant" : `Denied outside grant: ${reasons.join(", ")}`,
    grantId: grant.grantId,
    requestFingerprint: canonicalDigest(request),
    decidedAt: request.attemptedAt
  };
}
function validatePromotionReview(outputClass, review, path) {
  text(review.policyVersion, `${path}.policyVersion`);
  const durable = DURABLE_OUTPUT_CLASSES.has(outputClass);
  if (durable && (!review.required || review.state === "not-required")) {
    fail2("Durable output must enter Promotion Policy independently", path);
  }
  if (!durable && review.required && review.state === "not-required")
    fail2("Required promotion cannot be not-required", path);
  if (!review.required && review.state !== "not-required")
    fail2("Non-required promotion must be not-required", path);
  if (review.state === "candidate-created" && !review.candidateId)
    fail2("Promotion candidate identity is required", `${path}.candidateId`);
}
function validateOperationWriteReview(artifact, review, path) {
  text(review.policyVersion, `${path}.policyVersion`);
  const external = EXTERNAL_SIDE_EFFECTS.has(artifact.sideEffectClass);
  if (artifact.producer.kind === "context-consult" && artifact.sideEffectClass !== "read-only") {
    fail2("Context Consult artifacts are read-only", "ArtifactProjection.sideEffectClass");
  }
  if (external) {
    if (!artifact.operationTarget)
      fail2("External artifact must carry its exact connector, operation, and resource", "ArtifactProjection.operationTarget");
    if (!review.required || review.approvalScope !== "per-run" || review.approvedWorkRunId !== artifact.sourceWorkRunId) {
      fail2("External artifact effects require per-run Operation Write approval", path);
    }
    if (review.state !== "approved" && review.state !== "denied" && review.state !== "approval-required") {
      fail2("Invalid external Operation Write review state", `${path}.state`);
    }
    if (review.state === "approved") {
      if (!review.grantId)
        fail2("Approved external write must cite its per-run grant", `${path}.grantId`);
      digest2(review.decisionFingerprint, `${path}.decisionFingerprint`);
    } else if (review.decisionFingerprint !== void 0) {
      fail2("Only an approved external write may carry a decision fingerprint", `${path}.decisionFingerprint`);
    }
  } else if (review.required || review.state !== "not-required" || review.approvalScope !== "none") {
    fail2("Non-external artifacts must not claim Operation Write approval", path);
  } else if (review.decisionFingerprint !== void 0) {
    fail2("Non-external artifacts must not carry an Operation Write decision fingerprint", `${path}.decisionFingerprint`);
  }
}
function validateOperationTarget(target, path) {
  text(target.connector, `${path}.connector`);
  text(target.operation, `${path}.operation`);
  text(target.resource, `${path}.resource`);
}
function validateArtifactProjection(value) {
  assertSafeSharedState(value, "ArtifactProjection");
  if (value.schemaVersion !== 1)
    fail2("Unsupported schemaVersion", "ArtifactProjection.schemaVersion");
  id(value.projectionId, PROJECTION_ID_RE, "ArtifactProjection.projectionId");
  id(value.artifactId, ARTIFACT_ID_RE2, "ArtifactProjection.artifactId");
  id(value.projectId, PROJECT_ID_RE3, "ArtifactProjection.projectId");
  id(value.producer.profileId, PROFILE_ID_RE2, "ArtifactProjection.producer.profileId");
  integer2(value.producer.profileRevision, "ArtifactProjection.producer.profileRevision", 1);
  id(value.sourceWorkRunId, WORK_RUN_ID_RE2, "ArtifactProjection.sourceWorkRunId");
  if (value.parentWorkRunId !== void 0)
    id(value.parentWorkRunId, WORK_RUN_ID_RE2, "ArtifactProjection.parentWorkRunId");
  digest2(value.contextFingerprint, "ArtifactProjection.contextFingerprint");
  for (const [index, artifactId] of value.inputArtifactIds.entries())
    id(artifactId, ARTIFACT_ID_RE2, `ArtifactProjection.inputArtifactIds[${index}]`);
  if (new Set(value.inputArtifactIds).size !== value.inputArtifactIds.length)
    fail2("Duplicate values are not allowed", "ArtifactProjection.inputArtifactIds");
  digest2(value.contentHash, "ArtifactProjection.contentHash");
  text(value.mediaType, "ArtifactProjection.mediaType");
  if (!OUTPUT_CLASSES.has(value.outputClass))
    fail2("Unknown output class", "ArtifactProjection.outputClass");
  if (!SIDE_EFFECT_CLASSES.has(value.sideEffectClass))
    fail2("Unknown side-effect class", "ArtifactProjection.sideEffectClass");
  if (value.operationTarget !== void 0)
    validateOperationTarget(value.operationTarget, "ArtifactProjection.operationTarget");
  validatePromotionReview(value.outputClass, value.promotionReview, "ArtifactProjection.promotionReview");
  validateOperationWriteReview(value, value.operationWriteReview, "ArtifactProjection.operationWriteReview");
  iso2(value.createdAt, "ArtifactProjection.createdAt");
  digest2(value.fingerprint, "ArtifactProjection.fingerprint");
  if (value.fingerprint !== canonicalDigest(artifactProjectionFingerprintMaterial(value)))
    fail2("Artifact Projection fingerprint mismatch", "ArtifactProjection.fingerprint");
  return value;
}
function validateContextConsultRequest(value) {
  assertSafeSharedState(value, "ContextConsultRequest");
  if (value.schemaVersion !== 1)
    fail2("Unsupported schemaVersion", "ContextConsultRequest.schemaVersion");
  id(value.requestId, CONSULT_REQUEST_ID_RE, "ContextConsultRequest.requestId");
  id(value.projectId, PROJECT_ID_RE3, "ContextConsultRequest.projectId");
  id(value.requestingAgent.profileId, PROFILE_ID_RE2, "ContextConsultRequest.requestingAgent.profileId");
  integer2(value.requestingAgent.profileRevision, "ContextConsultRequest.requestingAgent.profileRevision", 1);
  id(value.requestingAgent.workRunId, WORK_RUN_ID_RE2, "ContextConsultRequest.requestingAgent.workRunId");
  id(value.targetAgent.profileId, PROFILE_ID_RE2, "ContextConsultRequest.targetAgent.profileId");
  integer2(value.targetAgent.profileRevision, "ContextConsultRequest.targetAgent.profileRevision", 1);
  text(value.objective, "ContextConsultRequest.objective");
  if (!Array.isArray(value.requestedSections) || value.requestedSections.length === 0 || new Set(value.requestedSections).size !== value.requestedSections.length) {
    fail2("Consult must request one or more unique memory sections", "ContextConsultRequest.requestedSections");
  }
  id(value.asOf.revisionId, /^memory-revision\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/, "ContextConsultRequest.asOf.revisionId");
  integer2(value.asOf.revision, "ContextConsultRequest.asOf.revision", 1);
  digest2(value.asOf.fingerprint, "ContextConsultRequest.asOf.fingerprint");
  digest2(value.contextFingerprint, "ContextConsultRequest.contextFingerprint");
  id(value.capabilityGrantId, GRANT_ID_RE, "ContextConsultRequest.capabilityGrantId");
  if (value.authorizationDecision.allowed !== true)
    fail2("Consult requires an allowed authorization decision", "ContextConsultRequest.authorizationDecision.allowed");
  const createdAt = iso2(value.createdAt, "ContextConsultRequest.createdAt");
  const expiresAt = iso2(value.expiresAt, "ContextConsultRequest.expiresAt");
  validateTimestampOrder(createdAt, expiresAt, "ContextConsultRequest.expiresAt");
  digest2(value.invocationTokenHash, "ContextConsultRequest.invocationTokenHash");
  digest2(value.fingerprint, "ContextConsultRequest.fingerprint");
  if (value.fingerprint !== canonicalDigest(contextConsultRequestFingerprintMaterial(value)))
    fail2("Context Consult request fingerprint mismatch", "ContextConsultRequest.fingerprint");
  return value;
}
function validateContextConsultResult(value) {
  assertSafeSharedState(value, "ContextConsultResult");
  if (value.schemaVersion !== 1)
    fail2("Unsupported schemaVersion", "ContextConsultResult.schemaVersion");
  id(value.resultId, CONSULT_RESULT_ID_RE, "ContextConsultResult.resultId");
  id(value.requestId, CONSULT_REQUEST_ID_RE, "ContextConsultResult.requestId");
  id(value.projectId, PROJECT_ID_RE3, "ContextConsultResult.projectId");
  id(value.requestingWorkRunId, WORK_RUN_ID_RE2, "ContextConsultResult.requestingWorkRunId");
  validateArtifactProjection(value.artifact);
  if (value.artifact.projectId !== value.projectId || value.artifact.sourceWorkRunId !== value.requestingWorkRunId || value.artifact.producer.kind !== "context-consult") {
    fail2("Consult artifact identity must remain attached to the requesting Work Run", "ContextConsultResult.artifact");
  }
  if (value.consultedRevision.fingerprint !== value.artifact.contextFingerprint)
    fail2("Consult artifact must retain the as-of fingerprint", "ContextConsultResult.artifact.contextFingerprint");
  const isStale = value.observedCurrentRevision.fingerprint !== value.consultedRevision.fingerprint;
  if (value.freshness === "stale" !== isStale || value.staleForCurrentContextOperations !== isStale) {
    fail2("Consult freshness must reflect the observed current revision", "ContextConsultResult.freshness");
  }
  iso2(value.completedAt, "ContextConsultResult.completedAt");
  digest2(value.invocationTokenHash, "ContextConsultResult.invocationTokenHash");
  digest2(value.fingerprint, "ContextConsultResult.fingerprint");
  if (value.fingerprint !== canonicalDigest(contextConsultResultFingerprintMaterial(value)))
    fail2("Context Consult result fingerprint mismatch", "ContextConsultResult.fingerprint");
  return value;
}
function validateDelegationPlan(value) {
  assertSafeSharedState(value, "DelegationPlan");
  if (value.schemaVersion !== 1)
    fail2("Unsupported schemaVersion", "DelegationPlan.schemaVersion");
  id(value.planId, PLAN_ID_RE, "DelegationPlan.planId");
  id(value.projectId, PROJECT_ID_RE3, "DelegationPlan.projectId");
  id(value.parentWorkRunId, WORK_RUN_ID_RE2, "DelegationPlan.parentWorkRunId");
  text(value.objective, "DelegationPlan.objective");
  validateAssignment(value.assignment, "DelegationPlan.assignment");
  for (const [index, artifactId] of value.inputArtifactIds.entries())
    id(artifactId, ARTIFACT_ID_RE2, `DelegationPlan.inputArtifactIds[${index}]`);
  if (new Set(value.inputArtifactIds).size !== value.inputArtifactIds.length)
    fail2("Duplicate values are not allowed", "DelegationPlan.inputArtifactIds");
  validateScope(value.requestedCapabilityScope, "DelegationPlan.requestedCapabilityScope");
  integer2(value.budget.maxInputTokens, "DelegationPlan.budget.maxInputTokens", 1);
  integer2(value.budget.maxOutputTokens, "DelegationPlan.budget.maxOutputTokens", 1);
  integer2(value.budget.maxDurationMs, "DelegationPlan.budget.maxDurationMs", 1);
  text(value.budget.policyVersion, "DelegationPlan.budget.policyVersion");
  if (value.budget.maxCostMinorUnits !== void 0)
    integer2(value.budget.maxCostMinorUnits, "DelegationPlan.budget.maxCostMinorUnits", 0);
  if (value.budget.maxCostMinorUnits === void 0 !== (value.budget.currency === void 0))
    fail2("Cost and currency must be supplied together", "DelegationPlan.budget");
  if (value.budget.currency !== void 0)
    text(value.budget.currency, "DelegationPlan.budget.currency");
  const createdAt = iso2(value.createdAt, "DelegationPlan.createdAt");
  const expiresAt = iso2(value.expiresAt, "DelegationPlan.expiresAt");
  validateTimestampOrder(createdAt, expiresAt, "DelegationPlan.expiresAt");
  if (Date.parse(value.assignment.deviceSnapshot.expiresAt) < Date.parse(value.expiresAt)) {
    fail2("Delegation cannot outlive its locked device snapshot", "DelegationPlan.expiresAt");
  }
  if (!OUTPUT_CLASSES.has(value.expectedOutput.outputClass))
    fail2("Unknown output class", "DelegationPlan.expectedOutput.outputClass");
  text(value.expectedOutput.mediaType, "DelegationPlan.expectedOutput.mediaType");
  integer2(value.expectedOutput.requiredArtifactCount, "DelegationPlan.expectedOutput.requiredArtifactCount", 1);
  uniqueStrings(value.expectedOutput.acceptanceCriteria, "DelegationPlan.expectedOutput.acceptanceCriteria", false);
  if (value.sideEffectPolicy.externalEffectsRequirePerRunApproval !== true)
    fail2("External effects must always require per-run approval", "DelegationPlan.sideEffectPolicy.externalEffectsRequirePerRunApproval");
  const requestedExternal = value.requestedCapabilityScope.sideEffectClasses.filter((effect) => EXTERNAL_SIDE_EFFECTS.has(effect));
  if (canonicalDigest([...requestedExternal].sort()) !== canonicalDigest([...value.sideEffectPolicy.requestedExternalClasses].sort())) {
    fail2("Side-effect policy must enumerate the exact requested external classes", "DelegationPlan.sideEffectPolicy.requestedExternalClasses");
  }
  digest2(value.fingerprint, "DelegationPlan.fingerprint");
  if (value.fingerprint !== canonicalDigest(delegationPlanFingerprintMaterial(value)))
    fail2("Delegation Plan fingerprint mismatch", "DelegationPlan.fingerprint");
  return value;
}
function validateChildWorkRun(value) {
  assertSafeSharedState(value, "ChildWorkRun");
  if (value.schemaVersion !== 1)
    fail2("Unsupported schemaVersion", "ChildWorkRun.schemaVersion");
  id(value.workRunId, WORK_RUN_ID_RE2, "ChildWorkRun.workRunId");
  integer2(value.revision, "ChildWorkRun.revision", 1);
  if (value.previousRevision) {
    if (value.previousRevision.revision !== value.revision - 1)
      fail2("Child predecessor revision must be exact", "ChildWorkRun.previousRevision.revision");
    digest2(value.previousRevision.fingerprint, "ChildWorkRun.previousRevision.fingerprint");
  } else if (value.revision !== 1)
    fail2("Only revision 1 may omit a predecessor", "ChildWorkRun.previousRevision");
  id(value.projectId, PROJECT_ID_RE3, "ChildWorkRun.projectId");
  id(value.parentWorkRunId, WORK_RUN_ID_RE2, "ChildWorkRun.parentWorkRunId");
  id(value.delegationPlanId, PLAN_ID_RE, "ChildWorkRun.delegationPlanId");
  digest2(value.delegationPlanFingerprint, "ChildWorkRun.delegationPlanFingerprint");
  validateAssignment(value.assignment, "ChildWorkRun.assignment");
  validateCapabilityGrant(value.grantSummary);
  if (value.grantSummary.projectId !== value.projectId || value.grantSummary.workRunId !== value.workRunId || value.grantSummary.profileId !== value.assignment.profileId || value.grantSummary.profileRevision !== value.assignment.profileRevision) {
    fail2("Child Work Run must lock the same Project, Agent version, and grant scope", "ChildWorkRun.grantSummary");
  }
  for (const artifact of value.artifacts) {
    validateArtifactProjection(artifact);
    if (artifact.projectId !== value.projectId || artifact.sourceWorkRunId !== value.workRunId || artifact.parentWorkRunId !== value.parentWorkRunId) {
      fail2("Child artifacts must project from this child to its recorded parent", "ChildWorkRun.artifacts");
    }
  }
  if ((value.lifecycle === "failed" || value.lifecycle === "cancelled") && !value.terminalDiagnosticArtifactId) {
    fail2("Failed or cancelled child requires a diagnostic artifact", "ChildWorkRun.terminalDiagnosticArtifactId");
  }
  if (value.parentStateEffect !== "none")
    fail2("Child state cannot infer a parent state transition", "ChildWorkRun.parentStateEffect");
  iso2(value.createdAt, "ChildWorkRun.createdAt");
  iso2(value.updatedAt, "ChildWorkRun.updatedAt");
  digest2(value.fingerprint, "ChildWorkRun.fingerprint");
  if (value.fingerprint !== canonicalDigest(childWorkRunFingerprintMaterial(value)))
    fail2("Child Work Run fingerprint mismatch", "ChildWorkRun.fingerprint");
  return value;
}
function promotionReviewFor(outputClass, policyVersion) {
  return DURABLE_OUTPUT_CLASSES.has(outputClass) ? { required: true, state: "candidate-required", policyVersion } : { required: false, state: "not-required", policyVersion };
}
function operationWriteReviewFor(sideEffectClass, policyVersion, workRunId, grant, operationTarget, attemptedAt) {
  if (!EXTERNAL_SIDE_EFFECTS.has(sideEffectClass)) {
    return { required: false, state: "not-required", policyVersion, approvalScope: "none" };
  }
  const decision = grant && operationTarget && attemptedAt ? authorizeCapabilityUse(grant, {
    projectId: grant.projectId,
    profileId: grant.profileId,
    profileRevision: grant.profileRevision,
    workRunId,
    connector: operationTarget.connector,
    operation: operationTarget.operation,
    resource: operationTarget.resource,
    sideEffectClass,
    attemptedAt
  }) : void 0;
  const approved = decision?.allowed === true;
  return {
    required: true,
    state: approved ? "approved" : "approval-required",
    policyVersion,
    approvalScope: "per-run",
    approvedWorkRunId: workRunId,
    ...grant ? { grantId: grant.grantId } : {},
    ...approved && decision ? { decisionFingerprint: canonicalDigest(decision) } : {}
  };
}
function isExternalSideEffect(value) {
  return EXTERNAL_SIDE_EFFECTS.has(value);
}

// ../packages/agent-domain/dist/src/collaboration.js
function createCapabilityGrant(input) {
  const material = { schemaVersion: 1, ...deepClone(input) };
  return validateCapabilityGrant({
    ...material,
    fingerprint: canonicalDigest(capabilityGrantFingerprintMaterial(material))
  });
}
function createArtifactProjection(input) {
  const { promotionPolicyVersion, operationWritePolicyVersion, grant, projectionId = `artifact-projection/${randomUUID2()}`, artifactId = `artifact/${randomUUID2()}`, ...rest } = deepClone(input);
  const material = {
    schemaVersion: 1,
    projectionId,
    artifactId,
    ...rest,
    promotionReview: promotionReviewFor(rest.outputClass, promotionPolicyVersion),
    operationWriteReview: operationWriteReviewFor(rest.sideEffectClass, operationWritePolicyVersion, rest.sourceWorkRunId, grant, rest.operationTarget, rest.createdAt)
  };
  return validateArtifactProjection({ ...material, fingerprint: canonicalDigest(artifactProjectionFingerprintMaterial(material)) });
}
function createContextConsultRequest(input) {
  const { invocationToken, requestId = `context-consult/${randomUUID2()}`, ...rest } = deepClone(input);
  if (!invocationToken)
    throw new DomainValidationError("Context Consult invocation token is required");
  const material = {
    schemaVersion: 1,
    requestId,
    ...rest,
    invocationTokenHash: digestTransitionToken(invocationToken)
  };
  return validateContextConsultRequest({ ...material, fingerprint: canonicalDigest(contextConsultRequestFingerprintMaterial(material)) });
}
function createDelegationPlan(input) {
  const { planId = `delegation-plan/${randomUUID2()}`, ...rest } = deepClone(input);
  const material = { schemaVersion: 1, planId, ...rest };
  return validateDelegationPlan({ ...material, fingerprint: canonicalDigest(delegationPlanFingerprintMaterial(material)) });
}
var ContextConsultStore = class {
  projectId;
  scopeRoot;
  now;
  lockTimeoutMs;
  lockRetryMs;
  staleLockMs;
  constructor(options) {
    if (!options.collaborationRoot)
      throw new DomainValidationError("collaborationRoot is required");
    if (!/^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(options.projectId))
      throw new DomainValidationError("Invalid Project ID");
    this.projectId = options.projectId;
    this.scopeRoot = join3(options.collaborationRoot, options.projectId.slice("project/".length), "consults");
    this.now = options.clock ?? (() => (/* @__PURE__ */ new Date()).toISOString());
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5e3;
    this.lockRetryMs = options.lockRetryMs ?? 15;
    this.staleLockMs = options.staleLockMs;
  }
  async execute(input) {
    const request = validateContextConsultRequest(deepClone(input.request));
    const grant = validateCapabilityGrant(deepClone(input.grant));
    if (request.projectId !== this.projectId)
      throw new DomainConflictError("Context Consult is outside this Project scope");
    if (request.invocationTokenHash !== digestTransitionToken(input.invocationToken))
      throw new DomainConflictError("Context Consult invocation token does not match request");
    if (request.capabilityGrantId !== grant.grantId)
      throw new DomainConflictError("Context Consult grant identity mismatch");
    const resource = consultResource(request);
    const useDecision = authorizeCapabilityUse(grant, {
      projectId: request.projectId,
      profileId: request.requestingAgent.profileId,
      profileRevision: request.requestingAgent.profileRevision,
      workRunId: request.requestingAgent.workRunId,
      connector: "agent-memory",
      operation: "context.consult",
      resource,
      sideEffectClass: "read-only",
      attemptedAt: this.now()
    });
    if (!useDecision.allowed)
      throw new DomainConflictError("Context Consult denied by Capability Grant", { policyResult: useDecision });
    if (Date.parse(this.now()) >= Date.parse(request.expiresAt))
      throw new DomainConflictError("Context Consult request expired");
    const existing = await this.readByInvocationToken(request.invocationTokenHash);
    if (existing) {
      await this.assertReplayMatches(request, existing);
      return { idempotent: true, result: existing };
    }
    return this.withLock(async () => {
      const replay = await this.readByInvocationToken(request.invocationTokenHash);
      if (replay) {
        await this.assertReplayMatches(request, replay);
        return { idempotent: true, result: replay };
      }
      const asOfMemory = await input.targetMemory.readApprovedRevision(deepFreeze(deepClone(request.asOf)));
      assertConsultRevision(request, asOfMemory);
      const workerInput = {
        requestId: request.requestId,
        projectId: request.projectId,
        objective: request.objective,
        targetAgent: deepClone(request.targetAgent),
        asOf: deepClone(request.asOf),
        contextFingerprint: request.contextFingerprint,
        sections: Object.fromEntries(request.requestedSections.map((section) => [section, deepClone(asOfMemory.sections[section])])),
        inputArtifactIds: [...input.inputArtifactIds ?? []]
      };
      const output = deepClone(await input.worker.generate(deepFreeze(deepClone(workerInput))));
      assertSafeSharedState(output, "ContextConsultWorkerOutput");
      const observed = await input.targetMemory.readCurrentApprovedRevision();
      assertMemoryIdentity(observed, request.projectId, request.targetAgent.profileId);
      const observedLock = memoryLock(observed);
      const stale = observedLock.fingerprint !== request.asOf.fingerprint;
      const completedAt = this.now();
      const warnings = [
        ...output.warnings ?? [],
        ...stale ? [{
          code: "consult-target-advanced",
          severity: "warning",
          message: "Target memory advanced during generation; current-context operations must re-consult."
        }] : []
      ];
      const artifact = createArtifactProjection({
        projectionId: `artifact-projection/consult-${stableSuffix(request.requestId)}`,
        artifactId: `artifact/consult-${stableSuffix(request.requestId)}`,
        projectId: request.projectId,
        producer: { kind: "context-consult", ...request.targetAgent },
        sourceWorkRunId: request.requestingAgent.workRunId,
        contextFingerprint: request.asOf.fingerprint,
        inputArtifactIds: [...workerInput.inputArtifactIds],
        contentHash: canonicalDigest(output.content),
        mediaType: output.mediaType,
        outputClass: output.outputClass,
        sideEffectClass: "read-only",
        provenance: dedupeProvenance([
          ...request.provenance,
          { kind: "memoryRevision", id: request.asOf.revisionId, revision: request.asOf.revision, fingerprint: request.asOf.fingerprint },
          ...output.provenance
        ]),
        warnings,
        createdAt: completedAt,
        promotionPolicyVersion: "promotion-policy/v1",
        operationWritePolicyVersion: "operation-write-policy/v1"
      });
      const resultMaterial = {
        schemaVersion: 1,
        resultId: `context-consult-result/${stableSuffix(request.requestId)}`,
        requestId: request.requestId,
        projectId: request.projectId,
        requestingWorkRunId: request.requestingAgent.workRunId,
        targetAgent: deepClone(request.targetAgent),
        consultedRevision: deepClone(request.asOf),
        observedCurrentRevision: observedLock,
        freshness: stale ? "stale" : "current",
        staleForCurrentContextOperations: stale,
        provenance: artifact.provenance,
        warnings,
        artifact,
        completedAt,
        invocationTokenHash: request.invocationTokenHash
      };
      const result = validateContextConsultResult({
        ...resultMaterial,
        fingerprint: canonicalDigest(contextConsultResultFingerprintMaterial(resultMaterial))
      });
      await writeIfAbsentOrSame(this.requestPath(request.requestId), request);
      await writeIfAbsentOrSame(this.resultPath(request.invocationTokenHash), result);
      return { idempotent: false, result: deepClone(result) };
    });
  }
  async readByInvocationToken(invocationTokenHash) {
    ensureDigest(invocationTokenHash, "invocationTokenHash");
    return readValidated(this.resultPath(invocationTokenHash), validateContextConsultResult);
  }
  resultPath(tokenHash) {
    return join3(this.scopeRoot, "results", digestSuffix(tokenHash), "result.json");
  }
  requestPath(requestId) {
    return join3(this.scopeRoot, "requests", stableSuffix(requestId), "request.json");
  }
  async assertReplayMatches(request, result) {
    if (result.requestId !== request.requestId) {
      throw new DomainConflictError("Invocation token was already used for another Context Consult");
    }
    const committed = await readValidated(this.requestPath(result.requestId), validateContextConsultRequest);
    if (!committed || committed.fingerprint !== request.fingerprint) {
      throw new DomainConflictError("Invocation token replay changed Context Consult request semantics");
    }
  }
  withLock(action) {
    return withRecoverableFileLock({
      lockPath: join3(this.scopeRoot, ".lock"),
      now: this.now,
      timeoutMs: this.lockTimeoutMs,
      retryMs: this.lockRetryMs,
      staleLockMs: this.staleLockMs
    }, action);
  }
};
var DelegationStore = class {
  projectId;
  scopeRoot;
  now;
  lockTimeoutMs;
  lockRetryMs;
  staleLockMs;
  faultInjector;
  constructor(options) {
    if (!options.collaborationRoot)
      throw new DomainValidationError("collaborationRoot is required");
    if (!/^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(options.projectId))
      throw new DomainValidationError("Invalid Project ID");
    this.projectId = options.projectId;
    this.scopeRoot = join3(options.collaborationRoot, options.projectId.slice("project/".length), "delegations");
    this.now = options.clock ?? (() => (/* @__PURE__ */ new Date()).toISOString());
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5e3;
    this.lockRetryMs = options.lockRetryMs ?? 15;
    this.staleLockMs = options.staleLockMs;
    this.faultInjector = options.faultInjector;
  }
  async createPlan(rawPlan) {
    const plan = validateDelegationPlan(deepClone(rawPlan));
    if (plan.projectId !== this.projectId)
      throw new DomainConflictError("Delegation Plan is outside this Project scope");
    await this.withLock(() => writeIfAbsentOrSame(this.planPath(plan.planId), plan));
    return deepClone(plan);
  }
  async readPlan(planId) {
    assertSafeSingleSegment(stableSuffix(planId), "Delegation Plan ID");
    return readValidated(this.planPath(planId), validateDelegationPlan);
  }
  async approve(request) {
    if (!request.transitionToken)
      throw new DomainValidationError("Delegation approval transition token is required");
    const tokenHash = digestTransitionToken(request.transitionToken);
    return this.withLock(async () => {
      const plan = await this.readPlan(request.planId);
      if (!plan)
        throw new DomainNotFoundError(`Delegation Plan ${request.planId} does not exist`);
      const tokenReceipt = await this.readDelegationReceipt(tokenHash);
      const planDecision = await this.readPlanDecision(plan.planId);
      if (tokenReceipt)
        return this.recoverDelegation(tokenReceipt, request, plan);
      if (planDecision) {
        if (planDecision.transitionTokenHash !== tokenHash) {
          throw new DomainConflictError("Delegation Plan was already approved with another transition token", { childWorkRunId: planDecision.childWorkRunId });
        }
        return this.recoverDelegation(planDecision, request, plan);
      }
      if (plan.fingerprint !== request.presentedFingerprint)
        throw new DomainConflictError("Delegation Plan fingerprint changed before approval");
      if (Date.parse(this.now()) >= Date.parse(plan.expiresAt))
        throw new DomainConflictError("Delegation Plan expired");
      const policy = deepClone(await request.authorize(deepFreeze(deepClone(plan))));
      if (!policy.allowed || policy.actor !== request.actor)
        throw new DomainConflictError("Delegation approval authorization denied or actor mismatched");
      const requestedExternal = plan.sideEffectPolicy.requestedExternalClasses;
      const approvedExternal = [...new Set(request.approvedExternalClasses)].sort();
      if (canonicalDigest([...requestedExternal].sort()) !== canonicalDigest(approvedExternal)) {
        throw new DomainConflictError("External side effects require explicit approval of the exact per-run classes", {
          requestedExternal,
          approvedExternal
        });
      }
      const suffix = digestSuffix(canonicalDigest({ planId: plan.planId, fingerprint: plan.fingerprint }));
      const workRunId = `work-run/child-${suffix.slice(0, 24)}`;
      const grantId = `grant/child-${suffix.slice(0, 24)}`;
      const issuedAt = this.now();
      const outcome = this.delegationOutcome(plan, {
        actor: request.actor,
        approvedExternal,
        policy,
        issuedAt,
        workRunId,
        grantId
      });
      const receipt = {
        schemaVersion: 1,
        kind: "delegation-approval",
        planId: plan.planId,
        planFingerprint: plan.fingerprint,
        transitionTokenHash: tokenHash,
        childWorkRunId: workRunId,
        childRevision: 1,
        grantId,
        actor: request.actor,
        requestFingerprint: delegationApprovalRequestFingerprint(request),
        approvedExternalClasses: approvedExternal,
        policyDecision: policy,
        issuedAt,
        grantFingerprint: outcome.grant.fingerprint,
        childFingerprint: outcome.child.fingerprint
      };
      await writeIfAbsentOrSame(this.planDecisionPath(plan.planId), receipt);
      await this.injectFault("after-delegation-intent");
      await writeIfAbsentOrSame(this.delegationReceiptPath(tokenHash), receipt);
      await this.injectFault("after-delegation-receipt");
      await writeIfAbsentOrSame(this.grantPath(outcome.grant.grantId), outcome.grant);
      await this.injectFault("after-delegation-grant");
      await writeIfAbsentOrSame(this.childRevisionPath(workRunId, 1), outcome.child);
      return { idempotent: false, child: deepClone(outcome.child), grant: deepClone(outcome.grant) };
    });
  }
  delegationOutcome(plan, input) {
    const { actor: actor2, approvedExternal, policy, issuedAt, workRunId, grantId } = input;
    const requestedExternal = plan.sideEffectPolicy.requestedExternalClasses;
    const approvalFingerprint = canonicalDigest({
      planId: plan.planId,
      planFingerprint: plan.fingerprint,
      workRunId,
      actor: actor2,
      policyVersion: policy.policyVersion,
      approvedExternal
    });
    const grant = createCapabilityGrant({
      grantId,
      projectId: plan.projectId,
      profileId: plan.assignment.profileId,
      profileRevision: plan.assignment.profileRevision,
      workRunId,
      delegationPlanId: plan.planId,
      scope: deepClone(plan.requestedCapabilityScope),
      issuedAt,
      expiresAt: plan.expiresAt,
      issuedBy: actor2,
      policyDecision: policy,
      externalSideEffectApproval: requestedExternal.length > 0 ? {
        mode: "per-run",
        approvedClasses: approvedExternal,
        approvedWorkRunId: workRunId,
        approvalFingerprint
      } : { mode: "none", approvedClasses: [] }
    });
    const childMaterial = {
      schemaVersion: 1,
      workRunId,
      revision: 1,
      projectId: plan.projectId,
      parentWorkRunId: plan.parentWorkRunId,
      delegationPlanId: plan.planId,
      delegationPlanFingerprint: plan.fingerprint,
      lifecycle: "ready",
      assignment: deepClone(plan.assignment),
      expectedOutput: deepClone(plan.expectedOutput),
      inputArtifactIds: [...plan.inputArtifactIds],
      grantSummary: grant,
      artifacts: [],
      parentStateEffect: "none",
      createdAt: issuedAt,
      createdBy: actor2,
      updatedAt: issuedAt,
      updatedBy: actor2
    };
    const child = validateChildWorkRun({
      ...childMaterial,
      fingerprint: canonicalDigest(childWorkRunFingerprintMaterial(childMaterial))
    });
    return { child, grant };
  }
  async readChild(workRunId) {
    const revisions = await this.readChildChain(workRunId);
    return revisions.length === 0 ? null : deepClone(revisions.at(-1));
  }
  async readGrant(grantId) {
    const grant = await readJson(this.grantPath(grantId));
    return grant ? deepClone(validateCapabilityGrant(grant)) : null;
  }
  async readChildChain(workRunId) {
    const revisions = await this.childRevisionNumbers(workRunId);
    for (let index = 0; index < revisions.length; index += 1) {
      if (revisions[index] !== index + 1) {
        throw new DomainConflictError("Child Work Run revision history is not contiguous", { workRunId, revisions });
      }
    }
    const chain = [];
    for (const revision of revisions) {
      const child = await readValidated(this.childRevisionPath(workRunId, revision), validateChildWorkRun);
      if (!child)
        throw new DomainConflictError("Child Work Run revision disappeared while reading its chain", { workRunId, revision });
      if (child.workRunId !== workRunId || child.revision !== revision) {
        throw new DomainConflictError("Child Work Run revision identity does not match its immutable path", { workRunId, revision });
      }
      const previous = chain.at(-1);
      if (!previous) {
        if (child.previousRevision !== void 0)
          throw new DomainConflictError("Child Work Run revision 1 must not claim a predecessor");
      } else {
        if (child.previousRevision?.revision !== previous.revision || child.previousRevision.fingerprint !== previous.fingerprint) {
          throw new DomainConflictError("Child Work Run predecessor fingerprint lock mismatch", {
            workRunId,
            revision,
            expectedPreviousRevision: previous.revision,
            expectedPreviousFingerprint: previous.fingerprint
          });
        }
        if (childImmutableFingerprint(child) !== childImmutableFingerprint(previous)) {
          throw new DomainConflictError("Child Work Run immutable identity changed across revisions", { workRunId, revision });
        }
      }
      chain.push(child);
    }
    return chain;
  }
  async projectArtifact(workRunId, request) {
    const tokenHash = digestTransitionToken(request.transitionToken);
    return this.withLock(async () => {
      const artifact = validateArtifactProjection(deepClone(request.artifact));
      const semantics = {
        kind: "artifact-projection",
        childWorkRunId: workRunId,
        expectedRevision: request.expectedRevision,
        actor: request.actor,
        artifact
      };
      const requestFingerprint = canonicalDigest(semantics);
      const replay = await this.readChildReceipt(tokenHash);
      if (replay)
        return this.childReplay(replay, workRunId, tokenHash, requestFingerprint);
      await this.recoverNextChildIntent(workRunId);
      const recoveredReplay = await this.readChildReceipt(tokenHash);
      if (recoveredReplay)
        return this.childReplay(recoveredReplay, workRunId, tokenHash, requestFingerprint);
      const current = await this.requireChild(workRunId);
      if (current.revision !== request.expectedRevision)
        throw revisionConflict(current, request.expectedRevision);
      const committedAt = this.now();
      const next = this.nextChildForArtifact(current, semantics, committedAt);
      const receipt = {
        schemaVersion: 1,
        kind: "artifact-projection",
        transitionTokenHash: tokenHash,
        childWorkRunId: workRunId,
        childRevision: next.revision,
        expectedRevision: request.expectedRevision,
        artifactProjectionId: artifact.projectionId,
        actor: request.actor,
        committedAt,
        requestFingerprint,
        resultFingerprint: next.fingerprint,
        request: semantics
      };
      await writeIfAbsentOrSame(this.childIntentPath(workRunId, next.revision), receipt);
      await this.injectFault("after-child-intent");
      await writeIfAbsentOrSame(this.childReceiptPath(tokenHash), receipt);
      await this.injectFault("after-child-receipt");
      await writeIfAbsentOrSame(this.childRevisionPath(workRunId, next.revision), next);
      return { idempotent: false, child: deepClone(next) };
    });
  }
  async transition(workRunId, request) {
    const tokenHash = digestTransitionToken(request.transitionToken);
    return this.withLock(async () => {
      const semantics = {
        kind: "child-transition",
        childWorkRunId: workRunId,
        expectedRevision: request.expectedRevision,
        actor: request.actor,
        lifecycle: request.lifecycle,
        ...request.diagnosticArtifact ? { diagnosticArtifact: validateArtifactProjection(deepClone(request.diagnosticArtifact)) } : {}
      };
      const requestFingerprint = canonicalDigest(semantics);
      const replay = await this.readChildReceipt(tokenHash);
      if (replay)
        return this.childReplay(replay, workRunId, tokenHash, requestFingerprint);
      await this.recoverNextChildIntent(workRunId);
      const recoveredReplay = await this.readChildReceipt(tokenHash);
      if (recoveredReplay)
        return this.childReplay(recoveredReplay, workRunId, tokenHash, requestFingerprint);
      const current = await this.requireChild(workRunId);
      if (current.revision !== request.expectedRevision)
        throw revisionConflict(current, request.expectedRevision);
      const committedAt = this.now();
      const next = this.nextChildForTransition(current, semantics, committedAt);
      const receipt = {
        schemaVersion: 1,
        kind: "child-transition",
        transitionTokenHash: tokenHash,
        childWorkRunId: workRunId,
        childRevision: next.revision,
        expectedRevision: request.expectedRevision,
        actor: request.actor,
        committedAt,
        requestFingerprint,
        resultFingerprint: next.fingerprint,
        request: semantics
      };
      await writeIfAbsentOrSame(this.childIntentPath(workRunId, next.revision), receipt);
      await this.injectFault("after-child-intent");
      await writeIfAbsentOrSame(this.childReceiptPath(tokenHash), receipt);
      await this.injectFault("after-child-receipt");
      await writeIfAbsentOrSame(this.childRevisionPath(workRunId, next.revision), next);
      return { idempotent: false, child: deepClone(next) };
    });
  }
  async recoverDelegation(receipt, request, plan) {
    if (receipt.planId !== request.planId || receipt.planFingerprint !== request.presentedFingerprint || receipt.transitionTokenHash !== digestTransitionToken(request.transitionToken) || receipt.requestFingerprint !== delegationApprovalRequestFingerprint(request)) {
      throw new DomainConflictError("Delegation transition token was already used for different approval semantics");
    }
    const outcome = this.delegationOutcome(plan, {
      actor: receipt.actor,
      approvedExternal: receipt.approvedExternalClasses,
      policy: receipt.policyDecision,
      issuedAt: receipt.issuedAt,
      workRunId: receipt.childWorkRunId,
      grantId: receipt.grantId
    });
    if (outcome.child.fingerprint !== receipt.childFingerprint || outcome.grant.fingerprint !== receipt.grantFingerprint) {
      throw new DomainConflictError("Delegation recovery outcome no longer matches its durable approval intent");
    }
    await writeIfAbsentOrSame(this.planDecisionPath(plan.planId), receipt);
    await writeIfAbsentOrSame(this.delegationReceiptPath(receipt.transitionTokenHash), receipt);
    await writeIfAbsentOrSame(this.grantPath(receipt.grantId), outcome.grant);
    await writeIfAbsentOrSame(this.childRevisionPath(receipt.childWorkRunId, receipt.childRevision), outcome.child);
    return { idempotent: true, child: deepClone(outcome.child), grant: deepClone(outcome.grant) };
  }
  async childReplay(receipt, workRunId, tokenHash, requestFingerprint) {
    if (receipt.childWorkRunId !== workRunId || receipt.transitionTokenHash !== tokenHash || receipt.requestFingerprint !== requestFingerprint) {
      throw new DomainConflictError("Child transition token was already used for different child operation semantics");
    }
    return { idempotent: true, child: await this.recoverChildIntent(receipt) };
  }
  async recoverNextChildIntent(workRunId) {
    const current = await this.requireChild(workRunId);
    const pending = await this.readChildIntent(workRunId, current.revision + 1);
    if (pending)
      await this.recoverChildIntent(pending);
  }
  async recoverChildIntent(receipt) {
    if (receipt.schemaVersion !== 1 || receipt.kind !== receipt.request.kind || receipt.childWorkRunId !== receipt.request.childWorkRunId || receipt.expectedRevision !== receipt.request.expectedRevision || receipt.childRevision !== receipt.expectedRevision + 1 || receipt.actor !== receipt.request.actor || receipt.requestFingerprint !== canonicalDigest(receipt.request)) {
      throw new DomainConflictError("Child operation intent is internally inconsistent");
    }
    ensureDigest(receipt.transitionTokenHash, "ChildReceipt.transitionTokenHash");
    ensureDigest(receipt.requestFingerprint, "ChildReceipt.requestFingerprint");
    ensureDigest(receipt.resultFingerprint, "ChildReceipt.resultFingerprint");
    const chain = await this.readChildChain(receipt.childWorkRunId);
    const committed = chain.find((child) => child.revision === receipt.childRevision);
    if (committed) {
      if (committed.fingerprint !== receipt.resultFingerprint) {
        throw new DomainConflictError("Child operation intent result fingerprint differs from its immutable revision");
      }
      await writeIfAbsentOrSame(this.childIntentPath(receipt.childWorkRunId, receipt.childRevision), receipt);
      await writeIfAbsentOrSame(this.childReceiptPath(receipt.transitionTokenHash), receipt);
      return deepClone(committed);
    }
    const base = chain.find((child) => child.revision === receipt.expectedRevision);
    if (!base)
      throw new DomainConflictError("Child operation intent references a missing base revision");
    const next = receipt.request.kind === "artifact-projection" ? this.nextChildForArtifact(base, receipt.request, receipt.committedAt) : this.nextChildForTransition(base, receipt.request, receipt.committedAt);
    if (next.fingerprint !== receipt.resultFingerprint) {
      throw new DomainConflictError("Recovered Child Work Run differs from its durable operation intent");
    }
    await writeIfAbsentOrSame(this.childIntentPath(receipt.childWorkRunId, receipt.childRevision), receipt);
    await writeIfAbsentOrSame(this.childReceiptPath(receipt.transitionTokenHash), receipt);
    await writeIfAbsentOrSame(this.childRevisionPath(receipt.childWorkRunId, receipt.childRevision), next);
    return deepClone(next);
  }
  nextChildForArtifact(current, request, committedAt) {
    if (isTerminal(current.lifecycle))
      throw new DomainConflictError("Terminal Child Work Run does not accept artifacts");
    const artifact = validateArtifactProjection(deepClone(request.artifact));
    this.assertChildArtifact(current, artifact);
    if (current.artifacts.some((item) => item.projectionId === artifact.projectionId || item.artifactId === artifact.artifactId)) {
      throw new DomainConflictError("Artifact Projection identity already exists on Child Work Run");
    }
    this.assertArtifactOperationPolicy(current, artifact);
    return this.nextChild(current, request.actor, { artifacts: [...current.artifacts, artifact] }, committedAt);
  }
  nextChildForTransition(current, request, committedAt) {
    if (!childTransitionAllowed(current.lifecycle, request.lifecycle)) {
      throw new DomainConflictError(`Invalid Child Work Run transition ${current.lifecycle} -> ${request.lifecycle}`);
    }
    let artifacts = [...current.artifacts];
    let terminalDiagnosticArtifactId = current.terminalDiagnosticArtifactId;
    if (request.lifecycle === "failed" || request.lifecycle === "cancelled") {
      if (!request.diagnosticArtifact)
        throw new DomainValidationError("Failed or cancelled child requires a diagnostic artifact");
      const diagnostic = validateArtifactProjection(deepClone(request.diagnosticArtifact));
      this.assertChildArtifact(current, diagnostic);
      if (diagnostic.outputClass !== "diagnostic" || diagnostic.sideEffectClass !== "read-only") {
        throw new DomainValidationError("Terminal diagnostic artifact must be a read-only diagnostic");
      }
      artifacts = [...artifacts, diagnostic];
      terminalDiagnosticArtifactId = diagnostic.artifactId;
    } else if (request.diagnosticArtifact) {
      throw new DomainValidationError("Diagnostic artifact is only accepted for failed or cancelled transitions");
    }
    if (request.lifecycle === "completed") {
      const matching = artifacts.filter((artifact) => artifact.outputClass === current.expectedOutput.outputClass && artifact.mediaType === current.expectedOutput.mediaType);
      if (matching.length < current.expectedOutput.requiredArtifactCount) {
        throw new DomainConflictError("Child cannot complete before satisfying the locked expected-output contract");
      }
    }
    return this.nextChild(current, request.actor, {
      lifecycle: request.lifecycle,
      artifacts,
      ...terminalDiagnosticArtifactId ? { terminalDiagnosticArtifactId } : {}
    }, committedAt);
  }
  nextChild(current, actor2, patch, updatedAt = this.now()) {
    const material = {
      ...current,
      ...patch,
      revision: current.revision + 1,
      previousRevision: { revision: current.revision, fingerprint: current.fingerprint },
      updatedAt,
      updatedBy: actor2
    };
    delete material.fingerprint;
    return validateChildWorkRun({ ...material, fingerprint: canonicalDigest(childWorkRunFingerprintMaterial(material)) });
  }
  assertChildArtifact(child, artifact) {
    if (artifact.projectId !== child.projectId || artifact.sourceWorkRunId !== child.workRunId || artifact.parentWorkRunId !== child.parentWorkRunId) {
      throw new DomainConflictError("Artifact Projection does not match Child/Project/Parent identities");
    }
    if (artifact.contextFingerprint !== child.assignment.contextEnvelopeFingerprint) {
      throw new DomainConflictError("Artifact Projection context fingerprint differs from the locked assignment");
    }
    if (artifact.producer.profileId !== child.assignment.profileId || artifact.producer.profileRevision !== child.assignment.profileRevision) {
      throw new DomainConflictError("Artifact Projection producer differs from the locked child assignment");
    }
  }
  assertArtifactOperationPolicy(child, artifact) {
    if (!isExternalSideEffect(artifact.sideEffectClass))
      return;
    if (!artifact.operationTarget) {
      throw new DomainConflictError("External artifact lacks its exact external operation target");
    }
    const decision = authorizeCapabilityUse(child.grantSummary, {
      projectId: child.projectId,
      profileId: child.assignment.profileId,
      profileRevision: child.assignment.profileRevision,
      workRunId: child.workRunId,
      connector: artifact.operationTarget.connector,
      operation: artifact.operationTarget.operation,
      resource: artifact.operationTarget.resource,
      sideEffectClass: artifact.sideEffectClass,
      attemptedAt: artifact.createdAt
    });
    if (!decision.allowed || artifact.operationWriteReview.state !== "approved" || artifact.operationWriteReview.approvedWorkRunId !== child.workRunId || artifact.operationWriteReview.grantId !== child.grantSummary.grantId || artifact.operationWriteReview.decisionFingerprint !== canonicalDigest(decision)) {
      throw new DomainConflictError("External artifact lacks explicit per-run Operation Write approval for its exact external operation target", { policyResult: decision });
    }
  }
  async requireChild(workRunId) {
    const child = await this.readChild(workRunId);
    if (!child)
      throw new DomainNotFoundError(`Child Work Run ${workRunId} does not exist`);
    return child;
  }
  planPath(planId) {
    return join3(this.scopeRoot, "plans", stableSuffix(planId), "plan.json");
  }
  planDecisionPath(planId) {
    return join3(this.scopeRoot, "plans", stableSuffix(planId), "approval.json");
  }
  childRevisionPath(workRunId, revision) {
    return join3(this.scopeRoot, "children", stableSuffix(workRunId), "revisions", `${String(revision).padStart(12, "0")}.json`);
  }
  grantPath(grantId) {
    return join3(this.scopeRoot, "grants", stableSuffix(grantId), "grant.json");
  }
  delegationReceiptPath(tokenHash) {
    return join3(this.scopeRoot, "receipts", "delegations", digestSuffix(tokenHash), "receipt.json");
  }
  childReceiptPath(tokenHash) {
    return join3(this.scopeRoot, "receipts", "children", digestSuffix(tokenHash), "receipt.json");
  }
  childIntentPath(workRunId, revision) {
    return join3(this.scopeRoot, "children", stableSuffix(workRunId), "intents", `${String(revision).padStart(12, "0")}.json`);
  }
  readDelegationReceipt(tokenHash) {
    return readJson(this.delegationReceiptPath(tokenHash));
  }
  readPlanDecision(planId) {
    return readJson(this.planDecisionPath(planId));
  }
  readChildReceipt(tokenHash) {
    return readJson(this.childReceiptPath(tokenHash));
  }
  readChildIntent(workRunId, revision) {
    return readJson(this.childIntentPath(workRunId, revision));
  }
  async childRevisionNumbers(workRunId) {
    assertSafeSingleSegment(stableSuffix(workRunId), "Child Work Run ID");
    const directory = join3(this.scopeRoot, "children", stableSuffix(workRunId), "revisions");
    try {
      const { readdir: readdir3 } = await import("node:fs/promises");
      const entries = await readdir3(directory, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile() && /^\d{12}\.json$/.test(entry.name)).map((entry) => Number.parseInt(entry.name.slice(0, 12), 10)).sort((left, right) => left - right);
    } catch (error) {
      if (error.code === "ENOENT")
        return [];
      throw error;
    }
  }
  withLock(action) {
    return withRecoverableFileLock({
      lockPath: join3(this.scopeRoot, ".lock"),
      now: this.now,
      timeoutMs: this.lockTimeoutMs,
      retryMs: this.lockRetryMs,
      staleLockMs: this.staleLockMs
    }, action);
  }
  async injectFault(point) {
    await this.faultInjector?.(point);
  }
};
function childTransitionAllowed(from, to) {
  if (from === "ready")
    return to === "running" || to === "failed" || to === "cancelled";
  if (from === "running")
    return to === "completed" || to === "failed" || to === "cancelled";
  return false;
}
function isTerminal(lifecycle) {
  return lifecycle === "completed" || lifecycle === "failed" || lifecycle === "cancelled";
}
function assertConsultRevision(request, memory) {
  assertMemoryIdentity(memory, request.projectId, request.targetAgent.profileId);
  const actual = memoryLock(memory);
  if (canonicalDigest(actual) !== canonicalDigest(request.asOf)) {
    throw new DomainConflictError("Context Consult reader did not return the exact approved as-of revision", { expected: request.asOf, actual });
  }
}
function assertMemoryIdentity(memory, projectId2, profileId) {
  if (memory.lifecycle !== "approved" || memory.projectId !== projectId2 || memory.profileId !== profileId) {
    throw new DomainConflictError("Context Consult memory is not the approved target Project/Agent revision");
  }
}
function memoryLock(memory) {
  return { revisionId: memory.revisionId, revision: memory.revision, fingerprint: memory.fingerprint };
}
function consultResource(request) {
  return `${request.targetAgent.profileId}@${request.asOf.revisionId}`;
}
function dedupeProvenance(values) {
  const seen = /* @__PURE__ */ new Set();
  return values.filter((value) => {
    const key = canonicalJson(value);
    if (seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
}
function stableSuffix(value) {
  const suffix = value.slice(value.indexOf("/") + 1);
  assertSafeSingleSegment(suffix, "stable identity suffix");
  return suffix;
}
function digestSuffix(value) {
  ensureDigest(value, "digest");
  return value.slice("sha256:".length);
}
function ensureDigest(value, path) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value))
    throw new DomainValidationError("Expected sha256 digest", path);
}
function revisionConflict(current, expectedRevision) {
  return new DomainConflictError("Child Work Run revision conflict", {
    expectedRevision,
    actualRevision: current.revision,
    currentFingerprint: current.fingerprint
  });
}
function delegationApprovalRequestFingerprint(request) {
  return canonicalDigest({
    kind: "delegation-approval",
    planId: request.planId,
    presentedFingerprint: request.presentedFingerprint,
    actor: request.actor,
    approvedExternalClasses: [...new Set(request.approvedExternalClasses)].sort()
  });
}
function childImmutableFingerprint(child) {
  return canonicalDigest({
    schemaVersion: child.schemaVersion,
    workRunId: child.workRunId,
    projectId: child.projectId,
    parentWorkRunId: child.parentWorkRunId,
    delegationPlanId: child.delegationPlanId,
    delegationPlanFingerprint: child.delegationPlanFingerprint,
    assignment: child.assignment,
    expectedOutput: child.expectedOutput,
    inputArtifactIds: child.inputArtifactIds,
    grantSummary: child.grantSummary,
    parentStateEffect: child.parentStateEffect,
    createdAt: child.createdAt,
    createdBy: child.createdBy
  });
}
function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value))
      deepFreeze(child);
  }
  return value;
}
async function readValidated(path, validate) {
  const value = await readJson(path);
  return value === null ? null : deepClone(validate(value));
}
async function readJson(path) {
  try {
    return JSON.parse(await readFile2(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT")
      return null;
    throw error;
  }
}
async function writeIfAbsentOrSame(path, value) {
  assertSafeSharedState(value, "collaboration record");
  if (await exists(path)) {
    const existing = await readJson(path);
    if (canonicalDigest(existing) !== canonicalDigest(value))
      throw new DomainConflictError("Immutable collaboration record already exists with different content");
    return;
  }
  await atomicCreate(path, `${canonicalJson(value)}
`);
}
async function atomicCreate(path, content) {
  await mkdir2(dirname2(path), { recursive: true });
  const temporary = join3(dirname2(path), `.${randomUUID2()}.tmp`);
  const handle = await open2(temporary, "wx", 384);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (await exists(path))
      throw new DomainConflictError("Immutable collaboration target already exists");
    await rename2(temporary, path);
  } catch (error) {
    await rm2(temporary, { force: true });
    throw error;
  }
}
async function exists(path) {
  try {
    await stat2(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT")
      return false;
    throw error;
  }
}

// ../packages/agent-domain/dist/src/context-envelope.js
import { Buffer as Buffer2 } from "node:buffer";
var LAYER_ORDER = [
  "platformKernel",
  "agentConstitution",
  "governedWorkingMemory",
  "runtimeEnvelope"
];
var EVICTION_ORDER = {
  runtimeEnvelope: 0,
  governedWorkingMemory: 1,
  agentConstitution: 2,
  platformKernel: 3
};
var TOKEN_ESTIMATOR = "utf8-bytes-div4/v1";
function estimateTokens(content) {
  return Math.max(1, Math.ceil(Buffer2.byteLength(canonicalJson(content), "utf8") / 4));
}
function compileContextEnvelope(rawInput) {
  const input = deepClone(rawInput);
  assertSafeSharedState(input, "ContextEnvelopeCompileInput");
  validateCompileInput(input);
  const layers = /* @__PURE__ */ new Map();
  layers.set("platformKernel", input.platformKernel.map((chunk) => buildChunk(chunk, true)));
  layers.set("agentConstitution", buildConstitutionChunks(input));
  layers.set("governedWorkingMemory", buildMemoryChunks(input));
  layers.set("runtimeEnvelope", buildRuntimeChunks(input));
  const allChunks = LAYER_ORDER.flatMap((name) => layers.get(name) ?? []);
  const duplicate = firstDuplicate(allChunks.map((chunk) => chunk.chunkId));
  if (duplicate)
    throw new DomainValidationError(`Context chunk IDs must be globally unique: ${duplicate}`);
  const mandatoryTokens = allChunks.filter((chunk) => chunk.mandatory).reduce((sum, chunk) => sum + chunk.tokenCount, 0);
  if (mandatoryTokens > input.tokenBudget)
    throw new ContextBudgetError(mandatoryTokens, input.tokenBudget);
  let tokenCount = allChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
  const omissions = [];
  const candidates = LAYER_ORDER.flatMap((layer) => (layers.get(layer) ?? []).filter((chunk) => !chunk.mandatory).map((chunk) => ({ layer, chunk }))).sort((left, right) => EVICTION_ORDER[left.layer] - EVICTION_ORDER[right.layer] || left.chunk.priority - right.chunk.priority || left.chunk.chunkId.localeCompare(right.chunk.chunkId));
  for (const candidate of candidates) {
    if (tokenCount <= input.tokenBudget)
      break;
    layers.set(candidate.layer, (layers.get(candidate.layer) ?? []).filter((chunk) => chunk.chunkId !== candidate.chunk.chunkId));
    tokenCount -= candidate.chunk.tokenCount;
    omissions.push({
      layer: candidate.layer,
      chunkId: candidate.chunk.chunkId,
      reason: "token-budget",
      tokenCount: candidate.chunk.tokenCount,
      mandatory: false
    });
  }
  const compiledLayers = LAYER_ORDER.map((name) => buildLayer(name, layers.get(name) ?? []));
  const material = {
    schemaVersion: 1,
    envelopeId: input.envelopeId,
    compiledAt: input.compiledAt,
    modelLock: input.modelLock,
    tokenEstimator: TOKEN_ESTIMATOR,
    tokenBudget: input.tokenBudget,
    tokenCount,
    layers: compiledLayers,
    omissions
  };
  const envelope = {
    ...material,
    fingerprint: canonicalDigest(envelopeFingerprintMaterial(material))
  };
  return validateContextEnvelope(envelope);
}
function validateCompileInput(input) {
  if (!input.envelopeId || input.envelopeId !== input.envelopeId.trim()) {
    throw new DomainValidationError("Envelope ID must be a non-empty trimmed string", "ContextEnvelopeCompileInput.envelopeId");
  }
  if (!Number.isInteger(input.tokenBudget) || input.tokenBudget < 1) {
    throw new DomainValidationError("Token budget must be a positive integer", "ContextEnvelopeCompileInput.tokenBudget");
  }
  const profile = validateAgentProfile(input.profile);
  const binding = validateProjectAgentBinding(input.binding);
  const memory = validateMemoryRevision(input.memoryRevision);
  if (!binding.enabled)
    throw new DomainConflictError("Disabled Project Agent Binding cannot compile context", { bindingId: binding.bindingId });
  if (binding.profileId !== profile.profileId || binding.profileRevision !== profile.revision) {
    throw new DomainConflictError("Context Profile does not match the exact revision locked by the Binding", {
      bindingProfileId: binding.profileId,
      bindingProfileRevision: binding.profileRevision,
      profileId: profile.profileId,
      profileRevision: profile.revision
    });
  }
  if (memory.projectId !== binding.projectId || memory.profileId !== binding.profileId) {
    throw new DomainConflictError("Approved memory does not belong to the bound Project and Profile", {
      memoryProjectId: memory.projectId,
      memoryProfileId: memory.profileId,
      bindingProjectId: binding.projectId,
      bindingProfileId: binding.profileId
    });
  }
  const projectContextRefs = input.runtime?.projectContext?.provenance?.filter((reference) => reference.kind === "project") ?? [];
  if (projectContextRefs.length !== 1 || projectContextRefs[0].id !== binding.projectId || projectContextRefs[0].fingerprint !== binding.projectContextFingerprint) {
    throw new DomainConflictError("Runtime Project Context provenance does not match the exact Project Context fingerprint locked by the Binding", {
      bindingProjectId: binding.projectId,
      bindingProjectContextFingerprint: binding.projectContextFingerprint,
      projectContextProvenance: projectContextRefs
    });
  }
  if (!input.memoryRevisionLock || typeof input.memoryRevisionLock !== "object" || !Number.isInteger(input.memoryRevisionLock.revision) || input.memoryRevisionLock.revision < 1 || typeof input.memoryRevisionLock.revisionId !== "string" || typeof input.memoryRevisionLock.fingerprint !== "string") {
    throw new DomainValidationError("A complete approved memory revision lock is required", "ContextEnvelopeCompileInput.memoryRevisionLock");
  }
  if (input.memoryRevisionLock.revisionId !== memory.revisionId || input.memoryRevisionLock.revision !== memory.revision || input.memoryRevisionLock.fingerprint !== memory.fingerprint) {
    throw new DomainConflictError("Approved memory does not match the current revision lock", {
      lockedRevisionId: input.memoryRevisionLock.revisionId,
      lockedRevision: input.memoryRevisionLock.revision,
      memoryRevisionId: memory.revisionId,
      memoryRevision: memory.revision
    });
  }
  if (!Array.isArray(input.platformKernel) || input.platformKernel.length === 0) {
    throw new DomainValidationError("Platform kernel requires at least one governance chunk", "ContextEnvelopeCompileInput.platformKernel");
  }
}
function buildConstitutionChunks(input) {
  const profileProvenance = [{
    kind: "profile",
    id: input.profile.profileId,
    revision: input.profile.revision,
    fingerprint: canonicalDigest(input.profile)
  }];
  const bindingProvenance = [{
    kind: "binding",
    id: input.binding.bindingId,
    revision: input.binding.revision,
    fingerprint: canonicalDigest(input.binding)
  }];
  return [
    buildChunk({
      chunkId: "agent-constitution/profile",
      content: asJsonValue({
        profileId: input.profile.profileId,
        profileRevision: input.profile.revision,
        role: input.profile.role,
        responsibilities: input.profile.responsibilities,
        capabilityClaims: input.profile.capabilityClaims,
        constitution: input.profile.constitution,
        defaultModelPolicy: input.profile.defaultModelPolicy
      }),
      provenance: profileProvenance,
      priority: 100
    }, true),
    buildChunk({
      chunkId: "agent-constitution/project-binding",
      content: asJsonValue({
        bindingId: input.binding.bindingId,
        bindingRevision: input.binding.revision,
        projectId: input.binding.projectId,
        projectContextFingerprint: input.binding.projectContextFingerprint,
        profileId: input.binding.profileId,
        profileRevision: input.binding.profileRevision,
        role: input.binding.role,
        memoryScopes: input.binding.memoryScopes,
        connectorGrantRefs: input.binding.connectorGrantRefs
      }),
      provenance: bindingProvenance,
      priority: 100
    }, true)
  ];
}
function buildMemoryChunks(input) {
  const provenance = [{
    kind: "memoryRevision",
    id: input.memoryRevision.revisionId,
    revision: input.memoryRevision.revision,
    fingerprint: input.memoryRevision.fingerprint
  }];
  const chunks = [buildChunk({
    chunkId: "governed-memory/governance",
    content: asJsonValue({
      revisionId: input.memoryRevision.revisionId,
      revision: input.memoryRevision.revision,
      protectedDirectives: input.memoryRevision.protectedDirectives,
      unresolvedConflicts: input.memoryRevision.unresolvedConflicts,
      approval: {
        proposalId: input.memoryRevision.approval.proposalId,
        policyVersion: input.memoryRevision.approval.policyVersion,
        policyResult: input.memoryRevision.approval.policyResult
      }
    }),
    provenance,
    priority: 100
  }, true)];
  for (const scope of input.binding.memoryScopes) {
    const section = input.memoryRevision.sections[scope];
    chunks.push(buildChunk({
      chunkId: `governed-memory/${scope}`,
      content: asJsonValue({ scope, section }),
      provenance,
      mandatory: false,
      priority: scope === "stableMemory" ? 70 : scope === "openItems" ? 60 : 50
    }));
  }
  return chunks;
}
function buildRuntimeChunks(input) {
  const runtime = input.runtime;
  const chunks = [
    buildChunk({ ...runtime.projectContext, chunkId: `runtime/project/${runtime.projectContext.chunkId}` }, true),
    ...runtime.workItem ? [buildChunk({ ...runtime.workItem, chunkId: `runtime/work-item/${runtime.workItem.chunkId}` })] : [],
    ...runtime.workRun ? [buildChunk({ ...runtime.workRun, chunkId: `runtime/work-run/${runtime.workRun.chunkId}` })] : [],
    ...runtime.threadWindow.map((chunk) => buildChunk({ ...chunk, chunkId: `runtime/thread/${chunk.chunkId}` })),
    buildChunk({ ...runtime.settingsSnapshot, chunkId: `runtime/settings/${runtime.settingsSnapshot.chunkId}` }, true),
    ...runtime.deviceCapabilities.map((chunk) => buildChunk({ ...chunk, chunkId: `runtime/device/${chunk.chunkId}` })),
    ...runtime.capabilityGrants.map((chunk) => buildChunk({ ...chunk, chunkId: `runtime/grant/${chunk.chunkId}` })),
    ...(runtime.artifacts ?? []).map((chunk) => buildChunk({ ...chunk, chunkId: `runtime/artifact/${chunk.chunkId}` }))
  ];
  return chunks;
}
function buildChunk(input, forceMandatory = false) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new DomainValidationError("Context chunk input must be an object");
  const extras = Object.keys(input).filter((key) => !(/* @__PURE__ */ new Set(["chunkId", "content", "provenance", "mandatory", "priority"])).has(key));
  if (extras.length)
    throw new DomainValidationError(`Unknown Context chunk input fields: ${extras.join(", ")}`);
  if (!input.chunkId || input.chunkId !== input.chunkId.trim())
    throw new DomainValidationError("Context chunk ID must be non-empty and trimmed");
  if (!Array.isArray(input.provenance))
    throw new DomainValidationError("Context chunk provenance must be an array");
  if (input.mandatory !== void 0 && typeof input.mandatory !== "boolean")
    throw new DomainValidationError("Context chunk mandatory must be boolean");
  if (input.priority !== void 0 && (!Number.isInteger(input.priority) || input.priority < 0))
    throw new DomainValidationError("Context chunk priority must be a non-negative integer");
  assertJsonValue(input.content, `ContextChunkInput.${input.chunkId}.content`);
  assertSafeSharedState(input.content, `ContextChunkInput.${input.chunkId}.content`);
  const content = deepClone(input.content);
  return validateContextChunk({
    chunkId: input.chunkId,
    content,
    provenance: deepClone(input.provenance),
    mandatory: forceMandatory || input.mandatory === true,
    priority: input.priority ?? 50,
    tokenCount: estimateTokens(content),
    contentHash: canonicalDigest(content)
  });
}
function buildLayer(name, chunks) {
  const provenanceByKey = /* @__PURE__ */ new Map();
  for (const provenance2 of chunks.flatMap((chunk) => chunk.provenance)) {
    provenanceByKey.set(canonicalJson(provenance2), deepClone(provenance2));
  }
  const provenance = [...provenanceByKey.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value);
  return {
    name,
    provenance,
    chunks,
    tokenCount: chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0),
    contentHash: canonicalDigest(chunks)
  };
}
function firstDuplicate(values) {
  const seen = /* @__PURE__ */ new Set();
  for (const value of values) {
    if (seen.has(value))
      return value;
    seen.add(value);
  }
  return void 0;
}
function asJsonValue(value) {
  return deepClone(value);
}
function assertJsonValue(value, path, seen = /* @__PURE__ */ new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new DomainValidationError("Context content numbers must be finite", path);
    return;
  }
  if (Array.isArray(value)) {
    if (seen.has(value))
      throw new DomainValidationError("Context content must not contain cycles", path);
    seen.add(value);
    value.forEach((child, index) => assertJsonValue(child, `${path}[${index}]`, seen));
    seen.delete(value);
    return;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new DomainValidationError("Context content must be JSON-compatible", path);
  }
  if (seen.has(value))
    throw new DomainValidationError("Context content must not contain cycles", path);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (child === void 0)
      throw new DomainValidationError("Context content must not contain undefined", `${path}.${key}`);
    assertJsonValue(child, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

// ../packages/agent-domain/dist/src/dreamtime.js
import { randomUUID as randomUUID3 } from "node:crypto";
import { basename, dirname as dirname3, join as join4 } from "node:path";
import { mkdir as mkdir3, open as open3, readdir, readFile as readFile3, rename as rename3, rm as rm3, stat as stat3 } from "node:fs/promises";
function dreamTimeSourceFingerprint(input) {
  return canonicalDigest({
    operation: input.operation,
    projectId: input.projectId,
    profileId: input.profileId,
    sourceIdentities: input.sourceIdentities,
    expectedRevision: input.expectedRevision,
    currentSections: input.currentSections,
    protectedDirectives: input.protectedDirectives,
    unresolvedConflicts: input.unresolvedConflicts,
    modelLock: input.modelLock
  });
}
async function runDreamTimeProposalWorker(store, worker, rawInput, actor2) {
  const input = deepClone(rawInput);
  if (input.sourceFingerprint !== dreamTimeSourceFingerprint(input)) {
    throw new DomainValidationError("Dream Time worker input source fingerprint does not lock the exact input");
  }
  assertSafeSharedState(input, "DreamTimeWorkerInput");
  const candidate = await worker.generate(deepFreeze2(input));
  assertWorkerOutputLocked(input, candidate);
  return store.createProposal(candidate, actor2);
}
var DreamTimeStore = class {
  projectId;
  profileId;
  scopeRoot;
  now;
  lockTimeoutMs;
  lockRetryMs;
  staleLockMs;
  faultInjector;
  constructor(options) {
    if (!options.memoryRoot)
      throw new DomainValidationError("Dream Time memoryRoot is required");
    this.projectId = parseProjectId2(options.projectId);
    this.profileId = parseAgentProfileId(options.profileId);
    this.scopeRoot = join4(options.memoryRoot, this.projectId.slice("project/".length), this.profileId.slice("agent/".length));
    this.now = options.clock ?? (() => (/* @__PURE__ */ new Date()).toISOString());
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5e3;
    this.lockRetryMs = options.lockRetryMs ?? 15;
    this.staleLockMs = options.staleLockMs;
    this.faultInjector = options.faultInjector;
  }
  async createProposal(rawCandidate, actor2) {
    const candidate = deepClone(rawCandidate);
    assertSafeSharedState({ candidate, actor: actor2 }, "MemoryProposalCandidate");
    if (candidate.projectId !== this.projectId || candidate.profileId !== this.profileId) {
      throw new DomainConflictError("Memory Proposal is outside this Project/Profile scope", {
        expectedProjectId: this.projectId,
        expectedProfileId: this.profileId,
        proposalProjectId: candidate.projectId,
        proposalProfileId: candidate.profileId
      });
    }
    const createdAt = this.now();
    const material = {
      ...candidate,
      schemaVersion: 1,
      proposalId: candidate.proposalId ?? `memory-proposal/${randomUUID3()}`,
      lifecycle: "proposed",
      approvalPolicy: {
        mode: "manual",
        autoApprovalHook: {
          enabled: false,
          warningFreeOnly: true,
          workingMemoryOnly: true
        }
      },
      createdAt,
      createdBy: actor2
    };
    const proposal = validateMemoryProposal({
      ...material,
      fingerprint: canonicalDigest(proposalFingerprintMaterial(material))
    });
    await this.withScopeLock(async () => {
      await atomicCreate2(this.proposalPath(proposal.proposalId), `${canonicalJson(proposal)}
`);
    });
    return deepClone(proposal);
  }
  async readProposal(proposalId) {
    const proposal = await readValidated2(this.proposalPath(proposalId), validateMemoryProposal);
    if (proposal && (proposal.proposalId !== proposalId || proposal.projectId !== this.projectId || proposal.profileId !== this.profileId)) {
      throw new DomainConflictError("Memory Proposal file identity does not match its scoped path", { proposalId });
    }
    return proposal;
  }
  async readCurrentRevision() {
    const revisions = await this.listRevisions();
    return revisions.at(-1) ?? null;
  }
  async readRevision(revisionId) {
    const revisions = await this.listRevisions();
    return revisions.find((revision) => revision.revisionId === revisionId) ?? null;
  }
  async listRevisions() {
    const files = await listFiles(join4(this.scopeRoot, "revisions"), /^\d{12}-[A-Za-z0-9._-]+\.json$/);
    const revisions = await Promise.all(files.map((file) => readValidated2(join4(this.scopeRoot, "revisions", file), validateMemoryRevision)));
    const result = revisions.filter((revision) => revision !== null).sort((left, right) => left.revision - right.revision);
    for (let index = 0; index < result.length; index += 1) {
      const revision = result[index];
      if (revision.projectId !== this.projectId || revision.profileId !== this.profileId || revision.revision !== index + 1) {
        throw new DomainConflictError("Dream Time revision chain is non-contiguous or outside its scope", {
          revisionId: revision.revisionId,
          revision: revision.revision
        });
      }
      const previous = result[index - 1] ?? null;
      if (revision.previousRevisionId !== (previous?.revisionId ?? null) || revision.previousFingerprint !== (previous?.fingerprint ?? null)) {
        throw new DomainConflictError("Dream Time revision predecessor lock is broken", {
          revisionId: revision.revisionId,
          previousRevisionId: revision.previousRevisionId
        });
      }
    }
    return result;
  }
  async listEvents() {
    const files = await listFiles(join4(this.scopeRoot, "events"), /^\d{12}-[A-Za-z0-9._-]+\.json$/);
    const events = await Promise.all(files.map((file) => readValidated2(join4(this.scopeRoot, "events", file), validateMemoryEvent)));
    const result = events.filter((event) => event !== null).sort((left, right) => left.ordinal - right.ordinal);
    for (let index = 0; index < result.length; index += 1) {
      if (result[index].ordinal !== index + 1) {
        throw new DomainConflictError("Dream Time event log is not append-only and contiguous");
      }
    }
    return result;
  }
  async readDecision(proposalId) {
    const decision = await readValidated2(this.decisionPath(proposalId), validateApprovalDecision);
    if (decision && decision.proposalId !== proposalId) {
      throw new DomainConflictError("Approval Decision file identity does not match its proposal path", { proposalId });
    }
    return decision;
  }
  approve(proposalId, request) {
    return this.transition("approve", proposalId, request);
  }
  reject(proposalId, request) {
    return this.transition("reject", proposalId, request);
  }
  async transition(action, proposalId, request) {
    if (!request.transitionToken || request.transitionToken !== request.transitionToken.trim()) {
      throw new DomainValidationError("Transition token must be non-empty and trimmed");
    }
    if (!Number.isInteger(request.expectedRevision) || request.expectedRevision < 0) {
      throw new DomainValidationError("Expected revision must be a non-negative integer");
    }
    const proposal = await this.readProposal(proposalId);
    if (!proposal)
      throw new DomainNotFoundError(`Memory Proposal ${proposalId} does not exist`);
    if (proposal.fingerprint !== request.presentedFingerprint) {
      throw new DomainConflictError("Presented Memory Proposal fingerprint does not match immutable proposal", {
        proposalId,
        presentedFingerprint: request.presentedFingerprint,
        actualFingerprint: proposal.fingerprint
      });
    }
    const transitionTokenHash = digestTransitionToken(request.transitionToken);
    return this.withScopeLock(async () => {
      const replay = await this.replayOrRecover(action, proposal, transitionTokenHash, request.actor);
      if (replay)
        return replay;
      const existingDecision = await this.readDecision(proposalId);
      if (existingDecision) {
        throw new DomainConflictError("Memory Proposal already has a terminal decision under a different transition token", {
          proposalId,
          state: existingDecision.state
        });
      }
      const authorization = await request.authorize({ actor: request.actor, action, proposal: deepFreeze2(deepClone(proposal)) });
      validateAuthorization(authorization);
      if (!authorization.allowed) {
        throw new DomainConflictError("Actor is not authorized for this Dream Time transition", {
          proposalId,
          actor: request.actor,
          action,
          policyVersion: authorization.policyVersion,
          reason: authorization.reason
        });
      }
      const now = this.now();
      if (Date.parse(now) >= Date.parse(proposal.expiresAt)) {
        return this.finalizeWithoutRevision({
          transitionAction: action,
          action: "expired",
          proposal,
          transitionTokenHash,
          actor: request.actor,
          policy: authorization,
          reason: "Proposal expiry elapsed before transition"
        });
      }
      const current = await this.readCurrentRevision();
      if (!expectedRevisionMatches(proposal, current) || request.expectedRevision !== proposal.expectedRevision.revision) {
        return this.finalizeWithoutRevision({
          transitionAction: action,
          action: "stale",
          proposal,
          transitionTokenHash,
          actor: request.actor,
          policy: authorization,
          reason: `Expected revision ${request.expectedRevision}; current revision is ${current?.revision ?? 0}`
        });
      }
      if (action === "reject") {
        return this.finalizeWithoutRevision({
          transitionAction: action,
          action: "rejected",
          proposal,
          transitionTokenHash,
          actor: request.actor,
          policy: authorization,
          reason: request.reason?.trim() || "Proposal rejected by authorized actor"
        });
      }
      const sections = applyCandidateDiff(proposal, current, now);
      const revisionNumber = (current?.revision ?? 0) + 1;
      const revisionMaterial = {
        schemaVersion: 1,
        revisionId: `memory-revision/${String(revisionNumber).padStart(12, "0")}-${randomUUID3()}`,
        revision: revisionNumber,
        previousRevisionId: current?.revisionId ?? null,
        previousFingerprint: current?.fingerprint ?? null,
        projectId: this.projectId,
        profileId: this.profileId,
        lifecycle: "approved",
        sections,
        protectedDirectives: deepClone(proposal.protectedDirectives),
        unresolvedConflicts: deepClone(proposal.unresolvedConflicts),
        exactDiff: deepClone(proposal.candidateDiff),
        provenance: deepClone(proposal.provenance),
        approval: {
          proposalId: proposal.proposalId,
          transitionTokenHash,
          actor: request.actor,
          policyVersion: authorization.policyVersion,
          policyResult: "allowed"
        },
        createdAt: now
      };
      const revision = validateMemoryRevision({
        ...revisionMaterial,
        fingerprint: canonicalDigest(revisionFingerprintMaterial(revisionMaterial))
      });
      await atomicCreate2(this.revisionPath(revision), `${canonicalJson(revision)}
`);
      await this.faultInjector?.("after-revision-write");
      return this.persistTerminalResult({
        transitionAction: "approve",
        action: "approved",
        proposal,
        revision,
        transitionTokenHash,
        actor: request.actor,
        policy: authorization,
        reason: "Proposal approved and committed as a new immutable revision"
      });
    });
  }
  async replayOrRecover(action, proposal, transitionTokenHash, actor2) {
    const receipt = await this.readReceipt(transitionTokenHash);
    if (receipt) {
      assertReceiptMatches(receipt, action, proposal, transitionTokenHash, actor2);
      return this.resultFromReceipt(receipt, true);
    }
    const decision = await this.readDecision(proposal.proposalId);
    if (decision?.transitionTokenHash === transitionTokenHash) {
      if (decision.actor !== actor2)
        throw new DomainConflictError("Transition replay actor does not match the committed actor");
      const event = (await this.listEvents()).find((candidate) => candidate.proposalId === proposal.proposalId && candidate.transitionTokenHash === transitionTokenHash);
      if (!event)
        throw new DomainConflictError("Terminal decision exists without its append-only event");
      const revision = decision.revisionId ? await this.readRevision(decision.revisionId) : null;
      const reconstructed = makeReceipt(actionForDecision(decision), proposal, decision, event, revision, actor2);
      await atomicCreate2(this.receiptPath(transitionTokenHash), `${canonicalJson(reconstructed)}
`);
      return { status: decision.state, idempotent: true, decision, revision, event };
    }
    const orphanEvent = (await this.listEvents()).find((event) => event.transitionTokenHash === transitionTokenHash);
    if (orphanEvent) {
      if (orphanEvent.proposalId !== proposal.proposalId || orphanEvent.transitionAction !== action || orphanEvent.actor !== actor2) {
        throw new DomainConflictError("Transition event is already bound to a different immutable transition");
      }
      const revision = orphanEvent.revisionId ? await this.readRevision(orphanEvent.revisionId) : null;
      if (orphanEvent.revisionId && !revision)
        throw new DomainConflictError("Orphan transition event refers to a missing revision");
      const recoveredDecision = validateApprovalDecision({
        schemaVersion: 1,
        decisionId: `memory-decision/${randomUUID3()}`,
        proposalId: proposal.proposalId,
        transitionAction: orphanEvent.transitionAction,
        state: orphanEvent.action,
        revisionId: orphanEvent.revisionId,
        transitionTokenHash,
        actor: actor2,
        decidedAt: orphanEvent.occurredAt,
        proposalFingerprint: proposal.fingerprint,
        policyVersion: orphanEvent.policyResult.policyVersion,
        reason: "Recovered terminal decision from append-only event after interrupted commit"
      });
      const recoveredReceipt = makeReceipt(action, proposal, recoveredDecision, orphanEvent, revision, actor2);
      await atomicCreate2(this.decisionPath(proposal.proposalId), `${canonicalJson(recoveredDecision)}
`);
      await atomicCreate2(this.receiptPath(transitionTokenHash), `${canonicalJson(recoveredReceipt)}
`);
      return {
        status: recoveredDecision.state,
        idempotent: true,
        decision: recoveredDecision,
        revision,
        event: orphanEvent
      };
    }
    const revisions = await this.listRevisions();
    const committedRevision = revisions.find((revision) => revision.approval.transitionTokenHash === transitionTokenHash);
    if (committedRevision) {
      if (action !== "approve" || committedRevision.approval.proposalId !== proposal.proposalId) {
        throw new DomainConflictError("Transition token hash is already committed to a different operation or proposal");
      }
      if (committedRevision.approval.actor !== actor2) {
        throw new DomainConflictError("Transition recovery actor does not match the committed actor");
      }
      return this.persistTerminalResult({
        transitionAction: "approve",
        action: "approved",
        proposal,
        revision: committedRevision,
        transitionTokenHash,
        actor: actor2,
        policy: {
          allowed: true,
          policyVersion: committedRevision.approval.policyVersion,
          reason: "Recovered authorization recorded at the immutable revision commit point"
        },
        reason: "Recovered terminal records after interruption following revision commit",
        idempotent: true
      });
    }
    const committedForProposal = revisions.find((revision) => revision.approval.proposalId === proposal.proposalId);
    if (committedForProposal) {
      throw new DomainConflictError("Memory Proposal was already committed under a different transition token", {
        proposalId: proposal.proposalId,
        revisionId: committedForProposal.revisionId
      });
    }
    return null;
  }
  async finalizeWithoutRevision(input) {
    return this.persistTerminalResult({ ...input, revision: null });
  }
  async persistTerminalResult(input) {
    const existingDecision = await this.readDecision(input.proposal.proposalId);
    if (existingDecision) {
      if (existingDecision.transitionTokenHash !== input.transitionTokenHash || existingDecision.state !== input.action) {
        throw new DomainConflictError("Proposal has a conflicting terminal decision");
      }
      const existingEvent = (await this.listEvents()).find((event2) => event2.proposalId === input.proposal.proposalId && event2.transitionTokenHash === input.transitionTokenHash);
      if (!existingEvent)
        throw new DomainConflictError("Terminal decision exists without matching event");
      const receipt2 = makeReceipt(existingDecision.transitionAction, input.proposal, existingDecision, existingEvent, input.revision, input.actor);
      if (!await exists2(this.receiptPath(input.transitionTokenHash))) {
        await atomicCreate2(this.receiptPath(input.transitionTokenHash), `${canonicalJson(receipt2)}
`);
      }
      return {
        status: existingDecision.state,
        idempotent: true,
        decision: existingDecision,
        revision: input.revision,
        event: existingEvent
      };
    }
    const occurredAt = this.now();
    const ordinal = (await this.listEvents()).length + 1;
    const event = validateMemoryEvent({
      schemaVersion: 1,
      eventId: `memory-event/${String(ordinal).padStart(12, "0")}-${randomUUID3()}`,
      ordinal,
      transitionAction: input.transitionAction,
      action: input.action,
      proposalId: input.proposal.proposalId,
      revisionId: input.revision?.revisionId ?? null,
      transitionTokenHash: input.transitionTokenHash,
      actor: input.actor,
      occurredAt,
      exactDiff: deepClone(input.proposal.candidateDiff),
      provenance: deepClone(input.proposal.provenance),
      policyResult: {
        allowed: input.policy.allowed,
        policyVersion: input.policy.policyVersion,
        reason: input.policy.reason
      }
    });
    const decision = validateApprovalDecision({
      schemaVersion: 1,
      decisionId: `memory-decision/${randomUUID3()}`,
      proposalId: input.proposal.proposalId,
      transitionAction: input.transitionAction,
      state: input.action,
      revisionId: input.revision?.revisionId ?? null,
      transitionTokenHash: input.transitionTokenHash,
      actor: input.actor,
      decidedAt: occurredAt,
      proposalFingerprint: input.proposal.fingerprint,
      policyVersion: input.policy.policyVersion,
      reason: input.reason
    });
    const receipt = makeReceipt(decision.transitionAction, input.proposal, decision, event, input.revision, input.actor);
    await atomicCreate2(this.eventPath(event), `${canonicalJson(event)}
`);
    await this.faultInjector?.("after-event-write");
    await atomicCreate2(this.decisionPath(input.proposal.proposalId), `${canonicalJson(decision)}
`);
    await this.faultInjector?.("after-decision-write");
    await atomicCreate2(this.receiptPath(input.transitionTokenHash), `${canonicalJson(receipt)}
`);
    return {
      status: decision.state,
      idempotent: input.idempotent ?? false,
      decision,
      revision: input.revision,
      event
    };
  }
  async resultFromReceipt(receipt, idempotent) {
    const decision = await this.readDecision(receipt.proposalId);
    const event = (await this.listEvents()).find((candidate) => candidate.eventId === receipt.eventId);
    const revision = receipt.revisionId ? await this.readRevision(receipt.revisionId) : null;
    if (!decision || !event || receipt.revisionId !== null && !revision || decision.decisionId !== receipt.decisionId || decision.proposalId !== receipt.proposalId || decision.transitionAction !== receipt.action || decision.transitionTokenHash !== receipt.transitionTokenHash || decision.proposalFingerprint !== receipt.proposalFingerprint || event.proposalId !== receipt.proposalId || event.transitionAction !== receipt.action || event.transitionTokenHash !== receipt.transitionTokenHash || event.actor !== receipt.actor || (revision?.revisionId ?? null) !== receipt.revisionId) {
      throw new DomainConflictError("Transition receipt refers to missing terminal records", { transitionTokenHash: receipt.transitionTokenHash });
    }
    return { status: decision.state, idempotent, decision, revision, event };
  }
  async readReceipt(transitionTokenHash) {
    const path = this.receiptPath(transitionTokenHash);
    try {
      const receipt = JSON.parse(await readFile3(path, "utf8"));
      assertSafeSharedState(receipt, "TransitionReceipt");
      if (receipt.schemaVersion !== 1 || receipt.transitionTokenHash !== transitionTokenHash) {
        throw new DomainConflictError("Invalid transition receipt", { transitionTokenHash });
      }
      return receipt;
    } catch (error) {
      if (error.code === "ENOENT")
        return null;
      throw error;
    }
  }
  proposalPath(proposalId) {
    const slug = idSlug(proposalId, "memory-proposal/");
    return join4(this.scopeRoot, "proposals", `${slug}.json`);
  }
  revisionPath(revision) {
    const slug = idSlug(revision.revisionId, "memory-revision/");
    return join4(this.scopeRoot, "revisions", `${String(revision.revision).padStart(12, "0")}-${slug}.json`);
  }
  eventPath(event) {
    const slug = idSlug(event.eventId, "memory-event/");
    return join4(this.scopeRoot, "events", `${String(event.ordinal).padStart(12, "0")}-${slug}.json`);
  }
  decisionPath(proposalId) {
    const slug = idSlug(proposalId, "memory-proposal/");
    return join4(this.scopeRoot, "decisions", `${slug}.json`);
  }
  receiptPath(transitionTokenHash) {
    if (!/^sha256:[a-f0-9]{64}$/.test(transitionTokenHash))
      throw new DomainValidationError("Invalid transition token hash");
    return join4(this.scopeRoot, "receipts", `${transitionTokenHash.slice("sha256:".length)}.json`);
  }
  async withScopeLock(action) {
    const lockPath = join4(this.scopeRoot, ".lock");
    return withRecoverableFileLock({
      lockPath,
      now: this.now,
      timeoutMs: this.lockTimeoutMs,
      retryMs: this.lockRetryMs,
      staleLockMs: this.staleLockMs
    }, action);
  }
};
function assertWorkerOutputLocked(input, candidate) {
  const lockedFields = [
    "operation",
    "projectId",
    "profileId",
    "sourceIdentities",
    "expectedRevision",
    "sourceFingerprint",
    "protectedDirectives",
    "unresolvedConflicts",
    "modelLock",
    "expiresAt"
  ];
  for (const field of lockedFields) {
    if (canonicalJson(candidate[field]) !== canonicalJson(input[field])) {
      throw new DomainConflictError(`Dream Time proposal worker changed locked field ${field}`);
    }
  }
}
function validateAuthorization(value) {
  if (!value || typeof value.allowed !== "boolean" || !value.policyVersion?.trim() || !value.reason?.trim()) {
    throw new DomainValidationError("Authorization result must include allowed, policyVersion, and reason");
  }
  assertSafeSharedState(value, "ActorAuthorization");
}
function expectedRevisionMatches(proposal, current) {
  if (!current) {
    return proposal.expectedRevision.revision === 0 && proposal.expectedRevision.revisionId === null && proposal.expectedRevision.fingerprint === null;
  }
  return proposal.expectedRevision.revision === current.revision && proposal.expectedRevision.revisionId === current.revisionId && proposal.expectedRevision.fingerprint === current.fingerprint;
}
function applyCandidateDiff(proposal, current, now) {
  const base = current ? deepClone(current.sections) : {
    recentContext: makeMemorySection(),
    openItems: makeMemorySection(),
    stableMemory: makeMemorySection()
  };
  assertGovernanceRetained(current, proposal);
  for (const diff of proposal.candidateDiff) {
    const currentSection = base[diff.section];
    const expectedBefore = current ? currentSection.contentHash : null;
    if (diff.beforeHash !== expectedBefore) {
      throw new DomainConflictError("Candidate diff beforeHash does not match the exact expected section", {
        section: diff.section,
        expectedBefore,
        actualBefore: diff.beforeHash
      });
    }
    assertSectionMutationAllowed(current, diff, currentSection.contentHash, now);
    base[diff.section] = diff.operation === "remove" ? makeMemorySection() : deepClone(diff.after);
  }
  return base;
}
function assertGovernanceRetained(current, proposal) {
  if (!current)
    return;
  for (const directive of current.protectedDirectives) {
    if (!proposal.protectedDirectives.some((candidate) => canonicalJson(candidate) === canonicalJson(directive))) {
      throw new DomainConflictError("Proposal silently removed or changed a protected directive", { directiveId: directive.directiveId });
    }
  }
  for (const conflict2 of current.unresolvedConflicts) {
    if (!proposal.unresolvedConflicts.some((candidate) => canonicalJson(candidate) === canonicalJson(conflict2))) {
      throw new DomainConflictError("Proposal silently removed or changed an unresolved conflict", { conflictId: conflict2.conflictId });
    }
  }
}
function assertSectionMutationAllowed(current, diff, currentContentHash, now) {
  if (!current)
    return;
  const unresolved = current.unresolvedConflicts.find((conflict2) => conflict2.section === diff.section);
  if (unresolved) {
    throw new DomainConflictError("Candidate diff attempts to change a section with an unresolved conflict", {
      conflictId: unresolved.conflictId,
      section: diff.section
    });
  }
  for (const directive of current.protectedDirectives.filter((candidate) => candidate.section === diff.section)) {
    if (directive.contentHash && directive.contentHash !== currentContentHash) {
      throw new DomainConflictError("Protected directive no longer matches its locked section hash", { directiveId: directive.directiveId });
    }
    const active = directive.kind !== "retain-until" || Date.parse(now) < Date.parse(directive.retainUntil);
    if (active) {
      throw new DomainConflictError("Candidate diff attempts to change a protected memory section", {
        directiveId: directive.directiveId,
        section: diff.section
      });
    }
  }
}
function makeReceipt(action, proposal, decision, event, revision, actor2) {
  return {
    schemaVersion: 1,
    action,
    proposalId: proposal.proposalId,
    proposalFingerprint: proposal.fingerprint,
    transitionTokenHash: decision.transitionTokenHash,
    decisionId: decision.decisionId,
    eventId: event.eventId,
    revisionId: revision?.revisionId ?? null,
    actor: actor2
  };
}
function assertReceiptMatches(receipt, action, proposal, transitionTokenHash, actor2) {
  if (receipt.action !== action || receipt.proposalId !== proposal.proposalId || receipt.proposalFingerprint !== proposal.fingerprint || receipt.transitionTokenHash !== transitionTokenHash || receipt.actor !== actor2) {
    throw new DomainConflictError("Transition token is already bound to a different immutable transition");
  }
}
function actionForDecision(decision) {
  return decision.transitionAction;
}
function idSlug(value, prefix) {
  if (!value.startsWith(prefix))
    throw new DomainValidationError(`ID must start with ${prefix}`);
  const slug = value.slice(prefix.length);
  assertSafeSingleSegment(slug, `${prefix} ID`);
  return slug;
}
function deepFreeze2(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value))
      deepFreeze2(child);
  }
  return value;
}
async function readValidated2(path, validate) {
  try {
    return validate(JSON.parse(await readFile3(path, "utf8")));
  } catch (error) {
    if (error.code === "ENOENT")
      return null;
    throw error;
  }
}
async function listFiles(directory, pattern) {
  try {
    return (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && pattern.test(entry.name)).map((entry) => entry.name).sort();
  } catch (error) {
    if (error.code === "ENOENT")
      return [];
    throw error;
  }
}
async function atomicCreate2(path, content) {
  await mkdir3(dirname3(path), { recursive: true });
  const temporary = join4(dirname3(path), `.${basename(path)}.${randomUUID3()}.tmp`);
  const handle = await open3(temporary, "wx", 384);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (await exists2(path))
      throw new DomainConflictError("Immutable Dream Time record already exists");
    await rename3(temporary, path);
    await syncDirectory(dirname3(path));
  } catch (error) {
    await rm3(temporary, { force: true });
    throw error;
  }
}
async function syncDirectory(path) {
  try {
    const directory = await open3(path, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch {
  }
}
async function exists2(path) {
  try {
    await stat3(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT")
      return false;
    throw error;
  }
}

// ../packages/agent-domain/dist/src/persistence.js
import { randomUUID as randomUUID4 } from "node:crypto";
import { mkdir as mkdir4, open as open4, readFile as readFile4, readdir as readdir2, rename as rename4, rm as rm4, stat as stat4 } from "node:fs/promises";
import { basename as basename2, dirname as dirname4, join as join5 } from "node:path";
var RevisionStore = class {
  options;
  clock;
  lockTimeoutMs;
  lockRetryMs;
  staleLockMs;
  constructor(options) {
    this.options = options;
    this.clock = options.clock ?? (() => (/* @__PURE__ */ new Date()).toISOString());
    this.lockTimeoutMs = options.lockTimeoutMs ?? 2e3;
    this.lockRetryMs = options.lockRetryMs ?? 20;
    this.staleLockMs = options.staleLockMs;
  }
  now() {
    return this.clock();
  }
  async read(id2) {
    const revisions = await this.revisionNumbers(id2);
    if (revisions.length === 0)
      return null;
    for (let index = 0; index < revisions.length; index += 1) {
      if (revisions[index] !== index + 1) {
        throw new DomainConflictError(`${this.options.kind} revision history is not contiguous`, { id: id2, revisions });
      }
    }
    return this.readRevision(id2, revisions.at(-1));
  }
  async readRevision(id2, revision) {
    if (!Number.isInteger(revision) || revision < 1)
      throw new DomainValidationError("revision must be a positive integer");
    const path = this.revisionPath(id2, revision);
    try {
      const parsed = JSON.parse(await readFile4(path, "utf8"));
      const record3 = this.options.validate(parsed);
      if (this.options.idOf(record3) !== id2 || record3.revision !== revision) {
        throw new DomainConflictError(`${this.options.kind} revision identity mismatch`, { id: id2, revision });
      }
      let next = record3;
      for (let previousNumber = revision - 1; previousNumber >= 1; previousNumber -= 1) {
        const previous = await this.readRevisionFile(id2, previousNumber);
        if (!previous || next.previousRevision?.revision !== previous.revision || next.previousRevision.digest !== canonicalDigest(previous)) {
          throw new DomainConflictError(`${this.options.kind} revision predecessor lock mismatch`, { id: id2, revision: next.revision });
        }
        next = previous;
      }
      return deepClone(record3);
    } catch (error) {
      if (error.code === "ENOENT")
        return null;
      if (error instanceof SyntaxError)
        throw new DomainConflictError(`${this.options.kind} revision is malformed`, { id: id2, revision });
      throw error;
    }
  }
  async list() {
    const revisionFiles = await latestRevisionFiles(join5(this.options.stateRoot, this.options.collectionDirectory));
    const records = [];
    for (const path of revisionFiles) {
      const parsed = this.options.validate(JSON.parse(await readFile4(path, "utf8")));
      const id2 = this.options.idOf(parsed);
      if (this.revisionsDirectory(id2) !== dirname4(path)) {
        throw new DomainConflictError(`${this.options.kind} list projection found an identity/path mismatch`, { id: id2 });
      }
      const current = await this.read(id2);
      if (!current)
        throw new DomainConflictError(`${this.options.kind} list projection references a missing record`, { id: id2 });
      records.push(current);
    }
    return records.sort((left, right) => this.options.idOf(left).localeCompare(this.options.idOf(right)));
  }
  async readRevisionFile(id2, revision) {
    const path = this.revisionPath(id2, revision);
    try {
      const record3 = this.options.validate(JSON.parse(await readFile4(path, "utf8")));
      if (this.options.idOf(record3) !== id2 || record3.revision !== revision) {
        throw new DomainConflictError(`${this.options.kind} revision identity mismatch`, { id: id2, revision });
      }
      return record3;
    } catch (error) {
      if (error.code === "ENOENT")
        return null;
      throw error;
    }
  }
  async create(record3) {
    return this.withLock(this.options.idOf(record3), async () => {
      const current = await this.read(this.options.idOf(record3));
      if (current)
        return { status: "conflict", expectedRevision: 0, actualRevision: current.revision, current };
      if (record3.revision !== 1 || record3.previousRevision !== void 0) {
        throw new DomainValidationError(`${this.options.kind} creation must start at revision 1 without previousRevision`);
      }
      await this.writeImmutableRevision(record3);
      return { status: "committed", record: deepClone(record3) };
    });
  }
  async update(id2, expectedRevision, build) {
    return this.withLock(id2, async () => {
      const current = await this.read(id2);
      const actualRevision = current?.revision ?? 0;
      if (!current || actualRevision !== expectedRevision) {
        return { status: "conflict", expectedRevision, actualRevision, current };
      }
      const proposed = build(deepClone(current), this.now());
      if (this.options.idOf(proposed) !== id2)
        throw new DomainValidationError(`${this.options.kind} stable ID cannot change`);
      if (proposed.revision !== current.revision + 1)
        throw new DomainValidationError(`${this.options.kind} revision must increment by one`);
      if (proposed.previousRevision?.revision !== current.revision || proposed.previousRevision.digest !== canonicalDigest(current)) {
        throw new DomainValidationError(`${this.options.kind} previousRevision must lock the exact prior record`);
      }
      await this.writeImmutableRevision(proposed);
      return { status: "committed", record: deepClone(proposed) };
    });
  }
  async writeImmutableRevision(record3) {
    assertSafeSharedState(record3, this.options.kind);
    this.options.validate(record3);
    const path = this.revisionPath(this.options.idOf(record3), record3.revision);
    await mkdir4(dirname4(path), { recursive: true });
    if (await exists3(path))
      throw new DomainConflictError(`${this.options.kind} immutable revision already exists`, {
        id: this.options.idOf(record3),
        revision: record3.revision
      });
    await atomicCreate3(path, `${canonicalJson(record3)}
`);
  }
  async revisionNumbers(id2) {
    const directory = this.revisionsDirectory(id2);
    let entries;
    try {
      entries = await readdir2(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT")
        return [];
      throw error;
    }
    return entries.filter((entry) => entry.isFile() && /^\d{12}\.json$/.test(entry.name)).map((entry) => Number.parseInt(basename2(entry.name, ".json"), 10)).sort((left, right) => left - right);
  }
  recordDirectory(id2) {
    return join5(this.options.stateRoot, this.options.directoryForId(id2));
  }
  revisionsDirectory(id2) {
    return join5(this.recordDirectory(id2), "revisions");
  }
  revisionPath(id2, revision) {
    return join5(this.revisionsDirectory(id2), `${String(revision).padStart(12, "0")}.json`);
  }
  async withLock(id2, action) {
    const lockPath = join5(this.recordDirectory(id2), ".lock");
    return withRecoverableFileLock({
      lockPath,
      now: () => this.now(),
      timeoutMs: this.lockTimeoutMs,
      retryMs: this.lockRetryMs,
      staleLockMs: this.staleLockMs
    }, action);
  }
};
var AgentProfileStore = class {
  store;
  constructor(options) {
    this.store = new RevisionStore({
      ...options,
      kind: "AgentProfile",
      collectionDirectory: "profiles",
      directoryForId: (id2) => join5("profiles", profileSlug(parseAgentProfileId(id2))),
      idOf: (record3) => record3.profileId,
      validate: validateAgentProfile
    });
  }
  read(profileId) {
    parseAgentProfileId(profileId);
    return this.store.read(profileId);
  }
  readRevision(profileId, revision) {
    parseAgentProfileId(profileId);
    return this.store.readRevision(profileId, revision);
  }
  async list(filter = {}) {
    const profileIds = filter.profileIds?.map((profileId) => parseAgentProfileId(profileId));
    const records = await this.store.list();
    return records.filter((record3) => !profileIds || profileIds.includes(record3.profileId));
  }
  async create(input) {
    assertSafeSharedState(input, "AgentProfileCreate");
    const profileId = parseAgentProfileId(input.profileId);
    const now = this.store.now();
    const record3 = {
      schemaVersion: 1,
      profileId,
      revision: 1,
      displayName: input.displayName,
      role: input.role,
      responsibilities: [...input.responsibilities ?? []],
      capabilityClaims: [...input.capabilityClaims ?? []],
      constitution: {
        principles: [...input.constitution.principles],
        instructions: [...input.constitution.instructions]
      },
      defaultModelPolicy: { ...input.defaultModelPolicy ?? { mode: "inherit" } },
      createdAt: now,
      createdBy: input.actor,
      updatedAt: now,
      updatedBy: input.actor
    };
    validateAgentProfile(record3);
    return this.store.create(record3);
  }
  async update(profileId, expectedRevision, patch, actor2) {
    assertSafeSharedState({ patch, actor: actor2 }, "AgentProfilePatch");
    parseAgentProfileId(profileId);
    return this.store.update(profileId, expectedRevision, (current, now) => {
      const record3 = {
        ...current,
        ...patch,
        responsibilities: [...patch.responsibilities ?? current.responsibilities],
        capabilityClaims: [...patch.capabilityClaims ?? current.capabilityClaims],
        constitution: patch.constitution ? {
          principles: [...patch.constitution.principles],
          instructions: [...patch.constitution.instructions]
        } : current.constitution,
        defaultModelPolicy: { ...patch.defaultModelPolicy ?? current.defaultModelPolicy },
        revision: current.revision + 1,
        previousRevision: { revision: current.revision, digest: canonicalDigest(current) },
        updatedAt: now,
        updatedBy: actor2
      };
      return validateAgentProfile(record3);
    });
  }
};
var ProjectAgentBindingStore = class {
  store;
  constructor(options) {
    this.store = new RevisionStore({
      ...options,
      kind: "ProjectAgentBinding",
      collectionDirectory: "bindings",
      directoryForId: (id2) => {
        const parsed = parseBindingId(id2).split("/");
        return join5("bindings", parsed[1], parsed[2]);
      },
      idOf: (record3) => record3.bindingId,
      validate: validateProjectAgentBinding
    });
  }
  read(bindingId) {
    parseBindingId(bindingId);
    return this.store.read(bindingId);
  }
  readRevision(bindingId, revision) {
    parseBindingId(bindingId);
    return this.store.readRevision(bindingId, revision);
  }
  async list(filter = {}) {
    const projectId2 = filter.projectId === void 0 ? void 0 : parseProjectId2(filter.projectId);
    const profileId = filter.profileId === void 0 ? void 0 : parseAgentProfileId(filter.profileId);
    const records = await this.store.list();
    return records.filter((record3) => (projectId2 === void 0 || record3.projectId === projectId2) && (profileId === void 0 || record3.profileId === profileId) && (filter.enabled === void 0 || record3.enabled === filter.enabled));
  }
  async create(input) {
    assertSafeSharedState(input, "ProjectAgentBindingCreate");
    const projectId2 = parseProjectId2(input.projectId);
    const profileId = parseAgentProfileId(input.profileId);
    const now = this.store.now();
    const record3 = {
      schemaVersion: 1,
      bindingId: bindingIdFor(projectId2, profileId),
      projectId: projectId2,
      projectContextFingerprint: input.projectContextFingerprint,
      profileId,
      profileRevision: input.profileRevision,
      revision: 1,
      role: input.role,
      enabled: input.enabled ?? true,
      memoryScopes: [...input.memoryScopes ?? ["recentContext", "openItems", "stableMemory"]],
      connectorGrantRefs: [...input.connectorGrantRefs ?? []],
      createdAt: now,
      createdBy: input.actor,
      updatedAt: now,
      updatedBy: input.actor
    };
    validateProjectAgentBinding(record3);
    return this.store.create(record3);
  }
  async update(bindingId, expectedRevision, patch, actor2) {
    assertSafeSharedState({ patch, actor: actor2 }, "ProjectAgentBindingPatch");
    parseBindingId(bindingId);
    return this.store.update(bindingId, expectedRevision, (current, now) => validateProjectAgentBinding({
      ...current,
      ...patch,
      memoryScopes: [...patch.memoryScopes ?? current.memoryScopes],
      connectorGrantRefs: [...patch.connectorGrantRefs ?? current.connectorGrantRefs],
      revision: current.revision + 1,
      previousRevision: { revision: current.revision, digest: canonicalDigest(current) },
      updatedAt: now,
      updatedBy: actor2
    }));
  }
};
var ThreadStore = class {
  store;
  constructor(options) {
    this.store = new RevisionStore({
      ...options,
      kind: "Thread",
      collectionDirectory: "threads",
      directoryForId: (id2) => join5("threads", threadSlug(parseThreadId(id2))),
      idOf: (record3) => record3.threadId,
      validate: validateThread
    });
  }
  read(threadId) {
    parseThreadId(threadId);
    return this.store.read(threadId);
  }
  readRevision(threadId, revision) {
    parseThreadId(threadId);
    return this.store.readRevision(threadId, revision);
  }
  async list(filter = {}) {
    const projectId2 = filter.projectId === void 0 ? void 0 : parseProjectId2(filter.projectId);
    const profileId = filter.profileId === void 0 ? void 0 : parseAgentProfileId(filter.profileId);
    const bindingId = filter.bindingId === void 0 ? void 0 : parseBindingId(filter.bindingId);
    const records = await this.store.list();
    return records.filter((record3) => (projectId2 === void 0 || record3.projectId === projectId2) && (profileId === void 0 || record3.profileId === profileId) && (bindingId === void 0 || record3.bindingId === bindingId) && (filter.lifecycle === void 0 || record3.lifecycle === filter.lifecycle));
  }
  async create(input) {
    assertSafeSharedState(input, "ThreadCreate");
    const now = this.store.now();
    const record3 = {
      schemaVersion: 1,
      threadId: input.threadId ? parseThreadId(input.threadId) : `thread/${randomUUID4()}`,
      revision: 1,
      durability: "durable",
      lifecycle: "open",
      projectId: parseProjectId2(input.projectId),
      bindingId: parseBindingId(input.bindingId),
      bindingRevision: input.bindingRevision,
      profileId: parseAgentProfileId(input.profileId),
      profileRevision: input.profileRevision,
      title: input.title,
      references: [],
      createdAt: now,
      createdBy: input.actor,
      updatedAt: now,
      updatedBy: input.actor
    };
    validateThread(record3);
    return this.store.create(record3);
  }
  appendReference(threadId, expectedRevision, input, actor2) {
    assertSafeSharedState({ input, actor: actor2 }, "ThreadReferenceCreate");
    parseThreadId(threadId);
    return this.store.update(threadId, expectedRevision, (current, now) => {
      if (current.lifecycle !== "open")
        throw new DomainConflictError("Only an open Thread accepts new references", { threadId, lifecycle: current.lifecycle });
      return validateThread({
        ...current,
        revision: current.revision + 1,
        references: [...current.references, {
          ordinal: current.references.length + 1,
          kind: input.kind,
          referenceId: input.referenceId,
          recordedAt: input.recordedAt ?? now,
          ...input.contentHash ? { contentHash: input.contentHash } : {},
          citations: [...input.citations ?? []]
        }],
        previousRevision: { revision: current.revision, digest: canonicalDigest(current) },
        updatedAt: now,
        updatedBy: actor2
      });
    });
  }
  transition(threadId, expectedRevision, lifecycle, actor2) {
    parseThreadId(threadId);
    return this.store.update(threadId, expectedRevision, (current, now) => {
      if (!threadTransitionAllowed(current.lifecycle, lifecycle)) {
        throw new DomainConflictError(`Invalid Thread lifecycle transition ${current.lifecycle} -> ${lifecycle}`, { threadId });
      }
      return validateThread({
        ...current,
        lifecycle,
        revision: current.revision + 1,
        previousRevision: { revision: current.revision, digest: canonicalDigest(current) },
        updatedAt: now,
        updatedBy: actor2
      });
    });
  }
};
function threadTransitionAllowed(from, to) {
  if (from === to)
    return false;
  if (from === "open")
    return to === "closed" || to === "archived";
  if (from === "closed")
    return to === "open" || to === "archived";
  return false;
}
function profileSlug(profileId) {
  return profileId.slice("agent/".length);
}
function threadSlug(threadId) {
  return threadId.slice("thread/".length);
}
async function latestRevisionFiles(collectionRoot) {
  const results = [];
  const visit = async (directory) => {
    let entries;
    try {
      entries = await readdir2(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT")
        return;
      throw error;
    }
    if (basename2(directory) === "revisions") {
      const revisions = entries.filter((entry) => entry.isFile() && /^\d{12}\.json$/.test(entry.name)).map((entry) => entry.name).sort();
      const latest = revisions.at(-1);
      if (latest)
        results.push(join5(directory, latest));
      return;
    }
    for (const entry of entries.filter((entry2) => entry2.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
      await visit(join5(directory, entry.name));
    }
  };
  await visit(collectionRoot);
  return results.sort((left, right) => left.localeCompare(right));
}
async function atomicCreate3(path, content) {
  await mkdir4(dirname4(path), { recursive: true });
  const temporary = join5(dirname4(path), `.${basename2(path)}.${process.pid}.${randomUUID4()}.tmp`);
  const handle = await open4(temporary, "wx", 384);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    if (await exists3(path))
      throw new DomainConflictError("Immutable target already exists");
    await rename4(temporary, path);
    await syncDirectory2(dirname4(path));
  } catch (error) {
    await rm4(temporary, { force: true });
    throw error;
  }
}
async function syncDirectory2(path) {
  try {
    const directory = await open4(path, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch {
  }
}
async function exists3(path) {
  try {
    await stat4(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT")
      return false;
    throw error;
  }
}

// ../packages/agent-domain/dist/src/service.js
import { randomUUID as randomUUID5 } from "node:crypto";
var AgentDomainService = class {
  profiles;
  bindings;
  threads;
  constructor(options) {
    this.profiles = new AgentProfileStore(options);
    this.bindings = new ProjectAgentBindingStore(options);
    this.threads = new ThreadStore(options);
  }
  createProfile(input) {
    return this.profiles.create(input);
  }
  updateProfile(profileId, expectedRevision, patch, actor2) {
    return this.profiles.update(profileId, expectedRevision, patch, actor2);
  }
  async createBinding(input) {
    parseProjectId2(input.projectId);
    const profile = await this.profiles.readRevision(parseAgentProfileId(input.profileId), input.profileRevision);
    if (!profile)
      throw new DomainNotFoundError(`Agent Profile ${input.profileId} revision ${input.profileRevision} does not exist`);
    return this.bindings.create(input);
  }
  async updateBinding(bindingId, expectedRevision, patch, actor2) {
    const current = await this.bindings.read(bindingId);
    if (!current)
      throw new DomainNotFoundError(`Project Agent Binding ${bindingId} does not exist`);
    if (patch.profileRevision !== void 0) {
      const profile = await this.profiles.readRevision(current.profileId, patch.profileRevision);
      if (!profile)
        throw new DomainNotFoundError(`Agent Profile ${current.profileId} revision ${patch.profileRevision} does not exist`);
    }
    return this.bindings.update(bindingId, expectedRevision, patch, actor2);
  }
  async createThread(input) {
    const projectId2 = parseProjectId2(input.projectId);
    const profileId = parseAgentProfileId(input.profileId);
    const expectedBindingId = bindingIdFor(projectId2, profileId);
    if (input.bindingId !== expectedBindingId)
      throw new DomainValidationError("Thread binding ID does not match its Project and Profile");
    const binding = await this.bindings.read(input.bindingId);
    if (!binding)
      throw new DomainNotFoundError(`Project Agent Binding ${input.bindingId} revision ${input.bindingRevision} does not exist`);
    if (binding.revision !== input.bindingRevision)
      throw new DomainConflictError("Thread must lock the latest Binding revision", {
        requestedBindingRevision: input.bindingRevision,
        currentBindingRevision: binding.revision
      });
    if (!binding.enabled)
      throw new DomainConflictError("Disabled Project Agent Binding cannot open a durable Thread", { bindingId: binding.bindingId });
    if (binding.profileRevision !== input.profileRevision)
      throw new DomainConflictError("Thread Profile revision does not match locked Binding Profile revision", {
        bindingProfileRevision: binding.profileRevision,
        threadProfileRevision: input.profileRevision
      });
    const profile = await this.profiles.readRevision(profileId, input.profileRevision);
    if (!profile)
      throw new DomainNotFoundError(`Agent Profile ${profileId} revision ${input.profileRevision} does not exist`);
    return this.threads.create(input);
  }
  appendThreadReference(threadId, expectedRevision, reference, actor2) {
    return this.threads.appendReference(threadId, expectedRevision, reference, actor2);
  }
  transitionThread(threadId, expectedRevision, lifecycle, actor2) {
    return this.threads.transition(threadId, expectedRevision, lifecycle, actor2);
  }
  createEphemeralThread(input) {
    assertSafeSharedState(input, "EphemeralThread");
    if (!Number.isInteger(input.profileRevision) || input.profileRevision < 1)
      throw new DomainValidationError("profileRevision must be positive");
    return {
      schemaVersion: 1,
      threadId: input.threadId ? parseThreadId(input.threadId) : `thread/ephemeral-${randomUUID5()}`,
      durability: "ephemeral",
      lifecycle: "open",
      profileId: parseAgentProfileId(input.profileId),
      profileRevision: input.profileRevision,
      title: input.title,
      references: []
    };
  }
};

// dist/fleet/device-capability.js
import { createHash as createHash2, randomUUID as randomUUID6 } from "node:crypto";
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync3, readdirSync as readdirSync2, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname as dirname5, join as join6 } from "node:path";
var DEVICE_CAPABILITY_SCHEMA_VERSION = 1;
var DEVICE_HEALTH_STATUSES = ["available", "degraded", "unavailable"];
var DeviceCapabilityValidationError = class extends Error {
  code = "device_capability_validation";
};
var DeviceCapabilityConflictError = class extends Error {
  code = "device_capability_conflict";
};
var ROOT = "_llmwiki/fleet/device-advertisements";
var TOP_LEVEL_KEYS = /* @__PURE__ */ new Set([
  "schemaVersion",
  "deviceId",
  "issuedAt",
  "expiresAt",
  "health",
  "capabilities",
  "models",
  "connectors",
  "resourceClasses",
  "provenance"
]);
var HEALTH_KEYS = /* @__PURE__ */ new Set(["status", "observedAt", "reasons"]);
var MODEL_KEYS = /* @__PURE__ */ new Set(["provider", "model", "mode"]);
var ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
function fail3(message) {
  throw new DeviceCapabilityValidationError(message);
}
function assertExactKeys(label, value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      fail3(`${label} contains unsupported field ${key}`);
  }
}
function assertPortableString(label, value, max = 512) {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\n") || value.includes("\r")) {
    fail3(`${label} must be a non-empty portable string`);
  }
  if (/(?:lease|handoff)[-_ ]?token|credential|plaintext[_-]?secret|api[_-]?key|process[_-]?handle/i.test(value) || /^(?:[A-Za-z]:[\\/]|\\\\|\/(?:home|opt|mnt|Users)\/|~[\\/]|\.{1,2}[\\/])/.test(value) || /(?:^|[\s:=])(?:[A-Za-z]:[\\/]|\\\\|\/(?:home|opt|mnt|Users)\/|~[\\/]|\.{1,2}[\\/])/.test(value)) {
    fail3(`${label} contains machine-local or secret-bearing material`);
  }
}
function assertTimestamp(label, value) {
  assertPortableString(label, value, 40);
  if (!ISO_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value)))
    fail3(`${label} must be an ISO UTC timestamp`);
}
function portableList(label, value, pattern, max = 128) {
  if (!Array.isArray(value) || value.length > max)
    fail3(`${label} must be an array with at most ${max} entries`);
  const output = value.map((item, index) => {
    assertPortableString(`${label}[${index}]`, item);
    if (!pattern.test(item))
      fail3(`${label}[${index}] has an invalid identifier`);
    return item;
  });
  if (new Set(output).size !== output.length)
    fail3(`${label} must not contain duplicates`);
  return [...output].sort();
}
function canonicalValue(value) {
  if (Array.isArray(value))
    return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const record3 = value;
    return Object.fromEntries(Object.keys(record3).sort().map((key) => [key, canonicalValue(record3[key])]));
  }
  return value;
}
function canonicalJson2(value) {
  return JSON.stringify(canonicalValue(value));
}
function cloneInput(input) {
  return structuredClone(input);
}
function validateDeviceCapabilityAdvertisement(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail3("advertisement must be an object");
  const input = value;
  assertExactKeys("advertisement", input, TOP_LEVEL_KEYS);
  if (input.schemaVersion !== DEVICE_CAPABILITY_SCHEMA_VERSION)
    fail3("schemaVersion must be 1");
  assertPortableString("deviceId", input.deviceId);
  if (!/^device\/[a-z0-9][a-z0-9-]*$/.test(input.deviceId))
    fail3("deviceId must match device/<lowercase-kebab-id>");
  assertTimestamp("issuedAt", input.issuedAt);
  assertTimestamp("expiresAt", input.expiresAt);
  if (Date.parse(input.expiresAt) <= Date.parse(input.issuedAt))
    fail3("expiresAt must be later than issuedAt");
  if (!input.health || typeof input.health !== "object" || Array.isArray(input.health))
    fail3("health must be an object");
  const health = input.health;
  assertExactKeys("health", health, HEALTH_KEYS);
  if (!DEVICE_HEALTH_STATUSES.includes(health.status))
    fail3("health.status is invalid");
  assertTimestamp("health.observedAt", health.observedAt);
  const reasons = portableList("health.reasons", health.reasons, /^[a-z0-9][a-z0-9._:-]*$/);
  const capabilities = portableList("capabilities", input.capabilities, /^[a-z0-9][a-z0-9._:-]*$/);
  const connectors = portableList("connectors", input.connectors, /^connector\/[a-z0-9][a-z0-9-]*$/);
  const resourceClasses = portableList("resourceClasses", input.resourceClasses, /^[a-z0-9][a-z0-9._:/-]*$/);
  const provenance = portableList("provenance", input.provenance, /^[a-z][a-z0-9+.-]*:[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
  if (!Array.isArray(input.models) || input.models.length > 64)
    fail3("models must be an array with at most 64 entries");
  const models = input.models.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      fail3(`models[${index}] must be an object`);
    const model = item;
    assertExactKeys(`models[${index}]`, model, MODEL_KEYS);
    assertPortableString(`models[${index}].provider`, model.provider);
    assertPortableString(`models[${index}].model`, model.model);
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(model.provider) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model.model)) {
      fail3(`models[${index}] contains an invalid provider or model identifier`);
    }
    if (model.mode !== "local" && model.mode !== "cloud")
      fail3(`models[${index}].mode is invalid`);
    return { provider: model.provider, model: model.model, mode: model.mode };
  }).sort((left, right) => canonicalJson2(left).localeCompare(canonicalJson2(right)));
  return {
    schemaVersion: DEVICE_CAPABILITY_SCHEMA_VERSION,
    deviceId: input.deviceId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    health: {
      status: health.status,
      observedAt: health.observedAt,
      reasons
    },
    capabilities,
    models,
    connectors,
    resourceClasses,
    provenance
  };
}
function deviceCapabilityFingerprint(input) {
  const validated = validateDeviceCapabilityAdvertisement(input);
  return createHash2("sha256").update(canonicalJson2(validated), "utf-8").digest("hex");
}
function relativePath(deviceId) {
  return `${ROOT}/${deviceId.slice("device/".length)}.json`;
}
function fullPath(root, path) {
  return join6(root, ...path.split("/"));
}
function parseStored(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail3(`${path} must contain an object`);
  const record3 = value;
  const input = Object.fromEntries([...TOP_LEVEL_KEYS].map((key) => [key, record3[key]]));
  const validated = validateDeviceCapabilityAdvertisement(input);
  if (!Number.isSafeInteger(record3.revision) || record3.revision < 1)
    fail3(`${path} revision is invalid`);
  if (typeof record3.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(record3.fingerprint))
    fail3(`${path} fingerprint is invalid`);
  const actual = deviceCapabilityFingerprint(validated);
  if (actual !== record3.fingerprint)
    fail3(`${path} fingerprint does not match its content`);
  return { ...validated, revision: record3.revision, fingerprint: actual };
}
function readStored(root, path) {
  const target = fullPath(root, path);
  if (!existsSync3(target))
    return null;
  try {
    return parseStored(JSON.parse(readFileSync3(target, "utf-8")), path);
  } catch (error) {
    if (error instanceof DeviceCapabilityValidationError)
      throw error;
    fail3(`${path} is not valid JSON`);
  }
}
function asRecord(stored, path) {
  return { ...cloneInput(stored), revision: stored.revision, fingerprint: stored.fingerprint, path };
}
var DeviceCapabilityRegistry = class {
  root;
  constructor(root) {
    this.root = root;
  }
  publish(value, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new DeviceCapabilityConflictError("expected revision must be a non-negative integer");
    }
    const input = validateDeviceCapabilityAdvertisement(value);
    const path = relativePath(input.deviceId);
    const existing = readStored(this.root, path);
    if ((existing?.revision ?? 0) !== expectedRevision) {
      throw new DeviceCapabilityConflictError(`device advertisement revision conflict: expected ${expectedRevision}, actual ${existing?.revision ?? 0}`);
    }
    const fingerprint = deviceCapabilityFingerprint(input);
    if (existing?.fingerprint === fingerprint)
      return asRecord(existing, path);
    const stored = {
      ...cloneInput(input),
      revision: expectedRevision + 1,
      fingerprint
    };
    const target = fullPath(this.root, path);
    mkdirSync2(dirname5(target), { recursive: true });
    const temporary = `${target}.tmp-${randomUUID6()}`;
    writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}
`, "utf-8");
    try {
      renameSync(temporary, target);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
    return asRecord(stored, path);
  }
  get(deviceId) {
    assertPortableString("deviceId", deviceId);
    if (!/^device\/[a-z0-9][a-z0-9-]*$/.test(deviceId))
      fail3("deviceId must match device/<lowercase-kebab-id>");
    const path = relativePath(deviceId);
    const stored = readStored(this.root, path);
    return stored ? asRecord(stored, path) : null;
  }
  list() {
    const directory = fullPath(this.root, ROOT);
    if (!existsSync3(directory))
      return [];
    return readdirSync2(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => `${ROOT}/${entry.name}`).map((path) => readStored(this.root, path)).filter((item) => item !== null).map((item) => asRecord(item, relativePath(item.deviceId))).sort((left, right) => left.deviceId.localeCompare(right.deviceId));
  }
  listEligible(now = (/* @__PURE__ */ new Date()).toISOString()) {
    assertTimestamp("now", now);
    const timestamp = Date.parse(now);
    return this.list().filter((item) => item.health.status !== "unavailable" && Date.parse(item.expiresAt) > timestamp);
  }
  doctor(now = (/* @__PURE__ */ new Date()).toISOString()) {
    assertTimestamp("now", now);
    const timestamp = Date.parse(now);
    const devices = this.list().map((item) => ({
      deviceId: item.deviceId,
      status: Date.parse(item.expiresAt) <= timestamp ? "stale" : item.health.status,
      expiresAt: item.expiresAt,
      reasons: [...item.health.reasons]
    }));
    return {
      ok: devices.some((item) => item.status === "available" || item.status === "degraded"),
      now,
      devices
    };
  }
};

// dist/host-capabilities/store.js
import { closeSync, existsSync as existsSync4, mkdirSync as mkdirSync3, openSync, readFileSync as readFileSync4, readdirSync as readdirSync3, renameSync as renameSync2, rmSync as rmSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { randomUUID as randomUUID7 } from "node:crypto";
import { dirname as dirname6, join as join7 } from "node:path";

// dist/host-capabilities/contracts.js
import { createHash as createHash3 } from "node:crypto";
var HOST_CAPABILITY_SCHEMA_VERSION = "1.0.0";
var HostCapabilityContractError = class extends Error {
  code = "invalid_host_capability_contract";
  constructor(message) {
    super(message);
    this.name = "HostCapabilityContractError";
  }
};
var ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;
var VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;
var SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
var SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|token|secret|password|passphrase|api[-_]?key|private[-_]?key|client[-_]?secret|headers?)/i;
var WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
var POSIX_HOME_PATH_PATTERN = /^\/(?:Users|home|root)\//;
function fail4(path, message) {
  throw new HostCapabilityContractError(`${path}: ${message}`);
}
function assertString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    fail4(path, "must be a non-empty string");
  }
}
function assertIdentifier(value, path) {
  assertString(value, path);
  if (!ID_PATTERN.test(value)) {
    fail4(path, "must be a stable lowercase identifier");
  }
}
function assertVersion(value, path) {
  assertString(value, path);
  if (!VERSION_PATTERN.test(value)) {
    fail4(path, "must be a stable version string");
  }
}
function parseTimestamp(value, path) {
  assertString(value, path);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    fail4(path, "must be an ISO-8601 timestamp");
  }
  return parsed;
}
function assertSchemaVersion(value, path) {
  if (value !== HOST_CAPABILITY_SCHEMA_VERSION) {
    fail4(path, `must equal ${HOST_CAPABILITY_SCHEMA_VERSION}`);
  }
}
function assertStringList(value, path) {
  if (!Array.isArray(value)) {
    fail4(path, "must be an array");
  }
  const seen = /* @__PURE__ */ new Set();
  value.forEach((item, index) => {
    assertIdentifier(item, `${path}[${index}]`);
    if (seen.has(item)) {
      fail4(`${path}[${index}]`, "must not contain duplicates");
    }
    seen.add(item);
  });
}
function assertNoSensitiveMaterial(value, path) {
  if (typeof value === "string") {
    if (/\bBearer\s+[A-Za-z0-9._~+/=-]+/i.test(value)) {
      fail4(path, "must not contain bearer credentials");
    }
    if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(value) || POSIX_HOME_PATH_PATTERN.test(value)) {
      fail4(path, "must not contain machine-local absolute paths");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSensitiveMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        fail4(`${path}.${key}`, "sensitive keys are forbidden");
      }
      assertNoSensitiveMaterial(entry, `${path}.${key}`);
    }
  }
}
function validateCapabilityImportProvenance(provenance) {
  if (!provenance || typeof provenance !== "object") {
    fail4("importProvenance", "must be an object");
  }
  assertSchemaVersion(provenance.schemaVersion, "importProvenance.schemaVersion");
  try {
    const sourceUrl = new URL(provenance.source.url);
    if (sourceUrl.protocol !== "https:" && sourceUrl.protocol !== "http:") {
      fail4("importProvenance.source.url", "must use http or https");
    }
  } catch (error) {
    if (error instanceof HostCapabilityContractError)
      throw error;
    fail4("importProvenance.source.url", "must be a valid canonical URL");
  }
  if (!["commit", "version"].includes(provenance.source.revision.kind)) {
    fail4("importProvenance.source.revision.kind", "must be commit or version");
  }
  assertString(provenance.source.revision.value, "importProvenance.source.revision.value");
  if (!SHA256_PATTERN.test(provenance.source.contentHash)) {
    fail4("importProvenance.source.contentHash", "must be a sha256 digest");
  }
  if (!["approved", "rejected", "needs-review"].includes(provenance.licenseReview.status)) {
    fail4("importProvenance.licenseReview.status", "must be approved, rejected, or needs-review");
  }
  assertString(provenance.licenseReview.expression, "importProvenance.licenseReview.expression");
  assertString(provenance.licenseReview.reviewedBy, "importProvenance.licenseReview.reviewedBy");
  parseTimestamp(provenance.licenseReview.reviewedAt, "importProvenance.licenseReview.reviewedAt");
  assertIdentifier(provenance.importer.name, "importProvenance.importer.name");
  assertVersion(provenance.importer.version, "importProvenance.importer.version");
  if (!["approved", "rejected", "pending", "stale"].includes(provenance.approval.status)) {
    fail4("importProvenance.approval.status", "has an unsupported value");
  }
  if (provenance.approval.status === "approved") {
    assertString(provenance.approval.reviewedBy, "importProvenance.approval.reviewedBy");
    parseTimestamp(provenance.approval.reviewedAt, "importProvenance.approval.reviewedAt");
  }
  assertNoSensitiveMaterial(provenance, "importProvenance");
}
function validateCapabilityHealth(health) {
  if (!health || typeof health !== "object") {
    fail4("health", "must be an object");
  }
  assertSchemaVersion(health.schemaVersion, "health.schemaVersion");
  if (!["available", "degraded", "unavailable", "disabled"].includes(health.state)) {
    fail4("health.state", "has an unsupported value");
  }
  const observedAt = parseTimestamp(health.observedAt, "health.observedAt");
  if (health.expiresAt) {
    const expiresAt = parseTimestamp(health.expiresAt, "health.expiresAt");
    if (expiresAt <= observedAt) {
      fail4("health.expiresAt", "must be later than observedAt");
    }
  }
  assertStringList(health.reasonCodes, "health.reasonCodes");
  assertStringList(health.remediationKeys, "health.remediationKeys");
  assertNoSensitiveMaterial(health.diagnostics, "health.diagnostics");
}
function validateExpertDescriptor(descriptor) {
  if (!descriptor || typeof descriptor !== "object") {
    fail4("descriptor", "must be an object");
  }
  assertSchemaVersion(descriptor.schemaVersion, "descriptor.schemaVersion");
  assertIdentifier(descriptor.descriptorId, "descriptor.descriptorId");
  assertVersion(descriptor.descriptorVersion, "descriptor.descriptorVersion");
  assertString(descriptor.displayName, "descriptor.displayName");
  assertStringList(descriptor.capabilities, "descriptor.capabilities");
  if (!Array.isArray(descriptor.operations) || descriptor.operations.length === 0) {
    fail4("descriptor.operations", "must contain at least one operation");
  }
  const operationIds = /* @__PURE__ */ new Set();
  descriptor.operations.forEach((operation, index) => {
    const path = `descriptor.operations[${index}]`;
    assertIdentifier(operation.operation, `${path}.operation`);
    assertString(operation.description, `${path}.description`);
    assertIdentifier(operation.grantKey, `${path}.grantKey`);
    if (![
      "none",
      "local-read",
      "local-write",
      "external-read",
      "external-write"
    ].includes(operation.sideEffectClass)) {
      fail4(`${path}.sideEffectClass`, "has an unsupported value");
    }
    if (operationIds.has(operation.operation)) {
      fail4(`${path}.operation`, "must be unique");
    }
    operationIds.add(operation.operation);
    assertNoSensitiveMaterial(operation.inputSchema, `${path}.inputSchema`);
  });
  if (descriptor.models)
    assertStringList(descriptor.models, "descriptor.models");
  if (descriptor.deviceAffinities) {
    assertStringList(descriptor.deviceAffinities, "descriptor.deviceAffinities");
  }
  if (descriptor.resourceClasses) {
    assertStringList(descriptor.resourceClasses, "descriptor.resourceClasses");
  }
  if (descriptor.cost) {
    if (!["free", "fixed", "estimated", "unknown"].includes(descriptor.cost.kind)) {
      fail4("descriptor.cost.kind", "has an unsupported value");
    }
    if (descriptor.cost.kind === "fixed" || descriptor.cost.kind === "estimated") {
      if (typeof descriptor.cost.amount !== "number" || !Number.isFinite(descriptor.cost.amount) || descriptor.cost.amount < 0) {
        fail4("descriptor.cost.amount", "must be a non-negative finite number");
      }
      assertString(descriptor.cost.currency, "descriptor.cost.currency");
    }
  }
  assertIdentifier(descriptor.connectorRef.connectorId, "descriptor.connectorRef.connectorId");
  assertVersion(descriptor.connectorRef.connectorVersion, "descriptor.connectorRef.connectorVersion");
  validateCapabilityImportProvenance(descriptor.importProvenance);
}
function validateHostCapabilityConnector(connector) {
  if (!connector || typeof connector !== "object") {
    fail4("connector", "must be an object");
  }
  assertSchemaVersion(connector.schemaVersion, "connector.schemaVersion");
  assertIdentifier(connector.connectorId, "connector.connectorId");
  assertVersion(connector.connectorVersion, "connector.connectorVersion");
  assertString(connector.displayName, "connector.displayName");
  if (![
    "mcp",
    "local-cli",
    "cloud-agent",
    "remote-workflow",
    "local-model",
    "cloud-model"
  ].includes(connector.kind)) {
    fail4("connector.kind", "has an unsupported value");
  }
  if (!["mock", "stdio", "http", "in-process"].includes(connector.transport)) {
    fail4("connector.transport", "has an unsupported value");
  }
  assertStringList(connector.supportedOperations, "connector.supportedOperations");
  validateCapabilityImportProvenance(connector.importProvenance);
}
function validateAssignmentPlan(plan) {
  if (!plan || typeof plan !== "object") {
    fail4("assignmentPlan", "must be an object");
  }
  assertSchemaVersion(plan.schemaVersion, "assignmentPlan.schemaVersion");
  assertIdentifier(plan.planId, "assignmentPlan.planId");
  parseTimestamp(plan.plannedAt, "assignmentPlan.plannedAt");
  if (!/^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/.test(plan.projectId)) {
    fail4("assignmentPlan.projectId", "must be a canonical project/<slug> ID");
  }
  assertIdentifier(plan.workRunId, "assignmentPlan.workRunId");
  if (!/^work-run\/[a-z0-9][a-z0-9._-]*$/.test(plan.workRunId)) {
    fail4("assignmentPlan.workRunId", "must be a canonical Work Run ID");
  }
  assertIdentifier(plan.requirementId, "assignmentPlan.requirementId");
  assertIdentifier(plan.policyId, "assignmentPlan.policyId");
  assertVersion(plan.policyVersion, "assignmentPlan.policyVersion");
  assertIdentifier(plan.grantId, "assignmentPlan.grantId");
  if (plan.projectBinding) {
    assertIdentifier(plan.projectBinding.bindingId, "assignmentPlan.projectBinding.bindingId");
    if (!Number.isInteger(plan.projectBinding.bindingRevision) || plan.projectBinding.bindingRevision < 1) {
      fail4("assignmentPlan.projectBinding.bindingRevision", "must be a positive integer");
    }
    if (!SHA256_PATTERN.test(plan.projectBinding.projectContextFingerprint)) {
      fail4("assignmentPlan.projectBinding.projectContextFingerprint", "must be a sha256 digest");
    }
  }
  if (plan.status === "matched" && !plan.selected) {
    fail4("assignmentPlan.selected", "is required for a matched plan");
  }
  if (plan.status === "no-match" && plan.selected) {
    fail4("assignmentPlan.selected", "must be absent for a no-match plan");
  }
  if (!["pending", "approved", "rejected"].includes(plan.approval.status)) {
    fail4("assignmentPlan.approval.status", "has an unsupported value");
  }
  if (plan.approval.status === "approved") {
    assertString(plan.approval.reviewedBy, "assignmentPlan.approval.reviewedBy");
    parseTimestamp(plan.approval.reviewedAt, "assignmentPlan.approval.reviewedAt");
  }
  if (plan.selected) {
    assertIdentifier(plan.selected.descriptorId, "assignmentPlan.selected.descriptorId");
    assertVersion(plan.selected.descriptorVersion, "assignmentPlan.selected.descriptorVersion");
    if (!SHA256_PATTERN.test(plan.selected.descriptorFingerprint)) {
      fail4("assignmentPlan.selected.descriptorFingerprint", "must be a sha256 digest");
    }
    assertIdentifier(plan.selected.connectorId, "assignmentPlan.selected.connectorId");
    assertVersion(plan.selected.connectorVersion, "assignmentPlan.selected.connectorVersion");
    if (!SHA256_PATTERN.test(plan.selected.connectorFingerprint)) {
      fail4("assignmentPlan.selected.connectorFingerprint", "must be a sha256 digest");
    }
  }
  assertNoSensitiveMaterial(plan, "assignmentPlan");
}
function canonicalize2(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize2);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== void 0).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonicalize2(entry)]));
  }
  return value;
}
function canonicalJson3(value) {
  return JSON.stringify(canonicalize2(value));
}
function fingerprintContract(value) {
  return `sha256:${createHash3("sha256").update(canonicalJson3(value)).digest("hex")}`;
}
function normalizeExpertDescriptor(descriptor) {
  validateExpertDescriptor(descriptor);
  return {
    ...descriptor,
    capabilities: [...descriptor.capabilities].sort(),
    operations: [...descriptor.operations].map((operation) => ({ ...operation })).sort((left, right) => left.operation.localeCompare(right.operation)),
    models: descriptor.models ? [...descriptor.models].sort() : void 0,
    deviceAffinities: descriptor.deviceAffinities ? [...descriptor.deviceAffinities].sort() : void 0,
    resourceClasses: descriptor.resourceClasses ? [...descriptor.resourceClasses].sort() : void 0
  };
}
function normalizeHostCapabilityConnector(connector) {
  validateHostCapabilityConnector(connector);
  return {
    ...connector,
    supportedOperations: [...connector.supportedOperations].sort()
  };
}
function descriptorKey(descriptorId, descriptorVersion) {
  return `${descriptorId}@${descriptorVersion}`;
}
function connectorKey(connectorId, connectorVersion) {
  return `${connectorId}@${connectorVersion}`;
}

// dist/host-capabilities/operation-contracts.js
var HOST_CAPABILITY_OPERATION_SCHEMA_VERSION = 1;
var HostCapabilityOperationContractError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "HostCapabilityOperationContractError";
  }
};
var SHA256_PATTERN2 = /^sha256:[a-f0-9]{64}$/;
var SENSITIVE_KEY_PATTERN2 = /(?:authorization|cookie|token|secret(?!Reference)|password|passphrase|api[-_]?key|private[-_]?key|client[-_]?secret|headers?|env)/i;
var WINDOWS_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
var POSIX_HOME_PATTERN = /^\/(?:Users|home|root)\//;
function fail5(path, message) {
  throw new HostCapabilityOperationContractError(`${path}: ${message}`);
}
function record2(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail5(path, "must be an object");
  }
  return value;
}
function string2(value, path) {
  if (typeof value !== "string" || !value.trim()) {
    fail5(path, "must be a non-empty string");
  }
  return value.trim();
}
function safePublicValue(value, path) {
  if (typeof value === "string") {
    if (/\bBearer\s+\S+/i.test(value))
      fail5(path, "must not contain bearer credentials");
    if (/^https?:\/\/[^\s/@:]+:[^\s/@]+@/i.test(value)) {
      fail5(path, "must not contain URL credentials");
    }
    if (WINDOWS_PATH_PATTERN.test(value) || POSIX_HOME_PATTERN.test(value)) {
      fail5(path, "must not contain machine-local absolute paths");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => safePublicValue(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN2.test(key)) {
        fail5(`${path}.${key}`, "secret values are forbidden; use secretReference");
      }
      safePublicValue(item, `${path}.${key}`);
    }
  }
}
function sourceObservation(value, path) {
  if (value === void 0)
    return void 0;
  const item = record2(value, path);
  const revision = record2(item.revision, `${path}.revision`);
  const kind = string2(revision.kind, `${path}.revision.kind`);
  if (kind !== "commit" && kind !== "version") {
    fail5(`${path}.revision.kind`, "must be commit or version");
  }
  const contentHash = string2(item.contentHash, `${path}.contentHash`);
  if (!SHA256_PATTERN2.test(contentHash))
    fail5(`${path}.contentHash`, "must be a sha256 digest");
  const observedAt = string2(item.observedAt, `${path}.observedAt`);
  if (!Number.isFinite(Date.parse(observedAt)))
    fail5(`${path}.observedAt`, "must be a timestamp");
  return {
    revision: {
      kind,
      value: string2(revision.value, `${path}.revision.value`)
    },
    contentHash,
    observedAt
  };
}
function validateConnectorConfiguration(value) {
  const item = record2(value ?? {}, "configuration");
  const allowed = /* @__PURE__ */ new Set(["parameters", "secretRequired", "secretReference"]);
  for (const key of Object.keys(item)) {
    if (!allowed.has(key))
      fail5(`configuration.${key}`, "is not supported");
  }
  const parameters = item.parameters === void 0 ? void 0 : record2(item.parameters, "configuration.parameters");
  safePublicValue(parameters, "configuration.parameters");
  if (item.secretRequired !== void 0 && typeof item.secretRequired !== "boolean") {
    fail5("configuration.secretRequired", "must be boolean");
  }
  let secretReference;
  if (item.secretReference !== void 0) {
    const reference = record2(item.secretReference, "configuration.secretReference");
    const provider = string2(reference.provider, "configuration.secretReference.provider");
    if (!(/* @__PURE__ */ new Set(["os-keychain", "environment", "external-vault"])).has(provider)) {
      fail5("configuration.secretReference.provider", "has an unsupported value");
    }
    const locator = string2(reference.locator, "configuration.secretReference.locator");
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(locator)) {
      fail5("configuration.secretReference.locator", "must be a logical locator");
    }
    secretReference = {
      provider,
      locator,
      ...reference.version === void 0 ? {} : { version: string2(reference.version, "configuration.secretReference.version") }
    };
  }
  return {
    ...parameters ? { parameters: structuredClone(parameters) } : {},
    ...item.secretRequired === void 0 ? {} : { secretRequired: item.secretRequired },
    ...secretReference ? { secretReference } : {}
  };
}
function validateDescriptorRegistration(value) {
  const item = record2(value, "registration");
  if (item.schemaVersion !== HOST_CAPABILITY_OPERATION_SCHEMA_VERSION) {
    fail5("registration.schemaVersion", "must equal 1");
  }
  validateExpertDescriptor(item.descriptor);
  validateCapabilityHealth(item.health);
  return {
    schemaVersion: HOST_CAPABILITY_OPERATION_SCHEMA_VERSION,
    descriptor: structuredClone(item.descriptor),
    health: structuredClone(item.health),
    sourceObservation: sourceObservation(item.sourceObservation, "registration.sourceObservation")
  };
}
function validateConnectorRegistration(value) {
  const item = record2(value, "registration");
  if (item.schemaVersion !== HOST_CAPABILITY_OPERATION_SCHEMA_VERSION) {
    fail5("registration.schemaVersion", "must equal 1");
  }
  validateHostCapabilityConnector(item.connector);
  validateCapabilityHealth(item.health);
  return {
    schemaVersion: HOST_CAPABILITY_OPERATION_SCHEMA_VERSION,
    connector: structuredClone(item.connector),
    health: structuredClone(item.health),
    configuration: validateConnectorConfiguration(item.configuration),
    sourceObservation: sourceObservation(item.sourceObservation, "registration.sourceObservation")
  };
}

// dist/host-capabilities/store.js
var HOST_CAPABILITY_RELATIVE_ROOT = "_llmwiki/host-capabilities/v1";
var HostCapabilityStoreError = class extends Error {
  code;
  logicalId;
  constructor(code, message, logicalId) {
    super(message);
    this.code = code;
    this.logicalId = logicalId;
    this.name = "HostCapabilityStoreError";
  }
};
function storageName(logicalId) {
  return fingerprintContract(logicalId).slice("sha256:".length);
}
function relativeFile(kind, logicalId) {
  return `${HOST_CAPABILITY_RELATIVE_ROOT}/${kind}/${storageName(logicalId)}.json`;
}
function normalizedDescriptorRegistration(value) {
  return {
    ...value,
    descriptor: normalizeExpertDescriptor(value.descriptor),
    health: structuredClone(value.health),
    sourceObservation: value.sourceObservation ? structuredClone(value.sourceObservation) : void 0
  };
}
function normalizedConnectorRegistration(value) {
  return {
    ...value,
    connector: normalizeHostCapabilityConnector(value.connector),
    health: structuredClone(value.health),
    configuration: structuredClone(value.configuration),
    sourceObservation: value.sourceObservation ? structuredClone(value.sourceObservation) : void 0
  };
}
var HostCapabilityStore = class {
  vaultPath;
  constructor(vaultPath) {
    this.vaultPath = vaultPath;
  }
  registerDescriptor(value) {
    const registration = normalizedDescriptorRegistration(validateDescriptorRegistration(value));
    const logicalId = descriptorKey(registration.descriptor.descriptorId, registration.descriptor.descriptorVersion);
    return this.#create("descriptors", logicalId, registration);
  }
  registerConnector(value) {
    const registration = normalizedConnectorRegistration(validateConnectorRegistration(value));
    const logicalId = connectorKey(registration.connector.connectorId, registration.connector.connectorVersion);
    return this.#create("connectors", logicalId, registration);
  }
  readDescriptor(descriptorId, descriptorVersion) {
    const logicalId = descriptorKey(descriptorId, descriptorVersion);
    return validateDescriptorRegistration(this.#read("descriptors", logicalId));
  }
  readConnector(connectorId, connectorVersion) {
    const logicalId = connectorKey(connectorId, connectorVersion);
    return validateConnectorRegistration(this.#read("connectors", logicalId));
  }
  listDescriptors() {
    return this.#list("descriptors").map(validateDescriptorRegistration).sort((left, right) => left.descriptor.descriptorId.localeCompare(right.descriptor.descriptorId) || left.descriptor.descriptorVersion.localeCompare(right.descriptor.descriptorVersion));
  }
  listConnectors() {
    return this.#list("connectors").map(validateConnectorRegistration).sort((left, right) => left.connector.connectorId.localeCompare(right.connector.connectorId) || left.connector.connectorVersion.localeCompare(right.connector.connectorVersion));
  }
  saveAssignmentPlan(plan) {
    validateAssignmentPlan(plan);
    return this.#create("assignments", plan.planId, structuredClone(plan));
  }
  readAssignmentPlan(planId) {
    const value = this.#read("assignments", planId);
    validateAssignmentPlan(value);
    return structuredClone(value);
  }
  listAssignmentPlans() {
    return this.#list("assignments").map((value) => {
      validateAssignmentPlan(value);
      return structuredClone(value);
    }).sort((left, right) => left.planId.localeCompare(right.planId));
  }
  approveAssignmentPlan(input) {
    const relative2 = relativeFile("assignments", input.planId);
    const absolute = join7(this.vaultPath, ...relative2.split("/"));
    const lock = `${absolute}.lock`;
    mkdirSync3(dirname6(absolute), { recursive: true });
    let lockHandle;
    try {
      lockHandle = openSync(lock, "wx");
    } catch {
      throw new HostCapabilityStoreError("conflict", `AssignmentPlan ${input.planId} is being updated`, input.planId);
    }
    try {
      const current = this.readAssignmentPlan(input.planId);
      const currentFingerprint = fingerprintContract(current);
      if (current.approval.status === "approved") {
        if (current.approval.reviewedBy !== input.approvedBy) {
          throw new HostCapabilityStoreError("conflict", `AssignmentPlan ${input.planId} is already approved by another actor`, input.planId);
        }
        return {
          value: current,
          fingerprint: currentFingerprint,
          storageKey: relative2,
          replayed: true
        };
      }
      if (current.status !== "matched" || !current.selected) {
        throw new HostCapabilityStoreError("conflict", `AssignmentPlan ${input.planId} has no eligible selection to approve`, input.planId);
      }
      if (current.approval.status !== "pending") {
        throw new HostCapabilityStoreError("conflict", `AssignmentPlan ${input.planId} is not pending approval`, input.planId);
      }
      if (currentFingerprint !== input.expectedFingerprint) {
        throw new HostCapabilityStoreError("conflict", `AssignmentPlan ${input.planId} changed before approval`, input.planId);
      }
      if (!input.approvedBy.trim()) {
        throw new HostCapabilityStoreError("conflict", "AssignmentPlan approval requires an approver identity", input.planId);
      }
      if (!Number.isFinite(Date.parse(input.approvedAt))) {
        throw new HostCapabilityStoreError("conflict", "AssignmentPlan approval requires a valid timestamp", input.planId);
      }
      const approved = {
        ...current,
        approval: {
          status: "approved",
          reviewedBy: input.approvedBy.trim(),
          reviewedAt: input.approvedAt
        }
      };
      validateAssignmentPlan(approved);
      const temporary = `${absolute}.${randomUUID7()}.tmp`;
      writeFileSync2(temporary, `${canonicalJson3(approved)}
`, {
        encoding: "utf8",
        flag: "wx"
      });
      renameSync2(temporary, absolute);
      return {
        value: structuredClone(approved),
        fingerprint: fingerprintContract(approved),
        storageKey: relative2,
        replayed: false
      };
    } finally {
      closeSync(lockHandle);
      rmSync2(lock, { force: true });
    }
  }
  #create(kind, logicalId, value) {
    const relative2 = relativeFile(kind, logicalId);
    const absolute = join7(this.vaultPath, ...relative2.split("/"));
    const bytes = `${canonicalJson3(value)}
`;
    mkdirSync3(dirname6(absolute), { recursive: true });
    try {
      writeFileSync2(absolute, bytes, { encoding: "utf8", flag: "wx" });
      return {
        value: structuredClone(value),
        fingerprint: fingerprintContract(value),
        storageKey: relative2,
        replayed: false
      };
    } catch (error) {
      if (error.code !== "EEXIST")
        throw error;
      const existing = this.#parseFile(absolute, logicalId);
      if (canonicalJson3(existing) !== canonicalJson3(value)) {
        throw new HostCapabilityStoreError("conflict", `${logicalId} already exists with different content`, logicalId);
      }
      return {
        value: structuredClone(existing),
        fingerprint: fingerprintContract(existing),
        storageKey: relative2,
        replayed: true
      };
    }
  }
  #read(kind, logicalId) {
    const relative2 = relativeFile(kind, logicalId);
    const absolute = join7(this.vaultPath, ...relative2.split("/"));
    if (!existsSync4(absolute)) {
      throw new HostCapabilityStoreError("not_found", `${logicalId} is not registered`, logicalId);
    }
    return this.#parseFile(absolute, logicalId);
  }
  #list(kind) {
    const relative2 = `${HOST_CAPABILITY_RELATIVE_ROOT}/${kind}`;
    const absolute = join7(this.vaultPath, ...relative2.split("/"));
    if (!existsSync4(absolute))
      return [];
    return readdirSync3(absolute, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name).sort().map((name) => this.#parseFile(join7(absolute, name), `${kind}/${name}`));
  }
  #parseFile(absolute, logicalId) {
    try {
      return JSON.parse(readFileSync4(absolute, "utf8"));
    } catch {
      throw new HostCapabilityStoreError("corrupt", `${logicalId} contains invalid persisted JSON`, logicalId);
    }
  }
};

// ../packages/settings-platform/dist/src/canonical.js
import { createHash as createHash4 } from "node:crypto";
function canonicalize3(value) {
  if (Array.isArray(value))
    return value.map(canonicalize3);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== void 0).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, canonicalize3(child)]));
  }
  return value;
}
function canonicalJson4(value) {
  return JSON.stringify(canonicalize3(value));
}
function canonicalDigest2(value) {
  return `sha256:${createHash4("sha256").update(canonicalJson4(value)).digest("hex")}`;
}
function deepClone2(value) {
  return JSON.parse(JSON.stringify(value));
}

// ../packages/settings-platform/dist/registry/v1.json
var v1_default = {
  schemaVersion: 1,
  registryVersion: "1.6.0",
  definitions: [
    {
      key: "models.agent.mode",
      owner: "models.agent-runtime",
      category: "models",
      name: "Agent model mode",
      description: "Choose legacy environment inheritance, a local OpenAI-compatible model, or a cloud model connection.",
      valueType: "enum",
      defaultValue: "inherit",
      allowedScopes: ["user-device", "vault", "session"],
      sensitivity: "public",
      validator: { id: "enum", enum: ["inherit", "local", "cloud"] },
      requires: [],
      applyMode: "next-operation",
      visibility: "normal"
    },
    {
      key: "models.agent.provider",
      owner: "models.agent-runtime",
      category: "models",
      name: "Agent model provider",
      description: "Provider identity passed to the Agent/Compiler OpenAI-compatible runtime.",
      valueType: "enum",
      defaultValue: "ollama",
      allowedScopes: ["user-device", "vault", "session"],
      sensitivity: "public",
      validator: { id: "enum", enum: ["ollama", "openai-compatible", "anthropic", "qwen", "doubao", "minimax"] },
      requires: ["models.agent.mode"],
      applyMode: "next-operation",
      visibility: "normal"
    },
    {
      key: "models.agent.base_url",
      owner: "models.agent-runtime",
      category: "models",
      name: "Agent model base URL",
      description: "OpenAI-compatible API base URL used by the Agent/Compiler runtime.",
      valueType: "string",
      defaultValue: "http://127.0.0.1:11434/v1",
      allowedScopes: ["user-device", "vault", "session"],
      sensitivity: "public",
      validator: { id: "url", required: true, pattern: "^https?://[^\\s]+$" },
      requires: ["models.agent.mode"],
      applyMode: "next-operation",
      visibility: "advanced",
      placeholder: "http://127.0.0.1:11434/v1"
    },
    {
      key: "models.agent.model",
      owner: "models.agent-runtime",
      category: "models",
      name: "Agent model identifier",
      description: "Model identifier sent to the configured Agent/Compiler endpoint.",
      valueType: "string",
      defaultValue: "qwen3:8b",
      allowedScopes: ["user-device", "vault", "session"],
      sensitivity: "public",
      validator: { id: "non-empty-string", required: true, minLength: 1, maxLength: 200 },
      requires: ["models.agent.mode"],
      applyMode: "next-operation",
      visibility: "normal",
      placeholder: "qwen3:8b"
    },
    {
      key: "models.agent.secret_ref",
      owner: "models.agent-runtime",
      category: "models",
      name: "Agent cloud credential reference",
      description: "Opaque reference to the cloud model credential; local mode never resolves or forwards it.",
      valueType: "secret-reference",
      defaultSecretRef: {
        provider: "environment",
        locator: "OPENAI_API_KEY"
      },
      allowedScopes: ["user-device", "session"],
      sensitivity: "secret-reference",
      validator: { id: "secret-reference" },
      requires: ["models.agent.mode"],
      applyMode: "next-operation",
      visibility: "advanced",
      placeholder: "environment:OPENAI_API_KEY"
    },
    {
      key: "adapters.enabled",
      owner: "runtime.adapter-registry",
      category: "adapters",
      name: "Enabled runtime adapters",
      description: "Select the adapters initialized by the MCP host. Legacy VAULT_MIND_ADAPTERS is consulted only while this key remains at product scope.",
      valueType: "list",
      defaultValue: ["filesystem", "memu", "gitnexus", "obsidian", "kanban", "qmd", "lightrag", "raganything", "hindsight", "vaultbrain", "graphify"],
      allowedScopes: ["user-device", "vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "adapter-list" },
      requires: [],
      applyMode: "restart-required",
      visibility: "normal"
    },
    {
      key: "adapters.memu.dsn",
      owner: "runtime.adapter-memu",
      category: "adapters",
      name: "MemU PostgreSQL endpoint",
      description: "Credential-free PostgreSQL DSN for MemU. A credential-bearing DSN must be stored behind the separate Secret Reference.",
      valueType: "string",
      defaultValue: "postgresql://localhost:5432/memu",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "url", required: true, pattern: "^postgres(?:ql)?://[^\\s?#]+$" },
      requires: ["adapters.enabled"],
      applyMode: "restart-required",
      visibility: "advanced",
      placeholder: "postgresql://localhost:5432/memu"
    },
    {
      key: "adapters.memu.secret_ref",
      owner: "runtime.adapter-memu",
      category: "adapters",
      name: "MemU database credential reference",
      description: "Optional device-local reference to the complete credential-bearing DSN, resolved only immediately before MemU construction.",
      valueType: "secret-reference",
      defaultSecretRef: { provider: "environment", locator: "MEMU_DSN" },
      allowedScopes: ["user-device", "session"],
      sensitivity: "secret-reference",
      validator: { id: "secret-reference" },
      requires: ["adapters.memu.dsn"],
      applyMode: "restart-required",
      visibility: "advanced",
      placeholder: "environment:MEMU_DSN"
    },
    {
      key: "adapters.memu.user_id",
      owner: "runtime.adapter-memu",
      category: "adapters",
      name: "MemU user scope",
      description: "MemU user_id filter used for recall queries.",
      valueType: "string",
      defaultValue: "default",
      allowedScopes: ["user-device", "vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "non-empty-string", required: true, maxLength: 300 },
      requires: ["adapters.memu.dsn"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "adapters.memu.max_results",
      owner: "runtime.adapter-memu",
      category: "adapters",
      name: "MemU default result limit",
      description: "Default maximum MemU results before per-query overrides.",
      valueType: "integer",
      defaultValue: 20,
      allowedScopes: ["vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "integer", min: 1, max: 100 },
      requires: ["adapters.memu.dsn"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "adapters.memu.query_timeout_ms",
      owner: "runtime.adapter-memu",
      category: "adapters",
      name: "MemU query timeout",
      description: "PostgreSQL query timeout for MemU recall.",
      valueType: "integer",
      defaultValue: 5e3,
      allowedScopes: ["user-device", "vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "integer", min: 100, max: 3e5 },
      requires: ["adapters.memu.dsn"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "adapters.memu.exclude_memory_types",
      owner: "runtime.adapter-memu",
      category: "adapters",
      name: "MemU excluded memory types",
      description: "Memory types excluded from the high-dimensional fallback query.",
      valueType: "list",
      defaultValue: ["event"],
      allowedScopes: ["vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "string-list" },
      requires: ["adapters.memu.dsn"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "adapters.memu.graph_python",
      owner: "runtime.adapter-memu",
      category: "adapters",
      name: "MemU graph Python",
      description: "Device-local Python executable for memu_graph recall.",
      valueType: "path",
      defaultValue: "python",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "non-empty-path", required: true, maxLength: 1e3 },
      requires: ["adapters.memu.dsn"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "adapters.memu.graph_cwd",
      owner: "runtime.adapter-memu",
      category: "adapters",
      name: "MemU graph working directory",
      description: "Device-local working directory from which memu_graph can be imported.",
      valueType: "path",
      defaultValue: ".",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "non-empty-path", required: true, maxLength: 2e3 },
      requires: ["adapters.memu.dsn"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "adapters.memu.graph_timeout_ms",
      owner: "runtime.adapter-memu",
      category: "adapters",
      name: "MemU graph timeout",
      description: "Timeout for the memu_graph subprocess recall path.",
      valueType: "integer",
      defaultValue: 15e3,
      allowedScopes: ["user-device", "vault", "session"],
      sensitivity: "public",
      validator: { id: "integer", min: 100, max: 3e5 },
      requires: ["adapters.memu.dsn"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "adapters.memu.search_script",
      owner: "runtime.adapter-memu",
      category: "adapters",
      name: "MemU fallback search script",
      description: "Device-local memu_search.py path used when graph recall is unavailable.",
      valueType: "path",
      defaultValue: "memu_search.py",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "non-empty-path", required: true, maxLength: 2e3 },
      requires: ["adapters.memu.dsn"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "adapters.memu.search_python",
      owner: "runtime.adapter-memu",
      category: "adapters",
      name: "MemU fallback Python",
      description: "Device-local Python executable for the MemU fallback search script.",
      valueType: "path",
      defaultValue: "python",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "non-empty-path", required: true, maxLength: 1e3 },
      requires: ["adapters.memu.dsn"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "adapters.memu.search_timeout_ms",
      owner: "runtime.adapter-memu",
      category: "adapters",
      name: "MemU fallback timeout",
      description: "Timeout for the MemU fallback search subprocess.",
      valueType: "integer",
      defaultValue: 2e4,
      allowedScopes: ["user-device", "vault", "session"],
      sensitivity: "public",
      validator: { id: "integer", min: 100, max: 3e5 },
      requires: ["adapters.memu.dsn"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "adapters.memu.embed_model",
      owner: "runtime.adapter-memu",
      category: "adapters",
      name: "MemU embedding model",
      description: "Ollama embedding model used for MemU graph recall.",
      valueType: "string",
      defaultValue: "bge-m3",
      allowedScopes: ["user-device", "vault", "session"],
      sensitivity: "public",
      validator: { id: "non-empty-string", required: true, maxLength: 300 },
      requires: ["adapters.memu.dsn"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "adapters.lightrag.base_url",
      owner: "runtime.adapter-lightrag",
      category: "adapters",
      name: "LightRAG base URL",
      description: "Device-local LightRAG HTTP endpoint. Credentials must use the separate Secret Reference.",
      valueType: "string",
      defaultValue: "",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "url" },
      requires: ["adapters.enabled"],
      applyMode: "restart-required",
      visibility: "advanced",
      placeholder: "http://127.0.0.1:9621"
    },
    {
      key: "adapters.lightrag.secret_ref",
      owner: "runtime.adapter-lightrag",
      category: "adapters",
      name: "LightRAG credential reference",
      description: "Opaque device-local credential locator resolved only immediately before the LightRAG adapter is constructed.",
      valueType: "secret-reference",
      defaultSecretRef: { provider: "environment", locator: "LIGHTRAG_API_KEY" },
      allowedScopes: ["user-device", "session"],
      sensitivity: "secret-reference",
      validator: { id: "secret-reference" },
      requires: ["adapters.lightrag.base_url"],
      applyMode: "restart-required",
      visibility: "advanced",
      placeholder: "environment:LIGHTRAG_API_KEY"
    },
    {
      key: "adapters.lightrag.mode",
      owner: "runtime.adapter-lightrag",
      category: "adapters",
      name: "LightRAG query mode",
      description: "Query mode forwarded to the LightRAG HTTP API.",
      valueType: "enum",
      defaultValue: "hybrid",
      allowedScopes: ["vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "enum", enum: ["naive", "local", "global", "hybrid", "mix"] },
      requires: ["adapters.lightrag.base_url"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "adapters.lightrag.query_path",
      owner: "runtime.adapter-lightrag",
      category: "adapters",
      name: "LightRAG query path",
      description: "LightRAG text-query API path.",
      valueType: "string",
      defaultValue: "/query",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "http-path", required: true, pattern: "^/[^\\s]*$" },
      requires: ["adapters.lightrag.base_url"],
      applyMode: "restart-required",
      visibility: "internal"
    },
    {
      key: "adapters.lightrag.query_data_path",
      owner: "runtime.adapter-lightrag",
      category: "adapters",
      name: "LightRAG structured-query path",
      description: "LightRAG structured query API path used before text fallback.",
      valueType: "string",
      defaultValue: "/query/data",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "http-path", required: true, pattern: "^/[^\\s]*$" },
      requires: ["adapters.lightrag.base_url"],
      applyMode: "restart-required",
      visibility: "internal"
    },
    {
      key: "adapters.lightrag.documents_text_path",
      owner: "runtime.adapter-lightrag",
      category: "adapters",
      name: "LightRAG text-ingest path",
      description: "LightRAG plain-text document ingest API path.",
      valueType: "string",
      defaultValue: "/documents/text",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "http-path", required: true, pattern: "^/[^\\s]*$" },
      requires: ["adapters.lightrag.base_url"],
      applyMode: "restart-required",
      visibility: "internal"
    },
    {
      key: "adapters.lightrag.documents_upload_path",
      owner: "runtime.adapter-lightrag",
      category: "adapters",
      name: "LightRAG upload path",
      description: "LightRAG binary document upload API path.",
      valueType: "string",
      defaultValue: "/documents/upload",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "http-path", required: true, pattern: "^/[^\\s]*$" },
      requires: ["adapters.lightrag.base_url"],
      applyMode: "restart-required",
      visibility: "internal"
    },
    {
      key: "adapters.raganything.base_url",
      owner: "runtime.adapter-raganything",
      category: "adapters",
      name: "RAG-Anything base URL",
      description: "Device-local RAG-Anything wrapper endpoint. Credentials must use the separate Secret Reference.",
      valueType: "string",
      defaultValue: "",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "url" },
      requires: ["adapters.enabled"],
      applyMode: "restart-required",
      visibility: "advanced",
      placeholder: "http://127.0.0.1:9622"
    },
    {
      key: "adapters.raganything.secret_ref",
      owner: "runtime.adapter-raganything",
      category: "adapters",
      name: "RAG-Anything credential reference",
      description: "Opaque device-local credential locator resolved only immediately before the RAG-Anything adapter is constructed.",
      valueType: "secret-reference",
      defaultSecretRef: { provider: "environment", locator: "RAGANYTHING_API_KEY" },
      allowedScopes: ["user-device", "session"],
      sensitivity: "secret-reference",
      validator: { id: "secret-reference" },
      requires: ["adapters.raganything.base_url"],
      applyMode: "restart-required",
      visibility: "advanced",
      placeholder: "environment:RAGANYTHING_API_KEY"
    },
    {
      key: "adapters.raganything.query_path",
      owner: "runtime.adapter-raganything",
      category: "adapters",
      name: "RAG-Anything query path",
      description: "RAG-Anything wrapper query API path.",
      valueType: "string",
      defaultValue: "/query",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "http-path", required: true, pattern: "^/[^\\s]*$" },
      requires: ["adapters.raganything.base_url"],
      applyMode: "restart-required",
      visibility: "internal"
    },
    {
      key: "adapters.raganything.process_path",
      owner: "runtime.adapter-raganything",
      category: "adapters",
      name: "RAG-Anything process path",
      description: "RAG-Anything wrapper document processing API path.",
      valueType: "string",
      defaultValue: "/process_document",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "http-path", required: true, pattern: "^/[^\\s]*$" },
      requires: ["adapters.raganything.base_url"],
      applyMode: "restart-required",
      visibility: "internal"
    },
    {
      key: "adapters.hindsight.base_url",
      owner: "runtime.adapter-hindsight",
      category: "adapters",
      name: "Hindsight base URL",
      description: "Device-local Hindsight HTTP endpoint used for provider-neutral read-only recall.",
      valueType: "string",
      defaultValue: "",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "url" },
      requires: ["adapters.enabled", "adapters.hindsight.bank_id"],
      applyMode: "restart-required",
      visibility: "advanced",
      placeholder: "http://127.0.0.1:8888"
    },
    {
      key: "adapters.hindsight.bank_id",
      owner: "runtime.adapter-hindsight",
      category: "adapters",
      name: "Hindsight bank ID",
      description: "External Hindsight bank selected for read-only recall; it does not become LLM Wiki Memory authority.",
      valueType: "string",
      defaultValue: "",
      allowedScopes: ["user-device", "vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "string", maxLength: 300 },
      requires: ["adapters.hindsight.base_url"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "adapters.hindsight.timeout_ms",
      owner: "runtime.adapter-hindsight",
      category: "adapters",
      name: "Hindsight recall timeout",
      description: "Fail-closed timeout for the read-only Hindsight recall request.",
      valueType: "integer",
      defaultValue: 1e4,
      allowedScopes: ["user-device", "vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "integer", min: 100, max: 3e5 },
      requires: ["adapters.hindsight.base_url"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "adapters.hindsight.secret_ref",
      owner: "runtime.adapter-hindsight",
      category: "adapters",
      name: "Hindsight credential reference",
      description: "Optional opaque device-local credential locator resolved only immediately before the Hindsight adapter is constructed.",
      valueType: "secret-reference",
      defaultSecretRef: { provider: "environment", locator: "HINDSIGHT_API_KEY" },
      allowedScopes: ["user-device", "session"],
      sensitivity: "secret-reference",
      validator: { id: "secret-reference" },
      requires: ["adapters.hindsight.base_url"],
      applyMode: "restart-required",
      visibility: "advanced",
      placeholder: "environment:HINDSIGHT_API_KEY"
    },
    {
      key: "adapters.kanban.glob",
      owner: "runtime.adapter-kanban",
      category: "adapters",
      name: "Kanban board glob",
      description: "Vault-relative Markdown glob scanned by the read-only Kanban adapter.",
      valueType: "string",
      defaultValue: "**/*.md",
      allowedScopes: ["vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "non-empty-string", required: true, maxLength: 500 },
      requires: ["adapters.enabled"],
      applyMode: "restart-required",
      visibility: "advanced",
      placeholder: "Projects/**/*.md"
    },
    {
      key: "adapters.qmd.collection",
      owner: "runtime.adapter-qmd",
      category: "adapters",
      name: "QMD collection",
      description: "Optional QMD collection name. Empty means query all local collections.",
      valueType: "string",
      defaultValue: "",
      allowedScopes: ["user-device", "vault", "session"],
      sensitivity: "local",
      validator: { id: "string", maxLength: 200 },
      requires: ["adapters.enabled"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "adapters.qmd.binary",
      owner: "runtime.adapter-qmd",
      category: "adapters",
      name: "QMD executable",
      description: "Device-local QMD executable name or path.",
      valueType: "path",
      defaultValue: "qmd",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "non-empty-path", required: true, maxLength: 1e3 },
      requires: ["adapters.enabled"],
      applyMode: "restart-required",
      visibility: "advanced"
    },
    {
      key: "diagnostics.obc.semantic.enabled",
      owner: "diagnostics.obc",
      category: "diagnostics",
      name: "Link-diagnostics semantic suggestions",
      description: "Add optional semantic suggestions while deterministic link diagnostics remain available.",
      valueType: "boolean",
      defaultValue: false,
      allowedScopes: ["vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "boolean" },
      requires: ["query.semantic.enabled"],
      applyMode: "next-operation",
      visibility: "normal"
    },
    {
      key: "providers.web_search.enabled",
      owner: "providers.web-search",
      category: "providers",
      name: "Web search provider",
      description: "Allow unified query workflows to use the configured web search provider.",
      valueType: "boolean",
      defaultValue: false,
      allowedScopes: ["vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "boolean" },
      requires: ["providers.web_search.secret_ref"],
      applyMode: "next-operation",
      visibility: "normal"
    },
    {
      key: "providers.web_search.secret_ref",
      owner: "providers.web-search",
      category: "providers",
      name: "Web search secret reference",
      description: "Opaque reference to the web search credential; the resolved secret never enters Settings.",
      valueType: "secret-reference",
      defaultSecretRef: {
        provider: "environment",
        locator: "TAVILY_API_KEY"
      },
      allowedScopes: ["user-device", "session"],
      sensitivity: "secret-reference",
      validator: { id: "secret-reference" },
      requires: [],
      applyMode: "next-operation",
      visibility: "advanced",
      placeholder: "environment:TAVILY_API_KEY"
    },
    {
      key: "providers.host_capability.enabled",
      owner: "providers.host-capability",
      category: "providers",
      name: "Host capability connectors",
      description: "Allow approved Expert and MCP capability descriptors to participate in governed assignment.",
      valueType: "boolean",
      defaultValue: false,
      allowedScopes: ["vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "boolean" },
      requires: ["providers.host_capability.provider", "providers.host_capability.transport", "providers.host_capability.endpoint"],
      applyMode: "next-operation",
      visibility: "normal"
    },
    {
      key: "providers.host_capability.provider",
      owner: "providers.host-capability",
      category: "providers",
      name: "Host connector identity",
      description: "Bind a reviewed canonical connector identity such as connector/reviewed-expert, or a generic provider identifier such as reviewed-expert that normalizes to connector/reviewed-expert. This selector grants no authority by itself.",
      valueType: "string",
      defaultValue: "configured-host",
      allowedScopes: ["vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "host-connector-selector", required: true, minLength: 1, maxLength: 200, pattern: "^(?:connector/)?[a-z0-9][a-z0-9._-]*(?:/[a-z0-9][a-z0-9._-]*)*$" },
      requires: [],
      applyMode: "next-operation",
      visibility: "normal"
    },
    {
      key: "providers.host_capability.transport",
      owner: "providers.host-capability",
      category: "providers",
      name: "Host capability transport",
      description: "Select a stdio, HTTP, OAuth, local-model, or cloud-model host adapter; the governed connector registry remains the source of capability facts.",
      valueType: "enum",
      defaultValue: "stdio",
      allowedScopes: ["user-device", "vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "enum", enum: ["stdio", "http", "oauth", "local-model", "cloud-model"] },
      requires: [],
      applyMode: "next-operation",
      visibility: "normal"
    },
    {
      key: "providers.host_capability.endpoint",
      owner: "providers.host-capability",
      category: "providers",
      name: "Host capability endpoint",
      description: "Device-local endpoint or approved command descriptor used by the selected host adapter.",
      valueType: "string",
      defaultValue: "stdio://configured-host",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "non-empty-string", required: true, minLength: 1, maxLength: 500 },
      requires: ["providers.host_capability.transport"],
      applyMode: "next-operation",
      visibility: "advanced",
      placeholder: "stdio://configured-host or https://host.example/mcp"
    },
    {
      key: "providers.host_capability.secret_ref",
      owner: "providers.host-capability",
      category: "providers",
      name: "Host capability credential reference",
      description: "Opaque credential locator for OAuth, HTTP, or cloud-model hosts; plaintext credential values never enter Settings or connector records.",
      valueType: "secret-reference",
      defaultSecretRef: {
        provider: "environment",
        locator: "LLMWIKI_HOST_CAPABILITY_KEY"
      },
      allowedScopes: ["user-device", "session"],
      sensitivity: "secret-reference",
      validator: { id: "secret-reference" },
      requires: ["providers.host_capability.transport"],
      applyMode: "next-operation",
      visibility: "advanced",
      placeholder: "environment:LLMWIKI_HOST_CAPABILITY_KEY"
    },
    {
      key: "providers.host_capability.timeout_ms",
      owner: "providers.host-capability",
      category: "providers",
      name: "Host capability timeout",
      description: "Fail-closed timeout for governed host search, describe, and invoke operations.",
      valueType: "integer",
      defaultValue: 3e4,
      allowedScopes: ["user-device", "vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "integer", min: 100, max: 3e5 },
      requires: ["providers.host_capability.enabled"],
      applyMode: "next-operation",
      visibility: "advanced"
    },
    {
      key: "providers.project_tracker.enabled",
      owner: "providers.project-tracker",
      category: "providers",
      name: "Project Tracker projection",
      description: "Enable the selected GitHub, Gitea, Linear, or Plane External Projection without granting Host Capability authority.",
      valueType: "boolean",
      defaultValue: false,
      allowedScopes: ["vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "boolean" },
      requires: ["providers.project_tracker.provider", "providers.project_tracker.transport", "providers.project_tracker.endpoint", "providers.project_tracker.secret_ref"],
      applyMode: "next-operation",
      visibility: "normal"
    },
    {
      key: "providers.project_tracker.provider",
      owner: "providers.project-tracker",
      category: "providers",
      name: "Project Tracker provider",
      description: "Select the External Projection provider independently from executable Host Capability Connectors.",
      valueType: "enum",
      defaultValue: "github",
      allowedScopes: ["vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "enum", enum: ["github", "gitea", "linear", "plane"] },
      requires: [],
      applyMode: "next-operation",
      visibility: "normal"
    },
    {
      key: "providers.project_tracker.transport",
      owner: "providers.project-tracker",
      category: "providers",
      name: "Project Tracker transport",
      description: "Select the governed HTTP or OAuth transport used for one tracker operation.",
      valueType: "enum",
      defaultValue: "http",
      allowedScopes: ["user-device", "vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "enum", enum: ["http", "oauth"] },
      requires: [],
      applyMode: "next-operation",
      visibility: "normal"
    },
    {
      key: "providers.project_tracker.endpoint",
      owner: "providers.project-tracker",
      category: "providers",
      name: "Project Tracker endpoint",
      description: "Public Plane Cloud, self-hosted, forge, or board API base URL; credentials in URLs are rejected by consumers.",
      valueType: "string",
      defaultValue: "https://api.plane.so",
      allowedScopes: ["user-device", "vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "non-empty-string", required: true, minLength: 1, maxLength: 500 },
      requires: ["providers.project_tracker.transport"],
      applyMode: "next-operation",
      visibility: "advanced",
      placeholder: "https://api.plane.so or https://plane.example"
    },
    {
      key: "providers.project_tracker.secret_ref",
      owner: "providers.project-tracker",
      category: "providers",
      name: "Project Tracker credential reference",
      description: "Device-local opaque credential locator; the resolved GitHub, Gitea, Linear, or Plane secret never enters Settings.",
      valueType: "secret-reference",
      defaultSecretRef: {
        provider: "environment",
        locator: "LLMWIKI_PROJECT_TRACKER_KEY"
      },
      allowedScopes: ["user-device", "session"],
      sensitivity: "secret-reference",
      validator: { id: "secret-reference" },
      requires: ["providers.project_tracker.transport"],
      applyMode: "next-operation",
      visibility: "advanced",
      placeholder: "environment:PLANE_API_KEY"
    },
    {
      key: "providers.project_tracker.timeout_ms",
      owner: "providers.project-tracker",
      category: "providers",
      name: "Project Tracker timeout",
      description: "End-to-end fail-closed deadline for the next Project Tracker pull or apply operation.",
      valueType: "integer",
      defaultValue: 3e4,
      allowedScopes: ["user-device", "vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "integer", min: 100, max: 3e5 },
      requires: ["providers.project_tracker.enabled"],
      applyMode: "next-operation",
      visibility: "advanced"
    },
    {
      key: "agents.dream_time.warning_free_auto_approval",
      owner: "agents.dream-time",
      category: "agents",
      name: "Warning-free Dream Time auto-approval hook",
      description: "Reserved schema hook for a future policy; it defaults off and current runtimes continue to require explicit human approval.",
      valueType: "boolean",
      defaultValue: false,
      allowedScopes: ["vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "boolean" },
      requires: [],
      applyMode: "next-operation",
      visibility: "advanced"
    },
    {
      key: "agents.dream_time.cadence.daily.enabled",
      owner: "agents.dream-time",
      category: "agents",
      name: "Daily Dream Time cadence",
      description: "Allow an explicit Project-scoped invocation to create one checkpoint Work Run and proposal per UTC day; no background process is started.",
      valueType: "boolean",
      defaultValue: false,
      allowedScopes: ["vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "boolean" },
      requires: [],
      applyMode: "next-operation",
      visibility: "advanced"
    },
    {
      key: "agents.dream_time.cadence.weekly.enabled",
      owner: "agents.dream-time",
      category: "agents",
      name: "Weekly Dream Time cadence",
      description: "Allow an explicit Project-scoped invocation to create one learn Work Run and proposal per Monday-based UTC week; no background process is started.",
      valueType: "boolean",
      defaultValue: false,
      allowedScopes: ["vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "boolean" },
      requires: [],
      applyMode: "next-operation",
      visibility: "advanced"
    },
    {
      key: "agents.dream_time.cadence.monthly.enabled",
      owner: "agents.dream-time",
      category: "agents",
      name: "Monthly Dream Time cadence",
      description: "Allow an explicit Project-scoped invocation to create one review Work Run and proposal per UTC month; no background process is started.",
      valueType: "boolean",
      defaultValue: false,
      allowedScopes: ["vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "boolean" },
      requires: [],
      applyMode: "next-operation",
      visibility: "advanced"
    },
    {
      key: "query.semantic.enabled",
      owner: "query.semantic",
      category: "query",
      name: "Semantic query",
      description: "Enable semantic retrieval when its configured provider is available.",
      valueType: "boolean",
      defaultValue: false,
      allowedScopes: ["vault", "workspace-project", "session"],
      sensitivity: "public",
      validator: { id: "boolean" },
      requires: [],
      applyMode: "next-operation",
      visibility: "normal"
    },
    {
      key: "runtime.kb_meta.path",
      owner: "runtime.python",
      category: "runtime",
      name: "LLM Wiki runtime entry",
      description: "Machine-local path to compiler/kb_meta.py.",
      valueType: "path",
      defaultValue: "",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "non-empty-path", required: true },
      requires: ["runtime.python.path"],
      applyMode: "next-operation",
      visibility: "advanced"
    },
    {
      key: "runtime.python.path",
      owner: "runtime.python",
      category: "runtime",
      name: "Python runtime",
      description: "Machine-local Python executable used by LLM Wiki capabilities.",
      valueType: "path",
      defaultValue: "python",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "non-empty-path", required: true },
      requires: [],
      applyMode: "next-operation",
      visibility: "normal"
    },
    {
      key: "vault.id",
      owner: "vault.identity",
      category: "vault",
      name: "Vault identity",
      description: "Stable identity of the active vault, independent of its device-local path.",
      valueType: "string",
      defaultValue: "",
      allowedScopes: ["vault", "session"],
      sensitivity: "public",
      validator: { id: "non-empty-string", required: true, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" },
      requires: [],
      applyMode: "restart-required",
      visibility: "normal"
    },
    {
      key: "vault.path",
      owner: "vault.identity",
      category: "vault",
      name: "Vault path",
      description: "Device-local filesystem path of the active vault.",
      valueType: "path",
      defaultValue: "",
      allowedScopes: ["user-device", "session"],
      sensitivity: "local",
      validator: { id: "non-empty-path", required: true },
      requires: ["vault.id"],
      applyMode: "restart-required",
      visibility: "normal"
    }
  ],
  migrations: [
    {
      id: "settings-document-v0-to-v1",
      fromSchemaVersion: 0,
      toSchemaVersion: 1,
      description: "Normalize legacy host-local settings into scoped Settings documents."
    }
  ]
};

// ../packages/settings-platform/dist/src/registry.js
import { readFileSync as readFileSync5 } from "node:fs";
function loadRegistry(path) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync5(path, "utf8"));
  } catch (error) {
    throw new Error(`Settings registry could not be loaded: ${error.message}`);
  }
  return parseRegistry(parsed);
}
function parseRegistry(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Settings registry must be a JSON object");
  }
  const raw = parsed;
  if (!Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 1) {
    throw new Error("Settings registry schemaVersion must be a positive integer");
  }
  if (typeof raw.registryVersion !== "string" || !raw.registryVersion.trim()) {
    throw new Error("Settings registry registryVersion is required");
  }
  if (!Array.isArray(raw.definitions) || !Array.isArray(raw.migrations)) {
    throw new Error("Settings registry definitions and migrations must be arrays");
  }
  const material = {
    schemaVersion: raw.schemaVersion,
    registryVersion: raw.registryVersion,
    definitions: raw.definitions,
    migrations: raw.migrations
  };
  const digest3 = canonicalDigest2(material);
  if (raw.registryDigest && raw.registryDigest !== digest3) {
    throw new Error(`Settings registry digest mismatch: expected ${raw.registryDigest}, calculated ${digest3}`);
  }
  const registry2 = { ...deepClone2(material), registryDigest: digest3 };
  validateRegistry(registry2);
  return registry2;
}
function definitionMap(registry2) {
  return new Map(registry2.definitions.map((definition) => [definition.key, definition]));
}
function getDefinition(registry2, key) {
  return registry2.definitions.find((definition) => definition.key === key);
}
function validateRegistry(registry2) {
  const keys = /* @__PURE__ */ new Set();
  for (const rawDefinition of registry2.definitions) {
    if (!rawDefinition || typeof rawDefinition !== "object" || Array.isArray(rawDefinition)) {
      throw new Error("Setting definition must be a JSON object");
    }
    const definition = rawDefinition;
    if (!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(definition.key)) {
      throw new Error(`Setting key must be namespaced: ${definition.key}`);
    }
    if (keys.has(definition.key))
      throw new Error(`Duplicate setting definition: ${definition.key}`);
    keys.add(definition.key);
    if (![definition.owner, definition.category, definition.name, definition.description].every((value) => typeof value === "string" && value.trim())) {
      throw new Error(`Setting definition metadata is incomplete: ${definition.key}`);
    }
    if (!SETTING_VALUE_TYPES.has(definition.valueType)) {
      throw new Error(`Setting definition has an invalid valueType: ${definition.key}`);
    }
    if (!Array.isArray(definition.allowedScopes) || definition.allowedScopes.length === 0 || new Set(definition.allowedScopes).size !== definition.allowedScopes.length || definition.allowedScopes.some((scope) => !MUTABLE_SCOPES.has(scope))) {
      throw new Error(`Setting definition has no allowed scopes: ${definition.key}`);
    }
    if (!SENSITIVITIES.has(definition.sensitivity)) {
      throw new Error(`Setting definition has an invalid sensitivity: ${definition.key}`);
    }
    if (!APPLY_MODES.has(definition.applyMode) || !VISIBILITIES.has(definition.visibility)) {
      throw new Error(`Setting definition presentation metadata is invalid: ${definition.key}`);
    }
    if (!definition.validator || typeof definition.validator !== "object" || Array.isArray(definition.validator) || typeof definition.validator.id !== "string" || !definition.validator.id.trim()) {
      throw new Error(`Setting definition validator is incomplete: ${definition.key}`);
    }
    validateValidator(definition);
    if (!Array.isArray(definition.requires) || definition.requires.some((key) => typeof key !== "string") || new Set(definition.requires).size !== definition.requires.length) {
      throw new Error(`Setting definition requirements are invalid: ${definition.key}`);
    }
    if (definition.valueType === "secret-reference") {
      if (!isSecretReference(definition.defaultSecretRef) || definition.defaultValue !== void 0) {
        throw new Error(`Secret setting must define defaultSecretRef only: ${definition.key}`);
      }
      if (definition.sensitivity !== "secret-reference") {
        throw new Error(`Secret setting must use secret-reference sensitivity: ${definition.key}`);
      }
    } else {
      if (definition.defaultSecretRef !== void 0) {
        throw new Error(`Non-secret setting cannot define defaultSecretRef: ${definition.key}`);
      }
      if (definition.defaultValue === void 0 || !defaultMatchesType(definition)) {
        throw new Error(`Setting default does not match ${definition.valueType}: ${definition.key}`);
      }
    }
  }
  for (const migration of registry2.migrations) {
    if (!migration || typeof migration !== "object" || Array.isArray(migration)) {
      throw new Error("Settings migration must be a JSON object");
    }
    const item = migration;
    if (typeof item.id !== "string" || !item.id.trim() || typeof item.description !== "string" || !item.description.trim() || !Number.isInteger(item.fromSchemaVersion) || item.fromSchemaVersion < 0 || !Number.isInteger(item.toSchemaVersion) || item.toSchemaVersion < 1) {
      throw new Error(`Settings migration is invalid: ${item.id ?? "unknown"}`);
    }
  }
}
var SETTING_VALUE_TYPES = /* @__PURE__ */ new Set(["boolean", "integer", "number", "string", "enum", "path", "duration", "list", "object", "secret-reference"]);
var MUTABLE_SCOPES = /* @__PURE__ */ new Set(["user-device", "vault", "workspace-project", "session"]);
var SENSITIVITIES = /* @__PURE__ */ new Set(["public", "local", "secret-reference"]);
var APPLY_MODES = /* @__PURE__ */ new Set(["hot", "next-operation", "restart-required"]);
var VISIBILITIES = /* @__PURE__ */ new Set(["normal", "advanced", "internal"]);
var SECRET_PROVIDERS = /* @__PURE__ */ new Set(["os-keychain", "environment", "external-vault"]);
var ENVIRONMENT_LOCATOR_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
var OPAQUE_SECRET_LOCATOR_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,63})+$/;
var SECRET_MATERIAL_RE = /^(?:bearer\s+|sk[-_][A-Za-z0-9_-]{8,}|api[_-]?key\s*[:=])/i;
function validateValidator(definition) {
  const validator = definition.validator;
  if (validator.required !== void 0 && typeof validator.required !== "boolean") {
    throw new Error(`Setting validator required flag is invalid: ${definition.key}`);
  }
  if (validator.enum !== void 0 && (!Array.isArray(validator.enum) || validator.enum.some((value) => typeof value !== "string") || new Set(validator.enum).size !== validator.enum.length)) {
    throw new Error(`Setting validator enum is invalid: ${definition.key}`);
  }
  for (const value of [validator.min, validator.max]) {
    if (value !== void 0 && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error(`Setting validator numeric bound is invalid: ${definition.key}`);
    }
  }
  for (const value of [validator.minLength, validator.maxLength]) {
    if (value !== void 0 && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`Setting validator length bound is invalid: ${definition.key}`);
    }
  }
  if (validator.pattern !== void 0) {
    if (typeof validator.pattern !== "string")
      throw new Error(`Setting validator pattern is invalid: ${definition.key}`);
    try {
      new RegExp(validator.pattern);
    } catch {
      throw new Error(`Setting validator pattern is invalid: ${definition.key}`);
    }
  }
}
function isSecretReference(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return false;
  const ref = value;
  return typeof ref.provider === "string" && SECRET_PROVIDERS.has(ref.provider) && typeof ref.locator === "string" && validSecretLocator(ref.provider, ref.locator) && (ref.version === void 0 || typeof ref.version === "string" && ref.version.length > 0);
}
function validSecretLocator(provider, locator) {
  const normalized = locator.trim();
  if (!normalized || normalized !== locator || /[\r\n\0]/.test(normalized) || SECRET_MATERIAL_RE.test(normalized))
    return false;
  if (provider === "environment")
    return ENVIRONMENT_LOCATOR_RE.test(normalized);
  if (provider === "os-keychain" || provider === "external-vault")
    return OPAQUE_SECRET_LOCATOR_RE.test(normalized);
  return false;
}
function defaultMatchesType(definition) {
  const value = definition.defaultValue;
  switch (definition.valueType) {
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
    case "enum":
    case "path":
    case "duration":
      return typeof value === "string";
    case "list":
      return Array.isArray(value);
    case "object":
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    default:
      return false;
  }
}

// ../packages/settings-platform/dist/src/bundled-registry.js
var registry = parseRegistry(v1_default);
function bundledRegistry() {
  return deepClone2(registry);
}

// ../packages/settings-platform/dist/src/validation.js
var SECRET_PROVIDERS2 = /* @__PURE__ */ new Set(["os-keychain", "environment", "external-vault"]);
var PROJECT_ID_RE4 = /^project\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
var ENVIRONMENT_LOCATOR_RE2 = /^[A-Za-z_][A-Za-z0-9_]*$/;
var OPAQUE_SECRET_LOCATOR_RE2 = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,63})+$/;
var SECRET_MATERIAL_RE2 = /^(?:bearer\s+|sk[-_][A-Za-z0-9_-]{8,}|api[_-]?key\s*[:=])/i;
function issue(code, message, options = {}) {
  return { code, severity: "error", message, ...options };
}
function validateSettingsDocuments(registry2, documents, context) {
  const issues = [];
  const definitions = definitionMap(registry2);
  const identities = /* @__PURE__ */ new Set();
  if (context?.workspaceProjectId && !isCanonicalProjectId(context.workspaceProjectId)) {
    issues.push(issue("invalid-workspace-project-id", "workspaceProjectId must use the canonical project/<lowercase-kebab-slug> form.", { targetId: context.workspaceProjectId }));
  }
  for (const candidate of documents) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      issues.push(issue("invalid-settings-document", "Settings document must be a JSON object."));
      continue;
    }
    const document = candidate;
    const identity = `${document.scope}:${document.targetId}`;
    if (identities.has(identity)) {
      issues.push(issue("duplicate-scope-document", `Duplicate settings document for ${identity}.`, {
        scope: document.scope,
        targetId: document.targetId
      }));
      continue;
    }
    identities.add(identity);
    issues.push(...validateDocumentShape(document));
    if (context && isMutableSettingsScope(document.scope) && !scopeMatchesContext(document.scope, document.targetId, context)) {
      issues.push({
        code: "scope-out-of-context",
        severity: "warning",
        message: `${identity} is outside the supplied runtime context and will not participate in resolution.`,
        scope: document.scope,
        targetId: document.targetId
      });
    }
    if (!Array.isArray(document.assignments) || !isMutableSettingsScope(document.scope))
      continue;
    const keys = /* @__PURE__ */ new Set();
    for (const rawAssignment of document.assignments) {
      if (!rawAssignment || typeof rawAssignment !== "object" || Array.isArray(rawAssignment)) {
        issues.push(issue("invalid-assignment", "Setting assignment must be a JSON object.", {
          scope: document.scope,
          targetId: document.targetId
        }));
        continue;
      }
      const assignment = rawAssignment;
      if (typeof assignment.key !== "string" || !assignment.key) {
        issues.push(issue("invalid-assignment", "Setting assignment key is required.", {
          scope: document.scope,
          targetId: document.targetId
        }));
        continue;
      }
      if (keys.has(assignment.key)) {
        issues.push(issue("duplicate-assignment", `Duplicate assignment for ${assignment.key}.`, {
          key: assignment.key,
          scope: document.scope,
          targetId: document.targetId
        }));
        continue;
      }
      keys.add(assignment.key);
      const definition = definitions.get(assignment.key);
      if (!definition) {
        issues.push({
          code: "unknown-setting",
          severity: "warning",
          message: `Unknown setting ${assignment.key} is preserved but ignored.`,
          key: assignment.key,
          scope: document.scope,
          targetId: document.targetId,
          remediation: "Remove the orphaned assignment or install a registry version that defines it."
        });
        continue;
      }
      issues.push(...validateAssignment2(definition, document.scope, document.targetId, assignment));
    }
  }
  return { valid: issues.every((item) => item.severity !== "error"), issues };
}
function validateAssignment2(definition, scope, targetId, assignment) {
  const options = { key: definition.key, scope, targetId };
  const issues = [];
  if (!definition.allowedScopes.includes(scope)) {
    issues.push(issue("scope-not-allowed", `${definition.key} cannot be assigned at ${scope} scope.`, options));
  }
  if (!assignment.provenance || typeof assignment.provenance.actor !== "string" || !assignment.provenance.actor.trim() || typeof assignment.provenance.source !== "string" || !assignment.provenance.source.trim()) {
    issues.push(issue("missing-provenance", `${definition.key} assignment provenance is required.`, options));
  }
  if (assignment.expiresAt !== void 0 && scope !== "session") {
    issues.push(issue("expiry-not-allowed", `${definition.key} expiry is only valid at session scope.`, options));
  } else if (assignment.expiresAt !== void 0 && !isRfc3339Timestamp(assignment.expiresAt)) {
    issues.push(issue("invalid-expiry", `${definition.key} expiry must be an ISO timestamp.`, options));
  }
  if (definition.valueType === "secret-reference") {
    if (assignment.value !== void 0 || !isSecretReference2(assignment.secretRef)) {
      issues.push(issue("invalid-secret-reference", `${definition.key} must contain a Secret Reference; plaintext secret material is never accepted.`, { ...options, remediation: "Store the secret in an approved provider and assign only its opaque reference." }));
    }
    return issues;
  }
  if (assignment.secretRef !== void 0 || assignment.value === void 0) {
    issues.push(issue("invalid-value", `${definition.key} must contain a typed value.`, options));
    return issues;
  }
  issues.push(...validateValue(definition, assignment.value, options));
  return issues;
}
function validateEffectiveValue(definition, value) {
  if (definition.valueType === "secret-reference") {
    const secretRef = value?.secretRef;
    const issues2 = isSecretReference2(secretRef) ? [] : [issue("invalid-secret-reference", `${definition.key} has no valid Secret Reference.`, { key: definition.key })];
    return { valid: issues2.length === 0, issues: issues2 };
  }
  const issues = validateValue(definition, value, { key: definition.key });
  return { valid: issues.length === 0, issues };
}
function validateDocumentShape(document) {
  const scope = isMutableSettingsScope(document.scope) ? document.scope : void 0;
  const targetId = typeof document.targetId === "string" ? document.targetId : void 0;
  const options = { scope, targetId };
  const issues = [];
  if (document.schemaVersion !== 1) {
    issues.push(issue("unsupported-schema-version", `Unsupported settings schema version ${document.schemaVersion}.`, options));
  }
  if (!Number.isInteger(document.revision) || document.revision < 0) {
    issues.push(issue("invalid-revision", "Settings revision must be a non-negative integer.", options));
  }
  if (!isMutableSettingsScope(document.scope)) {
    issues.push(issue("invalid-scope", "Settings scope must be user-device, vault, workspace-project, or session.", options));
  }
  if (!document.targetId || typeof document.targetId !== "string") {
    issues.push(issue("invalid-target", "Settings targetId is required.", options));
  } else if (document.scope === "workspace-project" && !isCanonicalProjectId(document.targetId)) {
    issues.push(issue("invalid-workspace-project-id", "workspace-project targetId must use the canonical project/<lowercase-kebab-slug> form.", options));
  }
  if (!Array.isArray(document.assignments)) {
    issues.push(issue("invalid-assignments", "Settings assignments must be an array.", options));
  }
  if (!isRfc3339Timestamp(document.updatedAt)) {
    issues.push(issue("invalid-updated-at", "Settings updatedAt must be an ISO timestamp.", options));
  }
  if (typeof document.updatedBy !== "string" || !document.updatedBy) {
    issues.push(issue("invalid-updated-by", "Settings updatedBy is required.", options));
  }
  return issues;
}
function isMutableSettingsScope(value) {
  return value === "user-device" || value === "vault" || value === "workspace-project" || value === "session";
}
function isRfc3339Timestamp(value) {
  if (typeof value !== "string")
    return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match)
    return false;
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, , offsetHourRaw, offsetMinuteRaw] = match;
  const [year, month, day, hour, minute, second] = [yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw].map(Number);
  if (hour > 23 || minute > 59 || second > 59 || offsetHourRaw !== void 0 && Number(offsetHourRaw) > 23 || offsetMinuteRaw !== void 0 && Number(offsetMinuteRaw) > 59)
    return false;
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day && !Number.isNaN(Date.parse(value));
}
function validateValue(definition, value, options) {
  const issues = [];
  const type = definition.valueType;
  const validType = type === "boolean" && typeof value === "boolean" || type === "integer" && Number.isInteger(value) || type === "number" && typeof value === "number" && Number.isFinite(value) || ["string", "enum", "path", "duration"].includes(type) && typeof value === "string" || type === "list" && Array.isArray(value) || type === "object" && value !== null && typeof value === "object" && !Array.isArray(value);
  if (!validType) {
    return [issue("type-mismatch", `${definition.key} must be a ${type}.`, options)];
  }
  const validator = definition.validator;
  if (validator.required && typeof value === "string" && !value.trim()) {
    issues.push(issue("required-value-missing", `${definition.key} is required.`, options));
  }
  if (validator.enum && !validator.enum.includes(value)) {
    issues.push(issue("enum-mismatch", `${definition.key} must use an allowed value.`, options));
  }
  if (typeof value === "string") {
    const length = [...value].length;
    if (validator.minLength !== void 0 && length < validator.minLength) {
      issues.push(issue("string-too-short", `${definition.key} is shorter than allowed.`, options));
    }
    if (validator.maxLength !== void 0 && length > validator.maxLength) {
      issues.push(issue("string-too-long", `${definition.key} is longer than allowed.`, options));
    }
    if (validator.pattern && !new RegExp(validator.pattern).test(value)) {
      issues.push(issue("pattern-mismatch", `${definition.key} does not match its declared format.`, options));
    }
    if (validator.id === "url" && hasUrlCredentials(value)) {
      issues.push(issue("url-credentials-forbidden", `${definition.key} must not embed credentials in a URL; use a Secret Reference.`, { ...options, remediation: "Remove URL userinfo and bind the credential through a Secret Reference." }));
    }
    if (definition.key === "runtime.python.path" && hasShellWrapperExecutable(value)) {
      issues.push(issue("shell-wrapper-rejected", `${definition.key} must be a real interpreter executable; .bat/.cmd/.ps1 wrappers are not allowed.`, { ...options, remediation: "Point at python.exe, py, or another interpreter binary directly." }));
    }
  }
  if (typeof value === "number") {
    if (validator.min !== void 0 && value < validator.min) {
      issues.push(issue("number-too-small", `${definition.key} is below its minimum.`, options));
    }
    if (validator.max !== void 0 && value > validator.max) {
      issues.push(issue("number-too-large", `${definition.key} exceeds its maximum.`, options));
    }
  }
  return issues;
}
function hasShellWrapperExecutable(value) {
  return /\.(bat|cmd|ps1)(["']|\s|$)/i.test(value.trim());
}
function hasUrlCredentials(value) {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.username || parsed.password);
  } catch {
    return false;
  }
}
function isSecretReference2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return false;
  const ref = value;
  return typeof ref.provider === "string" && SECRET_PROVIDERS2.has(ref.provider) && typeof ref.locator === "string" && validSecretLocator2(ref.provider, ref.locator) && (ref.version === void 0 || typeof ref.version === "string" && ref.version.length > 0);
}
function isCanonicalProjectId(value) {
  return typeof value === "string" && PROJECT_ID_RE4.test(value);
}
function validSecretLocator2(provider, locator) {
  const normalized = locator.trim();
  if (!normalized || normalized !== locator || /[\r\n\0]/.test(normalized) || SECRET_MATERIAL_RE2.test(normalized))
    return false;
  if (provider === "environment")
    return ENVIRONMENT_LOCATOR_RE2.test(normalized);
  if (provider === "os-keychain" || provider === "external-vault")
    return OPAQUE_SECRET_LOCATOR_RE2.test(normalized);
  return false;
}
function scopeMatchesContext(scope, targetId, context) {
  return targetId === targetForScope(scope, context);
}
function targetForScope(scope, context) {
  const contextKey = {
    "user-device": "userDeviceId",
    vault: "vaultId",
    "workspace-project": "workspaceProjectId",
    session: "sessionId"
  };
  return context[contextKey[scope]];
}

// ../packages/settings-platform/dist/src/resolver.js
var SCOPE_PRECEDENCE = [
  "session",
  "workspace-project",
  "vault",
  "user-device",
  "product"
];
function resolveSettings(input) {
  const documents = participatingDocuments(input.documents, input.context);
  const sourceRevisions = buildSourceRevisions(input.registry, documents, input.context);
  const effective = input.registry.definitions.map((definition) => {
    const candidates = valueCandidates(definition, documents, input.secretStatus ?? {}, input.registry.registryVersion, input.createdAt);
    const selected = candidates[0];
    return {
      key: definition.key,
      value: deepClone2(selected.value),
      winningScope: selected.scope,
      assignmentProvenance: deepClone2(selected.provenance),
      validation: validateEffectiveValue(definition, selected.value),
      applyMode: definition.applyMode,
      overriddenCandidates: candidates.slice(1).map(({ assignment: _assignment, ...candidate }) => deepClone2(candidate))
    };
  });
  const revisions = ["user-device", "vault", "workspace-project", "session"].map((scope) => String(sourceRevisions[scope]?.revision ?? 0));
  const contextParts = [
    input.context.userDeviceId,
    input.context.vaultId ?? "-",
    input.context.workspaceProjectId ?? "-",
    input.context.sessionId ?? "-"
  ];
  return {
    snapshotId: ["settings", input.registry.registryVersion, ...contextParts, ...revisions].join(":"),
    registryVersion: input.registry.registryVersion,
    context: deepClone2(input.context),
    effective,
    sourceRevisions,
    createdAt: input.createdAt
  };
}
function explainSetting(input) {
  const definition = getDefinition(input.registry, input.key);
  if (!definition)
    throw new Error(`Unknown setting: ${input.key}`);
  const documents = participatingDocuments(input.documents, input.context);
  const candidates = valueCandidates(definition, documents, input.secretStatus ?? {}, input.registry.registryVersion, input.createdAt);
  const selected = candidates[0];
  const explanationCandidates = [];
  let selectedSeen = false;
  for (const scope of SCOPE_PRECEDENCE) {
    if (scope === "product") {
      const product = candidates.find((candidate2) => candidate2.scope === "product");
      explanationCandidates.push({
        scope,
        state: selected.scope === "product" ? "selected" : "overridden",
        revision: product.revision,
        value: deepClone2(product.value),
        provenance: deepClone2(product.provenance)
      });
      continue;
    }
    if (!definition.allowedScopes.includes(scope)) {
      explanationCandidates.push({ scope, state: "not-allowed" });
      continue;
    }
    const contextTarget = targetForScope(scope, input.context);
    if (!contextTarget) {
      explanationCandidates.push({ scope, state: "out-of-context" });
      continue;
    }
    const document = documents.get(scope);
    const candidate = candidates.find((item) => item.scope === scope);
    if (!candidate) {
      explanationCandidates.push({ scope, state: "unset", revision: document?.revision ?? 0 });
      continue;
    }
    const state = selectedSeen ? "overridden" : "selected";
    if (state === "selected")
      selectedSeen = true;
    explanationCandidates.push({
      scope,
      state,
      revision: candidate.revision,
      value: deepClone2(candidate.value),
      provenance: deepClone2(candidate.provenance)
    });
  }
  return {
    key: definition.key,
    winningScope: selected.scope,
    value: deepClone2(selected.value),
    candidates: explanationCandidates,
    validation: validateEffectiveValue(definition, selected.value)
  };
}
function participatingDocuments(documents, context) {
  const result = /* @__PURE__ */ new Map();
  for (const document of documents) {
    if (!scopeMatchesContext(document.scope, document.targetId, context))
      continue;
    if (result.has(document.scope))
      throw new Error(`Duplicate settings document for ${document.scope}`);
    result.set(document.scope, document);
  }
  return result;
}
function buildSourceRevisions(registry2, documents, context) {
  const result = {
    product: { targetId: "settings-platform", revision: registry2.registryVersion }
  };
  for (const scope of ["user-device", "vault", "workspace-project", "session"]) {
    const targetId = targetForScope(scope, context);
    if (!targetId)
      continue;
    result[scope] = { targetId, revision: documents.get(scope)?.revision ?? 0 };
  }
  return result;
}
function valueCandidates(definition, documents, secretStatus, registryVersion, createdAt) {
  const candidates = [];
  for (const scope of SCOPE_PRECEDENCE) {
    if (scope === "product") {
      candidates.push({
        scope,
        revision: registryVersion,
        value: productValue(definition, secretStatus),
        provenance: { actor: "registry", source: "registry/v1.json" }
      });
      continue;
    }
    if (!definition.allowedScopes.includes(scope))
      continue;
    const document = documents.get(scope);
    if (!document)
      continue;
    const assignment = document.assignments.find((item) => item.key === definition.key);
    if (!assignment || assignmentExpired(assignment, createdAt))
      continue;
    candidates.push({
      scope,
      revision: document.revision,
      value: assignmentValue(definition, assignment, secretStatus),
      provenance: deepClone2(assignment.provenance),
      assignment
    });
  }
  return candidates;
}
function productValue(definition, secretStatus) {
  if (definition.valueType === "secret-reference") {
    const secretRef = definition.defaultSecretRef;
    return { secretRef: deepClone2(secretRef), status: statusFor(secretRef.provider, secretRef.locator, secretStatus) };
  }
  return deepClone2(definition.defaultValue ?? null);
}
function assignmentValue(definition, assignment, secretStatus) {
  if (definition.valueType === "secret-reference") {
    const secretRef = assignment.secretRef ?? definition.defaultSecretRef;
    return { secretRef: deepClone2(secretRef), status: statusFor(secretRef.provider, secretRef.locator, secretStatus) };
  }
  return deepClone2(assignment.value ?? null);
}
function statusFor(provider, locator, secretStatus) {
  return secretStatus[`${provider}:${locator}`] ?? "missing";
}
function assignmentExpired(assignment, createdAt) {
  return assignment.expiresAt !== void 0 && Date.parse(assignment.expiresAt) <= Date.parse(createdAt);
}

// ../packages/settings-platform/dist/src/types.js
var SETTINGS_DOCUMENT_SCHEMA_VERSION = 1;

// ../packages/settings-platform/dist/src/persistence.js
import { mkdir as mkdir5, open as open5, readFile as readFile5, rename as rename5, rm as rm5, stat as stat5 } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename as basename3, dirname as dirname7, join as join8 } from "node:path";
import { randomUUID as randomUUID8 } from "node:crypto";
var ProductSettingsStore = class {
  registry;
  scope = "product";
  targetId = "settings-platform";
  constructor(registry2) {
    this.registry = registry2;
  }
  read() {
    return {
      scope: "product",
      targetId: "settings-platform",
      revision: this.registry.registryVersion,
      registryDigest: this.registry.registryDigest,
      defaults: this.registry.definitions.map((definition) => ({
        key: definition.key,
        ...definition.valueType === "secret-reference" ? { secretRef: deepClone2(definition.defaultSecretRef) } : { value: deepClone2(definition.defaultValue) },
        provenance: { actor: "registry", source: "registry/v1.json" }
      }))
    };
  }
  set() {
    throw new Error("Product settings are read-only and can change only with a registry release.");
  }
  unset() {
    throw new Error("Product settings are read-only and can change only with a registry release.");
  }
};
var SettingsLockTimeoutError = class extends Error {
  lockPath;
  code = "settings-lock-timeout";
  constructor(lockPath, timeoutMs) {
    super(`Timed out after ${timeoutMs}ms waiting for settings lock ${lockPath}`);
    this.lockPath = lockPath;
    this.name = "SettingsLockTimeoutError";
  }
};
var SettingsPersistenceError = class extends Error {
  diagnostics;
  code = "settings-persistence-error";
  constructor(message, diagnostics = []) {
    super(message);
    this.diagnostics = diagnostics;
    this.name = "SettingsPersistenceError";
  }
};
var FileSettingsStore = class {
  scope;
  targetId;
  filePath;
  registry;
  clock;
  lockTimeoutMs;
  lockRetryMs;
  constructor(options) {
    this.scope = options.scope;
    this.targetId = options.targetId;
    this.filePath = options.filePath;
    this.registry = options.registry;
    this.clock = options.clock ?? (() => (/* @__PURE__ */ new Date()).toISOString());
    this.lockTimeoutMs = options.lockTimeoutMs ?? 2e3;
    this.lockRetryMs = options.lockRetryMs ?? 20;
  }
  async read() {
    const active = await this.readPath(this.filePath);
    if (active.status === "valid") {
      return { document: active.document, recoveredFromBackup: false, diagnostics: active.diagnostics };
    }
    const backup = await this.readPath(`${this.filePath}.bak`);
    if (backup.status === "valid") {
      return {
        document: backup.document,
        recoveredFromBackup: true,
        diagnostics: [
          ...active.diagnostics,
          {
            code: "active-document-recovered",
            severity: "warning",
            message: `Recovered ${this.scope}:${this.targetId} from its previous-revision backup.`,
            scope: this.scope,
            targetId: this.targetId,
            remediation: "Commit a valid mutation to replace the corrupt active document."
          }
        ]
      };
    }
    if (active.status === "missing" && backup.status === "missing") {
      return { document: this.emptyDocument(), recoveredFromBackup: false, diagnostics: [] };
    }
    throw new SettingsPersistenceError(`Neither active nor backup settings document is usable for ${this.scope}:${this.targetId}.`, [...active.diagnostics, ...backup.diagnostics]);
  }
  async set(key, value, options) {
    return this.withLock(() => this.mutate("set", key, value, options));
  }
  async unset(key, options) {
    return this.withLock(() => this.mutate("unset", key, void 0, options));
  }
  async mutate(kind, key, value, options) {
    const currentRead = await this.read();
    const current = currentRead.document;
    if (current.revision !== options.expectedRevision) {
      return {
        status: "conflict",
        document: deepClone2(current),
        conflict: {
          scope: this.scope,
          targetId: this.targetId,
          expectedRevision: options.expectedRevision,
          actualRevision: current.revision,
          changedKeys: await this.changedKeysSince(current, options.expectedRevision)
        }
      };
    }
    const plan = planMutation({
      registry: this.registry,
      current,
      scope: this.scope,
      targetId: this.targetId,
      kind,
      key,
      value,
      options,
      clock: this.clock
    });
    if ("status" in plan)
      return plan;
    const { proposed, event } = plan;
    const backupPath = `${this.filePath}.bak`;
    if (current.revision > 0 || await exists4(this.filePath)) {
      await atomicWrite(backupPath, `${canonicalJson4(current)}
`);
    }
    proposed.previousRevision = {
      revision: current.revision,
      digest: canonicalDigest2(current),
      ...current.revision > 0 || await exists4(backupPath) ? { backupPath: basename3(backupPath) } : {}
    };
    await atomicWrite(this.filePath, `${canonicalJson4(proposed)}
`);
    return {
      status: "committed",
      document: deepClone2(proposed),
      event
    };
  }
  async migrationState() {
    let raw;
    try {
      raw = await readFile5(this.filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        return { scope: this.scope, targetId: this.targetId, schemaVersion: SETTINGS_DOCUMENT_SCHEMA_VERSION };
      }
      throw new SettingsPersistenceError(`Settings document could not be inspected for migration: ${error.message}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new SettingsPersistenceError("Settings document is not valid JSON and cannot be inspected for migration.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SettingsPersistenceError("Settings document must be a JSON object to plan migrations.");
    }
    const document = parsed;
    if (document.scope !== this.scope || document.targetId !== this.targetId) {
      throw new SettingsPersistenceError("Settings document scope identity does not match its store.");
    }
    if (!Number.isInteger(document.schemaVersion) || document.schemaVersion < 0) {
      throw new SettingsPersistenceError("Settings document schemaVersion must be a non-negative integer.");
    }
    return { scope: this.scope, targetId: this.targetId, schemaVersion: document.schemaVersion };
  }
  async changedKeysSince(current, expectedRevision) {
    if (current.previousRevision?.revision === expectedRevision) {
      const backup = await this.readPath(`${this.filePath}.bak`);
      if (backup.status === "valid" && backup.document.revision === expectedRevision) {
        return changedAssignmentKeys(backup.document, current);
      }
    }
    return current.assignments.map((assignment) => assignment.key).sort();
  }
  emptyDocument() {
    return {
      schemaVersion: 1,
      scope: this.scope,
      targetId: this.targetId,
      revision: 0,
      assignments: [],
      updatedAt: "1970-01-01T00:00:00.000Z",
      updatedBy: "settings-platform"
    };
  }
  async readPath(path) {
    let raw;
    try {
      raw = await readFile5(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT")
        return { status: "missing", diagnostics: [] };
      return {
        status: "invalid",
        diagnostics: [{
          code: "settings-read-failed",
          severity: "error",
          message: `Settings document could not be read: ${error.message}`,
          scope: this.scope,
          targetId: this.targetId
        }]
      };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        status: "invalid",
        diagnostics: [{
          code: "settings-json-invalid",
          severity: "error",
          message: "Settings document is not valid JSON.",
          scope: this.scope,
          targetId: this.targetId
        }]
      };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        status: "invalid",
        diagnostics: [{
          code: "settings-document-invalid",
          severity: "error",
          message: "Settings document must be a JSON object.",
          scope: this.scope,
          targetId: this.targetId
        }]
      };
    }
    const document = parsed;
    if (document.scope !== this.scope || document.targetId !== this.targetId) {
      return {
        status: "invalid",
        diagnostics: [{
          code: "settings-identity-mismatch",
          severity: "error",
          message: "Settings document scope identity does not match its store.",
          scope: this.scope,
          targetId: this.targetId
        }]
      };
    }
    const validation = validateSettingsDocuments(this.registry, [document]);
    if (!validation.valid)
      return { status: "invalid", diagnostics: validation.issues };
    return { status: "valid", document: deepClone2(document), diagnostics: validation.issues };
  }
  async withLock(action) {
    await mkdir5(dirname7(this.filePath), { recursive: true });
    const lockPath = `${this.filePath}.lock`;
    const deadline = Date.now() + this.lockTimeoutMs;
    let acquired = false;
    while (!acquired) {
      try {
        const handle = await open5(lockPath, "wx", 384);
        try {
          await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: this.clock() }), "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        acquired = true;
      } catch (error) {
        if (error.code !== "EEXIST")
          throw error;
        if (Date.now() >= deadline)
          throw new SettingsLockTimeoutError(lockPath, this.lockTimeoutMs);
        await delay2(Math.min(this.lockRetryMs, Math.max(1, deadline - Date.now())));
      }
    }
    try {
      return await action();
    } finally {
      await rm5(lockPath, { force: true });
    }
  }
};
var SessionSettingsStore = class {
  scope = "session";
  targetId;
  document;
  previousDocument;
  registry;
  clock;
  constructor(options) {
    this.targetId = options.targetId;
    this.registry = options.registry;
    this.clock = options.clock ?? (() => (/* @__PURE__ */ new Date()).toISOString());
    this.document = {
      schemaVersion: 1,
      scope: "session",
      targetId: options.targetId,
      revision: 0,
      assignments: deepClone2(options.assignments ?? []).sort((a, b) => a.key.localeCompare(b.key)),
      updatedAt: options.assignments?.length ? this.clock() : "1970-01-01T00:00:00.000Z",
      updatedBy: options.assignments?.length ? "settings-bootstrap" : "settings-platform"
    };
  }
  async read() {
    return { document: deepClone2(this.document), recoveredFromBackup: false, diagnostics: [] };
  }
  async migrationState() {
    return { scope: "session", targetId: this.targetId, schemaVersion: this.document.schemaVersion };
  }
  async set(key, value, options) {
    return this.mutate("set", key, value, options);
  }
  async unset(key, options) {
    return this.mutate("unset", key, void 0, options);
  }
  async mutate(kind, key, value, options) {
    const current = deepClone2(this.document);
    if (current.revision !== options.expectedRevision) {
      return {
        status: "conflict",
        document: current,
        conflict: {
          scope: "session",
          targetId: this.targetId,
          expectedRevision: options.expectedRevision,
          actualRevision: current.revision,
          changedKeys: this.previousDocument?.revision === options.expectedRevision ? changedAssignmentKeys(this.previousDocument, current) : current.assignments.map((item) => item.key).sort()
        }
      };
    }
    const plan = planMutation({
      registry: this.registry,
      current,
      scope: "session",
      targetId: this.targetId,
      kind,
      key,
      value,
      options,
      clock: this.clock
    });
    if ("status" in plan)
      return plan;
    const { proposed, event } = plan;
    proposed.previousRevision = { revision: current.revision, digest: canonicalDigest2(current) };
    this.previousDocument = current;
    this.document = proposed;
    return {
      status: "committed",
      document: deepClone2(proposed),
      event
    };
  }
};
function settingsDocumentPath(scope, options) {
  if (scope === "user-device")
    return options.userDevicePath;
  if (scope === "vault")
    return join8(options.vaultPath, "_llmwiki", "settings", "vault.json");
  const match = /^project\/([a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?)$/.exec(options.targetId);
  if (!match)
    throw new Error(`workspace-project targetId must use canonical project/<slug> form: ${options.targetId}`);
  return join8(options.vaultPath, "_llmwiki", "settings", "projects", `${match[1]}.json`);
}
function defaultUserDeviceSettingsPath(environment = process.env) {
  if (environment.LLMWIKI_SETTINGS_USER_PATH)
    return environment.LLMWIKI_SETTINGS_USER_PATH;
  const base = platform() === "win32" ? environment.APPDATA || join8(homedir(), "AppData", "Roaming") : environment.XDG_CONFIG_HOME || join8(homedir(), ".config");
  return join8(base, "llm-wiki", "settings", "user-device.json");
}
async function atomicWrite(path, content) {
  await mkdir5(dirname7(path), { recursive: true });
  const temporary = join8(dirname7(path), `.${basename3(path)}.${process.pid}.${randomUUID8()}.tmp`);
  const handle = await open5(temporary, "wx", 384);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await renameWithRetry(temporary, path);
    await syncDirectory3(dirname7(path));
  } catch (error) {
    await rm5(temporary, { force: true });
    throw error;
  }
}
async function renameWithRetry(from, to) {
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await rename5(from, to);
      return;
    } catch (error) {
      lastError = error;
      const code = error.code;
      if (!(/* @__PURE__ */ new Set(["EACCES", "EPERM", "EBUSY"])).has(code ?? ""))
        throw error;
      await delay2(10 * (attempt + 1));
    }
  }
  throw lastError;
}
async function syncDirectory3(path) {
  try {
    const directory = await open5(path, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch {
  }
}
async function exists4(path) {
  try {
    await stat5(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT")
      return false;
    throw error;
  }
}
function isSecretRefShape(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof value.provider === "string" && typeof value.locator === "string");
}
function delay2(ms) {
  return new Promise((resolve5) => setTimeout(resolve5, ms));
}
function planMutation(input) {
  const definition = getDefinition(input.registry, input.key);
  if (!definition) {
    return {
      status: "validation-error",
      document: deepClone2(input.current),
      validation: {
        valid: false,
        issues: [{
          code: "unknown-setting",
          severity: "error",
          message: `Unknown setting ${input.key} cannot be mutated.`,
          key: input.key,
          scope: input.scope,
          targetId: input.targetId
        }]
      }
    };
  }
  const assignments = input.current.assignments.filter((assignment) => assignment.key !== input.key).map(deepClone2);
  if (input.kind === "set") {
    const assignment = {
      key: input.key,
      provenance: {
        actor: input.options.updatedBy,
        source: input.options.source ?? "settings.assignment.set",
        ...input.options.reason ? { reason: input.options.reason } : {}
      },
      ...input.options.expiresAt ? { expiresAt: input.options.expiresAt } : {}
    };
    if (definition.valueType === "secret-reference" && isSecretRefShape(input.value)) {
      assignment.secretRef = deepClone2(input.value);
    } else {
      assignment.value = deepClone2(input.value);
    }
    assignments.push(assignment);
  }
  assignments.sort((left, right) => left.key.localeCompare(right.key));
  const now = input.clock();
  const proposed = {
    ...deepClone2(input.current),
    revision: input.current.revision + 1,
    assignments,
    updatedAt: now,
    updatedBy: input.options.updatedBy
  };
  delete proposed.previousRevision;
  const validation = validateSettingsDocuments(input.registry, [proposed]);
  if (!validation.valid) {
    return { status: "validation-error", document: deepClone2(input.current), validation };
  }
  return {
    proposed,
    event: {
      type: "SettingsAssignmentsChanged",
      scope: input.scope,
      targetId: input.targetId,
      previousRevision: input.current.revision,
      revision: proposed.revision,
      keys: [input.key],
      actor: input.options.updatedBy,
      occurredAt: now
    }
  };
}
function changedAssignmentKeys(before, after) {
  const previous = new Map(before.assignments.map((assignment) => [assignment.key, canonicalJson4(assignment)]));
  const current = new Map(after.assignments.map((assignment) => [assignment.key, canonicalJson4(assignment)]));
  return [.../* @__PURE__ */ new Set([...previous.keys(), ...current.keys()])].filter((key) => previous.get(key) !== current.get(key)).sort();
}

// ../packages/settings-platform/dist/src/service.js
import { existsSync as existsSync5 } from "node:fs";
import { hostname } from "node:os";
import { basename as basename4 } from "node:path";
import { spawnSync } from "node:child_process";
var SettingsService = class _SettingsService {
  registry;
  defaultContext;
  vaultPath;
  userDevicePath;
  clock;
  environment;
  stores = /* @__PURE__ */ new Map();
  constructor(options) {
    this.registry = options.registry;
    this.vaultPath = options.vaultPath;
    this.environment = options.environment ?? process.env;
    this.userDevicePath = options.userDevicePath ?? defaultUserDeviceSettingsPath(this.environment);
    this.clock = options.clock ?? (() => (/* @__PURE__ */ new Date()).toISOString());
    const vaultId = options.vaultId ?? safeIdentity(basename4(options.vaultPath) || "default-vault");
    const sessionId = options.sessionId ?? `process-${process.pid}`;
    this.defaultContext = {
      userDeviceId: options.userDeviceId ?? defaultUserDeviceId(this.environment),
      vaultId,
      ...options.workspaceProjectId ? { workspaceProjectId: options.workspaceProjectId } : {},
      sessionId
    };
    const bootstrap = this.bootstrapAssignments({
      pythonPath: options.pythonPath,
      compilerPath: options.compilerPath,
      vaultPath: options.vaultPath,
      vaultId
    });
    this.stores.set(this.storeKey("session", sessionId), new SessionSettingsStore({ targetId: sessionId, registry: this.registry, clock: this.clock, assignments: bootstrap }));
  }
  static fromRegistryPath(options) {
    return new _SettingsService({ ...options, registry: loadRegistry(options.registryPath) });
  }
  definitionsList() {
    return {
      registryVersion: this.registry.registryVersion,
      registryDigest: this.registry.registryDigest,
      definitions: deepClone2(this.registry.definitions)
    };
  }
  definitionsGet(key) {
    const definition = getDefinition(this.registry, key);
    if (!definition)
      throw new Error(`Unknown setting: ${key}`);
    return deepClone2(definition);
  }
  async scopesGet(scope, targetId) {
    if (scope === "product")
      return new ProductSettingsStore(this.registry).read();
    const resolvedTarget = targetId ?? targetForScope(scope, this.defaultContext);
    if (!resolvedTarget)
      throw new Error(`${scope} scope requires a targetId in the runtime context`);
    const read = await this.getStore(scope, resolvedTarget).read();
    return { ...read, document: deepClone2(read.document) };
  }
  async snapshotResolve(context = this.defaultContext) {
    const { documents, diagnostics } = await this.readDocuments(context);
    const secretStatus = this.secretStatuses(documents);
    const snapshot = resolveSettings({
      registry: this.registry,
      context,
      documents,
      secretStatus,
      createdAt: this.clock()
    });
    const validation = this.validateResolved(documents, context, snapshot);
    return { snapshot, validation, recoveryDiagnostics: diagnostics };
  }
  async snapshotExplain(key, context = this.defaultContext) {
    const { documents } = await this.readDocuments(context);
    return explainSetting({
      registry: this.registry,
      context,
      documents,
      secretStatus: this.secretStatuses(documents),
      createdAt: this.clock(),
      key
    });
  }
  /** Return a redacted invocation profile; host adapters resolve secrets. */
  async agentModelInvocationProfile(context = this.defaultContext) {
    const { snapshot } = await this.snapshotResolve(context);
    const mode = effectiveString(snapshot, "models.agent.mode");
    const provider = effectiveString(snapshot, "models.agent.provider");
    const baseUrl = effectiveString(snapshot, "models.agent.base_url");
    const model = effectiveString(snapshot, "models.agent.model");
    const credentialValue = snapshot.effective.find((item) => item.key === "models.agent.secret_ref")?.value;
    const secretRef = effectiveSecretReference(snapshot, "models.agent.secret_ref");
    const status = credentialValue && typeof credentialValue === "object" && !Array.isArray(credentialValue) && "status" in credentialValue && typeof credentialValue.status === "string" ? credentialValue.status : void 0;
    return {
      mode,
      provider,
      baseUrl,
      model,
      ...secretRef && status ? { credential: { secretRef, status } } : {}
    };
  }
  /** Resolve the authoritative, redacted Host Capability runtime profile. */
  async hostCapabilityInvocationProfile(context = this.defaultContext, compatibility = []) {
    const { snapshot, validation, recoveryDiagnostics } = await this.snapshotResolve(context);
    const candidates = [...compatibility].sort((left, right) => right.priority - left.priority);
    const enabled = selectHostField(snapshot, "providers.host_capability.enabled", candidates, "enabled", false);
    const provider = selectHostField(snapshot, "providers.host_capability.provider", candidates, "provider", "configured-host");
    const transport = selectHostField(snapshot, "providers.host_capability.transport", candidates, "transport", "stdio");
    const endpoint = selectHostField(snapshot, "providers.host_capability.endpoint", candidates, "endpoint", "");
    const timeoutMs = selectHostField(snapshot, "providers.host_capability.timeout_ms", candidates, "timeoutMs", 3e4);
    const credential = selectHostCredential(snapshot, candidates, provider.value);
    const connectorId = normalizeHostCapabilityConnectorId(provider.value) ?? "";
    const secretRequired = hostCapabilitySecretRequired(transport.value, connectorId, credential.provenance);
    const issues = [...validation.issues, ...recoveryDiagnostics].filter((item) => !item.key || item.key.startsWith("providers.host_capability."));
    return {
      enabled: enabled.value,
      provider: provider.value,
      connectorId,
      transport: transport.value,
      endpoint: endpoint.value,
      ...credential.value ? { credential: credential.value } : {},
      secretRequired,
      timeoutMs: timeoutMs.value,
      snapshotId: snapshot.snapshotId,
      valid: !issues.some((item) => item.severity === "error"),
      issues: deepClone2(issues),
      provenance: {
        enabled: enabled.provenance,
        provider: provider.provenance,
        transport: transport.provenance,
        endpoint: endpoint.provenance,
        credential: credential.provenance,
        timeoutMs: timeoutMs.provenance
      }
    };
  }
  async assignmentSet(input) {
    const targetId = input.targetId ?? targetForScope(input.scope, this.defaultContext);
    if (!targetId)
      throw new Error(`${input.scope} scope requires targetId`);
    const options = {
      expectedRevision: input.expectedRevision,
      updatedBy: input.updatedBy,
      source: "settings.assignment.set",
      ...input.reason ? { reason: input.reason } : {},
      ...input.expiresAt ? { expiresAt: input.expiresAt } : {}
    };
    return this.getStore(input.scope, targetId).set(input.key, input.value, options);
  }
  async assignmentUnset(input) {
    const targetId = input.targetId ?? targetForScope(input.scope, this.defaultContext);
    if (!targetId)
      throw new Error(`${input.scope} scope requires targetId`);
    return this.getStore(input.scope, targetId).unset(input.key, {
      expectedRevision: input.expectedRevision,
      updatedBy: input.updatedBy,
      source: "settings.assignment.unset",
      ...input.reason ? { reason: input.reason } : {}
    });
  }
  async validate(context = this.defaultContext) {
    const { documents } = await this.readDocuments(context);
    const snapshot = resolveSettings({
      registry: this.registry,
      context,
      documents,
      secretStatus: this.secretStatuses(documents),
      createdAt: this.clock()
    });
    return this.validateResolved(documents, context, snapshot);
  }
  async migrationsPlan(context = this.defaultContext) {
    const entries = [
      ["user-device", context.userDeviceId],
      ["vault", context.vaultId],
      ["workspace-project", context.workspaceProjectId],
      ["session", context.sessionId]
    ];
    const states = await Promise.all(entries.filter((entry) => Boolean(entry[1])).map(([scope, targetId]) => this.getStore(scope, targetId).migrationState()));
    const scopes = states.map((state) => {
      const applicable = this.registry.migrations.filter((migration) => migration.fromSchemaVersion >= state.schemaVersion && migration.toSchemaVersion <= this.registry.schemaVersion).sort((a, b) => a.fromSchemaVersion - b.fromSchemaVersion);
      return {
        scope: state.scope,
        targetId: state.targetId,
        currentSchemaVersion: state.schemaVersion,
        targetSchemaVersion: this.registry.schemaVersion,
        migrations: applicable,
        requiresMigration: state.schemaVersion !== this.registry.schemaVersion
      };
    });
    return { registryVersion: this.registry.registryVersion, writeRequired: scopes.some((item) => item.requiresMigration), scopes };
  }
  async doctor(context = this.defaultContext) {
    const checkedAt = this.clock();
    let snapshot;
    let validation;
    try {
      const resolved = await this.snapshotResolve(context);
      snapshot = resolved.snapshot;
      validation = resolved.validation;
    } catch (error) {
      validation = {
        valid: false,
        issues: [{
          code: "settings-unavailable",
          severity: "error",
          message: `Settings could not be resolved: ${error.message}`,
          remediation: "Repair the active settings document or restore its backup."
        }]
      };
    }
    if (!snapshot)
      return { validation, capabilities: [], checkedAt };
    const value = (key) => snapshot.effective.find((item) => item.key === key)?.value;
    const capabilities = [];
    const python = value("runtime.python.path");
    const pythonAvailable = typeof python === "string" && probePython(python);
    capabilities.push(this.health("runtime.python", pythonAvailable ? "available" : "unavailable", pythonAvailable ? "Python runtime responded to a version probe." : "Python runtime could not be executed.", checkedAt, snapshot.snapshotId, pythonAvailable ? "pass" : "fail", pythonAvailable ? [] : [{ code: "configure-python", summary: "Set runtime.python.path to an executable Python runtime.", operation: "settings.assignment.set" }]));
    const vaultPath = value("vault.path");
    const vaultAvailable = typeof vaultPath === "string" && existsSync5(vaultPath);
    capabilities.push(this.health("vault.filesystem", vaultAvailable ? "available" : "unavailable", vaultAvailable ? "Configured vault path is accessible." : "Configured vault path is unavailable on this device.", checkedAt, snapshot.snapshotId, vaultAvailable ? "pass" : "fail", vaultAvailable ? [] : [{ code: "configure-vault-path", summary: "Set vault.path at user-device or session scope.", operation: "settings.assignment.set" }]));
    const queryEnabled = value("query.semantic.enabled") === true;
    capabilities.push(this.health("query.semantic", queryEnabled ? pythonAvailable ? "available" : "degraded" : "disabled", queryEnabled ? pythonAvailable ? "Semantic query is enabled and its runtime is available." : "Semantic query is enabled but its runtime is unavailable; keyword query remains available." : "Semantic query is intentionally disabled.", checkedAt, snapshot.snapshotId, queryEnabled ? pythonAvailable ? "pass" : "warn" : "pass", queryEnabled && !pythonAvailable ? [{ code: "repair-python", summary: "Repair runtime.python.path.", operation: "settings.assignment.set" }] : []));
    const diagnosticsEnabled = value("diagnostics.obc.semantic.enabled") === true;
    const diagnosticsAvailable = queryEnabled && pythonAvailable;
    capabilities.push(this.health("diagnostics.obc.semantic", diagnosticsEnabled ? diagnosticsAvailable ? "available" : "degraded" : "disabled", diagnosticsEnabled ? diagnosticsAvailable ? "Semantic link suggestions are enabled." : queryEnabled ? "Semantic query is enabled but its Python runtime is unavailable; deterministic diagnostics remain available." : "Deterministic diagnostics remain available without semantic query." : "Semantic link suggestions are intentionally disabled; deterministic diagnostics remain available.", checkedAt, snapshot.snapshotId, diagnosticsEnabled && !diagnosticsAvailable ? "warn" : "pass", diagnosticsEnabled && !queryEnabled ? [{ code: "enable-semantic-query", summary: "Enable query.semantic.enabled or disable semantic diagnostics.", operation: "settings.assignment.set" }] : diagnosticsEnabled && !pythonAvailable ? [{ code: "repair-python", summary: "Repair runtime.python.path.", operation: "settings.assignment.set" }] : []));
    const webEnabled = value("providers.web_search.enabled") === true;
    const secret = value("providers.web_search.secret_ref");
    const webState = !webEnabled ? "disabled" : secret?.status === "present" ? "available" : secret?.status === "unreachable" ? "degraded" : "unavailable";
    capabilities.push(this.health("providers.web-search", webState, !webEnabled ? "Web search is intentionally disabled." : secret?.status === "present" ? "Web search credential reference is present." : "Web search credential reference is not resolvable.", checkedAt, snapshot.snapshotId, webState === "available" || webState === "disabled" ? "pass" : webState === "degraded" ? "warn" : "fail", webState === "degraded" || webState === "unavailable" ? [{ code: "configure-web-secret", summary: "Configure the referenced secret without storing its value in Settings.", operation: "settings.assignment.set" }] : []));
    const enabledAdapters = value("adapters.enabled");
    const memuEnabled = Array.isArray(enabledAdapters) && enabledAdapters.includes("memu");
    const memuDsn = value("adapters.memu.dsn");
    const memuUserId = value("adapters.memu.user_id");
    const memuSecret = value("adapters.memu.secret_ref");
    const memuSecretSetting = snapshot.effective.find((item) => item.key === "adapters.memu.secret_ref");
    const memuSecretExplicit = memuSecretSetting?.winningScope !== "product";
    const memuConfigured = typeof memuDsn === "string" && Boolean(memuDsn) && typeof memuUserId === "string" && Boolean(memuUserId);
    const memuState = !memuEnabled ? "disabled" : !memuConfigured ? "unavailable" : memuSecretExplicit && memuSecret?.status !== "present" ? memuSecret?.status === "unreachable" ? "degraded" : "unavailable" : "available";
    capabilities.push(this.health("adapters.memu", memuState, !memuEnabled ? "MemU retrieval is intentionally disabled." : !memuConfigured ? "MemU retrieval requires a credential-free PostgreSQL endpoint and user scope." : memuSecretExplicit && memuSecret?.status !== "present" ? "The explicit MemU Secret Reference is not resolvable on this device." : "MemU retrieval configuration is available; Doctor did not connect to PostgreSQL or launch a subprocess.", checkedAt, snapshot.snapshotId, memuState === "available" || memuState === "disabled" ? "pass" : memuState === "degraded" ? "warn" : "fail", memuState === "available" || memuState === "disabled" ? [] : [{
      code: memuSecretExplicit ? "configure-memu-secret" : "configure-memu",
      summary: memuSecretExplicit ? "Make the referenced MemU DSN available on this device or unset the explicit reference." : "Configure the MemU PostgreSQL endpoint and user scope through Settings.",
      operation: "settings.assignment.set"
    }]));
    const hindsightEnabled = Array.isArray(enabledAdapters) && enabledAdapters.includes("hindsight");
    const hindsightBaseUrl = value("adapters.hindsight.base_url");
    const hindsightBankId = value("adapters.hindsight.bank_id");
    const hindsightTimeout = value("adapters.hindsight.timeout_ms");
    const hindsightSecret = value("adapters.hindsight.secret_ref");
    const hindsightSecretSetting = snapshot.effective.find((item) => item.key === "adapters.hindsight.secret_ref");
    const hindsightSecretExplicit = hindsightSecretSetting?.winningScope !== "product";
    const hindsightConfigured = typeof hindsightBaseUrl === "string" && Boolean(hindsightBaseUrl) && typeof hindsightBankId === "string" && Boolean(hindsightBankId) && typeof hindsightTimeout === "number" && hindsightTimeout >= 100 && hindsightTimeout <= 3e5;
    const hindsightState = !hindsightEnabled ? "disabled" : !hindsightConfigured ? "unavailable" : hindsightSecretExplicit && hindsightSecret?.status !== "present" ? hindsightSecret?.status === "unreachable" ? "degraded" : "unavailable" : "available";
    capabilities.push(this.health("adapters.hindsight", hindsightState, !hindsightEnabled ? "Hindsight read-only recall is intentionally disabled." : !hindsightConfigured ? "Hindsight recall requires a base URL, bank ID, and valid timeout." : hindsightSecretExplicit && hindsightSecret?.status !== "present" ? "The explicit Hindsight Secret Reference is not resolvable on this device." : "Hindsight read-only recall configuration is available; Doctor did not call the external service.", checkedAt, snapshot.snapshotId, hindsightState === "available" || hindsightState === "disabled" ? "pass" : hindsightState === "degraded" ? "warn" : "fail", hindsightState === "available" || hindsightState === "disabled" ? [] : [{
      code: hindsightSecretExplicit ? "configure-hindsight-secret" : "configure-hindsight",
      summary: hindsightSecretExplicit ? "Make the referenced Hindsight credential available on this device or unset the explicit reference." : "Configure the Hindsight endpoint and bank through Settings.",
      operation: "settings.assignment.set"
    }]));
    const hostCapabilityEnabled = value("providers.host_capability.enabled") === true;
    const hostCapabilityProvider = value("providers.host_capability.provider");
    const hostCapabilityTransport = value("providers.host_capability.transport");
    const hostCapabilityEndpoint = value("providers.host_capability.endpoint");
    const hostCapabilitySecret = value("providers.host_capability.secret_ref");
    const hostCapabilityConnectorId = normalizeHostCapabilityConnectorId(hostCapabilityProvider);
    const hostSecretEffective = snapshot.effective.find((item) => item.key === "providers.host_capability.secret_ref");
    const hostCapabilityNeedsSecret = hostCapabilitySecretRequired(typeof hostCapabilityTransport === "string" ? hostCapabilityTransport : "stdio", hostCapabilityConnectorId ?? "", hostSecretEffective?.winningScope === "product" ? { source: "product-default", priority: 0, scope: "product" } : { source: "settings-assignment", priority: 300, scope: hostSecretEffective?.winningScope });
    const hostCapabilityConfigured = Boolean(hostCapabilityConnectorId) && typeof hostCapabilityTransport === "string" && Boolean(hostCapabilityTransport) && typeof hostCapabilityEndpoint === "string" && Boolean(hostCapabilityEndpoint);
    const hostCapabilityState = !hostCapabilityEnabled ? "disabled" : !hostCapabilityConfigured ? "unavailable" : hostCapabilityNeedsSecret && hostCapabilitySecret?.status !== "present" ? hostCapabilitySecret?.status === "unreachable" ? "degraded" : "unavailable" : "available";
    capabilities.push(this.health("providers.host-capability", hostCapabilityState, !hostCapabilityEnabled ? "Host capability connectors are intentionally disabled." : !hostCapabilityConfigured ? "Host capability transport or endpoint is not configured." : hostCapabilityNeedsSecret && hostCapabilitySecret?.status !== "present" ? "The selected host capability transport requires a resolvable Secret Reference." : "Host capability configuration is available for governed descriptor matching; Doctor did not call the external host.", checkedAt, snapshot.snapshotId, hostCapabilityState === "available" || hostCapabilityState === "disabled" ? "pass" : hostCapabilityState === "degraded" ? "warn" : "fail", hostCapabilityState === "available" || hostCapabilityState === "disabled" ? [] : [{
      code: hostCapabilityNeedsSecret ? "configure-host-capability-secret" : "configure-host-capability",
      summary: hostCapabilityNeedsSecret ? "Bind a device-local Secret Reference for the selected host transport." : "Configure a supported host capability transport and device-local endpoint.",
      operation: "settings.assignment.set"
    }]));
    const autoApprovalHook = value("agents.dream_time.warning_free_auto_approval") === true;
    capabilities.push(this.health("agents.dream-time-approval", autoApprovalHook ? "degraded" : "disabled", autoApprovalHook ? "The future warning-free auto-approval hook is set, but current runtimes still require explicit human approval." : "Dream Time uses explicit human approval; the future warning-free auto-approval hook is disabled.", checkedAt, snapshot.snapshotId, autoApprovalHook ? "warn" : "pass", autoApprovalHook ? [{
      code: "disable-unimplemented-auto-approval",
      summary: "Unset this reserved hook; no current runtime may bypass explicit Dream Time approval.",
      operation: "settings.assignment.unset"
    }] : []));
    const agentMode = value("models.agent.mode");
    const agentProvider = value("models.agent.provider");
    const agentBaseUrl = value("models.agent.base_url");
    const agentModel = value("models.agent.model");
    const agentSecret = value("models.agent.secret_ref");
    const agentConfigured = typeof agentProvider === "string" && Boolean(agentProvider) && typeof agentBaseUrl === "string" && Boolean(agentBaseUrl) && typeof agentModel === "string" && Boolean(agentModel);
    const agentState = agentMode === "inherit" ? "available" : !agentConfigured ? "unavailable" : agentMode === "cloud" && agentSecret?.status !== "present" ? agentSecret?.status === "unreachable" ? "degraded" : "unavailable" : "available";
    const agentSummary = agentMode === "inherit" ? "Agent model remains on the legacy environment/YAML compatibility path." : !agentConfigured ? "Agent model connection is missing a provider, base URL, or model identifier." : agentMode === "local" ? "Local Agent model connection is configured without a cloud credential." : agentSecret?.status === "present" ? "Cloud Agent model connection and credential reference are configured." : "Cloud Agent model credential reference is not resolvable on this device.";
    capabilities.push(this.health("models.agent", agentState, agentSummary, checkedAt, snapshot.snapshotId, agentState === "available" ? "pass" : agentState === "degraded" ? "warn" : "fail", agentState === "available" ? [] : [{
      code: agentMode === "inherit" ? "select-agent-model-mode" : "configure-agent-model",
      summary: agentMode === "inherit" ? "Select local or cloud mode to bring Agent model configuration under Settings Platform." : "Configure the Agent model connection and a device-local Secret Reference when cloud mode is selected.",
      operation: "settings.assignment.set"
    }]));
    return { snapshotId: snapshot.snapshotId, validation, capabilities, checkedAt };
  }
  async readDocuments(context) {
    const entries = [
      ["user-device", context.userDeviceId],
      ["vault", context.vaultId],
      ["workspace-project", context.workspaceProjectId],
      ["session", context.sessionId]
    ];
    const reads = await Promise.all(entries.filter((entry) => Boolean(entry[1])).map(async ([scope, targetId]) => {
      const read = await this.getStore(scope, targetId).read();
      return read;
    }));
    return {
      documents: reads.map((read) => read.document),
      diagnostics: reads.flatMap((read) => read.diagnostics)
    };
  }
  getStore(scope, targetId) {
    const key = this.storeKey(scope, targetId);
    const existing = this.stores.get(key);
    if (existing)
      return existing;
    const store = scope === "session" ? new SessionSettingsStore({ targetId, registry: this.registry, clock: this.clock }) : new FileSettingsStore({
      scope,
      targetId,
      registry: this.registry,
      filePath: settingsDocumentPath(scope, {
        vaultPath: this.vaultPath,
        userDevicePath: this.userDevicePath,
        targetId
      }),
      clock: this.clock
    });
    this.stores.set(key, store);
    return store;
  }
  storeKey(scope, targetId) {
    return `${scope}:${targetId}`;
  }
  bootstrapAssignments(input) {
    const values = [
      ["runtime.python.path", input.pythonPath],
      ["runtime.kb_meta.path", input.compilerPath],
      ["vault.path", input.vaultPath],
      ["vault.id", input.vaultId]
    ];
    return values.filter((entry) => Boolean(entry[1])).map(([key, value]) => ({
      key,
      value,
      provenance: { actor: "settings-bootstrap", source: "runtime-adapter" }
    }));
  }
  secretStatuses(documents) {
    const refs = this.registry.definitions.flatMap((definition) => definition.defaultSecretRef ? [definition.defaultSecretRef] : []).concat(documents.flatMap((document) => document.assignments.flatMap((assignment) => assignment.secretRef ? [assignment.secretRef] : [])));
    return Object.fromEntries(refs.map((ref) => {
      const key = `${ref.provider}:${ref.locator}`;
      if (ref.provider === "environment")
        return [key, this.environment[ref.locator] ? "present" : "missing"];
      return [key, "unreachable"];
    }));
  }
  validateResolved(documents, context, snapshot) {
    const base = validateSettingsDocuments(this.registry, documents, context);
    const issues = [...base.issues, ...snapshot.effective.flatMap((item) => item.validation.issues)];
    const effective = new Map(snapshot.effective.map((item) => [item.key, item.value]));
    if (effective.get("diagnostics.obc.semantic.enabled") === true && effective.get("query.semantic.enabled") !== true) {
      issues.push({
        code: "semantic-diagnostics-degraded",
        severity: "warning",
        message: "Semantic link suggestions are enabled while semantic query is disabled; deterministic diagnostics remain available.",
        key: "diagnostics.obc.semantic.enabled",
        remediation: "Enable query.semantic.enabled or unset the semantic diagnostics override."
      });
    }
    const secret = effective.get("providers.web_search.secret_ref");
    if (effective.get("providers.web_search.enabled") === true && secret?.status !== "present") {
      issues.push({
        code: "web-search-secret-missing",
        severity: "warning",
        message: "Web search is enabled but its Secret Reference is not present.",
        key: "providers.web_search.secret_ref",
        remediation: "Make the referenced secret available without storing it in Settings."
      });
    }
    const hostEnabled = effective.get("providers.host_capability.enabled") === true;
    const hostProvider = effective.get("providers.host_capability.provider");
    const hostTransport = effective.get("providers.host_capability.transport");
    const hostEndpoint = effective.get("providers.host_capability.endpoint");
    const hostSecret = effective.get("providers.host_capability.secret_ref");
    if (hostEnabled && (typeof hostEndpoint !== "string" || !hostEndpoint)) {
      issues.push({
        code: "host-capability-endpoint-missing",
        severity: "warning",
        message: "Host capability connectors are enabled without a device-local endpoint.",
        key: "providers.host_capability.endpoint",
        remediation: "Configure the selected host adapter endpoint or command descriptor."
      });
    }
    const hostConnectorId = normalizeHostCapabilityConnectorId(hostProvider);
    const hostSecretEffective = snapshot.effective.find((item) => item.key === "providers.host_capability.secret_ref");
    const hostNeedsSecret = hostCapabilitySecretRequired(typeof hostTransport === "string" ? hostTransport : "stdio", hostConnectorId ?? "", hostSecretEffective?.winningScope === "product" ? { source: "product-default", priority: 0, scope: "product" } : { source: "settings-assignment", priority: 300, scope: hostSecretEffective?.winningScope });
    if (hostEnabled && hostNeedsSecret && hostSecret?.status !== "present") {
      issues.push({
        code: "host-capability-secret-missing",
        severity: "warning",
        message: "The selected host capability transport requires a Secret Reference that is not present.",
        key: "providers.host_capability.secret_ref",
        remediation: "Make the referenced credential available without storing its value in Settings."
      });
    }
    if (effective.get("agents.dream_time.warning_free_auto_approval") === true) {
      issues.push({
        code: "dream-time-auto-approval-reserved",
        severity: "warning",
        message: "Warning-free Dream Time auto-approval is a reserved future hook; explicit human approval remains mandatory.",
        key: "agents.dream_time.warning_free_auto_approval",
        remediation: "Unset the reserved hook until an approved runtime policy is implemented."
      });
    }
    const agentMode = effective.get("models.agent.mode");
    const agentSecret = effective.get("models.agent.secret_ref");
    if (agentMode === "cloud" && agentSecret?.status !== "present") {
      issues.push({
        code: "agent-model-secret-missing",
        severity: "warning",
        message: "Cloud Agent model mode is selected but its Secret Reference is not present.",
        key: "models.agent.secret_ref",
        remediation: "Bind a device-local Secret Reference or select local/inherit mode."
      });
    }
    return { valid: issues.every((item) => item.severity !== "error"), issues };
  }
  health(capabilityId, state, summary, checkedAt, snapshotId, evidenceStatus, remediations) {
    return {
      capabilityId,
      state,
      summary,
      evidence: [{ code: `${capabilityId}-probe`, summary, status: evidenceStatus, observedAt: checkedAt }],
      remediations,
      checkedAt,
      snapshotId
    };
  }
};
function defaultUserDeviceId(environment = process.env) {
  const configured = environment.LLMWIKI_DEVICE_ID?.trim();
  return safeIdentity(configured || `device-${hostname()}`);
}
function probePython(executable) {
  try {
    const result = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 1500, windowsHide: true });
    return result.status === 0;
  } catch {
    return false;
  }
}
function safeIdentity(value) {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "default-vault";
}
function effectiveString(snapshot, key) {
  const value = snapshot.effective.find((item) => item.key === key)?.value;
  return typeof value === "string" ? value : "";
}
function effectiveSecretReference(snapshot, key) {
  const value = snapshot.effective.find((item) => item.key === key)?.value;
  if (!value || typeof value !== "object" || Array.isArray(value) || !("secretRef" in value))
    return void 0;
  const secretRef = value.secretRef;
  if (!secretRef || typeof secretRef !== "object" || Array.isArray(secretRef))
    return void 0;
  const candidate = secretRef;
  return typeof candidate.provider === "string" && typeof candidate.locator === "string" ? candidate : void 0;
}
function selectHostField(snapshot, key, compatibility, compatibilityKey, fallback) {
  const effective = snapshot.effective.find((item) => item.key === key);
  if (effective && effective.winningScope !== "product") {
    return {
      value: effective.value,
      provenance: {
        source: "settings-assignment",
        priority: 300,
        scope: effective.winningScope,
        actor: effective.assignmentProvenance.actor,
        detail: effective.assignmentProvenance.source
      }
    };
  }
  for (const candidate of compatibility) {
    const value = candidate.values[compatibilityKey];
    if (value !== void 0) {
      return {
        value,
        provenance: { source: candidate.source, priority: candidate.priority, detail: candidate.detail }
      };
    }
  }
  return {
    value: effective?.value ?? fallback,
    provenance: {
      source: "product-default",
      priority: 0,
      scope: "product",
      actor: effective?.assignmentProvenance.actor ?? "registry",
      detail: effective?.assignmentProvenance.source ?? "registry/v1.json"
    }
  };
}
function selectHostCredential(snapshot, compatibility, selectedProvider) {
  const effective = snapshot.effective.find((item) => item.key === "providers.host_capability.secret_ref");
  const settingsCredential = effectiveSecretReference(snapshot, "providers.host_capability.secret_ref");
  const status = effective?.value && typeof effective.value === "object" && !Array.isArray(effective.value) && "status" in effective.value && typeof effective.value.status === "string" ? effective.value.status : void 0;
  if (effective && effective.winningScope !== "product" && settingsCredential && status) {
    return {
      value: { secretRef: settingsCredential, status },
      provenance: {
        source: "settings-assignment",
        priority: 300,
        scope: effective.winningScope,
        actor: effective.assignmentProvenance.actor,
        detail: effective.assignmentProvenance.source
      }
    };
  }
  for (const candidate of compatibility) {
    if (normalizeHostCapabilityConnectorId(candidate.values.provider) === normalizeHostCapabilityConnectorId(selectedProvider) && candidate.values.credential) {
      return {
        value: deepClone2(candidate.values.credential),
        provenance: { source: candidate.source, priority: candidate.priority, detail: candidate.detail }
      };
    }
  }
  return {
    value: settingsCredential && status ? { secretRef: settingsCredential, status } : void 0,
    provenance: {
      source: "product-default",
      priority: 0,
      scope: "product",
      actor: effective?.assignmentProvenance.actor ?? "registry",
      detail: effective?.assignmentProvenance.source ?? "registry/v1.json"
    }
  };
}
var HOST_CONNECTOR_SELECTOR_PATTERN = /^(?:connector\/)?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
function normalizeHostCapabilityConnectorId(value) {
  if (typeof value !== "string")
    return void 0;
  const selector = value.trim();
  if (selector !== value || !HOST_CONNECTOR_SELECTOR_PATTERN.test(selector))
    return void 0;
  return selector.startsWith("connector/") ? selector : `connector/${selector}`;
}
function hostCapabilitySecretRequired(transport, _connectorId, _credentialProvenance) {
  if (transport === "stdio" || transport === "local-model")
    return false;
  return true;
}

// dist/settings/settings.js
function createSettingsService(options) {
  return new SettingsService({
    registry: options.registryPath ? loadRegistry(options.registryPath) : bundledRegistry(),
    vaultPath: options.vaultPath,
    userDevicePath: options.userDevicePath,
    userDeviceId: options.userDeviceId,
    vaultId: options.vaultId,
    workspaceProjectId: options.workspaceProjectId,
    sessionId: options.sessionId,
    pythonPath: options.pythonPath,
    compilerPath: options.compilerPath,
    environment: options.environment,
    clock: options.clock
  });
}
var MUTABLE_SCOPES2 = ["user-device", "vault", "workspace-project", "session"];
var SETTINGS_SCOPES = ["product", ...MUTABLE_SCOPES2];

// dist/usage/contracts.js
import { createHash as createHash5 } from "node:crypto";

// dist/usage/redaction.js
var SECRET_VALUE = /(?:\bbearer\s+[a-z0-9._~+/-]+=*|\b(?:sk|pk|ghp|github_pat|xox[baprs])-[-a-z0-9_]{8,}|\b(?:api[_-]?key|secret|password|authorization|access[_-]?token|refresh[_-]?token|lease[_-]?token|handoff[_-]?token)\s*[:=])/i;
var ABSOLUTE_PATH = /(?:^|[\s"'=:])(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/]|\/(?:users|home|var|tmp|private|opt|etc|mnt|srv|data)(?:\/|$)|~[\\/]|file:\/\/)/i;
function containsSecretMaterial(value) {
  return SECRET_VALUE.test(value);
}
function containsMachinePath(value) {
  return ABSOLUTE_PATH.test(value);
}
function assertSafeUsageString(value, fieldPath) {
  if (containsSecretMaterial(value)) {
    throw new UsagePrivacyError("SECRET_MATERIAL", fieldPath);
  }
  if (containsMachinePath(value)) {
    throw new UsagePrivacyError("MACHINE_PATH", fieldPath);
  }
}
var UsagePrivacyError = class extends Error {
  code;
  fieldPath;
  constructor(code, fieldPath) {
    super(`Usage data rejected by privacy policy (${code}) at ${fieldPath}`);
    this.name = "UsagePrivacyError";
    this.code = code;
    this.fieldPath = fieldPath;
  }
};

// dist/usage/contracts.js
var USAGE_EVENT_SCHEMA = "llmwiki.usage-event";
var USAGE_EVENT_SCHEMA_VERSION = 1;
var EVENT_KINDS = /* @__PURE__ */ new Set(["model", "dreamtime", "consult", "delegation", "connector"]);
var UNKNOWN_REASONS = /* @__PURE__ */ new Set(["not-reported", "not-applicable", "unavailable", "unattributed"]);
var USAGE_DIMENSION_NAMES = [
  "project",
  "agent",
  "thread",
  "workRun",
  "provider",
  "model",
  "device",
  "operation"
];
var IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:/-]{0,159}$/;
var IDEMPOTENCY_KEY = /^[a-z][a-z0-9.-]*:[A-Za-z0-9][A-Za-z0-9._:@/-]{0,190}$/;
var PROVENANCE_REF = /^(?:provider-call|work-run|invocation|connector-call|dreamtime-run|agent-turn|source-event):[A-Za-z0-9][A-Za-z0-9._:@/-]{0,190}$/;
var CURRENCY = /^[A-Z]{3}$/;
var UsageValidationError = class extends Error {
  code;
  fieldPath;
  constructor(code, fieldPath, message) {
    super(`${message} at ${fieldPath}`);
    this.name = "UsageValidationError";
    this.code = code;
    this.fieldPath = fieldPath;
  }
};
function known(value) {
  return { state: "known", value };
}
function unknown(reason) {
  return { state: "unknown", reason };
}
function usageEventId(idempotencyKey) {
  return `usage/${createHash5("sha256").update(idempotencyKey).digest("hex")}`;
}
function assertRecord(value, fieldPath) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UsageValidationError("INVALID_OBJECT", fieldPath, "Expected an object");
  }
}
function assertClosed(record3, allowed, fieldPath) {
  const expected = new Set(allowed);
  for (const key of Object.keys(record3)) {
    if (!expected.has(key)) {
      throw new UsageValidationError("UNKNOWN_FIELD", `${fieldPath}.${key}`, "Usage contracts are closed");
    }
  }
  for (const key of allowed) {
    if (!(key in record3)) {
      throw new UsageValidationError("MISSING_FIELD", `${fieldPath}.${key}`, "Required field is missing");
    }
  }
}
function assertIdentifier2(value, fieldPath) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new UsageValidationError("INVALID_IDENTIFIER", fieldPath, "Expected a canonical identifier");
  }
  assertSafeUsageString(value, fieldPath);
}
function parseFact(value, fieldPath, parseKnown) {
  assertRecord(value, fieldPath);
  if (value.state === "known") {
    assertClosed(value, ["state", "value"], fieldPath);
    return { state: "known", value: parseKnown(value.value, `${fieldPath}.value`) };
  }
  if (value.state === "unknown") {
    assertClosed(value, ["state", "reason"], fieldPath);
    if (typeof value.reason !== "string" || !UNKNOWN_REASONS.has(value.reason)) {
      throw new UsageValidationError("INVALID_UNKNOWN_REASON", `${fieldPath}.reason`, "Unknown facts require a supported reason");
    }
    return { state: "unknown", reason: value.reason };
  }
  throw new UsageValidationError("INVALID_FACT_STATE", `${fieldPath}.state`, "Fact state must be known or unknown");
}
function parseTokenCount(value, fieldPath) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new UsageValidationError("INVALID_TOKEN_COUNT", fieldPath, "Token count must be a non-negative safe integer");
  }
  return value;
}
function parseCost(value, fieldPath) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new UsageValidationError("INVALID_PROVIDER_COST", fieldPath, "Provider-reported cost must be finite and non-negative");
  }
  return value;
}
function parseCurrency(value, fieldPath) {
  if (typeof value !== "string" || !CURRENCY.test(value)) {
    throw new UsageValidationError("INVALID_CURRENCY", fieldPath, "Currency must be a three-letter uppercase code");
  }
  return value;
}
function parseTimestamp2(value, fieldPath) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new UsageValidationError("INVALID_TIMESTAMP", fieldPath, "Timestamp must be canonical UTC RFC3339");
  }
  return value;
}
function validateUsageEvent(value) {
  assertRecord(value, "$");
  assertClosed(value, [
    "schema",
    "schemaVersion",
    "eventId",
    "idempotencyKey",
    "kind",
    "occurredAt",
    "dimensions",
    "providerFacts",
    "provenance"
  ], "$");
  if (value.schema !== USAGE_EVENT_SCHEMA) {
    throw new UsageValidationError("UNSUPPORTED_SCHEMA", "$.schema", "Unsupported Usage Event schema");
  }
  if (value.schemaVersion !== USAGE_EVENT_SCHEMA_VERSION) {
    throw new UsageValidationError("UNSUPPORTED_SCHEMA_VERSION", "$.schemaVersion", "Unsupported Usage Event schema version");
  }
  if (typeof value.idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(value.idempotencyKey)) {
    throw new UsageValidationError("INVALID_IDEMPOTENCY_KEY", "$.idempotencyKey", "Idempotency key must be a stable logical reference");
  }
  assertSafeUsageString(value.idempotencyKey, "$.idempotencyKey");
  const expectedEventId = usageEventId(value.idempotencyKey);
  if (value.eventId !== expectedEventId) {
    throw new UsageValidationError("EVENT_ID_MISMATCH", "$.eventId", "Event ID must be derived from the idempotency key");
  }
  if (typeof value.kind !== "string" || !EVENT_KINDS.has(value.kind)) {
    throw new UsageValidationError("INVALID_EVENT_KIND", "$.kind", "Unsupported Usage Event kind");
  }
  assertRecord(value.dimensions, "$.dimensions");
  const rawDimensions = value.dimensions;
  assertClosed(rawDimensions, USAGE_DIMENSION_NAMES, "$.dimensions");
  const dimensions = Object.fromEntries(USAGE_DIMENSION_NAMES.map((name) => [
    name,
    parseFact(rawDimensions[name], `$.dimensions.${name}`, (item, itemPath) => {
      assertIdentifier2(item, itemPath);
      return item;
    })
  ]));
  assertRecord(value.providerFacts, "$.providerFacts");
  assertClosed(value.providerFacts, ["inputTokens", "outputTokens", "providerReportedCost", "currency"], "$.providerFacts");
  const providerFacts = {
    inputTokens: parseFact(value.providerFacts.inputTokens, "$.providerFacts.inputTokens", parseTokenCount),
    outputTokens: parseFact(value.providerFacts.outputTokens, "$.providerFacts.outputTokens", parseTokenCount),
    providerReportedCost: parseFact(value.providerFacts.providerReportedCost, "$.providerFacts.providerReportedCost", parseCost),
    currency: parseFact(value.providerFacts.currency, "$.providerFacts.currency", parseCurrency)
  };
  if (providerFacts.providerReportedCost.state === "known" && providerFacts.currency.state !== "known") {
    throw new UsageValidationError("COST_CURRENCY_REQUIRED", "$.providerFacts.currency", "Known provider cost requires known currency");
  }
  if (!Array.isArray(value.provenance) || value.provenance.length === 0) {
    throw new UsageValidationError("INVALID_PROVENANCE", "$.provenance", "At least one provenance reference is required");
  }
  const provenance = value.provenance.map((item, index) => {
    const fieldPath = `$.provenance[${index}]`;
    if (typeof item !== "string" || !PROVENANCE_REF.test(item)) {
      throw new UsageValidationError("INVALID_PROVENANCE", fieldPath, "Provenance must be a supported logical reference");
    }
    assertSafeUsageString(item, fieldPath);
    return item;
  });
  return {
    schema: USAGE_EVENT_SCHEMA,
    schemaVersion: USAGE_EVENT_SCHEMA_VERSION,
    eventId: expectedEventId,
    idempotencyKey: value.idempotencyKey,
    kind: value.kind,
    occurredAt: parseTimestamp2(value.occurredAt, "$.occurredAt"),
    dimensions,
    providerFacts,
    provenance
  };
}
function createUsageEvent(input) {
  return validateUsageEvent({
    schema: USAGE_EVENT_SCHEMA,
    schemaVersion: USAGE_EVENT_SCHEMA_VERSION,
    eventId: usageEventId(input.idempotencyKey),
    ...input
  });
}

// dist/usage/ledger.js
import { existsSync as existsSync6, mkdirSync as mkdirSync4, readFileSync as readFileSync6, readdirSync as readdirSync4, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname as dirname8, join as join9, relative, resolve as resolve3, sep } from "node:path";

// dist/usage/canonical.js
import { createHash as createHash6 } from "node:crypto";
function serialize(value) {
  if (value === null)
    return "null";
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Canonical JSON does not support non-finite numbers");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map(serialize).join(",")}]`;
  if (typeof value === "object") {
    const record3 = value;
    const keys = Object.keys(record3).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record3[key])}`).join(",")}}`;
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value}`);
}
function canonicalJson5(value) {
  return serialize(value);
}
function sha256(value) {
  return createHash6("sha256").update(value).digest("hex");
}

// dist/usage/ledger.js
var USAGE_LEDGER_STORAGE_VERSION = 1;
var UsageEventConflictError = class extends Error {
  code = "USAGE_EVENT_CONFLICT";
  eventId;
  storageKey;
  constructor(eventId, storageKey) {
    super(`Usage Event conflicts with immutable event ${eventId}`);
    this.name = "UsageEventConflictError";
    this.eventId = eventId;
    this.storageKey = storageKey;
  }
};
var UsageLedgerCorruptionError = class extends Error {
  code = "USAGE_LEDGER_CORRUPTION";
  storageKey;
  constructor(storageKey, message) {
    super(`Usage ledger corruption at ${storageKey}: ${message}`);
    this.name = "UsageLedgerCorruptionError";
    this.storageKey = storageKey;
  }
};
function eventBytes(event) {
  return `${canonicalJson5(event)}
`;
}
function normalizeStorageKey(value) {
  return value.split(sep).join("/");
}
function usageEventStorageKey(idempotencyKey) {
  const digest3 = usageEventId(idempotencyKey).slice("usage/".length);
  return `events/${digest3.slice(0, 2)}/${digest3}.json`;
}
var UsageLedger = class {
  storageVersion = USAGE_LEDGER_STORAGE_VERSION;
  #root;
  constructor(root) {
    if (!root)
      throw new TypeError("Usage ledger root is required");
    this.#root = resolve3(root);
  }
  append(value) {
    const event = validateUsageEvent(value);
    const target = this.#targetForKey(event.idempotencyKey);
    const storageKey = this.#storageKey(target);
    const bytes = eventBytes(event);
    mkdirSync4(dirname8(target), { recursive: true });
    try {
      writeFileSync3(target, bytes, { encoding: "utf8", flag: "wx", mode: 384 });
      return {
        status: "created",
        event,
        storageKey,
        contentDigest: sha256(bytes)
      };
    } catch (error) {
      if (error.code !== "EEXIST")
        throw error;
    }
    const persisted = readFileSync6(target, "utf8");
    if (persisted !== bytes) {
      throw new UsageEventConflictError(event.eventId, storageKey);
    }
    return {
      status: "replayed",
      event,
      storageKey,
      contentDigest: sha256(bytes)
    };
  }
  get(idempotencyKey) {
    const expectedId = usageEventId(idempotencyKey);
    const target = this.#targetForKey(idempotencyKey);
    if (!existsSync6(target))
      return null;
    return this.#readStoredEvent(target, expectedId);
  }
  list() {
    const eventsRoot = join9(this.#root, "events");
    if (!existsSync6(eventsRoot))
      return [];
    const targets = readdirSync4(eventsRoot, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => join9(entry.parentPath, entry.name)).sort((left, right) => left.localeCompare(right));
    return targets.map((target) => {
      const digest3 = target.slice(target.lastIndexOf(sep) + 1, -".json".length);
      return this.#readStoredEvent(target, `usage/${digest3}`);
    });
  }
  #targetForKey(idempotencyKey) {
    return join9(this.#root, ...usageEventStorageKey(idempotencyKey).split("/"));
  }
  #storageKey(target) {
    const key = normalizeStorageKey(relative(this.#root, target));
    if (!key || key.startsWith("../") || key === "..") {
      throw new TypeError("Usage storage key escaped the ledger root");
    }
    return key;
  }
  #readStoredEvent(target, expectedEventId) {
    const storageKey = this.#storageKey(target);
    let raw;
    let parsed;
    try {
      raw = readFileSync6(target, "utf8");
      parsed = JSON.parse(raw);
    } catch {
      throw new UsageLedgerCorruptionError(storageKey, "event is not readable canonical JSON");
    }
    let event;
    try {
      event = validateUsageEvent(parsed);
    } catch {
      throw new UsageLedgerCorruptionError(storageKey, "event violates the versioned contract");
    }
    if (event.eventId !== expectedEventId) {
      throw new UsageLedgerCorruptionError(storageKey, "content address does not match the event identity");
    }
    if (eventBytes(event) !== raw) {
      throw new UsageLedgerCorruptionError(storageKey, "event bytes are not canonical");
    }
    return event;
  }
};

// dist/workflow/workflow.js
import { existsSync as existsSync7, mkdirSync as mkdirSync5, readFileSync as readFileSync7, renameSync as renameSync3, rmSync as rmSync3, writeFileSync as writeFileSync4 } from "node:fs";
import { dirname as dirname9, join as join10 } from "node:path";
import { createHash as createHash7, randomUUID as randomUUID9, timingSafeEqual } from "node:crypto";
var STAGES = ["intake", "understand", "plan", "execute", "review", "verify", "archive"];
var CHECKPOINT_STATUSES = ["note", "passed", "failed", "blocked"];
var AGENT_STAGES = ["think", "plan", "build", "review", "test", "ship", "reflect"];
var workflowAgentEffects = (_ctx, _params, result) => {
  const eventsPath = typeof result === "object" && result !== null ? result.eventsPath : void 0;
  const runPath = typeof result === "object" && result !== null ? result.runPath : void 0;
  return [touchMarkdown(resultPath(result), "modify"), touchMarkdown(eventsPath, "modify"), touchMarkdown(runPath, "modify")];
};
var workflowAgentTargets = (ctx, params) => {
  const workflow = workflowPolicyBasePath(ctx.config, params, "workflow.agent");
  const projectRoot = workflow.slice(0, -"/workflow".length);
  return [`${workflowAgentPolicyBasePath(ctx.config, params, "workflow.agent")}/**`, `${projectRoot}/runs/**`];
};
var AGENT_STATUSES = ["active", "blocked", "done", "archived"];
var WORK_RUN_STATES = [
  "planned",
  "leased",
  "running",
  "awaiting_review",
  "completed",
  "failed",
  "cancelled"
];
var WORK_RUN_TERMINAL_STATES = ["completed", "failed", "cancelled"];
var WORK_RUN_OUTPUT_CLASSES = ["view", "work-state-transition", "knowledge-claim", "external-side-effect"];
var WORK_RUN_APPROVAL_STATUSES = ["not-required", "pending", "approved", "denied"];
var WORK_RUN_TRANSITIONS = {
  planned: ["leased", "cancelled"],
  leased: ["running", "failed", "cancelled"],
  running: ["awaiting_review", "completed", "failed", "cancelled"],
  awaiting_review: ["running", "completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: []
};
var AGENT_STAGE_EVIDENCE_REQUIREMENTS = {
  test: ["review:"],
  ship: ["review:", "test:"]
};
function slugify(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function existingProjectKey(vaultPath, value, operation) {
  if (typeof value !== "string" || !value.trim())
    throw makeErr(-32602, "project is required");
  return resolveProjectContext(vaultPath, value, operation).slug;
}
function agentKey(value, fallback) {
  const key = slugify(String(value ?? fallback));
  if (!key)
    throw makeErr(-32602, "agent must contain at least one [a-z0-9] character");
  return key;
}
function actorFromContext(ctx) {
  return agentKey(void 0, ctx.config.collaboration?.actor || process.env.VAULT_MIND_ACTOR || "agent");
}
function workflowRoot(project) {
  return `01-Projects/${project}/workflow`;
}
function agentsRoot(project) {
  return `01-Projects/${project}/agents`;
}
function agentRoot(project, agent) {
  return `${agentsRoot(project)}/${agent}`;
}
function projectNotePath(project) {
  return `01-Projects/${project}/_project.md`;
}
function issuesRoot(project) {
  return `01-Projects/${project}/issues`;
}
function statePath(project) {
  return `${workflowRoot(project)}/status.md`;
}
function checkpointsPath(project) {
  return `${workflowRoot(project)}/checkpoints.md`;
}
function agentLifetimePath(project, agent) {
  return `${agentRoot(project, agent)}/lifetime.md`;
}
function agentEventsPath(project, agent) {
  return `${agentRoot(project, agent)}/events.md`;
}
function durableRunPath(project, workRunId) {
  return `01-Projects/${project}/runs/${workRunId.slice("work-run/".length)}.json`;
}
var WORK_RUN_LOCK_PATH = ".vault-mind/_work-run.lock";
function withWorkRunLock(vaultPath, action) {
  const lockPath = vaultJoin(vaultPath, WORK_RUN_LOCK_PATH);
  const token = `${process.pid}:${randomUUID9()}`;
  mkdirSync5(dirname9(lockPath), { recursive: true });
  const claim = () => writeFileSync4(lockPath, token, { encoding: "utf-8", flag: "wx" });
  try {
    claim();
  } catch (error) {
    if (error.code !== "EEXIST")
      throw error;
    throw conflict(`Work Run is busy with another runtime; verify the owner and remove ${WORK_RUN_LOCK_PATH} manually only after confirming no writer is active`);
  }
  try {
    return action();
  } finally {
    try {
      if (readFileSync7(lockPath, "utf-8") === token)
        rmSync3(lockPath, { force: true });
    } catch {
    }
  }
}
var LEASE_MODES = ["local", "portable-handoff"];
function jsonRecord(path, label) {
  if (!existsSync7(path))
    return null;
  try {
    const value = JSON.parse(readFileSync7(path, "utf-8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("expected an object");
    }
    return value;
  } catch (error) {
    throw conflict(`${label} identity conflict: ${error.message}`);
  }
}
function leaseCandidates(vaultPath, workRunId) {
  const registry2 = jsonRecord(join10(vaultPath, ".vault-mind", "_leases.json"), "Lease registry");
  if (!registry2)
    return [];
  return Object.values(registry2).filter((value) => Boolean(value) && typeof value === "object" && !Array.isArray(value) && value.work_run_id === workRunId);
}
function canonicalWorkItemId(value) {
  const id2 = optionalString(value);
  if (!/^project\/[a-z0-9][a-z0-9-]*\/issue\/[a-z0-9][a-z0-9-]*$/.test(id2)) {
    throw conflict("Work Item identity conflict: work_item_id must be canonical");
  }
  return id2;
}
function identityEquals(label, expected, actual) {
  if (typeof expected !== "string" || expected !== actual) {
    throw conflict(`${label} identity conflict`, { expected, actual });
  }
}
function assertWorkItemOwnership(projectIdentity, workItemId) {
  if (!workItemId.startsWith(`${projectIdentity}/issue/`)) {
    throw conflict("Work Item ownership identity conflict", {
      projectId: projectIdentity,
      workItemId
    });
  }
}
function assertActiveLeaseIdentity(vaultPath, identity) {
  const leases = leaseCandidates(vaultPath, identity.workRunId);
  if (leases.length !== 1) {
    throw conflict("Lease identity conflict: expected exactly one local lease for Work Run", {
      workRunId: identity.workRunId,
      matches: leases.length
    });
  }
  const lease = leases[0];
  identityEquals("Project", identity.projectId, lease.project_id);
  identityEquals("Work Item", identity.workItemId, lease.work_item_id);
  identityEquals("Work Run", identity.workRunId, lease.work_run_id);
  identityEquals("agent", identity.agentId, lease.agent_id);
  const expiresAt = lease.expires_at;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || Date.now() / 1e3 >= expiresAt) {
    throw conflict("Lease expiry identity conflict: local lease is missing or expired", {
      workRunId: identity.workRunId,
      expiresAt
    });
  }
}
function parseLeaseMode(value) {
  const mode = optionalString(value) || "local";
  if (!LEASE_MODES.includes(mode)) {
    throw makeErr(-32602, `lease_mode must be one of: ${LEASE_MODES.join(", ")}`);
  }
  return mode;
}
var GOVERNED_RUN_LOCKS = [
  { key: "agent_profile_id", label: "Agent Profile identity", kind: "id", pattern: /^(?:agent\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?|agent-profile\/[a-z0-9][a-z0-9-]*)$/ },
  { key: "agent_profile_revision", label: "Agent Profile revision", kind: "revision" },
  { key: "project_agent_binding_id", label: "Project Agent Binding identity", kind: "id", pattern: /^(?:binding\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?|project-agent-binding\/[a-z0-9][a-z0-9-]*)$/ },
  { key: "project_agent_binding_revision", label: "Project Agent Binding revision", kind: "revision" },
  { key: "assignment_plan_id", label: "Assignment Plan identity", kind: "id", pattern: /^assignment-plan\/[a-z0-9][a-z0-9-]*$/ },
  { key: "assignment_plan_version", label: "Assignment Plan version", kind: "revision" },
  { key: "assignment_plan_fingerprint", label: "Assignment Plan fingerprint", kind: "fingerprint" },
  { key: "context_envelope_fingerprint", label: "Context Envelope fingerprint", kind: "fingerprint" },
  { key: "device_snapshot", label: "Device Snapshot", kind: "device-snapshot" },
  { key: "parent_work_run_id", label: "Parent Work Run identity", kind: "work-run" }
];
var GOVERNED_RUN_EXTENSION_KEYS = [
  ...GOVERNED_RUN_LOCKS.map((item) => item.key),
  "child_work_run_ids",
  "capability_grant_summary",
  "artifact_projections",
  "expected_output"
];
function assertGovernedLockValue(spec, value) {
  if (spec.kind === "device-snapshot") {
    assertDeviceSnapshot(value);
    return;
  }
  if (spec.kind === "revision") {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw conflict(`${spec.label} conflict`, { actual: value, expected: "positive integer" });
    }
    return;
  }
  if (typeof value !== "string") {
    throw conflict(`${spec.label} conflict`, { actual: value, expected: "string" });
  }
  if (spec.kind === "fingerprint") {
    if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(value))
      throw conflict(`${spec.label} conflict`, { actual: value });
  } else if (spec.kind === "work-run") {
    if (!/^work-run\/[a-z0-9][a-z0-9-]*$/.test(value))
      throw conflict(`${spec.label} conflict`, { actual: value });
  } else if (spec.kind === "id" && !spec.pattern.test(value)) {
    throw conflict(`${spec.label} conflict`, { actual: value });
  }
  assertPersistedTextSafe(spec.key, value);
}
function fingerprintHex(value) {
  return typeof value === "string" && /^(?:sha256:)?[a-f0-9]{64}$/.test(value) ? value.replace(/^sha256:/, "") : null;
}
function assertDeviceSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw conflict("Device Snapshot conflict", { actual: value });
  const snapshot = value;
  const required = ["snapshotId", "deviceId", "revision", "fingerprint", "capturedAt", "expiresAt"];
  const keys = Object.keys(snapshot);
  if (keys.length !== required.length || required.some((key) => !(key in snapshot))) {
    throw conflict("Device Snapshot conflict", { actual: value, expected: required });
  }
  if (typeof snapshot.snapshotId !== "string" || !/^device-snapshot\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(snapshot.snapshotId)) {
    throw conflict("Device Snapshot identity conflict", { actual: snapshot.snapshotId });
  }
  if (typeof snapshot.deviceId !== "string" || !/^device\/[a-z0-9][a-z0-9-]*$/.test(snapshot.deviceId)) {
    throw conflict("Device identity conflict", { actual: snapshot.deviceId });
  }
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) {
    throw conflict("Device Snapshot revision conflict", { actual: snapshot.revision });
  }
  if (fingerprintHex(snapshot.fingerprint) === null) {
    throw conflict("Device Snapshot fingerprint conflict", { actual: snapshot.fingerprint });
  }
  for (const key of ["capturedAt", "expiresAt"]) {
    const timestamp = snapshot[key];
    if (typeof timestamp !== "string" || !timestamp) {
      throw conflict(`Device Snapshot ${key} conflict`, { actual: timestamp });
    }
    assertPersistedTextSafe(`device_snapshot.${key}`, timestamp);
  }
}
function comparableGovernedLock(spec, value) {
  if (spec.kind === "fingerprint")
    return fingerprintHex(value);
  if (spec.kind === "device-snapshot" && value && typeof value === "object" && !Array.isArray(value)) {
    const snapshot = value;
    return JSON.stringify({
      snapshotId: snapshot.snapshotId,
      deviceId: snapshot.deviceId,
      revision: snapshot.revision,
      fingerprint: fingerprintHex(snapshot.fingerprint),
      capturedAt: snapshot.capturedAt,
      expiresAt: snapshot.expiresAt
    });
  }
  return value;
}
function assertGovernedRunLocks(params, durable) {
  for (const spec of GOVERNED_RUN_LOCKS) {
    const expected = params[spec.key];
    const actual = durable[spec.key];
    if (expected === void 0 && actual === void 0)
      continue;
    if (expected === void 0 || actual === void 0) {
      throw conflict(`${spec.label} conflict`, { expected, actual });
    }
    assertGovernedLockValue(spec, expected);
    assertGovernedLockValue(spec, actual);
    if (comparableGovernedLock(spec, expected) !== comparableGovernedLock(spec, actual)) {
      throw conflict(`${spec.label} conflict`, { expected, actual });
    }
  }
}
var FORBIDDEN_DURABLE_EXTENSION_KEY = /(?:^|_)(?:secret|token|credential|api[_-]?key|workspace|path|process|handle|header|environment|env)(?:_|$)/i;
function assertPortableDurableValue(label, value, depth = 0) {
  if (depth > 6)
    throw conflict(`${label} exceeds the durable Work Run nesting limit`);
  if (value === null || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw conflict(`${label} contains a non-finite number`);
    return;
  }
  if (typeof value === "string") {
    if (value.length > 4096)
      throw conflict(`${label} exceeds the durable Work Run text limit`);
    if (/(?:api[_-]?key|credential|plaintext[_-]?secret)/i.test(value)) {
      throw conflict(`${label} contains secret-bearing material`);
    }
    assertPersistedTextSafe(label, value);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 256)
      throw conflict(`${label} exceeds the durable Work Run array limit`);
    value.forEach((item, index) => assertPortableDurableValue(`${label}[${index}]`, item, depth + 1));
    return;
  }
  if (!value || typeof value !== "object")
    throw conflict(`${label} contains an unsupported value`);
  const record3 = value;
  const entries = Object.entries(record3);
  if (entries.length > 64)
    throw conflict(`${label} exceeds the durable Work Run object limit`);
  for (const [key, nested] of entries) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || FORBIDDEN_DURABLE_EXTENSION_KEY.test(key)) {
      throw conflict(`${label} contains forbidden field ${key}`);
    }
    assertPortableDurableValue(`${label}.${key}`, nested, depth + 1);
  }
}
function governedRunExtensions(run) {
  const extensions = {};
  for (const spec of GOVERNED_RUN_LOCKS) {
    const value = run[spec.key];
    if (value === void 0)
      continue;
    assertGovernedLockValue(spec, value);
    extensions[spec.key] = value;
  }
  if (run.child_work_run_ids !== void 0) {
    if (!Array.isArray(run.child_work_run_ids))
      throw conflict("Child Work Run identities conflict");
    const children = run.child_work_run_ids.map((value) => {
      if (typeof value !== "string" || !/^work-run\/[a-z0-9][a-z0-9-]*$/.test(value)) {
        throw conflict("Child Work Run identities conflict", { actual: value });
      }
      return value;
    });
    if (new Set(children).size !== children.length)
      throw conflict("Child Work Run identities conflict: duplicates");
    extensions.child_work_run_ids = children;
  }
  for (const key of ["capability_grant_summary", "artifact_projections", "expected_output"]) {
    const value = run[key];
    if (value === void 0)
      continue;
    assertPortableDurableValue(key, value);
    extensions[key] = structuredClone(value);
  }
  if (Object.keys(extensions).length > 0 && run.schema_version !== 2) {
    throw conflict("Governed Work Run extensions require schema_version=2", { actual: run.schema_version });
  }
  return extensions;
}
function assertPortableHandoffAuthority(durable, handoffToken) {
  const token = typeof handoffToken === "string" ? handoffToken : "";
  if (token.length < 16 || token.length > 4096) {
    throw makeErr(-32602, "handoff_token is required for lease_mode=portable-handoff");
  }
  const expectedHash = durable.handoff_token_hash;
  if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw conflict("Portable handoff authority conflict: durable handoff_token_hash is missing or invalid");
  }
  const expiresAt = durable.handoff_expires_at;
  if (typeof expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiresAt) || !Number.isFinite(Date.parse(expiresAt)) || Date.now() >= Date.parse(expiresAt)) {
    throw conflict("Portable handoff authority conflict: durable handoff is missing or expired");
  }
  const actual = createHash7("sha256").update(token, "utf-8").digest();
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw conflict("Portable handoff authority conflict: handoff token mismatch");
  }
}
function assertJoinLeaseAuthority(vaultPath, identity, durable) {
  const registryPath = join10(vaultPath, ".vault-mind", "_leases.json");
  if (identity.leaseMode === "portable-handoff") {
    assertPortableHandoffAuthority(durable, identity.handoffToken);
    if (!existsSync7(registryPath))
      return;
  }
  assertActiveLeaseIdentity(vaultPath, identity);
}
function assertDurableRunIdentity(vaultPath, project, identity) {
  const durablePath = vaultJoin(vaultPath, durableRunPath(project, identity.workRunId));
  const durable = jsonRecord(durablePath, "Durable Work Run");
  if (!durable)
    throw conflict(`Work Run identity conflict: durable run not found for ${identity.workRunId}`);
  identityEquals("Project", identity.projectId, durable.project_id);
  identityEquals("Work Item", identity.workItemId, durable.work_item_id);
  identityEquals("Work Run", identity.workRunId, durable.work_run_id);
  identityEquals("agent", identity.agentId, durable.agent_id);
  const state = durable.state;
  if (!WORK_RUN_STATES.includes(state)) {
    throw conflict(`Work Run identity conflict: invalid durable state ${String(durable.state)}`);
  }
  return { state, record: durable };
}
function assertLeasedRunIdentity(vaultPath, project, agent, params) {
  const workRunId = parseWorkRunId(params.work_run_id);
  const workItemId = canonicalWorkItemId(params.work_item_id);
  const expectedProjectId = projectId(project);
  assertWorkItemOwnership(expectedProjectId, workItemId);
  const leaseMode = parseLeaseMode(params.lease_mode);
  const handoffToken = leaseMode === "portable-handoff" && typeof params.handoff_token === "string" ? params.handoff_token : void 0;
  const identity = { projectId: expectedProjectId, workItemId, workRunId, agentId: agent, leaseMode, handoffToken };
  const durable = assertDurableRunIdentity(vaultPath, project, identity);
  assertGovernedRunLocks(params, durable.record);
  const state = durable.state;
  if (state !== "leased" && state !== "running") {
    throw conflict(`Work Run identity conflict: join requires leased or running state, found ${String(state)}`);
  }
  assertJoinLeaseAuthority(vaultPath, identity, durable.record);
  return { ...identity, state };
}
function durableTransitions(value) {
  if (!Array.isArray(value))
    return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      return [];
    const raw = item;
    if (typeof raw.transition_token !== "string")
      return [];
    return [{
      transition_token: raw.transition_token,
      from: typeof raw.from === "string" ? raw.from : null,
      to: typeof raw.to === "string" ? raw.to : null,
      recorded_at: raw.recorded_at ?? null
    }];
  });
}
function syncDurableWorkRunUnlocked(vaultPath, state, transitionToken, leasedIdentity) {
  const path = durableRunPath(state.project, state.workRunId);
  const fullPath2 = vaultJoin(vaultPath, path);
  let run = {};
  const original = existsSync7(fullPath2) ? readFileSync7(fullPath2, "utf-8") : null;
  if (original !== null) {
    try {
      run = JSON.parse(original);
    } catch {
      throw makeErr(-32603, `Durable Work Run is malformed: ${path}`);
    }
    identityEquals("Project", state.projectId, run.project_id);
    identityEquals("Work Item", state.workItemId, run.work_item_id);
    identityEquals("Work Run", state.workRunId, run.work_run_id);
    identityEquals("agent", state.agent, run.agent_id);
    const previousState = run.state;
    if (!WORK_RUN_STATES.includes(previousState)) {
      throw conflict("Work Run state conflict: durable state is invalid", { actual: run.state });
    }
    if (previousState !== state.workRunState && !isWorkRunTransitionAllowed(previousState, state.workRunState)) {
      throw conflict(`Invalid Work Run transition: ${previousState} -> ${state.workRunState}`);
    }
  }
  if (leasedIdentity)
    assertJoinLeaseAuthority(vaultPath, leasedIdentity, run);
  const transitions = durableTransitions(run.transitions);
  if (!transitions.some((item) => item.transition_token === transitionToken)) {
    const previous = typeof run.state === "string" ? run.state : state.workRunState === "running" ? "leased" : "planned";
    if (previous !== state.workRunState) {
      transitions.push({ transition_token: transitionToken, from: previous, to: state.workRunState, recorded_at: state.updatedAt });
    }
  }
  const extensions = governedRunExtensions(run);
  const durable = {
    schema_version: Object.keys(extensions).length > 0 ? 2 : 1,
    project_id: state.projectId,
    work_item_id: state.workItemId,
    work_run_id: state.workRunId,
    agent_id: state.agent,
    state: state.workRunState,
    output_class: state.outputClass,
    approval_status: state.approvalStatus,
    created_at: run.created_at ?? state.startedAt,
    updated_at: state.updatedAt,
    provenance: [...state.provenance].sort(),
    transitions,
    ...extensions,
    ...typeof run.handoff_token_hash === "string" ? { handoff_token_hash: run.handoff_token_hash } : {},
    ...typeof run.handoff_expires_at === "string" ? { handoff_expires_at: run.handoff_expires_at } : {}
  };
  mkdirSync5(dirname9(fullPath2), { recursive: true });
  const temporary = `${fullPath2}.tmp-${randomUUID9()}`;
  writeFileSync4(temporary, JSON.stringify(durable, null, 2) + "\n", "utf-8");
  const unchanged = original === null ? !existsSync7(fullPath2) : existsSync7(fullPath2) && readFileSync7(fullPath2, "utf-8") === original;
  if (!unchanged) {
    rmSync3(temporary, { force: true });
    throw conflict(`Work Run changed concurrently: ${state.workRunId}`);
  }
  renameSync3(temporary, fullPath2);
  return path;
}
function assertDurableLifetimeIdentity(vaultPath, state) {
  const durable = assertDurableRunIdentity(vaultPath, state.project, {
    projectId: state.projectId,
    workItemId: state.workItemId,
    workRunId: state.workRunId,
    agentId: state.agent
  });
  if (durable.state !== state.workRunState) {
    throw conflict("Work Run state conflict: lifetime and durable run differ", {
      lifetime: state.workRunState,
      durable: durable.state
    });
  }
}
function withFileRollback(vaultPath, relPaths, action) {
  const preimages = [...new Set(relPaths)].map((relPath) => {
    const fullPath2 = vaultJoin(vaultPath, relPath);
    return { fullPath: fullPath2, content: existsSync7(fullPath2) ? readFileSync7(fullPath2) : null };
  });
  try {
    return action();
  } catch (error) {
    for (const preimage of preimages.reverse()) {
      if (preimage.content === null) {
        rmSync3(preimage.fullPath, { force: true });
      } else {
        mkdirSync5(dirname9(preimage.fullPath), { recursive: true });
        writeFileSync4(preimage.fullPath, preimage.content);
      }
    }
    throw error;
  }
}
function vaultJoin(vaultPath, relPath) {
  return join10(vaultPath, ...relPath.split("/"));
}
function writeVaultBytes(vaultPath, relPath, content) {
  const fullPath2 = vaultJoin(vaultPath, relPath);
  mkdirSync5(dirname9(fullPath2), { recursive: true });
  writeFileSync4(fullPath2, Buffer.from(content, "utf-8"));
}
function appendVaultBytes(vaultPath, relPath, content) {
  const fullPath2 = vaultJoin(vaultPath, relPath);
  mkdirSync5(dirname9(fullPath2), { recursive: true });
  const existing = existsSync7(fullPath2) ? readFileSync7(fullPath2, "utf-8").replace(/\s+$/, "") + "\n\n" : "";
  writeFileSync4(fullPath2, Buffer.from(existing + content, "utf-8"));
}
function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}
function oneLine(value, max = 240) {
  const text2 = optionalString(value).replace(/\r?\n/g, " ");
  return text2.length > max ? text2.slice(0, max) : text2;
}
function stringList2(value) {
  if (!Array.isArray(value))
    return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of value) {
    if (typeof item !== "string")
      continue;
    const text2 = item.trim();
    if (!text2 || seen.has(text2))
      continue;
    seen.add(text2);
    out.push(text2);
  }
  return out;
}
function assertPersistedTextSafe(label, value) {
  if (!value)
    return;
  const candidates = [value.trim()];
  const uriReference = /^[a-z][a-z0-9+.-]*:\/\/(.*)$/i.exec(candidates[0]);
  const logicalReference = /^[a-z][a-z0-9+.-]*:(.*)$/i.exec(candidates[0]);
  if (uriReference)
    candidates.push(uriReference[1]);
  else if (logicalReference)
    candidates.push(logicalReference[1]);
  const exposesPath = candidates.some((candidate) => {
    if (/^file:/i.test(candidate))
      return true;
    if (/^https?:\/\//i.test(candidate))
      return false;
    return /^(?:[A-Za-z]:[\\/]|\\\\|\/|~[\\/]|\.{1,2}[\\/])/.test(candidate) || /(?:^|[\/:=\s])(?:[A-Za-z]:[\\/]|\\\\|\/(?:[^/\s]+\/)|~[\\/]|\.{1,2}[\\/])/.test(candidate);
  });
  const exposesSecret = /(?:lease|handoff)[-_ ]?token/i.test(value);
  if (exposesPath || exposesSecret) {
    throw makeErr(-32602, `${label} must not contain machine-local paths or lease tokens/handoff tokens`);
  }
}
function persistedOneLine(label, value, max = 240) {
  const text2 = oneLine(value, max);
  assertPersistedTextSafe(label, text2);
  return text2;
}
function persistedStringList(label, value) {
  const values = stringList2(value);
  for (const item of values)
    assertPersistedTextSafe(label, item);
  return values;
}
function assertSecretNotEchoed(secret, fields) {
  if (!secret)
    return;
  for (const [label, value] of fields) {
    const values = Array.isArray(value) ? value : [value];
    if (values.some((item) => item.includes(secret))) {
      throw makeErr(-32602, `${label} must not contain the handoff token`);
    }
  }
}
function assertAgentLifetimeTextSafe(state) {
  assertPersistedTextSafe("role", state.role);
  assertPersistedTextSafe("host", state.host);
  assertPersistedTextSafe("objective", state.objective);
  assertPersistedTextSafe("issue", state.issue);
  for (const item of state.evidence)
    assertPersistedTextSafe("evidence", item);
  for (const item of state.provenance)
    assertPersistedTextSafe("provenance", item);
  for (const receipt of state.transitions)
    assertPersistedTextSafe("transition_token", receipt.token);
}
function mergeStringLists(...lists) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const list of lists) {
    for (const item of list) {
      if (!item || seen.has(item))
        continue;
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}
function parseStage(value) {
  const stage = optionalString(value);
  if (!STAGES.includes(stage)) {
    throw makeErr(-32602, `stage must be one of: ${STAGES.join(", ")}`);
  }
  return stage;
}
function parseCheckpointStatus(value) {
  const status = optionalString(value) || "note";
  if (!CHECKPOINT_STATUSES.includes(status)) {
    throw makeErr(-32602, `status must be one of: ${CHECKPOINT_STATUSES.join(", ")}`);
  }
  return status;
}
function parseAgentStage(value, fallback) {
  const stage = optionalString(value) || fallback || "think";
  if (!AGENT_STAGES.includes(stage)) {
    throw makeErr(-32602, `stage must be one of: ${AGENT_STAGES.join(", ")}`);
  }
  return stage;
}
function parseAgentStatus(value, fallback = "active") {
  const status = optionalString(value) || fallback;
  if (!AGENT_STATUSES.includes(status)) {
    throw makeErr(-32602, `status must be one of: ${AGENT_STATUSES.join(", ")}`);
  }
  return status;
}
function projectId(project) {
  return `project/${project}`;
}
function parseWorkRunId(value, fallbackProject, fallbackAgent) {
  const id2 = optionalString(value);
  if (!id2 && fallbackProject && fallbackAgent)
    return `work-run/legacy-${fallbackProject}-${fallbackAgent}`;
  if (!/^work-run\/[a-z0-9][a-z0-9-]*$/.test(id2)) {
    throw makeErr(-32602, "work_run_id must match work-run/<lowercase-kebab-id>");
  }
  return id2;
}
function createWorkRunId() {
  return `work-run/${randomUUID9()}`;
}
function parseWorkItemId(value, project, legacyIssue) {
  const explicit = optionalString(value);
  if (explicit) {
    const prefix = `${projectId(project)}/issue/`;
    if (!explicit.startsWith(prefix) || !/^project\/[a-z0-9][a-z0-9-]*\/issue\/[a-z0-9][a-z0-9-]*$/.test(explicit)) {
      throw makeErr(-32602, `work_item_id must match ${prefix}<lowercase-kebab-slug>`);
    }
    return explicit;
  }
  const issue2 = slugify(optionalString(legacyIssue));
  return issue2 ? `${projectId(project)}/issue/${issue2}` : "";
}
function parseWorkRunState(value, fallback) {
  const state = optionalString(value) || fallback;
  if (!WORK_RUN_STATES.includes(state)) {
    throw makeErr(-32602, `work_run_state must be one of: ${WORK_RUN_STATES.join(", ")}`);
  }
  return state;
}
function parseOutputClass(value, fallback = "view") {
  const outputClass = optionalString(value) || fallback;
  if (!WORK_RUN_OUTPUT_CLASSES.includes(outputClass)) {
    throw makeErr(-32602, `output_class must be one of: ${WORK_RUN_OUTPUT_CLASSES.join(", ")}`);
  }
  return outputClass;
}
function defaultApprovalStatus(outputClass) {
  return outputClass === "view" || outputClass === "work-state-transition" ? "not-required" : "pending";
}
function parseApprovalStatus(value, outputClass, fallback) {
  const approval = optionalString(value) || fallback || defaultApprovalStatus(outputClass);
  if (!WORK_RUN_APPROVAL_STATUSES.includes(approval)) {
    throw makeErr(-32602, `approval_status must be one of: ${WORK_RUN_APPROVAL_STATUSES.join(", ")}`);
  }
  if ((outputClass === "view" || outputClass === "work-state-transition") && approval !== "not-required") {
    throw makeErr(-32602, `${outputClass} output must use approval_status=not-required`);
  }
  return approval;
}
function parseTransitionToken(value) {
  const token = optionalString(value) || `legacy:${randomUUID9()}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(token)) {
    throw makeErr(-32602, "transition_token must be 1-128 safe identifier characters");
  }
  assertPersistedTextSafe("transition_token", token);
  return token;
}
function durableProvenance(value) {
  return persistedStringList("provenance", value);
}
function isTerminalWorkRunState(state) {
  return WORK_RUN_TERMINAL_STATES.includes(state);
}
function isWorkRunTransitionAllowed(from, to) {
  return WORK_RUN_TRANSITIONS[from].includes(to);
}
function assertWorkRunMutable(state) {
  if (isTerminalWorkRunState(state.workRunState)) {
    throw makeErr(-32602, `Work Run ${state.workRunId} is terminal (${state.workRunState})`);
  }
}
function transitionWorkRun(current, next) {
  if (current === next)
    return current;
  if (!isWorkRunTransitionAllowed(current, next)) {
    throw makeErr(-32602, `invalid Work Run transition: ${current} -> ${next}`);
  }
  return next;
}
function completionState(outputClass, approval) {
  if (outputClass === "external-side-effect" && approval !== "approved") {
    return "awaiting_review";
  }
  if (outputClass === "knowledge-claim" && approval === "pending")
    return "awaiting_review";
  if (approval === "denied")
    return "failed";
  return "completed";
}
function assertWorkRunIdentity(current, supplied) {
  const id2 = optionalString(supplied);
  if (id2 && parseWorkRunId(id2) !== current.workRunId) {
    throw makeErr(-32602, `work_run_id does not match joined Work Run ${current.workRunId}`);
  }
}
function findTransitionReceipt(state, token, operation) {
  const receipt = state.transitions.find((item) => item.token === token);
  if (!receipt)
    return null;
  if (receipt.operation !== operation) {
    throw makeErr(-32602, `transition_token already used by ${receipt.operation}`);
  }
  return receipt;
}
function withTransitionReceipt(state, token, operation) {
  return {
    ...state,
    transitions: [
      ...state.transitions,
      {
        token,
        operation,
        workRunState: state.workRunState,
        agentStage: state.stage,
        agentStatus: state.status,
        outputClass: state.outputClass,
        approvalStatus: state.approvalStatus,
        recordedAt: state.updatedAt
      }
    ]
  };
}
function replayResult(state, receipt, eventsPath) {
  return {
    ok: true,
    idempotent: true,
    project: state.project,
    projectId: state.projectId,
    agent: state.agent,
    workRunId: state.workRunId,
    path: state.path,
    eventsPath,
    lifetime: {
      ...state,
      stage: receipt.agentStage,
      status: receipt.agentStatus,
      workRunState: receipt.workRunState,
      outputClass: receipt.outputClass,
      approvalStatus: receipt.approvalStatus,
      updatedAt: receipt.recordedAt
    },
    receipt
  };
}
function replayJoin(state, eventsPath) {
  const receipt = [...state.transitions].reverse().find((item) => item.operation === "join");
  if (receipt)
    return replayResult(state, receipt, eventsPath);
  return {
    ok: true,
    idempotent: true,
    project: state.project,
    projectId: state.projectId,
    agent: state.agent,
    workRunId: state.workRunId,
    path: state.path,
    eventsPath,
    runPath: durableRunPath(state.project, state.workRunId),
    lifetime: state
  };
}
function yamlString(value) {
  return JSON.stringify(value);
}
function isoNow() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function renderState(state, notes) {
  const evidenceLines = state.evidence.length ? state.evidence.map((item) => `- ${item}`).join("\n") : "- none";
  return [
    "---",
    "type: workflow-state",
    `entity: project/${state.project}/workflow/state`,
    `project: ${state.project}`,
    `stage: ${state.stage}`,
    `objective: ${yamlString(state.objective)}`,
    `branch: ${yamlString(state.branch)}`,
    `host: ${yamlString(state.host)}`,
    `evidence: ${JSON.stringify(state.evidence)}`,
    `updated-by: ${state.updatedBy}`,
    `updated-at: ${yamlString(state.updatedAt)}`,
    "---",
    "",
    `# Workflow State: ${state.project}`,
    "",
    "## Objective",
    "",
    state.objective || "No objective recorded.",
    "",
    "## Current Branch",
    "",
    state.branch || "No branch recorded.",
    "",
    "## Evidence",
    "",
    evidenceLines,
    "",
    "## Notes",
    "",
    notes || "No notes recorded.",
    ""
  ].join("\n");
}
function parseState(project, path, content) {
  const fm = parseFrontmatter(content);
  const rawEvidence = fm.evidence;
  const evidence = Array.isArray(rawEvidence) ? rawEvidence.filter((item) => typeof item === "string") : [];
  const stage = STAGES.includes(fm.stage) ? fm.stage : "intake";
  return {
    project,
    stage,
    objective: typeof fm.objective === "string" ? fm.objective : "",
    branch: typeof fm.branch === "string" ? fm.branch : "",
    host: typeof fm.host === "string" ? fm.host : "",
    evidence,
    updatedBy: typeof fm["updated-by"] === "string" ? fm["updated-by"] : "",
    updatedAt: typeof fm["updated-at"] === "string" ? fm["updated-at"] : "",
    path
  };
}
function parseFrontmatter(content) {
  if (!content.startsWith("---\n"))
    return {};
  const end = content.indexOf("\n---", 4);
  if (end === -1)
    return {};
  const fm = {};
  for (const line of content.slice(4, end).split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1)
      continue;
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    if (!key)
      continue;
    fm[key] = parseYamlScalar(raw);
  }
  return fm;
}
function parseYamlScalar(raw) {
  if (!raw)
    return "";
  if (raw.startsWith('"') && raw.endsWith('"') || raw.startsWith("[")) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.replace(/^"|"$/g, "");
    }
  }
  return raw;
}
function readState(vaultPath, project) {
  const path = statePath(project);
  const fullPath2 = vaultJoin(vaultPath, path);
  if (!existsSync7(fullPath2))
    return null;
  return parseState(project, path, readFileSync7(fullPath2, "utf-8"));
}
function checkpointHeader(project) {
  return [
    "---",
    "type: workflow-checkpoints",
    `entity: project/${project}/workflow/checkpoints`,
    `project: ${project}`,
    "---",
    "",
    `# Workflow Checkpoints: ${project}`,
    ""
  ].join("\n");
}
function renderAgentLifetime(state, notes) {
  const evidenceLines = state.evidence.length ? state.evidence.map((item) => `- ${item}`).join("\n") : "- none";
  return [
    "---",
    "type: agent-lifetime",
    `entity: project/${state.project}/agent/${state.agent}/lifetime`,
    `project-id: ${state.projectId}`,
    `project: ${state.project}`,
    `work-run-id: ${state.workRunId}`,
    `work-run-state: ${state.workRunState}`,
    `work-item-id: ${yamlString(state.workItemId)}`,
    `agent: ${state.agent}`,
    `role: ${yamlString(state.role)}`,
    `host: ${yamlString(state.host)}`,
    `stage: ${state.stage}`,
    `status: ${state.status}`,
    `objective: ${yamlString(state.objective)}`,
    `issue: ${yamlString(state.issue)}`,
    `evidence: ${JSON.stringify(state.evidence)}`,
    `provenance: ${JSON.stringify(state.provenance)}`,
    `output-class: ${state.outputClass}`,
    `approval-status: ${state.approvalStatus}`,
    `transitions: ${JSON.stringify(state.transitions)}`,
    `started-at: ${yamlString(state.startedAt)}`,
    `updated-at: ${yamlString(state.updatedAt)}`,
    "---",
    "",
    `# Agent Lifetime: ${state.agent}`,
    "",
    `- project: ${state.project}`,
    `- project-id: ${state.projectId}`,
    `- work-run-id: ${state.workRunId}`,
    `- work-run-state: ${state.workRunState}`,
    `- work-item-id: ${state.workItemId || "none"}`,
    `- role: ${state.role || "agent"}`,
    `- host: ${state.host || "unknown"}`,
    `- stage: ${state.stage}`,
    `- status: ${state.status}`,
    `- issue: ${state.issue || "none"}`,
    `- output-class: ${state.outputClass}`,
    `- approval-status: ${state.approvalStatus}`,
    "",
    "## Objective",
    "",
    state.objective || "No objective recorded.",
    "",
    "## Evidence",
    "",
    evidenceLines,
    "",
    "## Notes",
    "",
    notes || "No notes recorded.",
    ""
  ].join("\n");
}
function parseAgentLifetime(project, agent, path, content) {
  const fm = parseFrontmatter(content);
  const rawEvidence = fm.evidence;
  const evidence = Array.isArray(rawEvidence) ? rawEvidence.filter((item) => typeof item === "string") : [];
  const stage = AGENT_STAGES.includes(fm.stage) ? fm.stage : "think";
  const status = AGENT_STATUSES.includes(fm.status) ? fm.status : "active";
  const workRunState = WORK_RUN_STATES.includes(fm["work-run-state"]) ? fm["work-run-state"] : status === "done" ? "completed" : status === "archived" ? "cancelled" : "running";
  const outputClass = WORK_RUN_OUTPUT_CLASSES.includes(fm["output-class"]) ? fm["output-class"] : "view";
  const approvalStatus = WORK_RUN_APPROVAL_STATUSES.includes(fm["approval-status"]) ? fm["approval-status"] : defaultApprovalStatus(outputClass);
  const rawProvenance = fm.provenance;
  const provenance = Array.isArray(rawProvenance) ? rawProvenance.filter((item) => typeof item === "string") : [];
  const rawTransitions = fm.transitions;
  const transitions = Array.isArray(rawTransitions) ? rawTransitions.filter((item) => {
    if (typeof item !== "object" || item === null)
      return false;
    const receipt = item;
    return typeof receipt.token === "string" && ["join", "step", "checkpoint", "leave"].includes(String(receipt.operation)) && WORK_RUN_STATES.includes(receipt.workRunState);
  }) : [];
  const now = isoNow();
  return {
    projectId: typeof fm["project-id"] === "string" ? fm["project-id"] : projectId(project),
    project,
    workRunId: typeof fm["work-run-id"] === "string" ? parseWorkRunId(fm["work-run-id"]) : parseWorkRunId(void 0, project, agent),
    workRunState,
    workItemId: typeof fm["work-item-id"] === "string" ? fm["work-item-id"] : parseWorkItemId(void 0, project, fm.issue),
    agent,
    role: typeof fm.role === "string" ? fm.role : "agent",
    host: typeof fm.host === "string" ? fm.host : "unknown",
    stage,
    status,
    objective: typeof fm.objective === "string" ? fm.objective : "",
    issue: typeof fm.issue === "string" ? fm.issue : "",
    evidence,
    provenance,
    outputClass,
    approvalStatus,
    transitions,
    startedAt: typeof fm["started-at"] === "string" ? fm["started-at"] : now,
    updatedAt: typeof fm["updated-at"] === "string" ? fm["updated-at"] : now,
    path
  };
}
function readAgentLifetime(vaultPath, project, agent) {
  const path = agentLifetimePath(project, agent);
  const fullPath2 = vaultJoin(vaultPath, path);
  if (!existsSync7(fullPath2))
    return null;
  return parseAgentLifetime(project, agent, path, readFileSync7(fullPath2, "utf-8"));
}
function agentEventsHeader(project, agent) {
  return [
    "---",
    "type: agent-lifetime-events",
    `entity: project/${project}/agent/${agent}/events`,
    `project: ${project}`,
    `agent: ${agent}`,
    "---",
    "",
    `# Agent Lifetime Events: ${agent}`,
    ""
  ].join("\n");
}
function appendAgentEvent(vaultPath, state, event) {
  const path = agentEventsPath(state.project, state.agent);
  const fullPath2 = vaultJoin(vaultPath, path);
  const evidence = event.evidence ?? [];
  const evidenceLines = evidence.length ? evidence.map((item) => `  - ${item}`).join("\n") : "  - none";
  const block = [
    existsSync7(fullPath2) ? "" : agentEventsHeader(state.project, state.agent),
    `## ${isoNow()} - ${event.kind} - ${event.actor}`,
    "",
    `- stage: ${state.stage}`,
    `- status: ${state.status}`,
    `- work-run-id: ${state.workRunId}`,
    `- work-run-state: ${state.workRunState}`,
    `- transition-token: ${event.transitionToken}`,
    `- output-class: ${state.outputClass}`,
    `- approval-status: ${state.approvalStatus}`,
    `- summary: ${event.summary}`,
    "- evidence:",
    evidenceLines,
    `- next: ${event.next || "none"}`,
    ""
  ].filter((part) => part !== "").join("\n");
  appendVaultBytes(vaultPath, path, block);
  return path;
}
function canTransitionAgentStage(from, to) {
  if (from === to)
    return true;
  if ((from === "review" || from === "test") && to === "build")
    return true;
  return AGENT_STAGES.indexOf(to) === AGENT_STAGES.indexOf(from) + 1;
}
function evidenceMatchesRequirement(evidence, requirement) {
  const normalizedRequirement = requirement.toLowerCase();
  return evidence.some((item) => item.trim().toLowerCase().startsWith(normalizedRequirement));
}
function missingEvidenceForStage(stage, evidence) {
  const requirements = AGENT_STAGE_EVIDENCE_REQUIREMENTS[stage] ?? [];
  return requirements.filter((requirement) => !evidenceMatchesRequirement(evidence, requirement));
}
function formatEvidenceRequirements(requirements) {
  return requirements.map((requirement) => `${requirement}*`).join(", ");
}
function assertAgentStageEvidence(stage, evidence) {
  const missing = missingEvidenceForStage(stage, evidence);
  if (missing.length > 0) {
    throw makeErr(-32602, `${stage} stage requires evidence matching: ${formatEvidenceRequirements(missing)}`);
  }
}
function assertAgentTransition(current, nextStage, nextEvidence) {
  if (current.status === "archived") {
    throw makeErr(-32602, `${current.agent} is archived; join again before changing stage`);
  }
  if (!canTransitionAgentStage(current.stage, nextStage)) {
    throw makeErr(-32602, `invalid agent stage transition: ${current.stage} -> ${nextStage}`);
  }
  assertAgentStageEvidence(nextStage, nextEvidence);
}
function workflowDoctor(vaultPath, project) {
  const checks = [
    { name: "project-anchor", path: projectNotePath(project), required: true },
    { name: "issues-dir", path: issuesRoot(project), required: true },
    { name: "workflow-state", path: statePath(project), required: true },
    { name: "workflow-checkpoints", path: checkpointsPath(project), required: false },
    { name: "source-registry", path: "_llmwiki/source-registry.json", required: false }
  ].map((check) => ({ ...check, ok: existsSync7(vaultJoin(vaultPath, check.path)) }));
  const missing = checks.filter((check) => check.required && !check.ok).map((check) => check.path);
  const warnings = checks.filter((check) => !check.required && !check.ok).map((check) => check.path);
  return {
    ok: missing.length === 0,
    project,
    checks,
    missing,
    warnings
  };
}
function agentDoctor(vaultPath, project, agent, expectedWorkRunId) {
  const lifetime = readAgentLifetime(vaultPath, project, agent);
  const lifetimePath = agentLifetimePath(project, agent);
  const eventsPath = agentEventsPath(project, agent);
  const checks = [
    { name: "agent-lifetime", path: lifetimePath, required: true, ok: lifetime !== null },
    { name: "agent-events", path: eventsPath, required: false, ok: existsSync7(vaultJoin(vaultPath, eventsPath)) }
  ];
  const errors = [];
  const warnings = [];
  if (lifetime) {
    if (!AGENT_STAGES.includes(lifetime.stage))
      errors.push(`invalid stage: ${lifetime.stage}`);
    if (!AGENT_STATUSES.includes(lifetime.status))
      errors.push(`invalid status: ${lifetime.status}`);
    if (lifetime.projectId !== projectId(project))
      errors.push(`project-id mismatch: ${lifetime.projectId}`);
    if (!WORK_RUN_STATES.includes(lifetime.workRunState))
      errors.push(`invalid Work Run state: ${lifetime.workRunState}`);
    if (expectedWorkRunId && lifetime.workRunId !== expectedWorkRunId) {
      errors.push(`work-run-id mismatch: expected ${expectedWorkRunId}, found ${lifetime.workRunId}`);
    }
    if (isTerminalWorkRunState(lifetime.workRunState) && lifetime.status === "active") {
      errors.push(`terminal Work Run ${lifetime.workRunState} cannot have active agent status`);
    }
    if (!isTerminalWorkRunState(lifetime.workRunState) && lifetime.status === "archived") {
      errors.push(`non-terminal Work Run ${lifetime.workRunState} cannot have archived agent status`);
    }
    if ((lifetime.outputClass === "knowledge-claim" || lifetime.outputClass === "external-side-effect") && lifetime.workRunState === "completed" && lifetime.approvalStatus !== "approved") {
      errors.push(`${lifetime.outputClass} output completed without explicit approval`);
    }
    const tokens = lifetime.transitions.map((item) => item.token);
    if (new Set(tokens).size !== tokens.length)
      errors.push("duplicate transition token receipts");
    const missingEvidence = missingEvidenceForStage(lifetime.stage, lifetime.evidence);
    if (missingEvidence.length > 0) {
      errors.push(`${lifetime.stage} stage requires evidence matching: ${formatEvidenceRequirements(missingEvidence)}`);
    }
    if (lifetime.status === "active" && lifetime.stage === "reflect")
      warnings.push("reflect stage usually closes with status=done");
  }
  const missing = checks.filter((check) => check.required && !check.ok).map((check) => check.path);
  warnings.push(...checks.filter((check) => !check.required && !check.ok).map((check) => check.path));
  return {
    ok: missing.length === 0 && errors.length === 0,
    project,
    agent,
    checks,
    missing,
    errors,
    warnings,
    lifetime
  };
}
function beginAgentLifetime(vaultPath, ctx, params, mode) {
  const operation = mode === "leased" ? "workflow.agent.join" : "workflow.agent.start";
  const actor2 = actorFromContext(ctx);
  const project = existingProjectKey(vaultPath, params.project, operation);
  const agent = agentKey(params.agent, actor2);
  const transitionToken = parseTransitionToken(params.transition_token);
  let leasedIdentity = null;
  let workRunId;
  let workItemId;
  if (mode === "leased") {
    if (!optionalString(params.work_run_id) || !optionalString(params.work_item_id)) {
      throw makeErr(-32602, "workflow.agent.join requires a canonical Work Item, Work Run, and active lease identity");
    }
    const requestedWorkRunId = parseWorkRunId(params.work_run_id);
    const requestedWorkItemId = canonicalWorkItemId(params.work_item_id);
    const leaseMode = parseLeaseMode(params.lease_mode);
    const requestedIdentity = {
      projectId: projectId(project),
      workItemId: requestedWorkItemId,
      workRunId: requestedWorkRunId,
      agentId: agent,
      leaseMode,
      handoffToken: leaseMode === "portable-handoff" && typeof params.handoff_token === "string" ? params.handoff_token : void 0
    };
    assertWorkItemOwnership(requestedIdentity.projectId, requestedWorkItemId);
    const priorLifetime = readAgentLifetime(vaultPath, project, agent);
    const priorReceipt = priorLifetime ? findTransitionReceipt(priorLifetime, transitionToken, "join") : void 0;
    if (priorLifetime && priorReceipt) {
      identityEquals("Project", requestedIdentity.projectId, priorLifetime.projectId);
      identityEquals("Work Item", requestedWorkItemId, priorLifetime.workItemId);
      identityEquals("Work Run", requestedWorkRunId, priorLifetime.workRunId);
      identityEquals("agent", agent, priorLifetime.agent);
      const durable = assertDurableRunIdentity(vaultPath, project, requestedIdentity);
      assertGovernedRunLocks(params, durable.record);
      assertJoinLeaseAuthority(vaultPath, requestedIdentity, durable.record);
      return replayResult(priorLifetime, priorReceipt, agentEventsPath(project, agent));
    }
    leasedIdentity = assertLeasedRunIdentity(vaultPath, project, agent, params);
    workRunId = leasedIdentity.workRunId;
    workItemId = leasedIdentity.workItemId;
  } else {
    if (optionalString(params.work_run_id) || optionalString(params.work_item_id) || optionalString(params.work_run_state) || optionalString(params.lease_mode) || optionalString(params.handoff_token) || GOVERNED_RUN_EXTENSION_KEYS.some((key) => params[key] !== void 0)) {
      throw makeErr(-32602, "workflow.agent.start creates manual runs and does not accept leased identity fields or governed assignment identity fields");
    }
    workRunId = createWorkRunId();
    workItemId = parseWorkItemId(void 0, project, params.issue);
  }
  const existing = readAgentLifetime(vaultPath, project, agent);
  if (existing) {
    const receipt = findTransitionReceipt(existing, transitionToken, "join");
    identityEquals("Project", projectId(project), existing.projectId);
    identityEquals("agent", agent, existing.agent);
    if (leasedIdentity) {
      identityEquals("Work Run", workRunId, existing.workRunId);
      identityEquals("Work Item", workItemId, existing.workItemId);
      if (receipt)
        return replayResult(existing, receipt, agentEventsPath(project, agent));
      return replayJoin(existing, agentEventsPath(project, agent));
    }
    if (receipt)
      return replayResult(existing, receipt, agentEventsPath(project, agent));
    if (!isTerminalWorkRunState(existing.workRunState)) {
      throw conflict(`${agent} already joined Work Run ${existing.workRunId}`);
    }
  }
  const initialWorkRunState = leasedIdentity?.state ?? "running";
  const suppliedState = optionalString(params.work_run_state);
  if (leasedIdentity && suppliedState && suppliedState !== initialWorkRunState) {
    throw conflict("Work Run state conflict", { expected: initialWorkRunState, actual: suppliedState });
  }
  if (initialWorkRunState !== "leased" && initialWorkRunState !== "running") {
    throw makeErr(-32602, "workflow.agent.join can attach only a leased or already-running Work Run");
  }
  const now = isoNow();
  const path = agentLifetimePath(project, agent);
  const stage = parseAgentStage(params.stage, "think");
  const evidence = persistedStringList("evidence", params.evidence);
  assertAgentStageEvidence(stage, evidence);
  const outputClass = parseOutputClass(params.output_class);
  const approvalStatus = parseApprovalStatus(params.approval_status, outputClass);
  let state = {
    projectId: leasedIdentity?.projectId ?? projectId(project),
    project,
    workRunId,
    workRunState: initialWorkRunState === "leased" ? transitionWorkRun("leased", "running") : "running",
    workItemId,
    agent,
    role: persistedOneLine("role", params.role) || "agent",
    host: persistedOneLine("host", params.host) || actor2,
    stage,
    status: "active",
    objective: persistedOneLine("objective", params.objective),
    issue: persistedOneLine("issue", params.issue),
    evidence,
    provenance: durableProvenance(params.provenance),
    outputClass,
    approvalStatus,
    transitions: [],
    startedAt: now,
    updatedAt: now,
    path
  };
  state = withTransitionReceipt(state, transitionToken, "join");
  assertAgentLifetimeTextSafe(state);
  const notes = persistedOneLine("notes", params.notes, 2e3);
  assertSecretNotEchoed(leasedIdentity?.handoffToken, [
    ["transition_token", transitionToken],
    ["role", state.role],
    ["host", state.host],
    ["objective", state.objective],
    ["issue", state.issue],
    ["evidence", state.evidence],
    ["provenance", state.provenance],
    ["notes", notes]
  ]);
  const lifetimeFullPath = vaultJoin(vaultPath, path);
  const expectedLifetimeBytes = existsSync7(lifetimeFullPath) ? readFileSync7(lifetimeFullPath, "utf-8") : null;
  const { runPath, eventsPath } = withWorkRunLock(vaultPath, () => {
    const lockedLifetimeBytes = existsSync7(lifetimeFullPath) ? readFileSync7(lifetimeFullPath, "utf-8") : null;
    if (lockedLifetimeBytes !== expectedLifetimeBytes) {
      throw conflict(`${agent} lifetime changed while joining Work Run ${workRunId}; retry the operation`);
    }
    return withFileRollback(vaultPath, [path, agentEventsPath(project, agent), durableRunPath(project, workRunId)], () => {
      const persistedRunPath = syncDurableWorkRunUnlocked(vaultPath, state, transitionToken, leasedIdentity ?? void 0);
      writeVaultBytes(vaultPath, path, renderAgentLifetime(state, notes));
      const persistedEventsPath = appendAgentEvent(vaultPath, state, {
        kind: "join",
        summary: state.objective || `${agent} joined`,
        evidence: state.evidence,
        actor: actor2,
        transitionToken
      });
      return { runPath: persistedRunPath, eventsPath: persistedEventsPath };
    });
  });
  return {
    ok: true,
    idempotent: false,
    project,
    projectId: state.projectId,
    agent,
    workRunId,
    path,
    eventsPath,
    runPath,
    lifetime: state
  };
}
function makeWorkflowOps(vaultPath) {
  return [
    {
      name: "workflow.state.set",
      namespace: "workflow",
      description: "Create or update the vault-first agent workflow state at 01-Projects/<project>/workflow/status.md.",
      mutating: true,
      writePolicy: {
        realWrite: "always",
        targets: (ctx, params) => [`${workflowPolicyBasePath(ctx.config, params, "workflow.state.set")}/status.md`],
        audit: "required",
        effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), "modify")]
      },
      params: {
        project: { type: "string", required: true, description: "Project key" },
        stage: {
          type: "string",
          required: true,
          enum: [...STAGES],
          description: "Workflow stage: intake|understand|plan|execute|review|verify|archive"
        },
        objective: { type: "string", required: false, description: "Current project objective" },
        branch: { type: "string", required: false, description: "Current execution branch or workstream" },
        host: { type: "string", required: false, description: "Agent host, e.g. codex or claude-code" },
        evidence: { type: "array", required: false, description: "Evidence refs such as test:, source:, commit:, or path:" },
        notes: { type: "string", required: false, description: "Short workflow notes" }
      },
      handler: async (ctx, params) => {
        const project = existingProjectKey(vaultPath, params.project, "workflow.state.set");
        const stage = parseStage(params.stage);
        const actor2 = actorFromContext(ctx);
        const path = statePath(project);
        const state = {
          project,
          stage,
          objective: persistedOneLine("objective", params.objective),
          branch: persistedOneLine("branch", params.branch),
          host: persistedOneLine("host", params.host) || actor2,
          evidence: persistedStringList("evidence", params.evidence),
          updatedBy: actor2,
          updatedAt: isoNow(),
          path
        };
        writeVaultBytes(vaultPath, path, renderState(state, persistedOneLine("notes", params.notes, 2e3)));
        return {
          ok: true,
          project,
          path,
          state,
          projectInitialized: existsSync7(vaultJoin(vaultPath, projectNotePath(project)))
        };
      }
    },
    {
      name: "workflow.state.get",
      namespace: "workflow",
      description: "Read the current vault-first agent workflow state for a project.",
      mutating: false,
      params: {
        project: { type: "string", required: true, description: "Project key" }
      },
      handler: async (_ctx, params) => {
        const project = existingProjectKey(vaultPath, params.project, "workflow.state.get");
        const path = statePath(project);
        const state = readState(vaultPath, project);
        return { exists: state !== null, project, path, state };
      }
    },
    {
      name: "workflow.checkpoint.add",
      namespace: "workflow",
      description: "Append an agent workflow checkpoint under 01-Projects/<project>/workflow/checkpoints.md.",
      mutating: true,
      writePolicy: {
        realWrite: "always",
        targets: (ctx, params) => [`${workflowPolicyBasePath(ctx.config, params, "workflow.checkpoint.add")}/checkpoints.md`],
        audit: "required",
        effects: (_ctx, _params, result) => [touchMarkdown(resultPath(result), "modify")]
      },
      params: {
        project: { type: "string", required: true, description: "Project key" },
        stage: {
          type: "string",
          required: true,
          enum: [...STAGES],
          description: "Workflow stage for this checkpoint"
        },
        summary: { type: "string", required: true, description: "Checkpoint summary" },
        status: {
          type: "string",
          required: false,
          enum: [...CHECKPOINT_STATUSES],
          default: "note",
          description: "Checkpoint status: note|passed|failed|blocked"
        },
        evidence: { type: "array", required: false, description: "Evidence refs for this checkpoint" },
        next: { type: "string", required: false, description: "Next action or stop condition" }
      },
      handler: async (ctx, params) => {
        const project = existingProjectKey(vaultPath, params.project, "workflow.checkpoint.add");
        const stage = parseStage(params.stage);
        const status = parseCheckpointStatus(params.status);
        const summary = persistedOneLine("summary", params.summary);
        if (!summary)
          throw makeErr(-32602, "summary required");
        const actor2 = actorFromContext(ctx);
        const path = checkpointsPath(project);
        const fullPath2 = vaultJoin(vaultPath, path);
        const evidence = persistedStringList("evidence", params.evidence);
        const next = persistedOneLine("next", params.next);
        const now = isoNow();
        const evidenceLines = evidence.length ? evidence.map((item) => `  - ${item}`).join("\n") : "  - none";
        const block = [
          existsSync7(fullPath2) ? "" : checkpointHeader(project),
          `## ${now} - ${stage} - ${actor2}`,
          "",
          `- status: ${status}`,
          `- summary: ${summary}`,
          "- evidence:",
          evidenceLines,
          `- next: ${next || "none"}`,
          ""
        ].filter((part) => part !== "").join("\n");
        appendVaultBytes(vaultPath, path, block);
        return { ok: true, project, path, stage, status, actor: actor2, evidence };
      }
    },
    {
      name: "workflow.agent.start",
      namespace: "workflow",
      description: "Create a restricted manual Work Run without accepting or impersonating Work Driver lease identity fields.",
      mutating: true,
      writePolicy: {
        realWrite: "always",
        targets: workflowAgentTargets,
        audit: "required",
        effects: workflowAgentEffects
      },
      params: {
        project: { type: "string", required: true, description: "Project key" },
        agent: { type: "string", required: false, description: "Agent id; defaults collaboration actor" },
        role: { type: "string", required: false, description: "Agent role, e.g. manager|worker|reviewer|verifier" },
        host: { type: "string", required: false, description: "Agent host, e.g. codex or claude-code" },
        objective: { type: "string", required: false, description: "Lifetime objective" },
        issue: { type: "string", required: false, description: "Linked issue slug or entity" },
        transition_token: { type: "string", required: false, description: "Stable idempotency token for retrying manual creation" },
        output_class: { type: "string", required: false, enum: [...WORK_RUN_OUTPUT_CLASSES] },
        approval_status: { type: "string", required: false, enum: [...WORK_RUN_APPROVAL_STATUSES] },
        provenance: { type: "array", required: false, description: "Logical provenance refs; never local paths or secrets" },
        stage: {
          type: "string",
          required: false,
          enum: [...AGENT_STAGES],
          default: "think",
          description: "Initial lifetime stage: think|plan|build|review|test|ship|reflect. test requires review:* evidence; ship requires review:* and test:* evidence."
        },
        evidence: {
          type: "array",
          required: false,
          description: "Initial evidence refs. Use prefixes such as review:* and test:* for stage gates."
        },
        notes: { type: "string", required: false, description: "Manual start notes" }
      },
      handler: async (ctx, params) => beginAgentLifetime(vaultPath, ctx, params, "manual")
    },
    {
      name: "workflow.agent.join",
      namespace: "workflow",
      description: "Assert and join an existing Work Driver lease without overwriting its durable identities.",
      mutating: true,
      writePolicy: {
        realWrite: "always",
        targets: workflowAgentTargets,
        audit: "required",
        effects: workflowAgentEffects
      },
      params: {
        project: { type: "string", required: true, description: "Project key" },
        agent: { type: "string", required: false, description: "Agent id; defaults collaboration actor" },
        role: { type: "string", required: false, description: "Agent role, e.g. manager|worker|reviewer|verifier" },
        host: { type: "string", required: false, description: "Agent host, e.g. codex or claude-code" },
        objective: { type: "string", required: false, description: "Lifetime objective" },
        issue: { type: "string", required: false, description: "Linked issue slug or entity" },
        work_run_id: { type: "string", required: true, description: "Shared Work Run ID from the Work Driver lease" },
        work_run_state: {
          type: "string",
          required: false,
          enum: [...WORK_RUN_STATES],
          description: "Existing Work Run state; leased is expected when attaching a Work Driver lease"
        },
        work_item_id: { type: "string", required: true, description: "Canonical project/<slug>/issue/<slug> identity" },
        agent_profile_id: { type: "string", required: false, description: "Locked Agent Profile identity asserted against the durable Work Run" },
        agent_profile_revision: { type: "number", required: false, description: "Locked positive Agent Profile revision" },
        project_agent_binding_id: { type: "string", required: false, description: "Locked Project Agent Binding identity" },
        project_agent_binding_revision: { type: "number", required: false, description: "Locked positive Project Agent Binding revision" },
        assignment_plan_id: { type: "string", required: false, description: "Approved deterministic Assignment Plan identity" },
        assignment_plan_version: { type: "number", required: false, description: "Locked positive Assignment Plan version" },
        assignment_plan_fingerprint: { type: "string", required: false, description: "Locked SHA-256 Assignment Plan fingerprint" },
        context_envelope_fingerprint: { type: "string", required: false, description: "Locked SHA-256 Context Envelope fingerprint" },
        device_snapshot: { type: "object", required: false, description: "Locked portable Device Snapshot used by the Assignment Plan" },
        parent_work_run_id: { type: "string", required: false, description: "Exactly one parent Work Run identity for a delegated child" },
        lease_mode: {
          type: "string",
          required: false,
          enum: [...LEASE_MODES],
          default: "local",
          description: "local requires this device active lease. portable-handoff requires a valid expiring handoff token bound to the durable Work Run; any present local lease is still fully validated."
        },
        handoff_token: {
          type: "string",
          required: false,
          description: "Sensitive secret required only for lease_mode=portable-handoff; never persisted or returned."
        },
        transition_token: { type: "string", required: false, description: "Stable idempotency token from the Work Driver transition" },
        output_class: { type: "string", required: false, enum: [...WORK_RUN_OUTPUT_CLASSES] },
        approval_status: { type: "string", required: false, enum: [...WORK_RUN_APPROVAL_STATUSES] },
        provenance: { type: "array", required: false, description: "Logical provenance refs; never local paths or secrets" },
        stage: {
          type: "string",
          required: false,
          enum: [...AGENT_STAGES],
          default: "think",
          description: "Initial lifetime stage: think|plan|build|review|test|ship|reflect. test requires review:* evidence; ship requires review:* and test:* evidence."
        },
        evidence: {
          type: "array",
          required: false,
          description: "Initial evidence refs. Use prefixes such as review:* and test:* for stage gates."
        },
        notes: { type: "string", required: false, description: "Join notes" }
      },
      handler: async (ctx, params) => beginAgentLifetime(vaultPath, ctx, params, "leased")
    },
    {
      name: "workflow.agent.step",
      namespace: "workflow",
      description: "Advance a joined agent and its shared Work Run with idempotent transitions, review/test evidence gates, and terminal-state enforcement.",
      mutating: true,
      writePolicy: {
        realWrite: "always",
        targets: workflowAgentTargets,
        audit: "required",
        effects: workflowAgentEffects
      },
      params: {
        project: { type: "string", required: true, description: "Project key" },
        agent: { type: "string", required: false, description: "Agent id; defaults collaboration actor" },
        stage: {
          type: "string",
          required: true,
          enum: [...AGENT_STAGES],
          description: "Next lifetime stage"
        },
        status: {
          type: "string",
          required: false,
          enum: [...AGENT_STATUSES],
          description: "Agent status: active|blocked|done|archived"
        },
        objective: { type: "string", required: false, description: "Replacement objective" },
        issue: { type: "string", required: false, description: "Replacement linked issue slug or entity" },
        work_run_id: { type: "string", required: false, description: "Joined Work Run ID; resolved from lifetime when omitted" },
        work_run_state: { type: "string", required: false, enum: [...WORK_RUN_STATES] },
        work_item_id: { type: "string", required: false, description: "Replacement canonical Work Item identity" },
        transition_token: { type: "string", required: false, description: "Idempotency token; generated for legacy calls" },
        output_class: { type: "string", required: false, enum: [...WORK_RUN_OUTPUT_CLASSES] },
        approval_status: { type: "string", required: false, enum: [...WORK_RUN_APPROVAL_STATUSES] },
        provenance: { type: "array", required: false },
        evidence: {
          type: "array",
          required: false,
          description: "Evidence refs to merge into lifetime. Use review:* before test and test:* before ship."
        },
        summary: { type: "string", required: false, description: "Transition summary" },
        next: { type: "string", required: false, description: "Next action or stop condition" }
      },
      handler: async (ctx, params) => {
        const actor2 = actorFromContext(ctx);
        const project = existingProjectKey(vaultPath, params.project, "workflow.agent.step");
        const agent = agentKey(params.agent, actor2);
        return withWorkRunLock(vaultPath, () => {
          const current = readAgentLifetime(vaultPath, project, agent);
          if (!current)
            throw makeErr(-32001, `Agent lifetime not found: ${agent}`);
          assertWorkRunIdentity(current, params.work_run_id);
          assertDurableLifetimeIdentity(vaultPath, current);
          const transitionToken = parseTransitionToken(params.transition_token);
          const receipt = findTransitionReceipt(current, transitionToken, "step");
          if (receipt)
            return replayResult(current, receipt, agentEventsPath(project, agent));
          assertWorkRunMutable(current);
          if (params.work_item_id !== void 0) {
            identityEquals("Work Item", current.workItemId, canonicalWorkItemId(params.work_item_id));
          }
          const stage = parseAgentStage(params.stage);
          const incomingEvidence = persistedStringList("evidence", params.evidence);
          const evidence = mergeStringLists(current.evidence, incomingEvidence);
          assertAgentTransition(current, stage, evidence);
          const outputClass = parseOutputClass(params.output_class, current.outputClass);
          const approvalStatus = parseApprovalStatus(params.approval_status, outputClass, outputClass === current.outputClass ? current.approvalStatus : void 0);
          let nextWorkRunState = optionalString(params.work_run_state) ? parseWorkRunState(params.work_run_state, current.workRunState) : stage === "reflect" ? completionState(outputClass, approvalStatus) : current.workRunState;
          if (nextWorkRunState === "completed" && completionState(outputClass, approvalStatus) !== "completed") {
            throw makeErr(-32602, `${outputClass} output requires approval before completion`);
          }
          nextWorkRunState = transitionWorkRun(current.workRunState, nextWorkRunState);
          const defaultAgentStatus = nextWorkRunState === "completed" || stage === "reflect" ? "done" : nextWorkRunState === "failed" || nextWorkRunState === "cancelled" ? "archived" : current.status;
          const status = parseAgentStatus(params.status, defaultAgentStatus);
          if (isTerminalWorkRunState(nextWorkRunState) && (status === "active" || status === "blocked")) {
            throw makeErr(-32602, `terminal Work Run ${nextWorkRunState} cannot use agent status ${status}`);
          }
          if (!isTerminalWorkRunState(nextWorkRunState) && status === "archived") {
            throw makeErr(-32602, `non-terminal Work Run ${nextWorkRunState} cannot use agent status archived`);
          }
          const summary = persistedOneLine("summary", params.summary);
          const next = persistedOneLine("next", params.next);
          let state = {
            ...current,
            stage,
            status,
            workRunState: nextWorkRunState,
            objective: params.objective === void 0 ? current.objective : persistedOneLine("objective", params.objective),
            issue: params.issue === void 0 ? current.issue : persistedOneLine("issue", params.issue),
            evidence,
            provenance: mergeStringLists(current.provenance, durableProvenance(params.provenance)),
            outputClass,
            approvalStatus,
            updatedAt: isoNow()
          };
          state = withTransitionReceipt(state, transitionToken, "step");
          assertAgentLifetimeTextSafe(state);
          const eventsPath = agentEventsPath(project, agent);
          const runPath = durableRunPath(project, state.workRunId);
          return withFileRollback(vaultPath, [state.path, eventsPath, runPath], () => {
            writeVaultBytes(vaultPath, state.path, renderAgentLifetime(state, summary));
            syncDurableWorkRunUnlocked(vaultPath, state, transitionToken);
            appendAgentEvent(vaultPath, state, {
              kind: "step",
              summary: summary || `${current.stage} -> ${stage}`,
              evidence: incomingEvidence,
              next,
              actor: actor2,
              transitionToken
            });
            return { ok: true, idempotent: false, project, projectId: state.projectId, agent, workRunId: state.workRunId, path: state.path, eventsPath, runPath, lifetime: state };
          });
        });
      }
    },
    {
      name: "workflow.agent.checkpoint",
      namespace: "workflow",
      description: "Record an idempotent Work Run checkpoint, optionally routing output or moving to review/terminal state.",
      mutating: true,
      writePolicy: {
        realWrite: "always",
        targets: workflowAgentTargets,
        audit: "required",
        effects: workflowAgentEffects
      },
      params: {
        project: { type: "string", required: true, description: "Project key" },
        agent: { type: "string", required: false, description: "Agent id; defaults collaboration actor" },
        status: {
          type: "string",
          required: false,
          enum: [...CHECKPOINT_STATUSES],
          default: "note",
          description: "Checkpoint status: note|passed|failed|blocked"
        },
        summary: { type: "string", required: true, description: "Checkpoint summary" },
        evidence: { type: "array", required: false, description: "Evidence refs for this checkpoint" },
        next: { type: "string", required: false, description: "Next action or stop condition" },
        work_run_id: { type: "string", required: false, description: "Joined Work Run ID; resolved from lifetime when omitted" },
        work_run_state: { type: "string", required: false, enum: [...WORK_RUN_STATES] },
        transition_token: { type: "string", required: false, description: "Idempotency token; generated for legacy calls" },
        output_class: { type: "string", required: false, enum: [...WORK_RUN_OUTPUT_CLASSES] },
        approval_status: { type: "string", required: false, enum: [...WORK_RUN_APPROVAL_STATUSES] },
        provenance: { type: "array", required: false }
      },
      handler: async (ctx, params) => {
        const actor2 = actorFromContext(ctx);
        const project = existingProjectKey(vaultPath, params.project, "workflow.agent.checkpoint");
        const agent = agentKey(params.agent, actor2);
        return withWorkRunLock(vaultPath, () => {
          const current = readAgentLifetime(vaultPath, project, agent);
          if (!current)
            throw makeErr(-32001, `Agent lifetime not found: ${agent}`);
          assertWorkRunIdentity(current, params.work_run_id);
          assertDurableLifetimeIdentity(vaultPath, current);
          const transitionToken = parseTransitionToken(params.transition_token);
          const receipt = findTransitionReceipt(current, transitionToken, "checkpoint");
          if (receipt)
            return replayResult(current, receipt, agentEventsPath(project, agent));
          assertWorkRunMutable(current);
          const status = parseCheckpointStatus(params.status);
          const summary = persistedOneLine("summary", params.summary);
          if (!summary)
            throw makeErr(-32602, "summary required");
          const outputClass = parseOutputClass(params.output_class, current.outputClass);
          const approvalStatus = parseApprovalStatus(params.approval_status, outputClass, outputClass === current.outputClass ? current.approvalStatus : void 0);
          let nextWorkRunState = optionalString(params.work_run_state) ? parseWorkRunState(params.work_run_state, current.workRunState) : status === "failed" ? "failed" : current.workRunState;
          if (nextWorkRunState === "completed" && completionState(outputClass, approvalStatus) !== "completed") {
            throw makeErr(-32602, `${outputClass} output requires approval before completion`);
          }
          nextWorkRunState = transitionWorkRun(current.workRunState, nextWorkRunState);
          const incomingEvidence = persistedStringList("evidence", params.evidence);
          const next = persistedOneLine("next", params.next);
          let state = {
            ...current,
            workRunState: nextWorkRunState,
            status: nextWorkRunState === "completed" ? "done" : nextWorkRunState === "failed" || nextWorkRunState === "cancelled" ? "archived" : current.status,
            evidence: mergeStringLists(current.evidence, incomingEvidence),
            provenance: mergeStringLists(current.provenance, durableProvenance(params.provenance)),
            outputClass,
            approvalStatus,
            updatedAt: isoNow()
          };
          state = withTransitionReceipt(state, transitionToken, "checkpoint");
          assertAgentLifetimeTextSafe(state);
          const eventsPath = agentEventsPath(project, agent);
          const runPath = durableRunPath(project, state.workRunId);
          return withFileRollback(vaultPath, [state.path, eventsPath, runPath], () => {
            writeVaultBytes(vaultPath, state.path, renderAgentLifetime(state, summary));
            syncDurableWorkRunUnlocked(vaultPath, state, transitionToken);
            appendAgentEvent(vaultPath, state, {
              kind: `checkpoint:${status}`,
              summary,
              evidence: incomingEvidence,
              next,
              actor: actor2,
              transitionToken
            });
            return {
              ok: true,
              idempotent: false,
              project,
              projectId: state.projectId,
              agent,
              workRunId: state.workRunId,
              path: state.path,
              eventsPath,
              runPath,
              stage: state.stage,
              status,
              workRunState: state.workRunState,
              lifetime: state
            };
          });
        });
      }
    },
    {
      name: "workflow.agent.leave",
      namespace: "workflow",
      description: "Leave a Work Run through awaiting-review or terminal state while preserving its durable lifetime and event log.",
      mutating: true,
      writePolicy: {
        realWrite: "always",
        targets: workflowAgentTargets,
        audit: "required",
        effects: workflowAgentEffects
      },
      params: {
        project: { type: "string", required: true, description: "Project key" },
        agent: { type: "string", required: false, description: "Agent id; defaults collaboration actor" },
        summary: { type: "string", required: false, description: "Leave summary" },
        work_run_id: { type: "string", required: false, description: "Joined Work Run ID; resolved from lifetime when omitted" },
        work_run_state: {
          type: "string",
          required: false,
          enum: ["awaiting_review", "completed", "failed", "cancelled"],
          description: "Final or review handoff state; defaults to cancelled for an unfinished run"
        },
        transition_token: { type: "string", required: false, description: "Idempotency token; generated for legacy calls" },
        output_class: { type: "string", required: false, enum: [...WORK_RUN_OUTPUT_CLASSES] },
        approval_status: { type: "string", required: false, enum: [...WORK_RUN_APPROVAL_STATUSES] },
        provenance: { type: "array", required: false }
      },
      handler: async (ctx, params) => {
        const actor2 = actorFromContext(ctx);
        const project = existingProjectKey(vaultPath, params.project, "workflow.agent.leave");
        const agent = agentKey(params.agent, actor2);
        return withWorkRunLock(vaultPath, () => {
          const current = readAgentLifetime(vaultPath, project, agent);
          if (!current)
            throw makeErr(-32001, `Agent lifetime not found: ${agent}`);
          assertWorkRunIdentity(current, params.work_run_id);
          assertDurableLifetimeIdentity(vaultPath, current);
          const transitionToken = parseTransitionToken(params.transition_token);
          const receipt = findTransitionReceipt(current, transitionToken, "leave");
          if (receipt)
            return replayResult(current, receipt, agentEventsPath(project, agent));
          assertWorkRunMutable(current);
          const outputClass = parseOutputClass(params.output_class, current.outputClass);
          const approvalStatus = parseApprovalStatus(params.approval_status, outputClass, outputClass === current.outputClass ? current.approvalStatus : void 0);
          let nextWorkRunState = parseWorkRunState(params.work_run_state, "cancelled");
          if (nextWorkRunState === "completed" && completionState(outputClass, approvalStatus) !== "completed") {
            throw makeErr(-32602, `${outputClass} output requires approval before completion`);
          }
          nextWorkRunState = transitionWorkRun(current.workRunState, nextWorkRunState);
          const summary = persistedOneLine("summary", params.summary);
          let state = {
            ...current,
            status: "archived",
            workRunState: nextWorkRunState,
            provenance: mergeStringLists(current.provenance, durableProvenance(params.provenance)),
            outputClass,
            approvalStatus,
            updatedAt: isoNow()
          };
          state = withTransitionReceipt(state, transitionToken, "leave");
          assertAgentLifetimeTextSafe(state);
          const eventsPath = agentEventsPath(project, agent);
          const runPath = durableRunPath(project, state.workRunId);
          return withFileRollback(vaultPath, [state.path, eventsPath, runPath], () => {
            writeVaultBytes(vaultPath, state.path, renderAgentLifetime(state, summary));
            syncDurableWorkRunUnlocked(vaultPath, state, transitionToken);
            appendAgentEvent(vaultPath, state, {
              kind: "leave",
              summary: summary || `${agent} archived`,
              actor: actor2,
              transitionToken
            });
            return { ok: true, idempotent: false, project, projectId: state.projectId, agent, workRunId: state.workRunId, path: state.path, eventsPath, runPath, lifetime: state };
          });
        });
      }
    },
    {
      name: "workflow.agent.doctor",
      namespace: "workflow",
      description: "Check one agent lifetime, Work Run identity, transition receipts, output policy, and event log for consistency.",
      mutating: false,
      params: {
        project: { type: "string", required: true, description: "Project key" },
        agent: { type: "string", required: false, description: "Agent id; defaults collaboration actor" },
        work_run_id: { type: "string", required: false, description: "Expected Work Run ID for cross-runtime join diagnosis" }
      },
      handler: async (ctx, params) => {
        const actor2 = actorFromContext(ctx);
        const project = existingProjectKey(vaultPath, params.project, "workflow.agent.doctor");
        const agent = agentKey(params.agent, actor2);
        const expectedWorkRunId = optionalString(params.work_run_id) ? parseWorkRunId(params.work_run_id) : void 0;
        return agentDoctor(vaultPath, project, agent, expectedWorkRunId);
      }
    },
    {
      name: "workflow.doctor",
      namespace: "workflow",
      description: "Check whether a project has the vault-first workflow files needed by Codex, Claude Code, and MCP tools.",
      mutating: false,
      params: {
        project: { type: "string", required: true, description: "Project key" }
      },
      handler: async (_ctx, params) => workflowDoctor(vaultPath, existingProjectKey(vaultPath, params.project, "workflow.doctor"))
    }
  ];
}

// dist/agent-domain/operations.js
var AGENT_DOMAIN_RELATIVE_ROOT = "_llmwiki/agent-domain/v1";
var USAGE_RELATIVE_ROOT = "_llmwiki/usage/v1";
var AGENT_DOMAIN_WRITE_POLICY = {
  realWrite: "always",
  targets: () => [`${AGENT_DOMAIN_RELATIVE_ROOT}/**`],
  audit: "required"
};
var AGENT_DOMAIN_USAGE_WRITE_POLICY = {
  realWrite: "always",
  targets: () => [`${AGENT_DOMAIN_RELATIVE_ROOT}/**`, `${USAGE_RELATIVE_ROOT}/**`],
  audit: "required"
};
var APPROVER_ROLES = /* @__PURE__ */ new Set(["human", "approver", "admin"]);
var TERMINAL_WORK_RUN_STATES = /* @__PURE__ */ new Set(["completed", "failed", "cancelled"]);
var ACTIVE_CHILD_WORK_RUN_STATES = /* @__PURE__ */ new Set(["ready", "running"]);
var CADENCE_GOVERNANCE_ID = "llmwiki/dreamtime-cadence/v1";
var PLATFORM_KERNEL = [{
  chunkId: "governance/llmwiki-agent-runtime-v1",
  content: {
    product: "llmwiki",
    rules: [
      "Use only server-loaded governed state.",
      "Treat approved memory as read-only context.",
      "Require explicit capability grants for side effects."
    ]
  },
  provenance: [{ kind: "governance", id: "llmwiki/agent-runtime", revision: 1 }],
  mandatory: true
}];
function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw badRequest(`${field} must be a non-empty trimmed string`);
  }
  return value;
}
function requiredInteger(value, field, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) {
    throw badRequest(`${field} must be an integer >= ${minimum}`);
  }
  return value;
}
function requiredRecord(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw badRequest(`${field} must be an object`);
  return value;
}
function requiredArray(value, field) {
  if (!Array.isArray(value))
    throw badRequest(`${field} must be an array`);
  return value;
}
function optionalStringArray(value, field) {
  if (value === void 0)
    return [];
  if (!Array.isArray(value))
    throw badRequest(`${field} must be an array`);
  const items = value.map((item, index) => requiredString(item, `${field}[${index}]`));
  if (new Set(items).size !== items.length)
    throw badRequest(`${field} must not contain duplicates`);
  return items;
}
function closedParams(params, allowed) {
  const names = new Set(allowed);
  for (const key of Object.keys(params)) {
    if (!names.has(key))
      throw badRequest(`Unsupported Agent Domain parameter: ${key}`);
  }
}
function operationFailure(error) {
  if (isOperationError(error))
    throw error;
  if (error instanceof DomainValidationError || error instanceof TypeError)
    throw badRequest(error.message);
  if (error instanceof DomainNotFoundError)
    throw notFound(error.message);
  if (error instanceof DomainConflictError || error instanceof DomainLockTimeoutError) {
    throw conflict(error.message, error instanceof DomainConflictError ? error.details : void 0);
  }
  if (error instanceof SimulatedInterruptionError)
    throw conflict("Agent Domain commit was interrupted and must be replayed");
  throw internal("Agent Domain operation failed closed");
}
async function boundary(action) {
  try {
    return await action();
  } catch (error) {
    operationFailure(error);
  }
}
function exactProject(vaultPath, value, operation) {
  const projectRef = requiredString(value, "project");
  const context = resolveProjectContext(vaultPath, projectRef, operation);
  if (projectRef !== context.projectId) {
    throw conflict("Agent Domain operations require the canonical Project ID", { projectId: context.projectId });
  }
  return context;
}
function projectFingerprint(context) {
  return canonicalDigest(normalizedProjectContext(context));
}
function actor(ctx, requested, requireApprover = false) {
  const authenticated = ctx.config.collaboration?.actor;
  const candidate = requested === void 0 ? authenticated ?? process.env.VAULT_MIND_ACTOR ?? "agent" : requiredString(requested, "actor");
  if (authenticated && candidate !== authenticated) {
    throw conflict("Actor must match the authenticated collaboration actor");
  }
  if (requireApprover && (!authenticated || !APPROVER_ROLES.has(ctx.config.collaboration?.role ?? ""))) {
    throw conflict("This transition requires an authenticated human, approver, or admin actor");
  }
  return candidate;
}
function appendGovernedUsage(vaultPath, input) {
  const absent = unknown("unattributed");
  const notReported = unknown("not-reported");
  return new UsageLedger(join11(vaultPath, ...USAGE_RELATIVE_ROOT.split("/"))).append(createUsageEvent({
    idempotencyKey: input.idempotencyKey,
    kind: input.kind,
    occurredAt: input.occurredAt,
    dimensions: {
      project: known(input.projectId),
      agent: input.profileId ? known(input.profileId) : absent,
      thread: input.threadId ? known(input.threadId) : absent,
      workRun: input.workRunId ? known(input.workRunId) : absent,
      provider: input.provider ? known(input.provider) : notReported,
      model: input.model ? known(input.model) : notReported,
      device: input.device ? known(input.device) : absent,
      operation: known(input.operation)
    },
    providerFacts: {
      inputTokens: notReported,
      outputTokens: notReported,
      providerReportedCost: notReported,
      currency: notReported
    },
    provenance: input.provenance
  }));
}
function workRunPath(vaultPath, project, workRunId) {
  return join11(vaultPath, "01-Projects", project.slug, "runs", `${workRunId.slice("work-run/".length)}.json`);
}
function readCanonicalWorkRun(vaultPath, project, workRunId) {
  const path = workRunPath(vaultPath, project, workRunId);
  if (!existsSync8(path))
    throw notFound(`Canonical Work Run ${workRunId} does not exist`);
  let value;
  try {
    value = JSON.parse(readFileSync8(path, "utf8"));
  } catch {
    throw conflict(`Canonical Work Run ${workRunId} is malformed`);
  }
  const record3 = requiredRecord(value, "workRun");
  if (record3.work_run_id !== workRunId || record3.project_id !== project.projectId) {
    throw conflict("Canonical Work Run identity differs from the requested Project/Run");
  }
  return record3;
}
function cadenceSettingKey(cadence) {
  return `agents.dream_time.cadence.${cadence}.enabled`;
}
function cadenceWorkRun(vaultPath, project, invocationId) {
  const directory = join11(vaultPath, "01-Projects", project.slug, "runs");
  if (!existsSync8(directory))
    return null;
  const marker = `dreamtime-cadence:${invocationId}`;
  const matches = [];
  for (const file of readdirSync5(directory).filter((candidate) => candidate.endsWith(".json")).sort()) {
    let record3;
    try {
      record3 = requiredRecord(JSON.parse(readFileSync8(join11(directory, file), "utf8")), "workRun");
    } catch {
      continue;
    }
    if (record3.project_id === project.projectId && Array.isArray(record3.provenance) && record3.provenance.includes(marker)) {
      matches.push(record3);
    }
  }
  if (matches.length > 1)
    throw conflict("Dream Time cadence invocation is bound to multiple canonical Work Runs", { invocationId });
  return matches[0] ?? null;
}
function workflowOperation(vaultPath, name) {
  const operation = makeWorkflowOps(vaultPath).find((candidate) => candidate.name === name);
  if (!operation)
    throw internal(`Required workflow operation ${name} is unavailable`);
  return operation;
}
function normalizeProvenance(value, field = "provenance") {
  const items = requiredArray(value, field).map((item, index) => requiredRecord(item, `${field}[${index}]`));
  const unique = new Map(items.map((item) => [canonicalJson(item), item]));
  return [...unique.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, item]) => item);
}
function cadenceClientProvenance(proposal, workRunId) {
  return proposal.provenance.filter((reference) => !(reference.kind === "workRun" && reference.id === workRunId || reference.kind === "settings" || reference.kind === "governance" && reference.id === CADENCE_GOVERNANCE_ID));
}
function assertCadenceReplayBytes(proposal, workRunId, sourceIdentities, candidateDiff, provenance, warnings, expiresAt, requestedActor, cadenceRequestFingerprint) {
  const workRunReference = proposal.provenance.find((reference) => reference.kind === "workRun" && reference.id === workRunId);
  const cadenceReference = proposal.provenance.find((reference) => reference.kind === "governance" && reference.id === CADENCE_GOVERNANCE_ID);
  if (!workRunReference?.fingerprint)
    throw conflict("Dream Time cadence proposal is missing its Context Envelope Work Run lock");
  if (cadenceReference?.fingerprint !== cadenceRequestFingerprint || proposal.createdBy !== requestedActor || proposal.expiresAt !== expiresAt || canonicalJson(proposal.sourceIdentities) !== canonicalJson(sourceIdentities) || canonicalJson(proposal.candidateDiff) !== canonicalJson(candidateDiff) || canonicalJson(cadenceClientProvenance(proposal, workRunId)) !== canonicalJson(provenance) || canonicalJson(proposal.warnings) !== canonicalJson(warnings)) {
    throw conflict("Dream Time cadence invocation was already used for different immutable proposal bytes");
  }
  return workRunReference.fingerprint;
}
async function moveCadenceWorkRunToReview(ctx, vaultPath, project, identity, workRunId, proposalId) {
  await workflowOperation(vaultPath, "workflow.agent.step").handler(ctx, {
    project: project.projectId,
    agent: identity.agentId,
    stage: "review",
    work_run_id: workRunId,
    work_run_state: "awaiting_review",
    transition_token: `${identity.transitionToken}-proposal`,
    output_class: "knowledge-claim",
    approval_status: "pending",
    provenance: [`dreamtime-proposal:${proposalId}`],
    evidence: [`proposal:${proposalId}`],
    summary: "Dream Time cadence produced an immutable proposal and is awaiting explicit review.",
    next: "Approve or reject the exact Memory Proposal fingerprint."
  });
}
function dreamTimeStore(stateRoot, projectId2, profileId) {
  return new DreamTimeStore({ memoryRoot: join11(stateRoot, "dreamtime"), projectId: projectId2, profileId });
}
function proposalDirectory(stateRoot, projectId2, profileId) {
  return join11(stateRoot, "dreamtime", projectId2.slice("project/".length), profileId.slice("agent/".length), "proposals");
}
function delegationStore(stateRoot, projectId2) {
  return new DelegationStore({ collaborationRoot: collaborationRoot(stateRoot), projectId: projectId2 });
}
async function activeServerGrant(stateRoot, service, project, grantId) {
  const store = delegationStore(stateRoot, project.projectId);
  const grant = await store.readGrant(grantId);
  if (!grant)
    throw notFound(`Server-issued Capability Grant ${grantId} does not exist`);
  const child = await store.readChild(grant.workRunId);
  if (!child || !ACTIVE_CHILD_WORK_RUN_STATES.has(child.lifecycle)) {
    throw conflict("Capability Grant Work Run is not an active server-issued Child Work Run");
  }
  if (grant.projectId !== project.projectId || child.projectId !== project.projectId || child.workRunId !== grant.workRunId || child.assignment.profileId !== grant.profileId || child.assignment.profileRevision !== grant.profileRevision || canonicalJson(child.grantSummary) !== canonicalJson(grant)) {
    throw conflict("Capability Grant does not match its server-issued Work Run assignment");
  }
  const exactProfile = await service.profiles.readRevision(grant.profileId, grant.profileRevision);
  const currentProfile = await service.profiles.read(grant.profileId);
  const exactBinding = await service.bindings.readRevision(child.assignment.bindingId, child.assignment.bindingRevision);
  const currentBinding = await service.bindings.read(child.assignment.bindingId);
  if (!exactProfile || !currentProfile || currentProfile.revision !== grant.profileRevision || !exactBinding || !currentBinding || currentBinding.revision !== child.assignment.bindingRevision || !exactBinding.enabled || !currentBinding.enabled || exactBinding.projectId !== project.projectId || exactBinding.profileId !== grant.profileId || exactBinding.profileRevision !== grant.profileRevision) {
    throw conflict("Capability Grant requesting assignment is not the active Binding/Profile revision");
  }
  if (Date.parse(grant.expiresAt) <= Date.now())
    throw conflict("Capability Grant expired");
  return { grant, child };
}
async function currentMemoryLock(store) {
  const revision = await store.readCurrentRevision();
  return {
    revisionId: revision?.revisionId ?? null,
    revision: revision?.revision ?? 0,
    fingerprint: revision?.fingerprint ?? null,
    revisionRecord: revision
  };
}
function initialMemorySections() {
  return {
    recentContext: makeMemorySection(),
    openItems: makeMemorySection(),
    stableMemory: makeMemorySection()
  };
}
function readProfileOperation(service) {
  return {
    name: "agent.profile.read",
    namespace: "agent",
    description: "Read the current immutable revision of one Agent Profile.",
    mutating: false,
    params: { profileId: { type: "string", required: true } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ["profileId"]);
      const profile = await service.profiles.read(requiredString(params.profileId, "profileId"));
      if (!profile)
        throw notFound(`Agent Profile ${String(params.profileId)} does not exist`);
      return profile;
    })
  };
}
function profileOperations(service) {
  return [{
    name: "agent.profile.create",
    namespace: "agent",
    description: "Create revision 1 of a vault-scoped Agent Profile.",
    mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: { input: { type: "object", required: true } },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ["input"]);
      const input = requiredRecord(params.input, "input");
      const authenticatedActor = actor(ctx, input.actor);
      return service.createProfile({ ...input, actor: authenticatedActor });
    })
  }, readProfileOperation(service), {
    name: "agent.profile.list",
    namespace: "agent",
    description: "List current Agent Profile revisions deterministically.",
    mutating: false,
    params: { profileIds: { type: "array", required: false } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ["profileIds"]);
      return { profiles: await service.profiles.list(params.profileIds === void 0 ? {} : { profileIds: params.profileIds }) };
    })
  }, {
    name: "agent.profile.update",
    namespace: "agent",
    description: "Create the next Agent Profile revision under an optimistic lock.",
    mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: {
      profileId: { type: "string", required: true },
      expectedRevision: { type: "number", required: true },
      patch: { type: "object", required: true },
      actor: { type: "string", required: true }
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ["profileId", "expectedRevision", "patch", "actor"]);
      return service.updateProfile(requiredString(params.profileId, "profileId"), requiredInteger(params.expectedRevision, "expectedRevision", 1), requiredRecord(params.patch, "patch"), actor(ctx, params.actor));
    })
  }];
}
function bindingOperations(vaultPath, service) {
  return [{
    name: "agent.binding.create",
    namespace: "agent",
    description: "Bind an exact Agent Profile revision to one canonical Project Context.",
    mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: { input: { type: "object", required: true } },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ["input"]);
      const input = requiredRecord(params.input, "input");
      const project = exactProject(vaultPath, input.projectId, "agent.binding.create");
      if (input.projectContextFingerprint !== projectFingerprint(project))
        throw conflict("Project Agent Binding context fingerprint is stale");
      return service.createBinding({ ...input, projectId: project.projectId, actor: actor(ctx, input.actor) });
    })
  }, {
    name: "agent.binding.read",
    namespace: "agent",
    description: "Read the current immutable Project Agent Binding revision.",
    mutating: false,
    params: { bindingId: { type: "string", required: true } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ["bindingId"]);
      const binding = await service.bindings.read(requiredString(params.bindingId, "bindingId"));
      if (!binding)
        throw notFound(`Project Agent Binding ${String(params.bindingId)} does not exist`);
      return binding;
    })
  }, {
    name: "agent.binding.list",
    namespace: "agent",
    description: "List current Project Agent Bindings for a canonical Project.",
    mutating: false,
    params: { project: { type: "string", required: false }, profileId: { type: "string", required: false }, enabled: { type: "boolean", required: false } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ["project", "profileId", "enabled"]);
      const projectId2 = params.project === void 0 ? void 0 : exactProject(vaultPath, params.project, "agent.binding.list").projectId;
      return { bindings: await service.bindings.list({ projectId: projectId2, profileId: params.profileId, enabled: params.enabled }) };
    })
  }, {
    name: "agent.binding.update",
    namespace: "agent",
    description: "Create the next Project Agent Binding revision under exact Project and optimistic locks.",
    mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: { bindingId: { type: "string", required: true }, expectedRevision: { type: "number", required: true }, patch: { type: "object", required: true }, actor: { type: "string", required: true } },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ["bindingId", "expectedRevision", "patch", "actor"]);
      const bindingId = requiredString(params.bindingId, "bindingId");
      const current = await service.bindings.read(bindingId);
      if (!current)
        throw notFound(`Project Agent Binding ${bindingId} does not exist`);
      const project = exactProject(vaultPath, current.projectId, "agent.binding.update");
      const patch = requiredRecord(params.patch, "patch");
      if (patch.projectContextFingerprint !== void 0 && patch.projectContextFingerprint !== projectFingerprint(project)) {
        throw conflict("Updated Project Agent Binding context fingerprint is stale");
      }
      return service.updateBinding(bindingId, requiredInteger(params.expectedRevision, "expectedRevision", 1), patch, actor(ctx, params.actor));
    })
  }];
}
function threadOperations(vaultPath, service) {
  return [{
    name: "agent.thread.create",
    namespace: "agent",
    description: "Open a durable Thread locked to exact Binding and Profile revisions.",
    mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: { input: { type: "object", required: true } },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ["input"]);
      const input = requiredRecord(params.input, "input");
      const project = exactProject(vaultPath, input.projectId, "agent.thread.create");
      return service.createThread({ ...input, projectId: project.projectId, actor: actor(ctx, input.actor) });
    })
  }, {
    name: "agent.thread.read",
    namespace: "agent",
    description: "Read the current immutable Thread revision.",
    mutating: false,
    params: { threadId: { type: "string", required: true } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ["threadId"]);
      const thread = await service.threads.read(requiredString(params.threadId, "threadId"));
      if (!thread)
        throw notFound(`Thread ${String(params.threadId)} does not exist`);
      return thread;
    })
  }, {
    name: "agent.thread.list",
    namespace: "agent",
    description: "List current durable Threads by canonical identity.",
    mutating: false,
    params: { project: { type: "string", required: false }, profileId: { type: "string", required: false }, bindingId: { type: "string", required: false }, lifecycle: { type: "string", required: false, enum: ["open", "closed", "archived"] } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ["project", "profileId", "bindingId", "lifecycle"]);
      const projectId2 = params.project === void 0 ? void 0 : exactProject(vaultPath, params.project, "agent.thread.list").projectId;
      return { threads: await service.threads.list({ projectId: projectId2, profileId: params.profileId, bindingId: params.bindingId, lifecycle: params.lifecycle }) };
    })
  }, {
    name: "agent.thread.append",
    namespace: "agent",
    description: "Append one ordered message, artifact, or Work Run reference without promoting it to memory.",
    mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: { threadId: { type: "string", required: true }, expectedRevision: { type: "number", required: true }, reference: { type: "object", required: true }, actor: { type: "string", required: true } },
    handler: async (ctx, params) => boundary(() => {
      closedParams(params, ["threadId", "expectedRevision", "reference", "actor"]);
      return service.appendThreadReference(requiredString(params.threadId, "threadId"), requiredInteger(params.expectedRevision, "expectedRevision", 1), requiredRecord(params.reference, "reference"), actor(ctx, params.actor));
    })
  }, {
    name: "agent.thread.transition",
    namespace: "agent",
    description: "Transition one Thread through its explicit lifecycle under an optimistic lock.",
    mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: { threadId: { type: "string", required: true }, expectedRevision: { type: "number", required: true }, lifecycle: { type: "string", required: true, enum: ["open", "closed", "archived"] }, actor: { type: "string", required: true } },
    handler: async (ctx, params) => boundary(() => {
      closedParams(params, ["threadId", "expectedRevision", "lifecycle", "actor"]);
      return service.transitionThread(requiredString(params.threadId, "threadId"), requiredInteger(params.expectedRevision, "expectedRevision", 1), requiredString(params.lifecycle, "lifecycle"), actor(ctx, params.actor));
    })
  }];
}
async function roomProjection(vaultPath, stateRoot, service, params) {
  const project = exactProject(vaultPath, params.project, "agent.room.get");
  const profileId = requiredString(params.profileId, "profileId");
  const bindingId = `binding/${project.slug}/${profileId.slice("agent/".length)}`;
  const currentBinding = await service.bindings.read(bindingId);
  const openThreads = await service.threads.list({ projectId: project.projectId, profileId, bindingId, lifecycle: "open" });
  const requestedThreadId = params.threadId === void 0 ? void 0 : requiredString(params.threadId, "threadId");
  const thread = requestedThreadId ? await service.threads.read(requestedThreadId) : [...openThreads].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.threadId.localeCompare(right.threadId))[0];
  if (!thread)
    throw notFound("No active Thread exists for this Project Agent Binding");
  if (thread.projectId !== project.projectId || thread.profileId !== profileId || thread.bindingId !== bindingId || thread.lifecycle !== "open") {
    throw conflict("Thread is not the active Thread for the requested Project Agent Binding");
  }
  const binding = await service.bindings.readRevision(bindingId, thread.bindingRevision);
  const profile = await service.profiles.readRevision(profileId, thread.profileRevision);
  if (binding && (binding.projectId !== project.projectId || binding.profileId !== profileId || binding.profileRevision !== thread.profileRevision)) {
    throw conflict("Thread Binding revision lock does not match its Project/Profile assignment");
  }
  const diagnostics = [];
  const expectedContextFingerprint = projectFingerprint(project);
  if (!profile)
    diagnostics.push({ code: "profile-revision-missing", severity: "error", remediationKey: "restore-or-rebind-agent-profile" });
  if (!binding)
    diagnostics.push({ code: "binding-revision-missing", severity: "error", remediationKey: "restore-or-recreate-thread-binding" });
  if (binding && !binding.enabled)
    diagnostics.push({ code: "binding-disabled", severity: "error", remediationKey: "enable-project-agent-binding" });
  if (binding && binding.projectContextFingerprint !== expectedContextFingerprint) {
    diagnostics.push({ code: "project-context-fingerprint-stale", severity: "error", remediationKey: "refresh-project-agent-binding" });
  }
  if (currentBinding && currentBinding.revision !== thread.bindingRevision) {
    diagnostics.push({ code: "binding-revision-superseded", severity: "warning", remediationKey: "resume-or-rebind-thread-to-current-binding" });
  }
  if (openThreads.length > 1 && !requestedThreadId) {
    diagnostics.push({ code: "multiple-active-threads", severity: "warning", remediationKey: "select-thread-id" });
  }
  const relatedWorkRunIds = [...new Set(thread.references.filter((reference) => reference.kind === "workRun").map((reference) => reference.referenceId))];
  for (const workRunId of relatedWorkRunIds) {
    try {
      const run = readCanonicalWorkRun(vaultPath, project, workRunId);
      if (!TERMINAL_WORK_RUN_STATES.has(String(run.state ?? run.work_run_state))) {
        diagnostics.push({ code: "work-run-unresolved", severity: "warning", remediationKey: `inspect-work-run:${workRunId}` });
      }
    } catch (error) {
      if (isOperationError(error) && error.code === -32004) {
        diagnostics.push({ code: "work-run-missing", severity: "error", remediationKey: `inspect-work-run:${workRunId}` });
      } else
        throw error;
    }
  }
  const memory = await dreamTimeStore(stateRoot, project.projectId, profileId).readCurrentRevision();
  const connectorGrantRefs = binding?.connectorGrantRefs ?? [];
  const connectorSummaries = new HostCapabilityStore(vaultPath).listConnectors().filter((registration) => connectorGrantRefs.some((grantRef) => grantRef.slice("grant/".length) === registration.connector.connectorId.slice("connector/".length))).map((registration) => ({
    connectorId: registration.connector.connectorId,
    status: registration.health.state,
    grantRef: connectorGrantRefs.find((grantRef) => grantRef.slice("grant/".length) === registration.connector.connectorId.slice("connector/".length)),
    remediationKey: registration.health.remediationKeys[0]
  }));
  if (connectorGrantRefs.length > 0 && connectorSummaries.length === 0) {
    diagnostics.push({ code: "permitted-connectors-unavailable", severity: "warning", remediationKey: "inspect-host-capability-grants" });
  }
  return {
    schemaVersion: 1,
    identity: {
      schemaVersion: 1,
      projectId: project.projectId,
      profileId,
      profileRevision: thread.profileRevision,
      bindingId,
      bindingRevision: thread.bindingRevision,
      threadId: thread.threadId,
      threadRevision: thread.revision
    },
    readOnly: true,
    state: diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "degraded" : "healthy",
    lifecycle: thread.lifecycle,
    relatedWorkRunIds,
    approvedMemory: memory ? { revisionId: memory.revisionId, revision: memory.revision, fingerprint: memory.fingerprint } : null,
    connectorSummaries,
    diagnostics
  };
}
function roomAndContextOperations(vaultPath, stateRoot, service) {
  return [{
    name: "agent.room.get",
    namespace: "agent",
    description: "Derive one read-only Room from Project Context, Agent Profile/Binding, and an active Thread.",
    mutating: false,
    params: { project: { type: "string", required: true }, profileId: { type: "string", required: true }, threadId: { type: "string", required: false } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ["project", "profileId", "threadId"]);
      return roomProjection(vaultPath, stateRoot, service, params);
    })
  }, {
    name: "agent.context.compile",
    namespace: "agent",
    description: "Compile a four-layer Context Envelope locked to current canonical Project, Profile, Binding, and approved Memory bytes.",
    mutating: false,
    params: {
      project: { type: "string", required: true },
      envelopeId: { type: "string", required: true },
      compiledAt: { type: "string", required: true },
      tokenBudget: { type: "number", required: true },
      profileId: { type: "string", required: true },
      expectedProfileRevision: { type: "number", required: true },
      bindingId: { type: "string", required: true },
      expectedBindingRevision: { type: "number", required: true },
      memoryRevisionId: { type: "string", required: true },
      expectedMemoryRevision: { type: "number", required: true },
      expectedMemoryFingerprint: { type: "string", required: true },
      threadId: { type: "string", required: false },
      expectedThreadRevision: { type: "number", required: false },
      deviceId: { type: "string", required: false },
      expectedDeviceRevision: { type: "number", required: false },
      expectedDeviceFingerprint: { type: "string", required: false },
      capabilityGrantIds: { type: "array", required: false },
      expectedFingerprint: { type: "string", required: false },
      explicitNewAttempt: { type: "boolean", required: false, default: false },
      input: { type: "unknown", required: false },
      platformKernel: { type: "unknown", required: false },
      runtime: { type: "unknown", required: false },
      deviceCapabilities: { type: "unknown", required: false },
      capabilityGrants: { type: "unknown", required: false },
      modelLock: { type: "unknown", required: false },
      profile: { type: "unknown", required: false },
      binding: { type: "unknown", required: false },
      memoryRevision: { type: "unknown", required: false }
    },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, [
        "project",
        "envelopeId",
        "compiledAt",
        "tokenBudget",
        "profileId",
        "expectedProfileRevision",
        "bindingId",
        "expectedBindingRevision",
        "memoryRevisionId",
        "expectedMemoryRevision",
        "expectedMemoryFingerprint",
        "threadId",
        "expectedThreadRevision",
        "deviceId",
        "expectedDeviceRevision",
        "expectedDeviceFingerprint",
        "capabilityGrantIds",
        "expectedFingerprint",
        "explicitNewAttempt"
      ]);
      const project = exactProject(vaultPath, params.project, "agent.context.compile");
      const profileId = requiredString(params.profileId, "profileId");
      const profileRevision = requiredInteger(params.expectedProfileRevision, "expectedProfileRevision", 1);
      const bindingId = requiredString(params.bindingId, "bindingId");
      const bindingRevision = requiredInteger(params.expectedBindingRevision, "expectedBindingRevision", 1);
      const storedProfile = await service.profiles.readRevision(profileId, profileRevision);
      const storedBinding = await service.bindings.readRevision(bindingId, bindingRevision);
      const currentProfile = await service.profiles.read(profileId);
      const currentBinding = await service.bindings.read(bindingId);
      if (!storedProfile || !currentProfile || currentProfile.revision !== profileRevision)
        throw conflict("Context Envelope Profile reference is not the active stored revision");
      if (!storedBinding || !currentBinding || currentBinding.revision !== bindingRevision)
        throw conflict("Context Envelope Binding reference is not the active stored revision");
      if (!storedBinding.enabled || storedBinding.projectId !== project.projectId || storedBinding.profileId !== profileId || storedBinding.profileRevision !== profileRevision) {
        throw conflict("Context Envelope Binding does not lock the active Project/Profile revision");
      }
      const canonicalProjectContext = normalizedProjectContext(project);
      const canonicalProjectFingerprint = canonicalDigest(canonicalProjectContext);
      if (storedBinding.projectContextFingerprint !== canonicalProjectFingerprint)
        throw conflict("Context Envelope Binding uses a stale Project Context fingerprint");
      const memoryRevisionId = requiredString(params.memoryRevisionId, "memoryRevisionId");
      const memoryRevision = requiredInteger(params.expectedMemoryRevision, "expectedMemoryRevision", 1);
      const memoryFingerprint = requiredString(params.expectedMemoryFingerprint, "expectedMemoryFingerprint");
      const memoryStore = dreamTimeStore(stateRoot, project.projectId, profileId);
      const lockedMemory = await memoryStore.readRevision(memoryRevisionId);
      const current = await memoryStore.readCurrentRevision();
      if (!lockedMemory || !current || current.revisionId !== memoryRevisionId || current.revision !== memoryRevision || current.fingerprint !== memoryFingerprint || canonicalJson(current) !== canonicalJson(lockedMemory)) {
        throw conflict("Context Envelope memory reference is not the current approved revision");
      }
      const threadWindow = [];
      if (params.threadId !== void 0 || params.expectedThreadRevision !== void 0) {
        if (params.threadId === void 0 || params.expectedThreadRevision === void 0)
          throw badRequest("threadId and expectedThreadRevision must be provided together");
        const threadId = requiredString(params.threadId, "threadId");
        const expectedThreadRevision = requiredInteger(params.expectedThreadRevision, "expectedThreadRevision", 1);
        const thread = await service.threads.read(threadId);
        if (!thread || thread.revision !== expectedThreadRevision || thread.lifecycle !== "open" || thread.projectId !== project.projectId || thread.profileId !== profileId || thread.profileRevision !== profileRevision || thread.bindingId !== bindingId || thread.bindingRevision !== bindingRevision) {
          throw conflict("Context Envelope Thread reference is not the active exact Project/Profile/Binding revision");
        }
        threadWindow.push({
          chunkId: thread.threadId,
          content: {
            threadId: thread.threadId,
            lifecycle: thread.lifecycle,
            title: thread.title,
            references: thread.references
          },
          provenance: [{ kind: "thread", id: thread.threadId, revision: thread.revision }]
        });
      }
      const deviceCapabilities = [];
      if (params.deviceId !== void 0 || params.expectedDeviceRevision !== void 0 || params.expectedDeviceFingerprint !== void 0) {
        if (params.deviceId === void 0 || params.expectedDeviceRevision === void 0 || params.expectedDeviceFingerprint === void 0) {
          throw badRequest("deviceId, expectedDeviceRevision, and expectedDeviceFingerprint must be provided together");
        }
        const deviceId = requiredString(params.deviceId, "deviceId");
        const expectedDeviceRevision = requiredInteger(params.expectedDeviceRevision, "expectedDeviceRevision", 1);
        const expectedDeviceFingerprint = requiredString(params.expectedDeviceFingerprint, "expectedDeviceFingerprint");
        const device = new DeviceCapabilityRegistry(vaultPath).get(deviceId);
        if (!device || device.revision !== expectedDeviceRevision || device.fingerprint !== expectedDeviceFingerprint || device.health.status === "unavailable" || Date.parse(device.expiresAt) <= Date.now()) {
          throw conflict("Context Envelope Device Capability reference is not an active stored revision");
        }
        deviceCapabilities.push({
          chunkId: device.deviceId,
          content: device,
          provenance: [{ kind: "deviceCapability", id: device.deviceId, revision: device.revision, fingerprint: device.fingerprint }]
        });
      }
      const capabilityGrants = [];
      for (const grantId of optionalStringArray(params.capabilityGrantIds, "capabilityGrantIds")) {
        const { grant } = await activeServerGrant(stateRoot, service, project, grantId);
        if (grant.profileId !== profileId || grant.profileRevision !== profileRevision) {
          throw conflict("Context Envelope Capability Grant belongs to another active Profile assignment");
        }
        capabilityGrants.push({
          chunkId: grant.grantId,
          content: grant,
          provenance: [{ kind: "grant", id: grant.grantId, fingerprint: grant.fingerprint }]
        });
      }
      const compiledAt = requiredString(params.compiledAt, "compiledAt");
      const settingsService = createSettingsService({
        vaultPath,
        workspaceProjectId: project.projectId,
        sessionId: "agent-context-compile",
        clock: () => compiledAt
      });
      const { snapshot: settingsSnapshot } = await settingsService.snapshotResolve();
      const settingsFingerprint = canonicalDigest(settingsSnapshot);
      const settingsModel = await settingsService.agentModelInvocationProfile();
      const publicSettingKeys = new Set(settingsService.registry.definitions.filter((definition) => definition.sensitivity === "public").map((definition) => definition.key));
      const settingsProjection = {
        snapshotId: settingsSnapshot.snapshotId,
        registryVersion: settingsSnapshot.registryVersion,
        sourceRevisions: settingsSnapshot.sourceRevisions,
        effective: settingsSnapshot.effective.filter((item) => publicSettingKeys.has(item.key)).map((item) => ({ key: item.key, value: item.value, winningScope: item.winningScope, applyMode: item.applyMode }))
      };
      const profileModel = storedProfile.defaultModelPolicy;
      const modelLock = {
        provider: profileModel.mode === "inherit" ? settingsModel.provider || "inherit" : profileModel.provider,
        model: profileModel.mode === "inherit" ? settingsModel.model || "inherit" : profileModel.model,
        contextWindow: 32768,
        tokenizer: "utf8-bytes-div4/v1",
        policyFingerprint: canonicalDigest({ profileModel, settingsFingerprint })
      };
      const envelope = compileContextEnvelope({
        envelopeId: requiredString(params.envelopeId, "envelopeId"),
        compiledAt,
        modelLock,
        tokenBudget: requiredInteger(params.tokenBudget, "tokenBudget", 1),
        platformKernel: PLATFORM_KERNEL,
        profile: storedProfile,
        binding: storedBinding,
        memoryRevision: lockedMemory,
        memoryRevisionLock: { revisionId: memoryRevisionId, revision: memoryRevision, fingerprint: memoryFingerprint },
        runtime: {
          projectContext: {
            chunkId: `project-context/${project.slug}`,
            content: canonicalProjectContext,
            provenance: [{ kind: "project", id: project.projectId, fingerprint: canonicalProjectFingerprint }],
            mandatory: true
          },
          threadWindow,
          settingsSnapshot: {
            chunkId: settingsSnapshot.snapshotId,
            content: settingsProjection,
            provenance: [{ kind: "settings", id: settingsSnapshot.snapshotId, fingerprint: settingsFingerprint }],
            mandatory: true
          },
          deviceCapabilities,
          capabilityGrants
        }
      });
      if (params.expectedFingerprint !== void 0 && params.expectedFingerprint !== envelope.fingerprint && params.explicitNewAttempt !== true) {
        throw conflict("Context Envelope fingerprint drift requires an explicit new execution attempt", { expectedFingerprint: params.expectedFingerprint, actualFingerprint: envelope.fingerprint });
      }
      return envelope;
    })
  }];
}
function validateProposalSource(vaultPath, project, service, store, operation, input, candidate) {
  return boundary(async () => {
    if (input.operation !== operation || candidate.operation !== operation)
      throw conflict("Dream Time operation changed across the proposal boundary");
    if (input.projectId !== project.projectId || candidate.projectId !== project.projectId || input.profileId !== candidate.profileId) {
      throw conflict("Dream Time proposal is outside the exact Project/Profile scope");
    }
    const cutoff = Date.parse(input.sourceIdentities.cutoffAt);
    if (!Number.isFinite(cutoff) || new Date(cutoff).toISOString() !== input.sourceIdentities.cutoffAt) {
      throw badRequest("sourceIdentities.cutoffAt must be a canonical UTC RFC3339 timestamp");
    }
    const sourceRevisions = [];
    for (const revisionId of input.sourceIdentities.revisionIds) {
      const revision = await store.readRevision(revisionId);
      if (!revision || revision.lifecycle !== "approved" || revision.projectId !== project.projectId || revision.profileId !== input.profileId) {
        throw conflict(`Source revision ${revisionId} is not an approved revision for the exact Project/Profile`);
      }
      sourceRevisions.push(revision);
    }
    if (operation === "checkpoint") {
      const hasThread = input.sourceIdentities.threadId !== void 0;
      const hasRun = input.sourceIdentities.workRunId !== void 0;
      if (hasThread === hasRun)
        throw badRequest("Checkpoint requires exactly one canonical Thread or Work Run source");
      if (hasThread) {
        const thread = await service.threads.read(input.sourceIdentities.threadId);
        if (!thread || thread.projectId !== project.projectId || thread.profileId !== input.profileId)
          throw conflict("Checkpoint Thread is not the exact Project/Profile source");
        const eligibleArtifactIds = new Set(thread.references.filter((reference) => reference.kind === "artifact" && Date.parse(reference.recordedAt) <= cutoff).map((reference) => reference.referenceId));
        for (const artifactId of input.sourceIdentities.artifactIds) {
          if (!eligibleArtifactIds.has(artifactId)) {
            throw conflict(`Checkpoint artifact ${artifactId} is not a canonical Thread reference at or before the source cutoff`);
          }
        }
      } else {
        const run = readCanonicalWorkRun(vaultPath, project, input.sourceIdentities.workRunId);
        const eligibleArtifactIds = new Set((Array.isArray(run.artifact_projections) ? run.artifact_projections : []).flatMap((item) => item && typeof item === "object" && !Array.isArray(item) ? [String(item.artifact_id ?? "")] : []).filter(Boolean));
        for (const artifactId of input.sourceIdentities.artifactIds) {
          if (!eligibleArtifactIds.has(artifactId)) {
            throw conflict(`Checkpoint artifact ${artifactId} is not a canonical Artifact Projection on the source Work Run`);
          }
        }
      }
    } else {
      if (input.sourceIdentities.revisionIds.length === 0) {
        throw badRequest(`${operation} requires one or more approved source revision identities`);
      }
      if (operation === "learn" && !sourceRevisions.some((revision) => revision.sections.recentContext.content.length > 0 && revision.sections.recentContext.citations.length > 0)) {
        throw badRequest("learn requires at least one non-empty approved Recent Context revision with citations");
      }
    }
    const citedSources = /* @__PURE__ */ new Set([
      ...input.sourceIdentities.artifactIds,
      ...input.sourceIdentities.revisionIds
    ]);
    const allowed = operation === "checkpoint" ? /* @__PURE__ */ new Set(["recentContext", "openItems"]) : /* @__PURE__ */ new Set(["stableMemory"]);
    for (const diff of candidate.candidateDiff) {
      if (!allowed.has(diff.section))
        throw badRequest(`${operation} cannot mutate ${diff.section}`);
      if (diff.operation === "replace" && diff.after?.content && diff.after.citations.length === 0) {
        throw badRequest(`${operation} replacement content requires artifact or revision citations`);
      }
      for (const citation of diff.after?.citations ?? []) {
        if (!citedSources.has(citation)) {
          throw badRequest(`${operation} citation ${citation} is not locked by sourceIdentities.artifactIds/revisionIds`);
        }
      }
      if (operation === "review" && canonicalJson(diff.after?.citations ?? []) !== canonicalJson(input.currentSections.stableMemory.citations)) {
        throw badRequest("Review must preserve the exact stable-memory citation set and cannot add uncited claims");
      }
    }
  }).then(() => void 0);
}
function assertDreamTimeProposalReplay(existing, candidate, proposalActor) {
  const { schemaVersion: _schemaVersion, lifecycle: _lifecycle, approvalPolicy: _approvalPolicy, createdAt: _createdAt, createdBy, fingerprint: _fingerprint, ...persistedCandidate } = existing;
  if (createdBy !== proposalActor || canonicalJson(persistedCandidate) !== canonicalJson(candidate)) {
    throw conflict("Dream Time proposal identity was already used for different immutable proposal bytes");
  }
}
async function proposeDreamTimeResult(ctx, vaultPath, stateRoot, service, operation, params) {
  const project = exactProject(vaultPath, params.project, `dreamtime.${operation}.propose`);
  const profileId = requiredString(params.profileId, "profileId");
  const input = requiredRecord(params.workerInput, "workerInput");
  const candidate = requiredRecord(params.candidate, "candidate");
  if (!candidate.proposalId)
    throw badRequest("Dream Time proposal operations require a stable candidate.proposalId for replay");
  const store = dreamTimeStore(stateRoot, project.projectId, profileId);
  const current = await currentMemoryLock(store);
  if (input.profileId !== profileId || canonicalJson(input.expectedRevision) !== canonicalJson({ revisionId: current.revisionId, revision: current.revision, fingerprint: current.fingerprint })) {
    throw conflict("Dream Time proposal expected revision is stale");
  }
  const baselineSections = current.revisionRecord?.sections ?? initialMemorySections();
  const baselineDirectives = current.revisionRecord?.protectedDirectives ?? [];
  const baselineConflicts = current.revisionRecord?.unresolvedConflicts ?? [];
  if (canonicalJson(input.currentSections) !== canonicalJson(baselineSections) || canonicalJson(input.protectedDirectives) !== canonicalJson(baselineDirectives) || canonicalJson(input.unresolvedConflicts) !== canonicalJson(baselineConflicts)) {
    throw conflict("Dream Time worker input does not byte-lock the current approved Memory Revision baseline");
  }
  if (input.sourceFingerprint !== dreamTimeSourceFingerprint(input))
    throw conflict("Dream Time source fingerprint does not lock exact input bytes");
  await validateProposalSource(vaultPath, project, service, store, operation, input, candidate);
  const proposalActor = actor(ctx, params.actor);
  const existing = await store.readProposal(candidate.proposalId);
  let proposal;
  let idempotent;
  if (existing) {
    assertDreamTimeProposalReplay(existing, candidate, proposalActor);
    proposal = existing;
    idempotent = true;
  } else {
    try {
      proposal = await runDreamTimeProposalWorker(store, { generate: async () => candidate }, input, proposalActor);
      idempotent = false;
    } catch (error) {
      if (!(error instanceof DomainConflictError))
        throw error;
      const collided = await store.readProposal(candidate.proposalId);
      if (!collided)
        throw error;
      assertDreamTimeProposalReplay(collided, candidate, proposalActor);
      proposal = collided;
      idempotent = true;
    }
  }
  appendGovernedUsage(vaultPath, {
    kind: "dreamtime",
    idempotencyKey: `dreamtime-proposal:${proposal.proposalId}`,
    occurredAt: proposal.createdAt,
    projectId: proposal.projectId,
    profileId: proposal.profileId,
    threadId: proposal.sourceIdentities.threadId,
    workRunId: proposal.sourceIdentities.workRunId,
    provider: proposal.modelLock.provider,
    model: proposal.modelLock.model,
    operation: `dreamtime.${operation}.propose`,
    provenance: [`dreamtime-run:${proposal.proposalId}`]
  });
  return { proposal, idempotent };
}
async function proposeDreamTime(ctx, vaultPath, stateRoot, service, operation, params) {
  return (await proposeDreamTimeResult(ctx, vaultPath, stateRoot, service, operation, params)).proposal;
}
function dreamTimeTransitionOperation(vaultPath, stateRoot, action) {
  return {
    name: `dreamtime.${action}`,
    namespace: "dreamtime",
    description: `${action === "approve" ? "Approve" : "Reject"} one exact immutable Memory Proposal fingerprint under a manual actor and revision lock.`,
    mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: {
      project: { type: "string", required: true },
      profileId: { type: "string", required: true },
      proposalId: { type: "string", required: true },
      presentedFingerprint: { type: "string", required: true },
      expectedRevision: { type: "number", required: true },
      transitionToken: { type: "string", required: true },
      actor: { type: "string", required: true },
      reason: { type: "string", required: false }
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ["project", "profileId", "proposalId", "presentedFingerprint", "expectedRevision", "transitionToken", "actor", "reason"]);
      const project = exactProject(vaultPath, params.project, `dreamtime.${action}`);
      const authenticatedActor = actor(ctx, params.actor, true);
      const store = dreamTimeStore(stateRoot, project.projectId, requiredString(params.profileId, "profileId"));
      return store[action](requiredString(params.proposalId, "proposalId"), {
        presentedFingerprint: requiredString(params.presentedFingerprint, "presentedFingerprint"),
        expectedRevision: requiredInteger(params.expectedRevision, "expectedRevision"),
        transitionToken: requiredString(params.transitionToken, "transitionToken"),
        actor: authenticatedActor,
        reason: params.reason === void 0 ? void 0 : requiredString(params.reason, "reason"),
        authorize: async () => ({ allowed: true, policyVersion: "dreamtime-manual-approval/v1", reason: "Authenticated manual approval" })
      });
    })
  };
}
function dreamTimeOperations(vaultPath, stateRoot, service) {
  const proposalParams = {
    project: { type: "string", required: true },
    profileId: { type: "string", required: true },
    workerInput: { type: "object", required: true },
    candidate: { type: "object", required: true },
    actor: { type: "string", required: true }
  };
  const propose = (operation) => ({
    name: `dreamtime.${operation}.propose`,
    namespace: "dreamtime",
    description: `Create an immutable proposal-only ${operation} candidate without granting a worker any write, network, or connector authority.`,
    mutating: true,
    writePolicy: AGENT_DOMAIN_USAGE_WRITE_POLICY,
    params: proposalParams,
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ["project", "profileId", "workerInput", "candidate", "actor"]);
      return proposeDreamTime(ctx, vaultPath, stateRoot, service, operation, params);
    })
  });
  const scopedParams = {
    project: { type: "string", required: true },
    profileId: { type: "string", required: true }
  };
  return [propose("checkpoint"), propose("learn"), propose("review"), {
    name: "dreamtime.proposal.read",
    namespace: "dreamtime",
    description: "Read one immutable proposal with its terminal decision lifecycle projected separately.",
    mutating: false,
    params: { ...scopedParams, proposalId: { type: "string", required: true } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ["project", "profileId", "proposalId"]);
      const project = exactProject(vaultPath, params.project, "dreamtime.proposal.read");
      const store = dreamTimeStore(stateRoot, project.projectId, requiredString(params.profileId, "profileId"));
      const proposalId = requiredString(params.proposalId, "proposalId");
      const proposal = await store.readProposal(proposalId);
      if (!proposal)
        throw notFound(`Memory Proposal ${proposalId} does not exist`);
      const decision = await store.readDecision(proposalId);
      return { proposal: { ...proposal, lifecycle: decision?.state ?? proposal.lifecycle } };
    })
  }, dreamTimeTransitionOperation(vaultPath, stateRoot, "approve"), dreamTimeTransitionOperation(vaultPath, stateRoot, "reject"), {
    name: "dreamtime.revision.current",
    namespace: "dreamtime",
    description: "Read the current approved Memory Revision for one Project Agent.",
    mutating: false,
    params: scopedParams,
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ["project", "profileId"]);
      const project = exactProject(vaultPath, params.project, "dreamtime.revision.current");
      return dreamTimeStore(stateRoot, project.projectId, requiredString(params.profileId, "profileId")).readCurrentRevision();
    })
  }, {
    name: "dreamtime.revision.read",
    namespace: "dreamtime",
    description: "Read one exact approved Memory Revision identity.",
    mutating: false,
    params: { ...scopedParams, revisionId: { type: "string", required: true } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ["project", "profileId", "revisionId"]);
      const project = exactProject(vaultPath, params.project, "dreamtime.revision.read");
      const revision = await dreamTimeStore(stateRoot, project.projectId, requiredString(params.profileId, "profileId")).readRevision(requiredString(params.revisionId, "revisionId"));
      if (!revision)
        throw notFound(`Memory Revision ${String(params.revisionId)} does not exist`);
      return revision;
    })
  }, {
    name: "dreamtime.revision.history",
    namespace: "dreamtime",
    description: "Project immutable Memory Revisions and append-only decision events.",
    mutating: false,
    params: scopedParams,
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ["project", "profileId"]);
      const project = exactProject(vaultPath, params.project, "dreamtime.revision.history");
      const store = dreamTimeStore(stateRoot, project.projectId, requiredString(params.profileId, "profileId"));
      return { revisions: await store.listRevisions(), events: await store.listEvents() };
    })
  }, {
    name: "dreamtime.doctor",
    namespace: "dreamtime",
    description: "Read proposal, decision, warning, conflict, model-lock, provenance, and revision health without mutating memory.",
    mutating: false,
    params: { project: { type: "string", required: true }, profileId: { type: "string", required: false } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ["project", "profileId"]);
      const project = exactProject(vaultPath, params.project, "dreamtime.doctor");
      const profileIds = params.profileId === void 0 ? (await service.bindings.list({ projectId: project.projectId })).map((binding) => binding.profileId) : [requiredString(params.profileId, "profileId")];
      const proposalSummaries = [];
      const diagnostics = [];
      let revisionCount = 0;
      for (const profileId of [...new Set(profileIds)].sort()) {
        const store = dreamTimeStore(stateRoot, project.projectId, profileId);
        revisionCount += (await store.listRevisions()).length;
        const directory = proposalDirectory(stateRoot, project.projectId, profileId);
        const files = existsSync8(directory) ? readdirSync5(directory).filter((file) => file.endsWith(".json")).sort() : [];
        for (const file of files) {
          const proposalId = `memory-proposal/${basename5(file, ".json")}`;
          const proposal = await store.readProposal(proposalId);
          if (!proposal)
            continue;
          const decision = await store.readDecision(proposalId);
          proposalSummaries.push({
            proposalId,
            profileId,
            operation: proposal.operation,
            lifecycle: decision?.state ?? proposal.lifecycle,
            fingerprint: proposal.fingerprint,
            createdAt: proposal.createdAt,
            expiresAt: proposal.expiresAt,
            warningCount: proposal.warnings.length,
            conflictCount: proposal.unresolvedConflicts.length,
            modelLock: proposal.modelLock,
            provenance: proposal.provenance
          });
          if (!decision && Date.parse(proposal.expiresAt) <= Date.now())
            diagnostics.push({ code: "proposal-expired-unfinalized", severity: "warning", remediationKey: "reject-or-refresh-proposal" });
          if (proposal.unresolvedConflicts.length)
            diagnostics.push({ code: "memory-conflicts-unresolved", severity: "error", remediationKey: "resolve-memory-conflicts" });
        }
      }
      return {
        projectId: project.projectId,
        ...params.profileId === void 0 ? {} : { profileId: params.profileId },
        state: diagnostics.some((item) => item.severity === "error") ? "degraded" : proposalSummaries.length || revisionCount ? "healthy" : "empty",
        proposalSummaries,
        revisionCount,
        diagnostics
      };
    })
  }, {
    name: "dreamtime.promotion.handoff",
    namespace: "dreamtime",
    description: "Route a reviewed Dream Time durable-knowledge candidate into the existing quarantined AI-Output Promotion path.",
    mutating: true,
    writePolicy: { realWrite: "always", targets: () => ["00-Inbox/AI-Output/vault-dreamtime/**"], audit: "required" },
    params: {
      project: { type: "string", required: true },
      profileId: { type: "string", required: true },
      proposalId: { type: "string", required: true },
      proposalFingerprint: { type: "string", required: true },
      candidateDiff: { type: "array", required: true },
      provenance: { type: "array", required: true },
      actor: { type: "string", required: true }
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ["project", "profileId", "proposalId", "proposalFingerprint", "candidateDiff", "provenance", "actor"]);
      const project = exactProject(vaultPath, params.project, "dreamtime.promotion.handoff");
      actor(ctx, params.actor, true);
      const store = dreamTimeStore(stateRoot, project.projectId, requiredString(params.profileId, "profileId"));
      const proposal = await store.readProposal(requiredString(params.proposalId, "proposalId"));
      if (!proposal)
        throw notFound(`Memory Proposal ${String(params.proposalId)} does not exist`);
      if (proposal.fingerprint !== params.proposalFingerprint || canonicalJson(proposal.candidateDiff) !== canonicalJson(params.candidateDiff) || canonicalJson(proposal.provenance) !== canonicalJson(params.provenance)) {
        throw conflict("Promotion handoff bytes differ from the immutable Memory Proposal");
      }
      const candidateId = `promotion-candidate/${proposal.fingerprint.slice("sha256:".length, "sha256:".length + 24)}`;
      const body = [
        "# Dream Time Promotion Candidate",
        "",
        `Candidate: ${candidateId}`,
        `Project: ${project.projectId}`,
        `Agent: ${proposal.profileId}`,
        `Proposal: ${proposal.proposalId}`,
        "",
        "This is an unreviewed candidate. It does not modify protected durable knowledge.",
        "",
        "## Candidate Diff",
        "```json",
        JSON.stringify(proposal.candidateDiff, null, 2),
        "```",
        "",
        "## Provenance",
        "```json",
        JSON.stringify(proposal.provenance, null, 2),
        "```",
        ""
      ].join("\n");
      const result = await ctx.vault.execute("vault.writeAIOutput", {
        persona: "vault-dreamtime",
        parentQuery: `Review ${candidateId} for ${project.projectId}`,
        sourceNodes: [],
        agent: "llmwiki-dreamtime",
        body,
        slug: candidateId.replace("/", "-"),
        scope: "project",
        quarantineState: "new",
        dryRun: false
      });
      return { candidateId, reviewPath: result.path, status: "created" };
    })
  }];
}
function dreamTimeCadenceOperations(vaultPath, stateRoot, service) {
  const cadenceParams = {
    project: { type: "string", required: true },
    profileId: { type: "string", required: true },
    cadence: { type: "string", required: true, enum: ["daily", "weekly", "monthly"] },
    asOf: { type: "string", required: true }
  };
  const resolveCadence = (params, operation) => {
    const project = exactProject(vaultPath, params.project, operation);
    const profileId = requiredString(params.profileId, "profileId");
    const cadence = requiredString(params.cadence, "cadence");
    const asOf = requiredString(params.asOf, "asOf");
    const window = resolveDreamTimeCadenceWindow(cadence, asOf);
    const identity = dreamTimeCadenceIdentity(project.projectId, profileId, window);
    return { project, profileId, cadence, asOf, window, identity };
  };
  const settingsFor = async (project, cadence, asOf) => {
    const settingsService = createSettingsService({
      vaultPath,
      workspaceProjectId: project.projectId,
      sessionId: "dreamtime-cadence",
      clock: () => asOf
    });
    const { snapshot } = await settingsService.snapshotResolve();
    const settingKey = cadenceSettingKey(cadence);
    const setting = snapshot.effective.find((item) => item.key === settingKey);
    if (!setting || typeof setting.value !== "boolean") {
      throw conflict(`Dream Time cadence setting ${settingKey} is not a resolved boolean`);
    }
    return { settingsService, settingsSnapshot: snapshot, settingKey, enabled: setting.value };
  };
  const cadenceResult = async (store, project, profileId, cadence, asOf, window, identity) => {
    const { enabled } = await settingsFor(project, cadence, asOf);
    const proposal = await store.readProposal(identity.proposalId);
    const decision = proposal ? await store.readDecision(identity.proposalId) : null;
    const workRun = cadenceWorkRun(vaultPath, project, identity.invocationId);
    const reason = proposal ? "proposal-exists" : !enabled ? "disabled" : workRun ? "resumable-work-run" : "due";
    return {
      projectId: project.projectId,
      profileId,
      ...window,
      invocationId: identity.invocationId,
      enabled,
      due: enabled && !proposal && !workRun,
      reason,
      ...workRun ? { workRunId: workRun.work_run_id } : {},
      proposal: proposal ? {
        proposalId: proposal.proposalId,
        fingerprint: proposal.fingerprint,
        lifecycle: decision?.state ?? proposal.lifecycle,
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt
      } : null
    };
  };
  return [{
    name: "dreamtime.cadence.status",
    namespace: "dreamtime",
    description: "Compute one disabled-by-default Project-scoped UTC Dream Time cadence window without running a background scheduler.",
    mutating: false,
    params: cadenceParams,
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ["project", "profileId", "cadence", "asOf"]);
      const resolved = resolveCadence(params, "dreamtime.cadence.status");
      const store = dreamTimeStore(stateRoot, resolved.project.projectId, resolved.profileId);
      return cadenceResult(store, resolved.project, resolved.profileId, resolved.cadence, resolved.asOf, resolved.window, resolved.identity);
    })
  }, {
    name: "dreamtime.cadence.run",
    namespace: "dreamtime",
    description: "Explicitly run one due Project-scoped cadence as a canonical Work Run and immutable proposal that remains pending manual approval.",
    mutating: true,
    writePolicy: {
      realWrite: "always",
      targets: (_ctx, params) => {
        const project = exactProject(vaultPath, params.project, "dreamtime.cadence.run");
        return [
          `${AGENT_DOMAIN_RELATIVE_ROOT}/**`,
          `${USAGE_RELATIVE_ROOT}/**`,
          `01-Projects/${project.slug}/runs/**`,
          `10-Projects/${project.slug}/agents/**`
        ];
      },
      audit: "required"
    },
    params: {
      ...cadenceParams,
      tokenBudget: { type: "number", required: true },
      sourceIdentities: { type: "object", required: true },
      candidateDiff: { type: "array", required: true },
      provenance: { type: "array", required: true },
      warnings: { type: "array", required: false },
      expiresAt: { type: "string", required: true },
      actor: { type: "string", required: true }
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, [
        "project",
        "profileId",
        "cadence",
        "asOf",
        "tokenBudget",
        "sourceIdentities",
        "candidateDiff",
        "provenance",
        "warnings",
        "expiresAt",
        "actor"
      ]);
      const { project, profileId, cadence, asOf, window, identity } = resolveCadence(params, "dreamtime.cadence.run");
      const store = dreamTimeStore(stateRoot, project.projectId, profileId);
      const requestedActor = actor(ctx, params.actor);
      const sourceInput = requiredRecord(params.sourceIdentities, "sourceIdentities");
      closedParams(sourceInput, ["threadId", "workRunId", "revisionIds", "artifactIds", "cutoffAt"]);
      const sourceIdentities = {
        ...sourceInput.threadId === void 0 ? {} : { threadId: requiredString(sourceInput.threadId, "sourceIdentities.threadId") },
        ...sourceInput.workRunId === void 0 ? {} : { workRunId: requiredString(sourceInput.workRunId, "sourceIdentities.workRunId") },
        revisionIds: requiredArray(sourceInput.revisionIds, "sourceIdentities.revisionIds").map((item, index) => requiredString(item, `sourceIdentities.revisionIds[${index}]`)),
        artifactIds: requiredArray(sourceInput.artifactIds, "sourceIdentities.artifactIds").map((item, index) => requiredString(item, `sourceIdentities.artifactIds[${index}]`)),
        cutoffAt: requiredString(sourceInput.cutoffAt, "sourceIdentities.cutoffAt")
      };
      const candidateDiff = requiredArray(params.candidateDiff, "candidateDiff");
      const provenance = normalizeProvenance(params.provenance);
      if (provenance.some((reference) => reference.kind === "settings" || reference.kind === "governance" && reference.id === CADENCE_GOVERNANCE_ID)) {
        throw badRequest("Dream Time cadence reserves Settings and cadence-governance provenance for server-issued locks");
      }
      const warnings = params.warnings === void 0 ? [] : requiredArray(params.warnings, "warnings");
      const expiresAt = requiredString(params.expiresAt, "expiresAt");
      const tokenBudget = requiredInteger(params.tokenBudget, "tokenBudget", 1);
      const cadenceRequestFingerprint = canonicalDigest({
        schemaVersion: 1,
        invocationId: identity.invocationId,
        asOf,
        tokenBudget
      });
      assertSafeSharedState({ sourceIdentities, candidateDiff, provenance, warnings, requestedActor }, "DreamTimeCadenceRequest");
      const existingProposal = await store.readProposal(identity.proposalId);
      if (existingProposal) {
        const existingRun = cadenceWorkRun(vaultPath, project, identity.invocationId);
        if (!existingRun)
          throw conflict("Dream Time cadence proposal is missing its canonical Work Run");
        const workRunId2 = requiredString(existingRun.work_run_id, "workRun.work_run_id");
        const contextEnvelopeFingerprint = assertCadenceReplayBytes(existingProposal, workRunId2, sourceIdentities, candidateDiff, provenance, warnings, expiresAt, requestedActor, cadenceRequestFingerprint);
        await moveCadenceWorkRunToReview(ctx, vaultPath, project, identity, workRunId2, existingProposal.proposalId);
        appendGovernedUsage(vaultPath, {
          kind: "dreamtime",
          idempotencyKey: `dreamtime-cadence:${identity.invocationId}`,
          occurredAt: asOf,
          projectId: project.projectId,
          profileId,
          workRunId: workRunId2,
          provider: existingProposal.modelLock.provider,
          model: existingProposal.modelLock.model,
          operation: "dreamtime.cadence.run",
          provenance: [`dreamtime-run:${identity.invocationId}`]
        });
        return { ...window, invocationId: identity.invocationId, workRunId: workRunId2, contextEnvelopeFingerprint, proposal: existingProposal, idempotent: true };
      }
      const { settingsService, settingsSnapshot, settingKey, enabled } = await settingsFor(project, cadence, asOf);
      if (!enabled)
        throw conflict(`Dream Time cadence ${cadence} is disabled for ${project.projectId}`);
      const bindingId = `binding/${project.slug}/${profileId.slice("agent/".length)}`;
      const profile = await service.profiles.read(profileId);
      const binding = await service.bindings.read(bindingId);
      if (!profile || !binding || !binding.enabled || binding.projectId !== project.projectId || binding.profileId !== profileId || binding.profileRevision !== profile.revision) {
        throw conflict("Dream Time cadence requires the active enabled Project Agent Binding and Profile revision");
      }
      const canonicalProjectContext = normalizedProjectContext(project);
      const canonicalProjectFingerprint = canonicalDigest(canonicalProjectContext);
      if (binding.projectContextFingerprint !== canonicalProjectFingerprint) {
        throw conflict("Dream Time cadence Project Agent Binding uses a stale Project Context fingerprint");
      }
      const current = await store.readCurrentRevision();
      if (!current)
        throw conflict("Dream Time cadence requires an approved Memory Revision bootstrap");
      const settingsFingerprint = canonicalDigest(settingsSnapshot);
      const settingsModel = await settingsService.agentModelInvocationProfile();
      const profileModel = profile.defaultModelPolicy;
      const modelLock = {
        provider: profileModel.mode === "inherit" ? settingsModel.provider || "inherit" : profileModel.provider,
        model: profileModel.mode === "inherit" ? settingsModel.model || "inherit" : profileModel.model,
        contextWindow: 32768,
        tokenizer: "utf8-bytes-div4/v1",
        policyFingerprint: canonicalDigest({ profileModel, settingsFingerprint })
      };
      const workerInput = {
        operation: window.operation,
        projectId: project.projectId,
        profileId,
        sourceIdentities,
        expectedRevision: { revisionId: current.revisionId, revision: current.revision, fingerprint: current.fingerprint },
        sourceFingerprint: "",
        currentSections: current.sections,
        protectedDirectives: current.protectedDirectives,
        unresolvedConflicts: current.unresolvedConflicts,
        modelLock,
        expiresAt
      };
      workerInput.sourceFingerprint = dreamTimeSourceFingerprint(workerInput);
      const preflightCandidate = {
        proposalId: identity.proposalId,
        operation: window.operation,
        projectId: project.projectId,
        profileId,
        sourceIdentities,
        expectedRevision: workerInput.expectedRevision,
        sourceFingerprint: workerInput.sourceFingerprint,
        candidateDiff,
        protectedDirectives: current.protectedDirectives,
        unresolvedConflicts: current.unresolvedConflicts,
        provenance,
        warnings,
        modelLock,
        expiresAt
      };
      assertSafeSharedState({ workerInput, candidate: preflightCandidate, actor: requestedActor }, "DreamTimeCadenceProposal");
      const preflightCreatedAt = (/* @__PURE__ */ new Date()).toISOString();
      const preflightMaterial = {
        ...preflightCandidate,
        schemaVersion: 1,
        proposalId: identity.proposalId,
        lifecycle: "proposed",
        approvalPolicy: {
          mode: "manual",
          autoApprovalHook: { enabled: false, warningFreeOnly: true, workingMemoryOnly: true }
        },
        createdAt: preflightCreatedAt,
        createdBy: requestedActor
      };
      validateMemoryProposal({ ...preflightMaterial, fingerprint: canonicalDigest(preflightMaterial) });
      await validateProposalSource(vaultPath, project, service, store, window.operation, workerInput, preflightCandidate);
      let workRunId;
      try {
        const started = await workflowOperation(vaultPath, "workflow.agent.start").handler(ctx, {
          project: project.projectId,
          agent: identity.agentId,
          role: "memory-maintenance",
          host: "llmwiki-dreamtime",
          objective: `Dream Time ${window.operation} proposal for ${window.periodKey}`,
          issue: `dreamtime-${cadence}`,
          transition_token: identity.transitionToken,
          output_class: "knowledge-claim",
          approval_status: "pending",
          provenance: [`dreamtime-cadence:${identity.invocationId}`],
          stage: "build",
          evidence: [`settings:${settingKey}`],
          notes: "Explicit cadence invocation; no background scheduler or automatic approval."
        });
        workRunId = requiredString(started.workRunId, "workflow.agent.start.workRunId");
      } catch (error) {
        if (!isOperationError(error) || error.code !== -32010)
          throw error;
        const racedRun = cadenceWorkRun(vaultPath, project, identity.invocationId);
        if (!racedRun)
          throw error;
        workRunId = requiredString(racedRun.work_run_id, "workRun.work_run_id");
      }
      const durableRun = readCanonicalWorkRun(vaultPath, project, workRunId);
      const threadWindow = [];
      if (sourceIdentities.threadId) {
        const thread = await service.threads.read(sourceIdentities.threadId);
        if (!thread || thread.projectId !== project.projectId || thread.profileId !== profileId || thread.profileRevision !== profile.revision || thread.bindingId !== bindingId || thread.bindingRevision !== binding.revision) {
          throw conflict("Dream Time cadence Context Envelope Thread is not the active exact Project/Profile/Binding revision");
        }
        threadWindow.push({
          chunkId: thread.threadId,
          content: {
            threadId: thread.threadId,
            lifecycle: thread.lifecycle,
            title: thread.title,
            references: thread.references
          },
          provenance: [{ kind: "thread", id: thread.threadId, revision: thread.revision }]
        });
      }
      const publicSettingKeys = new Set(settingsService.registry.definitions.filter((definition) => definition.sensitivity === "public").map((definition) => definition.key));
      const settingsProjection = {
        snapshotId: settingsSnapshot.snapshotId,
        registryVersion: settingsSnapshot.registryVersion,
        sourceRevisions: settingsSnapshot.sourceRevisions,
        effective: settingsSnapshot.effective.filter((item) => publicSettingKeys.has(item.key)).map((item) => ({ key: item.key, value: item.value, winningScope: item.winningScope, applyMode: item.applyMode }))
      };
      const envelope = compileContextEnvelope({
        envelopeId: `context-envelope/${identity.invocationId.slice("dreamtime-cadence/".length)}`,
        compiledAt: asOf,
        modelLock,
        tokenBudget,
        platformKernel: PLATFORM_KERNEL,
        profile,
        binding,
        memoryRevision: current,
        memoryRevisionLock: { revisionId: current.revisionId, revision: current.revision, fingerprint: current.fingerprint },
        runtime: {
          projectContext: {
            chunkId: `project-context/${project.slug}`,
            content: canonicalProjectContext,
            provenance: [{ kind: "project", id: project.projectId, fingerprint: canonicalProjectFingerprint }],
            mandatory: true
          },
          workRun: {
            chunkId: workRunId,
            content: {
              projectId: project.projectId,
              workRunId,
              workItemId: String(durableRun.work_item_id),
              agentId: identity.agentId,
              outputClass: "knowledge-claim",
              cadence,
              operation: window.operation,
              invocationId: identity.invocationId
            },
            provenance: [{ kind: "workRun", id: workRunId }],
            mandatory: true
          },
          threadWindow,
          settingsSnapshot: {
            chunkId: settingsSnapshot.snapshotId,
            content: settingsProjection,
            provenance: [{ kind: "settings", id: settingsSnapshot.snapshotId, fingerprint: settingsFingerprint }],
            mandatory: true
          },
          deviceCapabilities: [],
          capabilityGrants: []
        }
      });
      const proposalProvenance = normalizeProvenance([
        ...provenance,
        { kind: "governance", id: CADENCE_GOVERNANCE_ID, fingerprint: cadenceRequestFingerprint },
        { kind: "workRun", id: workRunId, fingerprint: envelope.fingerprint },
        { kind: "settings", id: settingsSnapshot.snapshotId, fingerprint: settingsFingerprint }
      ]);
      const { proposal, idempotent: proposalIdempotent } = await proposeDreamTimeResult(ctx, vaultPath, stateRoot, service, window.operation, {
        project: project.projectId,
        profileId,
        workerInput,
        candidate: { ...preflightCandidate, provenance: proposalProvenance },
        actor: requestedActor
      });
      await moveCadenceWorkRunToReview(ctx, vaultPath, project, identity, workRunId, proposal.proposalId);
      appendGovernedUsage(vaultPath, {
        kind: "dreamtime",
        idempotencyKey: `dreamtime-cadence:${identity.invocationId}`,
        occurredAt: asOf,
        projectId: project.projectId,
        profileId,
        workRunId,
        provider: proposal.modelLock.provider,
        model: proposal.modelLock.model,
        operation: "dreamtime.cadence.run",
        provenance: [`dreamtime-run:${identity.invocationId}`]
      });
      return {
        ...window,
        invocationId: identity.invocationId,
        workRunId,
        contextEnvelopeFingerprint: envelope.fingerprint,
        proposal,
        idempotent: proposalIdempotent
      };
    })
  }];
}
function collaborationRoot(stateRoot) {
  return join11(stateRoot, "collaboration");
}
function childWorkRunIdFor(plan) {
  const suffix = canonicalDigest({ planId: plan.planId, fingerprint: plan.fingerprint }).slice("sha256:".length);
  return `work-run/child-${suffix.slice(0, 24)}`;
}
function consultOperations(vaultPath, stateRoot, service) {
  return [{
    name: "consult.execute",
    namespace: "consult",
    description: "Execute one authorized as-of Context Consult and persist only its read-only Artifact Projection.",
    mutating: true,
    writePolicy: AGENT_DOMAIN_USAGE_WRITE_POLICY,
    params: {
      project: { type: "string", required: true },
      request: { type: "object", required: true },
      invocationToken: { type: "string", required: true },
      workerOutput: { type: "object", required: true },
      inputArtifactIds: { type: "array", required: false },
      actor: { type: "string", required: true },
      grant: { type: "unknown", required: false }
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ["project", "request", "invocationToken", "workerOutput", "inputArtifactIds", "actor"]);
      const project = exactProject(vaultPath, params.project, "consult.execute");
      const authenticatedActor = actor(ctx, params.actor);
      const requestInput = requiredRecord(params.request, "request");
      if (requestInput.requestId === void 0)
        throw badRequest("consult.execute requires a stable request.requestId for replay");
      const grantId = requiredString(requestInput.capabilityGrantId, "request.capabilityGrantId");
      const { grant, child: requestingWorkRun } = await activeServerGrant(stateRoot, service, project, grantId);
      if (requestInput.authorizationDecision !== void 0 && canonicalJson(requestInput.authorizationDecision) !== canonicalJson(grant.policyDecision)) {
        throw conflict("Context Consult client authorization does not match the server-issued Capability Grant decision");
      }
      const invocationToken = requiredString(params.invocationToken, "invocationToken");
      const request = createContextConsultRequest({ ...requestInput, authorizationDecision: grant.policyDecision, invocationToken });
      if (request.projectId !== project.projectId)
        throw conflict("Context Consult Project differs from the canonical Project Context");
      if (!request.authorizationDecision.allowed || request.authorizationDecision.actor !== authenticatedActor) {
        throw conflict("Context Consult authorization decision must allow the authenticated actor");
      }
      const requestingProfile = await service.profiles.readRevision(request.requestingAgent.profileId, request.requestingAgent.profileRevision);
      const targetProfile = await service.profiles.readRevision(request.targetAgent.profileId, request.targetAgent.profileRevision);
      if (!requestingProfile || !targetProfile)
        throw conflict("Context Consult Agent Profile revision lock is not current vault state");
      if (request.requestingAgent.workRunId !== requestingWorkRun.workRunId || request.requestingAgent.profileId !== requestingWorkRun.assignment.profileId || request.requestingAgent.profileRevision !== requestingWorkRun.assignment.profileRevision) {
        throw conflict("Context Consult requester does not match the active server-issued Work Run assignment");
      }
      const targetBindingId = `binding/${project.slug}/${request.targetAgent.profileId.slice("agent/".length)}`;
      const targetBinding = await service.bindings.read(targetBindingId);
      if (!targetBinding || !targetBinding.enabled || targetBinding.projectId !== project.projectId || targetBinding.profileId !== request.targetAgent.profileId || targetBinding.profileRevision !== request.targetAgent.profileRevision) {
        throw conflict("Context Consult target is not an enabled Project-bound Agent at the requested Profile revision");
      }
      if (request.attachTo.kind === "workRun") {
        if (request.attachTo.id !== requestingWorkRun.workRunId && request.attachTo.id !== requestingWorkRun.parentWorkRunId) {
          readCanonicalWorkRun(vaultPath, project, request.attachTo.id);
        } else if (request.attachTo.id === requestingWorkRun.parentWorkRunId) {
          readCanonicalWorkRun(vaultPath, project, request.attachTo.id);
        }
      } else {
        const thread = await service.threads.read(request.attachTo.id);
        if (!thread || thread.projectId !== project.projectId)
          throw conflict("Context Consult attachment Thread is outside the exact Project");
      }
      const memory = dreamTimeStore(stateRoot, project.projectId, request.targetAgent.profileId);
      const execution = await new ContextConsultStore({ collaborationRoot: collaborationRoot(stateRoot), projectId: project.projectId }).execute({
        request,
        invocationToken,
        grant,
        targetMemory: {
          readApprovedRevision: async (lock) => {
            const revision = await memory.readRevision(lock.revisionId);
            if (!revision)
              throw new DomainNotFoundError(`Context Consult Memory Revision ${lock.revisionId} does not exist`);
            return revision;
          },
          readCurrentApprovedRevision: async () => {
            const revision = await memory.readCurrentRevision();
            if (!revision)
              throw new DomainNotFoundError("Context Consult target has no approved current Memory Revision");
            return revision;
          }
        },
        worker: { generate: async () => requiredRecord(params.workerOutput, "workerOutput") },
        inputArtifactIds: params.inputArtifactIds
      });
      appendGovernedUsage(vaultPath, {
        kind: "consult",
        idempotencyKey: `context-consult:${request.requestId}`,
        occurredAt: execution.result.completedAt,
        projectId: request.projectId,
        profileId: request.targetAgent.profileId,
        threadId: request.attachTo.kind === "thread" ? request.attachTo.id : void 0,
        workRunId: request.requestingAgent.workRunId,
        operation: "consult.execute",
        provenance: [`invocation:${request.requestId}`]
      });
      return execution;
    })
  }];
}
function delegationOperations(vaultPath, stateRoot, service) {
  const storeFor = (projectId2) => new DelegationStore({ collaborationRoot: collaborationRoot(stateRoot), projectId: projectId2 });
  return [{
    name: "delegation.plan",
    namespace: "delegation",
    description: "Persist one explicit, reviewable Delegation Plan locked to canonical Project, parent Work Run, Agent, Binding, assignment, budget, and side-effect scope.",
    mutating: true,
    writePolicy: AGENT_DOMAIN_USAGE_WRITE_POLICY,
    params: { project: { type: "string", required: true }, input: { type: "object", required: true }, actor: { type: "string", required: true } },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ["project", "input", "actor"]);
      const project = exactProject(vaultPath, params.project, "delegation.plan");
      const input = requiredRecord(params.input, "input");
      if (input.planId === void 0)
        throw badRequest("delegation.plan requires a stable input.planId for replay");
      const createdBy = actor(ctx, params.actor);
      const plan = createDelegationPlan({ ...input, projectId: project.projectId, createdBy });
      readCanonicalWorkRun(vaultPath, project, plan.parentWorkRunId);
      const profile = await service.profiles.readRevision(plan.assignment.profileId, plan.assignment.profileRevision);
      const binding = await service.bindings.readRevision(plan.assignment.bindingId, plan.assignment.bindingRevision);
      if (!profile || !binding || binding.projectId !== project.projectId || binding.profileId !== profile.profileId || !binding.enabled) {
        throw conflict("Delegation assignment does not lock an enabled Agent Profile/Project Binding revision in the exact Project");
      }
      const persisted = await storeFor(project.projectId).createPlan(plan);
      appendGovernedUsage(vaultPath, {
        kind: "delegation",
        idempotencyKey: `delegation-plan:${persisted.planId}`,
        occurredAt: persisted.createdAt,
        projectId: persisted.projectId,
        profileId: persisted.assignment.profileId,
        workRunId: persisted.parentWorkRunId,
        device: persisted.assignment.deviceSnapshot.deviceId,
        operation: "delegation.plan",
        provenance: [`invocation:${persisted.planId}`]
      });
      return persisted;
    })
  }, {
    name: "delegation.approve",
    namespace: "delegation",
    description: "Approve one exact Delegation Plan and idempotently create one same-Project Child Work Run with an expiring scoped grant.",
    mutating: true,
    writePolicy: AGENT_DOMAIN_USAGE_WRITE_POLICY,
    params: {
      project: { type: "string", required: true },
      planId: { type: "string", required: true },
      presentedFingerprint: { type: "string", required: true },
      expectedRevision: { type: "number", required: true },
      transitionToken: { type: "string", required: true },
      approvedExternalClasses: { type: "array", required: true },
      actor: { type: "string", required: true }
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ["project", "planId", "presentedFingerprint", "expectedRevision", "transitionToken", "approvedExternalClasses", "actor"]);
      const project = exactProject(vaultPath, params.project, "delegation.approve");
      if (requiredInteger(params.expectedRevision, "expectedRevision", 1) !== 1)
        throw conflict("Delegation Plan revision lock must be 1");
      const authenticatedActor = actor(ctx, params.actor, true);
      const result = await storeFor(project.projectId).approve({
        planId: requiredString(params.planId, "planId"),
        presentedFingerprint: requiredString(params.presentedFingerprint, "presentedFingerprint"),
        transitionToken: requiredString(params.transitionToken, "transitionToken"),
        actor: authenticatedActor,
        approvedExternalClasses: params.approvedExternalClasses,
        authorize: async () => ({ allowed: true, policyVersion: "delegation-manual-approval/v1", reason: "Authenticated explicit per-run approval", decidedAt: (/* @__PURE__ */ new Date()).toISOString(), actor: authenticatedActor })
      });
      appendGovernedUsage(vaultPath, {
        kind: "delegation",
        idempotencyKey: `delegation-approval:${result.child.workRunId}`,
        occurredAt: result.child.createdAt,
        projectId: result.child.projectId,
        profileId: result.child.assignment.profileId,
        workRunId: result.child.workRunId,
        device: result.child.assignment.deviceSnapshot.deviceId,
        operation: "delegation.approve",
        provenance: [`work-run:${result.child.workRunId}`]
      });
      return result;
    })
  }, {
    name: "delegation.read",
    namespace: "delegation",
    description: "Read one immutable Delegation Plan and its deterministic Child Work Run projection when approved.",
    mutating: false,
    params: { project: { type: "string", required: true }, planId: { type: "string", required: true } },
    handler: async (_ctx, params) => boundary(async () => {
      closedParams(params, ["project", "planId"]);
      const project = exactProject(vaultPath, params.project, "delegation.read");
      const store = storeFor(project.projectId);
      const plan = await store.readPlan(requiredString(params.planId, "planId"));
      if (!plan)
        throw notFound(`Delegation Plan ${String(params.planId)} does not exist`);
      return { plan, child: await store.readChild(childWorkRunIdFor(plan)) };
    })
  }, {
    name: "delegation.transition",
    namespace: "delegation",
    description: "Transition one Child Work Run without inferring any parent terminal state.",
    mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: {
      project: { type: "string", required: true },
      workRunId: { type: "string", required: true },
      expectedRevision: { type: "number", required: true },
      lifecycle: { type: "string", required: true, enum: ["running", "completed", "failed", "cancelled"] },
      transitionToken: { type: "string", required: true },
      actor: { type: "string", required: true },
      diagnosticArtifact: { type: "object", required: false }
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ["project", "workRunId", "expectedRevision", "lifecycle", "transitionToken", "actor", "diagnosticArtifact"]);
      const project = exactProject(vaultPath, params.project, "delegation.transition");
      return storeFor(project.projectId).transition(requiredString(params.workRunId, "workRunId"), {
        expectedRevision: requiredInteger(params.expectedRevision, "expectedRevision", 1),
        lifecycle: requiredString(params.lifecycle, "lifecycle"),
        transitionToken: requiredString(params.transitionToken, "transitionToken"),
        actor: actor(ctx, params.actor),
        diagnosticArtifact: params.diagnosticArtifact
      });
    })
  }, {
    name: "delegation.artifact.project",
    namespace: "delegation",
    description: "Project one provenance-preserving artifact from a Child Work Run back to its parent review surface.",
    mutating: true,
    writePolicy: AGENT_DOMAIN_WRITE_POLICY,
    params: {
      project: { type: "string", required: true },
      workRunId: { type: "string", required: true },
      expectedRevision: { type: "number", required: true },
      transitionToken: { type: "string", required: true },
      actor: { type: "string", required: true },
      artifact: { type: "object", required: true }
    },
    handler: async (ctx, params) => boundary(async () => {
      closedParams(params, ["project", "workRunId", "expectedRevision", "transitionToken", "actor", "artifact"]);
      const project = exactProject(vaultPath, params.project, "delegation.artifact.project");
      return storeFor(project.projectId).projectArtifact(requiredString(params.workRunId, "workRunId"), {
        expectedRevision: requiredInteger(params.expectedRevision, "expectedRevision", 1),
        transitionToken: requiredString(params.transitionToken, "transitionToken"),
        actor: actor(ctx, params.actor),
        artifact: requiredRecord(params.artifact, "artifact")
      });
    })
  }];
}
function makeAgentDomainOps(vaultPath) {
  const stateRoot = join11(vaultPath, ...AGENT_DOMAIN_RELATIVE_ROOT.split("/"));
  const service = new AgentDomainService({ stateRoot });
  return [
    ...profileOperations(service),
    ...bindingOperations(vaultPath, service),
    ...threadOperations(vaultPath, service),
    ...roomAndContextOperations(vaultPath, stateRoot, service),
    ...dreamTimeOperations(vaultPath, stateRoot, service),
    ...dreamTimeCadenceOperations(vaultPath, stateRoot, service),
    ...consultOperations(vaultPath, stateRoot, service),
    ...delegationOperations(vaultPath, stateRoot, service)
  ];
}

// dist/agent-domain/cli.js
async function runAgentDomainCli(argv) {
  const command = argv[0];
  if (command !== "room" && command !== "context-compile") {
    throw badRequest("Agent Domain command must be room or context-compile");
  }
  const vaultPath = resolve4(requiredOption(argv, "--vault"));
  const dispatcher = createOperationDispatcher(makeAgentDomainOps(vaultPath), operationContext(vaultPath));
  if (command === "room") {
    const threadId = option(argv, "--thread-id");
    return {
      command,
      result: await dispatcher.invoke("agent.room.get", {
        project: requiredOption(argv, "--project"),
        profileId: requiredOption(argv, "--profile-id"),
        ...threadId ? { threadId } : {}
      })
    };
  }
  const expectedFingerprint = option(argv, "--expected-fingerprint");
  const references = jsonObjectFile(argv, "--input-file");
  return {
    command,
    result: await dispatcher.invoke("agent.context.compile", {
      ...references,
      ...expectedFingerprint ? { expectedFingerprint } : {},
      explicitNewAttempt: argv.includes("--explicit-new-attempt")
    })
  };
}
function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1)
    return void 0;
  const value = args[index + 1];
  if (!value || value.startsWith("--"))
    throw badRequest(`${name} requires a value`);
  return value;
}
function requiredOption(args, name) {
  const value = option(args, name)?.trim();
  if (!value)
    throw badRequest(`${name} is required`);
  return value;
}
function jsonObjectFile(args, name) {
  const path = resolve4(requiredOption(args, name));
  let value;
  try {
    value = JSON.parse(readFileSync9(path, "utf8"));
  } catch (error) {
    throw badRequest(`${name} must reference readable JSON: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(`${name} must contain a JSON object`);
  }
  return value;
}
function operationContext(vaultPath) {
  return {
    vault: { async execute() {
      return {};
    } },
    adapters: null,
    config: {
      vault_path: vaultPath,
      collaboration: {
        actor: process.env.VAULT_MIND_ACTOR || "agent-domain-cli",
        role: process.env.VAULT_MIND_ROLE || "human"
      }
    },
    logger: { info() {
    }, warn() {
    }, error() {
    } },
    dryRun: false
  };
}
var isEntrypoint = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve4(process.argv[1])).href;
if (isEntrypoint) {
  runAgentDomainCli(process.argv.slice(2)).then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}
`)).catch((error) => {
    const code = isOperationError(error) ? error.code : -32603;
    const message = error instanceof Error ? error.message : "Agent Domain CLI failed";
    process.stderr.write(`${JSON.stringify({ code, message })}
`);
    process.exitCode = 1;
  });
}
export {
  runAgentDomainCli
};
