#!/usr/bin/env node

// dist/usage/cli.js
import { readFileSync as readFileSync3 } from "node:fs";
import { resolve as resolve3 } from "node:path";
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

// dist/usage/operations.js
import { join as join3 } from "node:path";

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
function parseFm(text) {
  const m = FRONTMATTER_RE.exec(text);
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
function recordCompatibilityRead(operation, projectId) {
  const key = `${operation}\0${projectId}`;
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
function projectSlug(projectId) {
  return projectId.slice("project/".length);
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
  const relativePath = ".vault-mind/local-bindings.json";
  const fullPath = join(vaultPath, ".vault-mind", "local-bindings.json");
  if (!existsSync(fullPath))
    return { bindings, diagnostics };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(fullPath, "utf-8").replace(/^\uFEFF/, ""));
  } catch {
    diagnostics.push({
      code: "malformed_local_bindings",
      severity: "error",
      message: "Local workspace bindings are unreadable or malformed JSON.",
      path: relativePath
    });
    return { bindings, diagnostics };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    diagnostics.push({
      code: "malformed_local_bindings",
      severity: "error",
      message: "Local workspace bindings must be a Project ID keyed object.",
      path: relativePath
    });
    return { bindings, diagnostics };
  }
  for (const [rawProjectRef, rawBinding] of Object.entries(parsed).sort(([left], [right]) => left.localeCompare(right))) {
    let projectId;
    if (isProjectId(rawProjectRef)) {
      projectId = rawProjectRef;
    } else if (PROJECT_SLUG_RE.test(rawProjectRef)) {
      projectId = projectIdFromSlug(rawProjectRef);
      diagnostics.push({
        code: "compatibility_binding_identity",
        severity: "warning",
        message: "A local binding uses a legacy bare slug; rewrite it with the canonical Project ID.",
        path: relativePath,
        projectId
      });
    } else {
      diagnostics.push({
        code: "invalid_binding_project_id",
        severity: "error",
        message: "A local binding uses a non-canonical Project ID.",
        path: relativePath
      });
      continue;
    }
    if (bindings.has(projectId)) {
      diagnostics.push({
        code: "duplicate_binding_identity",
        severity: "error",
        message: "Multiple local bindings normalize to the same Project ID.",
        path: relativePath,
        projectId
      });
      continue;
    }
    const rawPath = rawBinding && typeof rawBinding === "object" && !Array.isArray(rawBinding) ? rawBinding.path : void 0;
    if (typeof rawPath !== "string" || !rawPath.trim() || !looksAbsolutePath(rawPath.trim())) {
      diagnostics.push({
        code: "invalid_workspace_binding",
        severity: "error",
        message: "A local binding must contain one absolute workspace path.",
        path: relativePath,
        projectId
      });
      continue;
    }
    const normalizedPath = normalizeWorkspacePath(rawPath.trim());
    bindings.set(projectId, { path: normalizedPath, available: existsSync(normalizedPath) });
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
  for (const projectId of bindingSnapshot.bindings.keys()) {
    if (registeredIds.has(projectId))
      continue;
    diagnostics.push({
      code: "orphan_workspace_binding",
      severity: "warning",
      message: "A local workspace binding has no matching shared Project record.",
      path: ".vault-mind/local-bindings.json",
      projectId
    });
  }
  return { projects, diagnostics };
}
function ambiguity(reference, matches2) {
  const candidates = [...new Set(matches2.map((match) => match.projectId))].sort();
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
  const registry = scanProjectRegistry(vaultPath);
  let matches2 = [];
  let resolvedBy;
  if (reference.kind === "id") {
    const projectId = parseProjectId(reference.value);
    matches2 = registry.projects.filter((project) => project.projectId === projectId);
    resolvedBy = "project_id";
  } else if (reference.kind === "name") {
    const folded = reference.value.toLowerCase();
    matches2 = registry.projects.filter((project) => project.slug.toLowerCase() === folded || project.aliases.some((alias) => alias.toLowerCase() === folded));
    resolvedBy = matches2.some((project) => project.slug.toLowerCase() === folded) ? "slug" : "alias";
  } else {
    const normalizedPath = workspacePathKey(reference.value);
    matches2 = registry.projects.filter((project) => project.workspace ? workspacePathKey(project.workspace.path) === normalizedPath : false);
    resolvedBy = "workspace_binding";
  }
  if (matches2.length > 1)
    ambiguity(reference, matches2);
  const entry = matches2[0];
  if (!entry)
    throw notFound(`Project not found: ${reference.value}`);
  const diagnostics = [...registry.diagnostics];
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

// dist/usage/contracts.js
import { createHash } from "node:crypto";

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
function usageEventId(idempotencyKey) {
  return `usage/${createHash("sha256").update(idempotencyKey).digest("hex")}`;
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
function assertIdentifier(value, fieldPath) {
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
function parseTimestamp(value, fieldPath) {
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
      assertIdentifier(item, itemPath);
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
    occurredAt: parseTimestamp(value.occurredAt, "$.occurredAt"),
    dimensions,
    providerFacts,
    provenance
  };
}

// dist/usage/ledger.js
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, readdirSync as readdirSync2, writeFileSync } from "node:fs";
import { dirname, join as join2, relative, resolve as resolve2, sep } from "node:path";

// dist/usage/canonical.js
import { createHash as createHash2 } from "node:crypto";
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
function canonicalJson(value) {
  return serialize(value);
}
function sha256(value) {
  return createHash2("sha256").update(value).digest("hex");
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
  return `${canonicalJson(event)}
`;
}
function normalizeStorageKey(value) {
  return value.split(sep).join("/");
}
function usageEventStorageKey(idempotencyKey) {
  const digest = usageEventId(idempotencyKey).slice("usage/".length);
  return `events/${digest.slice(0, 2)}/${digest}.json`;
}
var UsageLedger = class {
  storageVersion = USAGE_LEDGER_STORAGE_VERSION;
  #root;
  constructor(root) {
    if (!root)
      throw new TypeError("Usage ledger root is required");
    this.#root = resolve2(root);
  }
  append(value) {
    const event = validateUsageEvent(value);
    const target = this.#targetForKey(event.idempotencyKey);
    const storageKey = this.#storageKey(target);
    const bytes = eventBytes(event);
    mkdirSync(dirname(target), { recursive: true });
    try {
      writeFileSync(target, bytes, { encoding: "utf8", flag: "wx", mode: 384 });
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
    const persisted = readFileSync2(target, "utf8");
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
    if (!existsSync2(target))
      return null;
    return this.#readStoredEvent(target, expectedId);
  }
  list() {
    const eventsRoot = join2(this.#root, "events");
    if (!existsSync2(eventsRoot))
      return [];
    const targets = readdirSync2(eventsRoot, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => join2(entry.parentPath, entry.name)).sort((left, right) => left.localeCompare(right));
    return targets.map((target) => {
      const digest = target.slice(target.lastIndexOf(sep) + 1, -".json".length);
      return this.#readStoredEvent(target, `usage/${digest}`);
    });
  }
  #targetForKey(idempotencyKey) {
    return join2(this.#root, ...usageEventStorageKey(idempotencyKey).split("/"));
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
      raw = readFileSync2(target, "utf8");
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

// dist/usage/policy.js
var USAGE_POLICY_SCHEMA = "llmwiki.usage-policy";
var USAGE_POLICY_SCHEMA_VERSION = 1;
var POLICY_METRICS = /* @__PURE__ */ new Set([
  "eventCount",
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "providerReportedCost"
]);
var DECISIONS = /* @__PURE__ */ new Set(["allow", "warn", "deny"]);
var POLICY_ID = /^[A-Za-z][A-Za-z0-9._:/-]{0,159}$/;
var CURRENCY2 = /^[A-Z]{3}$/;
function record(value, fieldPath) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${fieldPath} must be an object`);
}
function closed(value, allowed, required, fieldPath) {
  const keys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!keys.has(key))
      throw new TypeError(`${fieldPath}.${key} is not part of the versioned Usage Policy contract`);
  }
  for (const key of required) {
    if (!(key in value))
      throw new TypeError(`${fieldPath}.${key} is required`);
  }
}
function threshold(value, fieldPath) {
  if (value === void 0)
    return void 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${fieldPath} must be finite and non-negative`);
  }
  return value;
}
function validateUsagePolicy(value) {
  record(value, "$");
  closed(value, [
    "schema",
    "schemaVersion",
    "policyId",
    "policyVersion",
    "scopeFilters",
    "rules"
  ], [
    "schema",
    "schemaVersion",
    "policyId",
    "policyVersion",
    "scopeFilters",
    "rules"
  ], "$");
  if (value.schema !== USAGE_POLICY_SCHEMA || value.schemaVersion !== USAGE_POLICY_SCHEMA_VERSION) {
    throw new TypeError("Unsupported Usage Policy schema version");
  }
  if (typeof value.policyId !== "string" || !POLICY_ID.test(value.policyId))
    throw new TypeError("$.policyId must be canonical");
  assertSafeUsageString(value.policyId, "$.policyId");
  if (!Number.isSafeInteger(value.policyVersion) || value.policyVersion < 1) {
    throw new TypeError("$.policyVersion must be a positive safe integer");
  }
  record(value.scopeFilters, "$.scopeFilters");
  closed(value.scopeFilters, USAGE_DIMENSION_NAMES, [], "$.scopeFilters");
  const scopeFilters = {};
  for (const name of USAGE_DIMENSION_NAMES) {
    const filter = value.scopeFilters[name];
    if (filter === void 0)
      continue;
    if (filter !== null) {
      if (typeof filter !== "string" || filter.length === 0)
        throw new TypeError(`$.scopeFilters.${name} must be an identifier or null`);
      assertSafeUsageString(filter, `$.scopeFilters.${name}`);
    }
    scopeFilters[name] = filter;
  }
  if (!Array.isArray(value.rules) || value.rules.length === 0)
    throw new TypeError("$.rules must contain at least one rule");
  const ruleIds = /* @__PURE__ */ new Set();
  const rules = value.rules.map((item, index) => {
    const fieldPath = `$.rules[${index}]`;
    record(item, fieldPath);
    closed(item, ["ruleId", "metric", "currency", "warnAt", "denyAt", "unknownAction"], ["ruleId", "metric", "unknownAction"], fieldPath);
    if (typeof item.ruleId !== "string" || !POLICY_ID.test(item.ruleId))
      throw new TypeError(`${fieldPath}.ruleId must be canonical`);
    assertSafeUsageString(item.ruleId, `${fieldPath}.ruleId`);
    if (ruleIds.has(item.ruleId))
      throw new TypeError(`Duplicate Usage Policy rule: ${item.ruleId}`);
    ruleIds.add(item.ruleId);
    if (typeof item.metric !== "string" || !POLICY_METRICS.has(item.metric)) {
      throw new TypeError(`${fieldPath}.metric is unsupported`);
    }
    if (typeof item.unknownAction !== "string" || !DECISIONS.has(item.unknownAction)) {
      throw new TypeError(`${fieldPath}.unknownAction must be allow, warn, or deny`);
    }
    const metric = item.metric;
    let currency;
    if (metric === "providerReportedCost") {
      if (typeof item.currency !== "string" || !CURRENCY2.test(item.currency)) {
        throw new TypeError(`${fieldPath}.currency is required for providerReportedCost`);
      }
      currency = item.currency;
    } else if (item.currency !== void 0) {
      throw new TypeError(`${fieldPath}.currency is only valid for providerReportedCost`);
    }
    const warnAt = threshold(item.warnAt, `${fieldPath}.warnAt`);
    const denyAt = threshold(item.denyAt, `${fieldPath}.denyAt`);
    if (warnAt === void 0 && denyAt === void 0 && item.unknownAction === "allow") {
      throw new TypeError(`${fieldPath} has no enforceable limit`);
    }
    if (warnAt !== void 0 && denyAt !== void 0 && warnAt > denyAt) {
      throw new TypeError(`${fieldPath}.warnAt must not exceed denyAt`);
    }
    return {
      ruleId: item.ruleId,
      metric,
      ...currency === void 0 ? {} : { currency },
      ...warnAt === void 0 ? {} : { warnAt },
      ...denyAt === void 0 ? {} : { denyAt },
      unknownAction: item.unknownAction
    };
  });
  return {
    schema: USAGE_POLICY_SCHEMA,
    schemaVersion: USAGE_POLICY_SCHEMA_VERSION,
    policyId: value.policyId,
    policyVersion: value.policyVersion,
    scopeFilters,
    rules
  };
}
function severity(value) {
  return value === "deny" ? 2 : value === "warn" ? 1 : 0;
}
function metricValue(projection, rule) {
  if (rule.metric === "eventCount")
    return { knownValue: projection.sourceEventCount, unknownCount: 0 };
  if (rule.metric === "providerReportedCost") {
    let knownValue2 = 0;
    let unknownCount2 = 0;
    for (const group of projection.groups) {
      knownValue2 += group.metrics.providerReportedCost.totals.filter((total) => total.currency === rule.currency).reduce((sum, total) => sum + total.knownTotal, 0);
      unknownCount2 += group.metrics.providerReportedCost.unknownAmountCount;
    }
    return { knownValue: knownValue2, unknownCount: unknownCount2 };
  }
  let knownValue = 0;
  let unknownCount = 0;
  for (const group of projection.groups) {
    const metric = group.metrics[rule.metric];
    knownValue += metric.knownTotal;
    unknownCount += metric.unknownCount;
  }
  return { knownValue, unknownCount };
}
function sameScope(expected, actual) {
  return canonicalJson(expected) === canonicalJson(actual);
}
function evaluateUsagePolicy(policyValue, projection) {
  const policy = validateUsagePolicy(policyValue);
  if (projection.schema !== "llmwiki.usage-projection" || projection.schemaVersion !== 1) {
    throw new TypeError("Unsupported Usage Projection schema version");
  }
  if (!sameScope(policy.scopeFilters, projection.query.filters)) {
    throw new TypeError("Usage Policy scope must exactly match the projection filters");
  }
  const rules = policy.rules.map((rule) => {
    const { knownValue, unknownCount } = metricValue(projection, rule);
    let decision2 = "allow";
    const reasons = [];
    if (rule.denyAt !== void 0 && knownValue >= rule.denyAt) {
      decision2 = "deny";
      reasons.push("deny-limit-reached");
    } else if (rule.warnAt !== void 0 && knownValue >= rule.warnAt) {
      decision2 = "warn";
      reasons.push("warning-limit-reached");
    } else {
      reasons.push("within-limit");
    }
    if (unknownCount > 0) {
      reasons.push("unknown-facts");
      if (severity(rule.unknownAction) > severity(decision2))
        decision2 = rule.unknownAction;
    }
    return {
      ruleId: rule.ruleId,
      metric: rule.metric,
      ...rule.currency === void 0 ? {} : { currency: rule.currency },
      decision: decision2,
      knownValue,
      unknownCount,
      reasons
    };
  });
  const decision = rules.reduce((current, rule) => severity(rule.decision) > severity(current) ? rule.decision : current, "allow");
  const decisionId = `usage-decision/${sha256(canonicalJson({
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    projectionRevision: projection.revision,
    rules
  }))}`;
  return {
    schema: "llmwiki.usage-policy-decision",
    schemaVersion: 1,
    decisionId,
    decision,
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    projectionRevision: projection.revision,
    sourceEventCount: projection.sourceEventCount,
    window: projection.query.window,
    rules
  };
}

// dist/usage/projections.js
var USAGE_PROJECTION_SCHEMA = "llmwiki.usage-projection";
var USAGE_PROJECTION_SCHEMA_VERSION = 1;
function timestamp(value, fieldPath) {
  if (value === void 0)
    return null;
  if (Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError(`${fieldPath} must be canonical UTC RFC3339`);
  }
  return value;
}
function normalizeQuery(query) {
  const requested = new Set(query.groupBy ?? []);
  for (const dimension of requested) {
    if (!USAGE_DIMENSION_NAMES.includes(dimension))
      throw new TypeError(`Unknown usage dimension: ${dimension}`);
  }
  const groupBy = USAGE_DIMENSION_NAMES.filter((name) => requested.has(name));
  const filters = {};
  for (const name of USAGE_DIMENSION_NAMES) {
    const value = query.filters?.[name];
    if (value === void 0)
      continue;
    if (value !== null) {
      if (typeof value !== "string" || value.length === 0)
        throw new TypeError(`Usage filter ${name} must be an identifier or null`);
      assertSafeUsageString(value, `$.filters.${name}`);
    }
    filters[name] = value;
  }
  const from = timestamp(query.from, "$.from");
  const to = timestamp(query.to, "$.to");
  if (from !== null && to !== null && from >= to)
    throw new TypeError("Usage projection window must have from < to");
  return { groupBy, filters, window: { from, to } };
}
function dimensionValue(fact) {
  return fact.state === "known" ? fact.value : null;
}
function matches(event, query) {
  if (query.window.from !== null && event.occurredAt < query.window.from)
    return false;
  if (query.window.to !== null && event.occurredAt >= query.window.to)
    return false;
  return USAGE_DIMENSION_NAMES.every((name) => {
    const expected = query.filters[name];
    return expected === void 0 || dimensionValue(event.dimensions[name]) === expected;
  });
}
function emptyMetric() {
  return { knownTotal: 0, knownEventCount: 0, unknownCount: 0 };
}
function aggregateMetric(events, select) {
  const metric = emptyMetric();
  for (const event of events) {
    const fact = select(event);
    if (fact.state === "known") {
      metric.knownTotal += fact.value;
      metric.knownEventCount += 1;
    } else {
      metric.unknownCount += 1;
    }
  }
  return metric;
}
function aggregateTotalTokens(events) {
  const metric = emptyMetric();
  for (const event of events) {
    const { inputTokens, outputTokens } = event.providerFacts;
    if (inputTokens.state === "known" && outputTokens.state === "known") {
      metric.knownTotal += inputTokens.value + outputTokens.value;
      metric.knownEventCount += 1;
    } else {
      metric.unknownCount += 1;
    }
  }
  return metric;
}
function aggregateCost(events) {
  const totals = /* @__PURE__ */ new Map();
  let unknownAmountCount = 0;
  let unknownCurrencyCount = 0;
  for (const event of events) {
    const { providerReportedCost, currency } = event.providerFacts;
    if (providerReportedCost.state === "unknown") {
      unknownAmountCount += 1;
      if (currency.state === "unknown")
        unknownCurrencyCount += 1;
      continue;
    }
    if (currency.state === "unknown") {
      unknownCurrencyCount += 1;
      continue;
    }
    const total = totals.get(currency.value) ?? { knownTotal: 0, knownEventCount: 0 };
    total.knownTotal += providerReportedCost.value;
    total.knownEventCount += 1;
    totals.set(currency.value, total);
  }
  return {
    totals: [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currency, total]) => ({ currency, ...total })),
    unknownAmountCount,
    unknownCurrencyCount
  };
}
function latest(events) {
  return events.reduce((current, event) => current === null || event.occurredAt > current ? event.occurredAt : current, null);
}
function buildGroup(events, dimensions, query) {
  const unknownDimensions = Object.fromEntries(USAGE_DIMENSION_NAMES.map((name) => [name, events.filter((event) => event.dimensions[name].state === "unknown").length]));
  const groupKey = canonicalJson(dimensions);
  return {
    groupKey,
    dimensions,
    sourceEventCount: events.length,
    sourceEventIds: events.map((event) => event.eventId),
    unknownDimensions,
    metrics: {
      inputTokens: aggregateMetric(events, (event) => event.providerFacts.inputTokens),
      outputTokens: aggregateMetric(events, (event) => event.providerFacts.outputTokens),
      totalTokens: aggregateTotalTokens(events),
      providerReportedCost: aggregateCost(events)
    },
    revision: sha256(canonicalJson({
      schemaVersion: USAGE_PROJECTION_SCHEMA_VERSION,
      query,
      dimensions,
      events
    })),
    lastUpdatedAt: latest(events)
  };
}
function projectUsage(values, requestedQuery = {}) {
  const query = normalizeQuery(requestedQuery);
  const events = values.map(validateUsageEvent).sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId));
  const identities = /* @__PURE__ */ new Set();
  for (const event of events) {
    if (identities.has(event.eventId))
      throw new TypeError(`Duplicate Usage Event identity: ${event.eventId}`);
    identities.add(event.eventId);
  }
  const filtered = events.filter((event) => matches(event, query));
  const buckets = /* @__PURE__ */ new Map();
  for (const event of filtered) {
    const dimensions = Object.fromEntries(query.groupBy.map((name) => [name, dimensionValue(event.dimensions[name])]));
    const key = canonicalJson(dimensions);
    const bucket = buckets.get(key) ?? { dimensions, events: [] };
    bucket.events.push(event);
    buckets.set(key, bucket);
  }
  if (filtered.length === 0 && query.groupBy.length === 0) {
    buckets.set("{}", { dimensions: {}, events: [] });
  }
  const groups = [...buckets.values()].map((bucket) => buildGroup(bucket.events, bucket.dimensions, query)).sort((left, right) => left.groupKey.localeCompare(right.groupKey));
  return {
    schema: USAGE_PROJECTION_SCHEMA,
    schemaVersion: USAGE_PROJECTION_SCHEMA_VERSION,
    query,
    sourceEventCount: filtered.length,
    revision: sha256(canonicalJson({
      schemaVersion: USAGE_PROJECTION_SCHEMA_VERSION,
      query,
      events: filtered
    })),
    lastUpdatedAt: latest(filtered),
    groups
  };
}

