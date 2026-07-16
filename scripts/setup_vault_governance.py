#!/usr/bin/env python
"""LMVK L5 vault governance kit — run ON the vault machine (e.g. 5080).

Hardens a production Obsidian vault git repo in three idempotent steps:

  1. rhizome pre-commit   Install a pre-commit hook that runs rhizome Pass 0
                          (compiler.rhizome.check) in --staged-files-from mode
                          against staged *.md files. Blocks contract errors and
                          edits to frozen decisions.
  2. obsidian-git taming  Patch .obsidian/plugins/obsidian-git/data.json
                          (JSON merge, unknown keys preserved):
                          pullBeforePush=true, commit message template with
                          {{hostname}}, autoSaveInterval raised (lower backup
                          frequency). Warns instead of creating anything if the
                          plugin dir is absent.
  3. machine-state ignore Append machine-state patterns to the vault .gitignore
                          (.obsidian/graph.json, .obsidian/plugins/*/main.js,
                          .makemd/*.mdc, .space/*.mdb) and `git rm --cached`
                          any currently tracked matches. Working-tree files are
                          never touched; the operator commits the index change.

DRY-RUN IS THE DEFAULT (repo culture: dryRun=true for all write ops). Every
action is printed but nothing is written until you pass --apply.

Usage:
    python scripts/setup_vault_governance.py --vault D:/knowledge            # dry-run (default)
    python scripts/setup_vault_governance.py --vault D:/knowledge --apply    # execute
    python scripts/setup_vault_governance.py --vault D:/knowledge --apply \\
        --skip-obsidian-git --auto-save-interval 60

Flags:
    --vault PATH             Git-managed Obsidian vault (required)
    --llmwiki-root PATH      obsidian-llm-wiki checkout (default: this file's repo)
    --apply                  Execute changes (default is dry-run)
    --dry-run                Explicit no-op form of the default
    --skip-hook              Skip step 1 (rhizome pre-commit)
    --skip-obsidian-git      Skip step 2 (obsidian-git data.json)
    --skip-gitignore         Skip step 3 (.gitignore + git rm --cached)
    --force                  Overwrite a foreign pre-commit hook (backed up first)
    --auto-save-interval N   Minimum obsidian-git autoSaveInterval in minutes (default 30)
    --hostname NAME          Machine name for commit messages (default: this host)

Zero-dependency (stdlib only), Python 3.11+.
Spec: docs/specs/lmvk-execution-and-release.md L5.
"""
from __future__ import annotations

import argparse
import json
import platform
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

HOOK_MARKER = "llmwiki-l5-rhizome-pre-commit"

HOOK_TEMPLATE = """#!/bin/sh
# llmwiki-l5-rhizome-pre-commit v1
# Installed by obsidian-llm-wiki/scripts/setup_vault_governance.py (LMVK L5).
# Runs rhizome Pass 0 contract checks on staged markdown files.
# Override the interpreter with LLMWIKI_PYTHON=... if `python` is not on PATH.
set -eu

VAULT_ROOT="$(git rev-parse --show-toplevel)"
LLMWIKI_ROOT="__LLMWIKI_ROOT__"
PYTHON_BIN="${LLMWIKI_PYTHON:-python}"

MANIFEST="$(git rev-parse --git-dir)/llmwiki_staged_manifest.txt"
trap 'rm -f "$MANIFEST"' EXIT

# One vault-absolute path per line. core.quotepath=off keeps non-ASCII
# filenames raw (no octal escaping) so Python can open them directly.
: > "$MANIFEST"
git -c core.quotepath=off diff --cached --name-only --diff-filter=ACMR -- '*.md' |
while IFS= read -r f; do
    printf '%s/%s\\n' "$VAULT_ROOT" "$f" >> "$MANIFEST"
done

# Nothing staged that rhizome cares about -> allow the commit.
[ -s "$MANIFEST" ] || exit 0

# Equivalent to `python -m compiler.rhizome.check` (the documented CLI) but
# imported via -c to avoid runpy's double-import RuntimeWarning noise
# (compiler/rhizome/__init__.py already imports .check).
PYTHONUTF8=1 PYTHONPATH="$LLMWIKI_ROOT" "$PYTHON_BIN" -c \\
    'import sys; from compiler.rhizome.check import main; sys.exit(main())' \\
    "$VAULT_ROOT" --staged-files-from "$MANIFEST"
"""

IGNORE_HEADER = "# LMVK L5: machine-state files (setup_vault_governance.py)"
IGNORE_PATTERNS = [
    ".obsidian/graph.json",
    ".obsidian/plugins/*/main.js",
    ".makemd/*.mdc",
    ".space/*.mdb",
]

