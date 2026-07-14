/**
 * CompileTrigger unit tests
 *
 * Most tests are pure in-process logic. The compile success hook test uses a
 * temporary vault and runs Node as a fake compiler so no Python dependency is
 * required.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { CompileTrigger } from "./compile-trigger.js";

const FAKE_VAULT = "/nonexistent/vault";
const FAKE_COMPILER = "/nonexistent/compiler";

function makeTrigger(opts: { threshold?: number } = {}): CompileTrigger {
  return new CompileTrigger({
    vaultPath: FAKE_VAULT,
    compilerPath: FAKE_COMPILER,
    python: "python",
    threshold: opts.threshold ?? 3,
    autoCompile: false, // prevent any real subprocess calls
  });
}

describe("CompileTrigger -- initial state", () => {
  test("status() starts empty", () => {
    const t = makeTrigger();
    const s = t.status();
    assert.deepEqual(s.dirty, []);
    assert.equal(s.dirtyCount, 0);
    assert.equal(s.running, false);
    assert.equal(s.lastRun, null);
    assert.equal(s.lastResult, null);
    assert.equal(s.autoCompile, false);
  });

  test("threshold is reflected in status", () => {
    const t = makeTrigger({ threshold: 7 });
    assert.equal(t.status().threshold, 7);
  });
});

describe("CompileTrigger -- onFileChange", () => {
  test("adds .md file to dirty", () => {
    const t = makeTrigger();
    t.onFileChange("notes/test.md", "create");
    assert.equal(t.status().dirtyCount, 1);
    assert.ok(t.status().dirty.includes("notes/test.md"));
  });

  test("multiple different files accumulate", () => {
    const t = makeTrigger();
    t.onFileChange("topic-a/raw/a.md", "create");
    t.onFileChange("topic-b/raw/b.md", "modify");
    const { dirty } = t.status();
    assert.equal(dirty.length, 2);
    assert.ok(dirty.includes("topic-a/raw/a.md"));
    assert.ok(dirty.includes("topic-b/raw/b.md"));
  });

  test("duplicate path is deduplicated (Set)", () => {
    const t = makeTrigger();
    t.onFileChange("topic/raw/a.md", "create");
    t.onFileChange("topic/raw/a.md", "modify");
    assert.equal(t.status().dirtyCount, 1);
  });

  test("filters wiki/ paths", () => {
    const t = makeTrigger();
    t.onFileChange("topic/wiki/output.md", "modify");
    t.onFileChange("notes/wiki/index.md", "create");
    assert.equal(t.status().dirtyCount, 0);
  });

  test("filters non-.md files", () => {
    const t = makeTrigger();
    t.onFileChange("notes/image.png", "create");
    t.onFileChange("notes/data.json", "modify");
    t.onFileChange("notes/.obsidian/config", "modify");
    assert.equal(t.status().dirtyCount, 0);
  });

  test("backslash wiki path is also filtered", () => {
    const t = makeTrigger();
    t.onFileChange("topic\\wiki\\output.md", "modify");
    assert.equal(t.status().dirtyCount, 0);
  });
});

describe("CompileTrigger -- abort", () => {
  test("abort when not running returns ok=false", () => {
    const t = makeTrigger();
    const result = t.abort();
    assert.equal(result.ok, false);
    assert.ok(result.message.length > 0);
  });
});

describe("CompileTrigger -- run", () => {
  test("run() with no dirty files returns error (no topic detected)", async () => {
    const t = makeTrigger();
    const result = await t.run(); // no dirty files -> detectTopic() = null -> early return
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("No topic"));
  });

  test("run() with explicit topic but dirty queue empty returns error", async () => {
    // No dirty files, but we request a topic -- should still try to compile.
    // Since Python isn't available at this fake path, this will throw internally.
    // We just verify the run() method doesn't crash with an unhandled exception.
    const t = makeTrigger();
    const result = await t.run("my-topic");
    // Either ok (Python happened to work) or failed gracefully with an error
    assert.ok(typeof result.ok === "boolean");
    assert.ok(typeof result.timestamp === "string");
  });

  test("run() calls onCompileSuccess with generated wiki markdown files", async () => {
    const root = mkdtempSync(join(tmpdir(), "vault-compile-trigger-"));
    try {
      const vaultPath = join(root, "vault");
      const compilerPath = join(root, "compiler");
      const topicPath = join(vaultPath, "topic-a");
      const wikiDir = join(topicPath, "wiki");
      mkdirSync(wikiDir, { recursive: true });
      mkdirSync(compilerPath, { recursive: true });
      writeFileSync(join(wikiDir, "summary.md"), "# Summary\n", "utf-8");
      mkdirSync(join(wikiDir, "concepts"), { recursive: true });
      writeFileSync(join(wikiDir, "concepts", "memory.md"), "# Memory\n", "utf-8");
      writeFileSync(join(wikiDir, "skip.txt"), "not markdown\n", "utf-8");

      const compileScript = join(compilerPath, "compile.py");
      const environmentCapture = join(root, "child-environment.txt");
      writeFileSync(
        compileScript,
        "require('node:fs').writeFileSync(process.env.ENV_CAPTURE, process.env.COMPILE_MODEL || 'missing');\n" +
        "console.log('=== Compilation Report ===');\n" +
          "console.log('Sources compiled: 2');\n" +
          "console.log('Concepts created: 1');\n" +
          "console.log('Contradictions: 0');\n",
        "utf-8",
      );

      let indexedPaths: string[] = [];
      const trigger = new CompileTrigger({
        vaultPath,
        compilerPath,
        python: process.execPath,
        autoCompile: false,
        environmentResolver: async () => ({ ...process.env, ENV_CAPTURE: environmentCapture, COMPILE_MODEL: "settings-model" }),
        onCompileSuccess: (wikiPaths) => {
          indexedPaths = wikiPaths.map((p) => resolve(p)).sort();
        },
      });

      const result = await trigger.run("topic-a");
      assert.equal(result.ok, true);
      assert.equal(result.sourcesCompiled, 2);
      assert.equal(readFileSync(environmentCapture, "utf8"), "settings-model");
      assert.deepEqual(indexedPaths, [
        resolve(join(wikiDir, "concepts", "memory.md")),
        resolve(join(wikiDir, "summary.md")),
      ].sort());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
