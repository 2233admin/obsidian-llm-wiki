#!/usr/bin/env python3
# notebooklm-collector.py -- NotebookLM bridge for vault-mind (experimental)
# Wraps notebooklm-py (https://github.com/teng-lin/notebooklm-py), an UNOFFICIAL
# client for Google's undocumented NotebookLM RPC APIs. Expect breakage when
# Google changes things. Requires: pip install notebooklm-py && notebooklm login
#
# Usage:
#   python notebooklm-collector.py push   --vault <path> --notebook <title> <file.md> [...]
#   python notebooklm-collector.py ask    --vault <path> --notebook <title> "question"
#   python notebooklm-collector.py report --vault <path> --notebook <title> [--format briefing-doc]
#
# Output: one JSON object on stdout. Exit 0 = ok, 1 = error, 2 = not logged in.

import argparse
import asyncio
import json
import re
import sys
from datetime import date
from pathlib import Path

try:
    from notebooklm import NotebookLMClient
except ImportError:
    print(json.dumps({"ok": False, "error": "notebooklm-py not installed: pip install notebooklm-py"}))
    sys.exit(1)

AUTH_STATE = Path.home() / ".notebooklm" / "profiles" / "default" / "storage_state.json"


def slugify(text):
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", text.lower()))[:60]


def require_auth():
    if not AUTH_STATE.exists():
        print(json.dumps({"ok": False, "error": f"not logged in: run `notebooklm login` first (expected {AUTH_STATE})"}))
        sys.exit(2)


async def find_or_create_notebook(client, title):
    for nb in await client.notebooks.list():
        if nb.title == title:
            return nb, False
    return await client.notebooks.create(title), True


async def cmd_push(args):
    files = [Path(f) for f in args.files]
    missing = [str(f) for f in files if not f.exists()]
    if missing:
        return {"ok": False, "error": f"files not found: {missing}"}
    async with NotebookLMClient.from_storage() as client:
        nb, created = await find_or_create_notebook(client, args.notebook)
        pushed = []
        for f in files:
            src = await client.sources.add_file(
                nb.id, str(f), mime_type="text/markdown", title=f.stem, wait=True,
            )
            pushed.append({"file": str(f), "source_id": src.id, "status": src.status})
        return {"ok": True, "notebook_id": nb.id, "notebook_created": created, "pushed": pushed}


async def cmd_ask(args):
    vault = Path(args.vault)
    async with NotebookLMClient.from_storage() as client:
        nb, created = await find_or_create_notebook(client, args.notebook)
        if created:
            return {"ok": False, "error": f"notebook '{args.notebook}' had no sources (just created); push first"}
        result = await client.chat.ask(nb.id, args.question)

        today = date.today().isoformat()
        slug = slugify(args.question)
        rel = f"00-Inbox/NotebookLM/{today}--{slug}.md"
        out = vault / rel
        out.parent.mkdir(parents=True, exist_ok=True)

        citations = "\n".join(
            f"- [{r.citation_number}] {r.cited_text or '(no excerpt)'} (source: {r.source_id})"
            for r in result.references
        ) or "- (none returned)"
        out.write_text(
            f"---\n"
            f"type: notebooklm-answer\n"
            f"ai-first: true\n"
            f"generated-by: notebooklm\n"
            f"notebook: \"{args.notebook}\"\n"
            f"question: \"{args.question}\"\n"
            f"created: {today}\n"
            f"status: draft\n"
            f"---\n\n"
            f"## For future Claude\n"
            f"NotebookLM's cited answer to \"{args.question}\" against notebook \"{args.notebook}\". "
            f"Citations reference NotebookLM source IDs, not vault paths.\n\n"
            f"## Answer\n\n{result.answer}\n\n"
            f"## Citations\n\n{citations}\n",
            encoding="utf-8",
        )
        return {"ok": True, "note": rel, "citations": len(result.references), "conversation_id": result.conversation_id}


async def cmd_report(args):
    vault = Path(args.vault)
    async with NotebookLMClient.from_storage() as client:
        nb, created = await find_or_create_notebook(client, args.notebook)
        if created:
            return {"ok": False, "error": f"notebook '{args.notebook}' had no sources (just created); push first"}
        status = await client.artifacts.generate_report(nb.id, report_format=args.format)
        completed = await client.artifacts.wait_for_completion(nb.id, status.task_id, timeout=600.0)
        if completed.status != "COMPLETED":
            return {"ok": False, "error": f"generation ended as {completed.status}", "task_id": status.task_id}

        today = date.today().isoformat()
        rel = f"Research/NotebookLM/{today}--{slugify(args.notebook)}--{args.format}.md"
        out = vault / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        await client.artifacts.download_report(nb.id, str(out), artifact_id=completed.artifact_id)
        return {"ok": True, "report": rel, "format": args.format}


def main():
    p = argparse.ArgumentParser(description="NotebookLM <-> vault bridge")
    sub = p.add_subparsers(dest="cmd", required=True)

    pp = sub.add_parser("push")
    pp.add_argument("--vault", required=True)
    pp.add_argument("--notebook", required=True)
    pp.add_argument("files", nargs="+")

    pa = sub.add_parser("ask")
    pa.add_argument("--vault", required=True)
    pa.add_argument("--notebook", required=True)
    pa.add_argument("question")

    pr = sub.add_parser("report")
    pr.add_argument("--vault", required=True)
    pr.add_argument("--notebook", required=True)
    pr.add_argument("--format", default="briefing-doc")

    args = p.parse_args()
    require_auth()
    handler = {"push": cmd_push, "ask": cmd_ask, "report": cmd_report}[args.cmd]
    try:
        result = asyncio.run(handler(args))
    except Exception as e:
        result = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
