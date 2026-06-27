"""Task 10A -- work-OS map as JSONCanvas (green bar): the resolved current-truth
compiles into a deterministic Obsidian .canvas (initiatives frame projects,
projects frame issues, blocked-by edges, STALE/blocked/done colors). Derived,
byte-stable, never mutates the source.

Run from compiler/ (Windows -- prefix PYTHONUTF8=1):
    PYTHONUTF8=1 python -m unittest tests.test_work_os_canvas -v
"""

from __future__ import annotations

import json
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

TODAY = date(2026, 6, 25)


def _cn(note_id: str, entity: str, **fm) -> "kb_meta.CurrencyNote":
    """A CurrencyNote built through the real normalize() path."""
    full = {"entity": entity, **fm}
    return kb_meta.CurrencyNote(note_id, Path(note_id), currency.normalize(full), "")


def _model():
    """A project under an initiative with three issues: a (todo, STALE) blocks
    b (in-progress), and c (done)."""
    ct = {
        "project/x": _cn("Projects/x/_project.md", "project/x",
                         type="project", initiative="initiative/foo"),
        "project/x/issue/a": _cn("Projects/x/issues/a.md", "project/x/issue/a",
                                 state="todo"),
        "project/x/issue/b": _cn("Projects/x/issues/b.md", "project/x/issue/b",
                                 state="in-progress",
                                 **{"blocked-by": ["project/x/issue/a"]}),
        "project/x/issue/c": _cn("Projects/x/issues/c.md", "project/x/issue/c",
                                 state="done"),
    }
    ct["project/x/issue/a"].markers = [currency.MARK_STALE]
    return ct


def _render(ct):
    ps = kb_meta._pass4_project_status(ct, TODAY)
    return kb_meta._render_work_os_canvas(ct, ps, {}, TODAY)


class CanvasStructureTest(unittest.TestCase):
    def setUp(self):
        self.canvas = json.loads(_render(_model()))
        self.nodes = self.canvas["nodes"]
        self.edges = self.canvas["edges"]

    def _node(self, entity, prefix):
        nid = f"{prefix}-{kb_meta._canvas_id(entity)}"
        return next((n for n in self.nodes if n["id"] == nid), None)

    def test_title_node(self):
        self.assertTrue(any(n["type"] == "text" and "work-OS map" in n["text"]
                            for n in self.nodes))

    def test_project_group_frames_issues(self):
        g = self._node("project/x", "project")
        self.assertIsNotNone(g)
        self.assertEqual(g["type"], "group")
        self.assertTrue(g["label"].startswith("project/x"))

    def test_initiative_group_present(self):
        g = self._node("initiative/foo", "init")
        self.assertIsNotNone(g)
        self.assertEqual(g["type"], "group")

    def test_issue_file_nodes_point_at_source(self):
        files = {n["file"] for n in self.nodes if n["type"] == "file"}
        self.assertEqual(files, {
            "Projects/x/issues/a.md", "Projects/x/issues/b.md",
            "Projects/x/issues/c.md",
        })

    def test_blocked_by_edge(self):
        # a blocks b: an edge labeled "blocks" lands on b's node.
        b_id = f"issue-{kb_meta._canvas_id('project/x/issue/b')}"
        a_id = f"issue-{kb_meta._canvas_id('project/x/issue/a')}"
        self.assertTrue(any(e["label"] == "blocks" and e["toNode"] == b_id
                            and e["fromNode"] == a_id for e in self.edges))

    def test_stale_node_is_red(self):
        self.assertEqual(self._node("project/x/issue/a", "issue")["color"],
                         kb_meta._CANVAS_COLOR_STALE)

    def test_effective_blocked_node_is_orange(self):
        self.assertEqual(self._node("project/x/issue/b", "issue")["color"],
                         kb_meta._CANVAS_COLOR_BLOCKED)

    def test_done_node_is_uncolored(self):
        self.assertNotIn("color", self._node("project/x/issue/c", "issue"))

    def test_valid_jsoncanvas_shape(self):
        for n in self.nodes:
            for k in ("id", "type", "x", "y", "width", "height"):
                self.assertIn(k, n)
        for e in self.edges:
            for k in ("id", "fromNode", "toNode"):
                self.assertIn(k, e)


class CanvasDeterminismTest(unittest.TestCase):
    def test_two_runs_byte_identical(self):
        self.assertEqual(_render(_model()), _render(_model()))

    def test_unaffiliated_project_renders_without_initiative_frame(self):
        ct = {
            "project/y": _cn("Projects/y/_project.md", "project/y", type="project"),
            "project/y/issue/a": _cn("Projects/y/issues/a.md", "project/y/issue/a",
                                     state="todo"),
        }
        canvas = json.loads(_render(ct))
        self.assertFalse(any(n["id"].startswith("init-") for n in canvas["nodes"]))
        self.assertTrue(any(n["id"] == "project-project-y" for n in canvas["nodes"]))


