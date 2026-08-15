#!/usr/bin/env python3
"""LMVK L2 -- compile + publish leg, Python entry point.

Migration source: scripts/lmvk-compile-publish.ps1, now RETIRED and deleted
from the tree -- read it via git history if you need the original. Line
references to that PS1 elsewhere in this module are historical and only
resolve against a pre-retirement revision.

The PS1 had to retire because obsidian-plugin/src/executable-command.ts:54-65
(assertNotShellWrapper) refuses to run .ps1/.bat/.cmd as a configured
runtime interpreter -- the plugin can only execFile a real executable, so a
Python entry point is the only thing it can call directly. schtasks now
invokes this module too, so both callers share one implementation.

Spec: docs/specs/lmvk-execution-and-release.md (L2)
ADR:  docs/legacy/adr/lmvk-0001-distribution-topology.md

Pipeline per run (identical stages to the PS1):
  1. git pull <vault>. If HEAD unchanged and --full not passed, exit
     immediately (zero cost -- the 15-min-cron fast path). ADR line 34:
     input is always a fresh `git pull`, never a direct read of local disk.
  2. Cost-guard check (compiler/cost_guard.py, imported directly -- not
     shelled out to). Under the $/day cap, run compiler/scheduler.py's
     AgentScheduler(...).run_once() (imported directly) against the vault;
     it discovers dirty *topics* and shells out to compile.py per topic.
     compile.py reports no $ cost, so spend is an explicit, logged ESTIMATE
     from sources-compiled count.
  3. compiler/html_export/exporter.py's export_vault_direct() (imported
     directly): pure-render, whole-vault, zero LLM, 00-Inbox excluded via
     the exporter's own hardcoded DEFAULT_VAULT_EXCLUDE_DIRS (wayfinder
     #20, "00-Inbox 不编不发") -- always runs regardless of the cost guard.
  4. Publish output/ to the `pages` branch of the vault's own gitea repo as
     a normal (non-force) commit+push; orphan-bootstrapped on first run.
     Never force-pushed -- this process is the branch's sole writer.

CLI contract (fixed by the migration plan, consumed by the Obsidian plugin
via execFile -- see mcp-server/src/problem-intake/obc-runner.ts's
createExecFileObcRunner convention for the calling pattern this mirrors):

    python -m compiler.lmvk_publish <vault_path> [--full] [--dry-run] --format json

  - stdout is EXACTLY one JSON blob and nothing else -- no exceptions. The
    PS1's `2>&1 | Out-String` merge is *the* reason its own scheduler.py
    JSON parse sometimes silently failed (stderr chatter corrupting the
    blob); this module keeps every subprocess's stdout/stderr captured
    SEPARATELY and sends every human-readable line to stderr (and the log
    file) through _Logger, never to stdout.
  - Exit code 0 = success, including the "nothing to do" early exits
    (HEAD unchanged, cost cap reached, lock held by another run). Exit
    code != 0 = a real failure. Even on failure, stdout still carries the
    same structured JSON schema (status="error", error=<message>) --
    callers should not need a separate error-parsing path.

Concurrency: the PS1 had ZERO enforced locking (see recon report) -- its
only protection was organizational (ADR: 5090 primary / 5080 standby
disabled by convention). Now that a human can also trigger this from the
Obsidian plugin, a real lock is required so a manual trigger can't race the
15-min cron. See acquire_lock()/release_lock() below.
"""

from __future__ import annotations

