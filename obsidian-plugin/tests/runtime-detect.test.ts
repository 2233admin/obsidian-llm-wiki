import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import type { SettingsDocument } from "../../packages/settings-platform/src/types";
import {
  detectKbMetaPath,
  detectPython,
  planRuntimeDetection,
  RUNTIME_DETECT_ACTOR,
  RuntimeDetectHost,
} from "../src/runtime-detect";

const HOME = "/home/u";
const CLAUDE_INSTALL = "/home/u/.claude/plugins/cache/obsidian-llm-wiki/llmwiki/abc123";
const CLAUDE_KB_META = join(CLAUDE_INSTALL, "compiler", "kb_meta.py");
const CLONE_KB_META = join(HOME, ".llmwiki", "compiler", "kb_meta.py");

function host(options: { files?: string[]; claudeInstall?: string; pythons?: string[]; platform?: NodeJS.Platform } = {}): RuntimeDetectHost {
  const files = new Set(options.files ?? []);
  return {
    home: HOME,
    platform: options.platform ?? "linux",
    exists: path => files.has(path),
    readText: path => {
      if (path === join(HOME, ".claude", "plugins", "installed_plugins.json") && options.claudeInstall) {
        return JSON.stringify({ version: 2, plugins: { "llmwiki@obsidian-llm-wiki": [{ scope: "user", installPath: options.claudeInstall }] } });
      }
      throw new Error("ENOENT");
    },
    probe: async command => (options.pythons ?? []).includes(command),
  };
}

function userDevice(assignments: Array<{ key: string; value: string; actor: string }> = []): SettingsDocument {
  return {
    assignments: assignments.map(({ key, value, actor }) => ({ key, value, provenance: { actor, source: "settings.assignment.set" } })),
  } as unknown as SettingsDocument;
}

test("finds kb_meta.py in the Claude Code plugin install before a ~/.llmwiki clone", () => {
  assert.equal(detectKbMetaPath(host({ files: [CLAUDE_KB_META, CLONE_KB_META], claudeInstall: CLAUDE_INSTALL })), CLAUDE_KB_META);
  assert.equal(detectKbMetaPath(host({ files: [CLONE_KB_META] })), CLONE_KB_META);
  assert.equal(detectKbMetaPath(host({ claudeInstall: CLAUDE_INSTALL })), null);
});

test("prefers python3 off Windows and falls back to Homebrew when PATH is minimal", async () => {
  assert.equal(await detectPython(host({ pythons: ["python", "python3"] })), "python3");
  assert.equal(await detectPython(host({ pythons: ["/opt/homebrew/bin/python3"], platform: "darwin" })), "/opt/homebrew/bin/python3");
  assert.equal(await detectPython(host({ pythons: ["py"], platform: "win32" })), "py");
  assert.equal(await detectPython(host()), null);
});

test("binds detected values but never overrides a value someone else set", async () => {
  const detected = host({ files: [CLAUDE_KB_META], claudeInstall: CLAUDE_INSTALL, pythons: ["python3"] });
  assert.deepEqual(await planRuntimeDetection(detected, userDevice()), [
    { key: "runtime.kb_meta.path", value: CLAUDE_KB_META },
    { key: "runtime.python.path", value: "python3" },
  ]);
  assert.deepEqual(await planRuntimeDetection(detected, userDevice([
    { key: "runtime.kb_meta.path", value: "/src/compiler/kb_meta.py", actor: "obsidian-control-plane" },
    { key: "runtime.python.path", value: "python3", actor: RUNTIME_DETECT_ACTOR },
  ])), []);
});

test("follows the Claude Code plugin to its new install path after an update", async () => {
  const updated = join("/home/u/.claude/plugins/cache/obsidian-llm-wiki/llmwiki/def456", "compiler", "kb_meta.py");
  const detected = host({ files: [updated], claudeInstall: "/home/u/.claude/plugins/cache/obsidian-llm-wiki/llmwiki/def456" });
  assert.deepEqual(await planRuntimeDetection(detected, userDevice([
    { key: "runtime.kb_meta.path", value: CLAUDE_KB_META, actor: RUNTIME_DETECT_ACTOR },
  ])), [{ key: "runtime.kb_meta.path", value: updated }]);
});
