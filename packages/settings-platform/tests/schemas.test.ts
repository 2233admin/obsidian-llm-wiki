import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCHEMAS = [
  "registry.schema.json",
  "settings-document.schema.json",
  "runtime-context.schema.json",
  "settings-snapshot.schema.json",
  "validation-result.schema.json",
  "conflict-result.schema.json",
  "settings-event.schema.json",
  "capability-health.schema.json",
];

describe("canonical JSON schemas", () => {
  test("publishes every cross-runtime contract under a stable schema id", () => {
    const ids = new Set<string>();
    for (const name of SCHEMAS) {
      const path = fileURLToPath(new URL(`../schemas/${name}`, import.meta.url));
      const schema = JSON.parse(readFileSync(path, "utf8")) as { $schema?: string; $id?: string };
      assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
      assert.match(schema.$id ?? "", /^https:\/\/schemas\.llmwiki\.org\/settings\/v1\//);
      assert.equal(ids.has(schema.$id!), false, `${name} has a unique $id`);
      ids.add(schema.$id!);
    }
  });

  test("accepts redacted secret objects without an overlapping oneOf", () => {
    const path = fileURLToPath(new URL("../schemas/common.schema.json", import.meta.url));
    const schema = JSON.parse(readFileSync(path, "utf8")) as {
      $defs: { redactedValue: { anyOf?: unknown[]; oneOf?: unknown[] } };
    };

    assert.equal(schema.$defs.redactedValue.oneOf, undefined);
    assert.equal(schema.$defs.redactedValue.anyOf?.length, 2);
  });
});
