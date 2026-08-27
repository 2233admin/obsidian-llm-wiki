import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AGENT_WIKI_CONTRACT_VERSION,
  CAPABILITY_NAMES,
  DIAGNOSTIC_CODES,
  EVIDENCE_TIERS,
  FRESHNESS_STATES,
  PROVIDER_IDS,
} from "../src/index.js";

const SCHEMA_NAMES = [
  "toolchain-capability-profile",
  "ingest-run",
  "contribution-manifest",
  "maintenance-queue-entry",
  "execution-receipt",
  "embedding-fingerprint",
  "query-trace",
  "data-view-definition",
  "data-view-model",
  "data-view-action-request",
  "data-view-import-plan",
] as const;

function json(relative: string): Record<string, unknown> {
  const path = fileURLToPath(new URL(relative, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function object(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  for (const key of Object.keys(value)) assert.ok(keys.includes(key), `${label} has unknown field ${key}`);
}

function path(value: unknown, label: string): void {
  assert.equal(typeof value, "string");
  assert.match(value as string, /^(?!\/)(?![A-Za-z]:)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*(?:^|\/)\.\.(?:\/|$))[^\u0000\\]+$/u, label);
}

function scalar(value: unknown, label: string): void {
  assert.ok(value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean", `${label} must be scalar`);
}

function nonEmptyString(value: unknown, label: string): void {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok((value as string).length > 0, `${label} must not be empty`);
}

function validateDataView(name: string, input: Record<string, unknown>): void {
  const rootKeys: Record<string, readonly string[]> = {
    "data-view-definition": ["schemaVersion", "id", "title", "view", "source", "select", "where", "groupBy", "groupOrder", "orderBy"],
    "data-view-model": ["schemaVersion", "queryId", "view", "columns", "rows", "groups", "diagnostics"],
    "data-view-action-request": ["schemaVersion", "kind", "queryId", "sourcePath", "field", "value", "actor"],
    "data-view-import-plan": ["schemaVersion", "source", "targetRoot", "files", "selectedItemIds", "warnings", "provenance", "fingerprint"],
  };
  assert.equal(input.schemaVersion, 1);
  exactKeys(input, rootKeys[name]!, name);
  if (name === "data-view-definition") {
    assert.ok(input.id && input.title && (input.view === "table" || input.view === "kanban"));
    const source = object(input.source, "source");
    assert.ok(source.kind === "file" || source.kind === "folder" || source.kind === "files");
    exactKeys(source, source.kind === "files" ? ["kind", "paths"] : ["kind", "path"], "source");
    if (source.kind === "files") {
      assert.ok(Array.isArray(source.paths) && source.paths.length > 0);
      source.paths.forEach((item, i) => path(item, `source.paths[${i}]`));
    } else path(source.path, "source.path");
    assert.ok(Array.isArray(input.select));
    for (const item of input.select) { const field = object(item, "select item"); exactKeys(field, ["field", "label"], "select item"); assert.equal(typeof field.field, "string"); assert.equal(typeof field.label, "string"); assert.ok((field.field as string).length > 0 && (field.label as string).length > 0); }
    if (input.where !== undefined) validatePredicate(input.where);
    if (input.groupBy !== undefined) { assert.equal(typeof input.groupBy, "string"); assert.ok((input.groupBy as string).length > 0); }
    if (input.groupOrder !== undefined) { assert.ok(Array.isArray(input.groupOrder)); input.groupOrder.forEach((item, i) => { assert.equal(typeof item, "string"); assert.ok((item as string).length > 0, `groupOrder[${i}]`); }); }
    if (input.orderBy !== undefined) {
      assert.ok(Array.isArray(input.orderBy));
      for (const item of input.orderBy) { const order = object(item, "order"); exactKeys(order, ["field", "direction"], "order"); assert.equal(typeof order.field, "string"); assert.ok((order.field as string).length > 0); assert.ok(order.direction === "asc" || order.direction === "desc"); }
    }
  } else if (name === "data-view-model") {
    assert.ok(typeof input.queryId === "string" && input.queryId.length > 0 && (input.view === "table" || input.view === "kanban"));
    assert.ok(Array.isArray(input.columns) && Array.isArray(input.rows) && Array.isArray(input.groups) && Array.isArray(input.diagnostics));
    for (const item of input.columns) { const column = object(item, "column"); exactKeys(column, ["field", "label"], "column"); assert.equal(typeof column.field, "string"); assert.equal(typeof column.label, "string"); assert.ok((column.field as string).length > 0 && (column.label as string).length > 0); }
    for (const item of input.rows) { const row = object(item, "row"); exactKeys(row, ["id", "source", "values"], "row"); assert.equal(typeof row.id, "string"); assert.ok((row.id as string).length > 0); const source = object(row.source, "row.source"); exactKeys(source, ["path", "blockId"], "row.source"); path(source.path, "row.source.path"); if (source.blockId !== undefined) { assert.equal(typeof source.blockId, "string"); assert.ok((source.blockId as string).length > 0); } const values = object(row.values, "row.values"); for (const value of Object.values(values)) validateValue(value); }
    for (const item of input.groups) { const group = object(item, "group"); exactKeys(group, ["id", "label", "rowIds"], "group"); assert.equal(typeof group.id, "string"); assert.equal(typeof group.label, "string"); assert.ok((group.id as string).length > 0 && (group.label as string).length > 0 && Array.isArray(group.rowIds)); group.rowIds.forEach((id, i) => { assert.equal(typeof id, "string"); assert.ok((id as string).length > 0, `group.rowIds[${i}]`); }); }
    for (const item of input.diagnostics) { const diagnostic = object(item, "diagnostic"); exactKeys(diagnostic, ["code", "severity", "message", "sourcePath", "field"], "diagnostic"); assert.equal(typeof diagnostic.code, "string"); assert.equal(typeof diagnostic.message, "string"); assert.ok((diagnostic.code as string).length > 0 && (diagnostic.message as string).length > 0 && ["info", "warning", "error"].includes(String(diagnostic.severity))); if (diagnostic.sourcePath !== undefined) path(diagnostic.sourcePath, "diagnostic.sourcePath"); if (diagnostic.field !== undefined) { assert.equal(typeof diagnostic.field, "string"); assert.ok((diagnostic.field as string).length > 0); } }
  } else if (name === "data-view-action-request") {
    assert.ok(input.kind === "edit-property" || input.kind === "move-card"); nonEmptyString(input.queryId, "queryId"); path(input.sourcePath, "sourcePath"); nonEmptyString(input.field, "field"); scalarOrArray(input.value, "value"); nonEmptyString(input.actor, "actor");
  } else {
    const source = object(input.source, "import source"); exactKeys(source, ["name", "sha256"], "import source"); nonEmptyString(source.name, "source.name"); assert.ok(/^[a-f0-9]{64}$/u.test(String(source.sha256)));
    path(input.targetRoot, "targetRoot"); assert.ok(Array.isArray(input.files));
    for (const item of input.files) { const file = object(item, "file"); exactKeys(file, ["path", "beforeSha256", "before", "after", "afterSha256"], "file"); path(file.path, "file.path"); if (file.beforeSha256 !== undefined) assert.ok(/^[a-f0-9]{64}$/u.test(String(file.beforeSha256))); if (file.before !== undefined) assert.equal(typeof file.before, "string"); nonEmptyString(file.after, "file.after"); assert.ok(/^[a-f0-9]{64}$/u.test(String(file.afterSha256))); }
    assert.ok(Array.isArray(input.selectedItemIds) && Array.isArray(input.warnings)); input.selectedItemIds.forEach((id, i) => nonEmptyString(id, `selectedItemIds[${i}]`)); input.warnings.forEach((warning, i) => assert.equal(typeof warning, "string", `warnings[${i}]`)); const provenance = object(input.provenance, "provenance"); exactKeys(provenance, ["actor", "origin"], "provenance"); nonEmptyString(provenance.actor, "provenance.actor"); assert.equal(provenance.origin, "import"); nonEmptyString(input.fingerprint, "fingerprint");
  }
}

function scalarOrArray(value: unknown, label: string): void {
  if (Array.isArray(value)) value.forEach((item, i) => scalar(item, `${label}[${i}]`));
  else scalar(value, label);
}

function validatePredicate(value: unknown): void {
  const predicate = object(value, "predicate");
  if (predicate.kind === "and" || predicate.kind === "or") { exactKeys(predicate, ["kind", "predicates"], "predicate"); assert.ok(Array.isArray(predicate.predicates)); predicate.predicates.forEach(validatePredicate); }
  else { exactKeys(predicate, ["kind", "field", "operator", "value"], "predicate"); assert.equal(predicate.kind, "field"); nonEmptyString(predicate.field, "predicate.field"); assert.ok(["equals", "in", "exists", "contains"].includes(String(predicate.operator))); if (predicate.value !== undefined) scalarOrArray(predicate.value, "predicate.value"); }
}

function validateValue(value: unknown): void {
  const result = object(value, "value"); exactKeys(result, ["state", "value", "source"], "value"); assert.ok(result.state === "known" || result.state === "unknown"); if (result.value !== undefined) scalarOrArray(result.value, "value.value"); const source = object(result.source, "value.source"); exactKeys(source, ["path", "field", "start", "end", "blockId"], "value.source"); path(source.path, "value.source.path"); if (source.field !== undefined) { assert.equal(typeof source.field, "string"); assert.ok((source.field as string).length > 0); } for (const key of ["start", "end"]) if (source[key] !== undefined) { assert.equal(typeof source[key], "number"); assert.equal(Number.isInteger(source[key]), true); assert.ok((source[key] as number) >= 0); } if (source.blockId !== undefined) { assert.equal(typeof source.blockId, "string"); assert.ok((source.blockId as string).length > 0); }
}

function clone(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

describe("Agent Wiki shared contracts", () => {
  test("publishes each lifecycle contract under a stable versioned schema id", () => {
    const ids = new Set<string>();
    for (const name of SCHEMA_NAMES) {
      const schema = json(`../schemas/${name}.schema.json`);
      assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
      assert.equal(schema.$id, `https://schemas.llmwiki.org/agent-wiki/v1/${name}.schema.json`);
      assert.equal(ids.has(String(schema.$id)), false);
      ids.add(String(schema.$id));
      assert.equal(schema.type, "object");
      assert.equal(schema.additionalProperties, false);
    }
  });

  test("keeps normalized vocabulary identical in TypeScript, fixture, and common schema", () => {
    const fixture = json("../fixtures/v1/vocabulary.json");
    const common = json("../schemas/common.schema.json") as {
      $defs: Record<string, { enum?: string[] }>;
    };
    assert.equal(fixture.schemaVersion, AGENT_WIKI_CONTRACT_VERSION);
    assert.deepEqual(fixture.providerIds, PROVIDER_IDS);
    assert.deepEqual(fixture.diagnosticCodes, DIAGNOSTIC_CODES);
    assert.deepEqual(fixture.evidenceTiers, EVIDENCE_TIERS);
    assert.deepEqual(fixture.freshnessStates, FRESHNESS_STATES);
    assert.deepEqual(fixture.capabilityNames, CAPABILITY_NAMES);
    assert.deepEqual(common.$defs.providerId?.enum, PROVIDER_IDS);
    assert.deepEqual(common.$defs.diagnosticCode?.enum, DIAGNOSTIC_CODES);
    assert.deepEqual(common.$defs.evidenceTier?.enum, EVIDENCE_TIERS);
    assert.deepEqual(common.$defs.freshnessState?.enum, FRESHNESS_STATES);
    assert.deepEqual(common.$defs.capabilityName?.enum, CAPABILITY_NAMES);
    assert.deepEqual(CAPABILITY_NAMES, [...new Set(CAPABILITY_NAMES)].sort());
  });

  test("provides a serialization fixture satisfying every schema's required surface", () => {
    const fixture = json("../fixtures/v1/serialization-cases.json") as {
      schemaVersion: number;
      cases: Record<string, Record<string, unknown>>;
    };
    assert.equal(fixture.schemaVersion, AGENT_WIKI_CONTRACT_VERSION);
    const caseNames = [
      "toolchainCapabilityProfile",
      "ingestRun",
      "contributionManifest",
      "maintenanceQueueEntry",
      "executionReceipt",
      "embeddingFingerprint",
      "queryTrace",
    ];
    assert.equal(Object.keys(fixture.cases).length, caseNames.length);
    SCHEMA_NAMES.slice(0, 7).forEach((schemaName, index) => {
      const schema = json(`../schemas/${schemaName}.schema.json`) as {
        required: string[];
        properties: Record<string, unknown>;
      };
      const value = fixture.cases[caseNames[index]!]!;
      assert.equal(value.schemaVersion, AGENT_WIKI_CONTRACT_VERSION);
      for (const key of schema.required) assert.ok(key in value, `${caseNames[index]} requires ${key}`);
      for (const key of Object.keys(value)) assert.ok(key in schema.properties, `${caseNames[index]} declares ${key}`);
    });
  });

  test("validates data-view fixtures and rejects invalid wire states", () => {
    const fixtures = Object.fromEntries(SCHEMA_NAMES.slice(7).map((name) => [name, json(`../fixtures/v1/${name}.json`)]));
    for (const [name, fixture] of Object.entries(fixtures)) {
      const schema = json(`../schemas/${name}.schema.json`) as { required: string[]; properties: Record<string, unknown>; additionalProperties: boolean; $defs?: Record<string, { pattern?: string }> };
      assert.equal(schema.additionalProperties, false);
      for (const key of schema.required) assert.ok(key in fixture, `${name} requires ${key}`);
      if (schema.$defs?.path?.pattern !== undefined) assert.equal(schema.$defs.path.pattern, "^(?!/)(?![A-Za-z]:)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*(?:^|/)\\.\\.(?:/|$))[^\\u0000\\\\]+$");
      validateDataView(name, fixture);
    }
    const definition = clone(fixtures["data-view-definition"]!);
    const model = clone(fixtures["data-view-model"]!);
    const action = clone(fixtures["data-view-action-request"]!);
    const plan = clone(fixtures["data-view-import-plan"]!);
    assert.throws(() => validateDataView("data-view-definition", { ...definition, schemaVersion: undefined }));
    assert.throws(() => validateDataView("data-view-definition", { ...definition, extra: true }));
    const badSource = object(definition.source, "source"); assert.throws(() => validateDataView("data-view-definition", { ...definition, source: { ...badSource, kind: "url" } }));
    const badPredicate = { kind: "field", field: "status", operator: "matches", value: "x" }; assert.throws(() => validateDataView("data-view-definition", { ...definition, where: badPredicate }));
    assert.throws(() => validateDataView("data-view-definition", { ...definition, source: { ...badSource, path: "https://example.com/secret" } }));
    assert.throws(() => validateDataView("data-view-definition", { ...definition, source: { ...badSource, path: "/absolute/path" } }));
    assert.throws(() => validateDataView("data-view-definition", { ...definition, source: { ...badSource, path: "C:/absolute/path" } }));
    const row = object((model.rows as unknown[])[0], "row"); const rowSource = object(row.source, "row.source");
    assert.throws(() => validateDataView("data-view-model", { ...model, rows: [{ ...row, extra: true }] }));
    assert.throws(() => validateDataView("data-view-model", { ...model, rows: [{ ...row, source: { ...rowSource, path: "file://secret" } }] }));
    assert.throws(() => validateDataView("data-view-model", { ...model, rows: [{ ...row, source: { ...rowSource, path: "/absolute/path" } }] }));
    const value = object((row.values as Record<string, unknown>).status, "value");
    assert.throws(() => validateDataView("data-view-model", { ...model, rows: [{ ...row, values: { status: { ...value, state: "invalid" } } }] }));
    assert.throws(() => validateDataView("data-view-action-request", { ...action, sourcePath: "vault://secret" }));
    assert.throws(() => validateDataView("data-view-action-request", { ...action, sourcePath: "/absolute/path" }));
    assert.throws(() => validateDataView("data-view-import-plan", { ...plan, targetRoot: "https://example.com" }));
    assert.throws(() => validateDataView("data-view-import-plan", { ...plan, targetRoot: "/absolute/path" }));
    const file = object((plan.files as unknown[])[0], "file");
    assert.throws(() => validateDataView("data-view-import-plan", { ...plan, files: [{ ...file, path: "file://secret" }] }));
    assert.throws(() => validateDataView("data-view-import-plan", { ...plan, files: [{ ...file, path: "C:/absolute/path" }] }));
    assert.throws(() => validateDataView("data-view-model", { ...model, columns: [{ field: "", label: "Title" }] }));
    assert.throws(() => validateDataView("data-view-definition", { ...definition, where: { kind: "field", field: "", operator: "equals" } }));
    assert.throws(() => validateDataView("data-view-action-request", { ...action, queryId: "" }));
    assert.throws(() => validateDataView("data-view-action-request", { ...action, field: 42 }));
    assert.throws(() => validateDataView("data-view-action-request", { ...action, actor: "" }));
    assert.throws(() => validateDataView("data-view-import-plan", { ...plan, files: [{ ...file, beforeSha256: "bad" }] }));
    assert.throws(() => validateDataView("data-view-import-plan", { ...plan, selectedItemIds: [""] }));
    assert.throws(() => validateDataView("data-view-import-plan", { ...plan, warnings: [42] }));
    assert.throws(() => validateDataView("data-view-import-plan", { ...plan, provenance: { actor: "", origin: "import" } }));
  });

  test("fixtures never serialize credential material or raw machine paths", () => {
    const serialized = JSON.stringify(json("../fixtures/v1/serialization-cases.json")) + JSON.stringify(json("../fixtures/v1/data-view-import-plan.json"));
    assert.doesNotMatch(serialized, /(?:api[_-]?key|bearer |password|sk-[a-z0-9]|[a-z]:\\\\users\\)/i);
  });
});
