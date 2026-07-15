/**
 * adapter-kanban -- read-only semantic search over Markdown-backed
 * Obsidian Kanban boards.
 *
 * The Obsidian Kanban plugin stores boards as plain markdown with
 * frontmatter `kanban-plugin: board`, lanes as `## Heading`, and cards as
 * task-list items. This adapter indexes that markdown shape directly.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type {
  AdapterCapability,
  SearchOpts,
  SearchResult,
  VaultMindAdapter,
} from "./interface.js";

const DEFAULT_GLOB = "**/*.md";
const PROTECTED_DIRS = new Set([".obsidian", ".trash", ".git", "node_modules"]);

export interface KanbanAdapterConfig {
  vaultPath: string;
  glob?: string;
}

export interface KanbanCard {
  title: string;
  lane: string;
  checked: boolean;
  archived: boolean;
  blockId?: string;
}

export interface KanbanBoard {
  path: string;
  lanes: string[];
  cards: KanbanCard[];
}

export function isKanbanBoardMarkdown(markdown: string): boolean {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return Boolean(frontmatter?.[1].match(/^kanban-plugin:\s*board\s*$/m));
}

export function parseKanbanMarkdown(path: string, markdown: string): KanbanBoard | null {
  if (!isKanbanBoardMarkdown(markdown)) return null;

  const withoutFrontmatter = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\s*/, "");
  const settingsStart = withoutFrontmatter.search(/^%% kanban:settings\s*$/m);
  const body = settingsStart === -1 ? withoutFrontmatter : withoutFrontmatter.slice(0, settingsStart);
  const lanes: string[] = [];
  const cards: KanbanCard[] = [];
  let currentLane = "";
  let archived = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim() === "***") {
      archived = true;
      continue;
    }

    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      currentLane = heading[1].trim();
      if (currentLane && !lanes.includes(currentLane)) lanes.push(currentLane);
      continue;
    }

    const card = line.match(/^\s*-\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (!card) continue;

    const block = card[2].match(/\s+\^([A-Za-z0-9-]+)\s*$/);
    const title = block ? card[2].slice(0, block.index).trim() : card[2].trim();
    cards.push({
      title,
      lane: currentLane,
      checked: card[1].toLowerCase() === "x",
      archived,
      ...(block ? { blockId: block[1] } : {}),
    });
  }

  return { path, lanes, cards };
}

export class KanbanAdapter implements VaultMindAdapter {
  readonly name = "kanban";
  readonly capabilities: readonly AdapterCapability[] = ["search"];

  private readonly vaultPath: string;
  private readonly glob: string;
  private available = false;

  constructor(config: KanbanAdapterConfig) {
    this.vaultPath = config.vaultPath;
    this.glob = config.glob ?? DEFAULT_GLOB;
  }

  get isAvailable(): boolean {
    return this.available;
  }

  async init(): Promise<void> {
    this.available = existsSync(this.vaultPath);
  }

  async dispose(): Promise<void> {
    this.available = false;
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    if (!this.available) return [];
    const maxResults = Math.max(1, Math.min(opts?.maxResults ?? 20, 100));
    const needle = opts?.caseSensitive ? query : query.toLowerCase();
    const results: SearchResult[] = [];

    for (const path of this.walkMarkdown()) {
      const content = readFileSync(join(this.vaultPath, path), "utf-8");
      const board = parseKanbanMarkdown(path, content);
      if (!board) continue;

      const boardText = [
        board.path,
        ...board.lanes,
        ...board.cards.map((card) => card.title),
      ].join(" ");

      if (this.matches(boardText, needle, opts?.caseSensitive ?? false)) {
        results.push({
          source: this.name,
          path: board.path,
          content: `Kanban board ${board.path}: ${board.cards.length} cards across ${board.lanes.length} lanes`,
          score: 0.82,
          metadata: {
            entityType: "board",
            boardPath: board.path,
            lane: "",
            checked: false,
            archived: false,
            lanes: board.lanes,
            cardCount: board.cards.length,
          },
        });
      }

      for (const card of board.cards) {
        const cardText = [card.title, card.lane, board.path, card.blockId ?? ""].join(" ");
        if (!this.matches(cardText, needle, opts?.caseSensitive ?? false)) continue;
        results.push({
          source: this.name,
          path: card.blockId ? `${board.path}#^${card.blockId}` : board.path,
          content: card.title,
          score: card.archived ? 0.72 : 0.92,
          metadata: {
            entityType: "card",
            boardPath: board.path,
            lane: card.lane,
            checked: card.checked,
            archived: card.archived,
            ...(card.blockId ? { blockId: card.blockId } : {}),
          },
        });
      }

      if (results.length >= maxResults) break;
    }

    return results.slice(0, maxResults);
  }

  private matches(text: string, query: string, caseSensitive: boolean): boolean {
    if (!query) return false;
    return (caseSensitive ? text : text.toLowerCase()).includes(query);
  }

  private walkMarkdown(): string[] {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!PROTECTED_DIRS.has(entry.name)) walk(join(dir, entry.name));
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const rel = relative(this.vaultPath, join(dir, entry.name)).replace(/\\/g, "/");
        if (this.matchGlob(rel)) files.push(rel);
      }
    };
    walk(this.vaultPath);
    return files.sort();
  }

  private matchGlob(path: string): boolean {
    if (this.glob === DEFAULT_GLOB) return path.endsWith(".md");
    const escaped = this.glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "\0")
      .replace(/\*/g, "[^/]*")
      .replace(/\0/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`).test(path);
  }
}
