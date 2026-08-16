/*
 * LMVK L2 "compile & publish" leg -- manual trigger support for the plugin.
 *
 * Call contract (fixed, do not change without updating compiler/lmvk_publish.py
 * in lockstep):
 *
 *   python -m compiler.lmvk_publish <vault_path> [--full] [--dry-run] --format json
 *
 * - stdout is a single JSON blob; human-readable logging goes to stderr.
 * - Exit code 0 = success, INCLUDING the two normal early-exit cases ("HEAD
 *   unchanged, skipped" and "could not acquire lock, skipped"). Non-zero =
 *   a real failure, but stdout still carries a structured JSON blob on
 *   failure too (same convention as compiler/kb_meta.py's promote command,
 *   see runPromote in main.ts).
 * - cwd for the subprocess must be the repository root that CONTAINS the
 *   `compiler` package (so `-m compiler.lmvk_publish` resolves), i.e. the
 *   parent directory of the directory holding kb_meta.py. This mirrors
 *   scripts/lmvk-compile-publish.ps1's Push-Location $CompilerDir before
 *   `-m html_export.exporter` (that module lives one level shallower than
 *   compiler.lmvk_publish, hence one extra dirname() here).
 *
 * SCHEMA NOTE: compiler/lmvk_publish.py did not exist on disk when this file
 * was first written; it landed mid-task (concurrent Python-side work). Its
 * result dict (verified by reading _empty_result()/run_pipeline() directly,
 * schema_version=1 at time of writing) is:
 *   {
 *     schema_version, status: "ok"|"skipped"|"error",
 *     skipped_reason: null|"locked"|"head-unchanged",
 *     full, dry_run, started_at, completed_at,
 *     vault_head_before, vault_head_after,
 *     compile: { ran, skipped_reason: null|"cost-cap", sources_compiled, estimated_cost_usd },
 *     cost_guard: { spent_today_usd, daily_cap_usd },
 *     html_export: {...}|null, publish: {...}|null,
 *     last_success: { at, commit }, error: string|null,
 *   }
 * The SAME dict is both the stdout JSON blob and the on-disk status file
 * (state_dir/lmvk-publish-status.json, by that module's own design comment
 * "don't write two schemas") -- see readCompilePublishStatus() below.
 * Still, treat this as a snapshot, not a contract: every accessor below
 * tries the real key first, then a short list of plausible aliases, then
 * degrades to "unknown" rather than throwing, in case the schema moves
 * again before this lands.
 */

import { dirname, isAbsolute, join } from "path";
import { promises as fsPromises } from "fs";
import { buildPythonInvocation } from "./executable-command";

/** Loosely-typed JSON blob parsed from compiler.lmvk_publish's stdout. Field
 * names are not final -- see the module doc comment. Callers must never
 * assume a key exists. */
export interface CompilePublishReport {
  [key: string]: unknown;
}

export interface CompilePublishRunOptions {
  vaultPath: string;
  dryRun?: boolean;
  full?: boolean;
}

/** Result of one manual trigger, as observed by the plugin. `invokedAt` /
 * `finishedAt` are captured client-side (Obsidian's own clock), so the
 * "last run time" fact never depends on the still-unsettled JSON schema. */
export interface CompilePublishRunResult {
  invokedAt: string;
  finishedAt: string;
  dryRun: boolean;
  full: boolean;
  /** Process exit code, or null if the process could not be started/exec'd
   * at all (e.g. bad interpreter path) so no exit code exists. */
  exitCode: number | null;
  /** Parsed JSON report, or null if stdout was empty/unparseable. */
  report: CompilePublishReport | null;
  rawStdout: string;
  rawStderr?: string;
  /** Set only when nothing usable came back at all (no JSON could be
   * recovered from stdout, e.g. a spawn failure before the interpreter ran). */
  invocationError?: string;
  /** "session" (default, implicit): this plugin invoked the subprocess and
   * captured its stdout directly, in this Obsidian session. "status-file":
   * read from the on-disk status snapshot the Python side maintains, so it
   * may reflect a schtasks-triggered run or a prior Obsidian session. */
  source?: "session" | "status-file";
}

export interface CompilePublishRunner {
  run(options: CompilePublishRunOptions): Promise<CompilePublishRunResult>;
}

function toText(value: string | Buffer): string {
  return typeof value === "string" ? value : value.toString("utf8");
}

/** Repository root that must contain the `compiler` package for
 * `-m compiler.lmvk_publish` to resolve. kbMetaPath is expected to be an
 * absolute path to compiler/kb_meta.py (runtime.kb_meta.path), so the repo
 * root is two directories up. */
export function compilerRepoRootFromKbMetaPath(kbMetaPath: string): string {
  return dirname(dirname(kbMetaPath));
}

/** Parses a single JSON object from stdout. Returns null (never throws) if
 * the text is empty, not valid JSON, or not a JSON object (e.g. an array or
 * a bare scalar) -- any of which should degrade the UI, not crash it. */
export function parseCompilePublishStdout(text: string): CompilePublishReport | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as CompilePublishReport;
    }
    return null;
  } catch {
    return null;
  }
}

