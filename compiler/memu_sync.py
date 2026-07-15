#!/usr/bin/env python3
"""memu_sync -- bridge Obsidian vault MD files into the memU graph store.

Walks the vault, computes content hashes, diffs against the vault_sync_state
sidecar table (migration 003), embeds changed files via ollama, builds node +
edge dicts, then spawns memu_graph.cli graph-write to upsert. After the write
batch succeeds, optionally invokes graph-recall maintenance (PageRank + LPA).

MemU configuration comes from the canonical Settings profile. A private DSN
is resolved through its device-local Secret Reference only at the database or
subprocess boundary; it is never added to a child process argument list.

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
    --vault          $VAULT_MIND_VAULT_PATH or current directory
    MemU values      canonical adapters.memu.* Settings profile
    --ollama-url     http://127.0.0.1:11434

Legacy MEMU_* inputs are consulted only while their corresponding Settings
keys remain unassigned. --dsn is a credential-free compatibility override;
credential-bearing values are rejected without reflection.

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
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, unquote, urlsplit, urlunsplit

try:
    from ._md_parse import extract_wikilinks, parse_frontmatter
    from .settings_platform import (
        SettingsService,
        default_registry_path,
        load_registry,
    )
except ImportError:
    from _md_parse import extract_wikilinks, parse_frontmatter
    from settings_platform import SettingsService, default_registry_path, load_registry

VAULT_DEFAULT = Path(os.environ.get("VAULT_MIND_VAULT_PATH") or Path.cwd())
SKIP_DIRS = {
    ".obsidian", ".trash", ".git", ".omc", ".smart-env",
    ".stfolder", "node_modules", ".archive",
}
DEFAULT_DSN = "postgresql://localhost:5432/memu"
DEFAULT_USER_ID = "default"
DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434"
DEFAULT_EMBED_MODEL = "qwen3-embedding:0.6b"
DEFAULT_MEMU_GRAPH_PYTHON = sys.executable
EMBED_BATCH_SIZE = 8
EMBED_DIM = 1024
NODE_CONTENT_LIMIT = 4000
EMBED_INPUT_BODY_LIMIT = 500
H1_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)
TITLE_TO_NODE_KEY_LIMIT = 256
KNOWN_ADAPTERS = {
    "filesystem", "memu", "gitnexus", "obsidian", "kanban", "qmd",
    "lightrag", "raganything", "hindsight", "vaultbrain", "graphify",
}


class MemUSyncConfigurationError(RuntimeError):
    """Fail-closed configuration error whose message contains no secret value."""


@dataclass(frozen=True)
class MemUSyncRuntimeProfile:
    """Redacted Settings-derived profile for the MemU write/sync path."""

    enabled: bool
    valid: bool
    public_dsn: str
    user_id: str
    graph_python: str
    graph_cwd: str
    graph_timeout_ms: int
    embed_model: str
    credential_reference: dict[str, str] | None
    credential_status: str
    credential_explicit: bool
    issues: tuple[str, ...]
    snapshot_id: str


def _effective_setting(snapshot: dict[str, Any], key: str) -> dict[str, Any]:
    for item in snapshot.get("effective", []):
        if item.get("key") == key:
            return item
    raise MemUSyncConfigurationError("MemU Settings profile is incomplete")


def _select_string(
    snapshot: dict[str, Any],
    key: str,
    *,
    cli_value: str | None = None,
    legacy_value: str | None = None,
) -> str:
    item = _effective_setting(snapshot, key)
    if item.get("winningScope") != "product":
        return item.get("value") if isinstance(item.get("value"), str) else ""
    if isinstance(cli_value, str) and cli_value.strip():
        return cli_value.strip()
    if isinstance(legacy_value, str) and legacy_value.strip():
        return legacy_value.strip()
    return item.get("value") if isinstance(item.get("value"), str) else ""


def _select_int(
    snapshot: dict[str, Any],
    key: str,
    *,
    legacy_value: str | None = None,
) -> int:
    item = _effective_setting(snapshot, key)
    value = item.get("value")
    if item.get("winningScope") == "product" and legacy_value:
        try:
            value = int(legacy_value)
        except ValueError:
            return -1
    return value if isinstance(value, int) and not isinstance(value, bool) else -1


def _parse_postgres_dsn(value: str, *, public: bool) -> Any:
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
            raise ValueError("unsupported endpoint")
        _ = parsed.port
        if public and (
            parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("credential-bearing endpoint")
        if not public and parsed.fragment:
            raise ValueError("fragment is not a connection option")
        return parsed
    except (TypeError, ValueError) as exc:
        kind = "public" if public else "private"
        raise MemUSyncConfigurationError(
            f"MemU {kind} DSN is not a supported PostgreSQL URL"
        ) from exc


def _public_dsn_from_legacy(value: str) -> str:
    parsed = _parse_postgres_dsn(value, public=False)
    if parsed.query or parsed.fragment:
        raise MemUSyncConfigurationError(
            "Legacy MEMU_DSN connection options are unsafe; use adapters.memu.secret_ref"
        )
    host = parsed.hostname or ""
    if ":" in host:
        host = f"[{host}]"
    netloc = f"{host}:{parsed.port}" if parsed.port else host
    public_dsn = urlunsplit((parsed.scheme, netloc, parsed.path, "", ""))
    _parse_postgres_dsn(public_dsn, public=True)
    return public_dsn


def _secret_reference(item: dict[str, Any]) -> tuple[dict[str, str] | None, str]:
    value = item.get("value")
    if not isinstance(value, dict):
        return None, "missing"
    reference = value.get("secretRef")
    status = value.get("status")
    if not isinstance(reference, dict):
        return None, "missing"
    provider = reference.get("provider")
    locator = reference.get("locator")
    if not isinstance(provider, str) or not isinstance(locator, str):
        return None, "missing"
    normalized_status = status if status in {"present", "missing", "unreachable"} else "missing"
    return {"provider": provider, "locator": locator}, normalized_status


def _resolve_memu_sync_profile(
    vault: Path,
    args: argparse.Namespace,
    *,
    environment: dict[str, str] | None = None,
    service: SettingsService | None = None,
) -> tuple[MemUSyncRuntimeProfile, SettingsService]:
    """Resolve the redacted write profile without materializing a secret value."""
    env = dict(os.environ) if environment is None else dict(environment)
    settings = service or SettingsService(
        registry=load_registry(default_registry_path()),
        vault_path=vault,
        environment=env,
    )
    snapshot = settings.snapshot_resolve()["snapshot"]
    issues: list[str] = []

    enabled_item = _effective_setting(snapshot, "adapters.enabled")
    enabled_value = enabled_item.get("value")
    if enabled_item.get("winningScope") == "product" and env.get("VAULT_MIND_ADAPTERS", "").strip():
        enabled_value = [
            value.strip()
            for value in env["VAULT_MIND_ADAPTERS"].split(",")
            if value.strip()
        ]
    if not isinstance(enabled_value, list) or any(not isinstance(value, str) for value in enabled_value):
        issues.append("adapter-enablement-invalid")
        enabled = False
    else:
        unknown = set(enabled_value) - KNOWN_ADAPTERS
        if unknown:
            issues.append("adapter-enablement-unknown")
        enabled = "memu" in enabled_value and not unknown

    dsn_item = _effective_setting(snapshot, "adapters.memu.dsn")
    if dsn_item.get("winningScope") != "product":
        public_dsn = dsn_item.get("value") if isinstance(dsn_item.get("value"), str) else ""
    elif isinstance(args.dsn, str) and args.dsn.strip():
        public_dsn = args.dsn.strip()
    elif env.get("MEMU_DSN", "").strip():
        try:
            public_dsn = _public_dsn_from_legacy(env["MEMU_DSN"].strip())
        except MemUSyncConfigurationError:
            public_dsn = ""
            issues.append("memu-dsn-invalid")
    else:
        public_dsn = dsn_item.get("value") if isinstance(dsn_item.get("value"), str) else ""
    try:
        _parse_postgres_dsn(public_dsn, public=True)
    except MemUSyncConfigurationError:
        public_dsn = ""
        if "memu-dsn-invalid" not in issues:
            issues.append("memu-dsn-invalid")

    secret_item = _effective_setting(snapshot, "adapters.memu.secret_ref")
    credential_explicit = secret_item.get("winningScope") != "product"
    credential_reference, credential_status = _secret_reference(secret_item)
    if not credential_explicit and env.get("MEMU_DSN", "").strip():
        credential_reference = {"provider": "environment", "locator": "MEMU_DSN"}
        credential_status = "present"
    if credential_explicit and (credential_reference is None or credential_status != "present"):
        issues.append("memu-secret-unavailable")

    user_id = _select_string(
        snapshot,
        "adapters.memu.user_id",
        cli_value=args.user_id,
        legacy_value=env.get("MEMU_USER_ID"),
    )
    graph_python = _select_string(
        snapshot,
        "adapters.memu.graph_python",
        cli_value=args.memu_graph_python,
        legacy_value=env.get("MEMU_GRAPH_PYTHON"),
    )
    graph_cwd = _select_string(
        snapshot,
        "adapters.memu.graph_cwd",
        legacy_value=env.get("MEMU_GRAPH_CWD"),
    )
    graph_timeout_ms = _select_int(
        snapshot,
        "adapters.memu.graph_timeout_ms",
        legacy_value=env.get("MEMU_GRAPH_TIMEOUT_MS"),
    )
    embed_model = _select_string(
        snapshot,
        "adapters.memu.embed_model",
        cli_value=args.embed_model,
        legacy_value=env.get("OLLAMA_EMBED_MODEL"),
    )
    if not user_id:
        issues.append("memu-user-missing")
    if not graph_python:
        issues.append("memu-graph-python-missing")
    if not graph_cwd:
        issues.append("memu-graph-cwd-missing")
    if not 100 <= graph_timeout_ms <= 300_000:
        issues.append("memu-graph-timeout-invalid")
    if not embed_model:
        issues.append("memu-embed-model-missing")

    profile = MemUSyncRuntimeProfile(
        enabled=enabled,
        valid=not issues,
        public_dsn=public_dsn,
        user_id=user_id,
        graph_python=graph_python,
        graph_cwd=graph_cwd,
        graph_timeout_ms=graph_timeout_ms,
        embed_model=embed_model,
        credential_reference=credential_reference,
        credential_status=credential_status,
        credential_explicit=credential_explicit,
        issues=tuple(issues),
        snapshot_id=snapshot["snapshotId"],
    )
    return profile, settings


def _resolve_memu_connection_dsn(
    profile: MemUSyncRuntimeProfile,
    service: SettingsService,
) -> str:
    """Resolve the private DSN only at the final device-local boundary."""
    if not profile.valid:
        raise MemUSyncConfigurationError("MemU Settings profile is invalid")
    private_dsn = (
        service.resolve_secret_reference(profile.credential_reference)
        if profile.credential_reference
        else None
    )
    if profile.credential_explicit and not private_dsn:
        raise MemUSyncConfigurationError("MemU Secret Reference is unavailable on this device")
    if not private_dsn:
        return profile.public_dsn

    public = _parse_postgres_dsn(profile.public_dsn, public=True)
    private = _parse_postgres_dsn(private_dsn, public=False)
    public_endpoint = (
        (public.hostname or "").lower(),
        public.port or 5432,
        public.path,
    )
    private_endpoint = (
        (private.hostname or "").lower(),
        private.port or 5432,
        private.path,
    )
    if public_endpoint != private_endpoint:
        raise MemUSyncConfigurationError(
            "MemU Secret Reference resolves to a different database endpoint"
        )
    return private_dsn


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
        memu_graph_src = os.environ.get("MEMU_GRAPH_SRC")
        if memu_graph_src:
            sys.path.insert(0, str(Path(memu_graph_src).expanduser().resolve()))
        from sqlalchemy import create_engine, text

        engine = create_engine(dsn, pool_pre_ping=True)
        with engine.connect() as conn:
            rows = conn.execute(
                text("SELECT node_id, source_hash FROM vault_sync_state")
            ).all()
        return {row[0]: row[1] for row in rows}
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(
            "[memu_sync] warn: could not read vault_sync_state "
            f"({type(exc).__name__}); "
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
    *,
    cwd: str,
    timeout_ms: int,
) -> dict:
    """Spawn memu_graph.cli with the private DSN only in child environment.

    ``memu_graph.cli`` consumes ``MEMU_DSN`` as its device-local default. The
    private value is deliberately absent from the operating-system argument
    vector and every error/result is redacted before it crosses this boundary.
    """
    cmd = [python_path, "-m", "memu_graph.cli", subcommand]
    child_environment = dict(os.environ)
    child_environment["MEMU_DSN"] = dsn
    proc = subprocess.run(
        cmd,
        input=stdin_payload,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=child_environment,
        cwd=cwd,
        timeout=timeout_ms / 1000,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"memu_graph.cli {subcommand} failed (exit {proc.returncode})"
        )
    out = proc.stdout.strip()
    if not out:
        return {}
    try:
        parsed = json.loads(out)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"memu_graph.cli {subcommand} returned invalid JSON"
        ) from exc
    sanitized = _redact_private_dsn(parsed, dsn)
    if not isinstance(sanitized, dict):
        raise RuntimeError(f"memu_graph.cli {subcommand} returned an invalid result")
    return sanitized


def _private_dsn_tokens(dsn: str) -> set[str]:
    tokens = {dsn}
    try:
        parsed = urlsplit(dsn)
        for value in (parsed.username, parsed.password):
            if value:
                tokens.add(value)
                tokens.add(unquote(value))
        for _, value in parse_qsl(parsed.query, keep_blank_values=False):
            if value:
                tokens.add(value)
                tokens.add(unquote(value))
    except ValueError:
        pass
    return {token for token in tokens if token}


def _redact_private_dsn(value: Any, dsn: str) -> Any:
    """Recursively remove the private DSN and its credential material."""
    tokens = _private_dsn_tokens(dsn)
    if isinstance(value, str):
        redacted = value
        for token in sorted(tokens, key=len, reverse=True):
            redacted = redacted.replace(token, "[REDACTED]")
        return redacted
    if isinstance(value, list):
        return [_redact_private_dsn(item, dsn) for item in value]
    if isinstance(value, dict):
        return {
            _redact_private_dsn(key, dsn) if isinstance(key, str) else key:
            _redact_private_dsn(item, dsn)
            for key, item in value.items()
        }
    return value


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
    p.add_argument(
        "--memu-graph-python",
        help="Credential-free compatibility override; explicit Settings wins",
    )
    p.add_argument(
        "--dsn",
        help=(
            "Credential-free PostgreSQL compatibility endpoint. "
            "Credentials must use adapters.memu.secret_ref"
        ),
    )
    p.add_argument(
        "--user-id",
        help="Compatibility override used only while adapters.memu.user_id is unassigned",
    )
    p.add_argument("--ollama-url", default=DEFAULT_OLLAMA_URL)
    p.add_argument(
        "--embed-model",
        help="Compatibility override used only while adapters.memu.embed_model is unassigned",
    )
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

    try:
        profile, settings = _resolve_memu_sync_profile(vault, args)
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(
            "[memu_sync] Settings profile resolution failed "
            f"({type(exc).__name__})\n"
        )
        return 1
    if not profile.enabled:
        sys.stderr.write("[memu_sync] MemU is disabled by the effective Settings profile\n")
        return 1
    if not profile.valid:
        sys.stderr.write(
            "[memu_sync] MemU Settings profile is invalid: "
            f"{','.join(profile.issues)}\n"
        )
        return 1
    vault_root = vault.as_posix()
    t_start = time.monotonic()

    records = _scan_vault(vault, limit=args.limit, node_id_prefix=args.node_id_prefix)
    if not records:
        sys.stderr.write("[memu_sync] no MD files found\n")
        if args.json:
            sys.stdout.write(json.dumps({"scanned": 0, "changed": 0}) + "\n")
        return 0

    try:
        read_dsn = _resolve_memu_connection_dsn(profile, settings)
        existing = _load_existing_hashes(read_dsn)
        del read_dsn
    except MemUSyncConfigurationError as exc:
        sys.stderr.write(f"[memu_sync] {exc}\n")
        return 1

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
        _embed_records(changed_records, args.ollama_url, profile.embed_model)
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(f"[memu_sync] embedding failed: {exc!r}\n")
        return 1

    # 2. Build node payloads
    node_payloads = [
        _build_node_payload(
            rec,
            vault_root,
            profile.user_id,
            args.node_type,
            args.source_label,
        )
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
        write_dsn = _resolve_memu_connection_dsn(profile, settings)
        write_result = _spawn_graph_cli(
            profile.graph_python,
            "graph-write",
            write_dsn,
            json.dumps(payload, ensure_ascii=False),
            cwd=profile.graph_cwd,
            timeout_ms=profile.graph_timeout_ms,
        )
        del write_dsn
    except Exception:  # noqa: BLE001
        sys.stderr.write("[memu_sync] graph-write failed\n")
        return 1

    # 5. Optional maintenance
    maint_result: dict[str, Any] = {}
    if not args.no_recompute:
        try:
            maintenance_dsn = _resolve_memu_connection_dsn(profile, settings)
            maint_result = _spawn_graph_cli(
                profile.graph_python,
                "run-maintenance",
                maintenance_dsn,
                None,
                cwd=profile.graph_cwd,
                timeout_ms=profile.graph_timeout_ms,
            )
            del maintenance_dsn
        except Exception:  # noqa: BLE001
            sys.stderr.write("[memu_sync] run-maintenance failed (non-fatal)\n")

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
