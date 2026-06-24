"""Task 7A: project status drift guard.

Run from the compiler/ dir:
    python -m unittest tests.test_project_currency -v
"""

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

_COMPILER = Path(__file__).resolve().parents[1]
if str(_COMPILER) not in sys.path:
    sys.path.insert(0, str(_COMPILER))

import currency  # noqa: E402
import kb_meta  # noqa: E402

_FIXTURE = _COMPILER.parent / "fixtures" / "vault-project-iii"
TODAY = "2026-06-25"


class ProjectThresholdConfig(unittest.TestCase):
    def test_project_type_registered(self):
        self.assertIn(currency.TYPE_PROJECT, currency.VALID_TYPES)
        self.assertEqual(currency.TYPE_PROJECT, "project")

    def test_project_threshold_is_30d(self):
        self.assertEqual(currency.stale_threshold_days(currency.TYPE_PROJECT), 30)

    def test_existing_thresholds_unchanged(self):
        # §0 #6: only ADD -- fact/decision/note thresholds must not move.
        self.assertEqual(currency.stale_threshold_days(currency.TYPE_DECISION), 14)
        self.assertEqual(currency.stale_threshold_days(currency.TYPE_FACT), 90)
        self.assertEqual(currency.stale_threshold_days(currency.TYPE_NOTE), 90)

    def test_terminal_status_helper(self):
        self.assertTrue(currency.is_terminal_project_status("completed"))
        self.assertTrue(currency.is_terminal_project_status("ARCHIVED"))
        self.assertFalse(currency.is_terminal_project_status("active"))
        self.assertFalse(currency.is_terminal_project_status("paused"))
        self.assertFalse(currency.is_terminal_project_status(None))


class ProjectDriftGuard(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-proj-7a-"))
        self.vault = self.tmp / "vault"
        shutil.copytree(_FIXTURE, self.vault)
        self.res = kb_meta.cmd_currency(str(self.vault), "research",
                                        today_str=TODAY, apply=False)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _marker(self, entity):
        return self.res["entities"][entity]["marker"]

    def _reasons(self, entity):
        return " ; ".join(self.res["entities"][entity]["reasons"])

    def test_active_project_untouched_past_threshold_is_stale(self):
        self.assertEqual(self._marker("project/iii-pivot"), "STALE")
        self.assertIn("30d threshold (project)", self._reasons("project/iii-pivot"))
        self.assertIn("Projects/iii-pivot.md", self.res["stale"])

    def test_recently_touched_active_project_is_ok(self):
        self.assertEqual(self._marker("project/fresh-proj"), "OK")
        self.assertNotIn("Projects/fresh-proj.md", self.res["stale"])

    def test_completed_project_is_not_stale_even_when_old(self):
        # terminal status -> age expected -> guard skips it.
        self.assertEqual(self._marker("project/done-proj"), "OK")
        self.assertNotIn("Projects/done-proj.md", self.res["stale"])

    def test_work_dirs_scanned(self):
        # all three vault-global Projects/ notes were picked up as entities.
        for e in ("project/iii-pivot", "project/fresh-proj", "project/done-proj"):
            self.assertIn(e, self.res["entities"])


if __name__ == "__main__":
    unittest.main()