import argparse
import contextlib
import ctypes
import json
import os
import re
import shutil
import subprocess
import sys
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Reuse compiler/*.py directly (no subprocess indirection) -- matches the
# flat-sibling-import convention every other compiler/ script and its tests
# already use (e.g. compiler/tests/test_cost_guard.py:15,
# compiler/scheduler.py:23 `from evaluate import ...`). Inserting this
# directory onto sys.path is the same trick the PS1 achieved by
# `Push-Location $CompilerDir` before `python -m html_export.exporter`.
# ---------------------------------------------------------------------------
_COMPILER_DIR = Path(__file__).resolve().parent
if str(_COMPILER_DIR) not in sys.path:
    sys.path.insert(0, str(_COMPILER_DIR))

import cost_guard  # noqa: E402
import settings_platform as sp  # noqa: E402
from evaluate import load_settings  # noqa: E402
from html_export.exporter import (  # noqa: E402
    DEFAULT_VAULT_EXCLUDE_DIRS,
    ExportOptions,
    export_vault_direct,
)
from scheduler import AgentScheduler  # noqa: E402

SCHEMA_VERSION = 1

# Matches the PS1's own $StateDir/$LogDir (C:\Users\Administrator\.claude\...)
# for this machine, expressed portably so lmvk-compile-spend.json stays the
# exact same file (and schema) across the PS1-to-Python migration -- no
# spend history is lost, no new schema is invented for it.
DEFAULT_STATE_DIR = Path.home() / ".claude" / "state"
DEFAULT_LOG_DIR = Path.home() / ".claude" / "logs"
MAX_LOG_BYTES = 5 * 1024 * 1024

# New requirement (PS1 had none -- see module docstring "Concurrency").
# Generous ceiling: a full weekly pass (LLM compile + whole-vault render +
# publish) should complete well under this; a lock older than this is
# assumed abandoned (crashed process) rather than "still legitimately
# running", and is reclaimed automatically.
LOCK_STALE_SECONDS = 60 * 60

# Product defaults for the lmvk.publish.* settings-platform keys
# (packages/settings-platform/registry/v1.json) -- identical to the PS1's
# hardcoded $PagesRepoUrl / $PagesBranch / $DailyCapUsd /
# $CostPerSourceEstimateUsd / GITEA_TOKEN. Used verbatim when the settings
# platform can't be loaded (e.g. no registry on disk) or returns no
# override -- this module works with zero configuration, same as the PS1.
_PRODUCT_DEFAULTS = {
    "pages_repo_url": "https://Curry@git.xart.top:8418/claudeQWQ/obsidian-knowledge.git",
    "pages_branch": "pages",
    "daily_cap_usd": 5.0,
    "cost_per_source_estimate_usd": 0.02,
    "gitea_token_locator": "GITEA_TOKEN",
}
_LOCATOR_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


# ---------------------------------------------------------------------------
# Config resolution -- reads packages/settings-platform/registry/v1.json's
# lmvk.publish.* keys through compiler/settings_platform.py (the Python
# reimplementation of the same Settings Platform contract the TS side and
# the Obsidian plugin use), so the plugin can override these values later
# without this module needing to change. Falls back to _PRODUCT_DEFAULTS on
# any error -- the settings platform is an enhancement here, not a hard
# dependency; this CLI must keep working even if it can't be loaded.
# ---------------------------------------------------------------------------


@dataclass
class PublishConfig:
    vault_path: Path
    state_dir: Path
    log_path: Path
    output_dir: Path
    pages_workdir: Path
    spend_state_path: Path
    status_path: Path
    lock_path: Path
    askpass_path: Path
    pages_repo_url: str
    pages_branch: str
    daily_cap_usd: float
    cost_per_source_estimate_usd: float
    gitea_token_locator: str


def resolve_config(vault_path: Path, environment: dict[str, str]) -> PublishConfig:
    values: dict[str, Any] = dict(_PRODUCT_DEFAULTS)
    state_dir_override = ""

    try:
        registry = sp.load_registry(sp.default_registry_path())
        service = sp.SettingsService(registry=registry, vault_path=vault_path, environment=environment)
        snapshot = service.snapshot_resolve()["snapshot"]
        effective = {item["key"]: item["value"] for item in snapshot["effective"]}

        repo_url = effective.get("lmvk.publish.pages_repo_url")
        if isinstance(repo_url, str) and repo_url.strip():
            values["pages_repo_url"] = repo_url

        branch = effective.get("lmvk.publish.pages_branch")
        if isinstance(branch, str) and branch.strip():
            values["pages_branch"] = branch

        cap = effective.get("lmvk.publish.daily_cap_usd")
        if isinstance(cap, (int, float)) and not isinstance(cap, bool):
            values["daily_cap_usd"] = float(cap)

        coeff = effective.get("lmvk.publish.cost_per_source_estimate_usd")
        if isinstance(coeff, (int, float)) and not isinstance(coeff, bool):
            values["cost_per_source_estimate_usd"] = float(coeff)

        secret_value = effective.get("lmvk.publish.gitea_token.secret_ref")
        if isinstance(secret_value, dict):
            secret_ref = secret_value.get("secretRef") or {}
            locator = secret_ref.get("locator")
            if isinstance(locator, str) and _LOCATOR_PATTERN.match(locator):
                values["gitea_token_locator"] = locator

        state_dir_value = effective.get("lmvk.publish.state_dir")
        if isinstance(state_dir_value, str) and state_dir_value.strip():
            state_dir_override = state_dir_value.strip()
    except Exception:
        # Settings platform is additive here (see docstring above) -- keep
        # the PS1-equivalent hardcoded defaults and carry on silently. Any
        # caller that cares can inspect resolve_config()'s return value;
        # there is no logger available yet at this point in main()/run_pipeline().
        pass

    state_dir = Path(state_dir_override) if state_dir_override else DEFAULT_STATE_DIR
    return PublishConfig(
        vault_path=vault_path,
        state_dir=state_dir,
        log_path=DEFAULT_LOG_DIR / "lmvk-compile.log",
        output_dir=state_dir / "lmvk-html-output",
        pages_workdir=state_dir / "lmvk-pages-workdir",
        spend_state_path=state_dir / "lmvk-compile-spend.json",
        status_path=state_dir / "lmvk-publish-status.json",
        lock_path=state_dir / "lmvk-publish.lock",
        askpass_path=state_dir / "lmvk-git-askpass.py",
        pages_repo_url=str(values["pages_repo_url"]),
        pages_branch=str(values["pages_branch"]),
        daily_cap_usd=float(values["daily_cap_usd"]),
        cost_per_source_estimate_usd=float(values["cost_per_source_estimate_usd"]),
        gitea_token_locator=str(values["gitea_token_locator"]),
    )


# ---------------------------------------------------------------------------
# Logging -- stderr + rotating log file only. NEVER stdout (see module
# docstring's "stdout is EXACTLY one JSON blob" requirement).
# ---------------------------------------------------------------------------


def _iso_now(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")


class _Logger:
    def __init__(self, log_path: Path):
        self.log_path = log_path

    def rotate(self, max_bytes: int = MAX_LOG_BYTES) -> None:
        try:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            if self.log_path.exists() and self.log_path.stat().st_size > max_bytes:
                # Simple 1-generation rotation, same as the PS1 (lines
                # 142-145): "<file>.old", literal suffix append -- not
                # Path.with_suffix(), which would replace ".log" instead.
                old = Path(str(self.log_path) + ".old")
                self.log_path.replace(old)
        except OSError:
            pass

    def log(self, message: str, level: str = "INFO") -> None:
        line = f"[{_iso_now()}] [{level}] {message}"
        try:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        except OSError:
            pass
        print(line, file=sys.stderr)


# ---------------------------------------------------------------------------
# Git plumbing. stdout/stderr are captured SEPARATELY by subprocess.run --
# this is the structural fix for the PS1's `2>&1 | Out-String` stream-merge
# bug (recon report §1/§3): there is no way for git/python stderr chatter
# to land in a string this module treats as machine-readable.
# ---------------------------------------------------------------------------


class GitError(RuntimeError):
    pass


def _run_git(
    args: list[str],
    *,
    cwd: Path | None,
    env: dict[str, str],
    logger: _Logger,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    logger.log("RUN: git " + " ".join(args))
    result = subprocess.run(
        ["git", *args],
        cwd=str(cwd) if cwd else None,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.stdout.strip():
        logger.log(result.stdout.strip())
    if result.stderr.strip():
        logger.log(result.stderr.strip(), "WARN" if result.returncode == 0 else "ERROR")
    if check and result.returncode != 0:
        raise GitError(f"git {' '.join(args)} failed (exit {result.returncode})")
    return result


def _run_git_net(
    args: list[str],
    *,
    cwd: Path | None,
    env: dict[str, str],
    logger: _Logger,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    """Network-touching git calls: disable credential helpers per
    invocation (nothing may cache, store, or GUI-prompt for the token) and
    rely solely on GIT_ASKPASS from initialize_git_auth(). Ports
    Invoke-GitNet (PS1 lines 127-136).
    """
    return _run_git(["-c", "credential.helper=", *args], cwd=cwd, env=env, logger=logger, check=check)


def initialize_git_auth(cfg: PublishConfig, environment: dict[str, str], logger: _Logger) -> dict[str, str]:
    """Port of PS1 Initialize-GitAuth (scripts/lmvk-compile-publish.ps1:111-125),
    1:1, per the task's explicit instruction not to re-derive this
    mechanism from scratch.

    Token flow (unchanged from the PS1): the token lives ONLY in the
    process environment, under the variable named by
    lmvk.publish.gitea_token.secret_ref's locator (default GITEA_TOKEN).
    An askpass helper -- itself an executable Python script, never
    .ps1/.bat/.cmd (same shell-composition attack-surface reasoning as
    obsidian-plugin/src/executable-command.ts:54-65's
    assertNotShellWrapper) -- reads that env var at CALL TIME, when git
    invokes it, and writes the value to its own stdout. The helper's own
    source text embeds only the env var NAME, never the token value.

    This is the exact invariant scripts/lmvk-compile-publish.token-leak.test.ps1
    pins for the PS1: at no point may the literal token value appear in a
    URL, in argv passed to any subprocess, in any file written to disk, or
    in any log line -- only in (a) the process environment and (b) the
    askpass helper's ephemeral stdout, read directly by git's own
    credential-prompt machinery.

    Empirically verified on this host (git 2.54 for Windows / MINGW64,
    invoked the same way this module invokes it -- via
    subprocess.run(["git", ...], env=...), no shell): GIT_ASKPASS pointed
    at a bare executable Python script with a `#!/usr/bin/env python`
    shebang is invoked directly by git with no interpreter prefix needed --
    Git for Windows follows the shebang itself (`git -c credential.helper=
    credential fill` round-tripped a marker value through the helper
    correctly). No quoting/argument-splitting ambiguity is introduced by
    embedding an interpreter path in GIT_ASKPASS, because none is used.
    """
    locator = cfg.gitea_token_locator
    if not environment.get(locator):
        raise GitError(f"{locator} is not set -- cannot authenticate to gitea.")

    cfg.state_dir.mkdir(parents=True, exist_ok=True)
    # NOTE: only the locator NAME is interpolated below (validated against
    # _LOCATOR_PATTERN in resolve_config), never the token value itself.
    script = "#!/usr/bin/env python\nimport os, sys\nsys.stdout.write(os.environ.get(%r, ''))\n" % locator
    cfg.askpass_path.write_text(script, encoding="utf-8", newline="\n")
    try:
        os.chmod(cfg.askpass_path, 0o700)
    except OSError:
        pass  # best-effort; Windows ACLs don't use POSIX mode bits

    git_env = dict(environment)
    git_env["GIT_ASKPASS"] = str(cfg.askpass_path)
    git_env["GIT_TERMINAL_PROMPT"] = "0"
    logger.log(f"Git auth initialized via GIT_ASKPASS ({locator} -> {cfg.askpass_path}).")
    return git_env


# ---------------------------------------------------------------------------
# Concurrency lock -- new requirement, the PS1 had none (module docstring).
# Atomic O_CREAT|O_EXCL create; a lock whose owning pid is dead or whose
# timestamp is older than LOCK_STALE_SECONDS is reclaimed automatically so
# one crashed run can't wedge this leg forever.
# ---------------------------------------------------------------------------


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        process_query_limited_information = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(process_query_limited_information, False, pid)  # type: ignore[attr-defined]
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)  # type: ignore[attr-defined]
            return True
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # exists, just owned by someone else
    except OSError:
        return False
    return True


def _lock_is_stale(lock_path: Path, stale_seconds: int) -> bool:
    try:
        data = json.loads(lock_path.read_text("utf-8"))
    except (OSError, ValueError):
        return True  # unreadable/corrupt lock -> safe to reclaim
    pid = data.get("pid")
    if not isinstance(pid, int) or not _pid_alive(pid):
        return True
    started_at = data.get("started_at")
    if isinstance(started_at, str):
        try:
            started = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            if (datetime.now(timezone.utc) - started).total_seconds() > stale_seconds:
                return True
        except ValueError:
            return True
    return False


def acquire_lock(lock_path: Path, *, stale_seconds: int = LOCK_STALE_SECONDS) -> bool:
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"pid": os.getpid(), "started_at": _iso_now()}).encode("utf-8")
    for attempt in range(2):  # one reclaim-and-retry pass for a stale lock
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            try:
                os.write(fd, payload)
            finally:
                os.close(fd)
            return True
        except FileExistsError:
            if attempt == 0 and _lock_is_stale(lock_path, stale_seconds):
                try:
                    lock_path.unlink()
                except OSError:
                    pass
                continue
            return False
    return False


def release_lock(lock_path: Path) -> None:
    try:
        lock_path.unlink()
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Result / status schema -- the SAME dict shape is the stdout JSON blob and
# the on-disk status file (lmvk-publish-status.json), by design (task
# requirement: "don't write two schemas").
# ---------------------------------------------------------------------------


def _empty_result(cfg: PublishConfig, *, full: bool, dry_run: bool, started_at: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "status": "error",  # overwritten before this ever leaves run_pipeline()
        "skipped_reason": None,  # None | "locked" | "head-unchanged"
        "full": full,
        "dry_run": dry_run,
        "started_at": started_at,
        "completed_at": None,
        "vault_head_before": None,
        "vault_head_after": None,
        "compile": {
            "ran": False,
            "skipped_reason": None,  # None | "cost-cap"
            "sources_compiled": 0,
            "estimated_cost_usd": 0.0,
        },
        "cost_guard": {"spent_today_usd": 0.0, "daily_cap_usd": cfg.daily_cap_usd},
        "html_export": None,
        "publish": None,
        "last_success": {"at": None, "commit": None},
        "error": None,
    }


def _read_status(status_path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(status_path.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _write_status(status_path: Path, result: dict[str, Any]) -> None:
    try:
        status_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = Path(str(status_path) + ".tmp")
        tmp.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        tmp.replace(status_path)
    except OSError:
        pass  # status persistence is best-effort; stdout is the contract of record


def _last_success_from_previous(status_path: Path) -> dict[str, Any]:
    previous = _read_status(status_path)
    if isinstance(previous, dict) and isinstance(previous.get("last_success"), dict):
        at = previous["last_success"].get("at")
        commit = previous["last_success"].get("commit")
        if isinstance(at, str) or isinstance(commit, str):
            return {"at": at, "commit": commit}
    return {"at": None, "commit": None}


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


def run_pipeline(
    vault_path: Path,
    *,
    full: bool = False,
    dry_run: bool = False,
    environment: dict[str, str] | None = None,
) -> dict[str, Any]:
    environment = dict(environment) if environment is not None else dict(os.environ)
    vault_path = Path(vault_path)
    cfg = resolve_config(vault_path, environment)
    logger = _Logger(cfg.log_path)
    logger.rotate()

    started_at = _iso_now()
    result = _empty_result(cfg, full=full, dry_run=dry_run, started_at=started_at)
    result["last_success"] = _last_success_from_previous(cfg.status_path)

    logger.log(f"===== lmvk-compile-publish start (full={full} dry_run={dry_run}) =====")

    if not acquire_lock(cfg.lock_path):
        # Predicted, not a failure: a manual (plugin-triggered) run and the
        # 15-min schtasks cron can legitimately race. Exit 0, structured
        # JSON says why. See module docstring "Concurrency".
        logger.log("Another run holds the lock -- skipping (locked).", "WARN")
        result["status"] = "skipped"
        result["skipped_reason"] = "locked"
        result["completed_at"] = _iso_now()
        _write_status(cfg.status_path, result)
        logger.log("===== lmvk-compile-publish end (locked) =====")
        return result

    try:
        result = _run_locked_pipeline(cfg, environment, logger, result)
    except Exception as exc:  # last-resort catch-all: caller always gets structured JSON, never a traceback on stdout
        logger.log(f"FAILED: {exc}", "ERROR")
        logger.log(traceback.format_exc(), "ERROR")
        result["status"] = "error"
        result["error"] = str(exc)
        result["completed_at"] = _iso_now()
    finally:
        release_lock(cfg.lock_path)

    _write_status(cfg.status_path, result)
    logger.log(f"===== lmvk-compile-publish end ({result['status']}) =====")
    return result


def _run_locked_pipeline(
    cfg: PublishConfig,
    environment: dict[str, str],
    logger: _Logger,
    result: dict[str, Any],
) -> dict[str, Any]:
    git_env = initialize_git_auth(cfg, environment, logger)

    # -----------------------------------------------------------------
    # Step 1: pull vault, early-exit on no change (ADR lmvk-0001 line 34:
    # input is always a fresh `git pull`, never a direct local-disk read).
    # -----------------------------------------------------------------
    head_before = _run_git(["rev-parse", "HEAD"], cwd=cfg.vault_path, env=git_env, logger=logger).stdout.strip()
    _run_git_net(["pull"], cwd=cfg.vault_path, env=git_env, logger=logger)
    head_after = _run_git(["rev-parse", "HEAD"], cwd=cfg.vault_path, env=git_env, logger=logger).stdout.strip()
    result["vault_head_before"] = head_before
    result["vault_head_after"] = head_after

    if head_before == head_after and not result["full"]:
        logger.log(f"HEAD unchanged ({head_after}) and not --full -> early exit, zero LLM/render cost.")
        result["status"] = "ok"
        result["skipped_reason"] = "head-unchanged"
        result["completed_at"] = _iso_now()
        return result

    logger.log(f"Proceeding: HEAD {head_before} -> {head_after} (full={result['full']})")

    # -----------------------------------------------------------------
    # Step 2: LLM incremental compile, gated by the $/day cost guard.
    # compiler/cost_guard.py and compiler/scheduler.py imported directly --
    # no CLI-subprocess indirection (recon report: "the CLI subprocess
    # layer exists only because the PS1 caller prefers an exit code over
    # parsing JSON, a constraint that disappears once the caller is Python").
    # -----------------------------------------------------------------
    spent_today = cost_guard.get_today_spend(cfg.spend_state_path)
    result["cost_guard"] = {"spent_today_usd": spent_today, "daily_cap_usd": cfg.daily_cap_usd}

    if cost_guard.should_early_exit(cfg.spend_state_path, cap=cfg.daily_cap_usd):
        logger.log(
            f"Cost guard: daily cap ${cfg.daily_cap_usd} reached -> skipping LLM compile step (render-only this run).",
            "WARN",
        )
        result["compile"]["skipped_reason"] = "cost-cap"
    else:
        settings = load_settings(vault_path_override=str(cfg.vault_path))
        report = AgentScheduler(settings, mode="auto").run_once()
        result["compile"]["ran"] = True

        sources_compiled = 0
        for action_result in report.results:
            if action_result.action == "compile":
                data = action_result.data if isinstance(action_result.data, dict) else {}
                sources_compiled += int(data.get("sources_compiled") or 0)
        result["compile"]["sources_compiled"] = sources_compiled

        if sources_compiled > 0:
            est_cost = round(sources_compiled * cfg.cost_per_source_estimate_usd, 4)
            new_total = cost_guard.record_spend(cfg.spend_state_path, est_cost)
            result["compile"]["estimated_cost_usd"] = est_cost
            result["cost_guard"]["spent_today_usd"] = new_total
            logger.log(
                f"[ESTIMATE] {sources_compiled} source(s) compiled -> est. ${est_cost} recorded "
                f"(compile.py reports no actual $ cost; coefficient="
                f"${cfg.cost_per_source_estimate_usd}/source, NOT a measurement).",
                "WARN",
            )
        else:
            logger.log("0 sources compiled this run.")

    # -----------------------------------------------------------------
    # Step 3: html_export whole-vault direct render (zero LLM, always runs
    # regardless of the cost-guard verdict). export_vault_direct() imported
    # directly -- 00-Inbox exclusion stays hardcoded in exporter.py's
    # DEFAULT_VAULT_EXCLUDE_DIRS (wayfinder #20), not re-derived here.
    # -----------------------------------------------------------------
    options = ExportOptions(output_dir=cfg.output_dir)
    export_report = export_vault_direct(
        cfg.vault_path, cfg.output_dir, options, exclude_dirs=set(DEFAULT_VAULT_EXCLUDE_DIRS)
    )
    result["html_export"] = {
        "ran": True,
        "files_exported": export_report.files_exported,
        "files_failed": export_report.files_failed,
        "links_converted": export_report.links_converted,
        "output_dir": str(cfg.output_dir),
    }
    logger.log(
        f"html_export --direct complete -> {cfg.output_dir} "
        f"(exported={export_report.files_exported}, failed={export_report.files_failed})"
    )

    # -----------------------------------------------------------------
    # Step 4: publish output/ to the pages branch.
    # -----------------------------------------------------------------
    publish = _publish_pages(cfg, git_env, logger, head_after=head_after, dry_run=result["dry_run"])
    result["publish"] = publish
    if publish["pushed"]:
        result["last_success"] = {"at": _iso_now(), "commit": publish["commit"]}

    result["status"] = "ok"
    result["completed_at"] = _iso_now()
    return result


def _publish_pages(
    cfg: PublishConfig,
    git_env: dict[str, str],
    logger: _Logger,
    *,
    head_after: str,
    dry_run: bool,
) -> dict[str, Any]:
    """Port of PS1 Step 4 (scripts/lmvk-compile-publish.ps1:221-277):
    orphan-bootstrap the pages branch once, then plain commit+push
    thereafter. NEVER force-pushed -- this process is the branch's sole
    writer (PS1 comment lines 222-224; preserved as a hard invariant here,
    not merely carried over by omission).
    """
    if not (cfg.pages_workdir / ".git").exists():
        logger.log("No local pages workdir -- checking whether the pages branch already exists on gitea.")
        remote_heads = _run_git_net(
            ["ls-remote", "--heads", cfg.pages_repo_url, cfg.pages_branch],
            cwd=None,
            env=git_env,
            logger=logger,
        ).stdout
        if cfg.pages_workdir.exists():
            shutil.rmtree(cfg.pages_workdir, ignore_errors=True)

        if remote_heads.strip():
            logger.log("Remote pages branch exists -> cloning it.")
            _run_git_net(
                ["clone", "-b", cfg.pages_branch, cfg.pages_repo_url, str(cfg.pages_workdir)],
                cwd=None,
                env=git_env,
                logger=logger,
            )
        else:
            logger.log("Remote pages branch absent -> bootstrapping as an orphan branch.")
            _run_git_net(["clone", cfg.pages_repo_url, str(cfg.pages_workdir)], cwd=None, env=git_env, logger=logger)
            _run_git(["checkout", "--orphan", cfg.pages_branch], cwd=cfg.pages_workdir, env=git_env, logger=logger)
            _run_git(["rm", "-rf", "."], cwd=cfg.pages_workdir, env=git_env, logger=logger, check=False)
    else:
        # Self-heal: earlier revisions (or a stray manual edit) may have
        # persisted a token-bearing URL into this workdir's .git/config.
        _run_git(
            ["remote", "set-url", "origin", cfg.pages_repo_url], cwd=cfg.pages_workdir, env=git_env, logger=logger
        )
        _run_git_net(
            ["fetch", "origin", cfg.pages_branch], cwd=cfg.pages_workdir, env=git_env, logger=logger, check=False
        )
        _run_git(
            ["checkout", cfg.pages_branch], cwd=cfg.pages_workdir, env=git_env, logger=logger, check=False
        )
        _run_git(
            ["reset", "--hard", f"origin/{cfg.pages_branch}"],
            cwd=cfg.pages_workdir,
            env=git_env,
            logger=logger,
            check=False,
        )

    # Clear everything except .git, then repopulate from the fresh render.
    for entry in cfg.pages_workdir.iterdir():
        if entry.name == ".git":
            continue
        if entry.is_dir():
            shutil.rmtree(entry, ignore_errors=True)
        else:
            entry.unlink(missing_ok=True)
    if cfg.output_dir.exists():
        for entry in cfg.output_dir.iterdir():
            dest = cfg.pages_workdir / entry.name
            if entry.is_dir():
                shutil.copytree(entry, dest, dirs_exist_ok=True)
            else:
                shutil.copy2(entry, dest)

    # git status --porcelain reports untracked/modified/deleted files
    # whether or not anything is staged, so the diff check can run BEFORE
    # `git add -A` -- unlike the PS1, which always staged first. This lets
    # a --dry-run report "would push" without ever touching the index, so
    # it can never leave the pages workdir needing manual cleanup.
    diff_stat = _run_git(["status", "--porcelain"], cwd=cfg.pages_workdir, env=git_env, logger=logger).stdout

    publish: dict[str, Any] = {
        "attempted": True,
        "would_push": False,
        "pushed": False,
        "commit": None,
        "message": None,
        "branch": cfg.pages_branch,
    }

    if not diff_stat.strip():
        logger.log("Pages branch: no content changes since last publish -- skipping empty commit.")
        publish["message"] = "no-content-changes"
        return publish

    publish["would_push"] = True
    commit_msg = f"lmvk: publish {_iso_now()} (vault HEAD {head_after})"

    if dry_run:
        logger.log(f"[dry-run] Would commit+push: {commit_msg}")
        publish["message"] = "dry-run"
        return publish

    _run_git(["add", "-A"], cwd=cfg.pages_workdir, env=git_env, logger=logger)
    _run_git(["commit", "-m", commit_msg, "--quiet"], cwd=cfg.pages_workdir, env=git_env, logger=logger)
    commit_sha = _run_git(["rev-parse", "HEAD"], cwd=cfg.pages_workdir, env=git_env, logger=logger).stdout.strip()
    _run_git_net(["push", "origin", cfg.pages_branch], cwd=cfg.pages_workdir, env=git_env, logger=logger)
    logger.log(f"Published to gitea pages branch: {commit_msg}")

    publish["pushed"] = True
    publish["commit"] = commit_sha
    publish["message"] = commit_msg
    return publish


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="lmvk_publish.py",
        description=(
            "LMVK L2 -- compile leg + publish to the vault's gitea pages "
            "branch (supersedes scripts/lmvk-compile-publish.ps1; shared "
            "entry point for schtasks and the Obsidian plugin)."
        ),
    )
    parser.add_argument("vault_path", type=Path, help="Path to the vault's git working copy (e.g. D:\\knowledge).")
    parser.add_argument(
        "--full",
        action="store_true",
        help="Weekly full-pass mode: bypass the HEAD-unchanged early exit and render/publish unconditionally.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run the full pipeline but never push to the pages branch (plugin UI / verification use).",
    )
    parser.add_argument(
        "--format",
        choices=["json"],
        default="json",
        help="Output format for stdout. Only json is supported -- stdout is always exactly one JSON blob.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    # HARD REQUIREMENT: stdout is exactly one JSON blob, nothing else. The
    # Obsidian plugin's execFile-based caller parses stdout directly (and,
    # per the migration plan, parses it even on a non-zero exit code) --
    # see module docstring. All human-readable logging goes through
    # _Logger (stderr + log file), never print() to stdout, anywhere else
    # in this module.
    #
    # Self-discipline is not enough: this module IMPORTS and calls other
    # compiler modules, and those print to stdout on their own schedule --
    # html_export.exporter's service-worker step emits
    # "  [sw] precache: full site (N files, ...)" on every real render. That
    # only happens on a rendering run, so a --dry-run smoke test (which
    # early-exits on HEAD-unchanged) never sees it; it took a real --full run
    # to surface. Redirect stdout to stderr for the whole pipeline so any
    # callee print lands in the human log stream, and emit the JSON to the
    # real stdout afterwards. This holds for future callees too, not just [sw].
    real_stdout = sys.stdout
    with contextlib.redirect_stdout(sys.stderr):
        result = run_pipeline(args.vault_path, full=args.full, dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=False), file=real_stdout)
    return 0 if result["status"] in ("ok", "skipped") else 1


if __name__ == "__main__":
    sys.exit(main())
