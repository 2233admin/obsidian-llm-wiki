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
import hashlib
import json
import os
import re
import time
from contextlib import contextmanager
from pathlib import Path

import currency
import work_budget
import work_protocol

ACTIONABLE_STATES = frozenset({currency.STATE_TODO, currency.STATE_IN_PROGRESS})


def is_actionable(note, notes) -> bool:
    """True when `note` is an open, unblocked unit of work the driver may pick.
    `notes` is the full work index, needed to resolve blocked-by relations."""
    if (note.raw or {}).get("type") == "project":
        return False  # a project container is not a unit of work (mirrors board_columns)
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
_WORK_RUN_LOCK_FILE = "_work-run.lock"
_PROJECT_ID_RE = re.compile(r"project/[a-z0-9][a-z0-9-]*")
_WORK_ITEM_ID_RE = re.compile(
    r"project/[a-z0-9][a-z0-9-]*/issue/[a-z0-9][a-z0-9-]*"
)
_WORK_RUN_ID_RE = re.compile(r"work-run/[a-z0-9][a-z0-9-]*")

WORK_RUN_STATES = (
    "planned", "leased", "running", "awaiting_review",
    "completed", "failed", "cancelled",
)
WORK_RUN_TERMINAL_STATES = frozenset({"completed", "failed", "cancelled"})
WORK_RUN_TRANSITIONS = {
    "planned": frozenset({"leased", "cancelled"}),
    "leased": frozenset({"running", "failed", "cancelled"}),
    "running": frozenset({"awaiting_review", "completed", "failed", "cancelled"}),
    "awaiting_review": frozenset({"running", "completed", "failed", "cancelled"}),
    "completed": frozenset(),
    "failed": frozenset(),
    "cancelled": frozenset(),
}
WORK_RUN_OUTPUT_CLASSES = frozenset({
    "view", "work-state-transition", "knowledge-claim", "external-side-effect",
})


@dataclasses.dataclass
class LeaseResult:
    outcome: str
    lease: dict | None = None


class WorkRunBusy(RuntimeError):
    """A second runtime owns the shared Work Run mutation lock."""


class WorkIdentityConflict(ValueError):
    """A lease or Work Run identity does not match its requested owner."""


def _leases_path(vault_dir) -> Path:
    # machine layer: gitignored .vault-mind/, never shared markdown (§0 #6).
    return Path(vault_dir) / ".vault-mind" / _LEASES_FILE


@contextmanager
def _work_run_lock(vault_dir):
    """Serialize Python and TypeScript Work Run compare-and-write sections.

    Lock ownership is fail-closed.  An old mtime is not proof that the owner is
    gone, and deleting a lock after observing it creates an ABA race with a new
    owner.  Operators may remove an abandoned lock only after independently
    verifying that its recorded owner/runtime is no longer active.
    """
    path = Path(vault_dir) / ".vault-mind" / _WORK_RUN_LOCK_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    token = f"{os.getpid()}:{time.time_ns()}"
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            os.write(descriptor, token.encode("utf-8"))
        finally:
            os.close(descriptor)
    except FileExistsError as exc:
        raise WorkRunBusy(
            "Work Run is busy with another runtime; if the lock is abandoned, "
            "verify its recorded owner is no longer active before removing "
            f"{path}"
        ) from exc
    try:
        yield
    finally:
        try:
            if path.read_text("utf-8") == token:
                path.unlink(missing_ok=True)
        except FileNotFoundError:
            pass


def read_leases(vault_dir) -> dict:
    """Return the lease registry, or {} when absent/unreadable."""
    p = _leases_path(vault_dir)
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}


