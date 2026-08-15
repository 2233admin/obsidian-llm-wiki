"""Tests for the LMVK L2 Python publish entry point (compiler/lmvk_publish.py).

Migration source: scripts/lmvk-compile-publish.ps1 and its regression test
scripts/lmvk-compile-publish.token-leak.test.ps1 -- see that PS1 test's
5-point assertion list for the exact invariant TestTokenNeverLeaks below
ports.

All state (vault repos, pages "remote" bare repo, lock/log/status files)
lives under pytest's tmp_path -- never a real machine's
~/.claude/state/lmvk-*.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cost_guard
import lmvk_publish
import settings_platform as sp

NOW = datetime(2026, 8, 16, 12, 0, 0, tzinfo=timezone.utc)
REGISTRY_PATH = Path(__file__).resolve().parents[2] / "packages" / "settings-platform" / "registry" / "v1.json"


def _pandoc_available() -> bool:
    from html_export.exporter import _check_pandoc

    return _check_pandoc()[0]


# ---------------------------------------------------------------------------
# git test helpers -- real local git repos (file-path remotes need no
# network and no credentials, so these exercise the actual git plumbing
# lmvk_publish.py runs in production, not a subprocess.run mock).
# ---------------------------------------------------------------------------


def _git(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", *args], cwd=str(cwd), capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    assert result.returncode == 0, f"git {args} failed: {result.stdout}\n{result.stderr}"
    return result


def _init_bare(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    _git("init", "--bare", "-b", "main", str(path), cwd=path.parent)
    return path


def _init_vault_clone(clone_dir: Path, origin: Path) -> Path:
    _git("clone", str(origin), str(clone_dir), cwd=clone_dir.parent)
    _git("config", "user.email", "test@test.invalid", cwd=clone_dir)
    _git("config", "user.name", "Test", cwd=clone_dir)
    return clone_dir


def _seed_vault_origin(origin: Path, work_dir: Path) -> None:
    """Create the bare `origin` repo with one commit on `main`, containing
    one markdown note the exporter can render."""
    _init_bare(origin)
    seed = work_dir / "seed"
    _git("clone", str(origin), str(seed), cwd=work_dir)
    _git("config", "user.email", "test@test.invalid", cwd=seed)
    _git("config", "user.name", "Test", cwd=seed)
    (seed / "note.md").write_text("# Hello\n\nWorld.\n", encoding="utf-8")
    _git("add", "-A", cwd=seed)
    _git("commit", "-m", "seed", cwd=seed)
    _git("push", "-u", "origin", "main", cwd=seed)


def _push_new_commit(origin: Path, work_dir: Path, filename: str = "second.md") -> str:
    """Push a fresh commit to `origin` from a throwaway clone (simulating
    "someone else changed the vault"), returns the new commit sha."""
    pusher = work_dir / f"pusher-{filename}"
    _git("clone", str(origin), str(pusher), cwd=work_dir)
    _git("config", "user.email", "test@test.invalid", cwd=pusher)
    _git("config", "user.name", "Test", cwd=pusher)
    (pusher / filename).write_text(f"# {filename}\n\nMore content.\n", encoding="utf-8")
    _git("add", "-A", cwd=pusher)
    _git("commit", "-m", f"add {filename}", cwd=pusher)
    _git("push", "origin", "main", cwd=pusher)
    return _git("rev-parse", "HEAD", cwd=pusher).stdout.strip()


def _fixed_config(tmp_path: Path, vault_dir: Path, pages_origin: Path) -> lmvk_publish.PublishConfig:
    state_dir = tmp_path / "state"
    log_dir = tmp_path / "logs"
    return lmvk_publish.PublishConfig(
        vault_path=vault_dir,
        state_dir=state_dir,
        log_path=log_dir / "lmvk-compile.log",
        output_dir=state_dir / "lmvk-html-output",
        pages_workdir=state_dir / "lmvk-pages-workdir",
        spend_state_path=state_dir / "lmvk-compile-spend.json",
        status_path=state_dir / "lmvk-publish-status.json",
        lock_path=state_dir / "lmvk-publish.lock",
        askpass_path=state_dir / "lmvk-git-askpass.py",
        pages_repo_url=str(pages_origin),
        pages_branch="pages",
        daily_cap_usd=5.0,
        cost_per_source_estimate_usd=0.02,
        gitea_token_locator="GITEA_TOKEN",
    )


@pytest.fixture
def repos(tmp_path: Path):
    work = tmp_path / "work"
    work.mkdir()
    vault_origin = tmp_path / "vault-origin.git"
    pages_origin = tmp_path / "pages-origin.git"
    _seed_vault_origin(vault_origin, work)
    _init_bare(pages_origin)
    vault_dir = _init_vault_clone(tmp_path / "vault", vault_origin)
    return {"work": work, "vault_origin": vault_origin, "pages_origin": pages_origin, "vault_dir": vault_dir}


def _patch_resolve_config(monkeypatch, cfg: lmvk_publish.PublishConfig) -> None:
    monkeypatch.setattr(lmvk_publish, "resolve_config", lambda vault_path, environment: cfg)


# ---------------------------------------------------------------------------
# resolve_config: product defaults + settings-platform override wiring
# ---------------------------------------------------------------------------


def test_resolve_config_uses_product_defaults_with_no_settings_documents(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    cfg = lmvk_publish.resolve_config(vault, environment={})
    assert cfg.pages_repo_url == lmvk_publish._PRODUCT_DEFAULTS["pages_repo_url"]
    assert cfg.pages_branch == "pages"
    assert cfg.daily_cap_usd == 5.0
    assert cfg.cost_per_source_estimate_usd == 0.02
    assert cfg.gitea_token_locator == "GITEA_TOKEN"
    assert cfg.state_dir == lmvk_publish.DEFAULT_STATE_DIR


def test_resolve_config_honors_vault_scope_settings_override(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    registry = sp.load_registry(REGISTRY_PATH)
    # lmvk.publish.state_dir is user-device/session scoped (it's a device
    # path, not something that belongs in the shared vault) -- give the
    # service an isolated user-device document path so this test never
    # touches the real machine's %APPDATA%\llm-wiki\settings\user-device.json.
    user_device_path = tmp_path / "user-device.json"
    service = sp.SettingsService(
        registry=registry, vault_path=vault, environment={}, user_device_path=user_device_path
    )

    custom_state_dir = str(tmp_path / "custom-state")
    result = service.assignment_set(
        scope="user-device",
        key="lmvk.publish.state_dir",
        value=custom_state_dir,
        expected_revision=0,
        updated_by="test",
    )
    assert result["status"] == "committed", result
    result = service.assignment_set(
        scope="vault",
        key="lmvk.publish.daily_cap_usd",
        value=12.5,
        expected_revision=0,
        updated_by="test",
    )
    assert result["status"] == "committed", result

    cfg = lmvk_publish.resolve_config(vault, environment={"LLMWIKI_SETTINGS_USER_PATH": str(user_device_path)})
    assert str(cfg.state_dir) == custom_state_dir
    assert cfg.daily_cap_usd == 12.5
    # Untouched keys keep their product default.
    assert cfg.pages_branch == "pages"


def test_resolve_config_falls_back_when_registry_missing(tmp_path, monkeypatch):
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setattr(sp, "default_registry_path", lambda: tmp_path / "does-not-exist.json")
    cfg = lmvk_publish.resolve_config(vault, environment={})
    assert cfg.pages_repo_url == lmvk_publish._PRODUCT_DEFAULTS["pages_repo_url"]


# ---------------------------------------------------------------------------
# Concurrency lock
# ---------------------------------------------------------------------------


def test_acquire_then_release_lock_round_trips(tmp_path):
    lock_path = tmp_path / "state" / "lmvk-publish.lock"
    assert lmvk_publish.acquire_lock(lock_path) is True
    assert lock_path.exists()
    lmvk_publish.release_lock(lock_path)
    assert not lock_path.exists()


def test_second_acquire_fails_while_first_holds_the_lock(tmp_path):
    lock_path = tmp_path / "state" / "lmvk-publish.lock"
    assert lmvk_publish.acquire_lock(lock_path) is True
    assert lmvk_publish.acquire_lock(lock_path) is False  # our own pid is "alive" and fresh -> not stale


def test_lock_with_dead_pid_is_reclaimed(tmp_path):
    lock_path = tmp_path / "state" / "lmvk-publish.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    # A pid essentially guaranteed not to exist, with a *fresh* timestamp --
    # proves reclaim triggers on a dead process, not merely on staleness.
    lock_path.write_text(json.dumps({"pid": 999999999, "started_at": lmvk_publish._iso_now()}), encoding="utf-8")
    assert lmvk_publish.acquire_lock(lock_path) is True


def test_lock_with_alive_pid_but_old_timestamp_is_reclaimed(tmp_path):
    lock_path = tmp_path / "state" / "lmvk-publish.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    real_now = datetime.now(timezone.utc)
    stale_started = lmvk_publish._iso_now(real_now - timedelta(seconds=lmvk_publish.LOCK_STALE_SECONDS + 60))
    lock_path.write_text(json.dumps({"pid": os.getpid(), "started_at": stale_started}), encoding="utf-8")
    assert lmvk_publish.acquire_lock(lock_path) is True


def test_lock_with_corrupt_content_is_reclaimed(tmp_path):
    lock_path = tmp_path / "state" / "lmvk-publish.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text("not json", encoding="utf-8")
    assert lmvk_publish.acquire_lock(lock_path) is True


def test_run_pipeline_reports_locked_skip_and_exits_clean(tmp_path, repos, monkeypatch):
    cfg = _fixed_config(tmp_path, repos["vault_dir"], repos["pages_origin"])
    _patch_resolve_config(monkeypatch, cfg)
    cfg.lock_path.parent.mkdir(parents=True, exist_ok=True)
    cfg.lock_path.write_text(json.dumps({"pid": os.getpid(), "started_at": lmvk_publish._iso_now()}), encoding="utf-8")

    result = lmvk_publish.run_pipeline(
        repos["vault_dir"], full=False, dry_run=False, environment={**os.environ, "GITEA_TOKEN": "dummy"}
    )
    assert result["status"] == "skipped"
    assert result["skipped_reason"] == "locked"
    # A locked run must never touch the vault or pages state at all.
    assert result["vault_head_before"] is None


# ---------------------------------------------------------------------------
# Token invariant (ports scripts/lmvk-compile-publish.token-leak.test.ps1)
# ---------------------------------------------------------------------------


def test_initialize_git_auth_requires_the_token(tmp_path, repos):
    cfg = _fixed_config(tmp_path, repos["vault_dir"], repos["pages_origin"])
    logger = lmvk_publish._Logger(cfg.log_path)
    with pytest.raises(lmvk_publish.GitError):
        lmvk_publish.initialize_git_auth(cfg, {}, logger)


def test_askpass_helper_never_embeds_the_token_value(tmp_path, repos):
    cfg = _fixed_config(tmp_path, repos["vault_dir"], repos["pages_origin"])
    logger = lmvk_publish._Logger(cfg.log_path)
    token = "test-token-5090-regression-marker"

    git_env = lmvk_publish.initialize_git_auth(cfg, {"GITEA_TOKEN": token}, logger)

    assert cfg.askpass_path.exists()
    helper_text = cfg.askpass_path.read_text(encoding="utf-8")
    assert token not in helper_text
    assert "GITEA_TOKEN" in helper_text  # only the locator NAME is embedded

    assert git_env["GIT_ASKPASS"] == str(cfg.askpass_path)
    assert git_env["GIT_TERMINAL_PROMPT"] == "0"

    # Behavioral round-trip (mirrors the PS1 test's item 3: actually invoke
    # the helper and prove it returns the token from the environment).
    result = subprocess.run(
        [sys.executable, str(cfg.askpass_path), "Password for 'https://Curry@git.xart.top:8418':"],
        capture_output=True,
        text=True,
        env={**os.environ, "GITEA_TOKEN": token},
    )
    assert result.returncode == 0
    assert result.stdout == token

    # Nothing this module writes to disk may contain the literal token.
    logger.log("some benign log line")
    assert token not in cfg.log_path.read_text(encoding="utf-8")


def test_pages_repo_url_never_carries_the_token(tmp_path):
    vault = tmp_path / "vault"
    vault.mkdir()
    token = "should-never-appear-in-a-url"
    cfg = lmvk_publish.resolve_config(vault, environment={"GITEA_TOKEN": token})
    assert token not in cfg.pages_repo_url
    assert "GITEA_TOKEN" not in cfg.pages_repo_url


def test_git_env_dict_is_never_passed_to_a_logging_call():
    """Static check, same style as the PS1's own token-leak test statically
    grepping the PS1 source: no line in lmvk_publish.py may pass the
    `git_env`/`environment` dict itself into logger.log(...) -- only argv
    and captured subprocess stdout/stderr may be logged. This is what
    guarantees the token (present as a plain value inside that dict) can
    never reach the log file or stdout via a careless debug log line.
    """
    source = Path(lmvk_publish.__file__).read_text(encoding="utf-8")
    offending = [
        line
        for line in source.splitlines()
        if "logger.log(" in line and ("git_env" in line or "environment)" in line)
    ]
    assert offending == [], f"found logging call(s) that appear to log an env dict: {offending}"


# ---------------------------------------------------------------------------
# Full pipeline (real local git repos + real pandoc render)
# ---------------------------------------------------------------------------

pytestmark_pandoc = pytest.mark.skipif(not _pandoc_available(), reason="pandoc not installed")


@pytestmark_pandoc
def test_early_exit_on_head_unchanged(tmp_path, repos, monkeypatch):
    cfg = _fixed_config(tmp_path, repos["vault_dir"], repos["pages_origin"])
    _patch_resolve_config(monkeypatch, cfg)

    result = lmvk_publish.run_pipeline(
        repos["vault_dir"], full=False, dry_run=False, environment={**os.environ, "GITEA_TOKEN": "dummy"}
    )

    assert result["status"] == "ok"
    assert result["skipped_reason"] == "head-unchanged"
    assert result["vault_head_before"] == result["vault_head_after"]
    assert result["html_export"] is None
    assert result["publish"] is None
    assert not cfg.lock_path.exists()  # released


@pytestmark_pandoc
def test_full_run_renders_and_publishes(tmp_path, repos, monkeypatch):
    cfg = _fixed_config(tmp_path, repos["vault_dir"], repos["pages_origin"])
    _patch_resolve_config(monkeypatch, cfg)
    new_head = _push_new_commit(repos["vault_origin"], repos["work"])

    result = lmvk_publish.run_pipeline(
        repos["vault_dir"], full=False, dry_run=False, environment={**os.environ, "GITEA_TOKEN": "dummy"}
    )

    assert result["status"] == "ok"
    assert result["skipped_reason"] is None
    assert result["vault_head_after"] == new_head
    assert result["html_export"]["files_exported"] >= 2  # note.md + second.md
    assert result["publish"]["pushed"] is True
    assert result["publish"]["commit"]
    assert result["last_success"]["commit"] == result["publish"]["commit"]
    assert not cfg.lock_path.exists()

    # Status file mirrors the stdout schema and was actually persisted.
    on_disk = json.loads(cfg.status_path.read_text(encoding="utf-8"))
    assert on_disk["publish"]["commit"] == result["publish"]["commit"]

    # The pages bare repo really received the push.
    checkout = tmp_path / "pages-checkout"
    _git("clone", "-b", "pages", str(repos["pages_origin"]), str(checkout), cwd=tmp_path)
    assert (checkout / "note.html").exists() or (checkout / "second.html").exists()


@pytestmark_pandoc
def test_full_flag_bypasses_head_unchanged_early_exit(tmp_path, repos, monkeypatch):
    cfg = _fixed_config(tmp_path, repos["vault_dir"], repos["pages_origin"])
    _patch_resolve_config(monkeypatch, cfg)

    result = lmvk_publish.run_pipeline(
        repos["vault_dir"], full=True, dry_run=False, environment={**os.environ, "GITEA_TOKEN": "dummy"}
    )

    assert result["status"] == "ok"
    assert result["skipped_reason"] is None
    assert result["html_export"] is not None
    assert result["publish"]["pushed"] is True  # first publish ever -> orphan bootstrap + real content change


@pytestmark_pandoc
def test_dry_run_never_pushes(tmp_path, repos, monkeypatch):
    cfg = _fixed_config(tmp_path, repos["vault_dir"], repos["pages_origin"])
    _patch_resolve_config(monkeypatch, cfg)

    result = lmvk_publish.run_pipeline(
        repos["vault_dir"], full=True, dry_run=True, environment={**os.environ, "GITEA_TOKEN": "dummy"}
    )

    assert result["status"] == "ok"
    assert result["publish"]["would_push"] is True
    assert result["publish"]["pushed"] is False
    assert result["publish"]["commit"] is None
    assert result["last_success"]["commit"] is None

    # The remote must be completely untouched -- no `pages` ref at all yet.
    heads = subprocess.run(
        ["git", "ls-remote", "--heads", str(repos["pages_origin"]), "pages"],
        capture_output=True, text=True, cwd=str(tmp_path),
    ).stdout
    assert heads.strip() == ""


@pytestmark_pandoc
def test_republish_with_no_content_change_skips_empty_commit(tmp_path, repos, monkeypatch):
    cfg = _fixed_config(tmp_path, repos["vault_dir"], repos["pages_origin"])
    _patch_resolve_config(monkeypatch, cfg)
    # Two things vary run-to-run even with no real vault change, both
    # deliberately pinned here so this test isolates the "no real content
    # changed" branch instead of asserting on wall-clock flakiness:
    #  1. export_vault_direct stamps every page's footer with
    #     build_timestamp_now() (real "now", second resolution) when
    #     ExportOptions.build_timestamp is unset.
    #  2. This vault has no compile.py "topics" but its emerge threshold is
    #     always overdue (no prior emerge report), so evaluate_actions
    #     schedules an "emerge" action every tick regardless -- and
    #     evaluate.append_log_entry appends a fresh entry to the vault's own
    #     log.md for EVERY scheduler result, not just "compile" ones. Since
    #     export_vault_direct walks the whole vault, log.md becomes
    #     log.html, so a live scheduler makes two runs differ even with a
    #     pinned footer. This is real, pre-existing behavior (identical
    #     under the PS1, which ran the same scheduler.py --once before the
    #     same exporter) -- not something this test should be exercising.
    import html_export.exporter as exporter_module
    import scheduler as scheduler_module

    monkeypatch.setattr(exporter_module, "build_timestamp_now", lambda: "2026-01-01T00:00:00Z")
    monkeypatch.setattr(scheduler_module, "evaluate_actions", lambda state, settings: [])

    first = lmvk_publish.run_pipeline(
        repos["vault_dir"], full=True, dry_run=False, environment={**os.environ, "GITEA_TOKEN": "dummy"}
    )
    assert first["publish"]["pushed"] is True

    second = lmvk_publish.run_pipeline(
        repos["vault_dir"], full=True, dry_run=False, environment={**os.environ, "GITEA_TOKEN": "dummy"}
    )
    assert second["publish"]["pushed"] is False
    assert second["publish"]["message"] == "no-content-changes"
    # last_success is carried forward from the first (real) publish, not lost.
    assert second["last_success"]["commit"] == first["publish"]["commit"]


@pytestmark_pandoc
def test_cost_cap_skips_compile_but_still_renders_and_publishes(tmp_path, repos, monkeypatch):
    cfg = _fixed_config(tmp_path, repos["vault_dir"], repos["pages_origin"])
    _patch_resolve_config(monkeypatch, cfg)
    cost_guard.write_spend_state(cfg.spend_state_path, cost_guard.today_utc(), 5.0)  # at the $5 cap

    result = lmvk_publish.run_pipeline(
        repos["vault_dir"], full=True, dry_run=False, environment={**os.environ, "GITEA_TOKEN": "dummy"}
    )

    assert result["compile"]["skipped_reason"] == "cost-cap"
    assert result["compile"]["ran"] is False
    assert result["html_export"] is not None  # zero-LLM render still runs
    assert result["publish"]["pushed"] is True


def test_missing_token_produces_structured_error_not_a_crash(tmp_path, repos, monkeypatch):
    cfg = _fixed_config(tmp_path, repos["vault_dir"], repos["pages_origin"])
    _patch_resolve_config(monkeypatch, cfg)

    result = lmvk_publish.run_pipeline(repos["vault_dir"], full=False, dry_run=False, environment={})

    assert result["status"] == "error"
    assert "GITEA_TOKEN" in result["error"]
    assert not cfg.lock_path.exists()  # released even on failure
    on_disk = json.loads(cfg.status_path.read_text(encoding="utf-8"))
    assert on_disk["status"] == "error"


# ---------------------------------------------------------------------------
# CLI (subprocess-level black box: stdout is EXACTLY one JSON blob)
# ---------------------------------------------------------------------------


@pytestmark_pandoc
def test_cli_stdout_is_a_single_json_blob_and_exit_code_is_zero_on_early_exit(tmp_path, repos):
    """python -m compiler.lmvk_publish <vault> --dry-run --format json,
    invoked exactly as the CLI contract specifies, from the repo root --
    the same way schtasks and the Obsidian plugin's execFile call it."""
    registry = sp.load_registry(REGISTRY_PATH)
    # state_dir is user-device/session scoped -- NOT vault scoped (see its
    # allowedScopes in registry/v1.json). Writing it at "vault" scope is
    # rejected, and an unasserted rejection would silently leave the child
    # process pointing at the REAL ~/.claude/state: the test would then share
    # a lock file with the machine's live schtasks run and fail whenever the
    # production leg happens to be mid-publish. Isolate it properly instead.
    user_device_path = tmp_path / "cli-user-device.json"
    service = sp.SettingsService(
        registry=registry,
        vault_path=repos["vault_dir"],
        environment={},
        user_device_path=user_device_path,
    )
    result = service.assignment_set(
        scope="user-device",
        key="lmvk.publish.state_dir",
        value=str(tmp_path / "cli-state"),
        expected_revision=0,
        updated_by="test",
    )
    assert result["status"] == "committed", result

    repo_root = Path(__file__).resolve().parents[2]
    proc = subprocess.run(
        [sys.executable, "-m", "compiler.lmvk_publish", str(repos["vault_dir"]), "--dry-run", "--format", "json"],
        cwd=str(repo_root),
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "GITEA_TOKEN": "dummy",
            # Point the child at the same isolated user-device document.
            "LLMWIKI_SETTINGS_USER_PATH": str(user_device_path),
        },
        timeout=120,
    )

    assert proc.returncode == 0, proc.stderr
    stdout_lines = [line for line in proc.stdout.splitlines() if line.strip()]
    assert len(stdout_lines) == 1, f"expected exactly one stdout line, got: {proc.stdout!r}"
    payload = json.loads(stdout_lines[0])
    assert payload["schema_version"] == lmvk_publish.SCHEMA_VERSION
    assert payload["status"] == "ok"
    assert payload["skipped_reason"] == "head-unchanged"
    # Human-readable logging went to stderr, not stdout.
    assert "=====" in proc.stderr