DEFAULT_COMMIT_MESSAGE = "vault backup: {{date}}"
HOSTNAME_TOKEN = "{{hostname}}"


@dataclass
class StepReport:
    name: str
    status: str = "skipped"  # done | skipped | warned
    notes: list[str] = field(default_factory=list)

    def note(self, message: str) -> None:
        self.notes.append(message)
        print(f"  - {message}")


@dataclass
class Ctx:
    vault: Path
    llmwiki_root: Path
    apply: bool
    force: bool
    reports: list[StepReport] = field(default_factory=list)

    def begin(self, name: str, title: str) -> StepReport:
        report = StepReport(name=name)
        self.reports.append(report)
        print(f"\n[{name}] {title}")
        return report

    @property
    def verb(self) -> str:
        return "" if self.apply else "would "

    @property
    def done_status(self) -> str:
        return "done" if self.apply else "planned"


def run_git(vault: Path, *args: str) -> subprocess.CompletedProcess:
    """Run git against the vault repo. Raises FileNotFoundError if git is absent."""
    return subprocess.run(
        ["git", "-C", str(vault), "-c", "core.quotepath=off", *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def resolve_hooks_dir(vault: Path) -> Path | None:
    """Resolve the vault repo's hooks directory (honors core.hooksPath when git is available)."""
    try:
        proc = run_git(vault, "rev-parse", "--git-path", "hooks")
        if proc.returncode == 0 and proc.stdout.strip():
            hooks = Path(proc.stdout.strip())
            return hooks if hooks.is_absolute() else (vault / hooks)
    except FileNotFoundError:
        pass  # git not on PATH — fall back to manual resolution
    git_entry = vault / ".git"
    if git_entry.is_dir():
        return git_entry / "hooks"
    if git_entry.is_file():  # worktree / submodule: `.git` is a "gitdir: ..." pointer file
        match = re.match(r"gitdir:\s*(.+)", git_entry.read_text("utf-8-sig").strip())
        if match:
            gitdir = Path(match.group(1).strip())
            if not gitdir.is_absolute():
                gitdir = (vault / gitdir).resolve()
            return gitdir / "hooks"
    return None


# ---------------------------------------------------------------------------
# Step 1 — rhizome pre-commit (--staged-files-from mode)
# ---------------------------------------------------------------------------

def step_install_hook(ctx: Ctx) -> None:
    report = ctx.begin("rhizome-pre-commit", "install rhizome --staged-files-from pre-commit hook")

    check_module = ctx.llmwiki_root / "compiler" / "rhizome" / "check.py"
    if not check_module.exists():
        report.status = "warned"
        report.note(f"rhizome check module not found: {check_module} — pass --llmwiki-root")
        return

    hooks_dir = resolve_hooks_dir(ctx.vault)
    if hooks_dir is None:
        report.status = "warned"
        report.note(f"could not resolve hooks dir for {ctx.vault} — is it a git repo?")
        return

    body = HOOK_TEMPLATE.replace("__LLMWIKI_ROOT__", str(ctx.llmwiki_root).replace("\\", "/"))
    hook_path = hooks_dir / "pre-commit"

    if hook_path.exists():
        existing = hook_path.read_text("utf-8-sig", errors="replace")
        if existing == body:
            report.status = "skipped"
            report.note(f"hook already installed and current: {hook_path}")
            return
        if HOOK_MARKER not in existing and not ctx.force:
            report.status = "warned"
            report.note(f"foreign pre-commit hook present: {hook_path}")
            report.note("(possibly the llmwiki_doctor hook from install_vault_git_hook.py)")
            report.note("re-run with --force to replace it (a .bak backup is kept), or chain manually")
            return
        if HOOK_MARKER not in existing:  # --force on a foreign hook: keep a backup
            backup = hook_path.with_name("pre-commit.pre-l5.bak")
            report.note(f"{ctx.verb}back up foreign hook to {backup}")
            if ctx.apply:
                backup.write_text(existing, encoding="utf-8")

    report.note(f"{ctx.verb}write hook: {hook_path}")
    report.note("hook runs: python -m compiler.rhizome.check <vault> --staged-files-from <manifest>")
    if ctx.apply:
        hooks_dir.mkdir(parents=True, exist_ok=True)
        hook_path.write_text(body, encoding="utf-8", newline="\n")
        try:
            hook_path.chmod(hook_path.stat().st_mode | 0o111)
        except OSError:
            pass  # Windows: git-bash runs sh hooks regardless of mode bits
    report.status = ctx.done_status


# ---------------------------------------------------------------------------
# Step 2 — obsidian-git taming (pull-before-push / hostname / lower frequency)
# ---------------------------------------------------------------------------

def step_tame_obsidian_git(ctx: Ctx, min_interval: int, hostname: str) -> None:
    report = ctx.begin("obsidian-git", "tame auto-backup (pullBeforePush / {{hostname}} / interval)")

    plugin_dir = ctx.vault / ".obsidian" / "plugins" / "obsidian-git"
    if not plugin_dir.is_dir():
        report.status = "warned"
        report.note(f"plugin dir absent: {plugin_dir} — nothing created (install obsidian-git first)")
        return

    data_path = plugin_dir / "data.json"
    data: dict = {}
    if data_path.exists():
        try:
            data = json.loads(data_path.read_text("utf-8-sig"))
        except (json.JSONDecodeError, OSError) as e:
            report.status = "warned"
            report.note(f"cannot parse {data_path}: {e} — not touching it")
            return
        if not isinstance(data, dict):
            report.status = "warned"
            report.note(f"{data_path} is not a JSON object — not touching it")
            return
    else:
        report.note(f"{data_path} missing (plugin never saved settings) — {ctx.verb}create it with only the keys below")

    changes: dict = {}

    # pull-before-push
    if data.get("pullBeforePush") is not True:
        changes["pullBeforePush"] = True

    # commit message templates: ensure {{hostname}} is part of the subject.
    # commitMessage = classic/manual key; autoCommitMessage = auto-backup key
    # in newer plugin versions. Set both so either code path is covered.
    for key in ("commitMessage", "autoCommitMessage"):
        current = str(data.get(key) or DEFAULT_COMMIT_MESSAGE)
        if HOSTNAME_TOKEN not in current:
            changes[key] = f"{current} [{HOSTNAME_TOKEN}]"

    # best-effort device name so {{hostname}} expands on older plugin versions
    # (newer versions keep it in localStorage; harmless extra key there).
    if not data.get("hostname"):
        changes["hostname"] = hostname

    # lower auto-backup frequency: raise autoSaveInterval (minutes) to the floor.
    try:
        current_interval = int(data.get("autoSaveInterval", 0) or 0)
    except (TypeError, ValueError):
        current_interval = 0
    if current_interval == 0:
        report.note("autoSaveInterval is 0/absent (auto-backup timer off) — left as-is")
    elif current_interval < min_interval:
        changes["autoSaveInterval"] = min_interval
    else:
        report.note(f"autoSaveInterval already {current_interval} >= {min_interval} — left as-is")

    # report (but do not change) other aggressive timers
    for key in ("autoPushInterval", "autoPullInterval"):
        try:
            val = int(data.get(key, 0) or 0)
        except (TypeError, ValueError):
            val = 0
        if 0 < val < 5:
            report.note(f"NOTE: {key}={val} min is aggressive — consider raising it manually")

    if not changes:
        report.status = "skipped"
        report.note("all target keys already in the desired state")
        return

    for key, new in changes.items():
        old = data.get(key, "<absent>")
        report.note(f"{ctx.verb}set {key}: {old!r} -> {new!r}")
    report.note("operator review: on recent obsidian-git versions the device name lives in "
                "Obsidian localStorage — verify Settings > Obsidian Git > Advanced > Hostname on this machine")

    if ctx.apply:
        merged = {**data, **changes}  # JSON merge: unknown keys preserved
        data_path.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    report.status = ctx.done_status


# ---------------------------------------------------------------------------
# Step 3 — machine-state files: .gitignore + git rm --cached
# ---------------------------------------------------------------------------

def step_gitignore(ctx: Ctx) -> None:
    report = ctx.begin("gitignore", "ignore machine-state files and untrack existing matches")

    gitignore = ctx.vault / ".gitignore"
    existing_lines: set[str] = set()
    text = ""
    if gitignore.exists():
        text = gitignore.read_text("utf-8-sig", errors="replace")
        existing_lines = {line.strip() for line in text.splitlines()}

    missing = [p for p in IGNORE_PATTERNS if p not in existing_lines]
    if missing:
        for pattern in missing:
            report.note(f"{ctx.verb}append to .gitignore: {pattern}")
        if ctx.apply:
            block = []
            if text and not text.endswith("\n"):
                block.append("")
            if IGNORE_HEADER not in existing_lines:
                block.append(IGNORE_HEADER)
            block.extend(missing)
            with gitignore.open("a", encoding="utf-8", newline="\n") as fh:
                fh.write("\n".join(block) + "\n")
        report.status = ctx.done_status
    else:
        report.note("all patterns already present in .gitignore")

    # untrack currently tracked matches (index only — working tree untouched)
    try:
        proc = run_git(ctx.vault, "ls-files", "-z", "--", *IGNORE_PATTERNS)
    except FileNotFoundError:
        report.status = "warned"
        report.note("git not on PATH — cannot check for tracked machine-state files")
        return
    if proc.returncode != 0:
        report.status = "warned"
        report.note(f"git ls-files failed: {proc.stderr.strip()}")
        return

    tracked = [p for p in proc.stdout.split("\0") if p]
    if not tracked:
        report.note("no machine-state files currently tracked")
        if report.status != "done":
            report.status = "skipped"
        return

    for path in tracked:
        report.note(f"{ctx.verb}git rm --cached: {path}")

    if ctx.apply:
        # :(literal) pathspec magic: treat each line verbatim (no glob expansion);
        # --pathspec-from-file avoids Windows argv-length limits on big vaults.
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", suffix=".pathspec",
                                         delete=False) as fh:
            fh.write("\0".join(f":(literal){p}" for p in tracked))
            pathspec_file = fh.name
        try:
            rm = run_git(ctx.vault, "rm", "--cached", "-f", "-q",
                         f"--pathspec-from-file={pathspec_file}", "--pathspec-file-nul")
        finally:
            try:
                Path(pathspec_file).unlink()
            except OSError:
                pass
        if rm.returncode != 0:
            report.status = "warned"
            report.note(f"git rm --cached failed: {rm.stderr.strip()}")
            return
        report.note(f"untracked {len(tracked)} file(s) — files remain on disk")
        report.note("remember to commit the index change (obsidian-git will pick it up)")
    report.status = ctx.done_status


# ---------------------------------------------------------------------------

def summarize(ctx: Ctx) -> None:
    mode = "APPLY" if ctx.apply else "DRY-RUN"
    print(f"\n=== setup_vault_governance summary ({mode}) ===")
    for report in ctx.reports:
        print(f"  [{report.status:<7}] {report.name}")
        for note in report.notes:
            print(f"            {note}")
    if not ctx.apply:
        print("\nmode: DRY-RUN — nothing was changed. Re-run with --apply to execute.")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(
        description="LMVK L5 vault governance: rhizome pre-commit, obsidian-git taming, machine-state gitignore.",
        epilog="Dry-run is the default; pass --apply to execute. See module docstring for details.",
    )
    parser.add_argument("--vault", required=True, help="Path to the Git-managed Obsidian vault")
    parser.add_argument("--llmwiki-root", default=None, help="Path to this obsidian-llm-wiki checkout")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Execute changes (default is dry-run)")
    mode.add_argument("--dry-run", action="store_true", help="Print actions without executing (the default)")
    parser.add_argument("--skip-hook", action="store_true", help="Skip step 1: rhizome pre-commit hook")
    parser.add_argument("--skip-obsidian-git", action="store_true", help="Skip step 2: obsidian-git data.json")
    parser.add_argument("--skip-gitignore", action="store_true", help="Skip step 3: gitignore + git rm --cached")
    parser.add_argument("--force", action="store_true", help="Overwrite a foreign pre-commit hook (backup kept)")
    parser.add_argument("--auto-save-interval", type=int, default=30,
                        help="Minimum obsidian-git autoSaveInterval in minutes (default: 30)")
    parser.add_argument("--hostname", default=platform.node() or "unknown-host",
                        help="Machine name for commit messages (default: this host's name)")
    args = parser.parse_args()

    vault = Path(args.vault).expanduser().resolve()
    if not (vault / ".git").exists():
        raise SystemExit(f"not a Git repository: {vault}")

    llmwiki_root = (Path(args.llmwiki_root).expanduser().resolve()
                    if args.llmwiki_root else Path(__file__).resolve().parents[1])

    ctx = Ctx(vault=vault, llmwiki_root=llmwiki_root, apply=args.apply, force=args.force)
    print(f"vault:        {vault}")
    print(f"llmwiki root: {llmwiki_root}")
    print(f"mode:         {'APPLY' if ctx.apply else 'DRY-RUN (default; pass --apply to execute)'}")

    if args.skip_hook:
        ctx.begin("rhizome-pre-commit", "skipped via --skip-hook")
    else:
        step_install_hook(ctx)

    if args.skip_obsidian_git:
        ctx.begin("obsidian-git", "skipped via --skip-obsidian-git")
    else:
        step_tame_obsidian_git(ctx, args.auto_save_interval, args.hostname)

    if args.skip_gitignore:
        ctx.begin("gitignore", "skipped via --skip-gitignore")
    else:
        step_gitignore(ctx)

    summarize(ctx)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
