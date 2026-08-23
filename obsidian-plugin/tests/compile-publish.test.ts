import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  compilePublishResultFromStatusReport,
  compilerRepoRootFromKbMetaPath,
  createExecFileCompilePublishRunner,
  ExecFileAsync,
  lastPublishLabel,
  lastRunTimestampLabel,
  parseCompilePublishStdout,
  readCompilePublishStatus,
  resolveStateDir,
  statusFilePath,
  summarizeOutcome,
  todaysCostLabel,
  type CompilePublishReport,
  type CompilePublishRunResult,
  type StatusFileReader,
} from "../src/compile-publish";

const FIXTURE_ROOT = resolve(process.cwd(), "test-fixture");
const KB_META_PATH = join(FIXTURE_ROOT, "compiler", "kb_meta.py");
const REPO_ROOT = FIXTURE_ROOT;
const VAULT_PATH = join(FIXTURE_ROOT, "knowledge");
const HOME_DIR = join(FIXTURE_ROOT, "home");
const CUSTOM_STATE_DIR = join(FIXTURE_ROOT, "custom-state");
const STATE_DIR = join(FIXTURE_ROOT, "state");

test("compilerRepoRootFromKbMetaPath derives the repo root two levels up from compiler/kb_meta.py", () => {
  assert.equal(compilerRepoRootFromKbMetaPath(KB_META_PATH), REPO_ROOT);
});

test("parseCompilePublishStdout accepts a JSON object and rejects everything else without throwing", () => {
  assert.deepEqual(parseCompilePublishStdout('{"outcome":"PUBLISHED"}'), { outcome: "PUBLISHED" });
  assert.equal(parseCompilePublishStdout(""), null);
  assert.equal(parseCompilePublishStdout("   "), null);
  assert.equal(parseCompilePublishStdout("not json"), null);
  assert.equal(parseCompilePublishStdout("[1,2,3]"), null);
  assert.equal(parseCompilePublishStdout("42"), null);
  assert.equal(parseCompilePublishStdout("null"), null);
});

interface FakeCall {
  file: string;
  args: string[];
  cwd: string;
}

function fakeExecFileAsync(
  behavior: (call: FakeCall) => { stdout: string; stderr?: string } | never,
): { calls: FakeCall[]; execFileAsync: ExecFileAsync } {
  const calls: FakeCall[] = [];
  const execFileAsync: ExecFileAsync = async (file, args, options) => {
    calls.push({ file, args: [...args], cwd: options.cwd });
    const result = behavior({ file, args: [...args], cwd: options.cwd });
    return { stdout: result.stdout, stderr: result.stderr ?? "" };
  };
  return { calls, execFileAsync };
}

test("runner composes the fixed CLI contract and resolves cwd to the compiler package's parent", async () => {
  const { calls, execFileAsync } = fakeExecFileAsync(() => ({ stdout: '{"outcome":"PUBLISHED"}' }));
  const runner = createExecFileCompilePublishRunner({
    pythonCommand: "python",
    kbMetaPath: KB_META_PATH,
    execFileAsync,
  });

  const result = await runner.run({ vaultPath: VAULT_PATH });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, "python");
  assert.deepEqual(calls[0].args, ["-m", "compiler.lmvk_publish", VAULT_PATH, "--format", "json"]);
  assert.equal(calls[0].cwd, REPO_ROOT);
  assert.equal(result.exitCode, 0);
  assert.equal(result.dryRun, false);
  assert.deepEqual(result.report, { outcome: "PUBLISHED" });
  assert.equal(typeof result.invokedAt, "string");
  assert.equal(typeof result.finishedAt, "string");
});

test("runner appends --dry-run and --full only when requested, always before --format json", async () => {
  const { calls, execFileAsync } = fakeExecFileAsync(() => ({ stdout: "{}" }));
  const runner = createExecFileCompilePublishRunner({
    pythonCommand: "python",
    kbMetaPath: KB_META_PATH,
    execFileAsync,
  });

  await runner.run({ vaultPath: VAULT_PATH, dryRun: true, full: true });
  assert.deepEqual(calls[0].args, [
    "-m", "compiler.lmvk_publish", VAULT_PATH, "--full", "--dry-run", "--format", "json",
  ]);
});

test("runner parses a user-configured interpreter with extra flags (e.g. 'py -3') via buildPythonInvocation", async () => {
  const { calls, execFileAsync } = fakeExecFileAsync(() => ({ stdout: "{}" }));
  const runner = createExecFileCompilePublishRunner({
    pythonCommand: "py -3",
    kbMetaPath: KB_META_PATH,
    execFileAsync,
  });

  await runner.run({ vaultPath: VAULT_PATH });
  assert.equal(calls[0].file, "py");
  assert.deepEqual(calls[0].args.slice(0, 4), ["-3", "-m", "compiler.lmvk_publish", VAULT_PATH]);
});

