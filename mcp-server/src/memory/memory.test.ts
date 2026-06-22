import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { makeMemoryOps } from "./memory.js";
import type { Operation, OperationContext } from "../core/types.js";

function makeHarness() {
  const root = join(tmpdir(), `llmwiki-memory-${randomUUID()}`);
  const ops = makeMemoryOps(root);
  const byName = new Map(ops.map((op) => [op.name, op]));
  const ctx: OperationContext = {
    vault: null as never,
    adapters: null,
    config: {
      vault_path: root,
      collaboration: { actor: "codex", role: "agent" },
    },
    logger: { info() {}, warn() {}, error() {} },
    dryRun: false,
  };
  const call = async (name: string, params: Record<string, unknown> = {}) => {
    const op = byName.get(name) as Operation | undefined;
    assert.ok(op, `missing op: ${name}`);
    return op.handler(ctx, params);
  };
  return { root, call };
}

describe("Markdown memory operations", () => {
  test("writes project passport using fixed template sections", async () => {
    const { root, call } = makeHarness();
    try {
      const result = await call("memory.passport.upsert", {
        project: "alpha",
        goal: "Ship memory",
        constraints: ["Do not change the Obsidian bridge"],
        decisions: ["Use markdown files"],
        openQuestions: ["Which plugin next?"],
        pointers: ["README.md"],
      }) as { path: string };

      assert.equal(result.path, "10-Projects/alpha/agents/codex/memory/passport.md");
      const content = readFileSync(join(root, result.path), "utf-8");
      for (const heading of ["## Goal", "## Constraints", "## Decisions", "## Open Questions", "## Pointers"]) {
        assert.ok(content.includes(heading), `missing ${heading}`);
      }
      assert.ok(content.includes("Ship memory"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("writes fallback handoff under Agent-Memory", async () => {
    const { root, call } = makeHarness();
    try {
      const result = await call("memory.handoff.write", {
        currentState: "Kanban adapter drafted",
        nextSteps: ["Run tests"],
        risks: ["Docs drift"],
        files: ["mcp-server/src/adapters/kanban.ts"],
      }) as { path: string };

      assert.equal(result.path, "00-Inbox/Agent-Memory/codex/handoff.md");
      const content = readFileSync(join(root, result.path), "utf-8");
      for (const heading of ["## Current State", "## Next Steps", "## Risks", "## Files"]) {
        assert.ok(content.includes(heading), `missing ${heading}`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("saves and lists session notes newest first", async () => {
    const { root, call } = makeHarness();
    try {
      const first = await call("memory.session.save", {
        project: "alpha",
        title: "First pass",
        summary: "Implemented memory operations",
      }) as { path: string };
      const second = await call("memory.session.save", {
        project: "alpha",
        title: "Second pass",
        summary: "Implemented kanban search",
        actions: ["Regenerate docs"],
      }) as { path: string };

      assert.ok(existsSync(join(root, first.path)));
      assert.ok(existsSync(join(root, second.path)));

      const list = await call("memory.session.list", { project: "alpha" }) as {
        count: number;
        sessions: Array<{ path: string; title: string }>;
      };
      assert.equal(list.count, 2);
      assert.ok(list.sessions.some((entry) => entry.title === "First pass"));
      assert.ok(list.sessions.some((entry) => entry.title === "Second pass"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Persistent key-value memory", () => {
  test("set, get, list, and forget still use _ai_memory.json", async () => {
    const { root, call } = makeHarness();
    try {
      await call("memory.set", { key: "project/status", value: "active", tags: ["project"] });
      const got = await call("memory.get", { tag: "project" }) as { count: number };
      assert.equal(got.count, 1);
      const listed = await call("memory.list") as { count: number };
      assert.equal(listed.count, 1);
      assert.ok(existsSync(join(root, "_ai_memory.json")));
      const forgotten = await call("memory.forget", { key: "project/status" }) as { ok: boolean };
      assert.equal(forgotten.ok, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
