from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Domain:
    name: str
    path: Path
    index_path: Path
    entity_types: list[str] = field(default_factory=list)
    description: str = ""


def discover_domains(vault_path: Path) -> list[Domain]:
    domains: list[Domain] = []
    seen: set[str] = set()
    skip = {".obsidian", "node_modules", ".git", ".trash", "venv"}

    for root, dirs, files in os.walk(vault_path):
        dirs[:] = sorted(d for d in dirs if d not in skip and not d.startswith("."))
        if "INDEX.md" not in files:
            continue

        index_path = Path(root) / "INDEX.md"
        dir_path = index_path.parent
        name = _dir_to_domain(dir_path.name)
        if not name or name in seen:
            continue

        fm = _parse_frontmatter(index_path.read_text("utf-8-sig", errors="replace"))
        seen.add(name)
        domains.append(Domain(
            name=name,
            path=dir_path,
            index_path=index_path,
            entity_types=_parse_list(fm.get("entity_types", fm.get("entities", []))),
            description=str(fm.get("description", "")),
        ))

    if vault_path.exists():
        for entry in sorted(vault_path.iterdir(), key=lambda item: item.name):
            if not entry.is_dir() or entry.name in skip:
                continue
            name = _dir_to_domain(entry.name)
            if name and name not in seen:
                seen.add(name)
                domains.append(Domain(name=name, path=entry, index_path=entry / "INDEX.md"))

    domains.sort(key=lambda domain: domain.name)
    return domains


def _dir_to_domain(dirname: str) -> str:
    if dirname.startswith(".") or dirname.startswith("_"):
        return ""
    without_prefix = re.sub(r"^\d+-", "", dirname)
    return re.sub(r"[^a-z0-9]+", "-", without_prefix.lower()).strip("-")


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
    raw = str(value).strip().strip("[]")
    return [item.strip().strip('"').strip("'") for item in raw.split(",") if item.strip()]
