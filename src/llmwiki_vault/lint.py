from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .markdown import FrontmatterError, parse_markdown
from .safety import PathSafetyError, ensure_inside, resolve_vault_path, validate_relative_path

SOURCE_REQUIRED = [
    "id",
    "platform",
    "source_kind",
    "raw_url",
    "canonical_url",
    "provider",
    "pipeline",
    "status",
    "artifact_paths",
    "evidence_notes",
    "fetched_at",
    "limitations",
    "schema_version",
]
EVIDENCE_REQUIRED = [
    "id",
    "source_id",
    "provider",
    "artifact_paths",
    "captured_at",
    "generated_by",
    "limitations",
    "schema_version",
]
ALLOWED_STATUS = {"new", "supported", "partial", "blocked_auth", "unsupported", "stale", "conflict", "archived"}
SECRET_MARKERS = ["api_key", "apikey", "authorization:", "bearer ", "cookie:", "set-cookie:", "password", "secret", "token:"]


@dataclass
class Issue:
    level: str
    path: str
    message: str


@dataclass
class LintReport:
    errors: list[Issue] = field(default_factory=list)
    warnings: list[Issue] = field(default_factory=list)
    infos: list[Issue] = field(default_factory=list)

    def add(self, level: str, path: str, message: str) -> None:
        issue = Issue(level, path, message)
        if level == "error":
            self.errors.append(issue)
        elif level == "warning":
            self.warnings.append(issue)
        else:
            self.infos.append(issue)

    def exit_code(self) -> int:
        return 1 if self.errors else 0


def lint_vault(path: str | Path, *, release_check: bool = False) -> LintReport:
    root = resolve_vault_path(path)
    report = LintReport()
    if not root.exists() or not root.is_dir():
        report.add("error", str(root), "vault path does not exist or is not a directory")
        return report
    sources = read_notes(root, "sources", report, skip_names={"index.md"})
    evidence = read_notes(root, "evidence", report)
    validate_sources(root, sources, evidence, report)
    validate_evidence(root, sources, evidence, report)
    validate_hot_cache(root, report, release_check=release_check)
    validate_generated_views(root, report)
    scan_for_secret_markers(root, report)
    return report


def read_notes(root: Path, directory: str, report: LintReport, *, skip_names: set[str] | None = None) -> dict[str, tuple[Path, dict[str, Any]]]:
    skip_names = skip_names or set()
    notes: dict[str, tuple[Path, dict[str, Any]]] = {}
    note_dir = root / directory
    if not note_dir.exists():
        report.add("error", directory, "required directory is missing")
        return notes
    for path in sorted(note_dir.glob("*.md")):
        if path.name in skip_names:
            continue
        rel = path.relative_to(root).as_posix()
        try:
            frontmatter, _ = parse_markdown(path)
        except FrontmatterError as exc:
            report.add("error", rel, str(exc))
            continue
        note_id = str(frontmatter.get("id", ""))
        if not note_id:
            report.add("error", rel, "frontmatter id is required")
            continue
        if note_id in notes:
            report.add("error", rel, f"duplicate id: {note_id}")
        notes[note_id] = (path, frontmatter)
    return notes


def validate_sources(root: Path, sources: dict[str, tuple[Path, dict[str, Any]]], evidence: dict[str, tuple[Path, dict[str, Any]]], report: LintReport) -> None:
    canonical_urls: dict[str, str] = {}
    for source_id, (path, fm) in sources.items():
        rel = path.relative_to(root).as_posix()
        require_fields(fm, SOURCE_REQUIRED, rel, report)
        if fm.get("schema_version") != 1:
            report.add("error", rel, "schema_version must be 1")
        status = str(fm.get("status", ""))
        if status not in ALLOWED_STATUS:
            report.add("error", rel, f"unsupported status: {status}")
        if status == "unsupported":
            report.add("warning", rel, "source is marked unsupported")
        if status == "blocked_auth" and not fm.get("limitations"):
            report.add("error", rel, "blocked_auth sources must record limitations")
        canonical_url = str(fm.get("canonical_url", ""))
        if canonical_url:
            other = canonical_urls.get(canonical_url)
            if other and status != "conflict":
                report.add("error", rel, f"duplicate canonical_url with {other}; mark conflict explicitly")
            canonical_urls[canonical_url] = source_id
        elif status in {"supported", "partial"}:
            report.add("error", rel, "canonical_url is required for supported or partial sources")
        validate_path_list(root, rel, fm.get("artifact_paths", []), report, allow_missing_reason=fm.get("missing_artifact_reason"))
        evidence_notes = normalize_list(fm.get("evidence_notes", []))
        for evidence_ref in evidence_notes:
            evidence_id = Path(str(evidence_ref)).stem if str(evidence_ref).endswith(".md") else str(evidence_ref)
            if evidence_id not in evidence:
                report.add("error", rel, f"evidence note is missing: {evidence_ref}")


