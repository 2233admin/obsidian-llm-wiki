"""Text chunker -- splits markdown files into overlapping chunks by heading/paragraph."""

from __future__ import annotations

import re
from pathlib import Path

from models import Chunk  # noqa: E402

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$")
_PARAGRAPH_RE = re.compile(r"\n{2,}")


def _split_by_paragraphs(text: str, chunk_size: int, overlap: int) -> list[str]:
    """Split text into chunks of at most chunk_size chars with overlap."""
    paragraphs = [p.strip() for p in _PARAGRAPH_RE.split(text) if p.strip()]
    if not paragraphs:
        return []

    chunks: list[str] = []
    current_parts: list[str] = []
    current_len = 0

    for para in paragraphs:
        para_len = len(para)
        if current_len + para_len + 1 > chunk_size and current_parts:
            joined = "\n\n".join(current_parts)
            chunks.append(joined)
            # keep tail for overlap
            tail = joined[-overlap:] if overlap > 0 and len(joined) > overlap else joined
            current_parts = [tail] if overlap > 0 else []
            current_len = len(tail) if overlap > 0 else 0
        current_parts.append(para)
        current_len += para_len + 1

    if current_parts:
        chunks.append("\n\n".join(current_parts))

    return chunks if chunks else [text[:chunk_size]]


def chunk_file(
    path: Path,
    source: str,
    chunk_size: int = 1000,
    chunk_overlap: int = 200,
) -> list[Chunk]:
    """Split a markdown file into Chunk objects.

    Strategy:
    1. Split by headings (## / ###) -- each section becomes a candidate block.
    2. If a block exceeds chunk_size, further split by paragraphs with overlap.
    """
    text = path.read_text("utf-8-sig", errors="replace")
    text_stripped = text.strip()
    lines = text.splitlines()

    # --- phase 1: segment by headings ---
    sections: list[tuple[str | None, int, list[str]]] = []
    current_heading: str | None = None
    current_start = 0
    current_lines: list[str] = []

    for i, line in enumerate(lines):
        m = _HEADING_RE.match(line)
        if m and len(m.group(1)) <= 3:  # h1/h2/h3 only
            if current_lines:
                sections.append((current_heading, current_start, current_lines))
            current_heading = m.group(2).strip()
            current_start = i + 1
            current_lines = []
        else:
            current_lines.append(line)

    if current_lines:
        sections.append((current_heading, current_start, current_lines))

    # --- phase 2: chunk each section ---
    result: list[Chunk] = []
    for heading, start_line, sec_lines in sections:
        block = "\n".join(sec_lines).strip()
        if not block:
            continue
        if len(block) <= chunk_size:
            result.append(Chunk(
                content=block,
                source=source,
                heading=heading,
                start_line=start_line,
            ))
        else:
            sub_chunks = _split_by_paragraphs(block, chunk_size, chunk_overlap)
            for sub in sub_chunks:
                stripped = sub.strip()
                if stripped:
                    result.append(Chunk(
                        content=stripped,
                        source=source,
                        heading=heading,
                        start_line=start_line,
                    ))

    # fallback: entire file as one chunk if no sections found
    if not result and text_stripped:
        result.append(Chunk(
            content=text_stripped[:chunk_size],
            source=source,
            heading=None,
            start_line=0,
        ))

    return result
