import { canonicalDigest, canonicalJson, deepFreeze, sha256Text } from "./canonical.js";
import { VisualWorkspaceError } from "./errors.js";
import type {
  DataViewActionRequestV1,
  DataViewDefinitionV1,
  DataViewEditPlan,
  DataViewPlanInput,
  DataViewQueryResult,
  DataViewScalar,
} from "./data-view-types.js";
import { parseVaultRelativePath } from "./validation.js";
import { validateDataViewDefinition } from "./data-view-validation.js";

type SourceLine = { content: string; start: number };
type PropertyRange = { value: DataViewScalar | DataViewScalar[]; start: number; end: number };
const SECRET_PATTERN = /(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|authorization|password|secret[_-]?key|\btoken\b|bearer\s+[A-Za-z0-9._-]+|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9][A-Za-z0-9_-]{7,})/iu;

export function createDataViewEditPlan(input: DataViewPlanInput): Readonly<DataViewEditPlan> {
  const definition = validateDataViewDefinition(input.definition);
  validateAction(input.action);
  assertSafeSource(input.sourceMarkdown);
  assertQueryResult(input.result, definition);
  if (input.result.model.queryId !== input.action.queryId) reject("The action query ID does not match the query result");
  if (!sourceMatchesScope(input.action.sourcePath, definition.source)) reject("The action source path is outside the data-view definition");
  if (input.action.kind === "move-card" && (definition.view !== "kanban" || definition.groupBy !== input.action.field)) {
    reject("A move-card action must target the Kanban group field");
  }
  const sourceSha256 = sha256Text(input.sourceMarkdown);
  if (sourceSha256 !== input.result.sourceLocks[input.action.sourcePath]) {
    reject("The source Markdown does not match the query snapshot lock");
  }

  const row = input.result.model.rows.find((candidate) => candidate.source.path === input.action.sourcePath);
  if (!row) reject("The action targets an unknown source row");
  const displayed = row.values[input.action.field];
  if (!displayed || displayed.state !== "known" || displayed.value === undefined) {
    reject(`The action targets an unknown field: ${input.action.field}`);
  }
  const property = findFrontmatterProperty(input.sourceMarkdown, input.action.field);
  if (!property) reject(`The action field ${input.action.field} has no source range`);
  if (canonicalJson(property.value) !== canonicalJson(displayed.value)) {
    reject("The source value changed after the query snapshot was created");
  }

  const replacement = serializePropertyValue(input.action.value);
  if (typeof replacement === "string" && SECRET_PATTERN.test(replacement)) reject("The replacement value is secret-bearing");
  const afterMarkdown = input.sourceMarkdown.slice(0, property.start) + replacement + input.sourceMarkdown.slice(property.end);
  const warnings = input.result.model.diagnostics
    .filter((diagnostic) => diagnostic.severity !== "info")
    .map((diagnostic) => diagnostic.message);
  warnings.forEach((warning, index) => assertSafeText(warning, `DataViewEditPlan.warnings[${index}]`));
  const afterSha256 = sha256Text(afterMarkdown);
  const payload: Omit<DataViewEditPlan, "fingerprint"> = {
    schemaVersion: 1,
    source: { path: input.action.sourcePath, sha256: sourceSha256 },
    preview: {
      before: { sourceMarkdown: input.sourceMarkdown, sourceSha256 },
      after: { sourceMarkdown: afterMarkdown, sourceSha256: afterSha256 },
    },
    affectedPaths: [input.action.sourcePath],
    provenance: {
      actor: input.action.actor,
      origin: "assistant",
      queryId: input.action.queryId,
      view: definition.view,
      actionKind: input.action.kind,
      sourcePath: input.action.sourcePath,
      field: input.action.field,
      range: { start: property.start, end: property.end },
      ...(input.action.kind === "move-card" ? { groupBy: definition.groupBy } : {}),
    },
    warnings,
  };
  return deepFreeze({ ...payload, fingerprint: canonicalDigest(payload) });
}

