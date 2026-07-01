"""
Link Extraction - PR1

Extract wikilinks and markdown links from Obsidian vault files.
Skips fenced code blocks and inline code.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Iterator


class LinkKind(Enum):
    """Link types supported by OBC."""
    WIKILINK = "wikilink"
    EMBED = "embed"
    MARKDOWN = "markdown"
    HTML = "html"


@dataclass
class LinkRef:
    """
    A reference to another note or resource.

    Preserves original byte span for safe patching.
    """
    id: str
    source_file: Path
    kind: LinkKind
    raw_text: str

    # Position in source
    byte_start: int
    byte_end: int
    line: int
    column: int

    # Parsed components
    target_raw: str
    target_path_part: str | None = None
    fragment: str | None = None
    alias: str | None = None

    # Context flags
    is_embed: bool = False
    in_code_block: bool = False
    in_inline_code: bool = False
    in_frontmatter: bool = False

    def to_dict(self) -> dict:
        """Convert to dict for JSON serialization."""
        return {
            "id": self.id,
            "source_file": str(self.source_file),
            "kind": self.kind.value,
            "raw_text": self.raw_text,
            "byte_start": self.byte_start,
            "byte_end": self.byte_end,
            "line": self.line,
            "column": self.column,
            "target_raw": self.target_raw,
            "target_path_part": self.target_path_part,
            "fragment": self.fragment,
            "alias": self.alias,
            "is_embed": self.is_embed,
        }


# Regex patterns
WIKILINK_PATTERN = re.compile(
    r'\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]'
)
EMBED_PATTERN = re.compile(
    r'!\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]'
)
MARKDOWN_LINK_PATTERN = re.compile(
    r'\[([^\]]+?)\]\(([^)]+?)\)'
)


def extract_links(
    content: str,
    source_file: Path,
    link_counter: Iterator[int],
) -> list[LinkRef]:
    """
    Extract all links from markdown content.

    Skips:
    - Links inside fenced code blocks
    - Links inside inline code
    - Links inside frontmatter

    Args:
        content: The markdown content to parse
        source_file: The source file path (for LinkRef)
        link_counter: Iterator yielding unique link IDs

    Returns:
        List of LinkRef objects
    """
    links: list[LinkRef] = []

    # Find code blocks and mark their positions
    code_block_ranges = _find_code_blocks(content)
    inline_code_ranges = _find_inline_codes(content)

    # Find frontmatter
    in_frontmatter, frontmatter_end = _find_frontmatter(content)

    # Process line by line to get line/column info
    lines = content.split('\n')
    current_pos = 0

    for line_num, line in enumerate(lines, start=1):
        line_start = current_pos

        # Check if this line is in frontmatter
        if in_frontmatter and current_pos < frontmatter_end:
            is_in_frontmatter = True
        else:
            is_in_frontmatter = False

        # Check if this line is a code block delimiter
        stripped = line.strip()
        is_code_start = stripped.startswith('```') or stripped.startswith('~~~')
        is_code_end = stripped.startswith('```') or stripped.startswith('~~~')

        # Track code block state
        in_code_block = _is_in_range(line_start, line_start + len(line), code_block_ranges)
        in_inline = _is_in_range(line_start, line_start + len(line), inline_code_ranges)

        # Extract wikilinks (not embeds)
        for match in WIKILINK_PATTERN.finditer(line):
            link = _parse_wikilink(
                match, source_file, line_num, link_counter,
                in_code=in_code_block, in_inline=in_inline,
                in_frontmatter=is_in_frontmatter
            )
            if link:
                links.append(link)

        # Extract embeds
        for match in EMBED_PATTERN.finditer(line):
            link = _parse_embed(
                match, source_file, line_num, link_counter,
                in_code=in_code_block, in_inline=in_inline,
                in_frontmatter=is_in_frontmatter
            )
            if link:
                links.append(link)

        # Extract markdown links
        for match in MARKDOWN_LINK_PATTERN.finditer(line):
            # Skip markdown links inside wikilink aliases
            if _is_inside_wikilink_alias(line, match.start()):
                continue

            link = _parse_markdown_link(
                match, source_file, line_num, link_counter,
                in_code=in_code_block, in_inline=in_inline,
                in_frontmatter=is_in_frontmatter
            )
            if link:
                links.append(link)

        current_pos += len(line) + 1  # +1 for newline

    return links


def _find_code_blocks(content: str) -> list[tuple[int, int]]:
    """Find all fenced code block ranges (start, end) positions."""
    ranges: list[tuple[int, int]] = []

    # Match triple backticks or tildes
    pattern = re.compile(r'(```|~~~)\s*(\S*)\n(.*?)(\1)', re.DOTALL)

    for match in pattern.finditer(content):
        ranges.append((match.start(), match.end()))

    return ranges


def _find_inline_codes(content: str) -> list[tuple[int, int]]:
    """Find all inline code ranges (start, end) positions."""
    ranges: list[tuple[int, int]] = []

    # Match single backticks (not double/triple)
    pattern = re.compile(r'(?<!`)`([^`]+)`(?!`)')

    for match in pattern.finditer(content):
        ranges.append((match.start(), match.end()))

    return ranges


def _find_frontmatter(content: str) -> tuple[bool, int]:
    """Check if content starts with frontmatter and return end position."""
    if content.startswith('---'):
        # Find closing ---
        end = content.find('\n---', 3)
        if end != -1:
            return True, end + 4
    return False, 0


def _is_in_range(pos: int, end_pos: int, ranges: list[tuple[int, int]]) -> bool:
    """Check if a position range overlaps with any range."""
    for start, end in ranges:
        if pos < end and end_pos > start:
            return True
    return False


def _is_inside_wikilink_alias(line: str, pos: int) -> bool:
    """Check if position is inside a wikilink alias (after |)."""
    # Find wikilinks in this line
    for match in WIKILINK_PATTERN.finditer(line):
        full_match = match.group(0)
        # If our position is after the |, it's inside alias
        if '|' in full_match:
            alias_start = match.start() + full_match.index('|')
            if pos > alias_start:
                return True
    return False


def _parse_wikilink(
    match: re.Match,
    source_file: Path,
    line_num: int,
    link_counter: Iterator[int],
    in_code: bool = False,
    in_inline: bool = False,
    in_frontmatter: bool = False,
) -> LinkRef | None:
    """Parse a wikilink match into a LinkRef."""
    target_raw = match.group(1)
    alias = match.group(2)

    # Skip external links
    if target_raw.startswith(('http://', 'https://', 'mailto:', 'obsidian://')):
        return None

    # Parse target for path/fragment
    target_path_part, fragment = _parse_fragment(target_raw)

    return LinkRef(
        id=f"link_{next(link_counter)}",
        source_file=source_file,
        kind=LinkKind.WIKILINK,
        raw_text=match.group(0),
        byte_start=match.start(),
        byte_end=match.end(),
        line=line_num,
        column=match.start() + 1,  # 1-indexed
        target_raw=target_raw,
        target_path_part=target_path_part,
        fragment=fragment,
        alias=alias,
        is_embed=False,
        in_code_block=in_code,
        in_inline_code=in_inline,
        in_frontmatter=in_frontmatter,
    )


def _parse_embed(
    match: re.Match,
    source_file: Path,
    line_num: int,
    link_counter: Iterator[int],
    in_code: bool = False,
    in_inline: bool = False,
    in_frontmatter: bool = False,
) -> LinkRef | None:
    """Parse an embed match into a LinkRef."""
    target_raw = match.group(1)
    alias = match.group(2)

    # Parse target for path/fragment
    target_path_part, fragment = _parse_fragment(target_raw)

    return LinkRef(
        id=f"link_{next(link_counter)}",
        source_file=source_file,
        kind=LinkKind.EMBED,
        raw_text=match.group(0),
        byte_start=match.start(),
        byte_end=match.end(),
        line=line_num,
        column=match.start() + 1,
        target_raw=target_raw,
        target_path_part=target_path_part,
        fragment=fragment,
        alias=alias,
        is_embed=True,
        in_code_block=in_code,
        in_inline_code=in_inline,
        in_frontmatter=in_frontmatter,
    )


def _parse_markdown_link(
    match: re.Match,
    source_file: Path,
    line_num: int,
    link_counter: Iterator[int],
    in_code: bool = False,
    in_inline: bool = False,
    in_frontmatter: bool = False,
) -> LinkRef | None:
    """Parse a markdown link match into a LinkRef."""
    alias = match.group(1)  # Link text
    target_raw = match.group(2)  # URL/path

    # Skip external links
    if target_raw.startswith(('http://', 'https://', 'mailto:', 'obsidian://')):
        return None

    # Parse target for path/fragment
    target_path_part, fragment = _parse_fragment(target_raw)

    return LinkRef(
        id=f"link_{next(link_counter)}",
        source_file=source_file,
        kind=LinkKind.MARKDOWN,
        raw_text=match.group(0),
        byte_start=match.start(),
        byte_end=match.end(),
        line=line_num,
        column=match.start() + 1,
        target_raw=target_raw,
        target_path_part=target_path_part,
        fragment=fragment,
        alias=alias,
        is_embed=False,
        in_code_block=in_code,
        in_inline_code=in_inline,
        in_frontmatter=in_frontmatter,
    )


def _parse_fragment(target: str) -> tuple[str | None, str | None]:
    """Split target into path and fragment (heading/block)."""
    if '#' in target:
        path_part, fragment = target.split('#', 1)
        # Remove leading / from path if present
        if path_part.startswith('/'):
            path_part = path_part[1:]
        return path_part if path_part else None, fragment
    return target, None


def extract_vault_links(
    vault_root: Path,
    ignore_patterns: list[str] | None = None,
) -> list[LinkRef]:
    """
    Extract all links from a vault.

    Args:
        vault_root: Path to the vault root
        ignore_patterns: Glob patterns to ignore (default: .git, .obsidian, etc.)

    Returns:
        List of all LinkRef objects in the vault
    """
    if ignore_patterns is None:
        ignore_patterns = [
            '.git/**',
            '.obsidian/**',
            'node_modules/**',
            '.trash/**',
        ]

    links: list[LinkRef] = []
    link_counter = iter(range(1000000))

    for md_file in vault_root.rglob('*.md'):
        # Check if file should be ignored
        if _should_ignore(md_file, vault_root, ignore_patterns):
            continue

        try:
            content = md_file.read_text(encoding='utf-8', errors='replace')
        except (OSError, UnicodeDecodeError):
            continue

        file_links = extract_links(content, md_file, link_counter)

        # Filter out links in code blocks (they shouldn't be in the output)
        for link in file_links:
            if not (link.in_code_block or link.in_inline_code):
                links.append(link)

    return links


def _should_ignore(
    file_path: Path,
    vault_root: Path,
    patterns: list[str],
) -> bool:
    """Check if a file matches any ignore pattern."""
    import fnmatch

    rel_path = file_path.relative_to(vault_root)

    for pattern in patterns:
        # Convert glob to fnmatch pattern
        if fnmatch.fnmatch(str(rel_path), pattern):
            return True
        # Also check individual path components
        for part in rel_path.parts:
            if fnmatch.fnmatch(part, pattern.rstrip('/').lstrip('*')):
                return True

    return False
