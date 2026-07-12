from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


Runner = Callable[..., subprocess.CompletedProcess]


@dataclass(frozen=True)
class AutoCommitResult:
    path: Path
    message: str
    dry_run: bool
    committed: bool
    commands: tuple[tuple[str, ...], ...]


def auto_commit(
    path: str | Path,
    message: str | None = None,
    *,
    dry_run: bool = True,
    runner: Runner | None = None,
) -> AutoCommitResult:
    target = Path(path)
    commit_message = message or f"task: update {target.name}"
    commands: tuple[tuple[str, ...], ...] = (
        ("git", "add", str(target)),
        ("git", "commit", "-m", commit_message),
    )

    if dry_run:
        return AutoCommitResult(
            path=target,
            message=commit_message,
            dry_run=True,
            committed=False,
            commands=commands,
        )

    run = runner or subprocess.run
    for command in commands:
        run(command, check=True)

    return AutoCommitResult(
        path=target,
        message=commit_message,
        dry_run=False,
        committed=True,
        commands=commands,
    )
