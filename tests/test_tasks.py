"""Tests for Phase 5: knowledge-task tracking."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from compiler.holons.holon import Holon, HolonSet
from compiler.tasks import frozen_tasks, list_tasks, task_stats, tasks_by_status


def _hs() -> HolonSet:
    return HolonSet(holons=[
        Holon("concepts/attention", "research", "Finding", "Attention", "", "h1", status="active"),
        Holon("tasks/kv-cache", "knowledge-task", "Concept", "KV Cache", "", "h2", status="active"),
        Holon("tasks/rope-docs", "knowledge-task", "Concept", "RoPE Docs", "", "h3", status="frozen"),
        Holon("tasks/flash-attn", "knowledge-task", "Concept", "Flash Attn", "", "h4", status="active"),
        Holon("decisions/use-rope", "decision", "Decision", "Use RoPE", "", "h5", status="frozen"),
    ])


class TestListTasks:
    def test_excludes_non_tasks(self):
        tasks = list_tasks(_hs())
        ids = {t.id for t in tasks}
        assert "concepts/attention" not in ids
        assert "decisions/use-rope" not in ids

    def test_includes_all_knowledge_tasks(self):
        tasks = list_tasks(_hs())
        assert len(tasks) == 3

    def test_sorted_by_id(self):
        tasks = list_tasks(_hs())
        ids = [t.id for t in tasks]
        assert ids == sorted(ids)

    def test_empty_holonset(self):
        assert list_tasks(HolonSet()) == []


class TestTaskStats:
    def test_total_count(self):
        ts = task_stats(_hs())
        assert ts.total == 3

    def test_by_status_active(self):
        ts = task_stats(_hs())
        assert ts.by_status["active"] == 2

    def test_by_status_frozen(self):
        ts = task_stats(_hs())
        assert ts.by_status["frozen"] == 1

    def test_empty_vault(self):
        ts = task_stats(HolonSet())
        assert ts.total == 0
        assert ts.by_status == {}


class TestTasksByStatus:
    def test_active_tasks(self):
        active = tasks_by_status(_hs(), "active")
        assert all(t.status == "active" for t in active)
        assert len(active) == 2

    def test_frozen_tasks(self):
        fz = tasks_by_status(_hs(), "frozen")
        assert len(fz) == 1
        assert fz[0].id == "tasks/rope-docs"

    def test_unknown_status_returns_empty(self):
        assert tasks_by_status(_hs(), "archived") == []


class TestFrozenTasks:
    def test_only_frozen_knowledge_tasks(self):
        fz = frozen_tasks(_hs())
        assert len(fz) == 1
        assert fz[0].kind == "knowledge-task"
        assert fz[0].status == "frozen"

    def test_frozen_decision_excluded(self):
        ids = {t.id for t in frozen_tasks(_hs())}
        assert "decisions/use-rope" not in ids