def _atomic_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        tmp.write_bytes(text.encode("utf-8"))
        tmp.replace(path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def _write_leases(vault_dir, leases) -> None:
    p = _leases_path(vault_dir)
    _atomic_json(p, leases)


def _work_identity(note_id, project_id=None, work_item_id=None):
    """Return canonical identities when a Work-OS item can be identified.

    Legacy ``Projects/<slug>/issues`` note ids remain readable, but all newly
    durable Work Run state uses canonical ``project/<slug>`` identities.
    """
    if project_id is not None and not _PROJECT_ID_RE.fullmatch(project_id):
        raise WorkIdentityConflict(f"Invalid project identity: {project_id}")
    if work_item_id is not None and not _WORK_ITEM_ID_RE.fullmatch(work_item_id):
        raise WorkIdentityConflict(f"Invalid Work Item identity: {work_item_id}")

    note_work_item = None
    if isinstance(note_id, str) and _WORK_ITEM_ID_RE.fullmatch(note_id):
        note_work_item = note_id
    match = re.search(
        r"(?:^|/)(?:01-Projects|Projects)/([a-z0-9][a-z0-9-]*)/issues/([a-z0-9][a-z0-9-]*)\.md$",
        str(note_id).replace("\\", "/"),
    )
    if match:
        inferred_note_project = f"project/{match.group(1)}"
        note_work_item = f"{inferred_note_project}/issue/{match.group(2)}"

    resolved_work_item = work_item_id or note_work_item
    if resolved_work_item is None:
        if project_id is not None:
            raise WorkIdentityConflict(
                "A project identity requires an owning Work Item identity"
            )
        return None, None
    inferred_project = "/".join(resolved_work_item.split("/")[:2])
    resolved_project = project_id or inferred_project
    if resolved_project != inferred_project:
        raise WorkIdentityConflict(
            f"Project {resolved_project} does not own Work Item {resolved_work_item}"
        )
    if note_work_item is not None and note_work_item != resolved_work_item:
        raise WorkIdentityConflict(
            f"Note {note_id} identifies {note_work_item}, not {resolved_work_item}"
        )
    return resolved_project, resolved_work_item


def _assert_existing_work_identity(
    vault_dir, existing, *, project_id, work_item_id
):
    """Validate a durable lease and its Work Run before any refresh/takeover."""
    identity_values = {
        "project_id": existing.get("project_id"),
        "work_item_id": existing.get("work_item_id"),
        "work_run_id": existing.get("work_run_id"),
        "agent_id": existing.get("agent_id"),
    }
    if not any(identity_values.values()) and project_id is None and work_item_id is None:
        return None
    if not all(isinstance(value, str) and value for value in identity_values.values()):
        raise WorkIdentityConflict("Existing lease has an incomplete durable identity")
    if not _PROJECT_ID_RE.fullmatch(identity_values["project_id"]):
        raise WorkIdentityConflict("Existing lease has an invalid project identity")
    if not _WORK_ITEM_ID_RE.fullmatch(identity_values["work_item_id"]):
        raise WorkIdentityConflict("Existing lease has an invalid Work Item identity")
    if not _WORK_RUN_ID_RE.fullmatch(identity_values["work_run_id"]):
        raise WorkIdentityConflict("Existing lease has an invalid Work Run identity")
    owning_project = "/".join(identity_values["work_item_id"].split("/")[:2])
    if identity_values["project_id"] != owning_project:
        raise WorkIdentityConflict(
            "Existing lease project does not own its Work Item"
        )
    if (
        project_id != identity_values["project_id"]
        or work_item_id != identity_values["work_item_id"]
    ):
        raise WorkIdentityConflict(
            "Requested project/Work Item identity conflicts with the existing lease"
        )
    run = read_work_run(
        vault_dir, identity_values["project_id"], identity_values["work_run_id"]
    )
    if run is None:
        raise WorkIdentityConflict("Existing lease Work Run is missing")
    for key, expected in identity_values.items():
        if run.get(key) != expected:
            raise WorkIdentityConflict(
                f"Existing lease and Work Run disagree on {key}"
            )
    return run


def _work_run_path(vault_dir, project_id, work_run_id) -> Path:
    slug = project_id.split("/", 1)[1]
    run_slug = work_run_id.split("/", 1)[1]
    return Path(vault_dir) / "01-Projects" / slug / "runs" / f"{run_slug}.json"


def _new_work_run_id(project_id, work_item_id, agent_id, now, base_head):
    seed = "\0".join((project_id, work_item_id, agent_id, str(now), str(base_head)))
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:24]
    return f"work-run/{digest}"


def read_work_run(vault_dir, project_id, work_run_id):
    path = _work_run_path(vault_dir, project_id, work_run_id)
    try:
        value = json.loads(path.read_text("utf-8"))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


