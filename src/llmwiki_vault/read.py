from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from .domain import EvidenceRecord, SourceRecord, VaultIndexSnapshot
from .markdown import FrontmatterError, parse_markdown, render_markdown
from .safety import resolve_vault_path
from .schema import EVIDENCE_REQUIRED_FIELDS, SOURCE_REQUIRED_FIELDS


@dataclass(frozen=True, slots=True)
class ReadIssue:
    path: str
    message: str


@dataclass(frozen=True, slots=True)
class ReadResult:
    snapshot: VaultIndexSnapshot
    issues: tuple[ReadIssue, ...] = ()

    def require_clean(self) -> VaultIndexSnapshot:
        if self.issues:
            messages = "; ".join(f"{issue.path}: {issue.message}" for issue in self.issues)
            raise VaultReadError(messages)
        return self.snapshot


class VaultReadError(ValueError):
    pass


def read_source_record(path: str | Path) -> SourceRecord:
    frontmatter, _ = parse_markdown(Path(path))
    require_frontmatter_fields(frontmatter, SOURCE_REQUIRED_FIELDS, Path(path).as_posix())
    return SourceRecord.from_frontmatter(frontmatter)


def read_evidence_record(path: str | Path) -> EvidenceRecord:
    frontmatter, _ = parse_markdown(Path(path))
    require_frontmatter_fields(frontmatter, EVIDENCE_REQUIRED_FIELDS, Path(path).as_posix())
    return EvidenceRecord.from_frontmatter(frontmatter)


def render_source_record(record: SourceRecord, body: str = "") -> str:
    return render_markdown(record.to_frontmatter(), body or f"# {record.id}\n")


def render_evidence_record(record: EvidenceRecord, body: str = "") -> str:
    return render_markdown(record.to_frontmatter(), body or f"# {record.id}\n")


def read_vault_index(path: str | Path) -> ReadResult:
    root = resolve_vault_path(path)
    issues: list[ReadIssue] = []
    sources = read_record_directory(root, "sources", read_source_record, issues, skip_names={"index.md"})
    evidence = read_record_directory(root, "evidence", read_evidence_record, issues)
    return ReadResult(VaultIndexSnapshot.from_records(sources, evidence), tuple(issues))


def read_record_directory(
    root: Path,
    directory: str,
    reader,
    issues: list[ReadIssue],
    *,
    skip_names: set[str] | None = None,
) -> tuple:
    records = []
    skip_names = skip_names or set()
    note_dir = root / directory
    if not note_dir.exists():
        issues.append(ReadIssue(directory, "required directory is missing"))
        return ()
    for path in sorted(note_dir.glob("*.md")):
        if path.name in skip_names:
            continue
        rel = path.relative_to(root).as_posix()
        try:
            records.append(reader(path))
        except (FrontmatterError, VaultReadError, OSError, ValueError) as exc:
            issues.append(ReadIssue(rel, str(exc)))
    return tuple(records)


def require_frontmatter_fields(frontmatter: dict, fields: Iterable[str], path: str) -> None:
    missing = [field for field in fields if field not in frontmatter]
    if missing:
        raise VaultReadError(f"missing required frontmatter fields: {', '.join(missing)}")
