#!/usr/bin/env python3
"""Concept graph v0 -- emit JSON graph of the vault.

Nodes: every scanned .md (id = vault-relative posix path, title = stem or H1).
Edges: existing [[wikilinks]] resolved against stems + frontmatter aliases +
       H1 headings. Unresolved links kept as edges with resolved=false so
       dangling references stay visible.

No LLM, no embeddings, stdlib-only. Pass 2 (LLM concept extraction) is
reserved for later.

Usage:
    python concept_graph.py <vault> [--output PATH] [--skip DIR]
                            [--include-archive] [--limit N]

Output:
    ./.compile/graph.json (or --output)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path

DEFAULT_SKIP = {
    ".obsidian", ".trash", ".git", ".smart-env", ".omc",
    "Excalidraw", "KB", "08-Templates", "data",
}
ARCHIVE_DIRS = {"09-Archive", "10-External"}

FENCE_RE = re.compile(r"```.*?```", re.DOTALL)
INLINE_CODE_RE = re.compile(r"`[^`\n]+`")
FRONTMATTER_RE = re.compile(r"\A---\n.*?\n---\n", re.DOTALL)
H1_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)
WIKILINK_RE = re.compile(r"\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|[^\]\n]+)?\]\]")


@dataclass
class Node:
    id: str
    title: str
    path: str
    tags: list[str] = field(default_factory=list)


@dataclass
class Edge:
    src: str
    dst: str
    resolved: bool = True
    kind: str = "wikilink"


def parse_frontmatter(text: str) -> dict:
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}
    fm = m.group(0)
    out: dict = {}
    current_key: str | None = None
    for raw in fm.splitlines():
        if raw.strip() in ("", "---"):
            continue
        if re.match(r"^[A-Za-z_][\w-]*\s*:", raw):
            k, _, v = raw.partition(":")
            k = k.strip()
            v = v.strip()
            if v.startswith("[") and v.endswith("]"):
                out[k] = [x.strip().strip("'\"") for x in v[1:-1].split(",") if x.strip()]
                current_key = None
            elif v:
                out[k] = v.strip("'\"")
                current_key = None
            else:
                out[k] = []
                current_key = k
        elif current_key and raw.lstrip().startswith("- "):
            val = raw.lstrip()[2:].strip().strip("'\"")
            lst = out.get(current_key)
            if isinstance(lst, list):
                lst.append(val)
    return out


def collect_tags(text: str) -> list[str]:
    fm = parse_frontmatter(text)
    raw = fm.get("tags") or fm.get("tag") or []
    if isinstance(raw, str):
        raw = [raw]
    return [t for t in raw if t]


def strip_noise(text: str) -> str:
    t = FRONTMATTER_RE.sub("", text, count=1)
    t = FENCE_RE.sub("", t)
    t = INLINE_CODE_RE.sub("", t)
    return t


def extract_wikilinks(text: str) -> list[str]:
    cleaned = strip_noise(text)
    return [m.group(1).strip() for m in WIKILINK_RE.finditer(cleaned)]


def iter_vault_md(vault: Path, skip_dirs: set[str]):
    for md in vault.rglob("*.md"):
        rel_parts = md.relative_to(vault).parts
        if any(part in skip_dirs for part in rel_parts):
            continue
        yield md


def _node_id(vault: Path, md: Path) -> str:
    return md.relative_to(vault).as_posix()


def _title_of(md: Path, text: str) -> str:
    h1 = H1_RE.search(text)
    if h1:
        return h1.group(1).strip()
    return md.stem


def build_graph(vault: Path, skip_dirs: set[str], limit: int = 0) -> dict:
    # pass 1: build nodes + alias->node_id index
    nodes: list[Node] = []
    alias_index: dict[str, str] = {}
    node_texts: dict[str, str] = {}

    scanned = 0
    for md in iter_vault_md(vault, skip_dirs):
        if limit and scanned >= limit:
            break
        try:
            text = md.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        node_id = _node_id(vault, md)
        fm = parse_frontmatter(text)
        title = _title_of(md, text)
        tags = collect_tags(text)
        nodes.append(Node(id=node_id, title=title, path=md.as_posix(), tags=tags))
        node_texts[node_id] = text

        aliases: list[str] = []
        raw = fm.get("aliases") or fm.get("alias") or []
        if isinstance(raw, str):
            raw = [raw]
        aliases.extend(raw)

        for name in [md.stem, title, *aliases]:
            if not name:
                continue
            alias_index.setdefault(name.strip().lower(), node_id)
        scanned += 1

    # pass 2: extract wikilinks and resolve
    edges: list[Edge] = []
    unresolved = 0
    wikilink_edges = 0
    seen: set[tuple[str, str, str]] = set()
    for node_id, text in node_texts.items():
        for raw_target in extract_wikilinks(text):
            target_key = raw_target.strip().lower()
            dst = alias_index.get(target_key)
            resolved = dst is not None
            if not resolved:
                dst = raw_target.strip()
                unresolved += 1
            triple = (node_id, dst, "wikilink")
            if triple in seen:
                continue
            seen.add(triple)
            edges.append(Edge(src=node_id, dst=dst, resolved=resolved, kind="wikilink"))
            wikilink_edges += 1

    # pass 3: emit tag edges (dst = "tag:X", resolved=True since tag exists on node)
    # Consumer can synthesize tag-nodes by collecting distinct dst values where kind=="tag".
    tag_edges = 0
    for node in nodes:
        for tag in node.tags:
            tag_dst = f"tag:{tag}"
            triple = (node.id, tag_dst, "tag")
            if triple in seen:
                continue
            seen.add(triple)
            edges.append(Edge(src=node.id, dst=tag_dst, resolved=True, kind="tag"))
            tag_edges += 1

    return {
        "generated": datetime.now().isoformat(timespec="seconds"),
        "vault": vault.as_posix(),
        "nodes": [asdict(n) for n in nodes],
        "edges": [asdict(e) for e in edges],
        "stats": {
            "scanned": scanned,
            "nodes": len(nodes),
            "edges": len(edges),
            "wikilink_edges": wikilink_edges,
            "tag_edges": tag_edges,
            "unresolved": unresolved,
        },
    }


def run(vault: Path, output: Path, skip_dirs: set[str], limit: int = 0) -> dict:
    graph = build_graph(vault, skip_dirs, limit=limit)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")
    return graph["stats"]


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("vault", type=Path)
    p.add_argument("--output", type=Path, default=None)
    p.add_argument("--skip", action="append", default=[])
    p.add_argument("--include-archive", action="store_true")
    p.add_argument("--limit", type=int, default=0)
    args = p.parse_args(argv)

    vault = args.vault.resolve()
    if not vault.exists():
        print(f"error: vault {vault} not found", file=sys.stderr)
        return 2

    skip = set(DEFAULT_SKIP) | set(args.skip)
    if not args.include_archive:
        skip |= ARCHIVE_DIRS

    output = args.output or (Path.cwd() / ".compile" / "graph.json")
    stats = run(vault, output, skip, limit=args.limit)
    print(
        f"[concept_graph] scanned={stats['scanned']} "
        f"nodes={stats['nodes']} edges={stats['edges']} "
        f"(wikilink={stats['wikilink_edges']} tag={stats['tag_edges']}) "
        f"unresolved={stats['unresolved']} -> {output}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