def normalized_work_run(run):
    """Return the language-neutral camelCase Work Run contract view.

    Python keeps snake_case in its private durable JSON for compatibility;
    public cross-runtime exchange uses the shared fixture's canonical shape.
    """
    transitions = run.get("transitions", []) if isinstance(run, dict) else []
    latest = transitions[-1] if transitions else {}
    result = {
        "projectId": run.get("project_id"),
        "workItemId": run.get("work_item_id"),
        "workRunId": run.get("work_run_id"),
        "state": run.get("state"),
        "outputClass": run.get("output_class"),
        "approvalStatus": run.get("approval_status"),
        "provenance": sorted(set(run.get("provenance", []))),
    }
    if latest.get("transition_token"):
        result["transitionToken"] = latest["transition_token"]
    return result


def _write_work_run(vault_dir, run):
    path = _work_run_path(vault_dir, run["project_id"], run["work_run_id"])
    _atomic_json(path, run)
    return path


def _transition_work_run_unlocked(vault_dir, project_id, work_run_id, state, *,
                                  transition_token, now, output_class=None,
                                  approval_status=None, provenance=None, reason=None):
    """Apply one shared, idempotent Work Run transition."""
    run = read_work_run(vault_dir, project_id, work_run_id)
    if run is None:
        raise ValueError(f"Work Run not found: {work_run_id}")
    receipts = run.setdefault("transitions", [])
    previous = next((item for item in receipts
                     if item.get("transition_token") == transition_token), None)
    if previous is not None:
        return run
    current = run.get("state")
    if state not in WORK_RUN_TRANSITIONS.get(current, frozenset()):
        raise ValueError(f"Invalid Work Run transition: {current} -> {state}")
    if output_class is not None:
        if output_class not in WORK_RUN_OUTPUT_CLASSES:
            raise ValueError(f"Invalid Work Run output class: {output_class}")
        run["output_class"] = output_class
    if approval_status is not None:
        run["approval_status"] = approval_status
    if provenance:
        run["provenance"] = sorted(set(run.get("provenance", []) + list(provenance)))
    run["state"] = state
    run["updated_at"] = now
    if reason:
        run["reason"] = reason
    receipts.append({
        "transition_token": transition_token,
        "from": current,
        "to": state,
        "recorded_at": now,
    })
    _write_work_run(vault_dir, run)
    return run


def transition_work_run(vault_dir, project_id, work_run_id, state, *,
                        transition_token, now, output_class=None,
                        approval_status=None, provenance=None, reason=None):
    """Apply an idempotent transition under the cross-runtime mutation lock."""
    with _work_run_lock(vault_dir):
        return _transition_work_run_unlocked(
            vault_dir, project_id, work_run_id, state,
            transition_token=transition_token, now=now,
            output_class=output_class, approval_status=approval_status,
            provenance=provenance, reason=reason,
        )


