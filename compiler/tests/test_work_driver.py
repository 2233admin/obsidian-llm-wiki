"""Task 11A -- Work Driver: deterministic next-work selection (green bar 1).

`select_next(notes)` picks the next executable work item from the authoritative
work index, deterministically (same truth -> same pick, stable under input
order). Actionable = work_state in {todo, in-progress} and not blocked. Tie-break
is the stable note_id (the optimistic-lock token), so two runs never disagree.

Lease / HEAD_MISMATCH (green bar 2) lands in a sibling case once this is green.

Run from the compiler/ dir (Windows -- prefix PYTHONUTF8=1):
    PYTHONUTF8=1 python -m unittest tests.test_work_driver -v
"""

from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path

_COMPILER = Path(__file__).resolve().parents[1]
if str(_COMPILER) not in sys.path:
    sys.path.insert(0, str(_COMPILER))

import currency  # noqa: E402
import work_driver  # noqa: E402
import work_protocol  # noqa: E402

TODAY = date(2026, 6, 25)


def _wn(note_id: str, **fm) -> "work_protocol.WorkNote":
    """Build a WorkNote from raw frontmatter via the real normalize() path.
    note_id = repo-relative POSIX path (the stable lock token)."""
    return work_protocol.WorkNote(
        note_id=note_id,
        path=Path(note_id),
        cm=currency.normalize(fm),
        raw=dict(fm),
        body="",
    )


class SelectNextTest(unittest.TestCase):
    def test_picks_highest_priority_actionable(self) -> None:
        notes = [
            _wn("p/i/c.md", entity="e/c", state="todo", priority=3),
            _wn("p/i/a.md", entity="e/a", state="todo", priority=1),
            _wn("p/i/b.md", entity="e/b", state="in-progress", priority=2),
        ]
        self.assertEqual(work_driver.select_next(notes).note_id, "p/i/a.md")

    def test_excludes_non_actionable_states(self) -> None:
        notes = [
            _wn("p/i/backlog.md", entity="e/bl", state="backlog", priority=1),
            _wn("p/i/done.md", entity="e/dn", state="done", priority=1),
            _wn("p/i/canceled.md", entity="e/cx", state="canceled", priority=1),
            _wn("p/i/todo.md", entity="e/td", state="todo", priority=4),
        ]
        # Only the todo is actionable, even though its priority is lowest.
        self.assertEqual(work_driver.select_next(notes).note_id, "p/i/todo.md")

    def test_tiebreak_is_stable_note_id(self) -> None:
        notes = [
            _wn("p/i/mango.md", entity="e/m", state="todo", priority=2),
            _wn("p/i/apple.md", entity="e/a", state="todo", priority=2),
        ]
        # Same priority -> the smaller note_id wins (stable lock token).
        self.assertEqual(work_driver.select_next(notes).note_id, "p/i/apple.md")

    def test_deterministic_under_input_shuffle(self) -> None:
        base = [
            _wn("p/i/a.md", entity="e/a", state="todo", priority=2),
            _wn("p/i/b.md", entity="e/b", state="in-progress", priority=1),
            _wn("p/i/c.md", entity="e/c", state="todo", priority=2),
        ]
        pick = work_driver.select_next(base).note_id
        # Any input ordering yields the same pick (no reliance on scan order).
        for perm in ([2, 0, 1], [1, 2, 0], [0, 2, 1]):
            shuffled = [base[i] for i in perm]
            self.assertEqual(work_driver.select_next(shuffled).note_id, pick)
        self.assertEqual(pick, "p/i/b.md")

    def test_empty_or_no_actionable_returns_none(self) -> None:
        self.assertIsNone(work_driver.select_next([]))
        self.assertIsNone(
            work_driver.select_next([_wn("p/i/d.md", entity="e/d", state="done")])
        )


if __name__ == "__main__":
    unittest.main()
