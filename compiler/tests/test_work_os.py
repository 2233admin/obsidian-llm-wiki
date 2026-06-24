"""Task 8A state contract + Task 8P authoritative work update protocol.

8A (PR1) lands the state contract ONLY -- canonical states, legacy mapping,
priority/due validation, and the assignee (actor identity) resolver. No view is
touched there; that is PR5/8B.

8P (PR2, the spine) lands the write-side protocol (compiler/work_protocol.py):
two indexes (authoritative reviewed/legacy heads vs draft candidates) and
promote() -- base-head optimistic lock, materialize-at-write-time, dry-run
default, and the multi-head truth-conflict guard. The WorkProtocol* cases prove
the §3 green bar items 1/2/3 against fixtures/vault-work-os/.

Mirrors test_project_currency.py's unittest style + fixed-date convention.

Run from the compiler/ dir (this box is Windows -- prefix PYTHONUTF8=1):
    PYTHONUTF8=1 python -m unittest tests.test_work_os -v
"""

from __future__ import annotations

import dataclasses
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
import work_protocol  # noqa: E402

_FIXTURE = _COMPILER.parent / "fixtures" / "vault-work-os"

# note-ids of the fixture players (note-id = repo-relative path).
H1_ID = "Projects/iii-pivot/issues/db-migration.md"
C1_ID = "00-Inbox/AI-Output/db-migration-done-capture.md"
C2_ID = "00-Inbox/AI-Output/db-migration-canceled-capture.md"
ENTITY = "project/iii-pivot/issue/db-migration"

# Task 8C blocker-graph players (note-id = repo-relative path).
A_ID = "Projects/iii-pivot/issues/issue-a.md"
B_ID = "Projects/iii-pivot/issues/issue-b.md"
B_DONE_CAPTURE_ID = "00-Inbox/AI-Output/issue-b-done-capture.md"
SCHEMA_FREEZE_ID = "Projects/iii-pivot/issues/schema-freeze.md"
ENTITY_A = "project/iii-pivot/issue/issue-a"
ENTITY_B = "project/iii-pivot/issue/issue-b"
ENTITY_SCHEMA_FREEZE = "project/iii-pivot/issue/schema-freeze"

# Task 8D triage players (note-id = repo-relative path).
NO_ENTITY_CAPTURE_ID = "00-Inbox/AI-Output/loose-thought-capture.md"
CONSUMED_CAPTURE_ID = "00-Inbox/AI-Output/api-rename-done-capture.md"

# Fixed "today" so any due/overdue reasoning is deterministic (mirrors the
# TODAY constant in test_project_currency.py).
TODAY = date(2026, 6, 25)


def _cm(**fm):
    """Build a CurrencyMeta from raw frontmatter via the real normalize() path,
    so the work-state helpers are exercised through the same surface callers use."""
    return currency.normalize(fm)


class CanonicalStatesTest(unittest.TestCase):
    def test_canonical_set_is_exactly_five(self) -> None:
        self.assertEqual(
            currency.CANONICAL_STATES,
            frozenset({"backlog", "todo", "in-progress", "done", "canceled"}),
        )

    def test_blocked_is_not_a_canonical_state(self) -> None:
        # blocked is a derived effective_state (8C), never persisted.
        self.assertNotIn("blocked", currency.CANONICAL_STATES)
        self.assertNotIn(currency.STATE_BLOCKED, currency.CANONICAL_STATES)

    def test_each_canonical_state_passes_through(self) -> None:
        for s in ("backlog", "todo", "in-progress", "done", "canceled"):
            self.assertEqual(currency.work_state(_cm(state=s)), s)

    def test_canonical_state_case_and_whitespace_insensitive(self) -> None:
        self.assertEqual(currency.work_state(_cm(state="  In-Progress  ")), "in-progress")
        self.assertEqual(currency.work_state(_cm(state="DONE")), "done")

    def test_missing_state_defaults_to_backlog(self) -> None:
        self.assertEqual(currency.work_state(_cm()), currency.STATE_BACKLOG)
        self.assertEqual(currency.work_state(_cm(state="garbage-word")), currency.STATE_BACKLOG)


class LegacyStateMappingTest(unittest.TestCase):
    """§1 back-compat: legacy status/state words -> canonical states."""

    def test_open_maps_to_todo(self) -> None:
        self.assertEqual(currency.work_state(_cm(status="open")), "todo")

    def test_in_progress_phrase_maps(self) -> None:
        self.assertEqual(currency.work_state(_cm(status="in progress")), "in-progress")

    def test_done_and_completed_map_to_done(self) -> None:
        self.assertEqual(currency.work_state(_cm(status="done")), "done")
        self.assertEqual(currency.work_state(_cm(status="completed")), "done")

    def test_legacy_closed_maps_to_done(self) -> None:
        # parity with the Task 7 ACTION_DONE_STATUSES `closed` word: a legacy
        # action note using `status: closed` must still classify as done.
        self.assertEqual(currency.work_state(_cm(status="closed")), "done")

    def test_canceled_and_archived_map_to_canceled(self) -> None:
        self.assertEqual(currency.work_state(_cm(status="canceled")), "canceled")
        self.assertEqual(currency.work_state(_cm(status="cancelled")), "canceled")
        self.assertEqual(currency.work_state(_cm(status="archived")), "canceled")

    def test_project_lifecycle_words_map(self) -> None:
        self.assertEqual(currency.work_state(_cm(status="active")), "in-progress")
        self.assertEqual(currency.work_state(_cm(status="paused")), "todo")
        self.assertEqual(currency.work_state(_cm(status="planned")), "backlog")

    def test_explicit_state_beats_legacy_status(self) -> None:
        # both axes present: the explicit `state` field wins over legacy `status`.
        self.assertEqual(currency.work_state(_cm(state="done", status="open")), "done")

    def test_review_status_word_is_not_a_state_signal(self) -> None:
        # a pure review-axis status (draft/reviewed) carries no work-state signal
        # -> falls back to default backlog rather than mis-mapping.
        self.assertEqual(currency.work_state(_cm(status="draft")), "backlog")
        self.assertEqual(currency.work_state(_cm(status="reviewed")), "backlog")


class LegacyBlockedTest(unittest.TestCase):
    """§1: legacy `status: blocked` -> canonical in-progress + legacy_blocked flag,
    so old notes need no edit; new notes must use blocked-by for real blocking."""

    def test_legacy_blocked_canonicalizes_to_in_progress(self) -> None:
        cm = _cm(status="blocked")
        self.assertEqual(currency.work_state(cm), "in-progress")
        self.assertTrue(currency.legacy_blocked(cm))

    def test_state_blocked_word_also_flagged(self) -> None:
        cm = _cm(state="blocked")
        self.assertEqual(currency.work_state(cm), "in-progress")
        self.assertTrue(currency.legacy_blocked(cm))

    def test_non_blocked_note_is_not_flagged(self) -> None:
        self.assertFalse(currency.legacy_blocked(_cm(state="in-progress")))
        self.assertFalse(currency.legacy_blocked(_cm(status="open")))
        self.assertFalse(currency.legacy_blocked(_cm()))

    def test_explicit_canonical_state_overrides_legacy_blocked_status(self) -> None:
        # a note that declares a real canonical state is not "legacy blocked"
        # even if a stray legacy status word lingers.
        cm = _cm(state="done", status="blocked")
        self.assertEqual(currency.work_state(cm), "done")
        self.assertFalse(currency.legacy_blocked(cm))


class PriorityValidationTest(unittest.TestCase):
    def test_priority_rank_table(self) -> None:
        self.assertEqual(
            currency.PRIORITY_RANK, {1: 0, 2: 1, 3: 2, 4: 3, 0: 4, None: 4}
        )

    def test_work_priority_parses_ints_and_strings(self) -> None:
        self.assertEqual(currency.work_priority(_cm(priority=1)), 1)
        self.assertEqual(currency.work_priority(_cm(priority="3")), 3)

    def test_work_priority_rejects_out_of_range_and_garbage(self) -> None:
        self.assertIsNone(currency.work_priority(_cm(priority=9)))
        self.assertIsNone(currency.work_priority(_cm(priority="high")))
        self.assertIsNone(currency.work_priority(_cm()))

    def test_priority_rank_orders_urgent_first_none_last(self) -> None:
        self.assertEqual(currency.priority_rank(_cm(priority=1)), 0)
        self.assertEqual(currency.priority_rank(_cm(priority=2)), 1)
        self.assertEqual(currency.priority_rank(_cm(priority=0)), 4)
        # missing priority ranks alongside none (last).
        self.assertEqual(currency.priority_rank(_cm()), 4)