def test_main_keeps_callee_stdout_prints_out_of_the_json_contract(tmp_path, monkeypatch, capsys):
    """The single-JSON-blob contract must survive callees that print().

    Regression: html_export's service-worker step prints
    "  [sw] precache: full site (N files, ...)" to stdout on every real
    render, which corrupted the JSON blob for the plugin's execFile parser.
    It only reproduces on a rendering run -- the --dry-run CLI test above
    early-exits on HEAD-unchanged and never reaches the renderer, so it
    stayed green while a real --full run was broken. main() must therefore
    isolate stdout for the whole pipeline, for ANY callee, not just [sw].
    """

    def fake_pipeline(vault_path, full=False, dry_run=False):
        print("  [sw] precache: full site (3517 files, 34.4 MB <= 100 MB limit)")
        print("unrelated future callee chatter")
        return {
            "schema_version": lmvk_publish.SCHEMA_VERSION,
            "status": "ok",
            "skipped_reason": None,
            "full": full,
            "dry_run": dry_run,
        }

    monkeypatch.setattr(lmvk_publish, "run_pipeline", fake_pipeline)

    exit_code = lmvk_publish.main([str(tmp_path), "--full", "--format", "json"])
    captured = capsys.readouterr()

    assert exit_code == 0
    stdout_lines = [line for line in captured.out.splitlines() if line.strip()]
    assert len(stdout_lines) == 1, f"stdout must be exactly one JSON blob, got: {captured.out!r}"
    payload = json.loads(stdout_lines[0])
    assert payload["status"] == "ok"
    assert payload["full"] is True
    # The callee chatter is not lost -- it is rerouted to the human stream.
    assert "[sw] precache" in captured.err
    assert "unrelated future callee chatter" in captured.err


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
