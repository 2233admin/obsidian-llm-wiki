from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

from .markdown import parse_markdown, render_markdown
from .safety import ensure_inside, resolve_vault_path

SCHEMA_VERSION = 1
GENERATED_MARKER = "<!-- generated: llmwiki-vault; edit canonical sources/evidence instead -->"


@dataclass
class WriteReport:
    created: list[str] = field(default_factory=list)
    updated: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    dry_run: bool = False

    def exit_code(self) -> int:
        return 1 if self.errors else 0


DIRECTORIES = [
    ".raw/web",
    ".raw/media",
    ".raw/pdf",
    ".raw/repos",
    ".raw/local",
    "sources",
    "evidence",
    "wiki",
    "entities",
    "concepts",
    "projects",
    "questions",
    "meta",
    "views",
    "templates",
]


TEMPLATE_FILES = {
    "templates/source.md": render_markdown(
        {
            "id": "source-id",
            "platform": "web",
            "source_kind": "document",
            "raw_url": "",
            "canonical_url": "",
            "provider": "",
            "pipeline": "",
            "status": "new",
            "artifact_paths": [],
            "evidence_notes": [],
            "fetched_at": "",
            "limitations": [],
            "schema_version": SCHEMA_VERSION,
        },
        "# Source Template\n\nCanonical source notes live in `sources/<source-id>.md`.\n",
    ),
    "templates/evidence-note.md": render_markdown(
        {
            "id": "evidence-id",
            "source_id": "source-id",
            "provider": "",
            "artifact_paths": [],
            "captured_at": "",
            "generated_by": "",
            "limitations": [],
            "missing_artifact_reason": "",
            "schema_version": SCHEMA_VERSION,
        },
        "# Evidence Template\n\nEvidence notes live in `evidence/<evidence-id>.md`.\n",
    ),
    "templates/project.md": render_markdown(
        {"id": "project-id", "schema_version": SCHEMA_VERSION},
        "# Project Template\n",
    ),
    "templates/question.md": render_markdown(
        {"id": "question-id", "status": "open", "schema_version": SCHEMA_VERSION},
        "# Question Template\n",
    ),
    "wiki/index.md": GENERATED_MARKER + "\n\n# LLMwiki Vault\n\n- [Hot Cache](hot.md)\n- [Source Index](../sources/index.md)\n- [Dashboard](../views/dashboard.md)\n- [Source Map](../views/source-map.md)\n",
    "wiki/overview.md": GENERATED_MARKER + "\n\n# Overview\n\nCurated overview notes can be added here.\n",
    "wiki/log.md": "# Activity Log\n\n",
    "views/docket.md": GENERATED_MARKER + "\n\n# Docket\n\nNo projects or questions recorded yet.\n",
}


def init_vault(path: str | Path, *, dry_run: bool = False) -> WriteReport:
    root = resolve_vault_path(path)
    report = WriteReport(dry_run=dry_run)
    if root.exists() and not root.is_dir():
        report.errors.append(f"vault path is not a directory: {root}")
        return report
    if not dry_run:
        root.mkdir(parents=True, exist_ok=True)
    for directory in DIRECTORIES:
        target = ensure_inside(root, directory)
        rel = target.relative_to(root).as_posix()
        if target.exists():
            report.skipped.append(rel)
        else:
            report.created.append(rel + "/")
            if not dry_run:
                target.mkdir(parents=True, exist_ok=True)
    for rel_path, content in TEMPLATE_FILES.items():
        write_file(root, rel_path, content, report, dry_run=dry_run, overwrite_generated=False)
    render_indexes_and_views(root, report, dry_run=dry_run)
    render_hot_cache(root, report, dry_run=dry_run)
    return report


def write_file(
    root: Path,
    rel_path: str,
    content: str,
    report: WriteReport,
    *,
    dry_run: bool,
    overwrite_generated: bool,
) -> None:
    target = ensure_inside(root, rel_path)
    if target.exists():
        existing = target.read_text(encoding="utf-8")
        if existing == content:
            report.skipped.append(rel_path)
            return
        if overwrite_generated and (existing.startswith(GENERATED_MARKER) or GENERATED_MARKER in existing[:200]):
            report.updated.append(rel_path)
            if not dry_run:
                atomic_write(target, content)
            return
        report.skipped.append(rel_path)
        return
    report.created.append(rel_path)
    if not dry_run:
        target.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(target, content)


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False, newline="\n") as handle:
        handle.write(content)
        temp_name = handle.name
    Path(temp_name).replace(path)


