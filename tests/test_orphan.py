"""Tests for orphan detection."""
import pytest
from pathlib import Path
from obc.orphan import find_orphans, OrphanReport


class TestFindOrphans:
    """Test find_orphans function."""

    def test_empty_vault(self, tmp_path):
        """Should return empty list for empty vault."""
        orphans = find_orphans(tmp_path)
        assert len(orphans) == 0

    def test_orphan_detected(self, tmp_path):
        """Should detect file with no incoming links."""
        # note1.md exists but nothing links to it
        (tmp_path / "note1.md").write_text("# Note 1")
        # note2.md exists and nothing links to it either
        (tmp_path / "note2.md").write_text("# Note 2")

        orphans = find_orphans(tmp_path)
        assert len(orphans) == 2

    def test_linked_file_not_orphan(self, tmp_path):
        """Should NOT flag file that has incoming links."""
        # note1.md - nobody links to it -> orphan
        (tmp_path / "note1.md").write_text("# Note 1")
        # note2.md - note1 links to it -> NOT orphan
        (tmp_path / "note2.md").write_text("# Note 2\n\nSee [[note2]]")

        orphans = find_orphans(tmp_path)
        orphan_names = [o.path.name for o in orphans]
        assert "note2.md" not in orphan_names, "note2 should not be orphan"
        assert "note1.md" in orphan_names, "note1 should be orphan (no incoming links)"

    def test_home_excluded(self, tmp_path):
        """Home.md should not be reported as orphan."""
        (tmp_path / "Home.md").write_text("# Home")
        (tmp_path / "other.md").write_text("# Other")

        orphans = find_orphans(tmp_path)
        orphan_names = [o.path.name for o in orphans]
        assert "Home.md" not in orphan_names


class TestOrphanReport:
    """Test OrphanReport class."""

    def test_to_dict_structure(self, tmp_path):
        """Should serialize to dict with correct structure."""
        (tmp_path / "test.md").write_text("# Test")

        orphans = find_orphans(tmp_path)
        report = OrphanReport(vault=str(tmp_path), orphans=orphans)

        data = report.to_dict()
        assert "vault" in data
        assert "total" in data
        assert "orphans" in data
        assert data["total"] == 1
        assert len(data["orphans"]) == 1
        assert "path" in data["orphans"][0]
        assert "last_modified" in data["orphans"][0]
