"""Task 8 / PR 8E: initiatives (Tier2).

8E adds an additive pass (`kb_meta._pass5_initiative_status`) + a `_render_
initiative_status` view + the `TYPE_INITIATIVE` / `F_INITIATIVE` constants in
currency.py. An initiative rolls up its member projects: each member contributes
its (status, marker, open/blocker/closed counts) REUSED from the _pass4 project
status (markers never recomputed). Initiative health is 'at-risk' iff any member
is STALE or has blockers; else 'on-track'.

Two scenarios:
  * the committed fixtures/vault-work-os initiative (initiative/q3-launch) with
    one STALE member (payments) + one fresh member (onboarding) -> at-risk.
  * a built-in fresh-only vault (every member OK, no blockers) -> on-track.

Mirrors test_project_currency.py's unittest style + fixed-date convention. The
work-os fixture has no topic wiki, so setUp creates research/wiki for the
cmd_currency read path (the same shape LiveProjectStatusDraftExclusion uses).

Run from the compiler/ dir (this box is Windows -- prefix PYTHONUTF8=1):
    PYTHONUTF8=1 python -m unittest tests.test_initiatives_cycles -v
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

_COMPILER = Path(__file__).resolve().parents[1]
if str(_COMPILER) not in sys.path:
    sys.path.insert(0, str(_COMPILER))

import currency  # noqa: E402
import kb_meta  # noqa: E402

_FIXTURE = _COMPILER.parent / "fixtures" / "vault-work-os"

# Fixed "today" so the 30d staleness math is deterministic (mirrors the TODAY in
# test_project_currency.py / test_work_os.py).
TODAY = date(2026, 6, 25)

# The committed initiative scenario (note-id = repo-relative path).
INITIATIVE = "initiative/q3-launch"
INITIATIVE_NOTE_ID = "Projects/q3-launch/initiative.md"
MEMBER_PAYMENTS = "project/q3-launch-payments"      # STALE (last-verified 2026-04-01)
MEMBER_ONBOARDING = "project/q3-launch-onboarding"  # fresh (last-verified 2026-06-24)


class InitiativeSchemaTest(unittest.TestCase):
    """The additive currency.py constants for 8E."""

    def test_initiative_type_registered(self) -> None:
        self.assertIn(currency.TYPE_INITIATIVE, currency.VALID_TYPES)
        self.assertEqual(currency.TYPE_INITIATIVE, "initiative")

    def test_initiative_field_name(self) -> None:
        self.assertEqual(currency.F_INITIATIVE, "initiative")

    def test_existing_types_unchanged(self) -> None:
        # §0: additive only -- the pre-8E types must still be present.
        for t in (currency.TYPE_FACT, currency.TYPE_DECISION,
                  currency.TYPE_NOTE, currency.TYPE_PROJECT):
            self.assertIn(t, currency.VALID_TYPES)

    def test_existing_thresholds_unchanged(self) -> None:
        # §0 #6: only ADD -- the project/fact/decision/note thresholds must not move.
        self.assertEqual(currency.stale_threshold_days(currency.TYPE_DECISION), 14)
        self.assertEqual(currency.stale_threshold_days(currency.TYPE_FACT), 90)
        self.assertEqual(currency.stale_threshold_days(currency.TYPE_NOTE), 90)
        self.assertEqual(currency.stale_threshold_days(currency.TYPE_PROJECT), 30)

    def test_initiative_has_a_threshold(self) -> None:
        self.assertEqual(currency.stale_threshold_days(currency.TYPE_INITIATIVE), 30)


class InitiativeAtRiskFixture(unittest.TestCase):
    """The committed fixtures/vault-work-os q3-launch initiative aggregates its two
    member projects; health == at-risk because one member (payments) is STALE."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-8e-"))
        self.vault = self.tmp / "vault"
        shutil.copytree(_FIXTURE, self.vault)
        # the work-os fixture carries no topic wiki -- cmd_currency needs one.
        (self.vault / "research" / "wiki").mkdir(parents=True)
        (self.vault / "research" / "_meta.json").write_text('{"sources": {}}', "utf-8")
        self.res = kb_meta.cmd_currency(str(self.vault), "research",
                                        today_str=TODAY.isoformat(), apply=False)
        self.ist = self.res["initiative_status"]

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _members(self):
        return {m["entity"]: m for m in self.ist[INITIATIVE]["members"]}

    def test_initiative_discovered_with_its_own_note(self) -> None:
        self.assertIn(INITIATIVE, self.ist)
        self.assertEqual(self.ist[INITIATIVE]["note_id"], INITIATIVE_NOTE_ID)

    def test_aggregates_exactly_its_two_member_projects(self) -> None:
        members = self._members()
        self.assertEqual(set(members), {MEMBER_PAYMENTS, MEMBER_ONBOARDING})
        self.assertEqual(self.ist[INITIATIVE]["member_count"], 2)

    def test_health_at_risk_because_one_member_is_stale(self) -> None:
        self.assertEqual(self.ist[INITIATIVE]["health"], kb_meta.INITIATIVE_AT_RISK)

    def test_member_markers_reused_from_project_status(self) -> None:
        members = self._members()
        # the marker is REUSED from _pass4 project_status, not recomputed here.
        self.assertIn(currency.MARK_STALE, members[MEMBER_PAYMENTS]["marker"])
        self.assertEqual(members[MEMBER_ONBOARDING]["marker"], currency.MARK_OK)
        # cross-check against the project_status pass output itself.
        ps = self.res["project_status"]
        self.assertEqual(members[MEMBER_PAYMENTS]["marker"], ps[MEMBER_PAYMENTS]["marker"])
        self.assertEqual(members[MEMBER_ONBOARDING]["marker"],
                         ps[MEMBER_ONBOARDING]["marker"])

    def test_rollup_counts_are_correct(self) -> None:
        # neither member has actions in the fixture -> all rollup counts are 0.
        it = self.ist[INITIATIVE]
        self.assertEqual(it["total_open"], 0)
        self.assertEqual(it["total_blockers"], 0)
        self.assertEqual(it["total_closed"], 0)

    def test_rendered_view_carries_health_and_members(self) -> None:
        md = self.res["initiative_status_md"]
        self.assertIn("# Initiative Status", md)
        self.assertIn(INITIATIVE, md)
        self.assertIn("health: at-risk", md)
        self.assertIn(MEMBER_PAYMENTS, md)
        self.assertIn(MEMBER_ONBOARDING, md)
        self.assertIn("STALE", md)

    def test_initiative_view_written_on_apply_absent_on_dry_run(self) -> None:
        f = self.vault / "research" / "wiki" / kb_meta.INITIATIVE_STATUS_FILE
        # dry-run (setUp ran apply=False) wrote nothing.
        self.assertFalse(f.exists(), "_initiative-status.md must be absent on dry-run")
        kb_meta.cmd_currency(str(self.vault), "research",
                             today_str=TODAY.isoformat(), apply=True)
        self.assertTrue(f.exists(), "_initiative-status.md must be written on apply")
        text = f.read_text("utf-8")
        for needle in (INITIATIVE, "at-risk", MEMBER_PAYMENTS, MEMBER_ONBOARDING):
            self.assertIn(needle, text)

    def test_applied_view_is_lf_only(self) -> None:
        kb_meta.cmd_currency(str(self.vault), "research",
                             today_str=TODAY.isoformat(), apply=True)
        disk = (self.vault / "research" / "wiki" /
                kb_meta.INITIATIVE_STATUS_FILE).read_bytes()
        self.assertNotIn(b"\r\n", disk, "derived view must be LF-only on disk")

    def test_source_bytes_unchanged_after_apply(self) -> None:
        before = {nid: (self.vault / nid).read_bytes()
                  for nid in (INITIATIVE_NOTE_ID,
                              "Projects/q3-launch/payments.md",
                              "Projects/q3-launch/onboarding.md")}
        kb_meta.cmd_currency(str(self.vault), "research",
                             today_str=TODAY.isoformat(), apply=True)
        for nid, b in before.items():
            self.assertEqual((self.vault / nid).read_bytes(), b,
                             f"{nid} source must be byte-identical")


