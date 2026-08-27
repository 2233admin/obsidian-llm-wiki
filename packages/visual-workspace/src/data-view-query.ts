import { canonicalDigest, canonicalJson } from "./canonical.js";
import type {
  DataViewDefinitionV1,
  DataViewPredicateV1,
  DataViewQueryInput,
  DataViewQueryResult,
  DataViewScalar,
  DataViewSourceBlock,
  DataViewSourceBlockEntry,
  DataViewValueV1,
} from "./data-view-types.js";
import { validateDataViewDefinition } from "./data-view-validation.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:/u;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

type Diagnostic = DataViewQueryResult["model"]["diagnostics"][number];
type ResolvedValue = DataViewValueV1;
type Truth = "true" | "false" | "unknown";

export function executeDataViewQuery(input: DataViewQueryInput): DataViewQueryResult {
  const definition = validateDataViewDefinition(input.definition);
  const diagnostics: Diagnostic[] = [];
  const scopedSources: DataViewSourceBlock[] = [];
  const seenPaths = new Set<string>();

  for (const candidate of input.sources) {
    const source = validateSourceSnapshot(candidate, diagnostics);
    if (!source || !sourceMatchesScope(source.path, definition.source)) continue;
    if (seenPaths.has(source.path)) {
      diagnostics.push({
        code: "DUPLICATE_SOURCE",
        severity: "warning",
        message: `Duplicate source path ${source.path} was ignored`,
        sourcePath: source.path,
      });
      continue;
    }
    seenPaths.add(source.path);
    scopedSources.push(source);
  }

  const rows = scopedSources
    .map((source) => buildRow(source, definition, diagnostics))
    .filter((row) => row !== null);
  sortRows(rows, definition, diagnostics);
  const groups = buildGroups(rows, definition, diagnostics);
  const model: DataViewQueryResult["model"] = {
    schemaVersion: 1,
    queryId: canonicalDigest(definition),
    view: definition.view,
    columns: definition.select.map((column) => ({ ...column })),
    rows,
    groups,
    diagnostics,
  };
  return { model, fingerprint: canonicalDigest(model) };
}

function buildRow(
  source: DataViewSourceBlock,
  definition: DataViewDefinitionV1,
  diagnostics: Diagnostic[],
): DataViewQueryResult["model"]["rows"][number] | null {
  const values: Record<string, ResolvedValue> = {};
  for (const column of definition.select) {
    values[column.field] = resolveField(source, column.field, diagnostics);
  }
  if (definition.where !== undefined && evaluatePredicate(definition.where, source, diagnostics) !== "true") return null;
  return { id: `source:${source.path}`, source: { path: source.path }, values };
}

function resolveField(source: DataViewSourceBlock, field: string, diagnostics: Diagnostic[]): ResolvedValue {
  if (field === "title") return known(source.path, field, source.title);
  if (field === "path") return known(source.path, field, source.path);

  if (field.startsWith("block:")) {
    const blockId = field.slice("block:".length);
    const block = source.blocks.find((candidate) => candidate.id === blockId);
    if (block) return knownBlock(source.path, field, block);
    diagnostics.push({ code: "UNKNOWN_FIELD", severity: "info", message: `Field ${field} is missing`, sourcePath: source.path, field });
    return unknown(source.path, field);
  }

  const frontmatterField = field.startsWith("frontmatter.") ? field.slice("frontmatter.".length) : field;
  if (Object.prototype.hasOwnProperty.call(source.frontmatter, frontmatterField)) {
    const value = source.frontmatter[frontmatterField];
    if (isDataViewValue(value)) return known(source.path, field, value, frontmatterField);
    diagnostics.push({
      code: "UNSUPPORTED_FIELD_TYPE",
      severity: "warning",
      message: `Field ${field} has an unsupported value type`,
      sourcePath: source.path,
      field,
    });
    return unknown(source.path, field);
  }

  diagnostics.push({ code: "UNKNOWN_FIELD", severity: "info", message: `Field ${field} is missing`, sourcePath: source.path, field });
  return unknown(source.path, field);
}

