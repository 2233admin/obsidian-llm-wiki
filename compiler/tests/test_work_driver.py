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


class LeaseTest(unittest.TestCase):
    """Task 11A-ii -- atomic claim via base-head lock + TTL (green bar 2).

    Lease registry lives in gitignored .vault-mind/ (never shared markdown, §0
    #6). `now` is an epoch-second int the caller supplies, so tests are
    deterministic and the module stays free of wall-clock calls."""

    NID = "Projects/iii/issues/a.md"

    def setUp(self) -> None:
        self.vault = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        shutil.rmtree(self.vault, ignore_errors=True)

    def _acquire(self, agent, *, current_head=None, base_head=None, now, ttl=600):
        head = self.NID
        return work_driver.acquire_lease(
            self.vault, self.NID, agent,
            current_head=current_head or head,
            base_head=base_head or head,
            ttl_seconds=ttl, now=now,
        )

    def test_acquire_free_item(self) -> None:
        r = self._acquire("agent-1", now=1000)
        self.assertEqual(r.outcome, work_driver.OUTCOME_ACQUIRED)
        leases = work_driver.read_leases(self.vault)
        self.assertEqual(leases[self.NID]["agent_id"], "agent-1")
        self.assertEqual(leases[self.NID]["expires_at"], 1600)

    def test_second_agent_blocked_while_unexpired(self) -> None:
        self._acquire("agent-1", now=1000)
        r = self._acquire("agent-2", now=1100)  # within the 600s TTL
        self.assertEqual(r.outcome, work_driver.OUTCOME_ALREADY_LEASED)
        # original holder unchanged
        self.assertEqual(
            work_driver.read_leases(self.vault)[self.NID]["agent_id"], "agent-1"
        )

    def test_stale_base_head_is_head_mismatch(self) -> None:
        r = self._acquire(
            "agent-1", current_head=self.NID + "@v2", base_head=self.NID + "@v1",
            now=1000,
        )
        self.assertEqual(r.outcome, work_driver.OUTCOME_HEAD_MISMATCH)
        self.assertNotIn(self.NID, work_driver.read_leases(self.vault))

    def test_expired_lease_is_reclaimable(self) -> None:
        self._acquire("agent-1", now=1000)        # expires at 1600
        r = self._acquire("agent-2", now=2000)    # past expiry -> reclaim
        self.assertEqual(r.outcome, work_driver.OUTCOME_ACQUIRED)
        self.assertEqual(
            work_driver.read_leases(self.vault)[self.NID]["agent_id"], "agent-2"
        )

    def test_same_agent_refreshes(self) -> None:
        self._acquire("agent-1", now=1000)
        r = self._acquire("agent-1", now=1200)
        self.assertEqual(r.outcome, work_driver.OUTCOME_ACQUIRED)
        self.assertEqual(
            work_driver.read_leases(self.vault)[self.NID]["expires_at"], 1800
        )

    def test_release_by_holder(self) -> None:
        self._acquire("agent-1", now=1000)
        self.assertTrue(work_driver.release_lease(self.vault, self.NID, "agent-1"))
        self.assertNotIn(self.NID, work_driver.read_leases(self.vault))

    def test_release_by_non_holder_is_noop(self) -> None:
        self._acquire("agent-1", now=1000)
        self.assertFalse(work_driver.release_lease(self.vault, self.NID, "agent-2"))
        self.assertIn(self.NID, work_driver.read_leases(self.vault))


class WorkNextCliTest(unittest.TestCase):
    """Task 11A-iii -- the `work next` heartbeat handler: select from the
    authoritative work index and optionally lease it. One-shot, no daemon."""

    def setUp(self) -> None:
        self.vault = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        shutil.rmtree(self.vault, ignore_errors=True)

    def _write(self, rel: str, **fm) -> None:
        p = self.vault / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        lines = "\n".join(f"{k}: {v}" for k, v in fm.items())
        p.write_text(f"---\n{lines}\n---\n\nbody\n", encoding="utf-8")

    def test_selects_highest_priority_authoritative(self) -> None:
        self._write("Projects/x/issues/a.md",
                    entity="project/x/issue/a", state="todo", priority=2, status="reviewed")
        self._write("Projects/x/issues/b.md",
                    entity="project/x/issue/b", state="todo", priority=1, status="reviewed")
        out = kb_meta.cmd_work_next(str(self.vault))
        self.assertEqual(out["selected"]["note_id"], "Projects/x/issues/b.md")

    def test_skips_draft_captures(self) -> None:
        # a draft (candidate) capture must not be picked even at top priority.
        self._write("00-Inbox/AI-Output/cap.md",
                    entity="project/x/issue/c", state="todo", priority=1, status="draft")
        self._write("Projects/x/issues/d.md",
                    entity="project/x/issue/d", state="todo", priority=3, status="reviewed")
        out = kb_meta.cmd_work_next(str(self.vault))
        self.assertEqual(out["selected"]["note_id"], "Projects/x/issues/d.md")

    def test_claim_writes_lease(self) -> None:
        self._write("Projects/x/issues/e.md",
                    entity="project/x/issue/e", state="todo", priority=1, status="reviewed")
        out = kb_meta.cmd_work_next(str(self.vault), claim_agent="agent-1", now=1000)
        self.assertEqual(out["lease"]["outcome"], work_driver.OUTCOME_ACQUIRED)
        self.assertIn("Projects/x/issues/e.md", work_driver.read_leases(self.vault))

    def test_no_actionable_returns_none(self) -> None:
        self._write("Projects/x/issues/f.md",
                    entity="project/x/issue/f", state="done", priority=1, status="reviewed")
        out = kb_meta.cmd_work_next(str(self.vault))
        self.assertIsNone(out["selected"])


