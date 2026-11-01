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
import secrets
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
_AGENT_PROFILE_ID_RE = re.compile(
    r"(?:agent/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?"
    r"|agent-profile/[a-z0-9][a-z0-9-]*)"
)
_PROJECT_AGENT_BINDING_ID_RE = re.compile(
    r"(?:binding/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?/"
    r"[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?"
    r"|project-agent-binding/[a-z0-9][a-z0-9-]*)"
)
_ASSIGNMENT_PLAN_ID_RE = re.compile(r"assignment-plan/[a-z0-9][a-z0-9-]*")
_FINGERPRINT_RE = re.compile(r"(?:sha256:)?[a-f0-9]{64}")
_DEVICE_SNAPSHOT_ID_RE = re.compile(
    r"device-snapshot/[A-Za-z0-9][A-Za-z0-9._-]{0,127}"
)
_DEVICE_ID_RE = re.compile(r"device/[a-z0-9][a-z0-9-]*")

_GOVERNED_ASSIGNMENT_REQUIRED_KEYS = frozenset({
    "agent_profile_id",
    "agent_profile_revision",
    "project_agent_binding_id",
    "project_agent_binding_revision",
    "assignment_plan_id",
    "assignment_plan_fingerprint",
    "context_envelope_fingerprint",
})
_GOVERNED_ASSIGNMENT_OPTIONAL_KEYS = frozenset({
    "assignment_plan_version",
    "device_snapshot",
    "parent_work_run_id",
    "child_work_run_ids",
    "capability_grant_summary",
    "artifact_projections",
    "expected_output",
})
_GOVERNED_ASSIGNMENT_KEYS = (
    _GOVERNED_ASSIGNMENT_REQUIRED_KEYS | _GOVERNED_ASSIGNMENT_OPTIONAL_KEYS
)
_GOVERNED_ASSIGNMENT_LABELS = {
    "agent_profile_id": "Agent Profile identity",
    "agent_profile_revision": "Agent Profile revision",
    "project_agent_binding_id": "Project Agent Binding identity",
    "project_agent_binding_revision": "Project Agent Binding revision",
    "assignment_plan_id": "Assignment Plan identity",
    "assignment_plan_version": "Assignment Plan version",
    "assignment_plan_fingerprint": "Assignment Plan fingerprint",
    "context_envelope_fingerprint": "Context Envelope fingerprint",
    "device_snapshot": "Device Snapshot",
    "parent_work_run_id": "parent Work Run identity",
    "child_work_run_ids": "child Work Run identities",
    "capability_grant_summary": "Capability Grant summary",
    "artifact_projections": "Artifact projections",
    "expected_output": "expected output",
}


def _fingerprint_hex(value):
    if not isinstance(value, str) or not _FINGERPRINT_RE.fullmatch(value):
        return None
    return value.removeprefix("sha256:")


def _validate_device_snapshot(value):
    if not isinstance(value, dict):
        raise WorkIdentityConflict("Device Snapshot must be an object")
    required = {
        "snapshotId", "deviceId", "revision", "fingerprint",
        "capturedAt", "expiresAt",
    }
    missing = required - set(value)
    unknown = set(value) - required
    if missing:
        raise WorkIdentityConflict(
            "Device Snapshot is missing required fields: "
            + ", ".join(sorted(missing))
        )
    if unknown:
        raise WorkIdentityConflict(
            "Device Snapshot has unknown fields: " + ", ".join(sorted(unknown))
        )
    if not isinstance(value["snapshotId"], str) or not _DEVICE_SNAPSHOT_ID_RE.fullmatch(value["snapshotId"]):
        raise WorkIdentityConflict("Invalid Device Snapshot identity")
    if not isinstance(value["deviceId"], str) or not _DEVICE_ID_RE.fullmatch(value["deviceId"]):
        raise WorkIdentityConflict("Invalid Device identity in Device Snapshot")
    revision = value["revision"]
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise WorkIdentityConflict("Invalid Device Snapshot revision")
    if _fingerprint_hex(value["fingerprint"]) is None:
        raise WorkIdentityConflict("Invalid Device Snapshot fingerprint")
    for key in ("capturedAt", "expiresAt"):
        if not isinstance(value[key], str) or not value[key]:
            raise WorkIdentityConflict(f"Invalid Device Snapshot {key}")
    return _portable_assignment_value(value, path="device_snapshot")


