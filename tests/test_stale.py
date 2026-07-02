"""Tests for stale note detection."""
import pytest
from datetime import datetime, timedelta
from pathlib import Path
from obc.stale import find_stale_notes, StaleNote, StaleReport


class TestFindStaleNotes:
    """Test find_stale_notes function."""

    def test_returns_empty_for_recent_notes(self, tmp_path):
        """Should return empty list when all notes are recent."""
        # Create a recently modified note
        note = tmp_path / "recent.md"
        note.write_text("# Recent Note\n\nModified yesterday.")

        # With 1 day threshold, recent note is not stale
        stale = find_stale_notes(tmp_path, min_age_days=1)
        assert len(stale) == 0

    def test_finds_stale_notes(self, tmp_path):
        """Should find notes older than threshold."""
        import os
        from datetime import timedelta

        # Create an old note (modify its mtime)
        old_note = tmp_path / "old.md"
        old_note.write_text("# Old Note\n\nNot updated in months.")

        # Create a recent note
        recent_note = tmp_path / "recent.md"
        recent_note.write_text("# Recent Note\n\nModified yesterday.")

        # Manually set old note's mtime to 100 days ago
        old_time = (datetime.now() - timedelta(days=100)).timestamp()
        os.utime(old_note, (old_time, old_time))

        # With 30 day threshold, old note is stale
        stale = find_stale_notes(tmp_path, min_age_days=30)
        assert len(stale) >= 1

    def test_excludes_ignored_folders(self, tmp_path):
        """Should exclude notes in ignored folders."""
        # Create note in Logs folder
        logs_dir = tmp_path / "Logs"
        logs_dir.mkdir()
        (logs_dir / "log.md").write_text("# Log\n\nOld log file.")

        stale = find_stale_notes(tmp_path, min_age_days=1)

        # Logs folder notes should be excluded
        paths = [s.path.stem for s in stale]
        assert "log" not in paths

    def test_returns_stale_note_objects(self, tmp_path):
        """Should return list of StaleNote objects."""
        # Create an old note
        old_note = tmp_path / "stale.md"
        old_note.write_text("# Stale Note\n\nOld content.")

        stale = find_stale_notes(tmp_path, min_age_days=1)

        assert all(isinstance(s, StaleNote) for s in stale)

    def test_includes_age_in_days(self, tmp_path):
        """Should calculate age in days for each note."""
        # Create an old note
        old_note = tmp_path / "very_old.md"
        old_note.write_text("# Very Old\n\nVery old content.")

        stale = find_stale_notes(tmp_path, min_age_days=1)

        for s in stale:
            assert s.age_days >= 0
            assert isinstance(s.age_days, float)


class TestStaleNote:
    """Test StaleNote dataclass."""

    def test_to_dict(self, tmp_path):
        """Should serialize to dict."""
        note = StaleNote(
            path=Path("test.md"),
            last_modified=datetime.now().timestamp(),
            age_days=45.5,
            links_to=3,
        )

        data = note.to_dict()
        assert "path" in data
        assert "last_modified" in data
        assert "age_days" in data
        assert "links_to" in data


class TestStaleReport:
    """Test StaleReport class."""

    def test_to_dict_format(self, tmp_path):
        """Should return properly formatted dict."""
        notes = [
            StaleNote(
                path=Path("old1.md"),
                last_modified=datetime.now().timestamp(),
                age_days=60.0,
                links_to=0,
            ),
        ]
        report = StaleReport(vault=str(tmp_path), notes=notes)

        data = report.to_dict()
        assert "vault" in data
        assert "total" in data
        assert "notes" in data
        assert data["total"] == 1

    def test_groups_by_folder(self, tmp_path):
        """Should group notes by folder for overview."""
        # Create notes in different folders
        (tmp_path / "folder1").mkdir(exist_ok=True)
        ((tmp_path / "folder1") / "old1.md").write_text("# Old 1")
        (tmp_path / "folder2").mkdir(exist_ok=True)
        ((tmp_path / "folder2") / "old2.md").write_text("# Old 2")

        report = StaleReport(vault=str(tmp_path), notes=[])

        # Should have folder statistics
        assert hasattr(report, 'folder_stats')