class KanbanRenderTest(unittest.TestCase):
    """Task 11 unify -- the scheduling brain renders an Obsidian Kanban board as a
    derived view from the work-OS notes (state / blocked-by), so the separate
    docket store is unnecessary."""

    def _notes(self):
        return [
            _wn("p/t/issues/a.md", entity="project/t/issue/a", state="done",
                priority=2, status="reviewed"),
            _wn("p/t/issues/b.md", entity="project/t/issue/b", state="todo",
                priority=1, status="reviewed"),
            _wn("p/t/issues/c.md", entity="project/t/issue/c", state="todo",
                priority=2, status="reviewed", **{"blocked-by": ["project/t/issue/b"]}),
            _wn("p/t/issues/d.md", entity="project/t/issue/d", state="in-progress",
                priority=2, status="reviewed"),
            _wn("p/t/issues/e.md", entity="project/t/issue/e", state="canceled",
                priority=2, status="reviewed"),
            _wn("p/t/issues/f.md", entity="project/t/issue/f", state="backlog",
                priority=3, status="reviewed"),
        ]

    def test_columns_group_by_state(self):
        cols = work_driver.board_columns(self._notes())
        self.assertEqual(cols["Done"], ["p/t/issues/a.md"])
        self.assertEqual(cols["Todo"], ["p/t/issues/b.md"])
        # c is todo but blocked-by an unresolved (still-todo) b -> Blocked
        self.assertEqual(cols["Blocked"], ["p/t/issues/c.md"])
        self.assertEqual(cols["In Progress"], ["p/t/issues/d.md"])
        self.assertEqual(cols["Canceled"], ["p/t/issues/e.md"])
        self.assertEqual(cols["Backlog"], ["p/t/issues/f.md"])

    def test_project_filter_excludes_other_projects(self):
        notes = self._notes() + [
            _wn("o/x.md", entity="project/other/issue/x", state="todo", status="reviewed")
        ]
        cols = work_driver.board_columns(notes, project="t")
        self.assertNotIn("o/x.md", cols["Todo"])

    def test_render_is_obsidian_kanban(self):
        md = work_driver.render_kanban_board(self._notes(), project="t")
        self.assertIn("kanban-plugin: board", md)
        self.assertIn("## Blocked", md)
        self.assertIn("- [x]", md)  # done/canceled cards are checked
        self.assertIn("- [ ]", md)  # open cards are unchecked


class LocalizationTest(unittest.TestCase):
    """UX: localize the kanban lane headings to the user's language (view-only;
    the canonical state model stays English)."""

    def test_detect_lang(self):
        self.assertEqual(work_driver.detect_lang("待办 储备 进行中"), "zh")
        self.assertEqual(work_driver.detect_lang("プロジェクト 進行中"), "ja")
        self.assertEqual(work_driver.detect_lang("project backlog"), "en")
        # Japanese mixes kana + kanji; kana wins so it is not mis-detected as zh
        self.assertEqual(work_driver.detect_lang("進行中です"), "ja")
        self.assertEqual(work_driver.detect_lang(""), "en")

    def test_render_localized_headings(self):
        notes = [_wn("p/t/issues/a.md", entity="project/t/issue/a",
                     state="todo", status="reviewed")]
        zh = work_driver.render_kanban_board(notes, project="t", lang="zh")
        self.assertIn("## 待办", zh)
        self.assertNotIn("## Todo", zh)
        ja = work_driver.render_kanban_board(notes, project="t", lang="ja")
        self.assertIn("## 未着手", ja)
        en = work_driver.render_kanban_board(notes, project="t", lang="en")
        self.assertIn("## Todo", en)

    def test_unknown_lang_falls_back_to_en(self):
        notes = [_wn("p/t/issues/a.md", entity="project/t/issue/a",
                     state="todo", status="reviewed")]
        md = work_driver.render_kanban_board(notes, project="t", lang="fr")
        self.assertIn("## Todo", md)

    def test_localized_board_stays_valid_kanban(self):
        notes = [_wn("p/t/issues/a.md", entity="project/t/issue/a",
                     state="done", status="reviewed")]
        md = work_driver.render_kanban_board(notes, project="t", lang="zh")
        self.assertIn("kanban-plugin: board", md)  # still the plugin's format
        self.assertIn("- [x]", md)

    def test_detect_vault_lang_from_notes(self):
        zh = [_wn("a.md", entity="项目/任务一", state="todo", status="reviewed")]
        self.assertEqual(work_driver.detect_vault_lang(zh), "zh")
        en = [_wn("b.md", entity="project/issue-b", state="todo", status="reviewed")]
        self.assertEqual(work_driver.detect_vault_lang(en), "en")


if __name__ == "__main__":
    unittest.main()
