import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileEvent } from "./adapters/interface.js";
import { VaultFileWatcher } from "./vault-watcher.js";

interface EventWaiter {
  predicate: (event: FileEvent) => boolean;
  resolve: (event: FileEvent) => void;
}

test("VaultFileWatcher reports relative markdown create, modify, and delete events", async () => {
  const root = mkdtempSync(join(tmpdir(), "llmwiki-watch-"));
  const existing = join(root, "notes", "existing.md");
  const created = join(root, "new", "created.md");
  mkdirSync(join(root, "notes"), { recursive: true });
  mkdirSync(join(root, "new"), { recursive: true });
  writeFileSync(existing, "before", "utf8");
  const waiters: EventWaiter[] = [];
  const watcher = new VaultFileWatcher({
    root,
    onEvent: (event) => {
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (!waiters[i].predicate(event)) continue;
        const [waiter] = waiters.splice(i, 1);
        waiter.resolve(event);
      }
    },
  });
  watcher.start();

  const waitForEvent = (predicate: EventWaiter["predicate"]): Promise<FileEvent> => {
    return new Promise((resolve) => {
      waiters.push({ predicate, resolve });
    });
  };

  try {
    const modified = waitForEvent((event) => event.type === "modify" && event.path === "notes/existing.md");
    writeFileSync(existing, "after", "utf8");
    await modified;

    const createdEvent = waitForEvent((event) => event.type === "create" && event.path === "new/created.md");
    writeFileSync(created, "created", "utf8");
    await createdEvent;

    const deleted = waitForEvent((event) => event.type === "delete" && event.path === "notes/existing.md");
    unlinkSync(existing);
    assert.equal((await deleted).oldPath, undefined);
  } finally {
    watcher.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test("VaultFileWatcher ignores protected and non-markdown paths", () => {
  const root = mkdtempSync(join(tmpdir(), "llmwiki-watch-ignore-"));
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, ".git", "ignored.md"), "ignored", "utf8");
  writeFileSync(join(root, "ignored.txt"), "ignored", "utf8");
  const events: FileEvent[] = [];
  const watcher = new VaultFileWatcher({ root, onEvent: (event) => events.push(event) });
  watcher.start();

  try {
    assert.deepEqual(events, []);
  } finally {
    watcher.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test("VaultFileWatcher reconciles markdown files in a newly arrived directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "llmwiki-watch-dir-"));
  const staging = mkdtempSync(join(tmpdir(), "llmwiki-watch-staging-"));
  const incoming = join(staging, "incoming");
  mkdirSync(incoming, { recursive: true });
  writeFileSync(join(incoming, "arrived.md"), "arrived", "utf8");
  let resolveCreate!: (event: FileEvent) => void;
  const waitForCreate = new Promise<FileEvent>((resolve) => {
    resolveCreate = resolve;
  });
  const watcher = new VaultFileWatcher({
    root,
    onEvent: (event) => {
      if (event.type === "create" && event.path === "incoming/arrived.md") resolveCreate(event);
    },
  });
  watcher.start();
  renameSync(incoming, join(root, "incoming"));

  try {
    await waitForCreate;
  } finally {
    watcher.stop();
    rmSync(root, { recursive: true, force: true });
    rmSync(staging, { recursive: true, force: true });
  }
});