class CanvasIntegrationTest(unittest.TestCase):
    """End-to-end through cmd_currency: dry-run writes nothing; --apply drops a
    valid .canvas under wiki/ and never mutates the source notes."""

    def setUp(self):
        self.vault = Path(tempfile.mkdtemp())
        (self.vault / "kb" / "wiki").mkdir(parents=True)
        self._src = {}
        self._write("Projects/x/_project.md", entity="project/x", type="project",
                    status="reviewed")
        self._write("Projects/x/issues/a.md", entity="project/x/issue/a",
                    state="todo", status="reviewed")
        self._write("Projects/x/issues/b.md", entity="project/x/issue/b",
                    state="in-progress", status="reviewed",
                    **{"blocked-by": "project/x/issue/a"})

    def tearDown(self):
        shutil.rmtree(self.vault, ignore_errors=True)

    def _write(self, rel, **fm):
        p = self.vault / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        lines = "\n".join(f"{k}: {v}" for k, v in fm.items())
        content = f"---\n{lines}\n---\n\nbody\n"
        p.write_text(content, encoding="utf-8")
        self._src[rel] = content

    def test_dry_run_writes_nothing_but_returns_canvas(self):
        res = kb_meta.cmd_currency(str(self.vault), "kb", today_str="2026-06-25",
                                   apply=False)
        canvas = json.loads(res["work_os_canvas"])
        self.assertTrue(canvas["nodes"])
        self.assertFalse((self.vault / "kb" / "wiki" / "_work-os.canvas").exists())

    def test_apply_writes_valid_canvas_and_leaves_source_intact(self):
        kb_meta.cmd_currency(str(self.vault), "kb", today_str="2026-06-25",
                             apply=True)
        out = self.vault / "kb" / "wiki" / "_work-os.canvas"
        self.assertTrue(out.exists())
        canvas = json.loads(out.read_text(encoding="utf-8"))
        self.assertTrue(any(n["type"] == "file" for n in canvas["nodes"]))
        self.assertTrue(any(e["label"] == "blocks" for e in canvas["edges"]))
        # source notes are untouched by the derived view.
        for rel, original in self._src.items():
            self.assertEqual((self.vault / rel).read_text(encoding="utf-8"), original)


class TriageCanvasTest(unittest.TestCase):
    """Task 10C-B: draft candidates render into _triage.canvas -- grouped by
    digest-session (10B tag), draft-colored file nodes, blocked-by edges. The
    candidate surface the 10C promote gesture acts on. Derived, byte-stable."""

    def setUp(self):
        self.vault = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.vault, ignore_errors=True)

    def _draft(self, rel, **fm):
        p = self.vault / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        lines = "\n".join(f"{k}: {v}" for k, v in fm.items())
        p.write_text(f"---\n{lines}\n---\n\nbody\n", encoding="utf-8")

    def _three(self):
        self._draft("00-Inbox/AI-Output/t/a.md", entity="proj/x/issue/a",
                    type="issue", status="draft", **{"digest-session": "sess-1"})
        self._draft("00-Inbox/AI-Output/t/b.md", entity="proj/x/issue/b",
                    type="issue", status="draft",
                    **{"digest-session": "sess-1", "blocked-by": "proj/x/issue/a"})
        self._draft("00-Inbox/AI-Output/t/c.md", entity="proj/x/decision/c",
                    type="decision", status="draft", **{"digest-session": "sess-2"})

    def test_renders_candidates_grouped_and_edged(self):
        self._three()
        out = kb_meta.cmd_triage_canvas(str(self.vault), today="2026-06-25")
        self.assertEqual(out["candidates"], 3)
        canvas = json.loads(out["canvas"])
        files = {n["file"] for n in canvas["nodes"] if n["type"] == "file"}
        self.assertEqual(len(files), 3)
        labels = [n.get("label") for n in canvas["nodes"] if n["type"] == "group"]
        self.assertIn("session: sess-1", labels)
        self.assertIn("session: sess-2", labels)
        # b blocked-by a -> a "blocks" edge between the two candidate nodes
        self.assertTrue(any(e["label"] == "blocks" for e in canvas["edges"]))
        self.assertNotIn("written", out)  # dry-run

    def test_only_drafts_are_candidates(self):
        self._draft("Projects/x/issues/r.md", entity="proj/x/issue/r",
                    type="issue", status="reviewed")  # authoritative, not a candidate
        out = kb_meta.cmd_triage_canvas(str(self.vault), today="2026-06-25")
        self.assertEqual(out["candidates"], 0)

    def test_write_creates_file(self):
        self._draft("00-Inbox/AI-Output/t/a.md", entity="proj/x/issue/a", status="draft")
        out = kb_meta.cmd_triage_canvas(str(self.vault), write=True, today="2026-06-25")
        self.assertEqual(out["written"], "_triage.canvas")
        self.assertTrue((self.vault / "_triage.canvas").exists())

    def test_deterministic(self):
        self._three()
        a = kb_meta.cmd_triage_canvas(str(self.vault), today="2026-06-25")["canvas"]
        b = kb_meta.cmd_triage_canvas(str(self.vault), today="2026-06-25")["canvas"]
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
