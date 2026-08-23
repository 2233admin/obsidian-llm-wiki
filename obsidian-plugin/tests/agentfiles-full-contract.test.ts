import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceLeaf, type App } from "obsidian";
import { AgentfilesFeature } from "../src/agentfiles/feature";
import { scanAll, getWatchPaths } from "../src/agentfiles/scanner";
import { SkillStore } from "../src/agentfiles/store";
import { scaffoldContent, scaffoldExtension } from "../src/agentfiles/scaffolds";
import { TOOL_CONFIGS } from "../src/agentfiles/tool-configs";
import { DEFAULT_SETTINGS, type ChopsSettings, type ConversationItem } from "../src/agentfiles/types";
import { generateTags } from "../src/agentfiles/conversations/tagger";
import { generateNoteContent, generateNotePath } from "../src/agentfiles/conversations/note-exporter";
import { formatInstalls, searchSkills, TOOL_TO_AGENT, VALID_AGENTS } from "../src/agentfiles/marketplace";
import { sanitizeTitle } from "../src/agentfiles/views/conversation-list";

function settingsFor(root: string): ChopsSettings {
	return {
		...DEFAULT_SETTINGS,
		tools: Object.fromEntries(TOOL_CONFIGS.map(tool => [tool.id, { enabled: false, customPaths: [] }])),
		customScanPaths: [root],
		projectScanEnabled: false,
	};
}

async function createSkillTree(root: string): Promise<void> {
	await mkdir(join(root, ".claude", "skills", "reviewer"), { recursive: true });
	await mkdir(join(root, ".claude", "commands"), { recursive: true });
	await mkdir(join(root, ".cursor", "skills", "ui"), { recursive: true });
	await mkdir(join(root, ".codex", "skills", "codex"), { recursive: true });
	await writeFile(
		join(root, ".claude", "skills", "reviewer", "SKILL.md"),
		"# Reviewer\n\nDeep-search needle for the reviewer skill.",
		"utf8",
	);
	await writeFile(join(root, ".claude", "commands", "check.md"), "# Check\n\nRun checks.", "utf8");
	await writeFile(join(root, ".cursor", "skills", "ui", "SKILL.md"), "# UI\n\nInterface skill.", "utf8");
	await writeFile(join(root, ".codex", "skills", "codex", "SKILL.md"), "# Codex\n\nCodex skill.", "utf8");
}