// dist/usage/operations.js
var USAGE_LEDGER_RELATIVE_ROOT = "_llmwiki/usage/v1";
var USAGE_NAMESPACE = "usage";
function ledgerRoot(vaultPath) {
  return join3(vaultPath, ...USAGE_LEDGER_RELATIVE_ROOT.split("/"));
}
function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim())
    throw badRequest(`${field} is required`);
  return value.trim();
}
function optionalString(value, field) {
  if (value === void 0)
    return void 0;
  if (typeof value !== "string" || !value.trim())
    throw badRequest(`${field} must be a non-empty string`);
  return value.trim();
}
function record2(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw badRequest(`${field} must be an object`);
  return value;
}
function closedParams(params, allowed) {
  const names = new Set(allowed);
  for (const key of Object.keys(params)) {
    if (!names.has(key))
      throw badRequest(`Unsupported Usage operation parameter: ${key}`);
  }
}
function projectContext(vaultPath, params, operation) {
  return resolveProjectContext(vaultPath, requiredString(params.project, "project"), operation);
}
function assertEventProject(event, projectId) {
  const attributed = event.dimensions.project;
  if (attributed.state !== "known") {
    throw badRequest("Project-scoped Usage Events require an explicitly known Project attribution");
  }
  if (attributed.value !== projectId) {
    throw conflict("Usage Event Project attribution conflicts with Project Context", {
      expectedProjectId: projectId,
      eventProjectId: attributed.value
    });
  }
}
function parseGroupBy(value) {
  if (value === void 0)
    return void 0;
  if (!Array.isArray(value))
    throw badRequest("groupBy must be an array");
  return value.map((item, index) => {
    if (typeof item !== "string" || !USAGE_DIMENSION_NAMES.includes(item)) {
      throw badRequest(`groupBy[${index}] must be a supported Usage dimension`);
    }
    return item;
  });
}
function parseFilters(value) {
  if (value === void 0)
    return {};
  const input = record2(value, "filters");
  const filters = {};
  for (const [key, item] of Object.entries(input)) {
    if (!USAGE_DIMENSION_NAMES.includes(key)) {
      throw badRequest(`filters.${key} is not a supported Usage dimension`);
    }
    if (item !== null && (typeof item !== "string" || !item.length)) {
      throw badRequest(`filters.${key} must be an identifier or null`);
    }
    filters[key] = item;
  }
  return filters;
}
function projectQuery(params, projectId) {
  const filters = parseFilters(params.filters);
  if (filters.project !== void 0 && filters.project !== projectId) {
    throw conflict("Usage projection Project filter conflicts with Project Context", {
      expectedProjectId: projectId
    });
  }
  return {
    groupBy: parseGroupBy(params.groupBy),
    filters: { ...filters, project: projectId },
    from: optionalString(params.from, "from"),
    to: optionalString(params.to, "to")
  };
}
function operationError(error) {
  if (isOperationError(error))
    throw error;
  if (error instanceof UsageEventConflictError) {
    throw conflict(error.message, { eventId: error.eventId, storageKey: error.storageKey });
  }
  if (error instanceof UsageLedgerCorruptionError) {
    throw internal("Usage ledger validation failed closed", { storageKey: error.storageKey });
  }
  if (error instanceof UsageValidationError || error instanceof UsagePrivacyError || error instanceof TypeError) {
    throw badRequest(error.message);
  }
  throw internal("Usage operation failed closed");
}
function boundary(action) {
  try {
    return action();
  } catch (error) {
    operationError(error);
  }
}
function appendInput(vaultPath, params, operation) {
  closedParams(params, ["project", "event"]);
  const project = projectContext(vaultPath, params, operation);
  const event = validateUsageEvent(record2(params.event, "event"));
  assertEventProject(event, project.projectId);
  return { event, projectId: project.projectId };
}
function appendTarget(vaultPath, params) {
  const { event } = appendInput(vaultPath, params, "usage.append");
  return `${USAGE_LEDGER_RELATIVE_ROOT}/${usageEventStorageKey(event.idempotencyKey)}`;
}
function handleAppend(vaultPath, params) {
  const { event, projectId } = appendInput(vaultPath, params, "usage.append");
  const result = new UsageLedger(ledgerRoot(vaultPath)).append(event);
  return { projectId, ...result };
}
function handleProject(vaultPath, params) {
  closedParams(params, ["project", "groupBy", "filters", "from", "to"]);
  const project = projectContext(vaultPath, params, "usage.project");
  const projection = projectUsage(new UsageLedger(ledgerRoot(vaultPath)).list(), projectQuery(params, project.projectId));
  return { projectId: project.projectId, projection };
}
function handlePolicyEvaluation(vaultPath, params) {
  closedParams(params, ["project", "policy", "from", "to"]);
  const project = projectContext(vaultPath, params, "usage.policy.evaluate");
  const policy = validateUsagePolicy(record2(params.policy, "policy"));
  if (policy.scopeFilters.project !== project.projectId) {
    throw conflict("Usage Policy Project scope conflicts with Project Context", {
      expectedProjectId: project.projectId
    });
  }
  const projection = projectUsage(new UsageLedger(ledgerRoot(vaultPath)).list(), {
    filters: policy.scopeFilters,
    from: optionalString(params.from, "from"),
    to: optionalString(params.to, "to")
  });
  return {
    projectId: project.projectId,
    projection,
    decision: evaluateUsagePolicy(policy, projection)
  };
}
function makeUsageOps(vaultPath) {
  const append = {
    name: "usage.append",
    namespace: USAGE_NAMESPACE,
    description: "Append one immutable Project-attributed Usage Event or replay its existing logical event.",
    mutating: true,
    writePolicy: {
      realWrite: "always",
      targets: (ctx, params) => [
        boundary(() => appendTarget(ctx.config.vault_path, params))
      ],
      audit: "required"
    },
    params: {
      project: { type: "string", required: true, description: "Canonical Project ID or registered compatibility reference" },
      event: { type: "object", required: true, description: "Versioned privacy-safe Usage Event" }
    },
    handler: async (_ctx, params) => boundary(() => handleAppend(vaultPath, params))
  };
  const project = {
    name: "usage.project",
    namespace: USAGE_NAMESPACE,
    description: "Return a deterministic Project-owned Usage projection without mutating the Usage ledger.",
    mutating: false,
    params: {
      project: { type: "string", required: true, description: "Canonical Project ID or registered compatibility reference" },
      groupBy: { type: "array", required: false, description: "Usage dimensions used to form deterministic groups" },
      filters: { type: "object", required: false, description: "Additional Usage dimension filters; Project cannot drift" },
      from: { type: "string", required: false, description: "Inclusive canonical UTC RFC3339 start" },
      to: { type: "string", required: false, description: "Exclusive canonical UTC RFC3339 end" }
    },
    handler: async (_ctx, params) => boundary(() => handleProject(vaultPath, params))
  };
  const evaluate = {
    name: "usage.policy.evaluate",
    namespace: USAGE_NAMESPACE,
    description: "Evaluate one versioned Project-scoped Usage budget/admission policy over immutable Usage facts.",
    mutating: false,
    params: {
      project: { type: "string", required: true, description: "Canonical Project ID or registered compatibility reference" },
      policy: { type: "object", required: true, description: "Versioned Usage Policy with an exact Project scope" },
      from: { type: "string", required: false, description: "Inclusive canonical UTC RFC3339 start" },
      to: { type: "string", required: false, description: "Exclusive canonical UTC RFC3339 end" }
    },
    handler: async (_ctx, params) => boundary(() => handlePolicyEvaluation(vaultPath, params))
  };
  return [append, project, evaluate];
}

