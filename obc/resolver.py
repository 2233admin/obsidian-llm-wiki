"""
Link Resolver - PR2

Resolve links against the vault index and classify diagnostics.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Optional

from obc.extract import LinkRef, LinkKind
from obc.index import VaultIndex, FileEntry


class DiagnosticCode(Enum):
    """Diagnostic codes for link resolution."""

    # Success codes
    OK_EXACT = "OK_EXACT"
    OK_UNIQUE_BY_BASENAME = "OK_UNIQUE_BY_BASENAME"
    OK_WITH_FRAGMENT = "OK_WITH_FRAGMENT"

    # Failure codes
    BROKEN_CERTAIN = "BROKEN_CERTAIN"
    BROKEN_FRAGMENT_ONLY = "BROKEN_FRAGMENT_ONLY"

    # Uncertainty codes
    AMBIGUOUS_TARGET = "AMBIGUOUS_TARGET"
    FUZZY_MATCH = "FUZZY_MATCH"  # Fuzzy match suggestion
    INTENTIONAL_DANGLING = "INTENTIONAL_DANGLING"

    # Special codes
    UNSUPPORTED_SYNTAX = "UNSUPPORTED_SYNTAX"
    IGNORED_EXTERNAL = "IGNORED_EXTERNAL"


@dataclass
class Diagnostic:
    """A diagnostic result for a link."""
    code: DiagnosticCode
    link: LinkRef
    target_file: Optional[FileEntry] = None
    candidates: list[FileEntry] = None
    message: str = ""

    # Fragment resolution
    fragment_exists: bool = False
    fragment_type: Optional[str] = None  # "heading" or "block"

    # Fix suggestion
    suggested_fix: Optional[str] = None
    safety_level: str = "S0"  # S0-S3

    def __post_init__(self):
        if self.candidates is None:
            self.candidates = []
        if self.message is None:
            self.message = ""

    @property
    def severity(self) -> str:
        """Get severity based on diagnostic code."""
        if self.code in (DiagnosticCode.OK_EXACT, DiagnosticCode.OK_UNIQUE_BY_BASENAME,
                         DiagnosticCode.OK_WITH_FRAGMENT, DiagnosticCode.IGNORED_EXTERNAL):
            return "ok"
        elif self.code in (DiagnosticCode.BROKEN_CERTAIN,):
            return "error"
        elif self.code in (DiagnosticCode.BROKEN_FRAGMENT_ONLY, DiagnosticCode.AMBIGUOUS_TARGET,
                           DiagnosticCode.FUZZY_MATCH, DiagnosticCode.INTENTIONAL_DANGLING):
            return "warning"
        else:
            return "info"

    def to_dict(self) -> dict:
        return {
            "id": self.link.id,
            "code": self.code.value,
            "severity": self.severity,
            "source_file": str(self.link.source_file),
            "line": self.link.line,
            "raw_text": self.link.raw_text,
            "target_raw": self.link.target_raw,
            "message": self.message,
            "candidates": [c.normalized_path for c in self.candidates],
            "fragment_exists": self.fragment_exists,
            "fragment_type": self.fragment_type,
            "suggested_fix": self.suggested_fix,
            "safety_level": self.safety_level,
        }


@dataclass
class ResolutionConfig:
    """Configuration for link resolution."""

    # File resolution
    default_extensions: list[str] = None
    case_sensitive: bool = False

    # Alias handling
    resolve_aliases: str = "suggest"  # "suggest", "resolve", "ignore"

    # Allow future notes
    allow_future_notes: bool = False

    # Directory index resolution
    directory_index_enabled: bool = False
    directory_index_names: list[str] = None

    def __post_init__(self):
        if self.default_extensions is None:
            self.default_extensions = [".md"]
        if self.directory_index_names is None:
            self.directory_index_names = ["index.md", "README.md", "_index.md"]


class Resolver:
    """
    Resolve links against the vault index.

    Resolution priority:
    A. External links -> IGNORED_EXTERNAL
    B. Relative paths -> resolve from source directory
    C. Vault-root absolute paths -> resolve from vault root
    D. Wikilink without extension -> exact stem, then unique basename
    E. Fragment resolution -> heading or block ID
    F. Alias candidates -> suggest only
    G. Directory index -> optional
    """

    def __init__(self, index: VaultIndex, config: ResolutionConfig | None = None):
        self.index = index
        self.config = config or ResolutionConfig()

    def resolve(self, link: LinkRef) -> Diagnostic:
        """
        Resolve a single link.

        Returns a Diagnostic with the resolution result.
        """
        # A. External links
        if self._is_external(link):
            return Diagnostic(
                code=DiagnosticCode.IGNORED_EXTERNAL,
                link=link,
                message="External link (not checked)",
            )

        # B. Relative paths
        if link.target_raw.startswith(('./', '../')):
            return self._resolve_relative(link)

        # C. Vault-root absolute paths (starts with /)
        if link.target_raw.startswith('/'):
            return self._resolve_absolute(link)

        # D. Wikilink without extension
        return self._resolve_wikilink(link)

    def resolve_all(self, links: list[LinkRef]) -> list[Diagnostic]:
        """Resolve all links."""
        return [self.resolve(link) for link in links]

    def _is_external(self, link: LinkRef) -> bool:
        """Check if link is external."""
        target = link.target_raw
        return any(target.startswith(prefix) for prefix in (
            'http://', 'https://', 'mailto:', 'obsidian://', 'file://'
        ))

    def _resolve_relative(self, link: LinkRef) -> Diagnostic:
        """Resolve a relative path from source file."""
        source_dir = link.source_file.parent

        # Try to resolve the path
        candidates = self._find_candidates(link.target_raw, source_dir)

        return self._make_diagnostic(link, candidates)

    def _resolve_absolute(self, link: LinkRef) -> Diagnostic:
        """Resolve an absolute path from vault root."""
        # Remove leading /
        target = link.target_raw.lstrip('/')

        # Search from vault root
        candidates = []
        for entry in self.index.files:
            if entry.normalized_path == target or entry.normalized_path == f"{target}.md":
                candidates.append(entry)

        return self._make_diagnostic(link, candidates)

    def _resolve_wikilink(self, link: LinkRef) -> Diagnostic:
        """Resolve a wikilink (no extension, no leading path)."""
        import urllib.parse
        target_raw = urllib.parse.unquote(link.target_raw)
        target = link.target_path_part or target_raw

        # 1. Try exact stem match first
        candidates = self.index.get_by_stem(target)
        if len(candidates) == 1:
            return self._resolve_fragment(link, candidates[0])
        elif len(candidates) > 1:
            return self._resolve_fragment(link, candidates[0], candidates=candidates)

        # 2. Try case-insensitive stem match (Obsidian is case-insensitive)
        candidates = self.index.get_by_stem_case_insensitive(target)
        if len(candidates) == 1:
            return self._resolve_fragment(link, candidates[0])
        elif len(candidates) > 1:
            return self._resolve_fragment(link, candidates[0], candidates=candidates)

        # 3. Try unique basename match (for markdown links like "RealLink.md")
        # Get stem from target (remove path and extension)
        target_for_basename = urllib.parse.unquote(link.target_raw)
        basename_stem = Path(target_for_basename).stem
        candidates = self.index.get_by_basename(basename_stem)
        if len(candidates) == 1:
            return Diagnostic(
                code=DiagnosticCode.OK_UNIQUE_BY_BASENAME,
                link=link,
                target_file=candidates[0],
                message=f"Unique basename match: {candidates[0].normalized_path}",
                suggested_fix=self._make_alias_suggestion(link, candidates[0]),
                safety_level="S2",
            )
        elif len(candidates) > 1:
            return Diagnostic(
                code=DiagnosticCode.AMBIGUOUS_TARGET,
                link=link,
                candidates=candidates,
                message=f"Multiple basename matches: {len(candidates)} candidates",
                safety_level="S3",
            )

        # 4. Try case-insensitive basename match
        candidates = self.index.get_by_basename_case_insensitive(basename_stem)
        if len(candidates) == 1:
            return Diagnostic(
                code=DiagnosticCode.OK_UNIQUE_BY_BASENAME,
                link=link,
                target_file=candidates[0],
                message=f"Unique basename match (case-insensitive): {candidates[0].normalized_path}",
                suggested_fix=self._make_alias_suggestion(link, candidates[0]),
                safety_level="S2",
            )
        elif len(candidates) > 1:
            return Diagnostic(
                code=DiagnosticCode.AMBIGUOUS_TARGET,
                link=link,
                candidates=candidates,
                message=f"Multiple basename matches: {len(candidates)} candidates",
                safety_level="S3",
            )

        # 5. Try fuzzy match (edit distance) for suggestions
        # Use stem for fuzzy matching (ignore extension)
        fuzzy_target = Path(target).stem
        fuzzy_candidates = self._find_fuzzy_matches(fuzzy_target)
        if fuzzy_candidates:
            # Return as fuzzy match (warning level, not ambiguous)
            return Diagnostic(
                code=DiagnosticCode.FUZZY_MATCH,
                link=link,
                candidates=fuzzy_candidates,
                message=f"Fuzzy match found: {[c.normalized_path for c in fuzzy_candidates]}",
                suggested_fix=self._make_alias_suggestion(link, fuzzy_candidates[0]),
                safety_level="S2",
            )

        # 6. Broken
        return Diagnostic(
            code=DiagnosticCode.BROKEN_CERTAIN,
            link=link,
            message=f"Target not found: {target}",
            safety_level="S0",
        )

    def _find_fuzzy_matches(self, target: str) -> list[FileEntry]:
        """Find files with similar names (for suggestions)."""
        target_lower = target.lower()
        candidates = []
        max_distance = 4  # Maximum Levenshtein distance for suggestion

        for entry in self.index.files:
            # Calculate simple edit distance
            stem_lower = entry.stem.lower()
            distance = self._levenshtein_distance(target_lower, stem_lower)
            if distance > 0 and distance <= max_distance:
                candidates.append((distance, entry))

        # Sort by distance and return
        candidates.sort(key=lambda x: x[0])
        return [entry for _, entry in candidates]

    def _levenshtein_distance(self, s1: str, s2: str) -> int:
        """Calculate Levenshtein distance between two strings."""
        if len(s1) < len(s2):
            return self._levenshtein_distance(s2, s1)
        if len(s2) == 0:
            return len(s1)

        previous_row = range(len(s2) + 1)
        for i, c1 in enumerate(s1):
            current_row = [i + 1]
            for j, c2 in enumerate(s2):
                insertions = previous_row[j + 1] + 1
                deletions = current_row[j] + 1
                substitutions = previous_row[j] + (c1 != c2)
                current_row.append(min(insertions, deletions, substitutions))
            previous_row = current_row

        return previous_row[-1]

    def _resolve_fragment(self, link: LinkRef, target_file: FileEntry,
                          candidates: list[FileEntry] | None = None) -> Diagnostic:
        """Resolve fragment (heading/block) within a file."""
        if not link.fragment:
            return Diagnostic(
                code=DiagnosticCode.OK_EXACT,
                link=link,
                target_file=target_file,
                message=f"Exact match: {target_file.normalized_path}",
                safety_level="S1",
            )

        # Check for heading (fragment doesn't start with ^)
        if not link.fragment.startswith('^'):
            heading_text = link.fragment
            heading_lower = heading_text.lower()
            for heading in target_file.headings:
                if heading.anchor == heading_lower or heading.text.lower() == heading_lower:
                    return Diagnostic(
                        code=DiagnosticCode.OK_WITH_FRAGMENT,
                        link=link,
                        target_file=target_file,
                        fragment_exists=True,
                        fragment_type="heading",
                        message=f"Heading found: {heading.text}",
                        safety_level="S0",
                    )

            # Heading not found
            return Diagnostic(
                code=DiagnosticCode.BROKEN_FRAGMENT_ONLY,
                link=link,
                target_file=target_file,
                fragment_exists=False,
                fragment_type="heading",
                message=f"Heading not found: {heading_text}",
                safety_level="S0",
            )

        # Check for block ID (fragment starts with ^)
        block_id = link.fragment.lstrip('^')
        for block in target_file.blocks:
            if block.id == block_id:
                return Diagnostic(
                    code=DiagnosticCode.OK_WITH_FRAGMENT,
                    link=link,
                    target_file=target_file,
                    fragment_exists=True,
                    fragment_type="block",
                    message=f"Block ID found: ^{block.id}",
                    safety_level="S0",
                )

        # Block not found
        return Diagnostic(
            code=DiagnosticCode.BROKEN_FRAGMENT_ONLY,
            link=link,
            target_file=target_file,
            fragment_exists=False,
            fragment_type="block",
            message=f"Block ID not found: ^{block_id}",
            safety_level="S0",
        )

    def _find_candidates(self, target: str, base_dir: Path) -> list[FileEntry]:
        """Find file candidates for a path."""
        candidates = []

        # Try exact path
        resolved = (base_dir / target).resolve()
        entry = self.index.get_by_path(str(resolved))
        if entry:
            candidates.append(entry)

        # Try with default extensions
        for ext in self.config.default_extensions:
            with_ext = resolved.with_suffix(ext)
            entry = self.index.get_by_path(str(with_ext))
            if entry and entry not in candidates:
                candidates.append(entry)

        return candidates

    def _make_diagnostic(self, link: LinkRef, candidates: list[FileEntry]) -> Diagnostic:
        """Create a diagnostic from candidates."""
        if len(candidates) == 0:
            return Diagnostic(
                code=DiagnosticCode.BROKEN_CERTAIN,
                link=link,
                message=f"File not found: {link.target_raw}",
                safety_level="S0",
            )
        elif len(candidates) == 1:
            return self._resolve_fragment(link, candidates[0])
        else:
            return Diagnostic(
                code=DiagnosticCode.AMBIGUOUS_TARGET,
                link=link,
                candidates=candidates,
                message=f"Multiple candidates: {len(candidates)} files match",
                safety_level="S3",
            )

    def _make_alias_suggestion(self, link: LinkRef, target: FileEntry) -> str:
        """Make a safe fix suggestion that preserves format and structure."""
        kind = link.kind.value
        # Get the raw (possibly URL-encoded) target for markdown links
        raw_target = link.target_raw
        # Get the stem/path without extension for matching
        target_stem = target.stem  # Use file's stem (no .md extension)

        if kind == "wikilink":
            # Wikilinks don't use extension
            parts = [target_stem]
            if link.fragment:
                parts.append(f"#{link.fragment}")
            if link.alias:
                parts.insert(1, f"|{link.alias}")
            return f"[[{''.join(parts)}]]"

        elif kind == "markdown":
            # Markdown links preserve URL encoding
            text = link.alias or raw_target  # Use raw for text if no alias
            # For the path, URL encode the target's path
            import urllib.parse
            # If raw target already has encoding, preserve it
            if '%' in raw_target:
                encoded_path = raw_target
            else:
                encoded_path = urllib.parse.quote(target.normalized_path, safe='/')
            return f"[{text}]({encoded_path})"

        elif kind == "embed":
            # Embeds don't use extension
            if link.fragment:
                return f"![[{target_stem}#{link.fragment}]]"
            return f"![[{target_stem}]]"

        else:
            return f"[[{target_stem}]]"
