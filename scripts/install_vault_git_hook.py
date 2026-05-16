#!/usr/bin/env python
"""Install a pre-commit hook that runs llmwiki_doctor.py for a vault repo."""
from __future__ import annotations

import argparse
import os
from pathlib import Path


HOOK = """#!/bin/sh
set -eu

VAULT_ROOT="$(git rev-parse --show-toplevel)"
LLMWIKI_ROOT="{llmwiki_root}"

python "$LLMWIKI_ROOT/scripts/llmwiki_doctor.py" --vault "$VAULT_ROOT"
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Install collaborative vault doctor pre-commit hook.")
    parser.add_argument("--vault", required=True, help="Path to the Git-managed Obsidian vault")
    parser.add_argument("--llmwiki-root", default=None, help="Path to this LLMwiki checkout")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing pre-commit hook")
    args = parser.parse_args()

    vault = Path(args.vault).expanduser().resolve()
    git_dir = vault / ".git"
    if not git_dir.exists():
        raise SystemExit(f"not a Git repository: {vault}")

    llmwiki_root = Path(args.llmwiki_root).expanduser().resolve() if args.llmwiki_root else Path(__file__).resolve().parents[1]
    doctor_script = llmwiki_root / "scripts" / "llmwiki_doctor.py"
    if not doctor_script.exists():
        raise SystemExit(f"doctor script not found: {doctor_script}")

    hooks_dir = git_dir / "hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    hook_path = hooks_dir / "pre-commit"
    if hook_path.exists() and not args.force:
        raise SystemExit(f"pre-commit hook already exists: {hook_path}. Re-run with --force to overwrite.")

    body = HOOK.format(llmwiki_root=str(llmwiki_root).replace("\\", "/"))
    hook_path.write_text(body, encoding="utf-8")
    try:
        mode = hook_path.stat().st_mode
        os.chmod(hook_path, mode | 0o111)
    except OSError:
        pass

    print(f"installed pre-commit hook: {hook_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