function evaluatePredicate(
  predicate: DataViewPredicateV1,
  source: DataViewSourceBlock,
  diagnostics: Diagnostic[],
): Truth {
  if (predicate.kind === "and") {
    let result: Truth = "true";
    for (const child of predicate.predicates) {
      const childResult = evaluatePredicate(child, source, diagnostics);
      if (childResult === "false") return "false";
      if (childResult === "unknown") result = "unknown";
    }
    return result;
  }
  if (predicate.kind === "or") {
    let result: Truth = "false";
    for (const child of predicate.predicates) {
      const childResult = evaluatePredicate(child, source, diagnostics);
      if (childResult === "true") return "true";
      if (childResult === "unknown") result = "unknown";
    }
    return result;
  }
  if (predicate.kind !== "field") return "unknown";
  const resolved = resolveField(source, predicate.field, diagnostics);
  if (predicate.operator === "exists") return resolved.state === "known" ? "true" : "false";
  const expected = predicate.value;
  if (resolved.state !== "known" || resolved.value === undefined || expected === undefined) return "unknown";
  if (predicate.operator === "equals") return scalarEqual(resolved.value, expected) ? "true" : "false";
  if (predicate.operator === "in") return valueIn(resolved.value, expected) ? "true" : "false";
  return valueContains(resolved.value, expected) ? "true" : "false";
}

function sortRows(
  rows: DataViewQueryResult["model"]["rows"],
  definition: DataViewDefinitionV1,
  diagnostics: Diagnostic[],
): void {
  const orderBy = definition.orderBy ?? [];
  rows.sort((left, right) => {
    for (const order of orderBy) {
      const comparison = compareResolved(
        left.values[order.field] ?? unknown(left.source.path, order.field),
        right.values[order.field] ?? unknown(right.source.path, order.field),
      );
      if (comparison !== 0) return order.direction === "asc" ? comparison : -comparison;
    }
    return left.source.path < right.source.path ? -1 : left.source.path > right.source.path ? 1 : 0;
  });
  for (const order of orderBy) {
    if (!definition.select.some((column) => column.field === order.field)) {
      diagnostics.push({ code: "UNKNOWN_SORT_FIELD", severity: "warning", message: `Sort field ${order.field} is not selected`, field: order.field });
    }
  }
}

function buildGroups(
  rows: DataViewQueryResult["model"]["rows"],
  definition: DataViewDefinitionV1,
  diagnostics: Diagnostic[],
): DataViewQueryResult["model"]["groups"] {
  if (definition.groupBy === undefined) return [];
  const groups = new Map<string, DataViewQueryResult["model"]["groups"][number]>();
  for (const row of rows) {
    const value = row.values[definition.groupBy] ?? unknown(row.source.path, definition.groupBy);
    if (value.state !== "known" || Array.isArray(value.value) || value.value === null) {
      diagnostics.push({ code: "UNKNOWN_GROUP", severity: "info", message: `Group field ${definition.groupBy} is unknown`, sourcePath: row.source.path, field: definition.groupBy });
      continue;
    }
    const label = String(value.value);
    const group = groups.get(label) ?? { id: `group:${label}`, label, rowIds: [] };
    group.rowIds.push(row.id);
    groups.set(label, group);
  }
  const explicit = definition.groupOrder ?? [];
  return [...groups.values()].sort((left, right) => {
    const leftIndex = explicit.indexOf(left.label);
    const rightIndex = explicit.indexOf(right.label);
    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    }
    return left.label < right.label ? -1 : left.label > right.label ? 1 : 0;
  });
}

