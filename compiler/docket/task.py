from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from datetime import date
from pathlib import Path
from typing import Any

from . import gitops


FRONTMATTER_BOUNDARY = "---"
DEFAULT_STATUS = "Todo"
DEFAULT_STATE_TYPE = "unstarted"
CLOSED_STATUS = "Done"
CLOSED_STATE_TYPE = "done"
FIELD_ORDER = (
    "id",
    "title",
    "status",
    "state_type",
    "task_type",
    "source_note",
    "target_note",
    "blocked_by",
    "created",
    "updated",
)


@dataclass(frozen=True)
class KnowledgeTask:
    id: str
    title: str
    status: str = DEFAULT_STATUS
    state_type: str = DEFAULT_STATE_TYPE
    task_type: str = "review"
    source_note: str | None = None
    target_note: str | None = None
    blocked_by: list[str] = field(default_factory=list)
    created: str = field(default_factory=lambda: date.today().isoformat())
    updated: str = field(default_factory=lambda: date.today().isoformat())
    body: str = ""

    @classmethod
    def from_markdown(cls, text: str) -> "KnowledgeTask":
        frontmatter, body = parse_markdown(text)
        return cls.from_frontmatter(frontmatter, body=body)

    @classmethod
    def from_frontmatter(cls, frontmatter: dict[str, Any], *, body: str = "") -> "KnowledgeTask":
        blocked_by = frontmatter.get("blocked_by", frontmatter.get("blocked-by", []))
        if isinstance(blocked_by, str):
            blocked_by = [blocked_by] if blocked_by else []
        elif blocked_by is None:
            blocked_by = []
        elif not isinstance(blocked_by, list):
            blocked_by = [str(blocked_by)]

        task_id = _required_str(frontmatter, "id")
        title = _required_str(frontmatter, "title")
        today = date.today().isoformat()
        return cls(
            id=task_id,
            title=title,
            status=str(frontmatter.get("status") or DEFAULT_STATUS),
            state_type=str(frontmatter.get("state_type") or DEFAULT_STATE_TYPE),
            task_type=str(frontmatter.get("task_type") or "review"),
            source_note=_optional_str(frontmatter.get("source_note")),
            target_note=_optional_str(frontmatter.get("target_note")),
            blocked_by=[str(item) for item in blocked_by],
            created=str(frontmatter.get("created") or today),
            updated=str(frontmatter.get("updated") or today),
            body=body,
        )

    def to_frontmatter(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "status": self.status,
            "state_type": self.state_type,
            "task_type": self.task_type,
            "source_note": self.source_note,
            "target_note": self.target_note,
            "blocked_by": list(self.blocked_by),
            "created": self.created,
            "updated": self.updated,
        }

    def to_markdown(self) -> str:
        return render_markdown(self.to_frontmatter(), self.body)

    def with_changes(self, *, today: str | None = None, **changes: Any) -> "KnowledgeTask":
        if "blocked-by" in changes:
            changes["blocked_by"] = changes.pop("blocked-by")

        if "blocked_by" in changes:
            changes["blocked_by"] = _normalize_blocked_by(changes["blocked_by"])
            if "state_type" not in changes:
                changes["state_type"] = "blocked" if changes["blocked_by"] else DEFAULT_STATE_TYPE

        if "body" in changes and changes["body"] is None:
            changes["body"] = ""

        changes["updated"] = today or date.today().isoformat()
        return replace(self, **changes)


def create_task(
    tasks_dir: str | Path,
    *,
    task_id: str,
    title: str,
    task_type: str = "review",
    source_note: str | None = None,
    target_note: str | None = None,
    blocked_by: list[str] | None = None,
    body: str = "",
    today: str | None = None,
    auto_commit: bool = True,
) -> KnowledgeTask:
    stamp = today or date.today().isoformat()
    blockers = _normalize_blocked_by(blocked_by or [])
    task = KnowledgeTask(
        id=task_id,
        title=title,
        status=DEFAULT_STATUS,
        state_type="blocked" if blockers else DEFAULT_STATE_TYPE,
        task_type=task_type,
        source_note=source_note,
        target_note=target_note,
        blocked_by=blockers,
        created=stamp,
        updated=stamp,
        body=body,
    )
    path = task_path(tasks_dir, task_id)
    write_task(path, task, auto_commit=auto_commit, message=f"task: create {task_id}")
    return task


