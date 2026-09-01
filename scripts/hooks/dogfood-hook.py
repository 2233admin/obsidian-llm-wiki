#!/usr/bin/env python3
# dogfood-hook: append usage records to .dogfood.log for Week-12 pruning analysis.
# Fires from project .claude/settings.json on PostToolUse (mcp__vault-mind*) and Stop.
# Stdlib-only, zero-dep. Non-blocking: exits 0 on any error.

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOG = ROOT / ".dogfood.log"


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "unknown"
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except (json.JSONDecodeError, OSError, UnicodeError):
        payload = {}

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    tool = "-"
    op = "-"
    note = ""

    if mode == "posttool":
        name = payload.get("tool_name", "")
        if not name.startswith("mcp__vault-mind"):
            return
        tool = "vault-mind"
        # strip mcp__vault-mind__ or mcp__vault-mind-connector__
        op = name.split("__", 2)[-1] if "__" in name else name
        tool_input = payload.get("tool_input", {}) or {}
        if isinstance(tool_input, dict):
            q = tool_input.get("query") or tool_input.get("path") or tool_input.get("id")
            if q:
                note = str(q)[:120].replace("\t", " ").replace("\n", " ")
    elif mode == "stop":
        tool = "session"
        op = "session-end"
        sid = payload.get("session_id", "")
        note = sid[:8] if sid else ""
    else:
        return

    line = f"{ts}\t{tool}\t{op}\t{note}\n"
    try:
        with LOG.open("a", encoding="utf-8") as f:
            f.write(line)
    except OSError:
        return


if __name__ == "__main__":
    try:
        main()
    except (AttributeError, IndexError, OSError, TypeError, UnicodeError, ValueError):
        sys.exit(0)
