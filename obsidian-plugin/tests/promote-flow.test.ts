import test from "node:test";
import assert from "node:assert/strict";
import type { App, TFile } from "obsidian";
import { FileSystemAdapter, Notice } from "obsidian";
import LLMWikiPlugin from "../src/main";
import type { SettingsControlPlaneProjection } from "../src/settings-client";

type PromoteResult = {
  outcome: string;
  reason?: string;
  error?: string;
};

type ExecCall = {
  executable: string;
  args: string[];
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    windowsHide?: boolean;
  };
};

class TestFileSystemAdapter extends FileSystemAdapter {
  constructor(private readonly basePath: string) {
    super();
  }

  override getBasePath(): string {
    return this.basePath;
  }
}

class PromoteTestPlugin extends LLMWikiPlugin {
  readonly execCalls: ExecCall[] = [];
  confirmationCount = 0;
  confirm: (() => Promise<void>) | undefined;
  cancel: (() => void) | undefined;

  constructor(basePath = "C:/vault") {
    super(
      {
        vault: { adapter: new TestFileSystemAdapter(basePath) },
        workspace: { on: () => ({}), getActiveFile: () => null },
      } as unknown as App,
      { id: "obsidian-llm-wiki", dir: ".obsidian/plugins/obsidian-llm-wiki" },
    );
    this.projection = {
      snapshot: {
        effective: [
          { key: "runtime.python.path", value: "python -3" },
          { key: "runtime.kb_meta.path", value: "C:/runtime/kb_meta.py" },
        ],
      },
    } as unknown as SettingsControlPlaneProjection;
  }

  protected override async execFile(
    executable: string,
    args: string[],
    options: ExecCall["options"],
  ): Promise<{ stdout: string }> {
    this.execCalls.push({ executable, args, options });
    return { stdout: JSON.stringify({ outcome: "MATERIALIZED" }) };
  }

  protected override openPromoteConfirmation(
    _noteId: string,
    _result: PromoteResult,
    onConfirm: () => Promise<void>,
    onCancel: () => void,
  ): void {
    this.confirmationCount += 1;
    this.confirm = onConfirm;
    this.cancel = onCancel;
  }
}

function note(path = "drafts/candidate.md"): TFile {
  return { path, extension: "md" } as TFile;
}

function promote(plugin: PromoteTestPlugin, file = note()): Promise<void> {
  return (plugin as unknown as { promote(file: TFile): Promise<void> }).promote(file);
}

function stubRunPromote(plugin: PromoteTestPlugin, results: PromoteResult[]): boolean[] {
  const applies: boolean[] = [];
  (plugin as unknown as {
    runPromote(noteId: string, apply: boolean): Promise<PromoteResult>;
  }).runPromote = async (_noteId, apply) => {
    applies.push(apply);
    const result = results.shift();
    if (!result) throw new Error("unexpected promote invocation");
    return result;
  };
  return applies;
}

test("promote: dry-run ERROR does not open confirmation or apply", async () => {
  Notice.messages = [];
  const plugin = new PromoteTestPlugin();
  const applies = stubRunPromote(plugin, [{ outcome: "ERROR", error: "dry-run failed" }]);

  await promote(plugin);

  assert.deepEqual(applies, [false]);
  assert.equal(plugin.confirmationCount, 0);
  assert.equal(plugin.confirm, undefined);
  assert.deepEqual(Notice.messages, ["Detecting draft…", "LLM Wiki: dry-run failed"]);
});

test("promote: non-MATERIALIZED dry-run does not open confirmation or apply", async () => {
  Notice.messages = [];
  const plugin = new PromoteTestPlugin();
  const applies = stubRunPromote(plugin, [{ outcome: "DRAFT", reason: "candidate is incomplete" }]);

  await promote(plugin);

  assert.deepEqual(applies, [false]);
  assert.equal(plugin.confirmationCount, 0);
  assert.equal(plugin.confirm, undefined);
  assert.deepEqual(Notice.messages, [
    "Detecting draft…",
    "LLM Wiki: cannot promote — DRAFT: candidate is incomplete",
  ]);
});