test("runner recovers structured JSON from stdout even when the process exits non-zero (real failure convention)", async () => {
  const execFileAsync: ExecFileAsync = async () => {
    const error = new Error("Command failed") as Error & { stdout: string; code: number };
    error.stdout = '{"outcome":"ERROR","error":"pages branch push rejected"}';
    error.code = 1;
    throw error;
  };
  const runner = createExecFileCompilePublishRunner({
    pythonCommand: "python",
    kbMetaPath: KB_META_PATH,
    execFileAsync,
  });

  const result = await runner.run({ vaultPath: VAULT_PATH });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.report, { outcome: "ERROR", error: "pages branch push rejected" });
  assert.equal(result.invocationError, undefined);
});

test("runner falls back to invocationError when nothing usable comes back at all (e.g. spawn failure)", async () => {
  const execFileAsync: ExecFileAsync = async () => {
    throw new Error("spawn python ENOENT");
  };
  const runner = createExecFileCompilePublishRunner({
    pythonCommand: "python",
    kbMetaPath: KB_META_PATH,
    execFileAsync,
  });

  const result = await runner.run({ vaultPath: VAULT_PATH });
  assert.equal(result.report, null);
  assert.equal(result.invocationError, "spawn python ENOENT");
});

test("runner rejects a non-absolute kb_meta path before ever invoking the subprocess", async () => {
  const { calls, execFileAsync } = fakeExecFileAsync(() => ({ stdout: "{}" }));
  const runner = createExecFileCompilePublishRunner({
    pythonCommand: "python",
    kbMetaPath: "compiler/kb_meta.py",
    execFileAsync,
  });

  const result = await runner.run({ vaultPath: VAULT_PATH });
  assert.equal(calls.length, 0);
  assert.match(result.invocationError ?? "", /absolute/);
});

function baseResult(overrides: Partial<CompilePublishRunResult> = {}): CompilePublishRunResult {
  return {
    invokedAt: "2026-08-16T00:00:00.000Z",
    finishedAt: "2026-08-16T00:00:05.000Z",
    dryRun: false,
    full: false,
    exitCode: 0,
    report: null,
    rawStdout: "",
    ...overrides,
  };
}

test("summarizeOutcome: the guaranteed 'skipped' marker wins even on exit 0", () => {
  const result = baseResult({ report: { skipped: "locked" } });
  assert.equal(summarizeOutcome(result), "Skipped (locked)");
});

test("summarizeOutcome: non-zero exit or invocationError reads as Failed", () => {
  assert.equal(summarizeOutcome(baseResult({ exitCode: 1, report: { error: "push rejected" } })), "Failed — push rejected");
  assert.equal(summarizeOutcome(baseResult({ exitCode: 1, report: null })), "Failed (exit 1)");
  assert.equal(summarizeOutcome(baseResult({ exitCode: null, invocationError: "spawn failed" })), "Failed — spawn failed");
});

test("summarizeOutcome: exit 0 with no skip/error reads as Success, using an outcome field if present", () => {
  assert.equal(summarizeOutcome(baseResult({ report: { outcome: "PUBLISHED" } })), "Success (PUBLISHED)");
  assert.equal(summarizeOutcome(baseResult({ report: null })), "Success");
});

test("lastRunTimestampLabel uses the client-captured finishedAt, independent of report schema", () => {
  assert.equal(lastRunTimestampLabel(null), "—");
  assert.equal(lastRunTimestampLabel(baseResult()), "2026-08-16T00:00:05.000Z");
});

test("todaysCostLabel prefers cost_guard.py's real 'spent_today' field and degrades gracefully otherwise", () => {
  assert.equal(todaysCostLabel(null), "—");
  assert.equal(todaysCostLabel(baseResult({ report: null })), "—");
  assert.equal(todaysCostLabel(baseResult({ report: { spent_today: 1.5 } })), "$1.5000");
  assert.equal(todaysCostLabel(baseResult({ report: { cost_today_usd: 0.02 } })), "$0.0200");
  assert.equal(todaysCostLabel(baseResult({ report: { spent_today: "not a number" } })), "—");
});

// ---------------------------------------------------------------------------
// Real schema (compiler/lmvk_publish.py, read directly: _empty_result() /
// run_pipeline()). Nested cost_guard.spent_today_usd and last_success.{at,
// commit}, plus top-level status/skipped_reason/error -- NOT the flat guessed
// keys above, which stay only as a fallback in case the schema moves again.
// ---------------------------------------------------------------------------

function realReport(overrides: Partial<CompilePublishReport> = {}): CompilePublishReport {
  return {
    schema_version: 1,
    status: "ok",
    skipped_reason: null,
    full: false,
    dry_run: false,
    started_at: "2026-08-16T00:00:00Z",
    completed_at: "2026-08-16T00:00:05Z",
    vault_head_before: "aaa",
    vault_head_after: "bbb",
    compile: { ran: false, skipped_reason: null, sources_compiled: 0, estimated_cost_usd: 0.0 },
    cost_guard: { spent_today_usd: 0.04, daily_cap_usd: 5.0 },
    html_export: null,
    publish: null,
    last_success: { at: "2026-08-15T00:00:00Z", commit: "deadbeef" },
    error: null,
    ...overrides,
  };
}

