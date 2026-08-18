import { readdirSync, readFileSync, existsSync, statSync, createReadStream } from "fs";
import { join, basename, sep } from "path";
import { homedir } from "os";
import { createInterface } from "readline";
import type { ConversationItem, ConversationMessage } from "../types";

const CLAUDE_DIR = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_LINES_PER_FILE = 500;

function readableProjectName(encoded: string): string {
	const homeParts = homedir().split(sep).filter(Boolean);
	const encodedHome = homeParts.join("-");
	let name = encoded;
	if (name.startsWith(encodedHome + "-")) {
		name = name.slice(encodedHome.length + 1);
	} else if (name.startsWith("-")) {
		name = name.slice(1);
		const homePrefix = homeParts.join("-") + "-";
		if (name.startsWith(homePrefix)) {
			name = name.slice(homePrefix.length);
		}
	}
	const parts = name.split("-").filter(Boolean);
	if (parts.length <= 2) return parts.join("-") || "root";
	return parts.slice(-2).join("-");
}

function extractText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			if (typeof block === "object" && block !== null) {
				const b = block as Record<string, unknown>;
				if (b.type === "text" && typeof b.text === "string") {
					parts.push(b.text);
				}
			}
		}
		return parts.join("\n");
	}
	return "";
}

function extractToolCalls(content: unknown): string[] {
	if (!Array.isArray(content)) return [];
	const tools: string[] = [];
	for (const block of content) {
		if (typeof block === "object" && block !== null) {
			const b = block as Record<string, unknown>;
			if (b.type === "tool_use" && typeof b.name === "string") {
				tools.push(b.name);
			}
		}
	}
	return tools;
}

function extractMessages(lines: string[]): {
	messages: ConversationMessage[];
	firstTimestamp: string;
	lastTimestamp: string;
} {
	const messages: ConversationMessage[] = [];
	let firstTimestamp = "";
	let lastTimestamp = "";

	for (const line of lines) {
		try {
			const entry = JSON.parse(line) as Record<string, unknown>;
			const ts = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
			if (ts) {
				if (!firstTimestamp) firstTimestamp = ts;
				lastTimestamp = ts;
			}

			if (entry.type === "user") {
				const msg = entry.message as { role?: string; content?: unknown } | undefined;
				if (!msg) continue;
				const text = extractText(msg.content);
				if (text) {
					messages.push({ role: "human", text, timestamp: ts || "" });
				}
			}

			if (entry.type === "assistant") {
				const msg = entry.message as { role?: string; content?: unknown } | undefined;
				if (!msg) continue;
				const text = extractText(msg.content);
				const toolCalls = extractToolCalls(msg.content);
				if (text) {
					messages.push({
						role: "assistant",
						text,
						timestamp: ts || "",
						toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
					});
				}
			}
		} catch { /* skip malformed */ }
	}

	return { messages, firstTimestamp, lastTimestamp };
}

interface ConversationMeta {
	uuid: string;
	project: string;
	projectPath: string;
	filePath: string;
	fileSize: number;
}

function collectMeta(): ConversationMeta[] {
	const metas: ConversationMeta[] = [];
	if (!existsSync(PROJECTS_DIR)) return metas;

	let projectDirs: string[];
	try { projectDirs = readdirSync(PROJECTS_DIR); } catch { return metas; }

	for (const projDir of projectDirs) {
		const projPath = join(PROJECTS_DIR, projDir);
		try { if (!statSync(projPath).isDirectory()) continue; } catch { continue; }

		const projectName = readableProjectName(projDir);
		let files: string[];
		try { files = readdirSync(projPath).filter((f) => f.endsWith(".jsonl")); } catch { continue; }

		for (const file of files) {
			const filePath = join(projPath, file);
			try {
				const stat = statSync(filePath);
				metas.push({
					uuid: basename(file, ".jsonl"),
					project: projectName,
					projectPath: projPath,
					filePath,
					fileSize: stat.size,
				});
			} catch { continue; }
		}
	}

	return metas;
}

