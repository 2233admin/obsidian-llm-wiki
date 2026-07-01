"""Tests for link resolver (PR2)."""
import pytest
from pathlib import Path
from obc.index import VaultIndex, FileEntry
from obc.resolver import Resolver, ResolutionConfig, DiagnosticCode
from obc.extract import LinkRef, LinkKind


def make_index():
    """Create a test index."""
    index = VaultIndex()

    # Add RealLink.md
    real_link = FileEntry(
        path=Path("RealLink.md"),
        normalized_path="RealLink.md",
        stem="RealLink",
        basename="RealLink.md",
        ext=".md",
        content_hash="abc123",
    )
    index.add_file(real_link)

    # Add Target Note.md with heading and block
    from obc.index import HeadingEntry, BlockIdEntry
    target_note = FileEntry(
        path=Path("Target Note.md"),
        normalized_path="Target Note.md",
        stem="Target Note",
        basename="Target Note.md",
        ext=".md",
        content_hash="def456",
        headings=[HeadingEntry(text="Heading", level=1, line=1, anchor="heading")],
        blocks=[BlockIdEntry(id="block-id", line=5)],
    )
    index.add_file(target_note)

    return index


def make_link(target_raw: str, kind=LinkKind.WIKILINK, fragment=None, alias=None):
    """Create a test link."""
    return LinkRef(
        id="test_0",
        source_file=Path("test.md"),
        kind=kind,
        raw_text=f"[[{target_raw}]]",
        byte_start=0,
        byte_end=len(f"[[{target_raw}]]"),
        line=1,
        column=1,
        target_raw=target_raw,
        target_path_part=target_raw.split("#")[0] if fragment else target_raw,
        fragment=fragment,
        alias=alias,
    )


class TestResolver:
    """Test Resolver class."""

    def test_ok_exact_match(self):
        """Should resolve exact stem match."""
        index = make_index()
        resolver = Resolver(index)

        link = make_link("RealLink")
        diag = resolver.resolve(link)

        assert diag.code == DiagnosticCode.OK_EXACT
        assert diag.target_file.stem == "RealLink"

    def test_ok_with_fragment(self):
        """Should resolve link with existing heading."""
        index = make_index()
        resolver = Resolver(index)

        link = make_link("Target Note#Heading")
        diag = resolver.resolve(link)

        assert diag.code == DiagnosticCode.OK_WITH_FRAGMENT
        assert diag.fragment_exists is True
        assert diag.fragment_type == "heading"

    def test_broken_fragment_only(self):
        """Should report broken fragment."""
        index = make_index()
        resolver = Resolver(index)

        link = make_link("Target Note#NonExistent")
        diag = resolver.resolve(link)

        assert diag.code == DiagnosticCode.BROKEN_FRAGMENT_ONLY
        assert diag.fragment_exists is False

    def test_ok_unique_by_basename(self):
        """Should resolve markdown link by basename."""
        index = make_index()
        resolver = Resolver(index)

        link = make_link("RealLink.md", kind=LinkKind.MARKDOWN)
        diag = resolver.resolve(link)

        assert diag.code == DiagnosticCode.OK_UNIQUE_BY_BASENAME
        assert diag.target_file.stem == "RealLink"

    def test_fuzzy_match(self):
        """Should find fuzzy match for typo."""
        index = make_index()
        resolver = Resolver(index)

        link = make_link("Realink")  # Typo
        diag = resolver.resolve(link)

        assert diag.code == DiagnosticCode.FUZZY_MATCH
        assert len(diag.candidates) >= 1
        assert diag.candidates[0].stem == "RealLink"

    def test_broken_certain(self):
        """Should report broken for unknown target."""
        index = make_index()
        resolver = Resolver(index)

        link = make_link("UnknownNote")
        diag = resolver.resolve(link)

        assert diag.code == DiagnosticCode.BROKEN_CERTAIN

    def test_ignored_external(self):
        """Should ignore external links."""
        index = make_index()
        resolver = Resolver(index)

        link = LinkRef(
            id="test_0",
            source_file=Path("test.md"),
            kind=LinkKind.MARKDOWN,
            raw_text="[Google](https://google.com)",
            byte_start=0,
            byte_end=30,
            line=1,
            column=1,
            target_raw="https://google.com",
            target_path_part=None,
            fragment=None,
            alias="Google",
        )
        diag = resolver.resolve(link)

        assert diag.code == DiagnosticCode.IGNORED_EXTERNAL


class TestLevenshteinDistance:
    """Test Levenshtein distance calculation."""

    def test_exact_match(self):
        """Should return 0 for exact match."""
        resolver = Resolver(VaultIndex())
        assert resolver._levenshtein_distance("test", "test") == 0

    def test_one_char_diff(self):
        """Should return 1 for one character difference."""
        resolver = Resolver(VaultIndex())
        assert resolver._levenshtein_distance("test", "text") == 1

    def test_case_difference(self):
        """Should return 1 for case difference."""
        resolver = Resolver(VaultIndex())
        assert resolver._levenshtein_distance("Test", "test") == 1

    def test_complete_difference(self):
        """Should return length for completely different strings."""
        resolver = Resolver(VaultIndex())
        assert resolver._levenshtein_distance("abc", "xyz") == 3