test("promote: MATERIALIZED dry-run opens confirmation and apply runs exactly once", async () => {
  Notice.messages = [];
  const plugin = new PromoteTestPlugin();
  const applies = stubRunPromote(plugin, [
    { outcome: "MATERIALIZED" },
    { outcome: "MATERIALIZED" },
  ]);

  await promote(plugin);
  assert.equal(plugin.confirmationCount, 1);
  assert.ok(plugin.confirm);
  assert.ok(plugin.cancel);

  plugin.cancel();
  assert.deepEqual(applies, [false]);

  await plugin.confirm();

  assert.deepEqual(applies, [false, true]);
  assert.deepEqual(Notice.messages, ["Detecting draft…", "Writing…", "Promoted successfully"]);
});

test("promote: runPromote invokes configured executable with argv, cwd, and UTF-8 environment", async () => {
  const plugin = new PromoteTestPlugin("C:/vault/root");

  const result = await (plugin as unknown as {
    runPromote(noteId: string, apply: boolean): Promise<PromoteResult>;
  }).runPromote("drafts/candidate.md", true);

  assert.deepEqual(result, { outcome: "MATERIALIZED" });
  assert.equal(plugin.execCalls.length, 1);
  assert.deepEqual(plugin.execCalls[0], {
    executable: "python",
    args: ["-3", "C:/runtime/kb_meta.py", "promote", "--note", "drafts/candidate.md", "--apply"],
    options: {
      cwd: "C:/vault/root",
      env: { ...process.env, PYTHONUTF8: "1" },
      windowsHide: true,
    },
  });
});

test("promote: apply success reports a success notice", async () => {
  Notice.messages = [];
  const plugin = new PromoteTestPlugin();
  stubRunPromote(plugin, [{ outcome: "MATERIALIZED" }, { outcome: "MATERIALIZED" }]);

  await promote(plugin);
  assert.ok(plugin.confirm);
  await plugin.confirm();

  assert.equal(Notice.messages.at(-1), "Promoted successfully");
});

test("promote: apply failure reports a failure notice", async () => {
  Notice.messages = [];
  const plugin = new PromoteTestPlugin();
  stubRunPromote(plugin, [
    { outcome: "MATERIALIZED" },
    { outcome: "ERROR", error: "write rejected" },
  ]);

  await promote(plugin);
  assert.ok(plugin.confirm);
  await plugin.confirm();

  assert.deepEqual(Notice.messages, [
    "Detecting draft…",
    "Writing…",
    "LLM Wiki: promote failed — write rejected",
  ]);
});

test("promote: JSON stdout from a failed apply is returned as the result", async () => {
  const plugin = new PromoteTestPlugin();
  (plugin as unknown as { execFile: typeof plugin.execFile }).execFile = async () => {
    const error = Object.assign(new Error("command failed"), {
      stdout: JSON.stringify({ outcome: "ERROR", error: "invalid snapshot" }),
    });
    throw error;
  };

  const result = await (plugin as unknown as {
    runPromote(noteId: string, apply: boolean): Promise<PromoteResult>;
  }).runPromote("drafts/candidate.md", true);

  assert.deepEqual(result, { outcome: "ERROR", error: "invalid snapshot" });
});

test("promote: relative kb_meta path fails closed without invoking the runner", async () => {
  const plugin = new PromoteTestPlugin();
  plugin.projection = {
    snapshot: {
      effective: [
        { key: "runtime.python.path", value: "python" },
        { key: "runtime.kb_meta.path", value: "relative/kb_meta.py" },
      ],
    },
  } as unknown as SettingsControlPlaneProjection;

  const result = await (plugin as unknown as {
    runPromote(noteId: string, apply: boolean): Promise<PromoteResult>;
  }).runPromote("drafts/candidate.md", false);

  assert.deepEqual(result, { outcome: "ERROR", error: "Set an absolute LLM Wiki runtime entry in Settings Platform." });
  assert.equal(plugin.execCalls.length, 0);
});

test("promote: non-filesystem vault fails closed without invoking the runner", async () => {
  const plugin = new PromoteTestPlugin();
  (plugin.app as { vault: { adapter: object } }).vault.adapter = {};

  const result = await (plugin as unknown as {
    runPromote(noteId: string, apply: boolean): Promise<PromoteResult>;
  }).runPromote("drafts/candidate.md", false);

  assert.deepEqual(result, { outcome: "ERROR", error: "Vault is not on the local filesystem (desktop only)." });
  assert.equal(plugin.execCalls.length, 0);
});