def _acquire_lease_unlocked(
    vault_dir, note_id, agent_id, *, current_head, base_head, ttl_seconds, now,
    project_id=None, work_item_id=None, transition_token=None
) -> LeaseResult:
    """Atomically claim a work item.

    base-head optimistic lock mirrors promote(): a claim built against a stale
    head is HEAD_MISMATCH (the item moved since the driver selected it). An
    unexpired lease held by a *different* agent is ALREADY_LEASED. The same
    agent may refresh; an expired lease (now >= expires_at) is reclaimable.
    `now`/`ttl_seconds` are epoch-second ints supplied by the caller, so lease
    outcomes stay deterministic. Cross-runtime locks are never reclaimed from
    wall-clock age; abandoned-lock recovery requires explicit owner checks.
    """
    if base_head != current_head:
        return LeaseResult(OUTCOME_HEAD_MISMATCH)
    resolved_project_id, resolved_work_item_id = _work_identity(
        note_id, project_id=project_id, work_item_id=work_item_id)
    leases = read_leases(vault_dir)
    existing = leases.get(note_id)
    if existing is not None and not isinstance(existing, dict):
        raise WorkIdentityConflict("Existing lease record is malformed")
    if isinstance(existing, dict):
        _assert_existing_work_identity(
            vault_dir, existing,
            project_id=resolved_project_id,
            work_item_id=resolved_work_item_id,
        )
        if (
            existing.get("expires_at", 0) > now
            and existing.get("agent_id") != agent_id
        ):
            return LeaseResult(OUTCOME_ALREADY_LEASED, existing)
    existing_run_id = (
        existing.get("work_run_id")
        if isinstance(existing, dict) and existing.get("agent_id") == agent_id
        else None
    )
    work_run_id = existing_run_id or (
        _new_work_run_id(resolved_project_id, resolved_work_item_id, agent_id, now, base_head)
        if resolved_project_id and resolved_work_item_id else None
    )
    lease = {
        "agent_id": agent_id,
        "base_head": base_head,
        "acquired_at": now,
        "expires_at": now + ttl_seconds,
    }
    if work_run_id:
        lease.update({
            "project_id": resolved_project_id,
            "work_item_id": resolved_work_item_id,
            "work_run_id": work_run_id,
        })
    leases[note_id] = lease
    _write_leases(vault_dir, leases)
    if work_run_id and not read_work_run(vault_dir, resolved_project_id, work_run_id):
        token = transition_token or f"driver:lease:{work_run_id.split('/', 1)[1]}"
        _write_work_run(vault_dir, {
            "schema_version": 1,
            "project_id": resolved_project_id,
            "work_item_id": resolved_work_item_id,
            "work_run_id": work_run_id,
            "agent_id": agent_id,
            "state": "leased",
            "output_class": "view",
            "approval_status": "not-required",
            "created_at": now,
            "updated_at": now,
            "provenance": [f"work-item:{resolved_work_item_id}"],
            "transitions": [{
                "transition_token": token,
                "from": "planned",
                "to": "leased",
                "recorded_at": now,
            }],
        })
    return LeaseResult(OUTCOME_ACQUIRED, lease)


def acquire_lease(
    vault_dir, note_id, agent_id, *, current_head, base_head, ttl_seconds, now,
    project_id=None, work_item_id=None, transition_token=None
) -> LeaseResult:
    """Atomically claim an item under the cross-runtime Work Run lock."""
    with _work_run_lock(vault_dir):
        return _acquire_lease_unlocked(
            vault_dir, note_id, agent_id,
            current_head=current_head, base_head=base_head,
            ttl_seconds=ttl_seconds, now=now, project_id=project_id,
            work_item_id=work_item_id, transition_token=transition_token,
        )


def _release_lease_unlocked(vault_dir, note_id, agent_id) -> bool:
    """Drop a lease the given agent holds. Returns False (no-op) if the lease is
    missing or held by someone else."""
    leases = read_leases(vault_dir)
    cur = leases.get(note_id)
    if cur and cur.get("agent_id") == agent_id:
        del leases[note_id]
        _write_leases(vault_dir, leases)
        return True
    return False


def release_lease(vault_dir, note_id, agent_id) -> bool:
    """Drop a held lease under the cross-runtime Work Run lock."""
    with _work_run_lock(vault_dir):
        return _release_lease_unlocked(vault_dir, note_id, agent_id)


def route_work_run_output(vault_dir, project_id, work_run_id, output_class, *,
                          transition_token, now, external_approved=False,
                          provenance=None):
    """Route output through Promotion Policy before a caller performs writes.

    The returned gate is deliberately explicit: TypeScript Operation Write
    Policy still adjudicates the actual vault write or external side effect.
    """
    if output_class not in WORK_RUN_OUTPUT_CLASSES:
        raise ValueError(f"Invalid Work Run output class: {output_class}")
    if output_class == "knowledge-claim":
        target, approval = "awaiting_review", "pending"
    elif output_class == "external-side-effect" and not external_approved:
        target, approval = "awaiting_review", "denied"
    else:
        target, approval = "completed", (
            "approved" if output_class == "external-side-effect" else "not-required"
        )
    run = transition_work_run(
        vault_dir, project_id, work_run_id, target,
        transition_token=transition_token, now=now,
        output_class=output_class, approval_status=approval,
        provenance=provenance,
    )
    return {
        "run": run,
        "promotion": "human-review" if target == "awaiting_review" else "allowed",
        "operation_write_policy_required": True,
        "external_side_effect_allowed": output_class != "external-side-effect" or external_approved,
    }


