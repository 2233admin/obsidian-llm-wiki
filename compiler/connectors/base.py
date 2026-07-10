"""Shared connector protocol and markdown-writing helper.

A connector is any module exposing:

    fetch(output_dir: Path, **kwargs) -> list[Path]

`fetch` pulls records from one external source, writes each as a
frontmatter-tagged markdown file under `output_dir`, and returns the list
of paths it wrote. Connectors must never raise for "not configured" --
missing credentials are a logged message + empty-list return, not an
exception. Network/API failures should be caught and logged too, so one
bad record doesn't abort the whole run.

Frontmatter format (matches
examples/collab-vault/research-compiler/raw/team-memory-os.md):

    ---
    source-type: <slug>
    captured-at: <ISO-8601 timestamp>
    origin: <source URL or identifier>
    ---

    <body>
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol


class Connector(Protocol):
    """Structural protocol every connector module should satisfy."""

    def fetch(self, output_dir: Path, **kwargs) -> list[Path]:
        """Fetch records and write them as frontmatter markdown under output_dir.

        Returns the list of file paths written. Must not raise on missing
        credentials or recoverable fetch errors -- log and return partial
        (possibly empty) results instead.
        """
        ...


def utc_now_iso() -> str:
    """Current UTC time as an ISO-8601 timestamp, e.g. 2026-07-10T12:34:56Z."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_markdown_entry(
    output_dir: Path,
    filename: str,
    *,
    source_type: str,
    origin: str,
    body: str,
    captured_at: str | None = None,
) -> Path:
    """Write one frontmatter-tagged markdown file into output_dir and return its path.

    Creates output_dir (and parents) if it doesn't exist yet.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    captured = captured_at or utc_now_iso()
    frontmatter = (
        "---\n"
        f"source-type: {source_type}\n"
        f"captured-at: {captured}\n"
        f"origin: {origin}\n"
        "---\n"
    )
    content = f"{frontmatter}\n{body.rstrip()}\n"
    path = output_dir / filename
    path.write_text(content, encoding="utf-8")
    return path
