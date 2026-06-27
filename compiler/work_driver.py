"""Task 11A -- Work Driver: deterministic next-work selection.

Reads the authoritative work index (entity-bearing WorkNotes) and picks the
next executable item: an actionable state (todo / in-progress) that is not
blocked, ordered by priority then the stable note_id tie-break so two runs never
disagree (green bar 1: same truth -> same pick, stable under input order).

Zero-dependency on kb_meta; sits beside work_protocol. No runtime / daemon
(§0 #4): a caller invokes this once per `work next` heartbeat and exits. The
lease (base-head optimistic lock) that makes the claim atomic lands beside this.
"""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

import currency
import work_protocol

ACTIONABLE_STATES = frozenset({currency.STATE_TODO, currency.STATE_IN_PROGRESS})


def is_actionable(note, notes) -> bool:
    """True when `note` is an open, unblocked unit of work the driver may pick.
    `notes` is the full work index, needed to resolve blocked-by relations."""
    if currency.work_state(note.cm) not in ACTIONABLE_STATES:
        return False
    ent = note.entity
    if ent and work_protocol.has_unresolved_blocker(notes, ent):
        return False
    return True


def _sort_key(note):
    # priority first (the canonical 8B rank), then the stable optimistic-lock
    # token as the tie-break so two runs never disagree.
    return (currency.priority_rank(note.cm), note.note_id)


def select_next(notes, *, today=None):
    """Return the next executable WorkNote, or None when nothing is actionable.

    Deterministic: the result depends only on the note set, never on input
    order. `today` is accepted for forthcoming due-aware ordering and currently
    unused.
    """
    cands = [n for n in notes if is_actionable(n, notes)]
    if not cands:
        return None
    return min(cands, key=_sort_key)


# --- lease: atomic claim via base-head lock + TTL (11A-ii) ------------------

OUTCOME_ACQUIRED = "ACQUIRED"
OUTCOME_ALREADY_LEASED = "ALREADY_LEASED"
OUTCOME_HEAD_MISMATCH = "HEAD_MISMATCH"

_LEASES_FILE = "_leases.json"


@dataclasses.dataclass
class LeaseResult:
    outcome: str
    lease: dict | None = None


def _leases_path(vault_dir) -> Path:
    # machine layer: gitignored .vault-mind/, never shared markdown (§0 #6).
    return Path(vault_dir) / ".vault-mind" / _LEASES_FILE


def read_leases(vault_dir) -> dict:
    """Return the lease registry, or {} when absent/unreadable."""
    p = _leases_path(vault_dir)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}


def _write_leases(vault_dir, leases) -> None:
    p = _leases_path(vault_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    # LF-only, sorted, deterministic bytes (mirrors workspace.save_bindings).
    text = json.dumps(leases, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    p.write_bytes(text.encode("utf-8"))


def acquire_lease(
    vault_dir, note_id, agent_id, *, current_head, base_head, ttl_seconds, now
) -> LeaseResult:
    """Atomically claim a work item.

    base-head optimistic lock mirrors promote(): a claim built against a stale
    head is HEAD_MISMATCH (the item moved since the driver selected it). An
    unexpired lease held by a *different* agent is ALREADY_LEASED. The same
    agent may refresh; an expired lease (now >= expires_at) is reclaimable.
    `now`/`ttl_seconds` are epoch-second ints supplied by the caller, so this
    module makes no wall-clock call and stays deterministic.
    """
    if base_head != current_head:
        return LeaseResult(OUTCOME_HEAD_MISMATCH)
    leases = read_leases(vault_dir)
    existing = leases.get(note_id)
    if (
        existing
        and existing.get("expires_at", 0) > now
        and existing.get("agent_id") != agent_id
    ):
        return LeaseResult(OUTCOME_ALREADY_LEASED, existing)
    lease = {
        "agent_id": agent_id,
        "base_head": base_head,
        "acquired_at": now,
        "expires_at": now + ttl_seconds,
    }
    leases[note_id] = lease
    _write_leases(vault_dir, leases)
    return LeaseResult(OUTCOME_ACQUIRED, lease)


def release_lease(vault_dir, note_id, agent_id) -> bool:
    """Drop a lease the given agent holds. Returns False (no-op) if the lease is
    missing or held by someone else."""
    leases = read_leases(vault_dir)
    cur = leases.get(note_id)
    if cur and cur.get("agent_id") == agent_id:
        del leases[note_id]
        _write_leases(vault_dir, leases)
        return True
    return False
