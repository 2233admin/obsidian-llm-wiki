import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  parseManagedMindMapSection,
  replaceManagedMindMapSection,
  serializeManagedMindMapSection,
} from "../src/index.js";
import { documentFixture, fixture } from "./helpers.js";

describe("canonical managed nested-list Markdown", () => {
  test("parses and deterministically serializes the fixture", () => {
    const source = fixture("basic.md");
    const section = parseManagedMindMapSection(source);
    assert.deepEqual(section.document, documentFixture());
    assert.equal(serializeManagedMindMapSection(section.document), section.raw);
  });

  test("preserves all surrounding prose bytes, line endings, and stable block IDs", () => {
    const canonical = serializeManagedMindMapSection(documentFixture(), { eol: "\r\n" });
    const source = `前言\r\nraw  spaces  \r\n${canonical}\r\n尾声\r\n`;
    const section = parseManagedMindMapSection(source);
    const edited = documentFixture("basic.edited.document.json");
    const result = replaceManagedMindMapSection(source, edited);
    const updated = parseManagedMindMapSection(result);

    assert.equal(result.slice(0, updated.start), source.slice(0, section.start));
    assert.equal(result.slice(updated.end), source.slice(section.end));
    assert.match(updated.raw, /\^ask-mate/);
    assert.match(updated.raw, /Ask Mate visual workspace/);
    assert.equal(updated.eol, "\r\n");
  });

  test("preserves a UTF-8 BOM and the absence of a trailing newline", () => {
    const managed = serializeManagedMindMapSection(documentFixture());
    const source = `\uFEFF前言\n${managed}\n尾声`;
    const original = parseManagedMindMapSection(source);
    const result = replaceManagedMindMapSection(
      source,
      documentFixture("basic.edited.document.json"),
    );
    const updated = parseManagedMindMapSection(result);

    assert.equal(result.startsWith("\uFEFF"), true);
    assert.equal(result.endsWith("\n"), false);
    assert.equal(result.slice(0, updated.start), source.slice(0, original.start));
    assert.equal(result.slice(updated.end), source.slice(original.end));
  });

  test("rejects ordinary lists and noncanonical managed content", () => {
    assert.throws(() => parseManagedMindMapSection("# Topic\n- ordinary\n  - list\n"), /exactly one/);
    assert.throws(
      () => parseManagedMindMapSection(
        "<!-- llmwiki:mind-map:v1 {\"id\":\"map\",\"title\":\"Map\"} -->\n"
          + "- Root ^root\n"
          + "<!-- /llmwiki:mind-map:v1 -->",
      ),
      /Invalid canonical/,
    );
  });
});