// dist/usage/cli.js
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
function jsonFile(args, name) {
  const path = resolve3(requiredOption(args, name));
  let value;
  try {
    value = JSON.parse(readFileSync3(path, "utf8"));
  } catch (error) {
    throw badRequest(`${name} must reference readable JSON: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(`${name} must contain a JSON object`);
  }
  return value;
}
function context(vaultPath) {
  return {
    vault: { async execute() {
      return {};
    } },
    adapters: null,
    config: { vault_path: vaultPath, collaboration: { actor: "usage-cli", role: "human" } },
    logger: { info() {
    }, warn() {
    }, error() {
    } },
    dryRun: false
  };
}
async function invoke(operations, ctx, name, params) {
  const operation = operations.find((candidate) => candidate.name === name);
  if (!operation)
    throw new Error(`Usage operation is not registered: ${name}`);
  return operation.handler(ctx, params);
}
async function runUsageCli(argv) {
  const command = argv[0];
  if (command !== "append" && command !== "project" && command !== "policy") {
    throw badRequest("Usage command must be append, project, or policy");
  }
  const vaultPath = resolve3(requiredOption(argv, "--vault"));
  const project = requiredOption(argv, "--project");
  const operations = makeUsageOps(vaultPath);
  const ctx = context(vaultPath);
  if (command === "append") {
    return {
      command,
      result: await invoke(operations, ctx, "usage.append", {
        project,
        event: jsonFile(argv, "--event-file")
      })
    };
  }
  const from = option(argv, "--from");
  const to = option(argv, "--to");
  if (command === "policy") {
    return {
      command,
      result: await invoke(operations, ctx, "usage.policy.evaluate", {
        project,
        policy: jsonFile(argv, "--policy-file"),
        ...from ? { from } : {},
        ...to ? { to } : {}
      })
    };
  }
  const groupBy = option(argv, "--group-by")?.split(",").map((value) => value.trim()).filter(Boolean);
  return {
    command,
    result: await invoke(operations, ctx, "usage.project", {
      project,
      ...groupBy?.length ? { groupBy } : {},
      ...from ? { from } : {},
      ...to ? { to } : {}
    })
  };
}
var isEntrypoint = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve3(process.argv[1])).href;
if (isEntrypoint) {
  runUsageCli(process.argv.slice(2)).then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}
`)).catch((error) => {
    const code = typeof error.code === "number" ? error.code : -32603;
    process.stderr.write(`${JSON.stringify({ code, message: error.message })}
`);
    process.exitCode = 1;
  });
}
export {
  runUsageCli
};
