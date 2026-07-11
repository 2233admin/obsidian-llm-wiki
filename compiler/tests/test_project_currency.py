"""Task 7A: project status drift guard.

Run from the compiler/ dir:
    python -m unittest tests.test_project_currency -v
"""

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


class ProjectSourceExemption(unittest.TestCase):
    """Task 7C: an auto-generated project note carries no `source` (a project is
    anchored by its own activity), so it must age-check, not show UNSUPPORTED."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-7c-"))
        self.vault = self.tmp / "vault"
        (self.vault / "research" / "wiki").mkdir(parents=True)
        (self.vault / "Projects").mkdir(parents=True)
        (self.vault / "research" / "_meta.json").write_text('{"sources": {}}', "utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self):
        return kb_meta.cmd_currency(str(self.vault), "research", today_str=TODAY, apply=False)

    def test_sourceless_old_project_is_age_stale_not_unsupported(self):
        (self.vault / "Projects" / "no-src.md").write_text(
            "---\nstatus: active\nentity: project/no-src\ntype: project\n"
            "last-verified: 2026-04-26\n---\n\nsourceless project, 60d old.\n", "utf-8")
        res = self._run()
        ent = res["entities"]["project/no-src"]
        self.assertEqual(ent["marker"], "STALE")
        self.assertIn("threshold (project)", " ".join(ent["reasons"]))
        self.assertNotIn("Projects/no-src.md", res["unsupported"])

    def test_sourceless_recent_project_is_ok(self):
        (self.vault / "Projects" / "ok.md").write_text(
            "---\nstatus: active\nentity: project/ok\ntype: project\n"
            "last-verified: 2026-06-20\n---\n\nsourceless project, recent.\n", "utf-8")
        self.assertEqual(self._run()["entities"]["project/ok"]["marker"], "OK")

    def test_sourceless_nonproject_still_unsupported(self):
        # §0 #6 regression: the exemption is project-only.
        (self.vault / "Projects" / "note.md").write_text(
            "---\nstatus: draft\nentity: thing/x\ntype: note\n"
            "last-verified: 2026-06-24\n---\n\nsourceless note.\n", "utf-8")
        self.assertEqual(self._run()["entities"]["thing/x"]["marker"], "UNSUPPORTED")


class ProjectStatusView(unittest.TestCase):
    """Task 7B: per-project current-truth view."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-proj-7b-"))
        self.vault = self.tmp / "vault"
        shutil.copytree(_FIXTURE, self.vault)
        self.res = kb_meta.cmd_currency(str(self.vault), "research",
                                        today_str=TODAY, apply=False)
        self.ps = self.res["project_status"]

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _entities(self, items):
        return {i["entity"] for i in items}

    def test_project_appears_with_its_status_and_stale_marker(self):
        p = self.ps["project/iii-pivot"]
        self.assertEqual(p["status"], "active")
        self.assertEqual(p["marker"], "STALE")

    def test_open_action_listed_with_overdue_and_unassigned_flags(self):
        # Task 8B: 7B's UNOWNED flag is REPLACED by UNASSIGNED (owner stays a
        # valid assignee alias via currency.resolve_assignee). wire-auth carries
        # neither assignee nor owner -> UNASSIGNED; its due is past TODAY -> OVERDUE.
        p = self.ps["project/iii-pivot"]
        opens = {i["entity"]: i for i in p["open_actions"]}
        self.assertIn("project/iii-pivot/action/wire-auth", opens)
        flags = " ".join(opens["project/iii-pivot/action/wire-auth"]["flags"])
        self.assertIn("OVERDUE", flags)
        self.assertIn("UNASSIGNED", flags)

    def test_done_action_not_open_and_counted_closed(self):
        p = self.ps["project/iii-pivot"]
        self.assertNotIn("project/iii-pivot/action/login-form", self._entities(p["open_actions"]))
        self.assertGreaterEqual(p["closed_count"], 1)
        # the superseded open note still exists on disk (not deleted).
        sup_ids = {s["note_id"] for s in self.res["superseded"]}
        self.assertIn("Projects/iii-pivot/actions/login-form-open.md", sup_ids)
        self.assertTrue((self.vault / "Projects/iii-pivot/actions/login-form-open.md").exists())

    def test_blocked_action_in_blockers_not_open(self):
        p = self.ps["project/iii-pivot"]
        self.assertIn("project/iii-pivot/action/db-migration", self._entities(p["blockers"]))
        self.assertNotIn("project/iii-pivot/action/db-migration", self._entities(p["open_actions"]))

    def test_decision_listed_as_decision_not_action(self):
        p = self.ps["project/iii-pivot"]
        self.assertIn("project/iii-pivot/decision/db-choice", self._entities(p["decisions"]))
        self.assertNotIn("project/iii-pivot/decision/db-choice", self._entities(p["open_actions"]))

    def test_project_without_subentities_has_empty_lists(self):
        p = self.ps["project/fresh-proj"]
        self.assertEqual(p["open_actions"], [])
        self.assertEqual(p["blockers"], [])

    def test_apply_writes_project_status_file(self):
        kb_meta.cmd_currency(str(self.vault), "research", today_str=TODAY, apply=True)
        f = self.vault / "research" / "wiki" / "_project-status.md"
        self.assertTrue(f.exists(), "_project-status.md must be written on apply")
        text = f.read_text("utf-8")
        for needle in ("project/iii-pivot", "STALE", "wire-auth", "OVERDUE",
                       "blockers", "db-migration", "db-choice"):
            self.assertIn(needle, text)


if __name__ == "__main__":
    unittest.main()
