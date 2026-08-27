import { VisualWorkspaceError } from "./errors.js";
import type {
  DataViewDefinitionV1,
  DataViewPredicateV1,
  DataViewScalar,
} from "./data-view-types.js";

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:/u;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const SECRET_PATTERN = /(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|authorization|password|secret[_-]?key|\btoken\b|bearer\s+[A-Za-z0-9._-]+|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9][A-Za-z0-9_-]{7,})/iu;

function fail(message: string): never {
  throw new VisualWorkspaceError("INVALID_CONTRACT", message);
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(`${context} must be an object`);
  return value as Record<string, unknown>;
}

function exactFields(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], context: string): void {
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  const missing = required.filter((key) => !(key in value));
  if (unknown.length > 0) fail(`${context} has unknown fields: ${unknown.join(", ")}`);
  if (missing.length > 0) fail(`${context} is missing fields: ${missing.join(", ")}`);
}

function text(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) return fail(`${context} must be a non-empty string`);
  if (/[\r\n]/u.test(value)) return fail(`${context} must not contain a newline`);
  return value;
}

function vaultRelativePath(value: unknown, context: string): string {
  const candidate = text(value, context);
  if (
    candidate.length > 4096
    || candidate.startsWith("/")
    || candidate.startsWith("\\")
    || WINDOWS_DRIVE_PATH.test(candidate)
    || URI_SCHEME.test(candidate)
    || candidate.includes("\\")
    || candidate.includes("\u0000")
    || candidate.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return fail(`${context} must be a normalized vault-relative path`);
  }
  return candidate;
}

function scalar(value: unknown, context: string): DataViewScalar {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fail(`${context} must be a JSON scalar`);
}

function scalarOrArray(value: unknown, context: string): DataViewScalar | DataViewScalar[] {
  if (Array.isArray(value)) return value.map((item, index) => scalar(item, `${context}[${index}]`));
  return scalar(value, context);
}

function parsePredicate(value: unknown, context = "where"): DataViewPredicateV1 {
  const candidate = record(value, context);
  if (candidate.kind === "and" || candidate.kind === "or") {
    exactFields(candidate, ["kind", "predicates"], [], context);
    if (!Array.isArray(candidate.predicates) || candidate.predicates.length === 0) {
      return fail(`${context}.predicates must be a non-empty array`);
    }
    return {
      kind: candidate.kind,
      predicates: candidate.predicates.map((item, index) => parsePredicate(item, `${context}.predicates[${index}]`)),
    };
  }
  exactFields(candidate, ["kind", "field", "operator"], ["value"], context);
  if (candidate.kind !== "field") return fail(`${context}.kind must be field, and, or`);
  const operator = candidate.operator;
  if (operator !== "equals" && operator !== "in" && operator !== "exists" && operator !== "contains") {
    return fail(`${context}.operator is invalid`);
  }
  return {
    kind: "field",
    field: text(candidate.field, `${context}.field`),
    operator,
    ...(candidate.value === undefined ? {} : { value: scalarOrArray(candidate.value, `${context}.value`) }),
  };
}

function assertNoSecrets(value: unknown, context = "definition", seen = new WeakSet<object>()): void {
  if (typeof value === "string") {
    if (SECRET_PATTERN.test(value)) return fail(`${context} contains a secret-bearing value`);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return fail(`${context} must be JSON-serializable without cycles`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${context}[${index}]`, seen));
  } else {
    Object.entries(value).forEach(([key, child]) => assertNoSecrets(child, `${context}.${key}`, seen));
  }
  seen.delete(value);
}

export function validateDataViewDefinition(value: unknown): DataViewDefinitionV1 {
  assertNoSecrets(value);
  const candidate = record(value, "data-view definition");
  exactFields(
    candidate,
    ["schemaVersion", "id", "title", "view", "source", "select"],
    ["where", "groupBy", "groupOrder", "orderBy"],
    "data-view definition",
  );
  if (candidate.schemaVersion !== 1) return fail("data-view definition schemaVersion must be 1");
  const id = text(candidate.id, "data-view definition.id");
  const title = text(candidate.title, "data-view definition.title");
  if (candidate.view !== "table" && candidate.view !== "kanban") return fail("data-view definition.view must be table or kanban");
  if (candidate.view === "kanban" && candidate.groupBy === undefined) return fail("data-view definition.groupBy is required for kanban views");

  const sourceCandidate = record(candidate.source, "data-view definition.source");
  let source: DataViewDefinitionV1["source"];
  if (sourceCandidate.kind === "file" || sourceCandidate.kind === "folder") {
    exactFields(sourceCandidate, ["kind", "path"], [], "data-view definition.source");
    source = { kind: sourceCandidate.kind, path: vaultRelativePath(sourceCandidate.path, "data-view definition.source.path") };
  } else if (sourceCandidate.kind === "files") {
    exactFields(sourceCandidate, ["kind", "paths"], [], "data-view definition.source");
    if (!Array.isArray(sourceCandidate.paths) || sourceCandidate.paths.length === 0) return fail("data-view definition.source.paths must be a non-empty array");
    source = {
      kind: "files",
      paths: sourceCandidate.paths.map((path, index) => vaultRelativePath(path, `data-view definition.source.paths[${index}]`)),
    };
  } else {
    return fail("data-view definition.source.kind is invalid");
  }

  if (!Array.isArray(candidate.select) || candidate.select.length === 0) return fail("data-view definition.select must be a non-empty array");
  const select = candidate.select.map((item, index) => {
    const field = record(item, `data-view definition.select[${index}]`);
    exactFields(field, ["field", "label"], [], `data-view definition.select[${index}]`);
    return {
      field: text(field.field, `data-view definition.select[${index}].field`),
      label: text(field.label, `data-view definition.select[${index}].label`),
    };
  });

  const result: DataViewDefinitionV1 = { schemaVersion: 1, id, title, view: candidate.view, source, select };
  if (candidate.where !== undefined) result.where = parsePredicate(candidate.where);
  if (candidate.groupBy !== undefined) result.groupBy = text(candidate.groupBy, "data-view definition.groupBy");
  if (candidate.groupOrder !== undefined) {
    if (!Array.isArray(candidate.groupOrder)) return fail("data-view definition.groupOrder must be an array");
    result.groupOrder = candidate.groupOrder.map((item, index) => text(item, `data-view definition.groupOrder[${index}]`));
  }
  if (candidate.orderBy !== undefined) {
    if (!Array.isArray(candidate.orderBy)) return fail("data-view definition.orderBy must be an array");
    result.orderBy = candidate.orderBy.map((item, index) => {
      const order = record(item, `data-view definition.orderBy[${index}]`);
      exactFields(order, ["field", "direction"], [], `data-view definition.orderBy[${index}]`);
      if (order.direction !== "asc" && order.direction !== "desc") return fail(`data-view definition.orderBy[${index}].direction is invalid`);
      return {
        field: text(order.field, `data-view definition.orderBy[${index}].field`),
        direction: order.direction,
      };
    });
  }
  return result;
}
