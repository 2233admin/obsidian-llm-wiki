import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { executeDataViewQuery, projectDataView } from "../src/index.js";
import type { DataViewSourceBlock } from "../src/index.js";

const source = (path: string, status?: string): DataViewSourceBlock => ({
  path,
  sha256: `sha256:${"a".repeat(64)}`,
  title: path.split("/").pop()!.replace(".md", ""),
  frontmatter: status === undefined ? {} : { status },
  blocks: [],
});

function result(view: "table" | "kanban" = "table") {
  return executeDataViewQuery({
    definition: {
      schemaVersion: 1,
      id: "board",
      title: "Board",
      view,
      source: { kind: "folder", path: "Projects" },
      select: [{ field: "title", label: "Title" }, { field: "status", label: "Status" }],
      ...(view === "kanban" ? { groupBy: "status", groupOrder: ["todo", "done"] } : {}),
    },
    sources: [source("Projects/a.md", "done"), source("Projects/b.md"), source("Projects/c.md", "todo")],
  });
}

describe("data-view projections", () => {
  test("preserves Table column order, rows, and diagnostics", () => {
    const query = result();
    const projected = projectDataView({ result: query, view: "table" });

    assert.deepEqual(projected.columns, [
      { field: "title", label: "Title" },
      { field: "status", label: "Status" },
    ]);
    assert.deepEqual(projected.rows, query.model.rows);
    assert.deepEqual(projected.diagnostics, query.model.diagnostics);
  });

  test("preserves Kanban group order and places missing values in unknown", () => {
    const query = result("kanban");
    const projected = projectDataView({ result: query, view: "kanban" });

    assert.deepEqual(projected.groups.map((group) => group.label), ["todo", "done", "unknown"]);
    assert.equal(projected.groups.find((group) => group.label === "unknown")?.rowIds.length, 1);
    assert.equal(projected.diagnostics.some((diagnostic) => diagnostic.code === "UNKNOWN_GROUP"), true);
  });

  test("supports an empty result without manufacturing rows or groups", () => {
    const query = executeDataViewQuery({
      definition: {
        schemaVersion: 1,
        id: "empty",
        title: "Empty",
        view: "table",
        source: { kind: "folder", path: "Projects" },
        select: [{ field: "title", label: "Title" }],
        where: { kind: "field", field: "status", operator: "equals", value: "missing" },
      },
      sources: [source("Projects/a.md", "done")],
    });

    const projected = projectDataView({ result: query, view: "table" });
    assert.deepEqual(projected.rows, []);
    assert.deepEqual(projected.groups, []);
  });

  test("rejects a projection view that differs from the query", () => {
    assert.throws(() => projectDataView({ result: result("kanban"), view: "table" }), /view/);
  });
});
