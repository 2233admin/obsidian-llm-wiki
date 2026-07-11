"""Validation engine — Pass 0 (pre-commit sync).

Scans a vault or single file for frontmatter contract violations.
Also enforces the frozen decision invariant: edits to frozen notes are blocked.

CLI usage (called by pre-commit hook):
    python -m compiler.rhizome.check <vault_path> [--staged-files file1 file2 ...]
    python -m compiler.rhizome.check <vault_path> --file path/to/note.md
    python -m compiler.rhizome.check <vault_path> --staged-files-from manifest.txt

--staged-files-from reads one relative path per line from a manifest file.
Equivalent to --staged-files but avoids OS argv-length limits for large
staged-file counts (e.g. big batch commits on Windows).

Exit codes:
    0  all clean (or only warnings)
    1  one or more errors found
    2  frozen note modified (hard block)
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

from .contract import ContractViolation, is_frozen, validate_note


@dataclass
class CheckResult:
    path: Path
    violations: list[ContractViolation] = field(default_factory=list)
    derived_id: str | None = None
    frozen_modified: bool = False

    @property
    def has_errors(self) -> bool:
        return any(v.severity == "error" for v in self.violations)

    @property
    def has_warnings(self) -> bool:
        return any(v.severity == "warning" for v in self.violations)


def check_file(path: Path, vault_root: Path | None = None) -> CheckResult:
    """Parse and validate a single markdown file."""
    try:
        text = path.read_text("utf-8-sig", errors="replace")
    except OSError as e:
        return CheckResult(
            path=path,
            violations=[ContractViolation("file", str(e), "error")],
        )

    fm = _parse_frontmatter(text)
    rel = path.relative_to(vault_root) if vault_root else path
    violations = validate_note(fm, rel)
    derived_id = fm.get("id") or None

    return CheckResult(
        path=path,
        violations=violations,
        derived_id=derived_id,
        frozen_modified=False,
    )


def check_vault(
    vault_path: Path,
    staged_files: list[Path] | None = None,
) -> list[CheckResult]:
    """Check all markdown files in the vault (or only staged_files).

    If staged_files is provided (pre-commit mode), any staged file that is a
    frozen decision is flagged as frozen_modified=True and gets an error.
    """
    results: list[CheckResult] = []
    targets = staged_files if staged_files is not None else _walk_md(vault_path)

    for path in targets:
        if not path.exists():
            continue
        result = check_file(path, vault_path)
        if staged_files is not None:
            fm = _parse_frontmatter(path.read_text("utf-8-sig", errors="replace"))
            if is_frozen(fm):
                result.frozen_modified = True
                result.violations.insert(0, ContractViolation(
                    field="frozen",
                    message=(
                        "cannot edit a frozen decision; "
                        "create a new note with supersedes: [this-id]"
                    ),
                    severity="error",
                ))
        results.append(result)

    return results


def _walk_md(base: Path) -> list[Path]:
    results = []
    skip = {".obsidian", "node_modules", ".git", ".trash", "venv"}
    for root, dirs, files in os.walk(base):
        dirs[:] = sorted(d for d in dirs if d not in skip and not d.startswith("."))
        for f in sorted(files):
            if f.endswith(".md"):
                results.append(Path(root) / f)
    return results


def _parse_frontmatter(text: str) -> dict:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    fm: dict = {}
    for line in text[4:end].split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        colon = line.find(":")
        if colon == -1:
            continue
        key = line[:colon].strip()
        val = line[colon + 1:].strip()
        if val.startswith('"') and val.endswith('"'):
            val = val[1:-1]
        elif val.startswith("'") and val.endswith("'"):
            val = val[1:-1]
        fm[key] = val
    return fm


def _format_results(results: list[CheckResult]) -> tuple[str, int]:
    lines = []
    exit_code = 0

    for r in results:
        if not r.violations:
            continue
        for v in r.violations:
            prefix = "ERROR" if v.severity == "error" else "WARN "
            lines.append(f"{prefix}  {r.path}  [{v.field}]  {v.message}")
            if v.severity == "error":
                exit_code = max(exit_code, 2 if r.frozen_modified else 1)

    return "\n".join(lines), exit_code


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]

    if not args:
        print(
            "Usage: python -m compiler.rhizome.check <vault_path> [--staged-files file...]",
            file=sys.stderr,
        )
        return 1

    vault_path = Path(args[0])
    staged: list[Path] | None = None

    if "--staged-files-from" in args:
        idx = args.index("--staged-files-from")
        manifest = Path(args[idx + 1])
        lines = manifest.read_text("utf-8-sig").splitlines()
        staged = [Path(p.strip()) for p in lines if p.strip()]
    elif "--staged-files" in args:
        idx = args.index("--staged-files")
        staged = [Path(p) for p in args[idx + 1:]]
    elif "--file" in args:
        idx = args.index("--file")
        staged = [vault_path / args[idx + 1]]

    results = check_vault(vault_path, staged_files=staged)
    output, exit_code = _format_results(results)

    errors = sum(1 for r in results for v in r.violations if v.severity == "error")
    warnings = sum(1 for r in results for v in r.violations if v.severity == "warning")

    if output:
        print(output)

    print(f"\nrhizome check: {errors} error(s), {warnings} warning(s) in {len(results)} file(s)")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