def _recover_expired_work_runs_unlocked(vault_dir, *, now):
    """Fail interrupted durable runs whose machine-local lease expired."""
    leases = read_leases(vault_dir)
    recovered = []
    changed = False
    for note_id, lease in sorted(list(leases.items())):
        if not isinstance(lease, dict) or lease.get("expires_at", 0) > now:
            continue
        project_id = lease.get("project_id")
        work_run_id = lease.get("work_run_id")
        if project_id and work_run_id:
            run = read_work_run(vault_dir, project_id, work_run_id)
            if run and run.get("state") not in WORK_RUN_TERMINAL_STATES:
                run = _transition_work_run_unlocked(
                    vault_dir, project_id, work_run_id, "failed",
                    transition_token=f"driver:lease-expired:{work_run_id}:{now}",
                    now=now, reason="machine-local lease expired",
                )
                recovered.append(run)
        del leases[note_id]
        changed = True
    if changed:
        _write_leases(vault_dir, leases)
    return recovered


def recover_expired_work_runs(vault_dir, *, now):
    """Recover expired runs and remove their leases as one locked mutation."""
    with _work_run_lock(vault_dir):
        return _recover_expired_work_runs_unlocked(vault_dir, now=now)


# --- kanban view: render the work-OS truth into an Obsidian board (unify) -----
# The board is a *derived view* (§0 #2): the source of truth stays the issue
# notes (state / blocked-by); the board is recompiled from them, never edited as
# source. This makes the scheduling brain (work_protocol) ALSO speak kanban, so
# the separate docket store is unnecessary.

KANBAN_COLUMNS = ("Backlog", "Todo", "In Progress", "Blocked", "Done", "Canceled")
_STATE_COLUMN = {
    currency.STATE_BACKLOG: "Backlog",
    currency.STATE_TODO: "Todo",
    currency.STATE_IN_PROGRESS: "In Progress",
    currency.STATE_DONE: "Done",
    currency.STATE_CANCELED: "Canceled",
}
_DONE_COLUMNS = frozenset({"Done", "Canceled"})

# Localized lane labels. The canonical column keys (KANBAN_COLUMNS) stay English
# internally (source of truth never changes); only the *displayed* heading is
# localized, so the board reads in the user's language without touching the
# work-OS state model. Unknown lang falls back to English.
COLUMN_LABELS = {
    "en": {"Backlog": "Backlog", "Todo": "Todo", "In Progress": "In Progress",
           "Blocked": "Blocked", "Done": "Done", "Canceled": "Canceled"},
    "zh": {"Backlog": "储备", "Todo": "待办", "In Progress": "进行中",
           "Blocked": "受阻", "Done": "已完成", "Canceled": "已取消"},
    "ja": {"Backlog": "バックログ", "Todo": "未着手", "In Progress": "進行中",
           "Blocked": "ブロック", "Done": "完了", "Canceled": "キャンセル"},
}


def detect_lang(text) -> str:
    """Heuristic UI language from sample text. Japanese kana (hiragana/katakana)
    is unique to Japanese -> 'ja'; otherwise any CJK Han -> 'zh'; else 'en'.
    Kana is checked first because Japanese also uses Han, but Chinese has no
    kana."""
    s = text or ""
    if any("぀" <= c <= "ヿ" for c in s):
        return "ja"
    if any("一" <= c <= "鿿" for c in s):
        return "zh"
    return "en"


def detect_vault_lang(notes, *, sample=200) -> str:
    """Detect the vault's dominant UI language from a sample of note titles/bodies
    (so the board localizes to the library, not to one project's note text)."""
    buf = []
    for n in notes[:sample]:
        if n.entity:
            buf.append(n.entity)
        if n.body:
            buf.append(n.body)
    return detect_lang("\n".join(buf))


def board_columns(notes, *, project=None) -> dict:
    """Group work issues into kanban columns by canonical state, with an active
    item that has an unresolved blocker moved to 'Blocked' (derived, like
    effective_state). Deterministic order within a column (priority, note_id).
    `project` filters to entities under `project/<project>/`."""
    cols = {c: [] for c in KANBAN_COLUMNS}
    prefix = f"project/{project}/" if project else None
    for n in notes:
        ent = n.entity
        if not ent:
            continue
        if (n.raw or {}).get("type") == "project":
            continue  # the container note is not a card
        if prefix and not ent.startswith(prefix):
            continue
        state = currency.work_state(n.cm)
        column = _STATE_COLUMN.get(state, "Backlog")
        if state in (currency.STATE_TODO, currency.STATE_IN_PROGRESS) and \
                work_protocol.has_unresolved_blocker(notes, ent):
            column = "Blocked"
        cols[column].append(n)
    return {c: [n.note_id for n in sorted(ns, key=_sort_key)] for c, ns in cols.items()}