def _comparable_governed_value(key, value):
    if key in {"assignment_plan_fingerprint", "context_envelope_fingerprint"}:
        return _fingerprint_hex(value)
    if key == "device_snapshot" and isinstance(value, dict):
        comparable = dict(value)
        comparable["fingerprint"] = _fingerprint_hex(comparable.get("fingerprint"))
        return comparable
    return value
_PORTABLE_FORBIDDEN_FIELD_RE = re.compile(
    r"(?:^|_)(?:secret|token|credential|api_?key|workspace|path|process|handle|"
    r"header|environment|env)(?:_|$)",
    re.IGNORECASE,
)
_MACHINE_PATH_RE = re.compile(
    r"^(?:[a-zA-Z]:[\\/]|\\\\|/(?:Users|home|private|tmp|var/tmp)/|file://)",
    re.IGNORECASE,
)
_SECRET_VALUE_RE = re.compile(
    r"^(?:Bearer\s+|sk-[A-Za-z0-9_-]{16,}|(?:lease|handoff)[_-]?token[:=])",
    re.IGNORECASE,
)

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


def _portable_assignment_value(value, *, path, depth=0):
    """Return a JSON-safe copy that cannot carry machine-local authority."""
    if depth > 6:
        raise WorkIdentityConflict(
            f"Governed assignment extension is too deeply nested at {path}"
        )
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise WorkIdentityConflict(
                f"Governed assignment extension contains a non-finite number at {path}"
            )
        return value
    if isinstance(value, str):
        if len(value) > 4096:
            raise WorkIdentityConflict(
                f"Governed assignment extension text is too large at {path}"
            )
        if _MACHINE_PATH_RE.search(value):
            raise WorkIdentityConflict(
                f"Governed assignment extension contains a machine-local path at {path}"
            )
        if _SECRET_VALUE_RE.search(value):
            raise WorkIdentityConflict(
                f"Governed assignment extension contains secret or token material at {path}"
            )
        return value
    if isinstance(value, list):
        if len(value) > 256:
            raise WorkIdentityConflict(
                f"Governed assignment extension array is too large at {path}"
            )
        return [
            _portable_assignment_value(item, path=f"{path}[{index}]", depth=depth + 1)
            for index, item in enumerate(value)
        ]
    if isinstance(value, dict):
        if len(value) > 128:
            raise WorkIdentityConflict(
                f"Governed assignment extension object is too large at {path}"
            )
        result = {}
        for key in sorted(value):
            if not isinstance(key, str) or not key:
                raise WorkIdentityConflict(
                    f"Governed assignment extension has an invalid field at {path}"
                )
            if _PORTABLE_FORBIDDEN_FIELD_RE.search(key):
                raise WorkIdentityConflict(
                    f"Governed assignment extension contains forbidden field {path}.{key}"
                )
            result[key] = _portable_assignment_value(
                value[key], path=f"{path}.{key}", depth=depth + 1
            )
        return result
    raise WorkIdentityConflict(
        f"Governed assignment extension has a non-JSON value at {path}"
    )