class IsUrgentStrictnessTest(unittest.TestCase):
    """§3 P0 #5 / 8B: urgent IFF priority == 1, STRICTLY (never <= 1)."""

    def test_priority_one_is_urgent(self) -> None:
        self.assertTrue(currency.is_urgent(_cm(priority=1)))
        self.assertTrue(currency.is_urgent(_cm(priority="1")))

    def test_priority_zero_is_not_urgent(self) -> None:
        # the trap: 0 (none) must NOT be urgent -- a `<= 1` impl would fail here.
        self.assertFalse(currency.is_urgent(_cm(priority=0)))

    def test_other_priorities_not_urgent(self) -> None:
        for p in (2, 3, 4):
            self.assertFalse(currency.is_urgent(_cm(priority=p)))

    def test_missing_priority_not_urgent(self) -> None:
        self.assertFalse(currency.is_urgent(_cm()))


class DueValidationTest(unittest.TestCase):
    def test_parse_due_reads_iso_date(self) -> None:
        self.assertEqual(currency.parse_due(_cm(due="2026-06-30")), date(2026, 6, 30))

    def test_parse_due_none_on_missing_or_garbage(self) -> None:
        self.assertIsNone(currency.parse_due(_cm()))
        self.assertIsNone(currency.parse_due(_cm(due="not-a-date")))

    def test_due_compares_against_fixed_today(self) -> None:
        # due in the past relative to the fixed TODAY -- the overdue *decision*
        # lives in 8B, but the state contract must parse the date deterministically.
        self.assertLess(currency.parse_due(_cm(due="2026-06-20")), TODAY)
        self.assertGreater(currency.parse_due(_cm(due="2026-06-30")), TODAY)


class AssigneeResolverTest(unittest.TestCase):
    """§1: assignee precedence = explicit > owner alias > writer-actors map of
    generated-by > UNASSIGNED. NEVER derives assignee from generated-by directly."""

    CONFIG = {"writer-actors": {"au-90-opus": "agent/opus", "us-01-codex": "agent/codex"}}

    def test_explicit_assignee_wins(self) -> None:
        cm = _cm(assignee="agent/opus", owner="someone-else", **{"generated-by": "au-90-opus"})
        self.assertEqual(currency.resolve_assignee(cm, self.CONFIG), "agent/opus")

    def test_owner_alias_used_when_no_assignee(self) -> None:
        cm = _cm(owner="user/xue")
        self.assertEqual(currency.resolve_assignee(cm, self.CONFIG), "user/xue")

    def test_writer_actors_map_applied_to_generated_by(self) -> None:
        cm = _cm(**{"generated-by": "au-90-opus"})
        self.assertEqual(currency.resolve_assignee(cm, self.CONFIG), "agent/opus")
        cm2 = _cm(**{"generated-by": "us-01-codex"})
        self.assertEqual(currency.resolve_assignee(cm2, self.CONFIG), "agent/codex")

    def test_never_derives_assignee_from_unmapped_generated_by(self) -> None:
        # generated-by NOT in the writer-actors map -> must NOT leak as assignee.
        cm = _cm(**{"generated-by": "au-99-unknown"})
        self.assertEqual(currency.resolve_assignee(cm, self.CONFIG), currency.UNASSIGNED)

    def test_generated_by_ignored_without_config_map(self) -> None:
        cm = _cm(**{"generated-by": "au-90-opus"})
        self.assertEqual(currency.resolve_assignee(cm), currency.UNASSIGNED)
        self.assertEqual(currency.resolve_assignee(cm, {}), currency.UNASSIGNED)

    def test_unassigned_when_nothing_present(self) -> None:
        self.assertEqual(currency.resolve_assignee(_cm(), self.CONFIG), currency.UNASSIGNED)

    def test_assignee_warning_on_conflict(self) -> None:
        cm = _cm(assignee="agent/opus", owner="agent/codex")
        warn = currency.assignee_warning(cm)
        self.assertIsNotNone(warn)
        self.assertIn("agent/opus", warn)
        self.assertIn("agent/codex", warn)
        # resolution still deterministic: assignee wins despite the conflict.
        self.assertEqual(currency.resolve_assignee(cm, self.CONFIG), "agent/opus")

    def test_no_warning_when_assignee_owner_agree_or_absent(self) -> None:
        self.assertIsNone(currency.assignee_warning(_cm(assignee="agent/opus", owner="agent/opus")))
        self.assertIsNone(currency.assignee_warning(_cm(assignee="agent/opus")))
        self.assertIsNone(currency.assignee_warning(_cm(owner="agent/opus")))
        self.assertIsNone(currency.assignee_warning(_cm()))


# --- Task 8P: authoritative work update protocol --------------------------


def _note(notes, note_id):
    for n in notes:
        if n.note_id == note_id:
            return n
    raise AssertionError(f"note {note_id!r} not found in scan")


class WorkIndexTest(unittest.TestCase):
    """The two indexes: is_authoritative_work_note / is_candidate_work_note.
    reviewed -> authoritative; draft -> candidate; legacy work note (no review
    status) -> authoritative (Task 7 behaviour)."""

    def test_reviewed_is_authoritative(self) -> None:
        self.assertTrue(work_protocol.is_authoritative_work_note({"status": "reviewed"}))
        self.assertFalse(work_protocol.is_candidate_work_note({"status": "reviewed"}))

    def test_draft_is_candidate_not_authoritative(self) -> None:
        self.assertFalse(work_protocol.is_authoritative_work_note({"status": "draft"}))
        self.assertTrue(work_protocol.is_candidate_work_note({"status": "draft"}))

    def test_legacy_work_note_is_authoritative(self) -> None:
        # old open/done/active notes (no draft/reviewed review-status) stay heads.
        for legacy in ("open", "active", "done", "blocked", None):
            cm = {"status": legacy} if legacy else {"state": "in-progress"}
            self.assertTrue(work_protocol.is_authoritative_work_note(cm), legacy)
            self.assertFalse(work_protocol.is_candidate_work_note(cm), legacy)


