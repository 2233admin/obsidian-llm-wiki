"""Review-axis migration: `review` field with back-compat fallback to `status`.

The work-OS REVIEW axis (reviewed|draft) is moved off the `status` field onto a
new `review` field, freeing `status` to carry the rhizome lifecycle
(active|frozen|archived) on the SAME note. The single source of truth is
work_protocol._status, which now reads `review` FIRST and falls back to the
legacy `status` field (so the entire existing fixture corpus -- which uses
status:reviewed|draft and has no `review` field -- keeps returning the identical
review value, leaving is_authoritative / candidate / recency unchanged).

A second, independent review-axis read lives in kb_meta.CurrencyNote.sort_key
(it reads cm.status directly, not through _status); it applies the same
review-first precedence.

Run from the compiler/ dir (this box is Windows -- prefix PYTHONUTF8=1):
    PYTHONUTF8=1 python -m unittest tests.test_review_axis -v
"""

from __future__ import annotations

import sys
from pathlib import Path

_COMPILER = Path(__file__).resolve().parents[1]
if str(_COMPILER) not in sys.path:
    sys.path.insert(0, str(_COMPILER))

import unittest  # noqa: E402

import currency  # noqa: E402
import kb_meta  # noqa: E402
import work_protocol  # noqa: E402


class ReviewAxisStatusTest(unittest.TestCase):
    """work_protocol._status / is_authoritative / is_candidate read the new
    `review` field first, fall back to legacy `status`."""

    # (a) review:reviewed only (no status) -> authoritative, not candidate.
    def test_review_reviewed_only_is_authoritative(self) -> None:
        fm = {"review": "reviewed"}
        self.assertEqual(work_protocol._status(fm), "reviewed")
        self.assertTrue(work_protocol.is_authoritative_work_note(fm))
        self.assertFalse(work_protocol.is_candidate_work_note(fm))

    # (b) review:draft only -> candidate, not authoritative.
    def test_review_draft_only_is_candidate(self) -> None:
        fm = {"review": "draft"}
        self.assertEqual(work_protocol._status(fm), "draft")
        self.assertFalse(work_protocol.is_authoritative_work_note(fm))
        self.assertTrue(work_protocol.is_candidate_work_note(fm))

    # (c) BACK-COMPAT: legacy status:reviewed (no review) -> still authoritative.
    def test_legacy_status_reviewed_back_compat(self) -> None:
        fm = {"status": "reviewed"}
        self.assertEqual(work_protocol._status(fm), "reviewed")
        self.assertTrue(work_protocol.is_authoritative_work_note(fm))
        self.assertFalse(work_protocol.is_candidate_work_note(fm))

    # (d) BACK-COMPAT: legacy status:draft (no review) -> still candidate.
    def test_legacy_status_draft_back_compat(self) -> None:
        fm = {"status": "draft"}
        self.assertEqual(work_protocol._status(fm), "draft")
        self.assertFalse(work_protocol.is_authoritative_work_note(fm))
        self.assertTrue(work_protocol.is_candidate_work_note(fm))

    # (e) CONFLICT-COEXIST: review:reviewed + status:active -> review wins for the
    # review axis (authoritative); status:active is IGNORED by _status and never
    # leaks into the workflow axis (explicit state:todo wins in work_state).
    def test_review_wins_over_status_lifecycle(self) -> None:
        fm = {"review": "reviewed", "status": "active", "state": "todo"}
        self.assertEqual(work_protocol._status(fm), "reviewed")
        self.assertTrue(work_protocol.is_authoritative_work_note(fm))
        self.assertFalse(work_protocol.is_candidate_work_note(fm))
        # status:active must NOT pollute the workflow axis (state:todo wins).
        self.assertEqual(currency.work_state(fm), currency.STATE_TODO)

    # The mirror: review:draft beats status:active -> draft (review wins), and the
    # rhizome lifecycle value is still inert for the workflow axis.
    def test_review_draft_wins_over_status_active(self) -> None:
        fm = {"review": "draft", "status": "active", "state": "todo"}
        self.assertEqual(work_protocol._status(fm), "draft")
        self.assertTrue(work_protocol.is_candidate_work_note(fm))
        self.assertFalse(work_protocol.is_authoritative_work_note(fm))
        self.assertEqual(currency.work_state(fm), currency.STATE_TODO)

    # Empty / garbage `review` falls through to the legacy status fallback.
    def test_empty_review_falls_back_to_status(self) -> None:
        # empty-string review (naive parser) -> fall back to status.
        self.assertEqual(work_protocol._status({"review": "", "status": "reviewed"}), "reviewed")
        self.assertEqual(work_protocol._status({"review": "   ", "status": "draft"}), "draft")
        # empty-list review (rich parser turns `review:` into []) -> fall back.
        self.assertEqual(work_protocol._status({"review": [], "status": "reviewed"}), "reviewed")
        # whitespace-only with no status at all -> None.
        self.assertIsNone(work_protocol._status({"review": "   "}))

    def test_f_review_constant_present(self) -> None:
        self.assertEqual(work_protocol.F_REVIEW, "review")


