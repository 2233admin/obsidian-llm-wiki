import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { assertSafeSharedState } from "../src/security.js";
import { DomainLockTimeoutError } from "../src/errors.js";
import {
  validateAgentProfile,
  validateProjectAgentBinding,
  validateRoomIdentity,
  validateRoomProjection,
} from "../src/validation.js";
import { binding, profile } from "./helpers.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

describe("versioned Agent Domain contracts", () => {
  test("fixture records pass strict runtime validators", async () => {
    const profileFixture = JSON.parse(await readFile(join(packageRoot, "fixtures", "agent-profile.v1.json"), "utf8"));
    const bindingFixture = JSON.parse(await readFile(join(packageRoot, "fixtures", "project-agent-binding.v1.json"), "utf8"));
    assert.equal(validateAgentProfile(profileFixture).profileId, "agent/researcher");
    assert.equal(validateProjectAgentBinding(bindingFixture).bindingId, "binding/demo/researcher");
  });

  test("strict records reject unknown, secret, and machine-local state", () => {
    assert.throws(() => validateAgentProfile({ ...profile(), unexpected: true }), /Unknown fields/);
    assert.throws(() => assertSafeSharedState({ apiKey: "not-even-needed" }), /Forbidden sensitive/);
    assert.throws(() => assertSafeSharedState({ note: "C:\\Users\\alice\\vault" }), /absolute paths/);
    assert.throws(() => assertSafeSharedState({ note: "Bearer abcdefghijklmnopqrstuvwxyz" }), /Secret material/);
  });

  test("public lock failures never expose the machine-local lock path", () => {
    const localPath = "C:\\Users\\operator\\private\\.agent-domain.lock";
    const error = new DomainLockTimeoutError(localPath, 25);
    assert.doesNotMatch(error.message, /operator|private|agent-domain\.lock/i);
    assert.doesNotMatch(JSON.stringify(error), /operator|private|agent-domain\.lock/i);
  });

  test("Room identity is locked and projection is read-only", () => {
    const identity = validateRoomIdentity({
      schemaVersion: 1,
      projectId: "project/demo",
      profileId: "agent/researcher",
      profileRevision: 1,
      bindingId: "binding/demo/researcher",
      bindingRevision: 1,
      threadId: "thread/fixture",
      threadRevision: 2,
    });
    const projection = validateRoomProjection({
      schemaVersion: 1,
      identity,
      readOnly: true,
      lifecycle: "open",
      relatedWorkRunIds: ["work-run/run-1"],
      approvedMemory: null,
      connectorSummaries: [{ connectorId: "github", status: "available", grantRef: "grant/repo-read" }],
      diagnostics: [{ code: "room-ready", severity: "info" }],
    });
    assert.equal(projection.readOnly, true);
    for (const workRunId of ["work-run/Run-1", "work-run/run.1", "work-run/run_1"]) {
      assert.throws(() => validateRoomProjection({
        ...projection,
        relatedWorkRunIds: [workRunId],
      }), /Invalid Work Run ID/);
    }
    assert.throws(() => validateRoomIdentity({ ...identity, bindingId: "binding/other/researcher" }), /mismatch/);
  });

  test("all published schemas are v1 JSON Schema documents and closed at record roots", async () => {
    const schemaDirectory = join(packageRoot, "schemas");
    const names = (await readdir(schemaDirectory)).filter((name) => name.endsWith(".schema.json")).sort();
    assert.deepEqual(names, [
      "agent-profile.schema.json",
      "common.schema.json",
      "context-consult.schema.json",
      "context-envelope.schema.json",
      "delegation.schema.json",
      "dreamtime-memory.schema.json",
      "project-agent-binding.schema.json",
      "room.schema.json",
      "thread.schema.json",
    ]);
    const ids = new Set<string>();
    for (const name of names) {
      const schema = JSON.parse(await readFile(join(schemaDirectory, name), "utf8"));
      assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
      assert.match(schema.$id, /\/agent-domain\/v1\//);
      assert.equal(ids.has(schema.$id), false);
      ids.add(schema.$id);
      if (name !== "common.schema.json" && !("oneOf" in schema)) assert.equal(schema.additionalProperties, false);
    }
  });

  test("binding validation locks the derived stable ID", () => {
    assert.equal(validateProjectAgentBinding(binding()).bindingId, "binding/demo/researcher");
    assert.throws(() => validateProjectAgentBinding({ ...binding(), bindingId: "binding/demo/other" }), /does not match/);
  });
});
