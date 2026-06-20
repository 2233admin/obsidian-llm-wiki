"""Domain self-discovery via INDEX.md files.

Each domain directory may contain an INDEX.md that declares the domain name
and optionally its entity types. This module scans a vault for all INDEX.md
files and builds the domain registry used by the compiler.

Also re-exports id_from_path from contract for convenience.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Domain:
    name: str          # e.g. "trading"
    path: Path         # directory path
    index_path: Path   # path to INDEX.md
    entity_types: list[str] = field(default_factory=list)
    description: str = ""


def discover_domains(vault_path: Path) -> list[Domain]:
    """Walk vault and collect domains from INDEX.md files.

    A domain is any directory containing an INDEX.md with kind: index
    in its frontmatter. Falls back to treating any top-level numbered
    directory as a domain if no INDEX.md is present.
    """
    domains: list[Domain] = []
    seen: set[str] = set()

    for root, dirs, files in os.walk(vault_path):
        skip = {".obsidian", "node_modules", ".git", ".trash", "venv"}
        dirs[:] = sorted(d for d in dirs if d not in skip and not d.startswith("."))

        if "INDEX.md" in files:
            index_path = Path(root) / "INDEX.md"
            fm = _parse_frontmatter(index_path.read_text("utf-8-sig", errors="replace"))
            dir_path = Path(root)
            name = _dir_to_domain(dir_path.name)
            if name and name not in seen:
                seen.add(name)
                entity_types = _parse_list(fm.get("entity_types", fm.get("entities", "")))
                domains.append(Domain(
                    name=name,
                    path=dir_path,
                    index_path=index_path,
                    entity_types=entity_types,
                    description=str(fm.get("description", "")),
                ))

    # Fallback: top-level numbered dirs without INDEX.md
    _system_skip = {"node_modules", "venv", ".git", ".obsidian", ".trash"}
    for d in sorted(vault_path.iterdir()):
        if not d.is_dir():
            continue
        if d.name in _system_skip:
            continue
        name = _dir_to_domain(d.name)
        if name and name not in seen:
            seen.add(name)
            domains.append(Domain(
                name=name,
                path=d,
                index_path=d / "INDEX.md",
            ))

    domains.sort(key=lambda x: x.name)
    return domains


def _dir_to_domain(dirname: str) -> str:
    """Convert a directory name to a domain slug.

    '05-Engineering' → 'engineering'
    'KB'             → 'kb'
    '.obsidian'      → '' (skip)
    """
    if dirname.startswith(".") or dirname.startswith("_"):
        return ""
    name = re.sub(r"^\d+-", "", dirname).lower()
    name = re.sub(r"[^a-z0-9]", "-", name).strip("-")
    return name or ""


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


def _parse_list(value: str | list) -> list[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if not value:
        return []
    # "[A, B, C]" or "A, B, C"
    s = str(value).strip().strip("[]")
    return [v.strip() for v in s.split(",") if v.strip()]