class ReviewAxisRecencyTest(unittest.TestCase):
    """(f) recency rank: a review:reviewed note ranks above a review:draft note,
    identical to the legacy status ranking. Both _recency_key (work_protocol) and
    CurrencyNote.sort_key (kb_meta) must agree."""

    def _worknote(self, note_id: str, **fm) -> work_protocol.WorkNote:
        fm.setdefault("last-verified", "2026-06-27")
        return work_protocol.WorkNote(
            note_id=note_id,
            path=Path(note_id),
            cm=currency.normalize(fm),
            raw=dict(fm),
            body="",
        )

    def test_recency_key_reviewed_outranks_draft(self) -> None:
        # same last-verified -> reviewed (rank 2) beats draft (rank 1) on the
        # status_rank tiebreak component of _recency_key.
        rev = self._worknote("a.md", review="reviewed", entity="e", state="todo")
        draft = self._worknote("b.md", review="draft", entity="e", state="todo")
        self.assertGreater(
            work_protocol._recency_key(rev), work_protocol._recency_key(draft)
        )

    def test_recency_key_review_matches_legacy_status(self) -> None:
        # a review:reviewed note and a legacy status:reviewed note rank equally on
        # the status_rank component (both -> rank 2).
        new = self._worknote("a.md", review="reviewed", entity="e", state="todo")
        legacy = self._worknote("a.md", status="reviewed", entity="e", state="todo")
        self.assertEqual(
            work_protocol._recency_key(new)[1], work_protocol._recency_key(legacy)[1]
        )

    def _currencynote(self, note_id: str, **fm) -> kb_meta.CurrencyNote:
        fm.setdefault("last-verified", "2026-06-27")
        return kb_meta.CurrencyNote(
            note_id=note_id,
            path=Path(note_id),
            cm=currency.normalize(fm),
            body_first_line="",
        )

    def test_kb_meta_sort_key_reviewed_outranks_draft(self) -> None:
        rev = self._currencynote("a.md", review="reviewed")
        draft = self._currencynote("b.md", review="draft")
        # sort_key = (last_verified, status_rank, note_id); compare status_rank.
        self.assertGreater(rev.sort_key[1], draft.sort_key[1])

    def test_kb_meta_sort_key_review_matches_legacy_status(self) -> None:
        new = self._currencynote("a.md", review="reviewed")
        legacy = self._currencynote("a.md", status="reviewed")
        self.assertEqual(new.sort_key[1], legacy.sort_key[1])

    def test_kb_meta_sort_key_review_wins_over_status_active(self) -> None:
        # review:reviewed + status:active -> review-axis rank 2 (not 0 from
        # status:active being unknown to the {reviewed,draft} rank table).
        n = self._currencynote("a.md", review="reviewed", status="active")
        self.assertEqual(n.sort_key[1], 2)


if __name__ == "__main__":
    unittest.main()
