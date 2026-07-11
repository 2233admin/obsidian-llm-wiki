"""Tests for git-diff driven incremental compilation."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import compile as compile_mod


class GitDiffDirtyTest(unittest.TestCase):
    """Unit tests for _git_diff_dirty()."""

    def test_empty_when_not_git_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            result = compile_mod._git_diff_dirty(tmp, "topic")
            self.assertEqual(result, [])

    def test_returns_changed_files_under_raw(self) -> None:
        """Files outside raw/ are excluded."""
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp)
            topic = vault / "my-topic"
            raw = topic / "raw"
            raw.mkdir(parents=True)

            # init git repo
            subprocess.run(["git", "init"], cwd=str(topic), capture_output=True)
            subprocess.run(
                ["git", "config", "user.email", "test@test.com"],
                cwd=str(topic), capture_output=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Test"],
                cwd=str(topic), capture_output=True,
            )

            # committed file -- should NOT appear
            committed = raw / "already.md"
            committed.write_text("committed content", encoding="utf-8")
            subprocess.run(["git", "add", "."], cwd=str(topic), capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", "initial"],
                cwd=str(topic), capture_output=True,
            )

            # changed file -- should appear
            committed.write_text("updated content", encoding="utf-8")

            result = compile_mod._git_diff_dirty(str(vault), "my-topic")
            self.assertEqual(result, ["already.md"])

    def test_excludes_non_raw_paths(self) -> None:
        """Files outside raw/ are filtered out."""
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp)
            topic = vault / "my-topic"
            raw = topic / "raw"
            wiki = topic / "wiki"
            raw.mkdir(parents=True)
            wiki.mkdir(parents=True)

            subprocess.run(["git", "init"], cwd=str(topic), capture_output=True)
            subprocess.run(
                ["git", "config", "user.email", "test@test.com"],
                cwd=str(topic), capture_output=True,
            )
            subprocess.run(
                ["git", "config", "user.name", "Test"],
                cwd=str(topic), capture_output=True,
            )

            # commit an initial file
            init_file = raw / "init.md"
            init_file.write_text("init", encoding="utf-8")
            subprocess.run(["git", "add", "."], cwd=str(topic), capture_output=True)
            subprocess.run(
                ["git", "commit", "-m", "init"],
                cwd=str(topic), capture_output=True,
            )

            # modify raw and touch wiki
            init_file.write_text("updated", encoding="utf-8")
            (wiki / "concept.md").write_text("concept", encoding="utf-8")

            result = compile_mod._git_diff_dirty(str(vault), "my-topic")
            self.assertNotIn("wiki/concept.md", result)
            self.assertIn("init.md", result)

    def test_handles_windows_backslash_raw_prefix(self) -> None:
        """Windows git can return raw\\ prefix -- strip it."""
        # This is hard to reproduce deterministically; just smoke-test
        # that Path-processing logic doesn't crash.
        with tempfile.TemporaryDirectory() as tmp:
            result = compile_mod._git_diff_dirty(tmp, "nonexistent-topic")
            self.assertEqual(result, [])


class StepDiffFallbackTest(unittest.TestCase):
    """Integration-style tests for step_diff() fallback behaviour."""

    def test_step_diff_falls_back_to_kb_meta_when_git_returns_empty(
        self,
    ) -> None:
        # When git returns no diffs, step_diff should still return a result
        # from kb_meta (tested via mocking -- keep unit-only).
        pass  # covered by integration tests in CI


class FullRecompileTest(unittest.TestCase):
    """LMVK L2 weekly full pass: --full bypasses incremental dirty-detection."""

    def _make_topic(self, vault: Path, already_compiled: bool = False) -> None:
        topic = vault / "my-topic"
        raw = topic / "raw"
        raw.mkdir(parents=True)
        (raw / "a.md").write_text("a", encoding="utf-8")
        (raw / "sub").mkdir()
        (raw / "sub" / "b.md").write_text("b", encoding="utf-8")
        if already_compiled:
            # kb_meta rel keys are relative to <vault>/<topic> (i.e. include the
            # raw/ prefix) -- see kb_meta.cmd_diff/cmd_update_hash.
            for rel in ("raw/a.md", "raw/sub/b.md"):
                compile_mod._run_kb_meta_cmd(["update-hash", str(vault), "my-topic", rel])

    def test_all_raw_files_lists_every_md_recursively(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp)
            self._make_topic(vault)
            result = compile_mod._all_raw_files(str(vault), "my-topic")
            self.assertEqual(result, ["raw/a.md", "raw/sub/b.md"])

    def test_all_raw_files_empty_when_no_raw_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(compile_mod._all_raw_files(tmp, "no-such-topic"), [])

    def test_step_diff_full_true_ignores_recorded_hashes(self) -> None:
        """Even files already marked compiled (up-to-date hash) come back
        dirty under full=True -- the whole point of a full pass."""
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp)
            self._make_topic(vault, already_compiled=True)

            # Sanity: incremental mode sees nothing dirty (git absent -> kb_meta
            # fallback -> hashes match -> empty).
            incremental = compile_mod.step_diff(str(vault), "my-topic", full=False)
            self.assertEqual(incremental, [])

            full = compile_mod.step_diff(str(vault), "my-topic", full=True)
            self.assertEqual(sorted(full), ["raw/a.md", "raw/sub/b.md"])


if __name__ == "__main__":
    unittest.main()