export function assertDataViewEditPlan(value: unknown): asserts value is DataViewEditPlan {
  const plan = record(value, "DataViewEditPlan");
  exactFields(plan, ["schemaVersion", "source", "preview", "affectedPaths", "provenance", "warnings", "fingerprint"], "DataViewEditPlan");
  if (plan.schemaVersion !== 1) reject("DataViewEditPlan.schemaVersion must be 1");
  const source = record(plan.source, "DataViewEditPlan.source");
  exactFields(source, ["path", "sha256"], "DataViewEditPlan.source");
  parseVaultRelativePath(source.path, "DataViewEditPlan.source.path");
  digest(source.sha256, "DataViewEditPlan.source.sha256");
  const preview = record(plan.preview, "DataViewEditPlan.preview");
  exactFields(preview, ["before", "after"], "DataViewEditPlan.preview");
  const before = snapshot(preview.before, "DataViewEditPlan.preview.before");
  const after = snapshot(preview.after, "DataViewEditPlan.preview.after");
  if (before.sourceSha256 !== sha256Text(before.sourceMarkdown)) reject("DataViewEditPlan before snapshot hash does not match");
  assertSafeSource(before.sourceMarkdown);
  assertSafeSource(after.sourceMarkdown);
  if (source.sha256 !== before.sourceSha256) reject("DataViewEditPlan source lock must match its before snapshot");
  if (after.sourceSha256 !== sha256Text(after.sourceMarkdown)) reject("DataViewEditPlan after snapshot hash does not match");
  const affectedPaths = stringArray(plan.affectedPaths, "DataViewEditPlan.affectedPaths");
  if (affectedPaths.length !== 1 || affectedPaths[0] !== source.path) reject("DataViewEditPlan must lock exactly one source path");
  const provenance = record(plan.provenance, "DataViewEditPlan.provenance");
  exactFieldsOptional(provenance, ["actor", "origin", "queryId", "view", "actionKind", "sourcePath", "field", "range"], ["groupBy"], "DataViewEditPlan.provenance");
  actor(provenance.actor, "DataViewEditPlan.provenance.actor");
  if (provenance.origin !== "assistant" && provenance.origin !== "user" && provenance.origin !== "import") reject("DataViewEditPlan.provenance.origin is invalid");
  nonEmpty(provenance.queryId, "DataViewEditPlan.provenance.queryId");
  if (provenance.view !== "table" && provenance.view !== "kanban") reject("DataViewEditPlan.provenance.view is invalid");
  if (provenance.actionKind !== "edit-property" && provenance.actionKind !== "move-card") reject("DataViewEditPlan.provenance.actionKind is invalid");
  if (provenance.actionKind === "move-card" && (provenance.view !== "kanban" || typeof provenance.groupBy !== "string" || provenance.groupBy !== provenance.field)) reject("DataViewEditPlan move-card provenance is invalid");
  parseVaultRelativePath(provenance.sourcePath, "DataViewEditPlan.provenance.sourcePath");
  if (provenance.sourcePath !== source.path) reject("DataViewEditPlan provenance source path does not match source");
  nonEmpty(provenance.field, "DataViewEditPlan.provenance.field");
  const range = record(provenance.range, "DataViewEditPlan.provenance.range");
  exactFields(range, ["start", "end"], "DataViewEditPlan.provenance.range");
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end <= range.start || range.end > before.sourceMarkdown.length) reject("DataViewEditPlan.provenance.range is invalid");
  const recordedProperty = findFrontmatterProperty(before.sourceMarkdown, provenance.field);
  if (!recordedProperty || recordedProperty.start !== range.start || recordedProperty.end !== range.end) reject("DataViewEditPlan range does not identify its declared frontmatter field");
  const unchangedSuffix = before.sourceMarkdown.slice(range.end);
  if (before.sourceMarkdown.slice(0, range.start) !== after.sourceMarkdown.slice(0, range.start) || (unchangedSuffix.length > 0 && !after.sourceMarkdown.endsWith(unchangedSuffix)) || after.sourceMarkdown.length < range.start + unchangedSuffix.length || before.sourceMarkdown.slice(range.start, range.end) === after.sourceMarkdown.slice(range.start, after.sourceMarkdown.length - unchangedSuffix.length)) reject("DataViewEditPlan must change only its recorded source range");
  const replacement = after.sourceMarkdown.slice(range.start, after.sourceMarkdown.length - unchangedSuffix.length);
  if (/[\r\n]/u.test(replacement) || parsePropertyValue(replacement) === undefined) reject("DataViewEditPlan replacement is not a single frontmatter value");
  const warnings = stringArray(plan.warnings, "DataViewEditPlan.warnings");
  warnings.forEach((warning, index) => assertSafeText(warning, `DataViewEditPlan.warnings[${index}]`));
  digest(plan.fingerprint, "DataViewEditPlan.fingerprint");
  const payload = { schemaVersion: 1 as const, source, preview: { before, after }, affectedPaths, provenance, warnings };
  if (plan.fingerprint !== canonicalDigest(payload)) reject("DataViewEditPlan fingerprint does not match");
}

