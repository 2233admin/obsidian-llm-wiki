from __future__ import annotations

import subprocess

from compiler.docket import gitops
from compiler.docket.task import (
    KnowledgeTask,
    close_task,
    create_task,
    read_task,
    update_task,
)


def test_create_task_writes_frontmatter_and_uses_auto_commit_boundary(tmp_path, monkeypatch):
    calls = []

    def fake_auto_commit(path, message=None, **kwargs):
        calls.append((path, message, kwargs))
        return gitops.AutoCommitResult(
            path=path,
            message=message or "",
            dry_run=True,
            committed=False,
            commands=(),
        )

    monkeypatch.setattr("compiler.docket.gitops.auto_commit", fake_auto_commit)

    task = create_task(
        tmp_path,
        task_id="TASK-001",
        title="Compile vault tasks",
        task_type="compile",
        source_note="10-External/source.md",
        target_note="04-Research/target.md",
        blocked_by=["TASK-000"],
        today="2026-06-20",
    )

    path = tmp_path / "TASK-001.md"
    assert path.exists()
    assert task.state_type == "blocked"
    assert task.blocked_by == ["TASK-000"]
    assert read_task(path) == task
    assert calls == [(path, "task: create TASK-001", {})]


def test_update_task_updates_fields_blockers_and_timestamp(tmp_path):
    create_task(
        tmp_path,
        task_id="TASK-002",
        title="Review context core",
        today="2026-06-20",
        auto_commit=False,
    )
    path = tmp_path / "TASK-002.md"

    task = update_task(
        path,
        status="In Progress",
        state_type="started",
        blocked_by=["TASK-001", "TASK-000"],
        body="Work started.",
        today="2026-06-21",
        auto_commit=False,
    )

    assert task.status == "In Progress"
    assert task.state_type == "started"
    assert task.blocked_by == ["TASK-001", "TASK-000"]
    assert task.updated == "2026-06-21"
    assert read_task(path).body == "Work started."


def test_close_task_marks_done_and_clears_blockers(tmp_path):
    create_task(
        tmp_path,
        task_id="TASK-003",
        title="Close me",
        blocked_by=["TASK-002"],
        today="2026-06-20",
        auto_commit=False,
    )
    path = tmp_path / "TASK-003.md"

    task = close_task(path, today="2026-06-22", auto_commit=False)

    assert task.status == "Done"
    assert task.state_type == "done"
    assert task.blocked_by == []
    assert task.updated == "2026-06-22"
    assert read_task(path) == task


def test_frontmatter_roundtrip_preserves_blocked_by_alias_and_body():
    markdown = (
        "---\n"
        "id: TASK-004\n"
        "title: Round trip\n"
        "status: Todo\n"
        "state_type: unstarted\n"
        "task_type: ingest\n"
        "source_note: 10-External/input.md\n"
        "target_note: 04-Research/output.md\n"
        "blocked-by: [TASK-001, TASK-002]\n"
        "created: 2026-06-20\n"
        "updated: 2026-06-21\n"
        "---\n"
        "Body text.\n"
    )

    task = KnowledgeTask.from_markdown(markdown)

    assert task.blocked_by == ["TASK-001", "TASK-002"]
    assert KnowledgeTask.from_markdown(task.to_markdown()) == task


def test_auto_commit_is_dry_run_by_default(tmp_path):
    path = tmp_path / "TASK-005.md"
    path.write_text("content", encoding="utf-8")

    result = gitops.auto_commit(path, message="task: update TASK-005")

    assert result.dry_run is True
    assert result.committed is False
    assert result.commands == (
        ("git", "add", str(path)),
        ("git", "commit", "-m", "task: update TASK-005"),
    )


def test_auto_commit_runner_boundary_when_explicitly_enabled(tmp_path):
    path = tmp_path / "TASK-006.md"
    path.write_text("content", encoding="utf-8")
    commands = []

    def fake_runner(command, check):
        commands.append((tuple(command), check))
        return subprocess.CompletedProcess(command, 0)

    result = gitops.auto_commit(
        path,
        message="task: update TASK-006",
        dry_run=False,
        runner=fake_runner,
    )

    assert result.committed is True
    assert commands == [
        (("git", "add", str(path)), True),
        (("git", "commit", "-m", "task: update TASK-006"), True),
    ]
