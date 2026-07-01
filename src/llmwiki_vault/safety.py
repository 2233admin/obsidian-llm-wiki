from __future__ import annotations

from pathlib import Path


class PathSafetyError(ValueError):
    pass


def resolve_vault_path(path: str | Path) -> Path:
    return Path(path).expanduser().resolve(strict=False)


def ensure_inside(vault_root: Path, candidate: str | Path, *, must_exist: bool = False) -> Path:
    candidate_path = Path(candidate)
    if candidate_path.is_absolute():
        resolved = candidate_path.resolve(strict=must_exist)
    else:
        resolved = (vault_root / candidate_path).resolve(strict=must_exist)
    try:
        resolved.relative_to(vault_root)
    except ValueError as exc:
        raise PathSafetyError(f"path escapes vault: {candidate}") from exc
    return resolved


def validate_relative_path(vault_root: Path, value: str, *, must_exist: bool = False) -> Path:
    if not value or value.startswith(("http://", "https://", "obsidian://")):
        raise PathSafetyError(f"expected vault-relative path, got: {value}")
    path = Path(value)
    if path.is_absolute():
        raise PathSafetyError(f"absolute paths are not allowed: {value}")
    return ensure_inside(vault_root, path, must_exist=must_exist)
