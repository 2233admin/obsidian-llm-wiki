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

try:
    from ._md_parse import extract_wikilinks, parse_frontmatter
except ImportError:
    from _md_parse import extract_wikilinks, parse_frontmatter

H1_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)


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


def collect_tags(text: str) -> list[str]:
    fm = parse_frontmatter(text)
    raw = fm.get("tags") or fm.get("tag") or []
    if isinstance(raw, str):
        raw = [raw]
    return [t for t in raw if t]


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


def edge_confidence(llm_confidence: float, wikilink_cooccur: float) -> float:
    return (0.7 * float(llm_confidence)) + (0.3 * float(wikilink_cooccur))


def wikilink_cooccur(
    source_id: str,
    target_id: str,
    wikilink_graph: dict[str, set[str]],
) -> float:
    if target_id in wikilink_graph.get(source_id, set()):
        return 1.0
    for intermediate in wikilink_graph.get(source_id, set()):
        if target_id in wikilink_graph.get(intermediate, set()):
            return 0.5
    return 0.0


def build_wikilink_adjacency(graph: dict) -> dict[str, set[str]]:
    adjacency: dict[str, set[str]] = {}
    for edge in graph.get("edges", []):
        if edge.get("kind") != "wikilink" or not edge.get("resolved", True):
            continue
        adjacency.setdefault(edge["src"], set()).add(edge["dst"])
    return adjacency


def merge_causal_layer(graph: dict, holons: list[dict]) -> dict:
    wikilinks = build_wikilink_adjacency(graph)
    causal_edges: list[dict] = []

    for holon in holons:
        source_id = holon.get("id")
        if not source_id:
            continue
        for fact in holon.get("facts", []):
            relation = fact.get("relation")
            target_id = fact.get("target_id") or fact.get("target")
            if not relation or not target_id:
                continue
            cooccur = wikilink_cooccur(source_id, target_id, wikilinks)
            llm_confidence = float(fact.get("confidence", 0.6))
            causal_edges.append(
                {
                    "src": source_id,
                    "dst": target_id,
                    "kind": "causal",
                    "relation": relation,
                    "confidence": edge_confidence(llm_confidence, cooccur),
                    "llm_confidence": llm_confidence,
                    "wikilink_cooccur": cooccur,
                    "claim": fact.get("claim", ""),
                    "evidence": fact.get("evidence", ""),
                    "trust_level": fact.get("trust_level", "extracted"),
                }
            )

    merged = dict(graph)
    merged["causal_edges"] = causal_edges
    merged["contradictions"] = detect_causal_contradictions(causal_edges)
    stats = dict(graph.get("stats", {}))
    stats["causal_edges"] = len(causal_edges)
    stats["contradiction_count"] = len(merged["contradictions"])
    merged["stats"] = stats
    return merged


def detect_causal_contradictions(causal_edges: list[dict]) -> list[dict]:
    by_pair: dict[tuple[str, str], list[dict]] = {}
    for edge in causal_edges:
        relation = edge.get("relation")
        if relation not in {"causes", "prevents"}:
            continue
        key = (edge.get("src", ""), edge.get("dst", ""))
        by_pair.setdefault(key, []).append(edge)

    contradictions: list[dict] = []
    for (source_id, target_id), edges in by_pair.items():
        relations = {edge.get("relation") for edge in edges}
        if {"causes", "prevents"}.issubset(relations):
            contradictions.append(
                {
                    "source_id": source_id,
                    "target_id": target_id,
                    "relations": sorted(relations),
                    "edges": edges,
                }
            )
    return contradictions


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
