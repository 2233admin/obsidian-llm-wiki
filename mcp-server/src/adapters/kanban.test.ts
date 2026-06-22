import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { KanbanAdapter, parseKanbanMarkdown } from "./kanban.js";

const BOARD = [
  "---",
  "kanban-plugin: board",
  "---",
  "",
  "## Todo",
  "",
  "- [ ] Write memory layer ^mem1",
  "- [x] Finish docs",
  "",
  "***",
  "",
  "## Archive",
  "",
  "- [ ] Old archived task",
  "",
  "%% kanban:settings",
  "```",
  '{"ignored":"- [ ] not a card"}',
  "```",
  "%%",
  "",
].join("\n");

describe("Kanban markdown parser", () => {
  test("parses lanes, checked cards, archived cards, and block ids", () => {
    const board = parseKanbanMarkdown("Boards/Roadmap.md", BOARD);
    assert.ok(board);
    assert.deepEqual(board.lanes, ["Todo", "Archive"]);
    assert.equal(board.cards.length, 3);
    assert.deepEqual(board.cards[0], {
      title: "Write memory layer",
      lane: "Todo",
      checked: false,
      archived: false,
      blockId: "mem1",
    });
    assert.equal(board.cards[1].checked, true);
    assert.equal(board.cards[2].archived, true);
  });

  test("ignores non-kanban markdown", () => {
    assert.equal(parseKanbanMarkdown("Notes/plain.md", "# Plain\n\n- [ ] task"), null);
  });
});

describe("KanbanAdapter", () => {
  test("search returns board and card entities without indexing settings footer", async () => {
    const root = join(tmpdir(), `llmwiki-kanban-${randomUUID()}`);
    mkdirSync(join(root, "Boards"), { recursive: true });
    writeFileSync(join(root, "Boards", "Roadmap.md"), BOARD, "utf-8");
    writeFileSync(join(root, "plain.md"), "---\ntitle: Plain\n---\n\nWrite memory layer", "utf-8");

    try {
      const adapter = new KanbanAdapter({ vaultPath: root });
      await adapter.init();
      assert.equal(adapter.isAvailable, true);

      const cardResults = await adapter.search("Write memory");
      assert.equal(cardResults.some((r) => r.metadata?.entityType === "card"), true);
      const card = cardResults.find((r) => r.metadata?.entityType === "card");
      assert.equal(card?.metadata?.boardPath, "Boards/Roadmap.md");
      assert.equal(card?.metadata?.lane, "Todo");
      assert.equal(card?.metadata?.checked, false);
      assert.equal(card?.metadata?.archived, false);
      assert.equal(card?.metadata?.blockId, "mem1");

      const ignored = await adapter.search("not a card");
      assert.equal(ignored.length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
