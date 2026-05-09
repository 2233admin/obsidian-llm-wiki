#!/usr/bin/env python3
"""memu_sync -- bridge Obsidian vault MD files into the memU graph store.

Walks the vault, computes content hashes, diffs against the vault_sync_state
sidecar table (migration 003), embeds changed files via ollama, builds node +
edge dicts, then spawns memu_graph.cli graph-write to upsert. After the write
batch succeeds, optionally invokes graph-recall maintenance (PageRank + LPA).

Zero new deps: hashlib, urllib, subprocess, json, argparse, pathlib are all
stdlib. Re-uses compiler._md_parse and a slim re-walk of the vault rather
than reaching into compiler.concept_graph (which has different output shape).

Usage:
    python -m compiler.memu_sync [--vault PATH] [--dry-run] [--json]
                                 [--limit N] [--no-recompute]
                                 [--memu-graph-python PATH] [--dsn ...]
                                 [--user-id ...] [--ollama-url ...]
                                 [--embed-model ...]

Defaults:
    --vault          E:/knowledge
    --dsn            $MEMU_DSN or postgresql://postgres:postgres@localhost:5432/memu
    --user-id        boris
    --ollama-url     http://127.0.0.1:11434
    --embed-model    qwen3-embedding:0.6b
    --memu-graph-python  D:/projects/memu-graph/.venv/Scripts/python.exe

Skip dirs (matches B Path 1 spec):
    .obsidian, .trash, .git, .omc, .smart-env, .stfolder, node_modules, .archive
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

try:
    from ._md_parse import extract_wikilinks, parse_frontmatter
except ImportError:
    from _md_parse import extract_wikilinks, parse_frontmatter

VAULT_DEFAULT = Path("E:/knowledge")
SKIP_DIRS = {
    ".obsidian", ".trash", ".git", ".omc", ".smart-env",
    ".stfolder", "node_modules", ".archive",
}
DEFAULT_DSN = "postgresql://postgres:postgres@localhost:5432/memu"
DEFAULT_USER_ID = "boris"
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_EMBED_MODEL = "qwen3-embedding:0.6b"
DEFAULT_MEMU_GRAPH_PYTHON = "D:/projects/memu-graph/.venv/Scripts/python.exe"
EMBED_BATCH_SIZE = 8
EMBED_DIM = 1024
NODE_CONTENT_LIMIT = 4000
EMBED_INPUT_BODY_LIMIT = 500
H1_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)
TITLE_TO_NODE_KEY_LIMIT = 256


def _posix_relpath(vault: Path, md: Path) -> str:
    return md.relative_to(vault).as_posix()


def _title_of(md: Path, text: str) -> str:
    m = H1_RE.search(text)
    if m:
        return m.group(1).strip()
    return md.stem


def _iter_vault_md(vault: Path):
    """Yield Path objects for every *.md under vault, skipping SKIP_DIRS."""
    for md in vault.rglob("*.md"):
        rel_parts = md.relative_to(vault).parts
        if any(part in SKIP_DIRS for part in rel_parts):
            continue
        yield md


def _strip_frontmatter(text: str) -> str:
    """Return the body of an MD file with leading frontmatter stripped."""
    if not text.startswith("---"):
        return text
    # parse_frontmatter doesn't expose the offset; do a cheap second pass.
    lines = text.splitlines(keepends=True)
    if not lines or not lines[0].startswith("---"):
        return text
    for i in range(1, len(lines)):
        if lines[i].rstrip("\r\n") == "---":
            return "".join(lines[i + 1:])
    return text


def _collect_frontmatter_meta(fm: dict) -> tuple[list[str], list[str]]:
    """Pull tags + aliases out of a parsed frontmatter dict."""
    raw_tags = fm.get("tags") or fm.get("tag") or []
    if isinstance(raw_tags, str):
        raw_tags = [raw_tags]
    tags = [t for t in raw_tags if isinstance(t, str) and t]

    raw_aliases = fm.get("aliases") or fm.get("alias") or []
    if isinstance(raw_aliases, str):
        raw_aliases = [raw_aliases]
    aliases = [a for a in raw_aliases if isinstance(a, str) and a]
    return tags, aliases


def _build_alias_index(records: list[dict]) -> dict[str, str]:
    """Map lowercased alias/title/stem -> node_id (first wins)."""
    index: dict[str, str] = {}
    for rec in records:
        node_id = rec["node_id"]
        keys = [rec["stem"], rec["title"], *rec["aliases"]]
        for k in keys:
            if not k:
                continue
            key = k.strip().lower()
            if not key:
                continue
            index.setdefault(key, node_id)
    return index


# --------------------------------------------------------------------------
# Hash + sync state
# --------------------------------------------------------------------------

def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _load_existing_hashes(dsn: str) -> dict[str, str]:
    """Read vault_sync_state into {node_id -> source_hash}.

    Uses psycopg2 if available; falls back to memu_graph's sqlalchemy if not.
    Returns {} on any failure (silent fail + stderr warn, mirrors codebase
    convention).
    """
    try:
        # Prefer the same SQLAlchemy path memu_graph uses, since psycopg2 is a
        # transitive dep there. Keeps zero-dep promise for compiler/* itself.
        sys.path.insert(0, str(Path("D:/projects/memu-graph/src").resolve()))
        from sqlalchemy import create_engine, text

        engine = create_engine(dsn, pool_pre_ping=True)
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT node_id, source_hash FROM vault_sync_state")
            ).all()
        return {row[0]: row[1] for row in rows}
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(
            f"[memu_sync] warn: could not read vault_sync_state ({exc!r}); "
            "treating all files as new\n"
        )
        return {}


# --------------------------------------------------------------------------
# Embeddings (ollama)
# --------------------------------------------------------------------------

def _ollama_embed_batch(
    inputs: list[str],
    ollama_url: str,
    model: str,
) -> list[list[float]]:
    """POST /v1/embeddings with batched input. Returns list of vectors."""
    payload = json.dumps({"model": model, "input": inputs}).encode("utf-8")
    req = urllib.request.Request(
        url=f"{ollama_url.rstrip('/')}/v1/embeddings",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read()
    except urllib.error.URLError as exc:
        raise RuntimeError(f"ollama embeddings request failed: {exc}") from exc

    parsed = json.loads(body)
    data = parsed.get("data", [])
    if not isinstance(data, list) or len(data) != len(inputs):
        raise RuntimeError(
            f"ollama returned {len(data)} embeddings for {len(inputs)} inputs"
        )
    out: list[list[float]] = []
    for item in data:
        emb = item.get("embedding")
        if not isinstance(emb, list):
            raise RuntimeError("ollama response missing embedding list")
        if len(emb) != EMBED_DIM:
            raise RuntimeError(
                f"ollama returned {len(emb)}-d vector, expected {EMBED_DIM}"
            )
        out.append([float(x) for x in emb])
    return out


def _embed_records(
    records: list[dict],
    ollama_url: str,
    model: str,
) -> None:
    """Mutate records in-place: attach .embedding to each."""
    inputs: list[str] = []
    for rec in records:
        tags_str = " ".join(rec["tags"])
        body_snippet = rec["body"][:EMBED_INPUT_BODY_LIMIT]
        inputs.append(f"{rec['title']}\n{tags_str}\n{body_snippet}")

    for batch_start in range(0, len(inputs), EMBED_BATCH_SIZE):
        batch = inputs[batch_start:batch_start + EMBED_BATCH_SIZE]
        embeddings = _ollama_embed_batch(batch, ollama_url, model)
        for offset, emb in enumerate(embeddings):
            records[batch_start + offset]["embedding"] = emb


# --------------------------------------------------------------------------
# Vault scan
# --------------------------------------------------------------------------

def _scan_vault(vault: Path, limit: int = 0, node_id_prefix: str = "vault") -> list[dict]:
    """Walk vault, build per-file record dicts (no embeddings yet)."""
    records: list[dict] = []
    scanned = 0
    for md in _iter_vault_md(vault):
        if limit and scanned >= limit:
            break
        try:
            raw = md.read_bytes()
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"[memu_sync] warn: cannot read {md}: {exc!r}\n")
            continue
        try:
            text = raw.decode("utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(f"[memu_sync] warn: cannot decode {md}: {exc!r}\n")
            continue

        relpath = _posix_relpath(vault, md)
        node_id = f"{node_id_prefix}:{relpath}"
        fm = parse_frontmatter(text)
        tags, aliases = _collect_frontmatter_meta(fm)
        title = _title_of(md, text)
        body = _strip_frontmatter(text)
        source_hash = _hash_bytes(raw)
        size_bytes = len(raw)

        records.append(
            {
                "node_id": node_id,
                "relpath": relpath,
                "stem": md.stem,
                "title": title,
                "tags": tags,
                "aliases": aliases,
                "body": body,
                "text": text,
                "source_hash": source_hash,
                "size_bytes": size_bytes,
            }
        )
        scanned += 1
    return records


# --------------------------------------------------------------------------
# Build node/edge payloads
# --------------------------------------------------------------------------

def _build_node_payload(
    rec: dict,
    vault_root: str,
    user_id: str,
    node_type: str = "VAULT_NOTE",
    source_label: str = "obsidian",
) -> dict:
    description = json.dumps(
        {
            "source": source_label,
            "vault_root": vault_root,
            "relpath": rec["relpath"],
            "tags": rec["tags"],
            "aliases": rec["aliases"],
        },
        ensure_ascii=False,
    )
    name = f"{rec['title']} [{rec['relpath']}]"
    if len(name) > TITLE_TO_NODE_KEY_LIMIT:
        # gm_nodes.name has UNIQUE constraint; truncate but keep the
        # disambiguator (relpath) -- title gets clipped instead.
        keep_relpath = f" [{rec['relpath']}]"
        budget = TITLE_TO_NODE_KEY_LIMIT - len(keep_relpath)
        if budget < 8:
            # Path itself is huge; fall back to bare relpath.
            name = rec["relpath"][:TITLE_TO_NODE_KEY_LIMIT]
        else:
            name = f"{rec['title'][:budget].rstrip()}{keep_relpath}"

    body_clipped = rec["body"][:NODE_CONTENT_LIMIT]
    return {
        "id": rec["node_id"],
        "type": node_type,
        "name": name,
        "description": description,
        "content": body_clipped,
        "status": "active",
        "embedding": rec.get("embedding"),
        "user_id": user_id,
        "pagerank": 0.0,
        "validated_count": 0,
    }


def _build_edge_payloads(
    records: list[dict],
    alias_index: dict[str, str],
) -> tuple[list[dict], int]:
    """Return (edge_dicts, unresolved_count) for all wikilinks across records.

    Only resolved wikilinks become edges (per spec: skip unresolved to avoid
    FK violations).
    """
    edges: list[dict] = []
    unresolved = 0
    seen: set[tuple[str, str]] = set()
    for rec in records:
        src_id = rec["node_id"]
        for raw_target in extract_wikilinks(rec["text"]):
            key = raw_target.strip().lower()
            dst_id = alias_index.get(key)
            if not dst_id:
                unresolved += 1
                continue
            if dst_id == src_id:
                continue  # skip self-loops
            pair = (src_id, dst_id)
            if pair in seen:
                continue
            seen.add(pair)
            edges.append(
                {
                    "id": str(uuid.uuid4()),
                    "from_id": src_id,
                    "to_id": dst_id,
                    "type": "WIKILINK",
                    "instruction": "",
                    "relation_category": "structural",
                }
            )
    return edges, unresolved


# --------------------------------------------------------------------------
# Subprocess bridge to memu_graph.cli
# --------------------------------------------------------------------------

def _spawn_graph_cli(
    python_path: str,
    subcommand: str,
    dsn: str,
    stdin_payload: str | None,
) -> dict:
    """Spawn memu_graph.cli <subcommand> --dsn ..., return parsed stdout JSON.

    Raises RuntimeError on non-zero exit.
    """
    cmd = [python_path, "-m", "memu_graph.cli", subcommand, "--dsn", dsn]
    proc = subprocess.run(
        cmd,
        input=stdin_payload,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"memu_graph.cli {subcommand} failed (exit {proc.returncode}): "
            f"{proc.stderr.strip() or proc.stdout.strip()}"
        )
    out = proc.stdout.strip()
    if not out:
        return {}
    try:
        return json.loads(out)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"memu_graph.cli {subcommand} returned non-JSON stdout: {out!r}"
        ) from exc


# --------------------------------------------------------------------------
# Dry-run rendering
# --------------------------------------------------------------------------

def _render_dry_run_text(
    vault: Path,
    total: int,
    added: list[dict],
    modified: list[tuple[dict, str]],
    unchanged: int,
    estimated_edges: int,
) -> str:
    out: list[str] = []
    out.append(f"=== Vault sync dry-run ({vault.as_posix()}) ===")
    changed = added + [m[0] for m in modified]
    out.append(
        f"Scanning ... {total} MDs found, {len(changed)} changed since last sync."
    )
    out.append("")
    out.append("Top changes:")
    out.append(
        f"  {'status':<8} {'relpath':<60} hash"
    )
    for rec in added[:20]:
        out.append(
            f"  {'added':<8} {rec['relpath'][:60]:<60} "
            f"{rec['source_hash'][:8]} ({rec['size_bytes']}B)"
        )
    remaining = max(0, 20 - len(added))
    for rec, was in modified[:remaining]:
        was_short = (was[:4] + "..") if was else "<none>"
        out.append(
            f"  {'modified':<8} {rec['relpath'][:60]:<60} "
            f"{was_short}->{rec['source_hash'][:4]} ({rec['size_bytes']}B)"
        )
    out.append("")
    out.append(
        f"Summary: {len(added)} added, {len(modified)} modified, "
        f"{unchanged} unchanged."
    )
    out.append(
        f"Will write: {len(changed)} nodes, "
        f"~{estimated_edges} edges (estimated)."
    )
    out.append(
        f"Embeddings: {len(changed)} calls "
        f"(~{max(1, len(changed) // EMBED_BATCH_SIZE)}s @ ollama batch={EMBED_BATCH_SIZE})."
    )
    out.append("Run without --dry-run to apply.")
    return "\n".join(out) + "\n"


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="compiler.memu_sync",
        description="Bridge Obsidian vault MD files into the memU graph store.",
    )
    p.add_argument("--vault", type=Path, default=VAULT_DEFAULT)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--json", action="store_true",
                   help="Emit machine-readable JSON instead of pretty text")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--no-recompute", action="store_true",
                   help="Skip run-maintenance after the write batch")
    p.add_argument("--memu-graph-python", default=DEFAULT_MEMU_GRAPH_PYTHON)
    p.add_argument("--dsn", default=os.environ.get("MEMU_DSN") or DEFAULT_DSN)
    p.add_argument("--user-id", default=DEFAULT_USER_ID)
    p.add_argument("--ollama-url", default=DEFAULT_OLLAMA_URL)
    p.add_argument("--embed-model", default=DEFAULT_EMBED_MODEL)
    p.add_argument("--node-id-prefix", default="vault",
                   help="Prefix for node_id (e.g. vault, claudemem)")
    p.add_argument("--node-type", default="VAULT_NOTE",
                   help="gm_nodes.type value (VAULT_NOTE or CLAUDE_MEMORY)")
    p.add_argument("--source-label", default="obsidian",
                   help="description.source label (obsidian or claudemem)")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    vault: Path = args.vault.resolve()
    if not vault.exists():
        sys.stderr.write(f"[memu_sync] vault {vault} not found\n")
        return 1

    vault_root = vault.as_posix()
    t_start = time.monotonic()

    records = _scan_vault(vault, limit=args.limit, node_id_prefix=args.node_id_prefix)
    if not records:
        sys.stderr.write("[memu_sync] no MD files found\n")
        if args.json:
            sys.stdout.write(json.dumps({"scanned": 0, "changed": 0}) + "\n")
        return 0

    existing = _load_existing_hashes(args.dsn)

    added: list[dict] = []
    modified: list[tuple[dict, str]] = []
    unchanged_count = 0
    for rec in records:
        prev_hash = existing.get(rec["node_id"])
        if prev_hash is None:
            added.append(rec)
        elif prev_hash != rec["source_hash"]:
            modified.append((rec, prev_hash))
        else:
            unchanged_count += 1

    changed_records = added + [m[0] for m in modified]

    # Alias index uses ALL records, not just changed ones, so that wikilinks
    # from a changed file pointing at an unchanged file still resolve.
    alias_index = _build_alias_index(records)

    # Edges: parse only from changed files (idempotent on UNIQUE constraint
    # so re-running won't dup, but recomputing all 2990 edges every sync is
    # wasteful when only 47 files changed).
    edge_payloads, unresolved = _build_edge_payloads(changed_records, alias_index)
    estimated_edges = len(edge_payloads)

    if args.dry_run:
        if args.json:
            sys.stdout.write(
                json.dumps(
                    {
                        "vault": vault_root,
                        "total": len(records),
                        "added": [
                            {"relpath": r["relpath"], "hash": r["source_hash"],
                             "size": r["size_bytes"]}
                            for r in added
                        ],
                        "modified": [
                            {"relpath": r["relpath"],
                             "old_hash": was,
                             "new_hash": r["source_hash"],
                             "size": r["size_bytes"]}
                            for r, was in modified
                        ],
                        "unchanged": unchanged_count,
                        "estimated_edges": estimated_edges,
                        "unresolved_wikilinks": unresolved,
                    },
                    ensure_ascii=False,
                ) + "\n"
            )
        else:
            sys.stdout.write(
                _render_dry_run_text(
                    vault, len(records), added, modified,
                    unchanged_count, estimated_edges,
                )
            )
        return 0

    if not changed_records:
        sys.stderr.write("[memu_sync] no changes to apply\n")
        if args.json:
            sys.stdout.write(
                json.dumps(
                    {
                        "vault": vault_root,
                        "scanned": len(records),
                        "changed": 0,
                        "nodes_written": 0,
                        "edges_written": 0,
                        "duration_ms": int((time.monotonic() - t_start) * 1000),
                    },
                    ensure_ascii=False,
                ) + "\n"
            )
        return 0

    # 1. Embed only changed records
    try:
        _embed_records(changed_records, args.ollama_url, args.embed_model)
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"[memu_sync] embedding failed: {exc!r}\n")
        return 1

    # 2. Build node payloads
    node_payloads = [
        _build_node_payload(rec, vault_root, args.user_id, args.node_type, args.source_label)
        for rec in changed_records
    ]

    # 3. Build sync_state batch (paired to nodes; written by graph-write
    #    only after node + edges succeed in same transaction).
    sync_state = [
        {
            "node_id": rec["node_id"],
            "source_hash": rec["source_hash"],
            "vault_root": vault_root,
        }
        for rec in changed_records
    ]

    # 4. Spawn graph-write
    payload = {
        "nodes": node_payloads,
        "edges": edge_payloads,
        "sync_state": sync_state,
    }
    try:
        write_result = _spawn_graph_cli(
            args.memu_graph_python,
            "graph-write",
            args.dsn,
            json.dumps(payload, ensure_ascii=False),
        )
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"[memu_sync] graph-write failed: {exc!r}\n")
        return 1

    # 5. Optional maintenance
    maint_result: dict[str, Any] = {}
    if not args.no_recompute:
        try:
            maint_result = _spawn_graph_cli(
                args.memu_graph_python,
                "run-maintenance",
                args.dsn,
                None,
            )
        except Exception as exc:  # noqa: BLE001
            sys.stderr.write(
                f"[memu_sync] run-maintenance failed (non-fatal): {exc!r}\n"
            )

    duration_ms = int((time.monotonic() - t_start) * 1000)
    summary = {
        "vault": vault_root,
        "scanned": len(records),
        "added": len(added),
        "modified": len(modified),
        "unchanged": unchanged_count,
        "nodes_written": write_result.get("nodes_written", 0),
        "edges_written": write_result.get("edges_written", 0),
        "edges_skipped_unresolved": write_result.get(
            "edges_skipped_unresolved", 0
        ),
        "wikilinks_unresolved_in_vault": unresolved,
        "maintenance": maint_result,
        "duration_ms": duration_ms,
    }

    if args.json:
        sys.stdout.write(json.dumps(summary, ensure_ascii=False) + "\n")
    else:
        sys.stdout.write(
            f"[memu_sync] vault={vault_root}\n"
            f"  scanned={summary['scanned']} "
            f"added={summary['added']} modified={summary['modified']} "
            f"unchanged={summary['unchanged']}\n"
            f"  nodes_written={summary['nodes_written']} "
            f"edges_written={summary['edges_written']} "
            f"edges_skipped={summary['edges_skipped_unresolved']} "
            f"unresolved_wikilinks={summary['wikilinks_unresolved_in_vault']}\n"
            f"  maintenance={summary['maintenance']}\n"
            f"  duration={summary['duration_ms']}ms\n"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
