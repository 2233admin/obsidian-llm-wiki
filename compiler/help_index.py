"""
help_index.py -- vault concept index for sub-second query_help lookup.

Zero dependencies, pure stdlib. Scans vault/*.md, extracts frontmatter
(title/aliases/summary/related/last_validated_at), writes a JSON index
to $VAULT_ROOT/.vault-mind/help_index.json.

CLI:
    python -m compiler.help_index build
    python -m compiler.help_index build --vault /path/to/vault
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

VAULT_ROOT = Path(os.environ.get("VAULT_ROOT", "E:/knowledge"))
INDEX_SUBPATH = ".vault-mind/help_index.json"


def _parse_list_field(value: str) -> list[str]:
    v = value.strip()
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1]
        items: list[str] = []
        for item in inner.split(","):
            item = item.strip().strip("'"	")
            if item:
                items.append(item)
        return items
    if v and not v.startswith("-"):
        return [v.strip("'"")]
    return []


def _parse_bullet_list(lines: list[str], start_idx: int) -> list[str]:
    items: list[str] = []
    for line in lines[start_idx:]:
        m = re.match(r"^\s+-\s+(.+)$", line)
        if m:
            items.append(m.group(1).strip().strip("'"	"))
        elif line.strip() and not line.startswith(" ") and not line.startswith("	"):
            break
    return items


def parse_frontmatter(text: str) -> tuple[dict[str, object], str]:
    """Return (frontmatter_dict, body_text)."""
    if not text.startswith("---
") and not text.startswith("---
"):
        return {}, text

    end = text.find("
---
", 4)
    if end < 0:
        end = text.find("
---
", 4)
    if end < 0:
        return {}, text

    fm_block = text[4:end]
    body = text[end + 5:]

    fm: dict[str, object] = {}
    lines = fm_block.split("
")
    i = 0
    while i < len(lines):
        line = lines[i]
        if " #" in line:
            line = line[: line.index(" #")]
        m = re.match(r"^(\w[\w_-]*):\s*(.*)", line)
        if m:
            key = m.group(1)
            raw_val = m.group(2).strip()
            if raw_val == "" or raw_val == "|" or raw_val == ">": 
                bullet = _parse_bullet_list(lines, i + 1)
                if bullet:
                    fm[key] = bullet
                else:
                    fm[key] = ""
            else:
                if raw_val.startswith("["):
                    fm[key] = _parse_list_field(raw_val)
                else:
                    fm[key] = raw_val.strip("'"")
        i += 1

    return fm, body


def _extract_first_paragraph(body: str, limit: int = 300) -> str:
    body = body.strip()
    lines = body.split("
")
    start = 0
    for idx, line in enumerate(lines):
        if not line.startswith("#"):
            start = idx
            break
    body = "
".join(lines[start:]).strip()
    end = body.find("

")
    para = body[:end] if end > 0 else body[:limit]
    return para[:limit].strip()


def _extract_wikilinks(body: str, limit: int = 10) -> list[str]:
    matches = re.findall(r"\[\[([^\]|#]+)", body)
    seen: set[str] = set()
    result: list[str] = []
    for m in matches:
        key = m.strip()
        if key and key not in seen:
            seen.add(key)
            result.append(key)
        if len(result) >= limit:
            break
    return result


def build_help_index(vault_root: Path | None = None) -> dict[str, object]:
    """Scan vault, build and write help_index.json. Returns the index dict."""
    root = vault_root or VAULT_ROOT
    index: dict[str, object] = {
        "concepts": {},
        "aliases": {},
    }
    concepts: dict[str, object] = index["concepts"]  # type: ignore[assignment]
    aliases: dict[str, str] = index["aliases"]  # type: ignore[assignment]

    for md in sorted(root.rglob("*.md")):
        if any(part.startswith(".") for part in md.relative_to(root).parts):
            continue

        try:
            text = md.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        fm, body = parse_frontmatter(text)

        raw_title = fm.get("title", "")
        title: str = str(raw_title).strip() if raw_title else md.stem
        key = title.lower()

        raw_summary = fm.get("summary", "")
        summary_str: str = str(raw_summary).strip() if raw_summary else ""
        if not summary_str:
            summary_str = _extract_first_paragraph(body)

        raw_related = fm.get("related", [])
        related: list[str]
        if isinstance(raw_related, list):
            related = [str(r) for r in raw_related]
        elif isinstance(raw_related, str) and raw_related:
            related = [raw_related]
        else:
            related = _extract_wikilinks(body)

        last_validated = fm.get("last_validated_at", None)

        rel_path = md.relative_to(root).as_posix()

        entry: dict[str, object] = {
            "title": title,
            "summary": summary_str[:300],
            "source_file": rel_path,
            "related": related,
        }
        if last_validated:
            entry["last_validated_at"] = str(last_validated)

        if key in concepts:
            print(
                f"[WARN] help_index: duplicate key {key!r} "
                f"from {rel_path!r} shadows {concepts[key]["source_file"]!r}",  # type: ignore[index]
                file=sys.stderr,
            )
        concepts[key] = entry

        raw_aliases = fm.get("aliases", [])
        alias_list: list[str]
        if isinstance(raw_aliases, list):
            alias_list = [str(a) for a in raw_aliases]
        elif isinstance(raw_aliases, str) and raw_aliases:
            alias_list = [raw_aliases]
        else:
            alias_list = []

        for alias in alias_list:
            alias_key = alias.lower()
            if alias_key in aliases and aliases[alias_key] != key:
                print(
                    f"[WARN] help_index: alias conflict {alias_key!r} "
                    f"already points to {aliases[alias_key]!r}, overwriting with {key!r}",
                    file=sys.stderr,
                )
            aliases[alias_key] = key

    index_path = root / INDEX_SUBPATH
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        f"[INFO] help_index: wrote {len(concepts)} concepts, "
        f"{len(aliases)} aliases -> {index_path}",
        file=sys.stderr,
    )
    return index


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Build vault help index")
    parser.add_argument("command", choices=["build"], help="Command to run")
    parser.add_argument(
        "--vault",
        type=Path,
        default=None,
        help="Vault root path (default: VAULT_ROOT env or E:/knowledge)",
    )
    args = parser.parse_args()

    if args.command == "build":
        vault = args.vault or Path(os.environ.get("VAULT_ROOT", "E:/knowledge"))
        idx = build_help_index(vault)
        concepts = idx.get("concepts", {})
        aliases = idx.get("aliases", {})
        print(
            f"Built: {len(concepts)} concepts, {len(aliases)} aliases"  # type: ignore[arg-type]
        )


if __name__ == "__main__":
    main()
