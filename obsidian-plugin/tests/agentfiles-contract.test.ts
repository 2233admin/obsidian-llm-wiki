import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { App } from "obsidian";
import { AgentfilesFeature } from "../src/agentfiles/feature";
import { scanAll } from "../src/agentfiles/scanner";
import { TOOL_CONFIGS } from "../src/agentfiles/tool-configs";
import { DEFAULT_SETTINGS, type ConversationItem } from "../src/agentfiles/types";
import { generateNoteContent, generateNotePath } from "../src/agentfiles/conversations/note-exporter";

function disabledTools(): typeof DEFAULT_SETTINGS.tools {
  return Object.fromEntries(TOOL_CONFIGS.map(tool => [tool.id, { enabled: false, customPaths: [] }]));
}

test("Agentfiles scans project skill files without reading global runtimes", async t => {
  const root = await mkdtemp(join(tmpdir(), "agentfiles-scan-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const skillDir = join(root, ".claude", "skills", "local-only");
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), "# Local Only\n\nA project-local skill.", "utf8");

  const items = scanAll({
    ...DEFAULT_SETTINGS,
    tools: disabledTools(),
    customScanPaths: [root],
    projectScanEnabled: false,
  });

  assert.equal(items.size, 1);
  const item = [...items.values()][0];
  assert.equal(item.name, "Local Only");
  assert.equal(item.type, "skill");
  assert.equal(item.tools[0], "claude-code");
});

test("conversation export stays in the governed agent draft area", () => {
  const conversation: ConversationItem = {
    id: "session-1",
    uuid: "session-1",
    project: "wiki",
    projectPath: "C:/projects/wiki",
    title: "Draft review",
    messages: [{ role: "human", text: "Review this", timestamp: "2026-08-08T00:00:00.000Z" }],
    messageCount: 1,
    firstTimestamp: "2026-08-08T00:00:00.000Z",
    lastTimestamp: "2026-08-08T00:00:00.000Z",
    tags: [],
    customTags: [],
    isFavorite: false,
    filePath: "C:/Users/test/.claude/projects/wiki/session.jsonl",
  };
  const path = generateNotePath(conversation, "C:/vault");
  const content = generateNoteContent({
    selectedMessages: conversation.messages,
    conversation,
    vaultPath: "C:/vault",
  });

  assert.match(path, /00-Inbox[\\/]AI-Output[\\/]agentfiles/);
  assert.match(content, /type: transcript/);
  assert.match(content, /review: draft/);
});

test("Agentfiles registers as a feature of the existing plugin host", async t => {
  const vaultPath = await mkdtemp(join(tmpdir(), "agentfiles-host-"));
  t.after(() => rm(vaultPath, { recursive: true, force: true }));
  const registrations: string[] = [];
  let settingTabPlugin: unknown = null;
  let persisted: unknown = null;
  const app = {
    vault: { adapter: { getBasePath: () => vaultPath } },
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: () => ({ setViewState: async () => undefined }),
      revealLeaf: async () => undefined,
      detachLeavesOfType: () => undefined,
    },
  } as unknown as App;
  const host = {
    app,
    registerView: (type: string) => registrations.push(type),
    addRibbonIcon: () => ({} as HTMLElement),
    addCommand: (command: { id: string }) => registrations.push(command.id),
    addSettingTab: tab => { settingTabPlugin = tab.plugin; },
  };
  const feature = new AgentfilesFeature(host, undefined, async settings => { persisted = settings; });

  await feature.onload();
  await feature.saveSettings();
  feature.onunload();

  assert.ok(registrations.includes("agentfiles-view"));
  assert.ok(registrations.includes("open-agentfiles"));
  assert.equal(settingTabPlugin, host);
  assert.equal((persisted as { customScanPaths: string[] }).customScanPaths.includes(vaultPath), true);
});
