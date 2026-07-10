"""Hacker News connector -- top stories via the public Firebase API.

No credentials required. Enabled by default.

    topstories.json -> ordered list of story ids (current front page + more)
    item/<id>.json   -> story detail (title, url, score, descendants, ...)

API docs: https://github.com/HackerNews/API

Only the first `limit` story ids are fetched in detail (default 15) to
keep this a light, well-behaved poll rather than a firehose.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

from .base import write_markdown_entry

TOP_STORIES_URL = "https://hacker-news.firebaseio.com/v0/topstories.json"
ITEM_URL_TEMPLATE = "https://hacker-news.firebaseio.com/v0/item/{item_id}.json"
DEFAULT_LIMIT = 15
REQUEST_TIMEOUT = 10  # seconds
USER_AGENT = "vault-mind-connector/0.1 (+https://github.com/)"


def _get_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _story_to_markdown(item: dict) -> str:
    story_id = item["id"]
    title = item.get("title", "(untitled)")
    hn_url = f"https://news.ycombinator.com/item?id={story_id}"
    story_url = item.get("url", hn_url)  # self-posts have no external url
    score = item.get("score", 0)
    descendants = item.get("descendants", 0)
    author = item.get("by", "unknown")

    lines = [
        f"# {title}",
        "",
        f"- **Original link**: {story_url}",
        f"- **HN discussion**: {hn_url}",
        f"- **Score**: {score}",
        f"- **Comments**: {descendants}",
        f"- **Author**: {author}",
    ]
    return "\n".join(lines)


def fetch(output_dir: Path, limit: int = DEFAULT_LIMIT, **kwargs) -> list[Path]:
    """Fetch the top `limit` Hacker News stories and write each as markdown.

    Returns the list of file paths written (may be a partial list if some
    individual item fetches fail). Never raises -- network errors are
    logged to stderr and the function returns whatever succeeded so far.
    """
    written: list[Path] = []

    try:
        story_ids = _get_json(TOP_STORIES_URL)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        print(f"[hackernews] failed to fetch top stories list: {exc}", file=sys.stderr)
        return written

    story_ids = list(story_ids)[:limit]
    print(f"[hackernews] top stories list ok, fetching {len(story_ids)} item(s)...")

    for story_id in story_ids:
        try:
            item = _get_json(ITEM_URL_TEMPLATE.format(item_id=story_id))
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            print(f"[hackernews] failed to fetch item {story_id}: {exc}", file=sys.stderr)
            continue

        if not item or item.get("type") != "story" or item.get("deleted") or item.get("dead"):
            continue

        origin = f"https://news.ycombinator.com/item?id={item['id']}"
        path = write_markdown_entry(
            output_dir,
            filename=f"{item['id']}.md",
            source_type="hackernews",
            origin=origin,
            body=_story_to_markdown(item),
        )
        written.append(path)
        print(f"[hackernews] wrote {path}")

    return written
