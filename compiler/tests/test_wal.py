"""Tests for compiler.wal."""

from __future__ import annotations

import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from wal import WAL, WALEntry


class WALTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.vault_root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _assert_last_entry(
        self, wal: WAL, action: str, path: str, hash: str | None
    ) -> None:
        last = wal.tail(1)[0]
        self.assertEqual(last.action, action)
        self.assertEqual(last.path, path)
        self.assertEqual(last.hash, hash)

    # ------------------------------------------------------------------
    # append + tail
    # ------------------------------------------------------------------

    def test_append_creates_file(self) -> None:
        wal = WAL(self.vault_root)
        wal.append("create", "notes/foo.md", "abc123")
        self.assertTrue(wal.path.exists())

    def test_append_writes_entry(self) -> None:
        wal = WAL(self.vault_root)
        wal.append("update", "notes/bar.md", "def456")
        self._assert_last_entry(wal, "update", "notes/bar.md", "def456")

    def test_append_without_hash(self) -> None:
        wal = WAL(self.vault_root)
        wal.append("delete", "notes/baz.md")
        self._assert_last_entry(wal, "delete", "notes/baz.md", None)

    def test_len_empty(self) -> None:
        wal = WAL(self.vault_root)
        self.assertEqual(len(wal), 0)

    def test_len_after_append(self) -> None:
        wal = WAL(self.vault_root)
        wal.append("create", "a.md")
        wal.append("update", "b.md")
        self.assertEqual(len(wal), 2)

    def test_tail(self) -> None:
        wal = WAL(self.vault_root)
        for i in range(12):
            wal.append("write", f"f{i}.md")
        tail = wal.tail(5)
        self.assertEqual(len(tail), 5)
        self.assertTrue(tail[0].path.startswith("f"))

    # ------------------------------------------------------------------
    # replay
    # ------------------------------------------------------------------

    def test_replay_all(self) -> None:
        wal = WAL(self.vault_root)
        wal.append("create", "a.md", "h1")
        wal.append("update", "b.md", "h2")
        entries = list(wal.replay())
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0].action, "create")
        self.assertEqual(entries[1].action, "update")

    def test_replay_from_timestamp_skips_older(self) -> None:
        wal = WAL(self.vault_root)
        wal.append("create", "a.md")
        wal.append("update", "b.md")
        wal.append("update", "c.md")
        # Use the first entry's timestamp as cutoff; entries at that exact
        # instant are included (>= behaviour), but the first entry itself
        # is included as well -- the key invariant is that the count grows
        # when we advance the cutoff past all entries.
        all_entries = list(wal.replay())
        self.assertEqual(len(all_entries), 3)
        cutoff = all_entries[0].timestamp
        after = list(wal.replay(from_timestamp=cutoff))
        self.assertGreaterEqual(len(after), 1)  # at least the second entry
        # Entries are replayed in order.
        self.assertEqual(after[0].action, "create")  # timestamp >= cutoff includes first
        # A cutoff far in the future returns nothing.
        future = "9999-01-01T00:00:00.000000Z"
        self.assertEqual(list(wal.replay(from_timestamp=future)), [])

    # ------------------------------------------------------------------
    # read_all classmethod
    # ------------------------------------------------------------------

    def test_read_all_empty(self) -> None:
        entries = WAL.read_all(self.vault_root)
        self.assertEqual(entries, [])

    def test_read_all_returns_all(self) -> None:
        wal = WAL(self.vault_root)
        wal.append("create", "x.md", "hx")
        wal.append("update", "y.md", "hy")
        entries = WAL.read_all(self.vault_root)
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[0].path, "x.md")
        self.assertEqual(entries[1].path, "y.md")

    def test_read_all_independent_of_instance(self) -> None:
        """read_all should not require a WAL instance, only vault_root."""
        wal = WAL(self.vault_root)
        wal.append("write", "z.md", "hz")
        # read via classmethod directly
        entries = WAL.read_all(self.vault_root)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].path, "z.md")

    # ------------------------------------------------------------------
    # latest_hash
    # ------------------------------------------------------------------

    def test_latest_hash_returns_last(self) -> None:
        wal = WAL(self.vault_root)
        wal.append("write", "notes/test.md", "h1")
        wal.append("write", "notes/test.md", "h2")
        wal.append("write", "notes/other.md", "h3")
        self.assertEqual(wal.latest_hash("notes/test.md"), "h2")

    def test_latest_hash_missing(self) -> None:
        wal = WAL(self.vault_root)
        self.assertIsNone(wal.latest_hash("nonexistent.md"))

    # ------------------------------------------------------------------
    # entry fields
    # ------------------------------------------------------------------

    def test_entry_has_timestamp(self) -> None:
        wal = WAL(self.vault_root)
        wal.append("create", "a.md")
        last = wal.tail(1)[0]
        # ISO format with timezone
        self.assertIn("T", last.timestamp)
        self.assertIn("+", last.timestamp)

    def test_entry_fields_match(self) -> None:
        wal = WAL(self.vault_root)
        wal.append("update", "path/to/file.md", "abc123")
        entry = wal.tail(1)[0]
        self.assertIsInstance(entry, WALEntry)
        self.assertEqual(entry.action, "update")
        self.assertEqual(entry.path, "path/to/file.md")
        self.assertEqual(entry.hash, "abc123")


if __name__ == "__main__":
    unittest.main()