def read_task(path: str | Path) -> KnowledgeTask:
    return KnowledgeTask.from_markdown(Path(path).read_text(encoding="utf-8"))


def write_task(
    path: str | Path,
    task: KnowledgeTask,
    *,
    auto_commit: bool = True,
    message: str | None = None,
) -> KnowledgeTask:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(task.to_markdown(), encoding="utf-8", newline="\n")
    if auto_commit:
        gitops.auto_commit(target, message=message or f"task: update {task.id}")
    return task


def update_task(
    path: str | Path,
    *,
    today: str | None = None,
    auto_commit: bool = True,
    **changes: Any,
) -> KnowledgeTask:
    task = read_task(path).with_changes(today=today, **changes)
    write_task(path, task, auto_commit=auto_commit, message=f"task: update {task.id}")
    return task


def close_task(
    path: str | Path,
    *,
    today: str | None = None,
    auto_commit: bool = True,
) -> KnowledgeTask:
    return update_task(
        path,
        status=CLOSED_STATUS,
        state_type=CLOSED_STATE_TYPE,
        blocked_by=[],
        today=today,
        auto_commit=auto_commit,
    )


def task_path(tasks_dir: str | Path, task_id: str) -> Path:
    filename = re.sub(r"[^A-Za-z0-9._-]+", "-", task_id).strip("-") or "task"
    return Path(tasks_dir) / f"{filename}.md"


def parse_markdown(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith(f"{FRONTMATTER_BOUNDARY}\n"):
        raise ValueError("KnowledgeTask markdown must start with frontmatter")

    end = text.find(f"\n{FRONTMATTER_BOUNDARY}", len(FRONTMATTER_BOUNDARY) + 1)
    if end == -1:
        raise ValueError("KnowledgeTask markdown frontmatter is not closed")

    raw_frontmatter = text[len(FRONTMATTER_BOUNDARY) + 1 : end]
    body = text[end + len(FRONTMATTER_BOUNDARY) + 2 :]
    if body.startswith("\n"):
        body = body[1:]
    return parse_frontmatter(raw_frontmatter), body


def parse_frontmatter(raw_frontmatter: str) -> dict[str, Any]:
    frontmatter: dict[str, Any] = {}
    current_key: str | None = None
    for raw_line in raw_frontmatter.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("- ") and current_key:
            value = _parse_scalar(line[2:].strip())
            existing = frontmatter.setdefault(current_key, [])
            if not isinstance(existing, list):
                raise ValueError(f"frontmatter key {current_key!r} mixes scalar and list values")
            existing.append(value)
            continue
        if ":" not in raw_line:
            continue
        key, value = raw_line.split(":", 1)
        current_key = key.strip()
        frontmatter[current_key] = _parse_value(value.strip())
    return frontmatter


def render_markdown(frontmatter: dict[str, Any], body: str = "") -> str:
    lines = [FRONTMATTER_BOUNDARY]
    for key in FIELD_ORDER:
        value = frontmatter.get(key)
        if value is None:
            continue
        lines.append(_render_field(key, value))
    for key in sorted(k for k in frontmatter if k not in FIELD_ORDER and frontmatter[k] is not None):
        lines.append(_render_field(key, frontmatter[key]))
    lines.append(FRONTMATTER_BOUNDARY)
    markdown = "\n".join(lines)
    body_text = body.lstrip("\n")
    return f"{markdown}\n{body_text}" if body_text else f"{markdown}\n"


def _required_str(frontmatter: dict[str, Any], key: str) -> str:
    value = frontmatter.get(key)
    if value is None or str(value).strip() == "":
        raise ValueError(f"KnowledgeTask requires frontmatter field {key!r}")
    return str(value)


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_blocked_by(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, list):
        return [str(item) for item in value]
    return [str(value)]


def _parse_value(value: str) -> Any:
    if value == "":
        return []
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [_parse_scalar(item.strip()) for item in inner.split(",")]
    return _parse_scalar(value)


def _parse_scalar(value: str) -> str:
    if (value.startswith('"') and value.endswith('"')) or (
        value.startswith("'") and value.endswith("'")
    ):
        return value[1:-1]
    return value


def _render_field(key: str, value: Any) -> str:
    if isinstance(value, list):
        return f"{key}: [{', '.join(str(item) for item in value)}]"
    return f"{key}: {value}"