class WorkProtocolFixtureBase(unittest.TestCase):
    """Copies fixtures/vault-work-os into a temp dir so apply=True writes never
    touch the committed fixture (mirrors test_project_currency.py's copytree)."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-work-os-8p-"))
        self.vault = self.tmp / "vault"
        shutil.copytree(_FIXTURE, self.vault)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _scan(self):
        return work_protocol.scan_work_notes(str(self.vault))

    def _read_bytes(self, note_id):
        return (self.vault / note_id).read_bytes()


class WorkProtocolGreenBar1(WorkProtocolFixtureBase):
    """§3 #1: a draft state:done capture is NOT in the authoritative index and
    does not move open/closed counts -- it is a candidate proposal, not a head."""

    def test_draft_capture_not_authoritative(self) -> None:
        notes = self._scan()
        c1 = _note(notes, C1_ID)
        self.assertEqual(currency.work_state(c1.cm), "done")  # it DOES propose done
        self.assertFalse(c1.is_authoritative)                 # ...but is not a head
        self.assertTrue(c1.is_candidate)

    def test_head_resolution_ignores_draft_done(self) -> None:
        # the authoritative head stays H1 (in-progress); the draft done is unseen.
        res = work_protocol.resolve_head(self._scan(), ENTITY)
        self.assertEqual(res.head.note_id, H1_ID)
        self.assertEqual(currency.work_state(res.head.cm), "in-progress")

    def test_effective_state_is_head_not_draft(self) -> None:
        # the "closed count" the project view would read comes from effective
        # state = head state = in-progress, so the draft done changes nothing.
        eff = work_protocol.effective_state(self._scan(), ENTITY)
        self.assertEqual(eff["state"], "in-progress")
        self.assertEqual(eff["marker"], "")


class WorkProtocolGreenBar2(WorkProtocolFixtureBase):
    """§3 #2: promote(C1) materializes a complete H2 that INHERITS the sparse
    fields from H1, stamped reviewed + supersedes(H1) + promotes(C1). dry-run
    writes nothing; apply writes H2 and leaves H1 + C1 byte-identical."""

    def _promote_c1(self, apply):
        c1 = _note(self._scan(), C1_ID)
        return work_protocol.promote(str(self.vault), c1, apply=apply,
                                     promoted_by="user/xue")

    def test_dry_run_materializes_but_writes_nothing(self) -> None:
        before = sorted(p.relative_to(self.vault).as_posix()
                        for p in self.vault.rglob("*.md"))
        res = self._promote_c1(apply=False)
        self.assertEqual(res.outcome, work_protocol.OUTCOME_MATERIALIZED)
        self.assertIsNone(res.written)
        self.assertIsNotNone(res.snapshot_text)
        after = sorted(p.relative_to(self.vault).as_posix()
                       for p in self.vault.rglob("*.md"))
        self.assertEqual(before, after, "dry-run must write NO file")

    def test_snapshot_inherits_sparse_fields_from_head(self) -> None:
        res = self._promote_c1(apply=False)
        f = res.fields
        # candidate explicitly set ONLY state:done -> that wins.
        self.assertEqual(f["state"], "done")
        # everything else INHERITS from H1 (the sparse-capture guarantee).
        self.assertEqual(f["assignee"], "agent/opus")
        self.assertEqual(str(f["priority"]), "1")
        self.assertEqual(str(f["estimate"]), "3")
        self.assertEqual(f["blocked-by"], ["project/iii-pivot/issue/schema-freeze"])

    def test_snapshot_stamps_review_provenance(self) -> None:
        text = self._promote_c1(apply=False).snapshot_text
        self.assertIn("status: reviewed", text)
        self.assertIn(f"supersedes: {H1_ID}", text)
        self.assertIn(f"promotes: {C1_ID}", text)
        self.assertIn("promoted-by: user/xue", text)
        # generated-by carried from the candidate (provenance != promoter).
        self.assertIn("generated-by: au-90-opus", text)
        # the materialized snapshot is itself complete truth (no read-time inherit).
        self.assertIn("assignee: agent/opus", text)
        self.assertIn("blocked-by: [project/iii-pivot/issue/schema-freeze]", text)

    def test_apply_writes_h2_and_leaves_h1_c1_byte_identical(self) -> None:
        h1_before = self._read_bytes(H1_ID)
        c1_before = self._read_bytes(C1_ID)
        res = self._promote_c1(apply=True)
        self.assertEqual(res.outcome, work_protocol.OUTCOME_MATERIALIZED)
        self.assertIsNotNone(res.written)
        h2 = Path(res.written)
        self.assertTrue(h2.exists(), "apply=True must write H2")
        # append-only: H1 and C1 are never edited or deleted.
        self.assertEqual(self._read_bytes(H1_ID), h1_before, "H1 must be byte-identical")
        self.assertEqual(self._read_bytes(C1_ID), c1_before, "C1 must be byte-identical")
        self.assertTrue((self.vault / H1_ID).exists())
        self.assertTrue((self.vault / C1_ID).exists())

    def test_after_promote_head_is_h2_done(self) -> None:
        res = self._promote_c1(apply=True)
        h2_id = Path(res.written).relative_to(self.vault).as_posix()
        # the new authoritative head is H2, now state:done (the count would tick).
        head = work_protocol.resolve_head(self._scan(), ENTITY)
        self.assertEqual(head.head.note_id, h2_id)
        self.assertEqual(currency.work_state(head.head.cm), "done")


class WorkProtocolGreenBar3(WorkProtocolFixtureBase):
    """§3 #3: after H2 exists, promote(C2) (base-head still H1) returns
    HEAD_MISMATCH and writes nothing -- never silent last-write-wins."""

    def test_second_capture_same_base_head_is_head_mismatch(self) -> None:
        # commit C1 -> H2 first.
        c1 = _note(self._scan(), C1_ID)
        work_protocol.promote(str(self.vault), c1, apply=True, promoted_by="user/xue")
        # now C2 still points base-head=H1, but the head moved to H2.
        before = sorted(p.relative_to(self.vault).as_posix()
                        for p in self.vault.rglob("*.md"))
        c2 = _note(self._scan(), C2_ID)
        res = work_protocol.promote(str(self.vault), c2, apply=True,
                                    promoted_by="user/xue")
        self.assertEqual(res.outcome, work_protocol.OUTCOME_HEAD_MISMATCH)
        self.assertIsNone(res.written)
        after = sorted(p.relative_to(self.vault).as_posix()
                       for p in self.vault.rglob("*.md"))
        self.assertEqual(before, after, "HEAD_MISMATCH must write NO file")

    def test_head_mismatch_does_not_overwrite_h2(self) -> None:
        c1 = _note(self._scan(), C1_ID)
        r1 = work_protocol.promote(str(self.vault), c1, apply=True, promoted_by="user/xue")
        h2_bytes = Path(r1.written).read_bytes()
        c2 = _note(self._scan(), C2_ID)
        work_protocol.promote(str(self.vault), c2, apply=True, promoted_by="user/xue")
        self.assertEqual(Path(r1.written).read_bytes(), h2_bytes,
                         "the conflicting promote must not touch H2")


class WorkProtocolMultiHeadGuard(WorkProtocolFixtureBase):
    """§2 concurrency fallback: two reviewed terminal heads for one entity ->
    CURRENT-TRUTH-CONFLICT, no timestamp winner, neither branch silently closes
    the issue (effective state falls back to the last common ancestor)."""

    def _forge_two_reviewed_heads(self):
        # promote C1 -> H2(done). Then hand-write a SECOND reviewed head H3 that
        # also supersedes H1 (canceled) -- two reviewed terminals off the same H1.
        c1 = _note(self._scan(), C1_ID)
        r = work_protocol.promote(str(self.vault), c1, apply=True, promoted_by="user/xue")
        h2_id = Path(r.written).relative_to(self.vault).as_posix()
        h3 = self.vault / "Projects/iii-pivot/issues/db-migration.reviewed.99.md"
        h3.write_text(
            "---\ntype: issue\nentity: project/iii-pivot/issue/db-migration\n"
            "state: canceled\nstatus: reviewed\nsupersedes: " + H1_ID + "\n"
            "last-verified: 2026-06-26\n---\n\nrival reviewed head H3.\n", "utf-8")
        return h2_id

    def test_two_reviewed_terminal_heads_flag_truth_conflict(self) -> None:
        self._forge_two_reviewed_heads()
        res = work_protocol.resolve_head(self._scan(), ENTITY)
        self.assertTrue(res.truth_conflict)
        self.assertGreaterEqual(len(res.conflict_note_ids), 2)

    def test_effective_state_marks_conflict_and_does_not_close(self) -> None:
        self._forge_two_reviewed_heads()
        eff = work_protocol.effective_state(self._scan(), ENTITY)
        self.assertIn(work_protocol.TRUTH_CONFLICT, eff["marker"])
        # neither branch silently wins -> not auto-closed to done/canceled; falls
        # back to the last unambiguous ancestor H1 (in-progress).
        self.assertEqual(eff["state"], "in-progress")
        self.assertNotIn(eff["state"], ("done", "canceled"))

    def test_conflict_fallback_reads_ancestor_state_not_a_constant(self) -> None:
        # Lock in that the truth-conflict fallback reads the LAST-COMMON-ANCESTOR's
        # actual state, not a hardcoded 'in-progress'. Build a fresh entity whose
        # ancestor H0 is `todo`, with two reviewed terminal heads (done + canceled)
        # both superseding H0; the fallback must return the ancestor state `todo`.
        base = self.vault / "Projects/iii-pivot/issues"
        ent = "project/iii-pivot/issue/anc-state"
        (base / "anc-state.md").write_text(
            "---\ntype: issue\nentity: " + ent + "\nstate: todo\n"
            "status: reviewed\nlast-verified: 2026-06-20\n---\n\nH0 ancestor (todo).\n",
            "utf-8")
        h0_id = "Projects/iii-pivot/issues/anc-state.md"
        (base / "anc-state.reviewed.1.md").write_text(
            "---\ntype: issue\nentity: " + ent + "\nstate: done\n"
            "status: reviewed\nsupersedes: " + h0_id + "\n"
            "last-verified: 2026-06-25\n---\n\nrival head done.\n", "utf-8")
        (base / "anc-state.reviewed.2.md").write_text(
            "---\ntype: issue\nentity: " + ent + "\nstate: canceled\n"
            "status: reviewed\nsupersedes: " + h0_id + "\n"
            "last-verified: 2026-06-26\n---\n\nrival head canceled.\n", "utf-8")
        eff = work_protocol.effective_state(self._scan(), ent)
        self.assertIn(work_protocol.TRUTH_CONFLICT, eff["marker"])
        # the fallback is the ANCESTOR's exact state (todo), not a constant.
        self.assertEqual(eff["state"], "todo")
        self.assertEqual(eff["head_note_id"], h0_id)


class WorkProtocolNewEntity(WorkProtocolFixtureBase):
    """§2: when no head exists for the entity (new), promote materializes a fresh
    snapshot with NO supersedes (and uses the new-entity default for unset
    fields)."""

    def test_new_entity_materializes_without_supersedes(self) -> None:
        cap = self.vault / "00-Inbox/AI-Output/new-issue-capture.md"
        cap.write_text(
            "---\ntype: issue\nentity: project/iii-pivot/issue/brand-new\n"
            "state: todo\nassignee: agent/codex\nstatus: draft\n"
            "generated-by: us-01-codex\n---\n\nbrand new issue, no prior head.\n",
            "utf-8")
        cand = _note(self._scan(), "00-Inbox/AI-Output/new-issue-capture.md")
        res = work_protocol.promote(str(self.vault), cand, apply=False)
        self.assertEqual(res.outcome, work_protocol.OUTCOME_MATERIALIZED)
        self.assertIsNone(res.head_note_id)
        self.assertNotIn("supersedes:", res.snapshot_text)
        self.assertIn("promotes: 00-Inbox/AI-Output/new-issue-capture.md", res.snapshot_text)
        self.assertIn("state: todo", res.snapshot_text)
        self.assertIn("assignee: agent/codex", res.snapshot_text)


class WorkProtocolNonDraftRejected(WorkProtocolFixtureBase):
    """A reviewed head is not a candidate -- promoting it returns NOT_DRAFT and
    writes nothing (only draft captures promote)."""

    def test_promoting_a_reviewed_head_is_not_draft(self) -> None:
        h1 = _note(self._scan(), H1_ID)
        res = work_protocol.promote(str(self.vault), h1, apply=True)
        self.assertEqual(res.outcome, work_protocol.OUTCOME_NOT_DRAFT)
        self.assertIsNone(res.written)


# --- §3 #1/#3: end-to-end through the LIVE kb_meta project-status pass --------


class LiveProjectStatusDraftExclusion(unittest.TestCase):
    """§3 #1 enforced in PRODUCTION, not via a self-contained proxy: the real
    read path is kb_meta.cmd_currency -> _pass1_supersession -> _pass4_project_
    status (the pass that emits closed_count). This builds a project vault with a
    reviewed in-progress head plus a draft state:done capture for the SAME action
    entity, runs the real pass, and asserts the count-producing code -- not just
    work_protocol.effective_state -- treats the reviewed head as current-truth and
    keeps closed_count at 0 until an actual promote."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-work-os-live-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects" / "p" / "actions").mkdir(parents=True)
        (self.vault / "00-Inbox" / "AI-Output").mkdir(parents=True)
        (self.vault / "research" / "wiki").mkdir(parents=True)
        (self.vault / "research" / "_meta.json").write_text(
            '{"sources": {}}', "utf-8")
        (self.vault / "Projects" / "p.md").write_text(
            "---\ntype: project\nentity: project/p\nstatus: active\n"
            "last-verified: 2026-06-20\n---\n\nproject p.\n", "utf-8")
        # H1: reviewed, in-progress authoritative head for the action.
        (self.vault / "Projects" / "p" / "actions" / "mig.md").write_text(
            "---\ntype: issue\nentity: project/p/action/mig\nstate: in-progress\n"
            "status: reviewed\nlast-verified: 2026-06-20\n---\n\nH1 head.\n", "utf-8")
        # a draft capture proposing done (state axis) -- a candidate, not a head.
        (self.vault / "00-Inbox" / "AI-Output" / "mig-done.md").write_text(
            "---\ntype: issue\nentity: project/p/action/mig\nstate: done\n"
            "status: draft\nbase-head: Projects/p/actions/mig.md\n"
            "generated-by: au-90-opus\nlast-verified: 2026-06-25\n---\n\n"
            "draft done capture.\n", "utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self):
        return kb_meta.cmd_currency(str(self.vault), "research",
                                    today_str=TODAY.isoformat(), apply=False)

    def test_draft_done_does_not_win_current_truth_or_move_closed_count(self) -> None:
        res = self._run()
        # current-truth of the action is the REVIEWED head, never the draft.
        self.assertEqual(res["current_truth"]["project/p/action/mig"],
                         "Projects/p/actions/mig.md")
        ps = res["project_status"]["project/p"]
        # the draft state:done did NOT move the closed counter.
        self.assertEqual(ps["closed_count"], 0)
        # the action is still OPEN, not closed.
        opens = {a["entity"] for a in ps["open_actions"]}
        self.assertIn("project/p/action/mig", opens)

    def test_status_done_draft_also_excluded_from_count(self) -> None:
        # the OTHER axis-confusion: a draft that says done via the legacy work
        # word `status: done` must ALSO be quarantined (it is still status:draft
        # on the review axis -> a candidate), so it cannot bump closed_count.
        (self.vault / "00-Inbox" / "AI-Output" / "mig-done2.md").write_text(
            "---\ntype: issue\nentity: project/p/action/mig\nstatus: draft\n"
            "state: done\nbase-head: Projects/p/actions/mig.md\n"
            "last-verified: 2026-06-26\n---\n\nanother draft done.\n", "utf-8")
        res = self._run()
        self.assertEqual(res["current_truth"]["project/p/action/mig"],
                         "Projects/p/actions/mig.md")
        self.assertEqual(res["project_status"]["project/p"]["closed_count"], 0)

    def test_promote_then_live_pass_ticks_closed_count(self) -> None:
        # before: closed_count 0; after a real promote the reviewed head is done.
        self.assertEqual(self._run()["project_status"]["project/p"]["closed_count"], 0)
        cand = _note(work_protocol.scan_work_notes(str(self.vault)),
                     "00-Inbox/AI-Output/mig-done.md")
        r = work_protocol.promote(str(self.vault), cand, apply=True,
                                  promoted_by="user/xue", today=TODAY.isoformat())
        self.assertEqual(r.outcome, work_protocol.OUTCOME_MATERIALIZED)
        after = self._run()
        ps = after["project_status"]["project/p"]
        self.assertEqual(ps["closed_count"], 1)
        # current-truth is now the reviewed promoted snapshot (done), not the draft.
        h2_id = Path(r.written).relative_to(self.vault).as_posix()
        self.assertEqual(after["current_truth"]["project/p/action/mig"], h2_id)

    def test_legacy_only_draft_knowledge_note_is_unaffected(self) -> None:
        # §0 #8 guard: an entity whose ONLY note is a draft (a never-reviewed
        # knowledge note, not a work head) stays current-truth -- the quarantine
        # only drops drafts when an authoritative sibling exists.
        (self.vault / "research" / "wiki" / "k.md").write_text(
            "---\ntype: note\nentity: thing/k\nstatus: draft\n"
            "last-verified: 2026-06-24\n---\n\nlone draft knowledge note.\n", "utf-8")
        res = self._run()
        self.assertEqual(res["current_truth"]["thing/k"], "research/wiki/k.md")


# --- §3 #4/#5/#6/#7: protocol hardening regressions --------------------------


class WorkProtocolBaseHeadEntityRejected(WorkProtocolFixtureBase):
    """Invariant (b): base-head references a note-id (repo-relative path), NEVER
    an entity. A draft whose base-head is the ENTITY string must NOT satisfy the
    optimistic lock (it previously leaked through the bare-stem matcher)."""

    def test_entity_shaped_base_head_is_head_mismatch(self) -> None:
        c1 = _note(self._scan(), C1_ID)
        # forge base-head = the ENTITY (not the note-id) for the same head.
        forged = dataclasses.replace(
            c1, raw=dict(c1.raw, **{work_protocol.F_BASE_HEAD: ENTITY}))
        res = work_protocol.promote(str(self.vault), forged, apply=False)
        self.assertEqual(res.outcome, work_protocol.OUTCOME_HEAD_MISMATCH)
        self.assertIsNone(res.written)

    def test_real_note_id_base_head_still_materializes(self) -> None:
        # control: the genuine note-id base-head must still pass the lock.
        c1 = _note(self._scan(), C1_ID)
        res = work_protocol.promote(str(self.vault), c1, apply=False)
        self.assertEqual(res.outcome, work_protocol.OUTCOME_MATERIALIZED)


class WorkProtocolSnapshotBytesDeterministic(WorkProtocolFixtureBase):
    """Invariant (d)/(f): the applied snapshot is byte-identical to the render and
    OS-independent (LF-only, no Windows CRLF translation), and last-verified is
    injectable so the whole snapshot can be byte-asserted deterministically."""

    def test_applied_file_is_lf_only_and_matches_render(self) -> None:
        c1 = _note(self._scan(), C1_ID)
        res = work_protocol.promote(str(self.vault), c1, apply=True,
                                    promoted_by="user/xue", today="2026-06-25")
        disk = Path(res.written).read_bytes()
        self.assertNotIn(b"\r\n", disk, "snapshot must be LF-only on disk")
        self.assertEqual(disk, res.snapshot_text.encode("utf-8"),
                         "on-disk bytes must equal the rendered snapshot")

    def test_pinned_today_makes_last_verified_deterministic(self) -> None:
        c1 = _note(self._scan(), C1_ID)
        a = work_protocol.promote(str(self.vault), c1, apply=False,
                                  promoted_by="user/xue", today="2026-06-25")
        self.assertIn("last-verified: 2026-06-25", a.snapshot_text)
        # a different pin produces a different, deterministic stamp.
        b = work_protocol.promote(str(self.vault), c1, apply=False,
                                  promoted_by="user/xue", today="2026-07-01")
        self.assertIn("last-verified: 2026-07-01", b.snapshot_text)


class WorkProtocolDraftSupersedesIgnored(WorkProtocolFixtureBase):
    """Invariant (c): a draft candidate never gets a supersedes field (only
    base-head). A draft that ILLEGALLY carries `supersedes:` must still be a
    candidate, and its forged value must never leak into the materialized
    snapshot -- the snapshot's only supersedes is the resolved head note-id."""

    def test_forged_supersedes_on_draft_does_not_leak(self) -> None:
        c1 = _note(self._scan(), C1_ID)
        forged = dataclasses.replace(
            c1, raw=dict(c1.raw, **{work_protocol.F_SUPERSEDES: "some/forged/note.md"}))
        # (a) the draft is still a candidate (forged supersedes does not promote it).
        self.assertTrue(forged.is_candidate)
        self.assertFalse(forged.is_authoritative)
        res = work_protocol.promote(str(self.vault), forged, apply=False,
                                    promoted_by="user/xue", today="2026-06-25")
        self.assertEqual(res.outcome, work_protocol.OUTCOME_MATERIALIZED)
        text = res.snapshot_text
        # (b) the ONLY supersedes in the snapshot is the resolved head H1.
        self.assertIn(f"supersedes: {H1_ID}", text)
        self.assertNotIn("some/forged/note.md", text)
        self.assertEqual(text.count("supersedes:"), 1)

    def test_resolve_head_ignores_draft_supersedes(self) -> None:
        # resolve_head must never treat a draft's supersedes as authoritative
        # supersession: forging supersedes onto the draft must not move the head.
        c1 = _note(self._scan(), C1_ID)
        forged = dataclasses.replace(
            c1, raw=dict(c1.raw, **{work_protocol.F_SUPERSEDES: H1_ID}))
        notes = [n for n in self._scan() if n.note_id != C1_ID] + [forged]
        res = work_protocol.resolve_head(notes, ENTITY)
        # H1 is still the head; the draft (even carrying supersedes:H1) is excluded.
        self.assertEqual(res.head.note_id, H1_ID)


# --- Task 8C: relations + blocker graph (PR4) --------------------------------


class BlockerStatusBranches(WorkProtocolFixtureBase):
    """blocker_status(target, index): every verdict branch (§2 8C). Only a
    reviewed-promoted done head RESOLVES; canceled is NOT satisfaction; a missing
    target is BROKEN_REF; a multi-head target is TRUTH_CONFLICT; an active head
    is UNRESOLVED."""

    def test_resolved_when_target_head_is_reviewed_done(self) -> None:
        # schema-freeze is a reviewed state:done head -> RESOLVED.
        notes = self._scan()
        self.assertEqual(
            work_protocol.blocker_status(ENTITY_SCHEMA_FREEZE, notes),
            work_protocol.BLOCKER_RESOLVED,
        )

    def test_unresolved_when_target_head_is_active(self) -> None:
        # B is reviewed but still in-progress -> UNRESOLVED.
        notes = self._scan()
        self.assertEqual(
            work_protocol.blocker_status(ENTITY_B, notes),
            work_protocol.BLOCKER_UNRESOLVED,
        )

    def test_broken_ref_when_target_entity_has_no_head(self) -> None:
        notes = self._scan()
        self.assertEqual(
            work_protocol.blocker_status("project/iii-pivot/issue/ghost", notes),
            work_protocol.BLOCKER_BROKEN_REF,
        )

    def test_canceled_dependency_is_not_satisfaction(self) -> None:
        # hand-write a reviewed CANCELED head for a fresh target entity.
        canceled = self.vault / "Projects/iii-pivot/issues/dropped.md"
        canceled.write_text(
            "---\ntype: issue\nentity: project/iii-pivot/issue/dropped\n"
            "state: canceled\nstatus: reviewed\nlast-verified: 2026-06-23\n---\n"
            "\na canceled dependency.\n", "utf-8")
        notes = self._scan()
        self.assertEqual(
            work_protocol.blocker_status("project/iii-pivot/issue/dropped", notes),
            work_protocol.BLOCKER_CANCELED_DEPENDENCY,
        )

    def test_truth_conflict_when_target_has_two_reviewed_heads(self) -> None:
        # forge two reviewed terminal heads off db-migration's H1 (mirrors the
        # multi-head guard fixture), then query that entity as a blocker target.
        c1 = _note(self._scan(), C1_ID)
        work_protocol.promote(str(self.vault), c1, apply=True, promoted_by="user/xue")
        h3 = self.vault / "Projects/iii-pivot/issues/db-migration.reviewed.99.md"
        h3.write_text(
            "---\ntype: issue\nentity: " + ENTITY + "\nstate: canceled\n"
            "status: reviewed\nsupersedes: " + H1_ID + "\n"
            "last-verified: 2026-06-26\n---\n\nrival reviewed head.\n", "utf-8")
        notes = self._scan()
        self.assertEqual(
            work_protocol.blocker_status(ENTITY, notes),
            work_protocol.BLOCKER_TRUTH_CONFLICT,
        )


class HasUnresolvedBlocker(WorkProtocolFixtureBase):
    """has_unresolved_blocker(entity): True iff the entity's authoritative head
    declares any blocked-by target that is NOT RESOLVED."""

    def test_a_is_blocked_by_active_b(self) -> None:
        self.assertTrue(work_protocol.has_unresolved_blocker(self._scan(), ENTITY_A))

    def test_entity_with_resolved_only_blocker_is_not_blocked(self) -> None:
        # db-migration is blocked-by schema-freeze, which is RESOLVED (reviewed
        # done) -> no unresolved blocker.
        self.assertFalse(work_protocol.has_unresolved_blocker(self._scan(), ENTITY))

    def test_entity_with_no_blocked_by_is_not_blocked(self) -> None:
        self.assertFalse(work_protocol.has_unresolved_blocker(self._scan(), ENTITY_B))

    def test_missing_entity_is_not_blocked(self) -> None:
        self.assertFalse(
            work_protocol.has_unresolved_blocker(self._scan(), "project/x/issue/none"))


class EffectiveStateBlockedDerivation(WorkProtocolFixtureBase):
    """§3 #4: A blocked-by B (B in-progress) -> A's effective_state is the DERIVED
    'blocked' (active head + unresolved blocker). A draft state:done for B does
    NOT resolve A; only a reviewed-promoted done does."""

    def test_active_head_with_unresolved_blocker_derives_blocked(self) -> None:
        eff = work_protocol.effective_state(self._scan(), ENTITY_A)
        self.assertEqual(eff["state"], currency.STATE_BLOCKED)
        self.assertEqual(eff["marker"], "")  # blocked is not a truth-conflict
        targets = {b["target"] for b in eff["blockers"]}
        self.assertIn(ENTITY_B, targets)

    def test_draft_done_for_b_does_not_resolve_a(self) -> None:
        # the draft state:done capture for B is present in the fixture; A stays
        # blocked because a draft is a candidate, never an authoritative head.
        b_draft = _note(self._scan(), B_DONE_CAPTURE_ID)
        self.assertTrue(b_draft.is_candidate)
        self.assertEqual(currency.work_state(b_draft.cm), "done")  # proposes done
        self.assertEqual(
            work_protocol.effective_state(self._scan(), ENTITY_A)["state"],
            currency.STATE_BLOCKED,
        )

    def test_after_promote_b_done_a_returns_to_open(self) -> None:
        b_draft = _note(self._scan(), B_DONE_CAPTURE_ID)
        res = work_protocol.promote(str(self.vault), b_draft, apply=True,
                                    promoted_by="user/xue", today="2026-06-25")
        self.assertEqual(res.outcome, work_protocol.OUTCOME_MATERIALIZED)
        # B is now reviewed-done -> RESOLVED -> A is no longer blocked (back to
        # its own head state, in-progress = an Open action).
        eff = work_protocol.effective_state(self._scan(), ENTITY_A)
        self.assertEqual(eff["state"], "in-progress")
        self.assertEqual(eff["blockers"], [])

    def test_done_head_is_not_re_derived_as_blocked(self) -> None:
        # a terminal (done) head with a stale blocked-by is NOT re-derived blocked.
        done_blocked = self.vault / "Projects/iii-pivot/issues/finished.md"
        done_blocked.write_text(
            "---\ntype: issue\nentity: project/iii-pivot/issue/finished\n"
            "state: done\nstatus: reviewed\n"
            "blocked-by: [project/iii-pivot/issue/issue-b]\n"
            "last-verified: 2026-06-24\n---\n\ndone despite a stale blocker.\n",
            "utf-8")
        eff = work_protocol.effective_state(self._scan(),
                                            "project/iii-pivot/issue/finished")
        self.assertEqual(eff["state"], "done")


class DerivedRelations(WorkProtocolFixtureBase):
    """blocks (reverse) and related (symmetric) are DERIVED from the only
    persisted edge, blocked-by -- never double-written."""

    def test_blocked_by_is_read_from_head(self) -> None:
        rel = work_protocol.derive_relations(self._scan())
        self.assertEqual(rel[ENTITY_A]["blocked_by"], [ENTITY_B])

    def test_blocks_is_the_reverse_edge(self) -> None:
        # B blocks A iff A blocked-by B.
        rel = work_protocol.derive_relations(self._scan())
        self.assertIn(ENTITY_A, rel[ENTITY_B]["blocks"])
        self.assertEqual(rel[ENTITY_A]["blocks"], [])  # A blocks nothing

    def test_related_is_symmetric(self) -> None:
        rel = work_protocol.derive_relations(self._scan())
        self.assertIn(ENTITY_B, rel[ENTITY_A]["related"])
        self.assertIn(ENTITY_A, rel[ENTITY_B]["related"])

    def test_relations_read_only_authoritative_head_not_drafts(self) -> None:
        # a draft capture that forges a blocked-by must not contribute an edge.
        forged = self.vault / "00-Inbox/AI-Output/forged-blocked-by.md"
        forged.write_text(
            "---\ntype: issue\nentity: project/iii-pivot/issue/issue-b\n"
            "state: in-progress\nstatus: draft\n"
            "blocked-by: [project/iii-pivot/issue/phantom]\n"
            "base-head: " + B_ID + "\nlast-verified: 2026-06-26\n---\n\n"
            "draft forging a blocked-by edge.\n", "utf-8")
        rel = work_protocol.derive_relations(self._scan())
        # B's authoritative head declares NO blocked-by; the draft's forged edge
        # to `phantom` must not appear.
        self.assertEqual(rel[ENTITY_B]["blocked_by"], [])
        self.assertNotIn("project/iii-pivot/issue/phantom", rel)

    def test_blocked_by_refs_dedupes_and_handles_scalar(self) -> None:
        self.assertEqual(
            work_protocol.blocked_by_refs({"blocked-by": ["x", "x", "y"]}),
            ["x", "y"])
        # a scalar value is tolerated and wrapped.
        self.assertEqual(work_protocol.blocked_by_refs({"blocked-by": "z"}), ["z"])
        self.assertEqual(work_protocol.blocked_by_refs({}), [])


# --- §3 #4: end-to-end through the LIVE kb_meta Blockers view -----------------


class LiveBlockersViewFromRealGraph(unittest.TestCase):
    """§3 #4 enforced in PRODUCTION: the real read path kb_meta.cmd_currency ->
    _pass4_project_status now computes the Blockers section from the REAL
    effective_state=='blocked' graph (not the legacy_blocked-only detector). A
    legacy status:blocked note with NO relation still shows under Blockers with a
    [LEGACY-BLOCKED:NO-RELATION] marker. Open Actions = active AND not blocked."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-8c-live-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects" / "p" / "issues").mkdir(parents=True)
        (self.vault / "00-Inbox" / "AI-Output").mkdir(parents=True)
        (self.vault / "research" / "wiki").mkdir(parents=True)
        (self.vault / "research" / "_meta.json").write_text('{"sources": {}}', "utf-8")
        (self.vault / "Projects" / "p.md").write_text(
            "---\ntype: project\nentity: project/p\nstatus: active\n"
            "last-verified: 2026-06-24\n---\n\nproject p.\n", "utf-8")
        # A: reviewed in-progress, blocked-by B (real relation).
        (self.vault / "Projects" / "p" / "issues" / "a.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/a\nstate: in-progress\n"
            "status: reviewed\nblocked-by: [project/p/issue/b]\n"
            "last-verified: 2026-06-24\n---\n\nA blocked-by B.\n", "utf-8")
        # B: reviewed in-progress (an UNRESOLVED blocker for A).
        (self.vault / "Projects" / "p" / "issues" / "b.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/b\nstate: in-progress\n"
            "status: reviewed\nlast-verified: 2026-06-24\n---\n\nB still open.\n",
            "utf-8")
        # legacy: status:blocked with NO relation (old data).
        (self.vault / "Projects" / "p" / "issues" / "legacy.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/legacy\nstatus: blocked\n"
            "owner: bob\nlast-verified: 2026-06-24\n---\n\nlegacy blocked, no relation.\n",
            "utf-8")
        # a plain open action (active, not blocked).
        (self.vault / "Projects" / "p" / "issues" / "open.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/open\nstate: todo\n"
            "status: reviewed\nowner: amy\nlast-verified: 2026-06-24\n---\n\nplain open.\n",
            "utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self):
        return kb_meta.cmd_currency(str(self.vault), "research",
                                    today_str=TODAY.isoformat(), apply=False)

    def _ents(self, items):
        return {i["entity"] for i in items}

    def test_real_blocked_action_in_blockers_not_open(self) -> None:
        ps = self._run()["project_status"]["project/p"]
        self.assertIn("project/p/issue/a", self._ents(ps["blockers"]))
        self.assertNotIn("project/p/issue/a", self._ents(ps["open_actions"]))

    def test_blocker_entry_names_its_unresolved_dependency(self) -> None:
        ps = self._run()["project_status"]["project/p"]
        a = next(b for b in ps["blockers"] if b["entity"] == "project/p/issue/a")
        self.assertIn("project/p/issue/b", a.get("blocked_by", []))

    def test_legacy_blocked_no_relation_still_in_blockers(self) -> None:
        ps = self._run()["project_status"]["project/p"]
        leg = next((b for b in ps["blockers"]
                    if b["entity"] == "project/p/issue/legacy"), None)
        self.assertIsNotNone(leg)
        self.assertTrue(leg.get("legacy_blocked"))

    def test_legacy_marker_rendered(self) -> None:
        md = self._run()["project_status_md"]
        self.assertIn("[LEGACY-BLOCKED:NO-RELATION]", md)

    def test_open_action_is_active_and_not_blocked(self) -> None:
        ps = self._run()["project_status"]["project/p"]
        self.assertIn("project/p/issue/open", self._ents(ps["open_actions"]))
        self.assertNotIn("project/p/issue/open", self._ents(ps["blockers"]))

    def test_b_is_open_not_blocker(self) -> None:
        # B has no blocked-by and is not legacy-blocked -> a plain Open action.
        ps = self._run()["project_status"]["project/p"]
        self.assertIn("project/p/issue/b", self._ents(ps["open_actions"]))
        self.assertNotIn("project/p/issue/b", self._ents(ps["blockers"]))

    def test_promote_b_done_moves_a_from_blockers_to_open(self) -> None:
        # before: A is blocked.
        ps = self._run()["project_status"]["project/p"]
        self.assertIn("project/p/issue/a", self._ents(ps["blockers"]))
        # promote a draft done for B -> reviewed done head -> A unblocks.
        (self.vault / "00-Inbox" / "AI-Output" / "b-done.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/b\nstate: done\n"
            "status: draft\nbase-head: Projects/p/issues/b.md\n"
            "last-verified: 2026-06-25\n---\n\ndraft done for B.\n", "utf-8")
        cand = _note(work_protocol.scan_work_notes(str(self.vault)),
                     "00-Inbox/AI-Output/b-done.md")
        r = work_protocol.promote(str(self.vault), cand, apply=True,
                                  promoted_by="user/xue", today=TODAY.isoformat())
        self.assertEqual(r.outcome, work_protocol.OUTCOME_MATERIALIZED)
        ps2 = self._run()["project_status"]["project/p"]
        self.assertIn("project/p/issue/a", self._ents(ps2["open_actions"]))
        self.assertNotIn("project/p/issue/a", self._ents(ps2["blockers"]))

    def test_draft_done_for_b_alone_does_not_unblock_a(self) -> None:
        # §3 #4: a DRAFT done for B (no promote) must NOT move A out of Blockers.
        (self.vault / "00-Inbox" / "AI-Output" / "b-done-draft.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/b\nstate: done\n"
            "status: draft\nbase-head: Projects/p/issues/b.md\n"
            "last-verified: 2026-06-25\n---\n\ndraft done, not promoted.\n", "utf-8")
        ps = self._run()["project_status"]["project/p"]
        self.assertIn("project/p/issue/a", self._ents(ps["blockers"]))
        self.assertNotIn("project/p/issue/a", self._ents(ps["open_actions"]))


# --- Task 8D: triage view (PR3) ----------------------------------------------


def _triage_by_id(items):
    return {it.note_id: it for it in items}


class TriageConsumedRefs(WorkProtocolFixtureBase):
    """consumed_refs scans EVERY note for promotes:/rejects: and resolves each to
    a capture note-id. The fixture's reviewed snapshot promotes the api-rename
    capture, so that capture is in accepted_promotes."""

    def test_promotes_ref_is_collected(self) -> None:
        ap, ar = work_protocol.consumed_refs(
            work_protocol.scan_all_notes(str(self.vault)))
        self.assertIn(CONSUMED_CAPTURE_ID, ap)
        self.assertEqual(ar, set())

    def test_scan_all_notes_includes_no_entity_capture(self) -> None:
        # the entity filter is OFF, so the no-entity capture is visible (it must
        # be, to be classified Unclassified).
        ids = {n.note_id for n in work_protocol.scan_all_notes(str(self.vault))}
        self.assertIn(NO_ENTITY_CAPTURE_ID, ids)
        # ...while the entity-filtered work index excludes it.
        wids = {n.note_id for n in work_protocol.scan_work_notes(str(self.vault))}
        self.assertNotIn(NO_ENTITY_CAPTURE_ID, wids)


class TriageClassifyFixture(WorkProtocolFixtureBase):
    """classify_triage against the committed fixture: the no-entity capture is
    Unclassified, the cleanly-promotable capture is Pending Review, the two
    competing db-migration captures are Conflicts, and the consumed capture is
    ABSENT."""

    def _items(self):
        return work_protocol.classify_triage(str(self.vault), today="2026-06-25")

    def test_no_entity_capture_is_unclassified(self) -> None:
        it = _triage_by_id(self._items())[NO_ENTITY_CAPTURE_ID]
        self.assertEqual(it.section, work_protocol.TRIAGE_UNCLASSIFIED)
        self.assertIsNone(it.entity)

    def test_entity_no_review_is_pending_review(self) -> None:
        # issue-b-done-capture has an entity and is cleanly promotable (base-head
        # matches B's head, no multi-head, no competitor) -> Pending Review.
        it = _triage_by_id(self._items())[B_DONE_CAPTURE_ID]
        self.assertEqual(it.section, work_protocol.TRIAGE_PENDING_REVIEW)
        self.assertEqual(it.entity, ENTITY_B)

    def test_competing_promotions_are_conflicts(self) -> None:
        # C1 and C2 both target db-migration -> competing promotions -> Conflicts.
        by_id = _triage_by_id(self._items())
        self.assertEqual(by_id[C1_ID].section, work_protocol.TRIAGE_CONFLICTS)
        self.assertEqual(by_id[C2_ID].section, work_protocol.TRIAGE_CONFLICTS)

    def test_consumed_capture_is_absent(self) -> None:
        # the api-rename capture is promoted (consumed) -> not in triage at all.
        self.assertNotIn(CONSUMED_CAPTURE_ID, _triage_by_id(self._items()))

    def test_source_capture_bytes_unchanged_after_classify(self) -> None:
        before = {nid: self._read_bytes(nid) for nid in
                  (NO_ENTITY_CAPTURE_ID, C1_ID, C2_ID, B_DONE_CAPTURE_ID,
                   CONSUMED_CAPTURE_ID)}
        self._items()  # the pass runs dry -- it must never edit a source capture.
        for nid, b in before.items():
            self.assertEqual(self._read_bytes(nid), b, f"{nid} bytes changed")


class TriageConflictsBranches(unittest.TestCase):
    """The two Conflicts sub-cases the fixture's competing-promotions case does
    not isolate: a STALE base-head (8P HEAD_MISMATCH) and a multi-head
    CURRENT-TRUTH-CONFLICT. Each gets a self-contained temp vault."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-8d-conflict-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects" / "p" / "issues").mkdir(parents=True)
        (self.vault / "00-Inbox" / "AI-Output").mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_stale_base_head_is_conflicts(self) -> None:
        # H1 head, plus a reviewed H2 that already superseded H1 (the head moved).
        # A single capture pinned to the now-stale H1 -> HEAD_MISMATCH -> Conflicts.
        (self.vault / "Projects" / "p" / "issues" / "mig.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/mig\nstate: in-progress\n"
            "status: reviewed\nlast-verified: 2026-06-20\n---\n\nH1.\n", "utf-8")
        (self.vault / "Projects" / "p" / "issues" / "mig.reviewed.1.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/mig\nstate: done\n"
            "status: reviewed\nsupersedes: Projects/p/issues/mig.md\n"
            "promotes: 00-Inbox/AI-Output/old.md\nlast-verified: 2026-06-23\n---\n"
            "\nH2 (head moved off H1).\n", "utf-8")
        # the LATE capture still pins the stale H1.
        (self.vault / "00-Inbox" / "AI-Output" / "late.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/mig\nstate: canceled\n"
            "status: draft\nbase-head: Projects/p/issues/mig.md\n"
            "last-verified: 2026-06-25\n---\n\nlate capture on a stale head.\n",
            "utf-8")
        items = _triage_by_id(
            work_protocol.classify_triage(str(self.vault), today="2026-06-25"))
        it = items["00-Inbox/AI-Output/late.md"]
        self.assertEqual(it.section, work_protocol.TRIAGE_CONFLICTS)
        self.assertIn("base-head", it.reason)

    def test_multi_head_truth_conflict_is_conflicts(self) -> None:
        # two reviewed terminal heads off one H1 -> CURRENT-TRUTH-CONFLICT; a fresh
        # capture for that entity is routed to Conflicts (resolve the heads first).
        (self.vault / "Projects" / "p" / "issues" / "x.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/x\nstate: in-progress\n"
            "status: reviewed\nlast-verified: 2026-06-20\n---\n\nH1.\n", "utf-8")
        (self.vault / "Projects" / "p" / "issues" / "x.reviewed.1.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/x\nstate: done\n"
            "status: reviewed\nsupersedes: Projects/p/issues/x.md\n"
            "last-verified: 2026-06-23\n---\n\nrival head H2.\n", "utf-8")
        (self.vault / "Projects" / "p" / "issues" / "x.reviewed.2.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/x\nstate: canceled\n"
            "status: reviewed\nsupersedes: Projects/p/issues/x.md\n"
            "last-verified: 2026-06-24\n---\n\nrival head H3.\n", "utf-8")
        (self.vault / "00-Inbox" / "AI-Output" / "x-cap.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/x\nstate: done\n"
            "status: draft\nbase-head: Projects/p/issues/x.md\n"
            "last-verified: 2026-06-25\n---\n\ncapture onto a conflicted entity.\n",
            "utf-8")
        it = _triage_by_id(
            work_protocol.classify_triage(str(self.vault), today="2026-06-25")
        )["00-Inbox/AI-Output/x-cap.md"]
        self.assertEqual(it.section, work_protocol.TRIAGE_CONFLICTS)
        self.assertIn(work_protocol.TRUTH_CONFLICT, it.reason)


