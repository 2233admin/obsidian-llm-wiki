import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

describe("Problem Intake JSON schemas", () => {
  test("publishes closed draft 2020-12 contracts under stable v1 IDs", () => {
    const directory = fileURLToPath(new URL("../schemas", import.meta.url));
    const names = readdirSync(directory).filter((name) => name.endsWith(".schema.json")).sort();
    assert.deepEqual(names, [
      "external-contribution-plan.schema.json",
      "issue-change-plan.schema.json",
      "problem-disposition.schema.json",
      "problem-observation.schema.json",
      "problem-report.schema.json",
    ]);
    for (const name of names) {
      const schema = JSON.parse(readFileSync(`${directory}/${name}`, "utf8")) as {
        $schema?: string;
        $id?: string;
        additionalProperties?: boolean;
      };
      assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
      assert.match(schema.$id ?? "", /^https:\/\/schemas\.llmwiki\.org\/problem-intake\/v1\//);
      assert.equal(schema.additionalProperties, false);
    }
  });
});