function parseFileSync(meta: ConversationMeta): ConversationItem | null {
	try {
		const raw = readFileSync(meta.filePath, "utf-8");
		const allLines = raw.split("\n").filter((l) => l.trim());
		if (allLines.length === 0) return null;

		const lines = allLines.length > MAX_LINES_PER_FILE
			? allLines.slice(0, MAX_LINES_PER_FILE)
			: allLines;

		const { messages, firstTimestamp, lastTimestamp } = extractMessages(lines);
		if (messages.length === 0) return null;

		const firstHuman = messages.find((m) => m.role === "human");
		const title = firstHuman
			? firstHuman.text.slice(0, 120).replace(/\n/g, " ")
			: "(empty conversation)";

		return {
			id: meta.uuid,
			uuid: meta.uuid,
			project: meta.project,
			projectPath: meta.projectPath,
			title,
			messages,
			messageCount: messages.length,
			firstTimestamp,
			lastTimestamp,
			tags: [],
			customTags: [],
			isFavorite: false,
			filePath: meta.filePath,
		};
	} catch { return null; }
}

async function parseFileAsync(meta: ConversationMeta): Promise<ConversationItem | null> {
	return new Promise((resolve) => {
		const messages: ConversationMessage[] = [];
		let firstTimestamp = "";
		let lastTimestamp = "";
		let lineCount = 0;

		const rl = createInterface({
			input: createReadStream(meta.filePath, { encoding: "utf-8" }),
			crlfDelay: Number.POSITIVE_INFINITY,
		});

		rl.on("line", (line) => {
			if (!line.trim()) return;
			lineCount++;
			if (lineCount > MAX_LINES_PER_FILE) { rl.close(); return; }

			try {
				const entry = JSON.parse(line) as Record<string, unknown>;
				const ts = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
				if (ts) {
					if (!firstTimestamp) firstTimestamp = ts;
					lastTimestamp = ts;
				}

				if (entry.type === "user") {
					const msg = entry.message as { content?: unknown } | undefined;
					if (!msg) return;
					const text = extractText(msg.content);
					if (text) messages.push({ role: "human", text, timestamp: ts || "" });
				}

				if (entry.type === "assistant") {
					const msg = entry.message as { content?: unknown } | undefined;
					if (!msg) return;
					const text = extractText(msg.content);
					const toolCalls = extractToolCalls(msg.content);
					if (text) {
						messages.push({
							role: "assistant", text, timestamp: ts || "",
							toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
						});
					}
				}
			} catch { /* skip */ }
		});

		rl.on("close", () => {
			if (messages.length === 0) { resolve(null); return; }
			const firstHuman = messages.find((m) => m.role === "human");
			const title = firstHuman
				? firstHuman.text.slice(0, 120).replace(/\n/g, " ")
				: "(empty conversation)";

			resolve({
				id: meta.uuid,
				uuid: meta.uuid,
				project: meta.project,
				projectPath: meta.projectPath,
				title,
				messages,
				messageCount: messages.length,
				firstTimestamp,
				lastTimestamp,
				tags: [],
				customTags: [],
				isFavorite: false,
				filePath: meta.filePath,
			});
		});

		rl.on("error", () => resolve(null));
	});
}

export function parseAllConversationsSync(): ConversationItem[] {
	const metas = collectMeta();
	const small = metas.filter((m) => m.fileSize <= MAX_FILE_SIZE);
	small.sort((a, b) => b.fileSize - a.fileSize);

	const conversations: ConversationItem[] = [];
	for (const meta of small) {
		const item = parseFileSync(meta);
		if (item) conversations.push(item);
	}

	conversations.sort((a, b) => (b.lastTimestamp || "").localeCompare(a.lastTimestamp || ""));
	return conversations;
}

export async function parseAllConversationsAsync(): Promise<ConversationItem[]> {
	const metas = collectMeta();
	const conversations: ConversationItem[] = [];
	const BATCH_SIZE = 20;

	metas.sort((a, b) => b.fileSize - a.fileSize);

	for (let i = 0; i < metas.length; i += BATCH_SIZE) {
		const batch = metas.slice(i, i + BATCH_SIZE);
		const results = await Promise.all(
			batch.map((meta) =>
				meta.fileSize > MAX_FILE_SIZE
					? parseFileAsync(meta)
					: Promise.resolve(parseFileSync(meta))
			)
		);
		for (const r of results) {
			if (r) conversations.push(r);
		}
	}

	conversations.sort((a, b) => (b.lastTimestamp || "").localeCompare(a.lastTimestamp || ""));
	return conversations;
}