test("full workflow scans, indexes, searches, favorites, and collections", async t => {
	const root = await mkdtemp(join(tmpdir(), "agentfiles-full-scan-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await createSkillTree(root);

	const settings = settingsFor(root);
	const items = scanAll(settings);
	assert.equal(items.size, 4);
	assert.deepEqual([...items.values()].map(item => item.type).sort(), ["command", "skill", "skill", "skill"]);
	const reviewer = [...items.values()].find(item => item.name === "Reviewer");
	assert.ok(reviewer);
	assert.equal(reviewer.content.includes("needle"), true);

	settings.favorites = [reviewer.id];
	settings.collections = { important: [reviewer.id] };
	const store = new SkillStore();
	store.refresh(settings);
	assert.equal(store.getTypeCounts().get("skill"), 3);
	assert.equal(store.getToolCounts().get("claude-code"), 4);

	store.setFilter({ kind: "favorites" });
	assert.deepEqual(store.filteredItems.map(item => item.name), ["Reviewer"]);
	store.setFilter({ kind: "collection", name: "important" });
	assert.deepEqual(store.filteredItems.map(item => item.name), ["Reviewer"]);
	store.setFilter({ kind: "all" });
	store.setDeepSearch(true);
	store.setDeepSearchScope("content");
	store.setSearch("needle");
	assert.deepEqual(store.filteredItems.map(item => item.name), ["Reviewer"]);
	store.setDeepSearch(false);
	assert.equal(store.filteredItems.length, 0);
});

// Regression: custom Agentfiles scan paths were not included in watcher paths.
// Found by /qa on 2026-08-08.
// Report: .gstack/qa-reports/qa-report-agentfiles-2026-08-08.md
test("custom scan paths are watched and feature lifecycle refreshes them", async t => {
	const root = await mkdtemp(join(tmpdir(), "agentfiles-full-host-"));
	t.after(() => rm(root, { recursive: true, force: true }));
	await createSkillTree(root);

	const settings = settingsFor(root);
	assert.ok(getWatchPaths(settings).includes(root));

	let layoutReady: (() => void) | undefined;
	let openedState: unknown;
	let detached = false;
	const leaf = {
		setViewState: async (state: unknown) => { openedState = state; },
	};
	const app = {
		vault: { adapter: { getBasePath: () => root } },
		workspace: {
			onLayoutReady: (callback: () => void) => { layoutReady = callback; callback(); },
			getLeavesOfType: () => [],
			getLeaf: () => leaf,
			revealLeaf: async () => undefined,
			detachLeavesOfType: () => { detached = true; },
		},
	} as unknown as App;
	const registrations: string[] = [];
	let persisted: ChopsSettings | undefined;
	let viewCreator: ((leaf: WorkspaceLeaf) => unknown) | undefined;
	let command: { id: string; callback?: () => void } | undefined;
	const host = {
		app,
		registerView: (type: string, creator: (leaf: WorkspaceLeaf) => unknown) => {
			registrations.push(type);
			viewCreator = creator;
		},
		addRibbonIcon: () => ({} as HTMLElement),
		addCommand: (value: { id: string; callback?: () => void }) => { command = value; },
		addSettingTab: () => undefined,
	};
	const feature = new AgentfilesFeature(host, settings, async value => { persisted = value; });

	await feature.onload();
	assert.ok(layoutReady);
	assert.equal(feature.store.allItems.length, 4);
	assert.ok(registrations.includes("agentfiles-view"));
	assert.equal(command?.id, "open-agentfiles");
	assert.ok(viewCreator);
	assert.equal((viewCreator!(new WorkspaceLeaf()) as { getViewType: () => string }).getViewType(), "agentfiles-view");

	await feature.activateView();
	assert.deepEqual(openedState, { type: "agentfiles-view", active: true });
	await feature.saveSettings();
	assert.ok(persisted?.customScanPaths.includes(root));
	feature.onunload();
	assert.equal(detached, true);
});

test("scaffolds, conversation tags, and governed export remain functional", () => {
	assert.match(scaffoldContent({ name: "Review", type: "skill", directory: true }), /# Review/);
	assert.match(scaffoldContent({ name: "Rule", type: "rule", directory: false }), /alwaysApply: false/);
	assert.match(scaffoldContent({ name: "Memory", type: "memory", directory: false }), /# Memory/);
	assert.equal(scaffoldExtension("rule", true), ".mdc");
	assert.equal(scaffoldExtension("rule", false), ".md");

	const conversation: ConversationItem = {
		id: "session-full",
		uuid: "session-full",
		project: "wiki",
		projectPath: "C:/projects/wiki",
		title: "../Review: important",
		messages: [
			{ role: "human", text: "typescript typescript typescript fix bug", timestamp: "2026-08-08T00:00:00.000Z" },
			{ role: "assistant", text: "Done", timestamp: "2026-08-08T00:01:00.000Z", toolCalls: ["mcp__blender_render"] },
		],
		messageCount: 2,
		firstTimestamp: "2026-08-08T00:00:00.000Z",
		lastTimestamp: "2026-08-08T00:01:00.000Z",
		tags: [],
		customTags: [],
		isFavorite: false,
		filePath: "C:/Users/test/.claude/projects/wiki/session-full.jsonl",
	};
	const tags = generateTags(conversation);
	assert.ok(tags.includes("typescript"));
	assert.ok(tags.includes("bug-fix"));
	assert.ok(tags.includes("blender"));

	const path = generateNotePath(conversation, "C:/vault");
	assert.match(path, /00-Inbox[\\/]AI-Output[\\/]agentfiles[\\/]Claude Sessions/);
	assert.equal(path.includes(".."), false);
	const content = generateNoteContent({ selectedMessages: conversation.messages, conversation, vaultPath: "C:/vault" });
	assert.match(content, /type: transcript/);
	assert.match(content, /review: draft/);
	assert.match(content, /source: claude-code/);
});

test("conversation titles remove complete markup without truncating ordinary angle brackets", () => {
	assert.equal(sanitizeTitle("<b>Review</b>"), "Review");
	assert.equal(sanitizeTitle("Score 1 < 2 and 3 > 1"), "Score 1 < 2 and 3 > 1");
	assert.equal(sanitizeTitle("Draft <script"), "Draft <script");
});

test("marketplace guards empty queries and preserves runtime mappings", async () => {
	assert.deepEqual(await searchSkills(""), []);
	assert.equal(formatInstalls(999), "999");
	assert.equal(formatInstalls(1200), "1.2K");
	assert.equal(formatInstalls(1200000), "1.2M");
	assert.ok(VALID_AGENTS.some(agent => agent.id === "codex"));
	assert.equal(TOOL_TO_AGENT.codex, "codex");
});
