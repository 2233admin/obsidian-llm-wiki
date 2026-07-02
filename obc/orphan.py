"""
Orphan Detection - Find notes that are not linked by any other note.

An orphan is a note that exists but has no incoming links from other notes.
Some files are excluded by default (logs, templates, index files).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from obc.extract import extract_vault_links


@dataclass
class Orphan:
    """A note that has no incoming links."""
    path: Path
    last_modified: float  # Unix timestamp
    links_to: int  # Number of outgoing links from this note


class OrphanReport:
    """Report of orphan notes in a vault."""

    def __init__(self, vault: str, orphans: list[Orphan]):
        self.vault = vault
        self.orphans = orphans

    def to_dict(self) -> dict:
        return {
            "vault": self.vault,
            "total": len(self.orphans),
            "orphans": [
                {
                    "path": str(o.path),
                    "last_modified": datetime.fromtimestamp(o.last_modified).isoformat(),
                    "links_to": o.links_to,
                }
                for o in self.orphans
            ],
        }


# Files that are never orphans (they don't need links)
ALWAYS_LINKED = {
    "Home.md",
    "home.md",
    "index.md",
    "Index.md",
}


def find_orphans(
    vault: Path,
    ignore_patterns: list[str] | None = None,
) -> list[Orphan]:
    """
    Find orphan notes in a vault.

    An orphan is a note that exists but has no incoming links.
    Some files are never orphans (Home.md, index.md).

    Args:
        vault: Path to vault root
        ignore_patterns: Glob patterns to ignore (e.g., ["Logs/**", "**/*.log"])

    Returns:
        List of Orphan objects
    """
    if ignore_patterns is None:
        ignore_patterns = [
            "Logs/**",
            "**/Logs/**",
            "**/.trash/**",
            "**/.scratch/**",
        ]

    # Extract all links
    links = extract_vault_links(vault)

    # Build set of linked targets (by stem, case-insensitive)
    linked_stems: set[str] = set()
    for link in links:
        if link.target_path_part:
            # Get stem without extension
            stem = Path(link.target_path_part).stem.lower()
            linked_stems.add(stem)

    # Add always-linked files to the set
    linked_stems.update(s.lower() for s in ALWAYS_LINKED)

    # Find all markdown files
    orphans: list[Orphan] = []
    for md_file in vault.rglob("*.md"):
        if _should_ignore(md_file, vault, ignore_patterns):
            continue

        rel_path = md_file.relative_to(vault)
        stem = md_file.stem.lower()

        # Skip always-linked files
        if md_file.name in ALWAYS_LINKED or stem in {s.lower() for s in ALWAYS_LINKED}:
            continue

        # Check if this file is linked
        if stem not in linked_stems:
            # Also check by full name (case-insensitive)
            if not any(
                linked_stem == stem
                for linked_stem in linked_stems
            ):
                mtime = md_file.stat().st_mtime

                # Count outgoing links
                links_from_this = sum(
                    1 for link in links
                    if str(link.source_file) == str(md_file)
                )

                orphans.append(Orphan(
                    path=rel_path,
                    last_modified=mtime,
                    links_to=links_from_this,
                ))

    # Sort by last modified (oldest first)
    orphans.sort(key=lambda o: o.last_modified)

    return orphans


def _should_ignore(file_path: Path, vault_root: Path, patterns: list[str]) -> bool:
    """Check if file matches any ignore pattern."""
    import fnmatch

    rel_path = file_path.relative_to(vault_root)

    for pattern in patterns:
        if fnmatch.fnmatch(str(rel_path), pattern):
            return True
        for part in rel_path.parts:
            if fnmatch.fnmatch(part, pattern.rstrip("/").lstrip("*")):
                return True

    return False


def report(vault: Path, **kwargs) -> OrphanReport:
    """Generate orphan report for a vault."""
    orphans = find_orphans(vault, **kwargs)
    return OrphanReport(vault=str(vault), orphans=orphans)