def _validate_governed_assignment(value):
    """Validate and canonicalize the portable Work Run assignment lock."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise WorkIdentityConflict("Governed assignment must be an object")
    keys = frozenset(value)
    missing = _GOVERNED_ASSIGNMENT_REQUIRED_KEYS - keys
    unknown = keys - _GOVERNED_ASSIGNMENT_KEYS
    if missing:
        raise WorkIdentityConflict(
            "Governed assignment is missing required fields: " + ", ".join(sorted(missing))
        )
    if unknown:
        raise WorkIdentityConflict(
            "Governed assignment has unknown fields: " + ", ".join(sorted(unknown))
        )

    string_contracts = {
        "agent_profile_id": _AGENT_PROFILE_ID_RE,
        "project_agent_binding_id": _PROJECT_AGENT_BINDING_ID_RE,
        "assignment_plan_id": _ASSIGNMENT_PLAN_ID_RE,
        "assignment_plan_fingerprint": _FINGERPRINT_RE,
        "context_envelope_fingerprint": _FINGERPRINT_RE,
    }
    canonical = {}
    for key, pattern in string_contracts.items():
        candidate = value[key]
        if not isinstance(candidate, str) or not pattern.fullmatch(candidate):
            raise WorkIdentityConflict(
                f"Invalid {_GOVERNED_ASSIGNMENT_LABELS[key]}: {candidate!r}"
            )
        canonical[key] = candidate
    for key in ("agent_profile_revision", "project_agent_binding_revision"):
        revision = value[key]
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
            raise WorkIdentityConflict(
                f"Invalid {_GOVERNED_ASSIGNMENT_LABELS[key]}: {revision!r}"
            )
        canonical[key] = revision
    if "assignment_plan_version" in value:
        version = value["assignment_plan_version"]
        if isinstance(version, bool) or not isinstance(version, int) or version < 1:
            raise WorkIdentityConflict(
                f"Invalid {_GOVERNED_ASSIGNMENT_LABELS['assignment_plan_version']}: {version!r}"
            )
        canonical["assignment_plan_version"] = version
    if "device_snapshot" in value:
        canonical["device_snapshot"] = _validate_device_snapshot(value["device_snapshot"])

    if "parent_work_run_id" in value:
        parent = value["parent_work_run_id"]
        if parent is not None and (
            not isinstance(parent, str) or not _WORK_RUN_ID_RE.fullmatch(parent)
        ):
            raise WorkIdentityConflict(f"Invalid parent Work Run identity: {parent!r}")
        canonical["parent_work_run_id"] = parent
    if "child_work_run_ids" in value:
        children = value["child_work_run_ids"]
        if not isinstance(children, list) or len(children) > 256:
            raise WorkIdentityConflict("Child Work Run identities must be a bounded array")
        if any(
            not isinstance(child, str) or not _WORK_RUN_ID_RE.fullmatch(child)
            for child in children
        ):
            raise WorkIdentityConflict("Invalid child Work Run identity")
        if len(set(children)) != len(children):
            raise WorkIdentityConflict("Child Work Run identities must be unique")
        canonical["child_work_run_ids"] = list(children)
    for key in ("capability_grant_summary", "artifact_projections", "expected_output"):
        if key in value:
            canonical[key] = _portable_assignment_value(value[key], path=key)
    return {key: canonical[key] for key in sorted(canonical)}


def _assert_governed_assignment(existing_run, governed_assignment):
    """Require an exact assertion of the immutable assignment on refresh."""
    has_existing = (
        existing_run.get("schema_version", 1) >= 2
        or any(key in existing_run for key in _GOVERNED_ASSIGNMENT_KEYS)
    )
    if has_existing and governed_assignment is None:
        raise WorkIdentityConflict(
            "Existing Work Run has a governed assignment that must be asserted"
        )
    if not has_existing and governed_assignment is not None:
        raise WorkIdentityConflict(
            "An existing legacy Work Run cannot be upgraded with a governed assignment"
        )
    if not has_existing:
        return
    existing_assignment = {
        key: existing_run[key]
        for key in _GOVERNED_ASSIGNMENT_KEYS
        if key in existing_run
    }
    existing_assignment = _validate_governed_assignment(existing_assignment)
    for key in sorted(set(existing_assignment) | set(governed_assignment)):
        if (
            _comparable_governed_value(key, existing_assignment.get(key))
            != _comparable_governed_value(key, governed_assignment.get(key))
        ):
            label = _GOVERNED_ASSIGNMENT_LABELS.get(key, key)
            raise WorkIdentityConflict(
                f"{label} conflicts with the existing governed assignment"
            )


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
    governed_keys = {
        "agent_profile_id": "agentProfileId",
        "agent_profile_revision": "agentProfileRevision",
        "project_agent_binding_id": "projectAgentBindingId",
        "project_agent_binding_revision": "projectAgentBindingRevision",
        "assignment_plan_id": "assignmentPlanId",
        "assignment_plan_version": "assignmentPlanVersion",
        "assignment_plan_fingerprint": "assignmentPlanFingerprint",
        "context_envelope_fingerprint": "contextEnvelopeFingerprint",
        "device_snapshot": "deviceSnapshot",
        "parent_work_run_id": "parentWorkRunId",
        "child_work_run_ids": "childWorkRunIds",
        "capability_grant_summary": "capabilityGrantSummary",
        "artifact_projections": "artifactProjections",
        "expected_output": "expectedOutput",
    }
    for private_key, public_key in governed_keys.items():
        if private_key in run:
            result[public_key] = run[private_key]
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
    project_id=None, work_item_id=None, transition_token=None,
    governed_assignment=None,
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
    canonical_assignment = _validate_governed_assignment(governed_assignment)
    if base_head != current_head:
        return LeaseResult(OUTCOME_HEAD_MISMATCH)
    resolved_project_id, resolved_work_item_id = _work_identity(
        note_id, project_id=project_id, work_item_id=work_item_id)
    if canonical_assignment is not None and not (
        resolved_project_id and resolved_work_item_id
    ):
        raise WorkIdentityConflict(
            "A governed assignment requires a durable project and Work Item identity"
        )
    leases = read_leases(vault_dir)
    existing = leases.get(note_id)
    if existing is not None and not isinstance(existing, dict):
        raise WorkIdentityConflict("Existing lease record is malformed")
    existing_run = None
    if isinstance(existing, dict):
        existing_run = _assert_existing_work_identity(
            vault_dir, existing,
            project_id=resolved_project_id,
            work_item_id=resolved_work_item_id,
        )
        if (
            existing.get("expires_at", 0) > now
            and existing.get("agent_id") != agent_id
        ):
            return LeaseResult(OUTCOME_ALREADY_LEASED, existing)
        if existing.get("agent_id") == agent_id and existing_run is not None:
            _assert_governed_assignment(existing_run, canonical_assignment)
    existing_run_id = (
        existing.get("work_run_id")
        if isinstance(existing, dict) and existing.get("agent_id") == agent_id
        else None
    )
    work_run_id = existing_run_id or (
        _new_work_run_id(resolved_project_id, resolved_work_item_id, agent_id, now, base_head)
        if resolved_project_id and resolved_work_item_id else None
    )
    handoff_token = secrets.token_urlsafe(32)
    handoff_expires_at = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ", time.gmtime(now + ttl_seconds))
    lease = {
        "agent_id": agent_id,
        "base_head": base_head,
        "acquired_at": now,
        "expires_at": now + ttl_seconds,
        "handoff_token": handoff_token,
    }
    if work_run_id:
        lease.update({
            "project_id": resolved_project_id,
            "work_item_id": resolved_work_item_id,
            "work_run_id": work_run_id,
        })
    leases[note_id] = lease
    _write_leases(vault_dir, leases)
    if work_run_id:
        run = read_work_run(vault_dir, resolved_project_id, work_run_id)
        if not run:
            token = transition_token or f"driver:lease:{work_run_id.split('/', 1)[1]}"
            run = {
                "schema_version": 2 if canonical_assignment is not None else 1,
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
            }
            if canonical_assignment is not None:
                run.update(canonical_assignment)
        else:
            run["updated_at"] = now
        run["handoff_token_hash"] = hashlib.sha256(
            handoff_token.encode("utf-8")).hexdigest()
        run["handoff_expires_at"] = handoff_expires_at
        _write_work_run(vault_dir, run)
    return LeaseResult(OUTCOME_ACQUIRED, lease)


def acquire_lease(
    vault_dir, note_id, agent_id, *, current_head, base_head, ttl_seconds, now,
    project_id=None, work_item_id=None, transition_token=None,
    governed_assignment=None,
) -> LeaseResult:
    """Atomically claim an item under the cross-runtime Work Run lock."""
    with _work_run_lock(vault_dir):
        return _acquire_lease_unlocked(
            vault_dir, note_id, agent_id,
            current_head=current_head, base_head=base_head,
            ttl_seconds=ttl_seconds, now=now, project_id=project_id,
            work_item_id=work_item_id, transition_token=transition_token,
            governed_assignment=governed_assignment,
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
