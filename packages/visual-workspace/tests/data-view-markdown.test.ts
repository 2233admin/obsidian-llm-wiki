import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  parseManagedDataViewSection,
  replaceManagedDataViewSection,
  serializeManagedDataViewSection,
} from "../src/index.js";
import { fixture } from "./helpers.js";

const tableDefinition = {
  schemaVersion: 1 as const,
  id: "projects-table",
  title: "Projects",
  view: "table" as const,
  source: { kind: "folder" as const, path: "Projects" },
  select: [
    { field: "title", label: "Title" },
    { field: "status", label: "Status" },
  ],
  where: { kind: "field" as const, field: "status", operator: "exists" as const },
  orderBy: [{ field: "title", direction: "asc" as const }],
};

const kanbanDefinition = {
  schemaVersion: 1 as const,
  id: "tasks-kanban",
  title: "Tasks",
  view: "kanban" as const,
  source: { kind: "folder" as const, path: "Tasks" },
  select: [{ field: "title", label: "Title" }],
  groupBy: "status",
  groupOrder: ["Todo", "Doing", "Done"],
};

describe("managed Markdown data-view definitions", () => {
  test("parses and deterministically serializes the table fixture", () => {
    const source = fixture("data-view.basic.md");
    const section = parseManagedDataViewSection(source);

    assert.deepEqual(section.definition, tableDefinition);
    assert.equal(serializeManagedDataViewSection(section.definition), section.raw);
  });

  test("supports a Kanban definition with explicit group order", () => {
    const managed = serializeManagedDataViewSection(kanbanDefinition, "\r\n");
    const section = parseManagedDataViewSection(`before\r\n${managed}\r\nafter`);

    assert.deepEqual(section.definition, kanbanDefinition);
    assert.equal(section.eol, "\r\n");
  });

  test("preserves all bytes outside the managed section and its line ending", () => {
    const managed = serializeManagedDataViewSection(tableDefinition, "\r\n");
    const source = `\uFEFFbefore  \r\n${managed}\r\nafter  `;
    const original = parseManagedDataViewSection(source);
    const result = replaceManagedDataViewSection(source, { ...tableDefinition, title: "Updated projects" });
    const updated = parseManagedDataViewSection(result);

    assert.equal(result.startsWith("\uFEFFbefore"), true);
    assert.equal(result.slice(0, updated.start), source.slice(0, original.start));
    assert.equal(result.slice(updated.end), source.slice(original.end));
    assert.equal(updated.eol, "\r\n");
    assert.deepEqual(updated.definition, { ...tableDefinition, title: "Updated projects" });
  });

  test("rejects duplicate managed blocks", () => {
    const managed = serializeManagedDataViewSection(tableDefinition);
    assert.throws(() => parseManagedDataViewSection(`${managed}\n${managed}`), /exactly one/);
  });

  test("rejects malformed JSON and unknown fields", () => {
    assert.throws(
      () => parseManagedDataViewSection("<!-- llmwiki:data-view:v1 {bad} -->\n{}\n<!-- /llmwiki:data-view:v1 -->"),
      /valid JSON/,
    );
    assert.throws(
      () => parseManagedDataViewSection(
        `<!-- llmwiki:data-view:v1 ${JSON.stringify({ id: tableDefinition.id, title: tableDefinition.title, view: tableDefinition.view })} -->\n${JSON.stringify({ ...tableDefinition, extra: true })}\n<!-- /llmwiki:data-view:v1 -->`,
      ),
      /unknown fields/,
    );
    assert.throws(
      () => parseManagedDataViewSection(
        `<!-- llmwiki:data-view:v1 ${JSON.stringify({ id: tableDefinition.id, title: tableDefinition.title, view: tableDefinition.view })} -->\n{bad}\n<!-- /llmwiki:data-view:v1 -->`,
      ),
      /body must be valid JSON/,
    );
  });

  test("rejects invalid paths and wrong markers", () => {
    assert.throws(
      () => serializeManagedDataViewSection({ ...tableDefinition, source: { kind: "file", path: "/absolute" } }),
      /vault-relative path/,
    );
    assert.throws(
      () => serializeManagedDataViewSection({ ...tableDefinition, source: { kind: "file", path: "https://example.com" } }),
      /vault-relative path/,
    );
    assert.throws(
      () => parseManagedDataViewSection(
        `<!-- llmwiki:data-view:v1 ${JSON.stringify({ id: tableDefinition.id, title: tableDefinition.title, view: tableDefinition.view })} -->\n${JSON.stringify(tableDefinition)}\n<!-- /llmwiki:wrong-v1 -->`,
      ),
      /closing marker/,
    );
    assert.throws(
      () => parseManagedDataViewSection("<!-- llmwiki:wrong:v1 {} -->\n<!-- /llmwiki:data-view:v1 -->"),
      /exactly one/,
    );
  });

  test("rejects secret-bearing values before serialization", () => {
    assert.throws(
      () => serializeManagedDataViewSection({ ...tableDefinition, title: "Bearer sk-test-secret" }),
      /secret-bearing/,
    );
  });
});
