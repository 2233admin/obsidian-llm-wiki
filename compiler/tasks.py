"""Phase 5: vault task tracking — query knowledge-tasks from compiled HolonSet."""

from __future__ import annotations

from dataclasses import dataclass

from .holons.holon import Holon, HolonSet


@dataclass
class TaskStats:
    total: int
    by_status: dict[str, int]


def list_tasks(holon_set: HolonSet) -> list[Holon]:
    """Return all holons with kind='knowledge-task', sorted by id."""
    return sorted(
        (h for h in holon_set.holons if h.kind == "knowledge-task"),
        key=lambda h: h.id,
    )


def task_stats(holon_set: HolonSet) -> TaskStats:
    tasks = list_tasks(holon_set)
    by_status: dict[str, int] = {}
    for t in tasks:
        by_status[t.status] = by_status.get(t.status, 0) + 1
    return TaskStats(total=len(tasks), by_status=by_status)


def tasks_by_status(holon_set: HolonSet, status: str) -> list[Holon]:
    return [h for h in list_tasks(holon_set) if h.status == status]


def frozen_tasks(holon_set: HolonSet) -> list[Holon]:
    """Frozen knowledge-tasks are immutable decisions — never re-open."""
    return tasks_by_status(holon_set, "frozen")