class TriageRejectionConsumes(unittest.TestCase):
    """Rejection consumes a capture too: a `type:decision status:reviewed
    rejects:<id>` note removes the capture from triage -- the source bytes never
    change (acceptance/rejection are both new notes, never edits)."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-8d-reject-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects" / "p" / "issues").mkdir(parents=True)
        (self.vault / "00-Inbox" / "AI-Output").mkdir(parents=True)
        (self.vault / "Decisions").mkdir(parents=True)
        (self.vault / "Projects" / "p" / "issues" / "dup.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/dup\nstate: in-progress\n"
            "status: reviewed\nlast-verified: 2026-06-20\n---\n\nhead.\n", "utf-8")
        self.cap = self.vault / "00-Inbox" / "AI-Output" / "dup-cap.md"
        self.cap.write_text(
            "---\ntype: issue\nentity: project/p/issue/dup\nstate: done\n"
            "status: draft\nbase-head: Projects/p/issues/dup.md\n"
            "last-verified: 2026-06-25\n---\n\na duplicate capture to be rejected.\n",
            "utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_capture_pending_before_rejection(self) -> None:
        items = _triage_by_id(
            work_protocol.classify_triage(str(self.vault), today="2026-06-25"))
        self.assertIn("00-Inbox/AI-Output/dup-cap.md", items)
        self.assertEqual(items["00-Inbox/AI-Output/dup-cap.md"].section,
                         work_protocol.TRIAGE_PENDING_REVIEW)

    def test_rejection_note_removes_capture_from_triage(self) -> None:
        cap_bytes = self.cap.read_bytes()
        (self.vault / "Decisions" / "reject-dup.md").write_text(
            "---\ntype: decision\nstatus: reviewed\n"
            "rejects: 00-Inbox/AI-Output/dup-cap.md\n"
            "reason: duplicate of an already-tracked issue\n"
            "last-verified: 2026-06-25\n---\n\nrejected as a dup.\n", "utf-8")
        items = _triage_by_id(
            work_protocol.classify_triage(str(self.vault), today="2026-06-25"))
        self.assertNotIn("00-Inbox/AI-Output/dup-cap.md", items)
        # the source capture is untouched -- rejection is a new note, not an edit.
        self.assertEqual(self.cap.read_bytes(), cap_bytes)


class TriageEntityShapedRefDoesNotConsume(unittest.TestCase):
    """Invariant (b): promotes:/rejects: reference a note-id, NEVER an entity. An
    ENTITY string whose last segment collides with an unrelated capture's file
    stem must NOT consume that capture from triage (the consumption-path namespace
    leak). Mirrors test_entity_shaped_base_head_is_head_mismatch on the base-head
    side."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-8d-nsleak-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects" / "p" / "issues").mkdir(parents=True)
        (self.vault / "00-Inbox" / "AI-Output").mkdir(parents=True)
        (self.vault / "Decisions").mkdir(parents=True)
        # an UNRELATED, unconsumed capture whose file STEM is `db-migration`.
        self.cap = self.vault / "00-Inbox" / "AI-Output" / "db-migration.md"
        self.cap.write_text(
            "---\ntype: issue\nentity: project/p/issue/db-migration\nstate: done\n"
            "status: draft\nlast-verified: 2026-06-25\n---\n\nan unconsumed capture.\n",
            "utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_entity_shaped_promotes_does_not_consume_stem_collision(self) -> None:
        # a reviewed snapshot whose `promotes:` is an ENTITY string (last segment
        # `db-migration`) -- it stem-collides with the capture but is NOT its note-id.
        (self.vault / "Projects" / "p" / "issues" / "other.md").write_text(
            "---\ntype: issue\nentity: project/otherproj/issue/db-migration\n"
            "state: done\nstatus: reviewed\n"
            "promotes: project/otherproj/issue/db-migration\n"
            "last-verified: 2026-06-25\n---\n\nunrelated reviewed note.\n", "utf-8")
        ap, ar = work_protocol.consumed_refs(
            work_protocol.scan_all_notes(str(self.vault)))
        # the entity-shaped ref must NOT resolve to (consume) the capture note-id.
        self.assertNotIn("00-Inbox/AI-Output/db-migration.md", ap)
        items = _triage_by_id(
            work_protocol.classify_triage(str(self.vault), today="2026-06-25"))
        # the genuinely-unconsumed capture must STILL be present in triage.
        self.assertIn("00-Inbox/AI-Output/db-migration.md", items)

    def test_entity_shaped_rejects_does_not_consume_stem_collision(self) -> None:
        (self.vault / "Decisions" / "reject.md").write_text(
            "---\ntype: decision\nstatus: reviewed\n"
            "rejects: project/otherproj/issue/db-migration\n"
            "reason: not the right capture\nlast-verified: 2026-06-25\n---\n\nx.\n",
            "utf-8")
        ap, ar = work_protocol.consumed_refs(
            work_protocol.scan_all_notes(str(self.vault)))
        self.assertNotIn("00-Inbox/AI-Output/db-migration.md", ar)
        items = _triage_by_id(
            work_protocol.classify_triage(str(self.vault), today="2026-06-25"))
        self.assertIn("00-Inbox/AI-Output/db-migration.md", items)

    def test_genuine_note_id_promotes_still_consumes(self) -> None:
        # control: a real note-id `promotes:` still consumes the capture.
        (self.vault / "Projects" / "p" / "issues" / "snap.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/db-migration\nstate: done\n"
            "status: reviewed\npromotes: 00-Inbox/AI-Output/db-migration.md\n"
            "last-verified: 2026-06-25\n---\n\nreal promotion.\n", "utf-8")
        ap, ar = work_protocol.consumed_refs(
            work_protocol.scan_all_notes(str(self.vault)))
        self.assertIn("00-Inbox/AI-Output/db-migration.md", ap)
        items = _triage_by_id(
            work_protocol.classify_triage(str(self.vault), today="2026-06-25"))
        self.assertNotIn("00-Inbox/AI-Output/db-migration.md", items)


class LiveTriageThroughCmdCurrency(unittest.TestCase):
    """§3 #7 / 8D end-to-end through the LIVE read path kb_meta.cmd_currency: the
    triage pass returns triage / triage_md, writes _triage.md only when there is
    something to triage, and a consumed capture stays absent. Source captures are
    byte-identical before/after the (apply) pass."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-8d-live-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects" / "p" / "issues").mkdir(parents=True)
        (self.vault / "00-Inbox" / "AI-Output").mkdir(parents=True)
        (self.vault / "research" / "wiki").mkdir(parents=True)
        (self.vault / "research" / "_meta.json").write_text('{"sources": {}}', "utf-8")
        (self.vault / "Projects" / "p.md").write_text(
            "---\ntype: project\nentity: project/p\nstatus: active\n"
            "last-verified: 2026-06-24\n---\n\nproject p.\n", "utf-8")
        (self.vault / "Projects" / "p" / "issues" / "mig.md").write_text(
            "---\ntype: issue\nentity: project/p/issue/mig\nstate: in-progress\n"
            "status: reviewed\nlast-verified: 2026-06-20\n---\n\nhead.\n", "utf-8")
        # a pending-review capture (clean) ...
        self.pending = self.vault / "00-Inbox" / "AI-Output" / "mig-cap.md"
        self.pending.write_text(
            "---\ntype: issue\nentity: project/p/issue/mig\nstate: done\n"
            "status: draft\nbase-head: Projects/p/issues/mig.md\n"
            "last-verified: 2026-06-25\n---\n\npending capture.\n", "utf-8")
        # ... a no-entity capture (unclassified) ...
        self.loose = self.vault / "00-Inbox" / "AI-Output" / "loose.md"
        self.loose.write_text(
            "---\ntype: note\nstatus: draft\nlast-verified: 2026-06-25\n---\n"
            "\na loose thought, no entity.\n", "utf-8")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _run(self, apply=False):
        return kb_meta.cmd_currency(str(self.vault), "research",
                                    today_str=TODAY.isoformat(), apply=apply)

    def test_triage_keys_returned_and_classified(self) -> None:
        res = self._run()
        sections = {t["note_id"]: t["section"] for t in res["triage"]}
        self.assertEqual(sections["00-Inbox/AI-Output/mig-cap.md"],
                         work_protocol.TRIAGE_PENDING_REVIEW)
        self.assertEqual(sections["00-Inbox/AI-Output/loose.md"],
                         work_protocol.TRIAGE_UNCLASSIFIED)
        self.assertIn("Unclassified", res["triage_md"])
        self.assertIn("Pending Review", res["triage_md"])

    def test_triage_md_written_only_on_apply(self) -> None:
        triage_path = self.vault / "research" / "wiki" / kb_meta.TRIAGE_FILE
        self._run(apply=False)
        self.assertFalse(triage_path.exists(), "dry-run must write nothing")
        self._run(apply=True)
        self.assertTrue(triage_path.exists(), "apply must write _triage.md")

    def test_consumed_capture_disappears_from_live_triage(self) -> None:
        # promote the pending capture -> a reviewed snapshot promotes: it.
        cand = _note(work_protocol.scan_work_notes(str(self.vault)),
                     "00-Inbox/AI-Output/mig-cap.md")
        r = work_protocol.promote(str(self.vault), cand, apply=True,
                                  promoted_by="user/xue", today=TODAY.isoformat())
        self.assertEqual(r.outcome, work_protocol.OUTCOME_MATERIALIZED)
        ids = {t["note_id"] for t in self._run()["triage"]}
        self.assertNotIn("00-Inbox/AI-Output/mig-cap.md", ids)
        # the loose (no-entity) capture is still there.
        self.assertIn("00-Inbox/AI-Output/loose.md", ids)

    def test_empty_triage_writes_no_file(self) -> None:
        # remove both captures -> nothing to triage -> _triage.md is not written.
        self.pending.unlink()
        self.loose.unlink()
        res = self._run(apply=True)
        self.assertEqual(res["triage"], [])
        self.assertFalse(
            (self.vault / "research" / "wiki" / kb_meta.TRIAGE_FILE).exists())

    def test_source_captures_byte_identical_after_apply(self) -> None:
        loose_before = self.loose.read_bytes()
        pending_before = self.pending.read_bytes()
        self._run(apply=True)
        self.assertEqual(self.loose.read_bytes(), loose_before)
        self.assertEqual(self.pending.read_bytes(), pending_before)

    def test_triage_md_on_disk_is_lf_only_and_matches_render(self) -> None:
        # invariant (f): the derived artifact must be byte-stable / OS-independent.
        # Text-mode write applied CRLF translation on Windows, so the same render
        # produced different bytes per platform. Assert the on-disk bytes are
        # LF-only and byte-identical to the returned render (mirrors the promote
        # snapshot LF-only test).
        res = self._run(apply=True)
        triage_disk = (self.vault / "research" / "wiki"
                       / kb_meta.TRIAGE_FILE).read_bytes()
        self.assertNotIn(b"\r\n", triage_disk, "_triage.md must be LF-only on disk")
        self.assertEqual(triage_disk, res["triage_md"].encode("utf-8"),
                         "on-disk _triage.md must equal the rendered triage_md")

    def test_all_derived_artifacts_on_disk_are_lf_only(self) -> None:
        # every cmd_currency artifact (not just _triage.md) shares the byte-stable
        # writer: none may carry CRLF on disk.
        self._run(apply=True)
        wiki = self.vault / "research" / "wiki"
        for fname in (kb_meta.CURRENT_TRUTH_FILE, kb_meta.SUPERSESSION_FILE,
                      kb_meta.CURRENCY_REPORT_FILE, kb_meta.PROJECT_STATUS_FILE,
                      kb_meta.TRIAGE_FILE):
            p = wiki / fname
            if not p.exists():
                continue
            self.assertNotIn(b"\r\n", p.read_bytes(), f"{fname} must be LF-only")


if __name__ == "__main__":
    unittest.main()
