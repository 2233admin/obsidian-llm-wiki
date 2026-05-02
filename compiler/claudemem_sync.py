#!/usr/bin/env python3
"""claudemem_sync -- bridge ~/.claude/projects/.../memory/*.md into the memU graph.

Walks the claudemem dir, computes content hashes, diffs against
claudemem_sync_state (migration 004), embeds changed files via ollama, builds
node dicts, then spawns memu_graph.cli graph-write to upsert. After the write
batch succeeds, optionally invokes run-maintenance (PageRank + LPA).

v1 = nodes-only. claudemem .md cross-references mostly use markdown link
syntax `[X](file.md)`, not `[[wikilink]]`. v1 skips edge extraction; PPR
recall does not require edges (personalize-from-query-embedding works on
nodes alone). v2 (Phase B Path 3) will add CLAUDEMEM_REF edges parsed from
markdown links.

Zero new deps -- mirrors memu_sync.py: hashlib / urllib / subprocess / json /
argparse / pathlib all stdlib. Re-uses compiler._md_parse for frontmatter.

Usage:
    python -m compiler.claudemem_sync [--root PATH] [--dry-run] [--json]
                                      [--limit N] [--no-recompute]
                                      [--memu-graph-python PATH] [--dsn ...]
                                      [--user-id ...] [--ollama-url ...]
                                      [--embed-model ...]

Defaults:
    --root           ~/.claude/projects/C--Users-Administrator/memory
    --dsn            $MEMU_DSN or postgresql://postgres:postgres@localhost:5432/memu
    --user-id        boris
    --ollama-url     http://127.0.0.1:11434
    --embed-model    qwen3-embedding:0.6b
    --memu-graph-python  D:/projects/memu-graph/.venv/Scripts/python.exe

Skip dirs (top-level, matches claudemem.ts adapter exclusion + extra):
    _inbox, _meta, data
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
from pathlib import Path
from typing import Any

try:
    from ._md_parse import parse_frontmatter
except ImportError:
    from _md_parse import parse_frontmatter

CLAUDEMEM_DEFAULT = Path.home() / ".claude" / "projects" / "C--Users-Administrator" / "memory"
SKIP_TOP_DIRS = {"_inbox", "_meta", "data"}
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


def _posix_relpath(root: Path, md: Path) -> str:
    return md.relative_to(root).as_posix()


def _title_of(md: Path, text: str, fm_name: str | None) -> str:
    """Prefer frontmatter `name:`, fall back to first H1, then file stem."""
    if fm_name and fm_name.strip():
        return fm_name.strip()
    m = H1_RE.search(text)
    if m:
        return m.group(1).strip()
    return md.stem


def _iter_claudemem_md(root: Path):
    """Yield Path objects for every *.md under root, skipping SKIP_TOP_DIRS."""
    for md in root.rglob("*.md"):
        rel_parts = md.relative_to(root).parts
        if rel_parts and rel_parts[0] in SKIP_TOP_DIRS:
            continue
        yield md


def _strip_frontmatter(text: str) -> str:
    if not text.startswith("---"):
        return text
    lines = text.splitlines(keepends=True)
    if not lines or not lines[0].startswith("---"):
        return text
    for i in range(1, len(lines)):
        if lines[i].rstrip("\r\n") == "---":
            return "".join(lines[i + 1:])
    return text


def _collect_fm_meta(fm: dict) -> dict[str, Any]:
    """Extract claudemem-specific frontmatter fields.

    Returns dict with keys:
      name, description, type, recall_role, workset, origin_session_id, tags
    Missing fields default to "" / [].
    """
    raw_tags = fm.get("tags") or fm.get("tag") or []
    if isinstance(raw_tags, str):
        raw_tags = [raw_tags]
    tags = [t for t in raw_tags if isinstance(t, str) and t]

    def _str(key: str) -> str:
        v = fm.get(key)
        return v.strip() if isinstance(v, str) else ""

    return {
        "name": _str("name"),
        "description": _str("description"),
        "type": _str("type"),
        "recall_role": _str("recall_role"),
        "workset": _str("workset"),
        "origin_session_id": _str("originSessionId"),
        "tags": tags,
    }


def _hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _load_existing_hashes(dsn: str) -> dict[str, str]:
    """Read vault_sync_state into {node_id -> source_hash}, filter claudemem: prefix.

    Shared table with vault sync; node_id prefix (claudemem: vs vault:)
    disambiguates. WHERE filter avoids loading vault entries we don't care
    about.
    """
    try:
        sys.path.insert(0, str(Path("D:/projects/memu-graph/src").resolve()))
        from sqlalchemy import create_engine, text

        engine = create_engine(dsn, pool_pre_ping=True)
        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT node_id, source_hash FROM vault_sync_state "
                    "WHERE node_id LIKE 'claudemem:%'"
                )
            ).all()
        return {row[0]: row[1] for row in rows}
    except Exception as exc:
        sys.stderr.write(
            f"[claudemem_sync] warn: could not read vault_sync_state ({exc!r}); "
            "treating all files as new\n"
        )
        return {}


def _ollama_embed_batch(
    inputs: list[str],
    ollama_url: str,
    model: str,
) -> list[list[float]]:
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
    inputs: list[str] = []
    for rec in records:
        meta = rec["meta"]
        # Prioritize frontmatter description for semantic signal -- it's
        # human-curated and dense. Body snippet is fallback.
        desc = meta["description"]
        body_snippet = rec["body"][:EMBED_INPUT_BODY_LIMIT]
        tags_str = " ".join(meta["tags"])
        workset = meta["workset"]
        inputs.append(
            f"{rec['title']}\n{desc}\n[workset:{workset}] {tags_str}\n{body_snippet}"
        )

    for batch_start in range(0, len(inputs), EMBED_BATCH_SIZE):
        batch = inputs[batch_start:batch_start + EMBED_BATCH_SIZE]
        embeddings = _ollama_embed_batch(batch, ollama_url, model)
        for offset, emb in enumerate(embeddings):
            records[batch_start + offset]["embedding"] = emb


def _scan_claudemem(root: Path, limit: int = 0) -> list[dict]:
    records: list[dict] = []
    scanned = 0
    for md in _iter_claudemem_md(root):
        if limit and scanned >= limit:
            break
        try:
            raw = md.read_bytes()
        except Exception as exc:
            sys.stderr.write(f"[claudemem_sync] warn: cannot read {md}: {exc!r}\n")
            continue
        try:
            text = raw.decode("utf-8", errors="replace")
        except Exception as exc:
            sys.stderr.write(f"[claudemem_sync] warn: cannot decode {md}: {exc!r}\n")
            continue

        relpath = _posix_relpath(root, md)
        node_id = f"claudemem:{relpath}"
        fm = parse_frontmatter(text)
        meta = _collect_fm_meta(fm)
        title = _title_of(md, text, meta["name"])
        body = _strip_frontmatter(text)
        source_hash = _hash_bytes(raw)
        size_bytes = len(raw)

        records.append(
            {
                "node_id": node_id,
                "relpath": relpath,
                "stem": md.stem,
                "title": title,
                "meta": meta,
                "body": body,
                "text": text,
                "source_hash": source_hash,
                "size_bytes": size_bytes,
            }
        )
        scanned += 1
    return records


def _build_node_payload(
    rec: dict,
    source_root: str,
    user_id: str,
) -> dict:
    meta = rec["meta"]
    description = json.dumps(
        {
            "source": "claudemem",
            "source_root": source_root,
            "relpath": rec["relpath"],
            "stem": rec["stem"],
            "fm_name": meta["name"],
            "fm_description": meta["description"],
            "fm_type": meta["type"],
            "recall_role": meta["recall_role"],
            "workset": meta["workset"],
            "origin_session_id": meta["origin_session_id"],
            "tags": meta["tags"],
        },
        ensure_ascii=False,
    )
    name = f"{rec['title']} [{rec['relpath']}]"
    if len(name) > TITLE_TO_NODE_KEY_LIMIT:
        keep_relpath = f" [{rec['relpath']}]"
        budget = TITLE_TO_NODE_KEY_LIMIT - len(keep_relpath)
        if budget < 8:
            name = rec["relpath"][:TITLE_TO_NODE_KEY_LIMIT]
        else:
            name = f"{rec['title'][:budget].rstrip()}{keep_relpath}"

    body_clipped = rec["body"][:NODE_CONTENT_LIMIT]
    return {
        "id": rec["node_id"],
        "type": "CLAUDE_MEMORY",
        "name": name,
        "description": description,
        "content": body_clipped,
        "status": "active",
        "embedding": rec.get("embedding"),
        "user_id": user_id,
        "pagerank": 0.0,
        "validated_count": 0,
    }


def _spawn_graph_cli(
    python_path: str,
    subcommand: str,
    dsn: str,
    stdin_payload: str | None,
) -> dict:
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


def _render_dry_run_text(
    root: Path,
    total: int,
    added: list[dict],
    modified: list[tuple[dict, str]],
    unchanged: int,
) -> str:
    out: list[str] = []
    out.append(f"=== Claudemem sync dry-run ({root.as_posix()}) ===")
    changed = added + [m[0] for m in modified]
    out.append(
        f"Scanning ... {total} MDs found, {len(changed)} changed since last sync."
    )
    out.append("")
    out.append("Top changes:")
    out.append(f"  {'status':<8} {'relpath':<60} hash")
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
        f"Will write: {len(changed)} CLAUDE_MEMORY nodes, 0 edges (v1 nodes-only)."
    )
    out.append(
        f"Embeddings: {len(changed)} ollama calls "
        f"(~{max(1, len(changed) // EMBED_BATCH_SIZE)}s @ batch={EMBED_BATCH_SIZE})."
    )
    out.append("Run without --dry-run to apply.")
    return "\n".join(out) + "\n"


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="compiler.claudemem_sync",
        description="Bridge ~/.claude/.../memory MD files into the memU graph store.",
    )
    p.add_argument("--root", type=Path, default=CLAUDEMEM_DEFAULT)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--json", action="store_true")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--no-recompute", action="store_true")
    p.add_argument("--memu-graph-python", default=DEFAULT_MEMU_GRAPH_PYTHON)
    p.add_argument("--dsn", default=os.environ.get("MEMU_DSN") or DEFAULT_DSN)
    p.add_argument("--user-id", default=DEFAULT_USER_ID)
    p.add_argument("--ollama-url", default=DEFAULT_OLLAMA_URL)
    p.add_argument("--embed-model", default=DEFAULT_EMBED_MODEL)
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    root: Path = args.root.resolve()
    if not root.exists():
        sys.stderr.write(f"[claudemem_sync] root {root} not found\n")
        return 1

    source_root = root.as_posix()
    t_start = time.monotonic()

    records = _scan_claudemem(root, limit=args.limit)
    if not records:
        sys.stderr.write("[claudemem_sync] no MD files found\n")
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

    if args.dry_run:
        if args.json:
            sys.stdout.write(
                json.dumps(
                    {
                        "source_root": source_root,
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
                    },
                    ensure_ascii=False,
                ) + "\n"
            )
        else:
            sys.stdout.write(
                _render_dry_run_text(
                    root, len(records), added, modified, unchanged_count,
                )
            )
        return 0

    if not changed_records:
        sys.stderr.write("[claudemem_sync] no changes to apply\n")
        if args.json:
            sys.stdout.write(
                json.dumps(
                    {
                        "source_root": source_root,
                        "scanned": len(records),
                        "changed": 0,
                        "nodes_written": 0,
                        "duration_ms": int((time.monotonic() - t_start) * 1000),
                    },
                    ensure_ascii=False,
                ) + "\n"
            )
        return 0

    # 1. Embed
    try:
        _embed_records(changed_records, args.ollama_url, args.embed_model)
    except Exception as exc:
        sys.stderr.write(f"[claudemem_sync] embedding failed: {exc!r}\n")
        return 1

    # 2. Build node payloads
    node_payloads = [
        _build_node_payload(rec, source_root, args.user_id)
        for rec in changed_records
    ]

    # 3. Build sync_state batch (paired to nodes). Reuses vault_sync_state
    #    table; vault_root field semantically holds source-root path. CLI
    #    requires keys: node_id, source_hash, vault_root.
    sync_state = [
        {
            "node_id": rec["node_id"],
            "source_hash": rec["source_hash"],
            "vault_root": source_root,
        }
        for rec in changed_records
    ]

    # 4. Spawn graph-write
    payload = {
        "nodes": node_payloads,
        "edges": [],
        "sync_state": sync_state,
    }
    try:
        write_result = _spawn_graph_cli(
            args.memu_graph_python,
            "graph-write",
            args.dsn,
            json.dumps(payload, ensure_ascii=False),
        )
    except Exception as exc:
        sys.stderr.write(f"[claudemem_sync] graph-write failed: {exc!r}\n")
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
        except Exception as exc:
            sys.stderr.write(
                f"[claudemem_sync] run-maintenance failed (non-fatal): {exc!r}\n"
            )

    duration_ms = int((time.monotonic() - t_start) * 1000)
    summary = {
        "source_root": source_root,
        "scanned": len(records),
        "added": len(added),
        "modified": len(modified),
        "unchanged": unchanged_count,
        "nodes_written": write_result.get("nodes_written", 0),
        "maintenance": maint_result,
        "duration_ms": duration_ms,
    }

    if args.json:
        sys.stdout.write(json.dumps(summary, ensure_ascii=False) + "\n")
    else:
        sys.stdout.write(
            f"[claudemem_sync] root={source_root}\n"
            f"  scanned={summary['scanned']} "
            f"added={summary['added']} modified={summary['modified']} "
            f"unchanged={summary['unchanged']}\n"
            f"  nodes_written={summary['nodes_written']}\n"
            f"  maintenance={summary['maintenance']}\n"
            f"  duration={summary['duration_ms']}ms\n"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