export function dataViewEditPlanFingerprint(value: unknown): `sha256:${string}` {
  assertDataViewEditPlan(value);
  return value.fingerprint;
}

function assertQueryResult(result: DataViewQueryResult, definition: DataViewDefinitionV1): void {
  const candidate = record(result, "DataViewQueryResult");
  exactFields(candidate, ["model", "sourceLocks", "fingerprint"], "DataViewQueryResult");
  const model = record(candidate.model, "DataViewQueryResult.model");
  exactFields(model, ["schemaVersion", "queryId", "view", "columns", "rows", "groups", "diagnostics"], "DataViewQueryResult.model");
  if (model.schemaVersion !== 1) reject("DataViewQueryResult.model.schemaVersion must be 1");
  if (model.queryId !== canonicalDigest(definition)) reject("The data-view query result query ID is invalid");
  if (model.view !== definition.view) reject("The data-view query result view is invalid");
  if (!Array.isArray(model.columns) || !Array.isArray(model.rows) || !Array.isArray(model.groups) || !Array.isArray(model.diagnostics)) reject("DataViewQueryResult model arrays are invalid");
  if (model.columns.length !== definition.select.length) reject("DataViewQueryResult columns do not match the definition");
  model.columns.forEach((column, index) => {
    const value = record(column, `DataViewQueryResult.model.columns[${index}]`);
    exactFields(value, ["field", "label"], `DataViewQueryResult.model.columns[${index}]`);
    if (value.field !== definition.select[index]!.field || value.label !== definition.select[index]!.label) reject("DataViewQueryResult columns do not match the definition");
  });
  const sourceLocks = record(candidate.sourceLocks, "DataViewQueryResult.sourceLocks");
  for (const [path, lock] of Object.entries(sourceLocks)) {
    parseVaultRelativePath(path, "DataViewQueryResult.sourceLocks path");
    digest(lock, `DataViewQueryResult.sourceLocks.${path}`);
  }
  const allowedFields = new Set([
    ...definition.select.map((column) => column.field),
    ...(definition.groupBy === undefined ? [] : [definition.groupBy]),
    ...(definition.orderBy ?? []).map((order) => order.field),
  ]);
  const rowIds = new Set<string>();
  const rowPaths = new Set<string>();
  for (const [index, rowCandidate] of model.rows.entries()) {
    const row = record(rowCandidate, `DataViewQueryResult.model.rows[${index}]`);
    exactFields(row, ["id", "source", "values"], `DataViewQueryResult.model.rows[${index}]`);
    const rowSource = record(row.source, `DataViewQueryResult.model.rows[${index}].source`);
    exactFieldsOptional(rowSource, ["path"], ["blockId"], `DataViewQueryResult.model.rows[${index}].source`);
    parseVaultRelativePath(rowSource.path, `DataViewQueryResult.model.rows[${index}].source.path`);
    if (row.id !== `source:${rowSource.path}` || !sourceMatchesScope(rowSource.path, definition.source) || !(rowSource.path in sourceLocks)) reject("DataViewQueryResult contains an invalid row source");
    if (rowIds.has(row.id)) reject("DataViewQueryResult contains duplicate row IDs");
    rowIds.add(row.id);
    rowPaths.add(rowSource.path);
    const values = record(row.values, `DataViewQueryResult.model.rows[${index}].values`);
    for (const [field, valueCandidate] of Object.entries(values)) {
      if (!allowedFields.has(field)) reject(`DataViewQueryResult contains an undeclared field: ${field}`);
      validateValue(valueCandidate, `DataViewQueryResult.model.rows[${index}].values.${field}`, rowSource.path);
    }
  }
  for (const path of Object.keys(sourceLocks)) if (!rowPaths.has(path)) reject("DataViewQueryResult contains an unused source lock");
  for (const groupCandidate of model.groups) {
    const group = record(groupCandidate, "DataViewQueryResult.model.group");
    exactFields(group, ["id", "label", "rowIds"], "DataViewQueryResult.model.group");
    nonEmpty(group.id, "DataViewQueryResult.model.group.id");
    nonEmpty(group.label, "DataViewQueryResult.model.group.label");
    if (!Array.isArray(group.rowIds) || group.rowIds.some((id) => !rowIds.has(id))) reject("DataViewQueryResult group contains an unknown row");
  }
  for (const diagnosticCandidate of model.diagnostics) {
    const diagnostic = record(diagnosticCandidate, "DataViewQueryResult.model.diagnostic");
    exactFieldsOptional(diagnostic, ["code", "severity", "message"], ["sourcePath", "field"], "DataViewQueryResult.model.diagnostic");
    nonEmpty(diagnostic.code, "DataViewQueryResult.model.diagnostic.code");
    if (diagnostic.severity !== "info" && diagnostic.severity !== "warning" && diagnostic.severity !== "error") reject("DataViewQueryResult diagnostic severity is invalid");
    nonEmpty(diagnostic.message, "DataViewQueryResult.model.diagnostic.message");
  }
  digest(candidate.fingerprint, "DataViewQueryResult.fingerprint");
  if (candidate.fingerprint !== canonicalDigest({ model, sourceLocks })) reject("The data-view query result fingerprint is invalid");
}