class InitiativeOnTrackFreshOnly(unittest.TestCase):
    """A built-in isolated vault: an initiative whose members are ALL fresh (OK,
    no blockers) -> health == on-track. Built in a temp dir (not committed) so it
    cannot perturb the existing fixture assertions."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-8e-ot-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects" / "ship-it").mkdir(parents=True)
        (self.vault / "research" / "wiki").mkdir(parents=True)
        (self.vault / "research" / "_meta.json").write_text('{"sources": {}}', "utf-8")
        # the initiative's own note.
        (self.vault / "Projects" / "ship-it" / "initiative.md").write_text(
            "---\ntype: initiative\nentity: initiative/ship-it\nstatus: active\n"
            "source: commit:SHIPIT01\nlast-verified: 2026-06-24\n---\n\nfresh initiative.\n",
            "utf-8")
        # two fresh member projects (within the 30d threshold, no actions).
        (self.vault / "Projects" / "ship-it" / "alpha.md").write_text(
            "---\ntype: project\nentity: project/ship-it-alpha\n"
            "initiative: initiative/ship-it\nstatus: active\n"
            "last-verified: 2026-06-24\n---\n\nfresh member alpha.\n", "utf-8")
        (self.vault / "Projects" / "ship-it" / "beta.md").write_text(
            "---\ntype: project\nentity: project/ship-it-beta\n"
            "initiative: initiative/ship-it\nstatus: active\n"
            "last-verified: 2026-06-23\n---\n\nfresh member beta.\n", "utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self):
        return kb_meta.cmd_currency(str(self.vault), "research",
                                    today_str=TODAY.isoformat(), apply=False)

    def test_fresh_only_initiative_is_on_track(self) -> None:
        ist = self._run()["initiative_status"]
        it = ist["initiative/ship-it"]
        self.assertEqual(it["health"], kb_meta.INITIATIVE_ON_TRACK)
        self.assertEqual(it["member_count"], 2)
        # no member is STALE.
        for m in it["members"]:
            self.assertEqual(m["marker"], currency.MARK_OK)
            self.assertEqual(m["blocker_count"], 0)


class InitiativeLinkageOnly(unittest.TestCase):
    """A project linking to an initiative that has NO own note still surfaces that
    initiative (the UNION discovery rule), keyed by the linked entity with
    note_id=None. The member here is present and fresh, so the linkage-only
    initiative is on-track -- there is no missing-member case (membership is built
    from project_status, so every member is backed by a project_status entry)."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-8e-miss-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects").mkdir(parents=True)
        (self.vault / "research" / "wiki").mkdir(parents=True)
        (self.vault / "research" / "_meta.json").write_text('{"sources": {}}', "utf-8")
        # a fresh project linking to an initiative that has NO own note.
        (self.vault / "Projects" / "orphan.md").write_text(
            "---\ntype: project\nentity: project/orphan\n"
            "initiative: initiative/ghost\nstatus: active\n"
            "last-verified: 2026-06-24\n---\n\nlinks to a note-less initiative.\n",
            "utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_linkage_only_initiative_surfaced_without_note(self) -> None:
        ist = kb_meta.cmd_currency(str(self.vault), "research",
                                   today_str=TODAY.isoformat(), apply=False)["initiative_status"]
        self.assertIn("initiative/ghost", ist)
        it = ist["initiative/ghost"]
        self.assertIsNone(it["note_id"])
        # the member exists and is fresh -> the only reason it could be at-risk is
        # absent here; a healthy linkage-only initiative is on-track.
        self.assertEqual(it["health"], kb_meta.INITIATIVE_ON_TRACK)
        self.assertEqual(it["member_count"], 1)
        self.assertEqual(it["members"][0]["entity"], "project/orphan")


class InitiativeAtRiskBecauseMemberHasBlocker(unittest.TestCase):
    """The blocker trigger, pinned INDEPENDENTLY of the STALE trigger. Every member
    is fresh (marker OK, non-STALE), but one member project carries an issue that
    is blocked-by an unresolved (in-progress) issue -> that member's blocker_count
    is > 0 while its marker stays OK, so the initiative health flips to at-risk via
    the `blocker_count > 0` clause alone (not via STALE). Built in an isolated temp
    vault so it cannot perturb the committed fixture assertions."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-8e-blk-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects" / "blk").mkdir(parents=True)
        (self.vault / "Projects" / "blk" / "issues").mkdir(parents=True)
        (self.vault / "research" / "wiki").mkdir(parents=True)
        (self.vault / "research" / "_meta.json").write_text('{"sources": {}}', "utf-8")
        # the initiative's own note (fresh).
        (self.vault / "Projects" / "blk" / "initiative.md").write_text(
            "---\ntype: initiative\nentity: initiative/blk\nstatus: active\n"
            "source: commit:BLK00001\nlast-verified: 2026-06-24\n---\n\n"
            "initiative with a blocked member.\n", "utf-8")
        # a fresh, OK (non-STALE) member project that carries a blocked issue.
        (self.vault / "Projects" / "blk" / "blocked-proj.md").write_text(
            "---\ntype: project\nentity: project/blk-blocked\n"
            "initiative: initiative/blk\nstatus: active\n"
            "last-verified: 2026-06-24\n---\n\nfresh project, has a blocked issue.\n",
            "utf-8")
        # an active issue under that project, blocked-by an unresolved issue.
        (self.vault / "Projects" / "blk" / "issues" / "a.md").write_text(
            "---\ntype: issue\nentity: project/blk-blocked/issue/a\n"
            "state: in-progress\nblocked-by: [project/blk-blocked/issue/b]\n"
            "status: reviewed\nlast-verified: 2026-06-24\n---\n\n"
            "blocked-by B (still in-progress -> unresolved).\n", "utf-8")
        # B: the reviewed in-progress head that A is blocked-by (UNRESOLVED).
        (self.vault / "Projects" / "blk" / "issues" / "b.md").write_text(
            "---\ntype: issue\nentity: project/blk-blocked/issue/b\n"
            "state: in-progress\nstatus: reviewed\nlast-verified: 2026-06-24\n---\n\n"
            "the unresolved blocker.\n", "utf-8")
        # a second, plain fresh member with no blockers (keeps the OK baseline real).
        (self.vault / "Projects" / "blk" / "clean-proj.md").write_text(
            "---\ntype: project\nentity: project/blk-clean\n"
            "initiative: initiative/blk\nstatus: active\n"
            "last-verified: 2026-06-23\n---\n\nfresh, no blockers.\n", "utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_blocker_alone_flips_initiative_to_at_risk(self) -> None:
        res = kb_meta.cmd_currency(str(self.vault), "research",
                                   today_str=TODAY.isoformat(), apply=False)
        it = res["initiative_status"]["initiative/blk"]
        members = {m["entity"]: m for m in it["members"]}
        self.assertEqual(set(members), {"project/blk-blocked", "project/blk-clean"})
        # NO member is STALE -- both project markers are OK.
        self.assertEqual(members["project/blk-blocked"]["marker"], currency.MARK_OK)
        self.assertEqual(members["project/blk-clean"]["marker"], currency.MARK_OK)
        # the blocked member carries a blocker; the clean one does not.
        self.assertGreater(members["project/blk-blocked"]["blocker_count"], 0)
        self.assertEqual(members["project/blk-clean"]["blocker_count"], 0)
        self.assertGreater(it["total_blockers"], 0)
        # health flips to at-risk via the blocker clause alone (no STALE present).
        self.assertEqual(it["health"], kb_meta.INITIATIVE_AT_RISK)


class NoInitiativesEmptyView(unittest.TestCase):
    """A vault with projects but NO initiatives produces an empty initiative_status
    and writes no _initiative-status.md (mirrors _project-status conditional)."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-8e-none-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects").mkdir(parents=True)
        (self.vault / "research" / "wiki").mkdir(parents=True)
        (self.vault / "research" / "_meta.json").write_text('{"sources": {}}', "utf-8")
        (self.vault / "Projects" / "solo.md").write_text(
            "---\ntype: project\nentity: project/solo\nstatus: active\n"
            "last-verified: 2026-06-24\n---\n\nno initiative link.\n", "utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_no_initiatives_empty_and_no_file(self) -> None:
        res = kb_meta.cmd_currency(str(self.vault), "research",
                                   today_str=TODAY.isoformat(), apply=True)
        self.assertEqual(res["initiative_status"], {})
        f = self.vault / "research" / "wiki" / kb_meta.INITIATIVE_STATUS_FILE
        self.assertFalse(f.exists(),
                         "no initiatives -> no _initiative-status.md (like _project-status)")


# --- Task 8 / PR 8F: cycles ------------------------------------------------
#
# 8F adds an additive pass (`kb_meta._pass6_cycle_status`) + a `_render_cycle_
# status` view + the `F_CYCLE` constant in currency.py. It groups every
# authoritative current-truth head carrying a `cycle:` id and reports each
# cycle's completion = done / (total - canceled): CANCELED issues are EXCLUDED
# from the denominator (Linear-sensible). The committed isolated scenario is
# fixtures/vault-work-os/Projects/cycle-board (cycle 2026-W26: 2 done, 1
# in-progress, 1 canceled). Drafts never move a cycle (quarantined in _pass1).

CYCLE = "2026-W26"
CYCLE_C1 = "project/cycle-board/issue/c1-done"            # done (reviewed)
CYCLE_C2 = "project/cycle-board/issue/c2-done"            # done (reviewed)
CYCLE_C3 = "project/cycle-board/issue/c3-in-progress"     # in-progress (reviewed)
CYCLE_C4 = "project/cycle-board/issue/c4-canceled"        # canceled (reviewed)


class CycleSchemaTest(unittest.TestCase):
    """The additive currency.py constant for 8F."""

    def test_cycle_field_name(self) -> None:
        self.assertEqual(currency.F_CYCLE, "cycle")

    def test_cycle_field_is_additive(self) -> None:
        # §0: additive only -- F_INITIATIVE (8E) and the work-axis fields stay.
        self.assertEqual(currency.F_INITIATIVE, "initiative")
        self.assertEqual(currency.F_STATE, "state")


class CycleAggregationFixture(unittest.TestCase):
    """The committed cycle-board issues all share cycle: 2026-W26 and aggregate
    into ONE cycle view with the correct completion rate (canceled excluded)."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-8f-"))
        self.vault = self.tmp / "vault"
        shutil.copytree(_FIXTURE, self.vault)
        (self.vault / "research" / "wiki").mkdir(parents=True)
        (self.vault / "research" / "_meta.json").write_text('{"sources": {}}', "utf-8")
        self.res = kb_meta.cmd_currency(str(self.vault), "research",
                                        today_str=TODAY.isoformat(), apply=False)
        self.cs = self.res["cycle_status"]

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_same_cycle_issues_aggregate_into_one_view(self) -> None:
        self.assertIn(CYCLE, self.cs)
        c = self.cs[CYCLE]
        entities = {i["entity"] for i in c["issues"]}
        self.assertEqual(entities, {CYCLE_C1, CYCLE_C2, CYCLE_C3, CYCLE_C4})
        self.assertEqual(c["total"], 4)

    def test_issues_are_deterministically_ordered_by_entity(self) -> None:
        ents = [i["entity"] for i in self.cs[CYCLE]["issues"]]
        self.assertEqual(ents, sorted(ents))

    def test_completion_rate_excludes_canceled_from_denominator(self) -> None:
        c = self.cs[CYCLE]
        # 2 done, 1 in-progress, 1 canceled -> done/(total-canceled) = 2/3.
        self.assertEqual(c["done_count"], 2)
        self.assertEqual(c["canceled_count"], 1)
        self.assertEqual(c["countable"], 3)
        self.assertEqual(c["active_count"], 1)
        self.assertAlmostEqual(c["completion"], 2 / 3)

    def test_canceled_issue_is_present_but_not_counted_as_done(self) -> None:
        c = self.cs[CYCLE]
        by_entity = {i["entity"]: i for i in c["issues"]}
        self.assertEqual(by_entity[CYCLE_C4]["work_state"], currency.STATE_CANCELED)
        # canceled is neither done (numerator) nor countable (denominator).
        self.assertNotIn(CYCLE_C4, {i["entity"] for i in c["issues"]
                                    if i["work_state"] == currency.STATE_DONE})

    def test_work_state_classification_uses_canonical_axis(self) -> None:
        by_entity = {i["entity"]: i for i in self.cs[CYCLE]["issues"]}
        self.assertEqual(by_entity[CYCLE_C1]["work_state"], currency.STATE_DONE)
        self.assertEqual(by_entity[CYCLE_C3]["work_state"], currency.STATE_IN_PROGRESS)

    def test_rendered_view_carries_completion_and_issues(self) -> None:
        md = self.res["cycle_status_md"]
        self.assertIn("# Cycle Status", md)
        self.assertIn(CYCLE, md)
        self.assertIn("completion: 67%", md)
        for ent in (CYCLE_C1, CYCLE_C2, CYCLE_C3, CYCLE_C4):
            self.assertIn(ent, md)
        # urgent in-progress issue surfaces a flag.
        self.assertIn("[URGENT]", md)

    def test_cycle_view_written_on_apply_absent_on_dry_run(self) -> None:
        f = self.vault / "research" / "wiki" / kb_meta.CYCLE_STATUS_FILE
        # dry-run (setUp ran apply=False) wrote nothing.
        self.assertFalse(f.exists(), "_cycle-status.md must be absent on dry-run")
        kb_meta.cmd_currency(str(self.vault), "research",
                             today_str=TODAY.isoformat(), apply=True)
        self.assertTrue(f.exists(), "_cycle-status.md must be written on apply")
        text = f.read_text("utf-8")
        for needle in (CYCLE, "completion: 67%", CYCLE_C1, CYCLE_C4):
            self.assertIn(needle, text)

    def test_applied_view_is_lf_only(self) -> None:
        kb_meta.cmd_currency(str(self.vault), "research",
                             today_str=TODAY.isoformat(), apply=True)
        disk = (self.vault / "research" / "wiki" /
                kb_meta.CYCLE_STATUS_FILE).read_bytes()
        self.assertNotIn(b"\r\n", disk, "derived view must be LF-only on disk")

    def test_source_bytes_unchanged_after_apply(self) -> None:
        rels = [
            "Projects/cycle-board/board.md",
            "Projects/cycle-board/issues/c1-done.md",
            "Projects/cycle-board/issues/c2-done.md",
            "Projects/cycle-board/issues/c3-in-progress.md",
            "Projects/cycle-board/issues/c4-canceled.md",
        ]
        before = {r: (self.vault / r).read_bytes() for r in rels}
        kb_meta.cmd_currency(str(self.vault), "research",
                             today_str=TODAY.isoformat(), apply=True)
        for r, b in before.items():
            self.assertEqual((self.vault / r).read_bytes(), b,
                             f"{r} source must be byte-identical")


class CycleDraftDoneDoesNotCount(unittest.TestCase):
    """A draft `state:done` capture for an entity that also has an authoritative
    in-progress head must NOT move the cycle's completion: the draft is
    quarantined in _pass1, so the in-progress head stays current-truth. Built in
    an isolated temp vault so it cannot perturb the committed fixture."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-8f-draft-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects" / "cyc").mkdir(parents=True)
        (self.vault / "00-Inbox" / "AI-Output").mkdir(parents=True)
        (self.vault / "research" / "wiki").mkdir(parents=True)
        (self.vault / "research" / "_meta.json").write_text('{"sources": {}}', "utf-8")
        # authoritative reviewed in-progress head, in cycle 2026-W30.
        (self.vault / "Projects" / "cyc" / "x.md").write_text(
            "---\ntype: issue\nentity: project/cyc/issue/x\nstate: in-progress\n"
            "cycle: 2026-W30\nstatus: reviewed\nlast-verified: 2026-06-24\n---\n\n"
            "authoritative in-progress head.\n", "utf-8")
        # a DRAFT capture claiming done for the same entity (base-head set).
        (self.vault / "00-Inbox" / "AI-Output" / "x-done-capture.md").write_text(
            "---\ntype: issue\nentity: project/cyc/issue/x\nstate: done\n"
            "cycle: 2026-W30\nstatus: draft\nbase-head: Projects/cyc/x.md\n"
            "last-verified: 2026-06-25\n---\n\ndraft state:done proposal.\n", "utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_draft_done_does_not_move_completion(self) -> None:
        cs = kb_meta.cmd_currency(str(self.vault), "research",
                                  today_str=TODAY.isoformat(),
                                  apply=False)["cycle_status"]
        c = cs["2026-W30"]
        # only the authoritative in-progress head is current-truth -> 0 done.
        self.assertEqual(c["total"], 1)
        self.assertEqual(c["done_count"], 0)
        self.assertEqual(c["countable"], 1)
        self.assertEqual(c["completion"], 0.0)
        self.assertEqual(c["issues"][0]["work_state"], currency.STATE_IN_PROGRESS)


class CycleAllCanceledNoDivByZero(unittest.TestCase):
    """A cycle whose only issue is canceled has countable == 0; completion is
    reported as 0.0 (no progress to measure), never a div-by-zero."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-8f-allcancel-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects").mkdir(parents=True)
        (self.vault / "research" / "wiki").mkdir(parents=True)
        (self.vault / "research" / "_meta.json").write_text('{"sources": {}}', "utf-8")
        (self.vault / "Projects" / "only.md").write_text(
            "---\ntype: issue\nentity: project/only/issue/dead\nstate: canceled\n"
            "cycle: 2026-W31\nstatus: reviewed\nlast-verified: 2026-06-24\n---\n\n"
            "the only issue in this cycle, and it is canceled.\n", "utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_all_canceled_completion_is_zero(self) -> None:
        cs = kb_meta.cmd_currency(str(self.vault), "research",
                                  today_str=TODAY.isoformat(),
                                  apply=False)["cycle_status"]
        c = cs["2026-W31"]
        self.assertEqual(c["total"], 1)
        self.assertEqual(c["canceled_count"], 1)
        self.assertEqual(c["countable"], 0)
        self.assertEqual(c["completion"], 0.0)


class NoCyclesEmptyView(unittest.TestCase):
    """A vault whose work items carry no cycle: yields an empty cycle_status and
    writes no _cycle-status.md (mirrors the _project-status conditional)."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-8f-none-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects").mkdir(parents=True)
        (self.vault / "research" / "wiki").mkdir(parents=True)
        (self.vault / "research" / "_meta.json").write_text('{"sources": {}}', "utf-8")
        (self.vault / "Projects" / "nocyc.md").write_text(
            "---\ntype: issue\nentity: project/nocyc/issue/x\nstate: todo\n"
            "status: reviewed\nlast-verified: 2026-06-24\n---\n\nno cycle field.\n",
            "utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_no_cycles_empty_and_no_file(self) -> None:
        res = kb_meta.cmd_currency(str(self.vault), "research",
                                   today_str=TODAY.isoformat(), apply=True)
        self.assertEqual(res["cycle_status"], {})
        f = self.vault / "research" / "wiki" / kb_meta.CYCLE_STATUS_FILE
        self.assertFalse(f.exists(),
                         "no cycles -> no _cycle-status.md (like _project-status)")


if __name__ == "__main__":
    unittest.main()
