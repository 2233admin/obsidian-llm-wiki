import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { validateDataViewDefinition } from "../src/index.js";

const definition = {
  schemaVersion: 1,
  id: "projects-table",
  title: "Projects",
  view: "table",
  source: { kind: "folder", path: "Projects" },
  select: [{ field: "title", label: "Title" }],
};

describe("data-view definition validation", () => {
  test("returns a validated definition without changing its JSON shape", () => {
    assert.deepEqual(validateDataViewDefinition(definition), definition);
  });

  test("rejects invalid root, source, field, predicate, and sort values", () => {
    assert.throws(() => validateDataViewDefinition({ ...definition, schemaVersion: 2 }), /schemaVersion/);
    assert.throws(() => validateDataViewDefinition({ ...definition, id: "" }), /id/);
    assert.throws(() => validateDataViewDefinition({ ...definition, source: { kind: "file", path: "../secret" } }), /vault-relative path/);
    assert.throws(() => validateDataViewDefinition({ ...definition, source: { kind: "files", paths: [] } }), /paths/);
    assert.throws(() => validateDataViewDefinition({ ...definition, select: [{ field: "", label: "Title" }] }), /field/);
    assert.throws(() => validateDataViewDefinition({ ...definition, where: { kind: "field", field: "status", operator: "matches" } }), /operator/);
    assert.throws(() => validateDataViewDefinition({ ...definition, orderBy: [{ field: "title", direction: "sideways" }] }), /direction/);
    assert.throws(() => validateDataViewDefinition({ ...definition, extra: true }), /unknown fields/);
  });
  test("requires a grouping field for Kanban views", () => {
    assert.throws(() => validateDataViewDefinition({ ...definition, view: "kanban" }), /groupBy/);
  });

  test("rejects secret-bearing values", () => {
    assert.throws(() => validateDataViewDefinition({ ...definition, title: "api_key=abc" }), /secret-bearing/);
  });
});