export interface ExecFileAsyncOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  windowsHide?: boolean;
}

export type ExecFileAsync = (
  file: string,
  args: string[],
  options: ExecFileAsyncOptions,
) => Promise<{ stdout: string | Buffer; stderr: string | Buffer }>;

export interface ExecFileCompilePublishRunnerConfig {
  pythonCommand: string;
  /** Absolute path to compiler/kb_meta.py (runtime.kb_meta.path). Only used
   * to derive the subprocess cwd -- lmvk_publish is invoked as `-m
   * compiler.lmvk_publish`, not by path. */
  kbMetaPath: string;
  /** Injection seam for tests -- production callers pass
   * `promisify(execFile)` (the same `pexecFile` main.ts already uses for
   * runPromote). */
  execFileAsync: ExecFileAsync;
  env?: NodeJS.ProcessEnv;
}

/** Builds the production (or test-injected) runner. Mirrors the shape of
 * mcp-server's createExecFileObcRunner (interface + execFile-backed default
 * impl) without pulling in that module or the shared Operation dispatcher --
 * this trigger is a local, ephemeral, desktop-only side effect, not a
 * governed record. */
export function createExecFileCompilePublishRunner(
  config: ExecFileCompilePublishRunnerConfig,
): CompilePublishRunner {
  return {
    async run({ vaultPath, dryRun = false, full = false }): Promise<CompilePublishRunResult> {
      const invokedAt = new Date().toISOString();
      const fail = (invocationError: string): CompilePublishRunResult => ({
        invokedAt,
        finishedAt: new Date().toISOString(),
        dryRun,
        full,
        exitCode: null,
        report: null,
        rawStdout: "",
        invocationError,
      });

      if (!config.kbMetaPath || !isAbsolute(config.kbMetaPath)) {
        return fail("Set an absolute LLM Wiki runtime entry (runtime.kb_meta.path) in Settings Platform.");
      }
      const cwd = compilerRepoRootFromKbMetaPath(config.kbMetaPath);

      const args = ["-m", "compiler.lmvk_publish", vaultPath];
      if (full) args.push("--full");
      if (dryRun) args.push("--dry-run");
      args.push("--format", "json");

      let invocation;
      try {
        invocation = buildPythonInvocation(config.pythonCommand, args);
      } catch (error) {
        return fail(String((error as Error)?.message ?? error));
      }

      try {
        const { stdout, stderr } = await config.execFileAsync(invocation.executable, invocation.args, {
          cwd,
          env: { ...(config.env ?? process.env), PYTHONUTF8: "1" },
          windowsHide: true,
        });
        const rawStdout = toText(stdout);
        return {
          invokedAt,
          finishedAt: new Date().toISOString(),
          dryRun,
          full,
          exitCode: 0,
          report: parseCompilePublishStdout(rawStdout),
          rawStdout,
          rawStderr: stderr !== undefined ? toText(stderr) : undefined,
        };
      } catch (error) {
        const err = error as { stdout?: string | Buffer; stderr?: string | Buffer; code?: number; message?: string };
        const rawStdout = err.stdout !== undefined ? toText(err.stdout) : "";
        const report = rawStdout ? parseCompilePublishStdout(rawStdout) : null;
        return {
          invokedAt,
          finishedAt: new Date().toISOString(),
          dryRun,
          full,
          exitCode: typeof err.code === "number" ? err.code : null,
          report,
          rawStdout,
          rawStderr: err.stderr !== undefined ? toText(err.stderr) : undefined,
          // Only surface an invocationError when we recovered no structured
          // report at all -- once we have parsed JSON, the report (and the
          // UI's outcome summary) is the source of truth for what happened.
          invocationError: report ? undefined : String(err.message ?? error),
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers (pure, no DOM). Every accessor tries a short list of
// plausible field-name aliases and degrades to "unknown" rather than assume
// a key exists -- see the module doc comment re: unsettled schema.
// ---------------------------------------------------------------------------

function firstString(report: CompilePublishReport | null, keys: string[]): string | undefined {
  if (!report) return undefined;
  for (const key of keys) {
    const value = report[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function firstNumber(report: CompilePublishReport | null, keys: string[]): number | undefined {
  if (!report) return undefined;
  for (const key of keys) {
    const value = report[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function nestedValue(report: CompilePublishReport | null, path: string[]): unknown {
  let cur: unknown = report;
  for (const key of path) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function nestedString(report: CompilePublishReport | null, path: string[]): string | undefined {
  const value = nestedValue(report, path);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nestedNumber(report: CompilePublishReport | null, path: string[]): number | undefined {
  const value = nestedValue(report, path);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Human summary of what happened. `status`/`skipped_reason`/`error` are the
 * real top-level keys (see module doc); flat "skipped"/"skip_reason"/"skip"
 * kept as fallback aliases in case the schema moves again. A skip is still
 * success (exit 0), not a failure -- e.g. status "skipped" with
 * skipped_reason "locked" (lock contention with a concurrent schtasks run)
 * or "head-unchanged" (nothing to publish). */
export function summarizeOutcome(result: CompilePublishRunResult): string {
  const report = result.report;
  const status = firstString(report, ["status"]);
  const skipReason = firstString(report, ["skipped_reason", "skip_reason", "skipped", "skip"]);

  if (status === "skipped" || (skipReason && status !== "error" && status !== "ok")) {
    return `Skipped (${skipReason ?? "unknown reason"})`;
  }

  const errorText = result.invocationError ?? firstString(report, ["error", "error_message", "message"]);
  const failed = status === "error"
    || (result.exitCode !== null && result.exitCode !== 0)
    || (result.exitCode === null && !!errorText);
  if (failed) {
    return errorText ? `Failed — ${errorText}` : `Failed (exit ${result.exitCode ?? "unknown"})`;
  }

  const outcome = firstString(report, ["outcome", "result"]);
  return outcome ? `Success (${outcome})` : "Success";
}

export function lastRunTimestampLabel(result: CompilePublishRunResult | null): string {
  return result ? result.finishedAt : "—";
}

/** Real key is nested `cost_guard.spent_today_usd` (verified: that's the
 * literal dict cost_guard.py's own check/record subcommands build, wrapped
 * as-is into lmvk_publish's report). Flat aliases kept as a fallback. */
export function todaysCostLabel(result: CompilePublishRunResult | null): string {
  const report = result?.report ?? null;
  const value = nestedNumber(report, ["cost_guard", "spent_today_usd"])
    ?? firstNumber(report, ["spent_today", "spend_today_usd", "cost_today_usd", "today_spend", "spend_usd"]);
  return value === undefined ? "—" : `$${value.toFixed(4)}`;
}

export interface LastPublishLabel {
  at: string;
  commit: string;
}

/** Real keys are nested `last_success.at` / `last_success.commit` (verified:
 * lmvk_publish.py carries this forward from the previous status-file read
 * even on a run that doesn't publish). Flat aliases kept as a fallback. */
export function lastPublishLabel(result: CompilePublishRunResult | null): LastPublishLabel {
  const report = result?.report ?? null;
  const at = nestedString(report, ["last_success", "at"])
    ?? firstString(report, ["published_at", "publish_at", "pages_published_at", "last_published_at"])
    ?? "—";
  const commit = nestedString(report, ["last_success", "commit"])
    ?? firstString(report, ["published_commit", "pages_commit", "publish_commit", "commit", "vault_head_after", "vault_head"])
    ?? "—";
  return { at, commit };
}

// ---------------------------------------------------------------------------
// On-disk status file: compiler/lmvk_publish.py persists the exact same
// result dict to <state_dir>/lmvk-publish-status.json after every run
// (schtasks-triggered or plugin-triggered), so the panel has real data to
// show on open even before this Obsidian session has triggered anything
// itself. Best-effort / read-only: a missing or unreadable file degrades to
// null, never an error. state_dir resolution mirrors lmvk_publish.py's own
// resolve_config(): the `lmvk.publish.state_dir` setting if set, else
// `~/.claude/state`.
// ---------------------------------------------------------------------------

export const STATUS_FILE_NAME = "lmvk-publish-status.json";

export function resolveStateDir(stateDirSetting: string | null | undefined, homeDir: string): string {
  const trimmed = (stateDirSetting ?? "").trim();
  return trimmed || join(homeDir, ".claude", "state");
}

export function statusFilePath(stateDir: string): string {
  return join(stateDir, STATUS_FILE_NAME);
}

/** Maps a status-file report (schema identical to the stdout blob, per the
 * module doc) into the same CompilePublishRunResult shape the live runner
 * produces, so the modal can render either uniformly. Timestamps/mode come
 * from the report itself here, not a client-captured clock, since this
 * reflects a run that may not have happened in this process at all. */
export function compilePublishResultFromStatusReport(report: CompilePublishReport): CompilePublishRunResult {
  const startedAt = firstString(report, ["started_at"]) ?? "unknown";
  const completedAt = firstString(report, ["completed_at"]) ?? startedAt;
  const status = firstString(report, ["status"]);
  return {
    invokedAt: startedAt,
    finishedAt: completedAt,
    dryRun: report.dry_run === true,
    full: report.full === true,
    exitCode: status === "error" ? 1 : 0,
    report,
    rawStdout: JSON.stringify(report),
    source: "status-file",
  };
}

export interface StatusFileReader {
  read(path: string): Promise<string | null>;
}

/** Production reader. Injectable for tests -- mirrors the runner's
 * execFileAsync seam so this stays testable without touching real disk. */
export function createFsStatusFileReader(): StatusFileReader {
  return {
    async read(path: string): Promise<string | null> {
      try {
        return await fsPromises.readFile(path, "utf8");
      } catch {
        return null;
      }
    },
  };
}

export async function readCompilePublishStatus(
  reader: StatusFileReader,
  stateDirSetting: string | null | undefined,
  homeDir: string,
): Promise<CompilePublishRunResult | null> {
  const path = statusFilePath(resolveStateDir(stateDirSetting, homeDir));
  const text = await reader.read(path);
  if (!text) return null;
  const report = parseCompilePublishStdout(text);
  return report ? compilePublishResultFromStatusReport(report) : null;
}
