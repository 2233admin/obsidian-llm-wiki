from __future__ import annotations

from pathlib import Path
from typing import Any


class FrontmatterError(ValueError):
    pass


def parse_markdown(path: Path) -> tuple[dict[str, Any], str]:
    text = path.read_text(encoding="utf-8")
    return parse_markdown_text(text, path)


def parse_markdown_text(text: str, path: Path | None = None) -> tuple[dict[str, Any], str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        name = str(path) if path else "markdown text"
        raise FrontmatterError(f"{name}: missing YAML frontmatter")
    try:
        end = next(index for index, line in enumerate(lines[1:], start=1) if line.strip() == "---")
    except StopIteration as exc:
        name = str(path) if path else "markdown text"
        raise FrontmatterError(f"{name}: unterminated YAML frontmatter") from exc
    frontmatter = parse_flat_yaml(lines[1:end])
    body = "\n".join(lines[end + 1 :])
    if text.endswith("\n"):
        body += "\n"
    return frontmatter, body


def parse_flat_yaml(lines: list[str]) -> dict[str, Any]:
    data: dict[str, Any] = {}
    current_key: str | None = None
    for raw in lines:
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if raw.startswith("  - "):
            if current_key is None:
                raise FrontmatterError("list item without key")
            data.setdefault(current_key, []).append(parse_scalar(raw[4:].strip()))
            continue
        if ":" not in raw:
            raise FrontmatterError(f"unsupported frontmatter line: {raw}")
        key, value = raw.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            raise FrontmatterError(f"empty frontmatter key: {raw}")
        if value == "":
            data[key] = []
            current_key = key
        else:
            data[key] = parse_scalar(value)
            current_key = None
    return data


def parse_scalar(value: str) -> Any:
    if value == "[]":
        return []
    if value in {"true", "false"}:
        return value == "true"
    if value in {"null", "~"}:
        return None
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1].replace('\\"', '"')
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1].replace("''", "'")
    try:
        return int(value)
    except ValueError:
        return value


def render_markdown(frontmatter: dict[str, Any], body: str) -> str:
    lines = ["---"]
    for key, value in frontmatter.items():
        lines.extend(render_yaml_item(key, value))
    lines.append("---")
    lines.append("")
    lines.append(body.rstrip())
    return "\n".join(lines).rstrip() + "\n"


def render_yaml_item(key: str, value: Any) -> list[str]:
    if isinstance(value, list):
        rendered = [f"{key}:"]
        if not value:
            return [f"{key}: []"]
        rendered.extend(f"  - {format_scalar(item)}" for item in value)
        return rendered
    return [f"{key}: {format_scalar(value)}"]


def format_scalar(value: Any) -> str:
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    if isinstance(value, int):
        return str(value)
    text = str(value)
    if text == "" or text.strip() != text or text in {"[]", "true", "false", "null", "~"} or any(ch in text for ch in [":", "#", "[", "]", "{", "}", ","]):
        return '"' + text.replace('"', '\\"') + '"'
    return text