function compareResolved(left: ResolvedValue, right: ResolvedValue): number {
  if (left.state !== "known" || left.value === undefined) return right.state === "known" && right.value !== undefined ? 1 : 0;
  if (right.state !== "known" || right.value === undefined) return -1;
  const leftText = canonicalJson(left.value);
  const rightText = canonicalJson(right.value);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

function scalarEqual(left: DataViewScalar | DataViewScalar[], right: DataViewScalar | DataViewScalar[]): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function valueIn(value: DataViewScalar | DataViewScalar[], expected: DataViewScalar | DataViewScalar[]): boolean {
  const values = Array.isArray(value) ? value : [value];
  const expectedValues = Array.isArray(expected) ? expected : [expected];
  return values.some((candidate) => expectedValues.some((expectedValue) => scalarEqual(candidate, expectedValue)));
}

function valueContains(value: DataViewScalar | DataViewScalar[], expected: DataViewScalar | DataViewScalar[]): boolean {
  if (Array.isArray(value)) return valueIn(value, expected);
  if (typeof value !== "string") return false;
  if (Array.isArray(expected)) return expected.some((candidate) => typeof candidate === "string" && value.includes(candidate));
  return typeof expected === "string" && value.includes(expected);
}

function known(path: string, field: string, value: DataViewScalar | DataViewScalar[], sourceField = field): ResolvedValue {
  return { state: "known", value, source: { path, field: sourceField } };
}

function knownBlock(path: string, field: string, block: DataViewSourceBlockEntry): ResolvedValue {
  return {
    state: "known",
    value: block.text,
    source: { path, field, blockId: block.id, start: block.range.start, end: block.range.end },
  };
}

function unknown(path: string, field: string): ResolvedValue {
  return { state: "unknown", source: { path, field } };
}

function isDataViewValue(value: unknown): value is DataViewScalar | DataViewScalar[] {
  if (Array.isArray(value)) return value.every((item) => isDataViewValue(item) && !Array.isArray(item));
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}
function sourceMatchesScope(path: string, scope: DataViewDefinitionV1["source"]): boolean {
  if (scope.kind === "file") return path === scope.path;
  if (scope.kind === "files") return scope.paths !== undefined && scope.paths.includes(path);
  return scope.path !== undefined && (path === scope.path || path.startsWith(`${scope.path}/`));
}

function validateSourceSnapshot(candidate: unknown, diagnostics: Diagnostic[]): DataViewSourceBlock | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    diagnostics.push({ code: "INVALID_SOURCE", severity: "warning", message: "Source snapshot must be an object" });
    return null;
  }
  const source = candidate as Record<string, unknown>;
  const path = typeof source.path === "string" ? source.path : undefined;
  if (!path || !isVaultRelativePath(path) || typeof source.sha256 !== "string" || !SHA256.test(source.sha256) || typeof source.title !== "string" || source.title.length === 0 || !source.frontmatter || typeof source.frontmatter !== "object" || Array.isArray(source.frontmatter) || !Array.isArray(source.blocks)) {
    diagnostics.push({ code: "INVALID_SOURCE", severity: "warning", message: "Source snapshot is malformed", ...(path ? { sourcePath: path } : {}) });
    return null;
  }
  for (const block of source.blocks) {
    if (!isSourceBlock(block)) {
      diagnostics.push({ code: "INVALID_SOURCE", severity: "warning", message: "Source snapshot contains a malformed block", sourcePath: path });
      return null;
    }
  }
  return source as unknown as DataViewSourceBlock;
}

function isSourceBlock(value: unknown): value is DataViewSourceBlockEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const block = value as Record<string, unknown>;
  const range = block.range;
  if (!range || typeof range !== "object" || Array.isArray(range)) return false;
  const rangeValue = range as Record<string, unknown>;
  return (block.id === undefined || typeof block.id === "string")
    && typeof block.text === "string"
    && ["start", "end", "startLine", "endLine"].every((key) => Number.isInteger(rangeValue[key]) && Number(rangeValue[key]) >= 0)
    && Number(rangeValue.start) <= Number(rangeValue.end)
    && Number(rangeValue.startLine) <= Number(rangeValue.endLine);
}

function isVaultRelativePath(path: string): boolean {
  return path.length > 0
    && path.length <= 4096
    && !path.startsWith("/")
    && !path.startsWith("\\")
    && !WINDOWS_DRIVE_PATH.test(path)
    && !URI_SCHEME.test(path)
    && !path.includes("\\")
    && !path.includes("\u0000")
    && !path.split("/").some((segment) => segment === "" || segment === "." || segment === "..");
}
