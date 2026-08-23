import { homedir } from "os";
import { Plugin, PluginSettingTab, Setting, type App } from "obsidian";
import { TOOL_CONFIGS } from "./tool-configs";
import type { AgentfilesFeature } from "./feature";

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return homedir() + path.slice(1);
	return path;
}

export class AgentfilesSettingTab extends PluginSettingTab {
	private readonly feature: AgentfilesFeature;

	constructor(app: App, plugin: AgentfilesFeature, owner: Plugin) {
		super(app, owner);
		this.feature = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("File watching")
			.setDesc("Automatically detect changes to skill files")
			.addToggle((toggle) =>
				toggle
					.setValue(this.feature.settings.watchEnabled)
					.onChange(async (value) => {
						this.feature.settings.watchEnabled = value;
						await this.feature.saveSettings();
						this.feature.restartWatcher();
					})
			);

		new Setting(containerEl)
			.setName("Watch debounce (ms)")
			.setDesc("Delay before re-scanning after file changes")
			.addText((text) =>
				text
					.setValue(String(this.feature.settings.watchDebounceMs))
					.onChange(async (value) => {
						const n = parseInt(value);
						if (!isNaN(n) && n >= 100) {
							this.feature.settings.watchDebounceMs = n;
							await this.feature.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Display names")
			.setDesc("How skill and command names are displayed in the list")
			.addDropdown((drop) =>
				drop
					.addOptions({
						auto: "Auto (frontmatter / heading / filename)",
						filename: "Filename only",
					})
					.setValue(this.feature.settings.namingMode || "auto")
					.onChange(async (value) => {
						this.feature.settings.namingMode = value as "auto" | "filename";
						await this.feature.saveSettings();
						this.feature.refreshStore();
					})
			);

		new Setting(containerEl)
			.setName("Deep search by default")
			.setDesc(
				"Enable deep search when the view opens (can always be toggled in the search bar)"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.feature.settings.deepSearchDefault ?? false)
					.onChange(async (value) => {
						this.feature.settings.deepSearchDefault = value;
						await this.feature.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Deep search scope")
			.setDesc("What to include when deep search is enabled")
			.addDropdown((drop) =>
				drop
					.addOptions({
						both: "Description and file content",
						description: "Description only",
						content: "File content only",
					})
					.setValue(this.feature.settings.deepSearchScope ?? "both")
					.onChange(async (value) => {
						this.feature.settings.deepSearchScope = value as "description" | "content" | "both";
						await this.feature.saveSettings();
					})
			);

		new Setting(containerEl).setName("Marketplace").setHeading();

		new Setting(containerEl)
			.setName("Package runner")
			.setDesc("Command used to install skills from the marketplace")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ auto: "Auto-detect", npx: "npx", bunx: "bunx" })
					.setValue(this.feature.settings.packageRunner)
					.onChange(async (value) => {
						this.feature.settings.packageRunner = value as "auto" | "npx" | "bunx";
						await this.feature.saveSettings();
					})
			);

		new Setting(containerEl).setName("Project scanning").setHeading();

		new Setting(containerEl)
			.setName("Scan projects")
			.setDesc(
				"Scan all directories under the projects home folder for project-level skills"
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.feature.settings.projectScanEnabled)
					.onChange(async (value) => {
						this.feature.settings.projectScanEnabled = value;
						await this.feature.saveSettings();
						this.feature.refreshStore();
						this.feature.restartWatcher();
					})
			);

		new Setting(containerEl)
			.setName("Projects home directory")
			.setDesc(
				"Root directory to scan for project-level skills. Leave empty for home directory (~)."
			)
			.addText((text) =>
				text
					.setPlaceholder("~")
					.setValue(this.feature.settings.projectsHomeDir)
					.onChange(async (value) => {
						this.feature.settings.projectsHomeDir = value;
						await this.feature.saveSettings();
						this.feature.refreshStore();
						this.feature.restartWatcher();
					})
			);

		new Setting(containerEl).setName("Custom paths").setHeading();

		for (const path of this.feature.settings.customScanPaths) {
			new Setting(containerEl)
				.setName(path)
				.addExtraButton((btn) =>
					btn
						.setIcon("trash")
						.setTooltip("Remove")
						.onClick(async () => {
							this.feature.settings.customScanPaths =
								this.feature.settings.customScanPaths.filter((p) => p !== path);
							await this.feature.saveSettings();
							this.feature.refreshStore();
							this.feature.restartWatcher();
							this.display();
						})
				);
		}

		let newPathValue = "";
		new Setting(containerEl)
			.setName("Add custom path")
			.setDesc(
				"Additional directories to scan for project-level skills (looks for .claude/skills, .claude/commands, .claude/agents, .cursor/skills, .codex/skills inside each path)"
			)
			.addText((text) =>
				text
					.setPlaceholder("~/projects/some-project")
					.onChange((value) => {
						newPathValue = value;
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText("Add")
					.onClick(async () => {
						const trimmed = newPathValue.trim();
						if (!trimmed) return;
						const expanded = expandHome(trimmed);
						if (this.feature.settings.customScanPaths.includes(expanded)) return;
						this.feature.settings.customScanPaths.push(expanded);
						await this.feature.saveSettings();
						this.feature.refreshStore();
						this.feature.restartWatcher();
						this.display();
					})
			);

		new Setting(containerEl).setName("Tools").setHeading();

		for (const tool of TOOL_CONFIGS) {
			const installed = tool.isInstalled();
			const toolSettings = this.feature.settings.tools[tool.id] || {
				enabled: true,
				customPaths: [],
			};

			new Setting(containerEl)
				.setName(tool.name)
				.setDesc(installed ? "Installed" : "Not detected")
				.addToggle((toggle) =>
					toggle
						.setValue(installed && toolSettings.enabled)
						.setDisabled(!installed)
						.onChange(async (value) => {
						this.feature.settings.tools[tool.id] = {
								...toolSettings,
								enabled: value,
							};
							await this.feature.saveSettings();
							this.feature.refreshStore();
						})
				);
		}
	}
}
