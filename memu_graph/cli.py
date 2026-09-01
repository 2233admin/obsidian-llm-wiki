#!/usr/bin/env python3
"""Minimal memu_graph.cli bridge for vault → MemU sync.

Implements graph-write: reads JSON payload from stdin (nodes, edges, sync_state),
upserts into gm_nodes, gm_edges, and vault_sync_state tables in a single transaction.
"""

from __future__ import annotations

import json
import os
import shlex
import sys
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit


def _get_pg_pool(dsn: str):
    """Lazy psycopg2 connection helper using optional libpq environment credentials."""
    import psycopg2

    if "://" in dsn:
        parsed_dsn = urlsplit(dsn)
        has_explicit_credentials = parsed_dsn.username is not None or parsed_dsn.password is not None
    else:
        dsn_keys = {
            field.partition("=")[0].lower()
            for field in shlex.split(dsn)
            if "=" in field
        }
        has_explicit_credentials = bool(dsn_keys & {"user", "password"})

    connection_options = {}
    if not has_explicit_credentials:
        user = os.environ.get("PGUSER")
        password = os.environ.get("PGPASSWORD")
        if user:
            connection_options["user"] = user
        if password:
            connection_options["password"] = password

    conn = psycopg2.connect(dsn, **connection_options)
    conn.autocommit = False
    return conn


def _graph_write(dsn: str, payload: dict) -> dict:
    """Upsert nodes, edges, and sync_state in one transaction."""
    nodes = payload.get("nodes", [])
    edges = payload.get("edges", [])
    sync_state = payload.get("sync_state", [])

    conn = _get_pg_pool(dsn)
    cur = conn.cursor()
    now_iso = datetime.now(timezone.utc).isoformat()

    nodes_written = 0
    edges_written = 0
    sync_written = 0

    try:
        # Upsert nodes
        for node in nodes:
            cur.execute(
                """
                INSERT INTO gm_nodes (id, type, name, description, content, status,
                                       embedding, user_id, pagerank, validated_count, updated_at)
                VALUES (%(id)s, %(type)s, %(name)s, %(description)s, %(content)s, %(status)s,
                        %(embedding)s, %(user_id)s, %(pagerank)s, %(validated_count)s, %(updated_at)s)
                ON CONFLICT (id) DO UPDATE SET
                    type = EXCLUDED.type,
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    content = EXCLUDED.content,
                    status = EXCLUDED.status,
                    embedding = EXCLUDED.embedding,
                    user_id = EXCLUDED.user_id,
                    updated_at = EXCLUDED.updated_at
                """,
                {
                    "id": node["id"],
                    "type": node["type"],
                    "name": node.get("name", ""),
                    "description": node.get("description", ""),
                    "content": node.get("content", ""),
                    "status": node.get("status", "active"),
                    "embedding": json.dumps(node["embedding"]) if node.get("embedding") else None,
                    "user_id": node.get("user_id", "default"),
                    "pagerank": float(node.get("pagerank", 0.0)),
                    "validated_count": int(node.get("validated_count", 0)),
                    "updated_at": now_iso,
                },
            )
            nodes_written += 1

        # Upsert edges
        for edge in edges:
            cur.execute(
                """
                INSERT INTO gm_edges (id, from_id, to_id, type, instruction,
                                       relation_category, updated_at)
                VALUES (%(id)s, %(from_id)s, %(to_id)s, %(type)s, %(instruction)s,
                        %(relation_category)s, %(updated_at)s)
                ON CONFLICT (from_id, to_id, type) DO UPDATE SET
                    instruction = EXCLUDED.instruction,
                    relation_category = EXCLUDED.relation_category,
                    updated_at = EXCLUDED.updated_at
                """,
                {
                    "id": edge.get("id", str(uuid.uuid4())),
                    "from_id": edge["from_id"],
                    "to_id": edge["to_id"],
                    "type": edge.get("type", "WIKILINK"),
                    "instruction": edge.get("instruction", ""),
                    "relation_category": edge.get("relation_category", "structural"),
                    "updated_at": now_iso,
                },
            )
            edges_written += 1

        # Upsert sync_state
        for ss in sync_state:
            cur.execute(
                """
                INSERT INTO vault_sync_state (node_id, source_hash, vault_root, updated_at)
                VALUES (%(node_id)s, %(source_hash)s, %(vault_root)s, %(updated_at)s)
                ON CONFLICT (node_id) DO UPDATE SET
                    source_hash = EXCLUDED.source_hash,
                    vault_root = EXCLUDED.vault_root,
                    updated_at = EXCLUDED.updated_at
                """,
                {
                    "node_id": ss["node_id"],
                    "source_hash": ss["source_hash"],
                    "vault_root": ss.get("vault_root", ""),
                    "updated_at": now_iso,
                },
            )
            sync_written += 1

        conn.commit()
        result = {
            "status": "ok",
            "nodes_written": nodes_written,
            "edges_written": edges_written,
            "sync_state_written": sync_written,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    return result


def _run_maintenance(dsn: str) -> dict:
    """Run PageRank + community detection maintenance.

    This is a no-op placeholder. The real memu-graph (Rust binary) does this.
    """
    return {"status": "ok", "maintenance": "skipped (bridge placeholder)"}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "subcommand required (graph-write | run-maintenance)"}))
        sys.exit(1)

    subcommand = sys.argv[1]
    dsn = os.environ.get("MEMU_DSN", "postgresql://localhost:5432/memu")

    if subcommand == "graph-write":
        raw = sys.stdin.read()
        try:
            payload = json.loads(raw) if raw.strip() else {"nodes": [], "edges": [], "sync_state": []}
        except json.JSONDecodeError as exc:
            print(json.dumps({"error": f"invalid JSON: {exc}"}))
            sys.exit(1)
        result = _graph_write(dsn, payload)
        print(json.dumps(result))
    elif subcommand == "run-maintenance":
        result = _run_maintenance(dsn)
        print(json.dumps(result))
    else:
        print(json.dumps({"error": f"unknown subcommand: {subcommand}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
