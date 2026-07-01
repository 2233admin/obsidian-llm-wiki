"""
Vault Index - PR2

Build a symbol table for the Obsidian vault.
Index files by path, stem, basename, and aliases.
Extract headings and block IDs.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator


@dataclass
class HeadingEntry:
    """A heading in a note."""
    text: str
    level: int  # 1-6
    line: int
    anchor: str  # URL-friendly anchor


@dataclass
class BlockIdEntry:
    """A block ID (^id) in a note."""
    id: str
    line: int


@dataclass
class FileEntry:
    """A file in the vault."""
    path: Path
    normalized_path: str
    stem: str
    basename: str
    ext: str
    content_hash: str
    aliases: list[str] = field(default_factory=list)
    headings: list[HeadingEntry] = field(default_factory=list)
    blocks: list[BlockIdEntry] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "path": str(self.path),
            "normalized_path": self.normalized_path,
            "stem": self.stem,
            "basename": self.basename,
            "ext": self.ext,
            "aliases": self.aliases,
            "heading_count": len(self.headings),
            "block_count": len(self.blocks),
        }


class VaultIndex:
    """
    Symbol table for the Obsidian vault.

    Provides fast lookups for file resolution.
    """

    def __init__(self):
        # Index by various keys
        self.files_by_path: dict[str, FileEntry] = {}
        self.files_by_stem: dict[str, list[FileEntry]] = {}
        self.files_by_basename: dict[str, list[FileEntry]] = {}
        self.files_by_alias: dict[str, list[FileEntry]] = {}

        # Heading index
        self.headings_by_file: dict[str, list[HeadingEntry]] = {}

        # All files
        self.files: list[FileEntry] = []

    def add_file(self, entry: FileEntry) -> None:
        """Add a file to the index."""
        self.files.append(entry)
        self.files_by_path[entry.normalized_path] = entry

        # Index by stem (filename without extension)
        if entry.stem not in self.files_by_stem:
            self.files_by_stem[entry.stem] = []
        self.files_by_stem[entry.stem].append(entry)

        # Index by basename (full filename with extension)
        if entry.basename not in self.files_by_basename:
            self.files_by_basename[entry.basename] = []
        self.files_by_basename[entry.basename].append(entry)

        # Also index stem in basename index for consistent lookups
        if entry.stem not in self.files_by_basename:
            self.files_by_basename[entry.stem] = []
        if entry not in self.files_by_basename[entry.stem]:
            self.files_by_basename[entry.stem].append(entry)

        # Index by aliases
        for alias in entry.aliases:
            alias_lower = alias.lower()
            if alias_lower not in self.files_by_alias:
                self.files_by_alias[alias_lower] = []
            self.files_by_alias[alias_lower].append(entry)

    def get_by_path(self, path: str) -> FileEntry | None:
        """Get file by exact path."""
        return self.files_by_path.get(path)

    def get_by_stem(self, stem: str) -> list[FileEntry]:
        """Get files by stem (filename without extension)."""
        return self.files_by_stem.get(stem, [])

    def get_by_stem_case_insensitive(self, stem: str) -> list[FileEntry]:
        """Get files by stem (case-insensitive)."""
        stem_lower = stem.lower()
        results = []
        for key, entries in self.files_by_stem.items():
            if key.lower() == stem_lower:
                results.extend(entries)
        return results

    def get_by_basename(self, basename: str) -> list[FileEntry]:
        """Get files by basename (ignoring path)."""
        return self.files_by_basename.get(basename, [])

    def get_by_basename_case_insensitive(self, basename: str) -> list[FileEntry]:
        """Get files by basename (case-insensitive)."""
        basename_lower = basename.lower()
        results = []
        for key, entries in self.files_by_basename.items():
            if key.lower() == basename_lower:
                results.extend(entries)
        return results

    def get_by_alias(self, alias: str) -> list[FileEntry]:
        """Get files by alias (case-insensitive)."""
        return self.files_by_alias.get(alias.lower(), [])

    def get_headings(self, path: str) -> list[HeadingEntry]:
        """Get headings for a file."""
        return self.headings_by_file.get(path, [])

    def summary(self) -> dict:
        """Get index summary."""
        return {
            "total_files": len(self.files),
            "unique_stems": len(self.files_by_stem),
            "unique_basenames": len(self.files_by_basename),
            "unique_aliases": len(self.files_by_alias),
        }


# Regex patterns
FRONTMATTER_PATTERN = re.compile(r'^---\n(.*?)\n---', re.DOTALL)
HEADING_PATTERN = re.compile(r'^(#{1,6})\s+(.+)$')
ALIASES_PATTERN = re.compile(r'(?:^|\n)aliases:\s*(?:\[([^\]]+)\]|-\s*(.+?)(?:\n|$))', re.MULTILINE)
BLOCK_ID_PATTERN = re.compile(r'\^([a-zA-Z0-9_-]+)$')


def index_file(file_path: Path, vault_root: Path) -> FileEntry | None:
    """
    Index a single file.

    Extracts:
    - Basic file info
    - Frontmatter aliases
    - Headings with anchors
    - Block IDs
    """
    try:
        content = file_path.read_text(encoding='utf-8', errors='replace')
    except OSError:
        return None

    # Basic file info
    rel_path = file_path.relative_to(vault_root)
    normalized = str(rel_path).replace('\\', '/')

    stem = file_path.stem
    basename = file_path.name
    ext = file_path.suffix

    # Content hash
    content_hash = hashlib.md5(content.encode()).hexdigest()

    # Parse frontmatter
    aliases = _extract_aliases(content)

    # Extract headings
    headings = _extract_headings(content)

    # Extract block IDs
    blocks = _extract_block_ids(content)

    entry = FileEntry(
        path=file_path,
        normalized_path=normalized,
        stem=stem,
        basename=basename,
        ext=ext,
        content_hash=content_hash,
        aliases=aliases,
        headings=headings,
        blocks=blocks,
    )

    return entry


def _extract_aliases(content: str) -> list[str]:
    """Extract aliases from frontmatter."""
    aliases: list[str] = []

    fm_match = FRONTMATTER_PATTERN.match(content)
    if not fm_match:
        return aliases

    fm_content = fm_match.group(1)

    # Try YAML array format: aliases: [AI, Artificial Intelligence]
    yaml_array = re.search(r'aliases:\s*\[([^\]]+)\]', fm_content)
    if yaml_array:
        for alias in yaml_array.group(1).split(','):
            alias = alias.strip().strip('"\'')
            if alias:
                aliases.append(alias)

    # Try YAML list format:
    # aliases:
    #   - AI
    #   - Artificial Intelligence
    yaml_list = re.findall(r'(?:^|\n)\s*-\s*(.+?)(?:\n|$)', fm_content)
    in_alias_section = False
    for line in fm_content.split('\n'):
        if re.match(r'aliases:\s*$', line):
            in_alias_section = True
        elif in_alias_section and line.strip().startswith('-'):
            alias = line.strip()[1:].strip().strip('"\'')
            if alias:
                aliases.append(alias)
        elif in_alias_section and not line.strip().startswith('-') and line.strip():
            in_alias_section = False

    return aliases


def _extract_headings(content: str) -> list[HeadingEntry]:
    """Extract headings with their anchors."""
    headings: list[HeadingEntry] = []

    for i, line in enumerate(content.split('\n'), start=1):
        match = HEADING_PATTERN.match(line.strip())
        if match:
            level = len(match.group(1))
            text = match.group(2).strip()
            anchor = _text_to_anchor(text)
            headings.append(HeadingEntry(
                text=text,
                level=level,
                line=i,
                anchor=anchor,
            ))

    return headings


def _extract_block_ids(content: str) -> list[BlockIdEntry]:
    """Extract block IDs from the content."""
    blocks: list[BlockIdEntry] = []

    for i, line in enumerate(content.split('\n'), start=1):
        # Block IDs are at the end of a line: text ^blockid
        match = BLOCK_ID_PATTERN.search(line)
        if match:
            blocks.append(BlockIdEntry(
                id=match.group(1),
                line=i,
            ))

    return blocks


def _text_to_anchor(text: str) -> str:
    """Convert heading text to Obsidian URL anchor."""
    # Remove markdown formatting
    anchor = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)  # [text](url) -> text
    anchor = re.sub(r'[*_`~]', '', anchor)  # Remove formatting chars
    anchor = re.sub(r'\s+', '-', anchor)  # Spaces to dashes
    anchor = re.sub(r'[^a-zA-Z0-9_-]', '', anchor)  # Remove special chars
    anchor = anchor.lower()
    return anchor


def build_index(
    vault_root: Path,
    ignore_patterns: list[str] | None = None,
) -> VaultIndex:
    """
    Build a complete vault index.

    Args:
        vault_root: Path to vault root
        ignore_patterns: Glob patterns to ignore

    Returns:
        VaultIndex with all files indexed
    """
    if ignore_patterns is None:
        ignore_patterns = [
            '.git/**',
            '.obsidian/**',
            'node_modules/**',
            '.trash/**',
        ]

    index = VaultIndex()

    for md_file in vault_root.rglob('*.md'):
        if _should_ignore(md_file, vault_root, ignore_patterns):
            continue

        entry = index_file(md_file, vault_root)
        if entry:
            index.add_file(entry)

    return index


def _should_ignore(
    file_path: Path,
    vault_root: Path,
    patterns: list[str],
) -> bool:
    """Check if a file matches any ignore pattern."""
    import fnmatch

    rel_path = file_path.relative_to(vault_root)

    for pattern in patterns:
        if fnmatch.fnmatch(str(rel_path), pattern):
            return True
        for part in rel_path.parts:
            base_pattern = pattern.rstrip('/').lstrip('*')
            if fnmatch.fnmatch(part, base_pattern):
                return True

    return False
