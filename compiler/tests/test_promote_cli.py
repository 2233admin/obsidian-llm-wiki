"""Task 10C-A -- the `promote` CLI: a single entry over work_protocol.promote
(base-head lock + complete-snapshot materialize). Dry-run by default returns the
plan and writes nothing; --apply appends the reviewed snapshot. This is what the
10C Obsidian gesture shells out to, and the real promote step Task 11's loop uses.

Run from compiler/ (Windows -- prefix PYTHONUTF8=1):
    PYTHONUTF8=1 python -m unittest tests.test_promote_cli -v
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

_COMPILER = Path(__file__).resolve().parents[1]
if str(_COMPILER) not in sys.path:
    sys.path.insert(0, str(_COMPILER))

import kb_meta  # noqa: E402
import work_protocol  # noqa: E402


class PromoteCliTest(unittest.TestCase):
    def setUp(self) -> None:
        self.vault = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        shutil.rmtree(self.vault, ignore_errors=True)

    def _write(self, rel: str, **fm) -> str:
        p = self.vault / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        lines = "\n".join(f"{k}: {v}" for k, v in fm.items())
        p.write_text(f"---\n{lines}\n---\n\nbody text\n", encoding="utf-8")
        return rel

    def test_dry_run_returns_plan_writes_nothing(self) -> None:
        rel = self._write("00-Inbox/AI-Output/t/cap.md",
                          entity="proj/x/decision/d1", type="decision", status="draft")
        out = kb_meta.cmd_promote(str(self.vault), note=rel, today="2026-06-25")
        self.assertEqual(out["outcome"], work_protocol.OUTCOME_MATERIALIZED)
        self.assertIn("plan", out)                 # the materialized snapshot plan
        self.assertNotIn("written", out)           # dry-run writes nothing
        self.assertIn("status: reviewed", out["plan"])  # the plan stamps reviewed

    def test_apply_writes_reviewed_snapshot(self) -> None:
        rel = self._write("00-Inbox/AI-Output/t/cap.md",
                          entity="proj/x/decision/d1", type="decision", status="draft")
        out = kb_meta.cmd_promote(str(self.vault), note=rel, apply=True, today="2026-06-25")
        self.assertEqual(out["outcome"], work_protocol.OUTCOME_MATERIALIZED)
        self.assertIn("written", out)
        self.assertTrue(Path(out["written"]).exists())

    def test_non_draft_is_not_promoted(self) -> None:
        rel = self._write("Projects/x/issues/a.md",
                          entity="proj/x/issue/a", type="issue", status="reviewed")
        out = kb_meta.cmd_promote(str(self.vault), note=rel)
        self.assertEqual(out["outcome"], work_protocol.OUTCOME_NOT_DRAFT)
        self.assertNotIn("written", out)

    def test_candidate_not_found_errors(self) -> None:
        out = kb_meta.cmd_promote(str(self.vault), note="nope.md")
        self.assertIn("error", out)

    def test_select_by_entity(self) -> None:
        self._write("00-Inbox/AI-Output/t/cap.md",
                    entity="proj/x/decision/d2", type="decision", status="draft")
        out = kb_meta.cmd_promote(str(self.vault), entity="proj/x/decision/d2",
                                  today="2026-06-25")
        self.assertEqual(out["outcome"], work_protocol.OUTCOME_MATERIALIZED)
        self.assertEqual(out["entity"], "proj/x/decision/d2")


if __name__ == "__main__":
    unittest.main()