function validateValue(value: unknown, context: string, rowPath: string): void {
  const candidate = record(value, context);
  exactFieldsOptional(candidate, ["state", "source"], ["value"], context);
  if (candidate.state !== "known" && candidate.state !== "unknown") reject(`${context}.state is invalid`);
  if ("value" in candidate && !isScalarOrScalarArray(candidate.value)) reject(`${context}.value is invalid`);
  const source = record(candidate.source, `${context}.source`);
  exactFieldsOptional(source, ["path"], ["field", "start", "end", "blockId"], `${context}.source`);
  parseVaultRelativePath(source.path, `${context}.source.path`);
  if (source.path !== rowPath) reject(`${context}.source.path does not match its row`);
  if (source.field !== undefined) nonEmpty(source.field, `${context}.source.field`);
  for (const key of ["start", "end"]) {
    if (source[key] !== undefined && (!Number.isInteger(source[key]) || source[key] < 0)) reject(`${context}.source.${key} is invalid`);
  }
  if (source.start !== undefined && source.end !== undefined && source.end < source.start) reject(`${context}.source range is invalid`);
  if (source.blockId !== undefined) nonEmpty(source.blockId, `${context}.source.blockId`);
}

function validateAction(action: DataViewActionRequestV1): void {
  const value = record(action, "Data-view action");
  exactFields(value, ["schemaVersion", "kind", "queryId", "sourcePath", "field", "value", "actor"], "Data-view action");
  if (action.schemaVersion !== 1) reject("Data-view action schemaVersion must be 1");
  if (action.kind !== "edit-property" && action.kind !== "move-card") reject("Data-view action kind is invalid");
  nonEmpty(action.queryId, "Data-view action query ID");
  parseVaultRelativePath(action.sourcePath, "Data-view action source path");
  nonEmpty(action.field, "Data-view action field");
  if (!isScalarOrScalarArray(action.value)) reject("Data-view action value must be JSON scalar or scalar array");
  actor(action.actor, "Data-view action actor");
}

function findFrontmatterProperty(source: string, field: string): PropertyRange | null {
  const lines = sourceLines(source);
  const first = lines[0];
  if (!first || first.content.replace(/^\uFEFF/u, "") !== "---") return null;
  const key = field.startsWith("frontmatter.") ? field.slice("frontmatter.".length) : field;
  let found: PropertyRange | null = null;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.content === "---") return found;
    const match = /^([A-Za-z0-9_-]+):([ \t]*)(.*)$/u.exec(line.content);
    if (!match || match[1] !== key) continue;
    if (found) reject(`The action field ${field} has an ambiguous source range`);
    const raw = match[3]!;
    const valueText = stripInlineComment(match[3]!);
    const value = parsePropertyValue(valueText);
    if (value === undefined) return null;
    const valueStart = line.start + match[1]!.length + 1 + match[2]!.length;
    found = { value, start: valueStart, end: valueStart + valueText.length };
  }
  return null;
}

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (let index = 0; index <= source.length; index += 1) {
    if (index < source.length && source[index] !== "\r" && source[index] !== "\n") continue;
    lines.push({ content: source.slice(start, index), start });
    if (source[index] === "\r" && source[index + 1] === "\n") index += 1;
    start = index + 1;
  }
  return lines;
}
function stripInlineComment(raw: string): string {
  let quote: "'" | "\"" | null = null;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]!;
    if ((character === "'" || character === "\"") && (index === 0 || raw[index - 1] !== "\\")) {
      quote = quote === character ? null : quote ?? character;
    } else if (character === "#" && quote === null && index > 0 && /\s/u.test(raw[index - 1]!)) {
      return raw.slice(0, index).trimEnd();
    }
  }
  return raw.trimEnd();
}