def validate_evidence(root: Path, sources: dict[str, tuple[Path, dict[str, Any]]], evidence: dict[str, tuple[Path, dict[str, Any]]], report: LintReport) -> None:
    for evidence_id, (path, fm) in evidence.items():
        rel = path.relative_to(root).as_posix()
        require_fields(fm, EVIDENCE_REQUIRED, rel, report)
        if fm.get("schema_version") != 1:
            report.add("error", rel, "schema_version must be 1")
        source_id = str(fm.get("source_id", ""))
        if source_id not in sources:
            report.add("error", rel, f"source note is missing: {source_id}")
        validate_path_list(root, rel, fm.get("artifact_paths", []), report, allow_missing_reason=fm.get("missing_artifact_reason"))


def require_fields(fm: dict[str, Any], fields: list[str], rel: str, report: LintReport) -> None:
    for field in fields:
        if field not in fm:
            report.add("error", rel, f"missing required field: {field}")


def validate_path_list(root: Path, rel: str, value: Any, report: LintReport, *, allow_missing_reason: Any = None) -> None:
    paths = normalize_list(value)
    if not paths:
        return
    for item in paths:
        try:
            target = validate_relative_path(root, str(item), must_exist=False)
            ensure_inside(root, target)
        except PathSafetyError as exc:
            report.add("error", rel, str(exc))
            continue
        if not target.exists() and not allow_missing_reason:
            report.add("error", rel, f"artifact path is missing without reason: {item}")


def validate_hot_cache(root: Path, report: LintReport, *, release_check: bool) -> None:
    path = root / "wiki" / "hot.md"
    rel = "wiki/hot.md"
    if not path.exists():
        report.add("warning" if not release_check else "error", rel, "hot cache is missing")
        return
    try:
        fm, _ = parse_markdown(path)
    except FrontmatterError as exc:
        report.add("error", rel, str(exc))
        return
    for field in ["generated_at", "source_window", "max_items", "stale_after", "source_links", "schema_version"]:
        if field not in fm:
            report.add("error", rel, f"missing required field: {field}")
    stale_after = parse_duration(str(fm.get("stale_after", "24h")))
    try:
        generated_at = datetime.fromisoformat(str(fm.get("generated_at", "")).replace("Z", "+00:00"))
    except ValueError:
        report.add("error", rel, "generated_at must be ISO datetime")
        return
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - generated_at > stale_after:
        report.add("error" if release_check else "warning", rel, "hot cache is stale")
    for link in normalize_list(fm.get("source_links", [])):
        try:
            link_path = Path(str(link))
            if link_path.is_absolute():
                raise PathSafetyError(f"absolute paths are not allowed: {link}")
            target = ensure_inside(root, path.parent / link_path, must_exist=False)
        except PathSafetyError as exc:
            report.add("error", rel, f"bad hot cache source link: {link} ({exc})")
            continue
        if not target.exists():
            report.add("error", rel, f"hot cache source link is missing: {link}")


def validate_generated_views(root: Path, report: LintReport) -> None:
    for rel in ["views/dashboard.md", "views/source-map.md"]:
        if not (root / rel).exists():
            report.add("warning", rel, "generated Markdown view is missing")
    for rel in ["views/dashboard.base", "views/source-map.canvas"]:
        if not (root / rel).exists():
            report.add("info", rel, "optional Obsidian view is missing")


def scan_for_secret_markers(root: Path, report: LintReport) -> None:
    for directory in ["sources", "evidence", "wiki", "views"]:
        for path in (root / directory).glob("*.md"):
            text = path.read_text(encoding="utf-8", errors="ignore").lower()
            if any(marker in text for marker in SECRET_MARKERS):
                report.add("error", path.relative_to(root).as_posix(), "possible secret marker found")


def parse_duration(value: str) -> timedelta:
    if value.endswith("h"):
        return timedelta(hours=int(value[:-1]))
    if value.endswith("m"):
        return timedelta(minutes=int(value[:-1]))
    if value.endswith("d"):
        return timedelta(days=int(value[:-1]))
    return timedelta(hours=24)


def normalize_list(value: Any) -> list[Any]:
    if value is None or value == "":
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value == "[]":
        return []
    return [value]

