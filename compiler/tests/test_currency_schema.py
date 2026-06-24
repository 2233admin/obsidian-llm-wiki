"""Task 1 -- currency layer frontmatter schema + fixture sanity.

Two things are proven here:
  1. currency.normalize() lands the new fields with safe defaults and never
     crashes on missing fields (old notes keep compiling).
  2. The fixture vault parses correctly AND the existing kb_meta.py commands
     run clean against it (the Task 1 acceptance bar).

Task 2's supersession / staleness / unsupported verdicts are NOT asserted here.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import currency
from _md_parse import parse_frontmatter

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE = REPO_ROOT / "fixtures" / "vault-iii"
KB_META = Path(__file__).resolve().parents[1] / "kb_meta.py"


def read_fm(path: Path) -> dict:
    return parse_frontmatter(path.read_text("utf-8"))


class NormalizeDefaultsTest(unittest.TestCase):
    def test_empty_frontmatter_safe_defaults(self) -> None:
        cm = currency.normalize({})
        self.assertIsNone(cm.entity)
        self.assertEqual(cm.type, currency.TYPE_NOTE)  # default
        self.assertIsNone(cm.source)
        self.assertIsNone(cm.last_verified)
        self.assertIsNone(cm.supersedes)
        self.assertIsNone(cm.status)
        self.assertFalse(cm.has_source)
        self.assertIsNone(cm.source_scheme)

    def test_unknown_type_falls_back_to_note(self) -> None:
        self.assertEqual(currency.normalize({"type": "garbage"}).type, currency.TYPE_NOTE)

    def test_empty_source_is_unsupported_signal(self) -> None:
        # robust parser turns "source:" with no value into []
        cm = currency.normalize({"source": []})
        self.assertFalse(cm.has_source)
        self.assertIsNone(cm.source_scheme)

    def test_source_scheme_and_target(self) -> None:
        cm = currency.normalize({"source": "path:research/raw/iii-spec.md"})
        self.assertTrue(cm.has_source)
        self.assertEqual(cm.source_scheme, "path")
        self.assertEqual(cm.source_target, "research/raw/iii-spec.md")
        self.assertEqual(currency.normalize({"source": "commit:abc"}).source_scheme, "commit")
        self.assertIsNone(currency.normalize({"source": "bogus-no-scheme"}).source_scheme)

    def test_stale_thresholds(self) -> None:
        self.assertEqual(currency.stale_threshold_days("decision"), 14)
        self.assertEqual(currency.stale_threshold_days("fact"), 90)
        self.assertEqual(currency.stale_threshold_days("note"), 90)
        self.assertEqual(currency.stale_threshold_days("anything-else"), 90)


class FixtureSeedsParseTest(unittest.TestCase):
    def test_seed1_iii_reviewed_old_truth(self) -> None:
        cm = currency.normalize(read_fm(FIXTURE / "research/wiki/entities/iii.md"))
        self.assertEqual(cm.entity, "k-atana/iii")
        self.assertEqual(cm.type, "decision")
        self.assertEqual(cm.source_scheme, "commit")
        self.assertEqual(cm.status, "reviewed")
        self.assertIsNone(cm.supersedes)

    def test_seed2_iii_done_unreviewed_supersedes(self) -> None:
        cm = currency.normalize(
            read_fm(FIXTURE / "00-Inbox/AI-Output/test-agent/iii-done.md")
        )
        self.assertEqual(cm.entity, "k-atana/iii")
        self.assertEqual(cm.status, "draft")  # draft == unreviewed
        self.assertEqual(cm.source_target, "NEW5678")
        self.assertEqual(cm.supersedes, "research/wiki/entities/iii.md")
        self.assertEqual(cm.last_verified, "2026-06-24")

    def test_seed3_unsupported_empty_source(self) -> None:
        cm = currency.normalize(
            read_fm(FIXTURE / "research/wiki/entities/unsupported-demo.md")
        )
        self.assertEqual(cm.entity, "k-atana/unsupported-demo")
        self.assertFalse(cm.has_source)  # -> UNSUPPORTED in Task 2

    def test_seed4_stale_source_pointer(self) -> None:
        cm = currency.normalize(
            read_fm(FIXTURE / "research/wiki/entities/stale-demo.md")
        )
        self.assertEqual(cm.type, "fact")
        self.assertEqual(cm.source_scheme, "path")
        self.assertEqual(cm.source_target, "research/raw/iii-spec.md")
        self.assertEqual(cm.last_verified, "2026-05-01")


class KbMetaRunsCleanTest(unittest.TestCase):
    """Acceptance: the fixture compiles through existing kb_meta with no error.

    Run against a temp copy so the committed fixture stays pristine.
    """

    def _kb_meta(self, *args: str) -> dict:
        result = subprocess.run(
            [sys.executable, str(KB_META), *args],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, msg=f"kb_meta {args[0]} stderr: {result.stderr}")
        return json.loads(result.stdout)

    def test_kb_meta_pipeline_clean_on_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            vault = Path(tmp) / "vault-iii"
            shutil.copytree(FIXTURE, vault)
            v, topic = str(vault), "research"

            self._kb_meta("init", v, topic)

            diff = self._kb_meta("diff", v, topic)
            # source file changed vs the recorded placeholder hash -> the STALE signal
            self.assertIn("raw/iii-spec.md", diff["changed"])

            idx = self._kb_meta("update-index", v, topic)
            self.assertTrue(idx.get("ok"))

            links = self._kb_meta("check-links", v, topic)
            self.assertEqual(links["broken"], [])  # fixture has no broken wikilinks


if __name__ == "__main__":
    unittest.main()