def _card_label(note) -> str:
    for line in (note.body or "").splitlines():
        if line.strip():
            return line.strip()
    return note.entity.rsplit("/", 1)[-1] if note.entity else note.note_id


def render_kanban_board(notes, *, project=None, lang="en") -> str:
    """Render the work-OS notes as an Obsidian Kanban board (kanban-plugin). `lang`
    localizes the lane headings (en/zh/ja, unknown -> en); the canonical column
    keys and the note state model are unchanged."""
    cols = board_columns(notes, project=project)
    by_id = {n.note_id: n for n in notes}
    labels = COLUMN_LABELS.get(lang, COLUMN_LABELS["en"])
    # Match the EXACT on-disk format the obsidian-kanban plugin writes: blank-line
    # padded frontmatter, NO H1 heading, `##` lanes, plain (non-json) settings
    # fence. Deviating (an H1, a ```json fence, extra frontmatter keys) makes the
    # plugin fail to render the board.
    out = ["---", "", "kanban-plugin: board", "", "---", ""]
    for column in KANBAN_COLUMNS:
        out.append(f"## {labels.get(column, column)}")
        out.append("")
        mark = "x" if column in _DONE_COLUMNS else " "
        for nid in cols[column]:
            out.append(f"- [{mark}] {_card_label(by_id[nid])}")
        out.append("")
    out += [
        "%% kanban:settings",
        "```",
        '{"kanban-plugin":"board","show-checkboxes":true}',
        "```",
        "%%",
        "",
    ]
    return "\n".join(out)


# --- bootstrap briefing: cold-start context for a work run (Task 11G) ---------
# A read-only current-truth slice around the picked item, so a waking agent has
# team context without a cold start (the loop injects it ONCE at bootstrap, not
# mid-run -- cache-friendly). Derived view: never edits the source, deterministic
# (sorted entities), built on the same authoritative notes the driver selects
# from + the real blocked-by graph (effective_state). No new machinery.

def render_briefing(notes, entity) -> str:
    """Render the bootstrap briefing for `entity` from the authoritative `notes`:
    the item + its state, its unresolved blockers, open siblings in its project,
    and the notes to read first. Markdown, read-only, deterministic."""
    by_entity = {n.entity: n for n in notes if n.entity}
    target = by_entity.get(entity)
    if target is None:
        return f"# Work briefing: {entity}\n\n(not found in the authoritative work index)\n"

    eff = work_protocol.effective_state(notes, entity)
    state = eff.get("state") or currency.work_state(target.cm)
    lines = [f"# Work briefing: {entity}", "",
             f"- state: {state}", f"- note: {target.note_id}", ""]
    first = next((ln.strip() for ln in (target.body or "").splitlines() if ln.strip()), "")
    if first:
        lines += [first, ""]

    blockers = eff.get("blockers") or []
    if blockers:
        lines.append("## Blocked by (unresolved)")
        for b in blockers:
            bt = b.get("target")
            bn = by_entity.get(bt)
            st = b.get("status") or (currency.work_state(bn.cm) if bn else "?")
            lines.append(f"- {bt} ({st})" + (f" -- {bn.note_id}" if bn else ""))
        lines.append("")

    slug = work_budget.pool_slug(entity)
    if slug:
        prefix = f"project/{slug}/"
        sibs = sorted(
            n.entity for n in notes
            if n.entity and n.entity.startswith(prefix) and n.entity != entity
            and currency.work_state(n.cm) in ACTIONABLE_STATES
        )
        if sibs:
            lines.append(f"## Open siblings in project/{slug}")
            lines += [f"- {s}" for s in sibs]
            lines.append("")

    reading = []
    if slug and f"project/{slug}" in by_entity:
        reading.append(by_entity[f"project/{slug}"].note_id)
    reading += [by_entity[b["target"]].note_id for b in blockers
                if b.get("target") in by_entity]
    if reading:
        lines.append("## Required reading")
        lines += [f"- {r}" for r in sorted(set(reading))]
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"
