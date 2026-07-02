"""Tests for vault index (PR2)."""
import pytest
from pathlib import Path
from obc.index import VaultIndex, FileEntry, build_index


class TestVaultIndex:
    """Test VaultIndex class."""

    def test_add_file(self):
        """Should add file to index."""
        index = VaultIndex()
        entry = FileEntry(
            path=Path("test.md"),
            normalized_path="test.md",
            stem="test",
            basename="test.md",
            ext=".md",
            content_hash="abc123",
        )

        index.add_file(entry)

        assert len(index.files) == 1
        assert index.files_by_path["test.md"] == entry
        assert index.get_by_stem("test") == [entry]
        assert index.get_by_basename("test.md") == [entry]

    def test_case_insensitive_stem(self):
        """Should find file by case-insensitive stem."""
        index = VaultIndex()
        entry = FileEntry(
            path=Path("RealLink.md"),
            normalized_path="RealLink.md",
            stem="RealLink",
            basename="RealLink.md",
            ext=".md",
            content_hash="abc123",
        )

        index.add_file(entry)

        # Exact match
        assert len(index.get_by_stem("RealLink")) == 1
        # Case-insensitive match
        assert len(index.get_by_stem_case_insensitive("reallink")) == 1
        assert len(index.get_by_stem_case_insensitive("REALLINK")) == 1

    def test_case_insensitive_basename(self):
        """Should find file by case-insensitive basename."""
        index = VaultIndex()
        entry = FileEntry(
            path=Path("RealLink.md"),
            normalized_path="RealLink.md",
            stem="RealLink",
            basename="RealLink.md",
            ext=".md",
            content_hash="abc123",
        )

        index.add_file(entry)

        assert len(index.get_by_basename_case_insensitive("reallink.md")) == 1
        assert len(index.get_by_basename_case_insensitive("REALLINK.MD")) == 1

    def test_get_by_alias(self):
        """Should find file by alias."""
        index = VaultIndex()
        entry = FileEntry(
            path=Path("test.md"),
            normalized_path="test.md",
            stem="test",
            basename="test.md",
            ext=".md",
            content_hash="abc123",
            aliases=["AI", "Artificial Intelligence"],
        )

        index.add_file(entry)

        assert len(index.get_by_alias("AI")) == 1
        assert len(index.get_by_alias("ai")) == 1  # Case insensitive

    def test_multiple_files_same_stem(self):
        """Should handle multiple files with same stem."""
        index = VaultIndex()

        entry1 = FileEntry(
            path=Path("folder1/test.md"),
            normalized_path="folder1/test.md",
            stem="test",
            basename="test.md",
            ext=".md",
            content_hash="abc123",
        )
        entry2 = FileEntry(
            path=Path("folder2/test.md"),
            normalized_path="folder2/test.md",
            stem="test",
            basename="test.md",
            ext=".md",
            content_hash="def456",
        )

        index.add_file(entry1)
        index.add_file(entry2)

        assert len(index.get_by_stem("test")) == 2
        assert index.get_by_path("folder1/test.md") is not None


class TestBuildIndex:
    """Test build_index function."""

    def test_build_from_fixtures(self):
        """Should build index from test fixtures."""
        vault = Path("obc/fixtures/basic-vault")
        if not vault.exists():
            pytest.skip("Fixtures not found")

        index = build_index(vault)

        assert len(index.files) >= 1
        assert index.get_by_stem("RealLink") or index.get_by_stem("real-link")
