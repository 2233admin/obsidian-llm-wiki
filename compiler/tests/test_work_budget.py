"""Task 11B -- budget / quota ledger (green bar 3): the ledger may reach the
cap, but the spawn-gate exits *before* a run that would overspend.

Run from compiler/ (Windows -- prefix PYTHONUTF8=1):
    PYTHONUTF8=1 python -m unittest tests.test_work_budget -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

_COMPILER = Path(__file__).resolve().parents[1]
if str(_COMPILER) not in sys.path:
    sys.path.insert(0, str(_COMPILER))

import currency  # noqa: E402
import work_budget  # noqa: E402
import work_protocol  # noqa: E402


def _wn(note_id: str, **fm) -> "work_protocol.WorkNote":
    """A WorkNote from raw frontmatter via the real normalize() path (hyphenated
    keys like budget-spent are passed through **{...} as in the driver tests)."""
    return work_protocol.WorkNote(
        note_id=note_id,
        path=Path(note_id),
        cm=currency.normalize(fm),
        raw=dict(fm),
        body="",
    )


class ReadBudgetTest(unittest.TestCase):
    def test_reads_cap_and_spent(self):
        n = _wn("a.md", entity="project/x/issue/a", **{"budget": 1000, "budget-spent": 250})
        self.assertEqual(work_budget.read_budget(n), (1000, 250))

    def test_absent_cap_is_none_spent_defaults_zero(self):
        n = _wn("a.md", entity="project/x/issue/a")
        self.assertEqual(work_budget.read_budget(n), (None, 0))

    def test_string_frontmatter_coerced(self):
        # frontmatter may arrive as strings; coercion keeps the ledger numeric.
        n = _wn("a.md", entity="project/x/issue/a", **{"budget": "500", "budget-spent": "60"})
        self.assertEqual(work_budget.read_budget(n), (500, 60))

    def test_negative_clamps_to_zero(self):
        n = _wn("a.md", entity="project/x/issue/a", **{"budget": -5})
        cap, _ = work_budget.read_budget(n)
        self.assertEqual(cap, 0)


class PoolResolutionTest(unittest.TestCase):
    def test_item_own_budget_wins(self):
        item = _wn("p/x/i/a.md", entity="project/x/issue/a",
                   **{"budget": 100, "budget-spent": 10})
        container = _wn("p/x/_project.md", entity="project/x",
                        **{"budget": 9999, "budget-spent": 8000})
        self.assertEqual(work_budget.resolve_pool(item, [item, container]), (100, 10))

    def test_falls_back_to_project_pool(self):
        # the item declares no budget -> it draws on the shared project pool.
        item = _wn("p/x/i/a.md", entity="project/x/issue/a")
        container = _wn("p/x/_project.md", entity="project/x",
                        **{"budget": 800, "budget-spent": 700})
        self.assertEqual(work_budget.resolve_pool(item, [item, container]), (800, 700))

    def test_unbounded_when_neither_declares(self):
        item = _wn("p/x/i/a.md", entity="project/x/issue/a")
        container = _wn("p/x/_project.md", entity="project/x")
        self.assertEqual(work_budget.resolve_pool(item, [item, container]), (None, 0))

    def test_pool_shared_across_siblings(self):
        # one cap, two issues -> both resolve to the same pool numbers (§7 pooling).
        a = _wn("p/x/i/a.md", entity="project/x/issue/a")
        b = _wn("p/x/i/b.md", entity="project/x/issue/b")
        container = _wn("p/x/_project.md", entity="project/x", **{"budget": 500, "budget-spent": 480})
        notes = [a, b, container]
        self.assertEqual(work_budget.resolve_pool(a, notes), (500, 480))
        self.assertEqual(work_budget.resolve_pool(b, notes), (500, 480))


class CheckGateTest(unittest.TestCase):
    def test_unbounded_is_ok(self):
        self.assertEqual(work_budget.check(None, 999999).outcome, work_budget.OUTCOME_OK)

    def test_room_left_is_ok(self):
        r = work_budget.check(1000, 200, projected=300)
        self.assertEqual(r.outcome, work_budget.OUTCOME_OK)
        self.assertEqual(r.remaining, 800)

    def test_spend_exactly_to_cap_is_allowed(self):
        # == cap is not over; only > overspends.
        self.assertEqual(
            work_budget.check(1000, 700, projected=300).outcome, work_budget.OUTCOME_OK
        )

    def test_projected_over_cap_exhausts_before_spawn(self):
        # green bar 3: admitting this run would push past the cap -> stop first.
        self.assertEqual(
            work_budget.check(1000, 700, projected=301).outcome,
            work_budget.OUTCOME_EXHAUSTED,
        )

    def test_already_at_cap_exhausts(self):
        self.assertEqual(work_budget.check(1000, 1000).outcome, work_budget.OUTCOME_EXHAUSTED)

    def test_already_over_cap_exhausts(self):
        r = work_budget.check(1000, 1200)
        self.assertEqual(r.outcome, work_budget.OUTCOME_EXHAUSTED)
        self.assertEqual(r.remaining, 0)  # never reports negative headroom


class DebitTest(unittest.TestCase):
    def test_debit_accumulates(self):
        self.assertEqual(work_budget.debit(200, 50), 250)

    def test_debit_from_blank(self):
        self.assertEqual(work_budget.debit(0, 100), 100)

    def test_negative_cost_rejected(self):
        with self.assertRaises(ValueError):
            work_budget.debit(100, -1)


if __name__ == "__main__":
    unittest.main()
