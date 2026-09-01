import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { executeDataViewQuery } from "../src/index.js";
import type { DataViewDefinitionV1, DataViewSourceBlock } from "../src/index.js";

const digest = (hex: string): `sha256:${string}` => `sha256:${hex.repeat(64 / hex.length)}`;

const sources: DataViewSourceBlock[] = [
  {
    path: "Projects/alpha.md",
    sha256: digest("a"),
    title: "Alpha",
    frontmatter: { status: "doing", priority: 2, labels: ["core", "urgent"] },
    blocks: [{ id: "summary", text: "Alpha summary", range: { start: 10, end: 23, startLine: 2, endLine: 2 } }],
  },
  {
    path: "Projects/beta.md",
    sha256: digest("b"),
    title: "Beta",
    frontmatter: { status: "todo", priority: 1, labels: ["core"] },
    blocks: [{ id: "summary", text: "Beta summary", range: { start: 10, end: 22, startLine: 2, endLine: 2 } }],
  },
  {
    path: "Notes/gamma.md",
    sha256: digest("c"),
    title: "Gamma",
    frontmatter: { status: "done", priority: 3 },
    blocks: [],
  },
];

function definition(overrides: Partial<DataViewDefinitionV1> = {}): DataViewDefinitionV1 {
  return {
    schemaVersion: 1,
    id: "projects",
    title: "Projects",
    view: "table",
    source: { kind: "folder", path: "Projects" },
    select: [
      { field: "title", label: "Title" },
      { field: "status", label: "Status" },
      { field: "block:summary", label: "Summary" },
      { field: "missing", label: "Missing" },
    ],
    ...overrides,
  };
}

describe("deterministic data-view query evaluation", () => {
  test("filters only in scope and resolves page, frontmatter, and block fields", () => {
    const result = executeDataViewQuery({ definition: definition(), sources });

    assert.equal(result.model.rows.length, 2);
    assert.deepEqual(result.model.rows.map((row) => row.source.path), ["Projects/alpha.md", "Projects/beta.md"]);
    assert.deepEqual(result.model.rows[0]?.values.status, {
      state: "known",
      value: "doing",
      source: { path: "Projects/alpha.md", field: "status" },
    });
    assert.deepEqual(result.model.rows[0]?.values["block:summary"], {
      state: "known",
      value: "Alpha summary",
      source: { path: "Projects/alpha.md", field: "block:summary", blockId: "summary", start: 10, end: 23 },
    });
    assert.equal(result.model.rows[0]?.values.missing?.state, "unknown");
  });

  test("honors nested and/or precedence and explicit group order", () => {
    const result = executeDataViewQuery({
      definition: definition({
        view: "kanban",
        groupBy: "status",
        groupOrder: ["todo", "doing", "done"],
        where: {
          kind: "or",
          predicates: [
            { kind: "field", field: "status", operator: "equals", value: "doing" },
            {
              kind: "and",
              predicates: [
                { kind: "field", field: "status", operator: "equals", value: "todo" },
                { kind: "field", field: "labels", operator: "contains", value: "core" },
              ],
            },
          ],
        },
      }),
      sources,
    });

    assert.deepEqual(result.model.rows.map((row) => row.source.path), ["Projects/alpha.md", "Projects/beta.md"]);
    assert.deepEqual(result.model.groups.map((group) => group.label), ["todo", "doing"]);
    assert.deepEqual(result.model.groups[0]?.rowIds, [result.model.rows[1]?.id]);
  });

  test("keeps equal sort values stable by vault-relative path and reports unknown fields", () => {
    const result = executeDataViewQuery({
      definition: definition({ select: [{ field: "priority", label: "Priority" }, { field: "unknown", label: "Unknown" }], orderBy: [{ field: "priority", direction: "asc" }] }),
      sources: [sources[1]!, sources[0]!, { ...sources[0]!, path: "Projects/alpha-copy.md" }],
    });

    assert.deepEqual(result.model.rows.map((row) => row.source.path), ["Projects/beta.md", "Projects/alpha-copy.md", "Projects/alpha.md"]);
    assert.equal(result.model.rows[0]?.values.unknown?.state, "unknown");
    assert.equal(result.model.diagnostics.some((diagnostic) => diagnostic.code === "UNKNOWN_FIELD"), true);
    assert.match(result.fingerprint, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(result.fingerprint, executeDataViewQuery({
      definition: definition({ select: [{ field: "priority", label: "Priority" }, { field: "unknown", label: "Unknown" }], orderBy: [{ field: "priority", direction: "asc" }] }),
      sources: [sources[1]!, sources[0]!, { ...sources[0]!, path: "Projects/alpha-copy.md" }],
    }).fingerprint);
  });

  test("retains valid sources beside malformed source snapshots", () => {
    const result = executeDataViewQuery({
      definition: definition(),
      sources: [...sources, { ...sources[2]!, path: "../outside.md" }],
    });

    assert.equal(result.model.rows.length, 2);
    assert.equal(result.model.diagnostics.some((diagnostic) => diagnostic.code === "INVALID_SOURCE"), true);
  });

  test("rejects an invalid definition before reading sources", () => {
    assert.throws(() => executeDataViewQuery({ definition: definition({ view: "grid" as never }), sources }), /view/);
  });
});