def load_source_notes(root: Path) -> list[tuple[Path, dict]]:
    notes = []
    for path in sorted((root / "sources").glob("*.md")):
        if path.name == "index.md":
            continue
        try:
            frontmatter, _ = parse_markdown(path)
        except Exception:
            continue
        notes.append((path, frontmatter))
    return notes


def load_evidence_notes(root: Path) -> list[tuple[Path, dict]]:
    notes = []
    for path in sorted((root / "evidence").glob("*.md")):
        try:
            frontmatter, _ = parse_markdown(path)
        except Exception:
            continue
        notes.append((path, frontmatter))
    return notes


def render_indexes_and_views(root: Path, report: WriteReport, *, dry_run: bool = False) -> None:
    sources = load_source_notes(root) if root.exists() else []
    evidence = load_evidence_notes(root) if root.exists() else []
    write_file(root, "sources/index.md", render_source_index(sources), report, dry_run=dry_run, overwrite_generated=True)
    write_file(root, "source-registry.md", render_source_index(sources), report, dry_run=dry_run, overwrite_generated=True)
    write_file(root, "views/dashboard.md", render_dashboard(sources, evidence), report, dry_run=dry_run, overwrite_generated=True)
    write_file(root, "views/source-map.md", render_source_map(sources, evidence), report, dry_run=dry_run, overwrite_generated=True)


def render_hot_cache(root: Path, report: WriteReport, *, dry_run: bool = False, max_items: int = 20, stale_after: str = "24h") -> None:
    sources = load_source_notes(root)[:max_items] if root.exists() else []
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    source_links = [f"../sources/{path.name}" for path, _ in sources]
    frontmatter = {
        "generated_at": generated_at,
        "source_window": "recent",
        "max_items": max_items,
        "stale_after": stale_after,
        "source_links": source_links,
        "schema_version": SCHEMA_VERSION,
    }
    rows = "\n".join(f"- [[../sources/{path.name}|{fm.get('id', path.stem)}]] ({fm.get('status', 'unknown')})" for path, fm in sources)
    body = GENERATED_MARKER + "\n\n# Hot Cache\n\n" + (rows or "No sources recorded yet.") + "\n"
    write_file(root, "wiki/hot.md", render_markdown(frontmatter, body), report, dry_run=dry_run, overwrite_generated=True)


def render_source_index(sources: list[tuple[Path, dict]]) -> str:
    lines = [GENERATED_MARKER, "", "# Source Index", ""]
    if not sources:
        lines.append("No sources recorded yet.")
    else:
        lines.append("| Source | Status | Canonical URL |")
        lines.append("|---|---|---|")
        for path, fm in sources:
            source_id = fm.get("id", path.stem)
            lines.append(f"| [[{path.name}|{source_id}]] | {fm.get('status', '')} | {fm.get('canonical_url', '')} |")
    return "\n".join(lines).rstrip() + "\n"


def render_dashboard(sources: list[tuple[Path, dict]], evidence: list[tuple[Path, dict]]) -> str:
    by_status: dict[str, int] = {}
    for _, fm in sources:
        by_status[str(fm.get("status", "unknown"))] = by_status.get(str(fm.get("status", "unknown")), 0) + 1
    lines = [GENERATED_MARKER, "", "# Dashboard", "", f"- Sources: {len(sources)}", f"- Evidence notes: {len(evidence)}"]
    for status, count in sorted(by_status.items()):
        lines.append(f"- {status}: {count}")
    return "\n".join(lines).rstrip() + "\n"


def render_source_map(sources: list[tuple[Path, dict]], evidence: list[tuple[Path, dict]]) -> str:
    evidence_by_source: dict[str, list[str]] = {}
    for path, fm in evidence:
        evidence_by_source.setdefault(str(fm.get("source_id", "")), []).append(f"[[../evidence/{path.name}|{fm.get('id', path.stem)}]]")
    lines = [GENERATED_MARKER, "", "# Source Map", "", "| Source | Evidence | Artifacts |", "|---|---|---|"]
    for path, fm in sources:
        source_id = str(fm.get("id", path.stem))
        artifact_paths = fm.get("artifact_paths", [])
        if not isinstance(artifact_paths, list):
            artifact_paths = [artifact_paths]
        lines.append(
            f"| [[../sources/{path.name}|{source_id}]] | {', '.join(evidence_by_source.get(source_id, []))} | {', '.join(str(item) for item in artifact_paths)} |"
        )
    if not sources:
        lines.append("| No sources |  |  |")
    return "\n".join(lines).rstrip() + "\n"

