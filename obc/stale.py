"""
Stale Note Detection - Find notes that haven't been updated in a while.

A stale note is one whose last modification date is older than the threshold.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from collections import Counter

from obc.extract import extract_vault_links


@dataclass
class StaleNote:
    """A note that hasn't been updated recently."""
    path: Path
    last_modified: float  # Unix timestamp
    age_days: float
    links_to: int  # Number of outgoing links from this note

    def to_dict(self) -> dict:
        return {
            "path": str(self.path),
            "last_modified": datetime.fromtimestamp(self.last_modified).isoformat(),
            "age_days": round(self.age_days, 1),
            "links_to": self.links_to,
        }


class StaleReport:
    """Report of stale notes in a vault."""

    def __init__(self, vault: str, notes: list[StaleNote]):
        self.vault = vault
        self.notes = notes
        self.folder_stats = self._compute_folder_stats()

    def _compute_folder_stats(self) -> dict:
        """Compute statistics by folder."""
        stats = Counter()
        for note in self.notes:
            if len(note.path.parts) > 1:
                folder = str(note.path.parts[0])
                stats[folder] += 1
        return dict(stats)

    def to_dict(self) -> dict:
        return {
            "vault": self.vault,
            "total": len(self.notes),
            "folder_stats": self.folder_stats,
            "notes": [n.to_dict() for n in self.notes],
        }


# Folders that are ignored by default (logs, archives, etc.)
IGNORED_FOLDERS = {
    "Logs",
    "logs",
    "Archives",
    "archives",
    "Archive",
    "archive",
    "09-Archive",
}


def find_stale_notes(
    vault: Path,
    min_age_days: int = 30,
    ignore_folders: set[str] | None = None,
) -> list[StaleNote]:
    """
    Find notes that haven't been updated in min_age_days.

    Args:
        vault: Path to vault root
        min_age_days: Minimum age in days to consider stale
        ignore_folders: Folder names to ignore

    Returns:
        List of StaleNote objects sorted by age (oldest first)
    """
    if ignore_folders is None:
        ignore_folders = IGNORED_FOLDERS

    now = datetime.now().timestamp()
    threshold_seconds = min_age_days * 86400

    # Extract all links to count outgoing links per file
    links = extract_vault_links(vault)
    link_counts: dict[str, int] = {}
    for link in links:
        src = str(link.source_file)
        link_counts[src] = link_counts.get(src, 0) + 1

    stale_notes: list[StaleNote] = []

    for md_file in vault.rglob("*.md"):
        # Skip ignored folders
        rel_path = md_file.relative_to(vault)
        if any(part in ignore_folders for part in rel_path.parts):
            continue

        # Skip hidden files/directories
        if any(part.startswith('.') for part in rel_path.parts):
            continue

        # Check age
        mtime = md_file.stat().st_mtime
        age = now - mtime

        if age >= threshold_seconds:
            age_days = age / 86400
            links_from = link_counts.get(str(md_file), 0)

            stale_notes.append(StaleNote(
                path=rel_path,
                last_modified=mtime,
                age_days=age_days,
                links_to=links_from,
            ))

    # Sort by age (oldest first)
    stale_notes.sort(key=lambda n: n.age_days, reverse=True)

    return stale_notes


def report(vault: Path, **kwargs) -> StaleReport:
    """Generate stale note report for a vault."""
    notes = find_stale_notes(vault, **kwargs)
    return StaleReport(vault=str(vault), notes=notes)