test("summarizeOutcome reads the real status field: skipped/locked and skipped/head-unchanged are Skipped, not Failed", () => {
  assert.equal(
    summarizeOutcome(baseResult({ report: realReport({ status: "skipped", skipped_reason: "locked" }) })),
    "Skipped (locked)",
  );
  assert.equal(
    summarizeOutcome(baseResult({
      exitCode: 0,
      report: realReport({ status: "skipped", skipped_reason: "head-unchanged" }),
    })),
    "Skipped (head-unchanged)",
  );
});

test("summarizeOutcome reads the real status field: status 'error' with an error string is Failed", () => {
  assert.equal(
    summarizeOutcome(baseResult({ exitCode: 1, report: realReport({ status: "error", error: "git push rejected" }) })),
    "Failed — git push rejected",
  );
});

test("summarizeOutcome reads the real status field: status 'ok' is Success", () => {
  assert.equal(summarizeOutcome(baseResult({ report: realReport() })), "Success");
});

test("todaysCostLabel and lastPublishLabel read the real nested cost_guard/last_success shape", () => {
  const result = baseResult({ report: realReport() });
  assert.equal(todaysCostLabel(result), "$0.0400");
  assert.deepEqual(lastPublishLabel(result), { at: "2026-08-15T00:00:00Z", commit: "deadbeef" });
});

test("resolveStateDir prefers a non-empty setting and falls back to <home>/.claude/state otherwise", () => {
  assert.equal(resolveStateDir(CUSTOM_STATE_DIR, HOME_DIR), CUSTOM_STATE_DIR);
  assert.equal(resolveStateDir("", HOME_DIR), join(HOME_DIR, ".claude", "state"));
  assert.equal(resolveStateDir(null, HOME_DIR), join(HOME_DIR, ".claude", "state"));
  assert.equal(resolveStateDir("   ", HOME_DIR), join(HOME_DIR, ".claude", "state"));
});

test("statusFilePath joins the state dir with the fixed file name lmvk_publish.py itself writes", () => {
  assert.equal(statusFilePath(STATE_DIR), join(STATE_DIR, "lmvk-publish-status.json"));
});

test("compilePublishResultFromStatusReport maps status 'error' to exitCode 1 and everything else to 0, tagged as status-file", () => {
  const ok = compilePublishResultFromStatusReport(realReport());
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.source, "status-file");
  assert.equal(ok.invokedAt, "2026-08-16T00:00:00Z");
  assert.equal(ok.finishedAt, "2026-08-16T00:00:05Z");

  const errored = compilePublishResultFromStatusReport(realReport({ status: "error", error: "boom" }));
  assert.equal(errored.exitCode, 1);
});

function fakeStatusFileReader(behavior: (path: string) => string | null): StatusFileReader {
  return { async read(path: string) { return behavior(path); } };
}

test("readCompilePublishStatus reads the status file at the resolved path and parses it into a result", async () => {
  const seenPaths: string[] = [];
  const reader = fakeStatusFileReader(path => {
    seenPaths.push(path);
    return JSON.stringify(realReport());
  });
  const result = await readCompilePublishStatus(reader, STATE_DIR, HOME_DIR);
  assert.deepEqual(seenPaths, [join(STATE_DIR, "lmvk-publish-status.json")]);
  assert.ok(result);
  assert.equal(result?.source, "status-file");
  assert.deepEqual(result?.report, realReport());
});

test("readCompilePublishStatus degrades to null (never throws) when the file is missing or unparseable", async () => {
  assert.equal(await readCompilePublishStatus(fakeStatusFileReader(() => null), STATE_DIR, HOME_DIR), null);
  assert.equal(await readCompilePublishStatus(fakeStatusFileReader(() => "not json"), STATE_DIR, HOME_DIR), null);
  assert.equal(await readCompilePublishStatus(fakeStatusFileReader(() => "[]"), STATE_DIR, HOME_DIR), null);
});

test("lastPublishLabel degrades each field independently to em-dash", () => {
  assert.deepEqual(lastPublishLabel(null), { at: "—", commit: "—" });
  assert.deepEqual(lastPublishLabel(baseResult({ report: {} })), { at: "—", commit: "—" });
  assert.deepEqual(
    lastPublishLabel(baseResult({ report: { published_at: "2026-08-16T00:00:00Z", commit: "abc123" } })),
    { at: "2026-08-16T00:00:00Z", commit: "abc123" },
  );
  assert.deepEqual(
    lastPublishLabel(baseResult({ report: { vault_head_after: "deadbeef" } })),
    { at: "—", commit: "deadbeef" },
  );
});
