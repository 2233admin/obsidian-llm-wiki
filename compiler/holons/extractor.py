"""Holon extractor — converts vault notes into Holon instances.

Pass 1 of the compiler pipeline (post-commit async).
Does NOT assign causal edges — that's concept_graph.py.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from pathlib import Path

from ..meta_ontology import resolve_entity_class
from ..ontology import DomainOntology
from ..rhizome.contract import id_from_path
from .holon import Holon, HolonSet, sha256_file

_WIKILINK_RE = re.compile(r"\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]")
_H1_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)


def extract_holon(path: Path, vault_root: Path, ontology: DomainOntology) -> Holon | None:
    """Extract a single Holon from a markdown file. Returns None on read error."""
    try:
        text = path.read_text("utf-8-sig", errors="replace")
    except OSError:
        return None

    fm, body = _split_frontmatter(text)
    rel = path.relative_to(vault_root)

    holon_id = str(fm.get("id", "")).strip() or id_from_path(rel)
    kind = str(fm.get("kind", "note")).strip()
    status = str(fm.get("status", "active")).strip()
    entity_type_raw = str(fm.get("entity_type", "")).strip() or None
    entity_type = resolve_entity_class(kind, entity_type_raw, ontology.entity_type_names)

    return Holon(
        id=holon_id,
        kind=kind,
        entity_type=entity_type,
        title=_extract_title(body, path),
        summary=str(fm.get("description", "")).strip() or _first_paragraph(body),
        content_hash=sha256_file(path),
        wikilinks=_extract_wikilinks(text),
        causal_edges=[],  # filled by concept_graph.py
        source_path=rel.as_posix(),
        compiled_at=datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        status=status,
        keywords=_parse_list(fm.get("keywords", "")),
    )


def extract_vault(vault_root: Path, ontology: DomainOntology) -> HolonSet:
    """Extract Holons from all .md files in the vault."""
    skip = {".obsidian", "node_modules", ".git", ".trash", "venv"}
    holons: list[Holon] = []

    for root, dirs, files in os.walk(vault_root):
        dirs[:] = sorted(d for d in dirs if d not in skip and not d.startswith("."))
        for f in sorted(files):
            if not f.endswith(".md"):
                continue
            holon = extract_holon(Path(root) / f, vault_root, ontology)
            if holon is not None:
                holons.append(holon)

    return HolonSet(holons=holons, vault_path=str(vault_root))


def _split_frontmatter(text: str) -> tuple[dict, str]:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    body = text[end + 4:].lstrip("\n")
    return _parse_fm(text[4:end]), body


def _parse_fm(fm_text: str) -> dict:
    fm: dict = {}
    for line in fm_text.split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        colon = line.find(":")
        if colon == -1:
            continue
        key = line[:colon].strip()
        val = line[colon + 1:].strip().strip('"').strip("'")
        fm[key] = val
    return fm


def _extract_title(body: str, path: Path) -> str:
    m = _H1_RE.search(body)
    return m.group(1).strip() if m else path.stem


def _first_paragraph(body: str) -> str:
    for line in body.split("\n"):
        s = line.strip()
        if s and not s.startswith("#") and not s.startswith("!") and not s.startswith("|"):
            return s[:200]
    return ""


def _extract_wikilinks(text: str) -> list[str]:
    return [
        m.group(1).split("#")[0].strip()
        for m in _WIKILINK_RE.finditer(text)
        if not m.group(1).strip().startswith("#")
    ]


def _parse_list(value: str | list) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    s = str(value).strip().strip("[]")
    return [v.strip() for v in s.split(",") if v.strip()] if s else []