function parsePropertyValue(raw: string): DataViewScalar | DataViewScalar[] | undefined {
  const value = raw.trim();
  if (value.length === 0) return undefined;
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) return Number(value);
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      const parsed: unknown = JSON.parse(value);
      return isScalarOrScalarArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isScalarOrScalarArray(parsed)) return parsed;
    } catch {
      const items = value.slice(1, -1).split(",").map((item) => parsePropertyValue(item.trim()));
      if (items.every((item) => item !== undefined)) return items as DataViewScalar[];
    }
    return undefined;
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

function serializePropertyValue(value: DataViewScalar | DataViewScalar[]): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (value === null) return "null";
  if (typeof value === "string") return /^[A-Za-z0-9 _./-]+$/u.test(value) ? value : JSON.stringify(value);
  return String(value);
}

function isScalarOrScalarArray(value: unknown): value is DataViewScalar | DataViewScalar[] {
  if (Array.isArray(value)) return value.every((item) => !Array.isArray(item) && isScalarOrScalarArray(item));
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function sourceMatchesScope(path: string, scope: DataViewDefinitionV1["source"]): boolean {
  if (scope.kind === "file") return path === scope.path;
  if (scope.kind === "files") return scope.paths !== undefined && scope.paths.includes(path);
  return scope.path !== undefined && (path === scope.path || path.startsWith(`${scope.path}/`));
}

function snapshot(value: unknown, context: string): { sourceMarkdown: string; sourceSha256: `sha256:${string}` } {
  const candidate = record(value, context);
  exactFields(candidate, ["sourceMarkdown", "sourceSha256"], context);
  if (typeof candidate.sourceMarkdown !== "string") reject(`${context}.sourceMarkdown must be a string`);
  digest(candidate.sourceSha256, `${context}.sourceSha256`);
  return { sourceMarkdown: candidate.sourceMarkdown, sourceSha256: candidate.sourceSha256 as `sha256:${string}` };
}

function record(value: unknown, context: string): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject(`${context} must be an object`);
  return value as Record<string, any>;
}

function exactFields(value: Record<string, any>, required: readonly string[], context: string): void {
  const allowed = new Set(required);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !(key in value));
  if (unknown.length > 0) reject(`${context} has unknown fields: ${unknown.join(", ")}`);
  if (missing.length > 0) reject(`${context} is missing fields: ${missing.join(", ")}`);
}
function exactFieldsOptional(value: Record<string, any>, required: readonly string[], optional: readonly string[], context: string): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !(key in value));
  if (unknown.length > 0) reject(`${context} has unknown fields: ${unknown.join(", ")}`);
  if (missing.length > 0) reject(`${context} is missing fields: ${missing.join(", ")}`);
}

function nonEmpty(value: unknown, context: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || /[\r\n]/u.test(value)) reject(`${context} must be a non-empty single-line string`);
}

function actor(value: unknown, context: string): asserts value is string {
  nonEmpty(value, context);
  if (value.length > 512 || SECRET_PATTERN.test(value)) reject(`${context} is invalid or secret-bearing`);
}

function stringArray(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) reject(`${context} must be an array`);
  return value.map((item, index) => {
    nonEmpty(item, `${context}[${index}]`);
    return item;
  });
}

function digest(value: unknown, context: string): asserts value is `sha256:${string}` {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) reject(`${context} must be a sha256 digest`);
}

function assertSafeSource(source: string): void {
  assertSafeText(source, "Data-view source snapshot");
}

function assertSafeText(value: string, context: string): void {
  if (SECRET_PATTERN.test(value)) reject(`${context} is secret-bearing`);
}
function reject(message: string): never {
  throw new VisualWorkspaceError("INVALID_CONTRACT", message);
}
