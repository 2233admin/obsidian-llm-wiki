"""Task 8P: the authoritative work update protocol (PR2, the spine).

> capture is a proposal -- promote is the commit -- compile only reads
> already-committed work truth.

This module lands the *write-side* protocol that §-1 of the work-OS brief calls
the single transaction: an agent's `state: done` is a *draft proposal*, never a
silent close. Only promotion mutates work truth, and promotion must be complete,
auditable, and concurrency-safe.

It is purely additive (a NEW module, per §0 #6: nothing in currency.py /
kb_meta.py changes behaviour). It builds two things on top of the Task 8A state
contract (currency.work_state / resolve_assignee / ...):

  1. Two indexes (is_authoritative_work_note / candidate filter):
       - authoritative work index = `status: reviewed` snapshots
                                     + legacy-compatible heads (Task 7 behaviour)
       - candidate index          = `status: draft` captures
     The project-status / relations / closed_count passes read ONLY the
     authoritative index; drafts never move a counter.

  2. promote(vault_dir, candidate, apply=False): resolve the current
     authoritative head H for candidate.entity, gate on the optimistic-lock
     base-head, and -- only if it matches -- *materialize a complete reviewed
     snapshot at write time* (inheritance happens here, NOT at compiler read
     time, so the final Markdown is itself the whole truth). Dry-run is the
     default: apply=False returns the planned snapshot text + outcome and writes
     NOTHING. apply=True appends a new reviewed note and never edits/deletes H or
     the candidate.

note-id convention (sync with kb_meta): `base-head` / `supersedes` / `promotes`
reference a note-id = repo-relative path. `blocked-by` / `related` / `initiative`
/ `cycle` reference an entity. The two are never mixed.

NO DB, NO embeddings, NO network, NO LLM. Markdown is the only truth.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# currency.py is the Task 8A state contract + frontmatter normalizer; _md_parse
# is the robust frontmatter parser kb_meta also uses. Import works whether this
# module is imported from compiler/ or run as a script (cwd-relative path added).
import sys as _sys

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in _sys.path:
    _sys.path.insert(0, str(_HERE))

import currency as _currency  # noqa: E402
from _md_parse import parse_frontmatter as _parse_frontmatter  # noqa: E402


# --- review-axis status vocabulary -----------------------------------------
# `status` is the REVIEW axis (§1), distinct from the `state` WORKFLOW axis.
# Only these two review words participate in the work-update protocol; a legacy
# work note carries neither (it used `status` for the work axis instead).
STATUS_DRAFT = "draft"
STATUS_REVIEWED = "reviewed"

# Provenance / truth-chain frontmatter fields (note-id references, §1).
F_STATUS = "status"
F_BASE_HEAD = "base-head"
F_SUPERSEDES = "supersedes"
F_PROMOTES = "promotes"
F_PROMOTED_BY = "promoted-by"
F_GENERATED_BY = "generated-by"
F_LAST_VERIFIED = "last-verified"

# The allowlist of fields a materialized snapshot may carry (§2 / §3). A snapshot
# is built ONLY from these keys -- nothing else leaks from the candidate or head.
# Order here is the deterministic serialization order for the frontmatter block.
SNAPSHOT_FIELDS = (
    "type",
    "entity",
    "state",
    "assignee",
    "priority",
    "estimate",
    "due",
    "tags",
    "blocked-by",
    "related",
    "initiative",
    "cycle",
    "squad",
)

# new-entity defaults: applied only when neither the candidate nor a previous
# head supplies the field. Backlog is the canonical empty work state (8A).
_NEW_ENTITY_DEFAULTS = {
    "state": _currency.DEFAULT_STATE,
}

# promote() outcome codes.
OUTCOME_MATERIALIZED = "MATERIALIZED"      # base-head matches (or new entity) -> snapshot built
OUTCOME_HEAD_MISMATCH = "HEAD_MISMATCH"    # base-head stale/missing -> route to triage Conflicts
OUTCOME_NOT_DRAFT = "NOT_DRAFT"            # the candidate is not a status:draft capture

# default actor stamped into promoted-by when the caller does not name one.
DEFAULT_PROMOTED_BY = "human/unknown"

# the truth-conflict marker prefix surfaced when an entity has >=2 reviewed
# terminal heads (concurrency fallback, §2).
TRUTH_CONFLICT = "TRUTH-CONFLICT"


# --- the two indexes -------------------------------------------------------

def is_authoritative_work_note(cm) -> bool:
    """Does this note belong to the AUTHORITATIVE work index?

    Per §2 P0-2 the authoritative index = reviewed snapshots + legacy-compatible
    heads; the candidate index = status:draft captures. Concretely:

      * status == reviewed  -> True  (a promoted, materialized snapshot)
      * status == draft     -> False (a capture proposal -> candidate index)
      * neither (legacy work note: old open/done/active/... with no draft/
        reviewed review-status) -> True, preserving Task 7's behaviour where an
        un-reviewed legacy note still counts as the head.

    `cm` is a CurrencyMeta or a raw frontmatter dict (handled by _work_raw)."""
    s = _status(cm)
    if s == STATUS_REVIEWED:
        return True
    if s == STATUS_DRAFT:
        return False
    # legacy work note: no review-axis status -> Task 7 behaviour (authoritative).
    return True


def is_candidate_work_note(cm) -> bool:
    """A capture proposal: status == draft. The complement of the authoritative
    index for notes that carry a review status (a legacy note is neither edited
    nor treated as a candidate)."""
    return _status(cm) == STATUS_DRAFT


def _status(cm) -> Optional[str]:
    raw = _currency._work_raw(cm)
    v = raw.get(F_STATUS)
    if isinstance(v, str):
        v = v.strip().lower()
        return v or None
    return None


# --- scanned work notes ----------------------------------------------------

@dataclass
class WorkNote:
    """A scanned note carrying its note-id, normalized currency metadata, raw
    frontmatter, and body. note_id is the POSIX path relative to the vault dir
    (the stable optimistic-lock token used by base-head/supersedes/promotes)."""

    note_id: str
    path: Path
    cm: object
    raw: dict
    body: str

    @property
    def entity(self) -> Optional[str]:
        return self.cm.entity

    @property
    def status(self) -> Optional[str]:
        return _status(self.raw)

    @property
    def is_authoritative(self) -> bool:
        return is_authoritative_work_note(self.raw)

    @property
    def is_candidate(self) -> bool:
        return is_candidate_work_note(self.raw)


def _split_frontmatter(text: str) -> str:
    """Return the body (everything after the leading frontmatter block), or the
    whole text when there is no frontmatter. Mirrors _md_parse's fence regex."""
    import re
    m = re.match(r"\A---\r?\n.*?\r?\n---\r?\n", text, re.DOTALL)
    return text[m.end():] if m else text


def scan_work_notes(vault_dir) -> list[WorkNote]:
    """Walk every .md under vault_dir and return the notes that carry an
    `entity` (the only ones the work protocol reasons about). Deterministic
    order (sorted by note_id). Skips dotfiles/derived dirs like kb_meta.walk_md,
    but is self-contained so this module stays zero-dependency on kb_meta."""
    root = Path(vault_dir)
    notes: list[WorkNote] = []
    if not root.exists():
        return notes
    skip = {".obsidian", "node_modules", ".git", "schema", ".trash"}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(
            d for d in dirnames if d not in skip and not d.startswith("_")
        )
        for fn in sorted(filenames):
            if not fn.endswith(".md"):
                continue
            f = Path(dirpath) / fn
            try:
                text = f.read_text("utf-8-sig", errors="replace")
            except OSError:
                continue
            fm = _parse_frontmatter(text)
            cm = _currency.normalize(fm)
            if not cm.entity:
                continue
            note_id = f.relative_to(root).as_posix()
            notes.append(WorkNote(note_id, f, cm, fm, _split_frontmatter(text)))
    notes.sort(key=lambda n: n.note_id)
    return notes


# --- head resolution (authoritative supersession) --------------------------

def _recency_key(n: WorkNote):
    """Recency comparator for picking the newest head among survivors. Reuses
    the currency convention: higher last-verified wins, then reviewed > draft >
    missing, then note_id for a stable tiebreak."""
    lv = n.cm.last_verified or ""
    status_rank = {STATUS_REVIEWED: 2, STATUS_DRAFT: 1}.get(n.status or "", 0)
    return (lv, status_rank, n.note_id)


@dataclass
class HeadResolution:
    """The authoritative head for an entity, plus the terminal-head set used by
    the multi-head concurrency guard."""

    head: Optional[WorkNote]
    terminal_heads: list = field(default_factory=list)  # notes nothing supersedes
    truth_conflict: bool = False
    conflict_note_ids: list = field(default_factory=list)


def resolve_head(notes: list[WorkNote], entity: str) -> HeadResolution:
    """Resolve the current AUTHORITATIVE head H for `entity`.

    Only authoritative notes (reviewed + legacy heads, NOT drafts) participate --
    a draft `state: done` capture must never be picked as the head (§3 #1).

    The supersession rule mirrors kb_meta._pass1_supersession, restricted to the
    authoritative set: a note that something else `supersedes` (by note-id) is
    not terminal; the head is the newest terminal note. Surviving notes that
    nothing supersedes are the `terminal_heads`. >=2 reviewed terminal heads ->
    CURRENT-TRUTH-CONFLICT (§2): we DO NOT pick a timestamp winner; we flag it."""
    group = [n for n in notes if n.entity == entity and n.is_authoritative]
    if not group:
        return HeadResolution(head=None)

    by_id = {n.note_id: n for n in group}
    superseded_ids: set[str] = set()
    for n in group:
        tgt = _scalar_field(n.raw, F_SUPERSEDES)
        if not tgt:
            continue
        victim = _resolve_note_id(tgt, group)
        if victim is not None and victim.note_id != n.note_id:
            superseded_ids.add(victim.note_id)

    terminal = [n for n in group if n.note_id not in superseded_ids]
    if not terminal:
        terminal = list(group)  # cycle / all-superseded fail-safe

    reviewed_terminal = [n for n in terminal if n.status == STATUS_REVIEWED]
    truth_conflict = len(reviewed_terminal) >= 2

    head = max(terminal, key=_recency_key)
    return HeadResolution(
        head=head,
        terminal_heads=sorted(terminal, key=lambda n: n.note_id),
        truth_conflict=truth_conflict,
        conflict_note_ids=sorted(n.note_id for n in reviewed_terminal),
    )


def _resolve_note_id(target: str, group: list[WorkNote]) -> Optional[WorkNote]:
    """Resolve a note-id pointer (base-head / supersedes) to a note in `group`.
    Exact note-id first, then a tolerant suffix / stem match (mirrors
    kb_meta._resolve_supersedes so authors can write a bare path or stem)."""
    if not target:
        return None
    t = target.strip().replace("\\", "/")
    for n in group:
        if n.note_id == t:
            return n
    for n in group:
        if n.note_id.endswith("/" + t) or n.note_id == t.lstrip("./"):
            return n
    stem = Path(t).name
    stem_noext = stem[:-3] if stem.endswith(".md") else stem
    for n in group:
        if n.path.name == stem or n.path.stem == stem_noext:
            return n
    return None


def effective_state(notes: list[WorkNote], entity: str) -> dict:
    """Concurrency fallback (§2): the effective state for an entity, refusing to
    auto-pick a winner when there are >=2 reviewed terminal heads.

    Returns {state, marker, head_note_id, conflict_note_ids}. On conflict the
    state falls back to the last UNAMBIGUOUS common ancestor (the newest note
    that supersedes both branches, i.e. precedes the fork), the marker is
    `[TRUTH-CONFLICT: H2,H3]`, and neither branch is allowed to silently close
    the issue. Otherwise marker is "" and state = work_state(head)."""
    res = resolve_head(notes, entity)
    if res.head is None:
        return {"state": None, "marker": "", "head_note_id": None,
                "conflict_note_ids": []}
    if not res.truth_conflict:
        return {
            "state": _currency.work_state(res.head.cm),
            "marker": "",
            "head_note_id": res.head.note_id,
            "conflict_note_ids": [],
        }
    # >=2 reviewed terminal heads: do not let either branch close the issue.
    ancestor = _last_common_ancestor(notes, entity, res.conflict_note_ids)
    state = _currency.work_state(ancestor.cm) if ancestor is not None else _currency.STATE_IN_PROGRESS
    marker = f"[{TRUTH_CONFLICT}: {','.join(res.conflict_note_ids)}]"
    return {
        "state": state,
        "marker": marker,
        "head_note_id": ancestor.note_id if ancestor is not None else None,
        "conflict_note_ids": list(res.conflict_note_ids),
    }


def _last_common_ancestor(notes: list[WorkNote], entity: str,
                          conflict_ids: list) -> Optional[WorkNote]:
    """The newest authoritative note that BOTH conflicting heads (transitively)
    supersede -- the last unambiguous point before the fork. Falls back to None
    when the branches share no ancestor (a fresh divergence)."""
    group = {n.note_id: n for n in notes
             if n.entity == entity and n.is_authoritative}

    def ancestors(note_id: str) -> set[str]:
        seen: set[str] = set()
        stack = [note_id]
        while stack:
            cur = stack.pop()
            n = group.get(cur)
            if n is None:
                continue
            tgt = _scalar_field(n.raw, F_SUPERSEDES)
            if not tgt:
                continue
            victim = _resolve_note_id(tgt, list(group.values()))
            if victim is not None and victim.note_id not in seen:
                seen.add(victim.note_id)
                stack.append(victim.note_id)
        return seen

    common = None
    for cid in conflict_ids:
        a = ancestors(cid)
        common = a if common is None else (common & a)
    if not common:
        return None
    return max((group[i] for i in common), key=_recency_key)


# --- promotion (the commit) ------------------------------------------------

@dataclass
class PromoteResult:
    """The outcome of a promote() call -- always returned, dry-run or applied."""

    outcome: str
    entity: Optional[str]
    head_note_id: Optional[str]
    snapshot_text: Optional[str] = None     # planned reviewed-note text (dry-run too)
    snapshot_note_id: Optional[str] = None  # where it WOULD be / WAS written
    written: Optional[str] = None           # abs path written, or None on dry-run
    reason: str = ""
    fields: dict = field(default_factory=dict)  # the merged snapshot field values

    @property
    def ok(self) -> bool:
        return self.outcome == OUTCOME_MATERIALIZED


def promote(vault_dir, candidate, apply: bool = False,
            promoted_by: Optional[str] = None,
            today: Optional[str] = None) -> PromoteResult:
    """Promote a draft capture into a materialized reviewed snapshot.

    Steps (§2, FOLLOWED EXACTLY):
      1. resolve the current authoritative head H for candidate.entity.
      2. base-head gate:
           * no H (new entity)                              -> materialize.
           * H exists AND base-head == note-id(H)           -> materialize.
           * H exists AND base-head missing or != note-id(H)-> HEAD_MISMATCH
             (route to triage Conflicts; never silent last-write-wins).
      3. materialize = build a COMPLETE snapshot at WRITE time from SNAPSHOT_FIELDS
         with precedence `candidate explicit > previous head H > new-entity
         default`; stamp status:reviewed, supersedes:note-id(H) (omit if new),
         promotes:note-id(candidate), generated-by (carried from candidate),
         promoted-by (param, default 'human/unknown'), last-verified.

    Dry-run by default: apply=False returns the planned snapshot + outcome and
    writes NOTHING. apply=True appends the new reviewed note (append-only; never
    edits/deletes H or the candidate).

    `today` pins the last-verified stamp (ISO date string) for deterministic,
    byte-assertable snapshots, mirroring cmd_currency(today_str=...); defaults to
    date.today() when None.

    `candidate` is a WorkNote (from scan_work_notes) or any object exposing
    .entity / .raw / .note_id / .body. Returns a PromoteResult always."""
    promoted_by = promoted_by or DEFAULT_PROMOTED_BY
    cand = _as_worknote(vault_dir, candidate)

    if not cand.is_candidate:
        return PromoteResult(
            outcome=OUTCOME_NOT_DRAFT, entity=cand.entity, head_note_id=None,
            reason=f"candidate {cand.note_id} is not status:draft "
                   f"(status={cand.status!r}); only drafts promote.",
        )

    entity = cand.entity
    notes = scan_work_notes(vault_dir)
    res = resolve_head(notes, entity)
    head = res.head
    head_id = head.note_id if head is not None else None

    base_head = _scalar_field(cand.raw, F_BASE_HEAD)

    if head is not None:
        if not base_head or not _note_id_matches(base_head, head, res.terminal_heads):
            return PromoteResult(
                outcome=OUTCOME_HEAD_MISMATCH, entity=entity, head_note_id=head_id,
                reason=(
                    f"base-head {base_head!r} != current authoritative head "
                    f"{head_id!r}; route to triage Conflicts (no last-write-wins)."
                ),
            )

    # base-head matches (or new entity) -> materialize a complete snapshot.
    fields = _materialize_fields(cand, head)
    snapshot_note_id = _snapshot_note_id(cand, entity)
    text = _render_snapshot(
        fields=fields,
        head_id=head_id,
        candidate_id=cand.note_id,
        generated_by=_scalar_field(cand.raw, F_GENERATED_BY),
        promoted_by=promoted_by,
        last_verified=today or _today_iso(),
        body=cand.body,
    )

    written = None
    if apply:
        out_path = Path(vault_dir) / snapshot_note_id
        out_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = out_path.with_suffix(out_path.suffix + ".tmp")
        try:
            # Write bytes (NOT text mode): text is rendered with pure LF, and
            # text-mode write_text would apply OS newline translation (CRLF on
            # Windows), making the on-disk artifact platform-dependent. Bytes
            # keep the file byte-identical to the render (invariant f / d).
            tmp.write_bytes(text.encode("utf-8"))
            tmp.replace(out_path)
        except Exception:
            tmp.unlink(missing_ok=True)
            raise
        written = str(out_path)

    return PromoteResult(
        outcome=OUTCOME_MATERIALIZED, entity=entity, head_note_id=head_id,
        snapshot_text=text, snapshot_note_id=snapshot_note_id, written=written,
        reason="new entity" if head is None else f"base-head matches {head_id}",
        fields=fields,
    )


def _materialize_fields(cand: WorkNote, head: Optional[WorkNote]) -> dict:
    """Build the complete snapshot field map from SNAPSHOT_FIELDS with precedence
    candidate-explicit > previous-head > new-entity default. Inheritance happens
    HERE (write time), so the resulting Markdown is itself the whole truth -- the
    compiler never silently inherits at read time (§2)."""
    out: dict = {}
    head_raw = head.raw if head is not None else {}
    for key in SNAPSHOT_FIELDS:
        if key in cand.raw and not _is_empty(cand.raw[key]):
            out[key] = cand.raw[key]
        elif key in head_raw and not _is_empty(head_raw[key]):
            out[key] = head_raw[key]
        elif key in _NEW_ENTITY_DEFAULTS:
            out[key] = _NEW_ENTITY_DEFAULTS[key]
    return out


def _snapshot_note_id(cand: WorkNote, entity: str) -> str:
    """Where the new reviewed snapshot is written. Append-only sibling of the
    candidate, named `<entity-leaf>.reviewed.<n>.md` under the candidate's dir,
    so H and the candidate are never touched and successive promotes never
    collide."""
    parent = cand.path.parent
    leaf = entity.rstrip("/").split("/")[-1] or "snapshot"
    n = 1
    # derive vault root from note_id vs path so relative note-id stays correct.
    rel_parts = cand.note_id.split("/")
    root = cand.path
    for _ in rel_parts:
        root = root.parent
    while True:
        name = f"{leaf}.reviewed.{n}.md"
        candidate_path = parent / name
        if not candidate_path.exists():
            return candidate_path.relative_to(root).as_posix()
        n += 1


def _render_snapshot(fields: dict, head_id: Optional[str], candidate_id: str,
                     generated_by: Optional[str], promoted_by: str,
                     last_verified: str, body: str) -> str:
    """Serialize the materialized snapshot to a complete reviewed note. Field
    order is deterministic: SNAPSHOT_FIELDS (present ones) then the provenance /
    truth-chain block, so two runs byte-match and diffs stay minimal."""
    lines = ["---"]
    for key in SNAPSHOT_FIELDS:
        if key not in fields:
            continue
        lines.append(_fmt_field(key, fields[key]))
    lines.append(f"{F_STATUS}: {STATUS_REVIEWED}")
    if head_id:
        lines.append(f"{F_SUPERSEDES}: {head_id}")
    lines.append(f"{F_PROMOTES}: {candidate_id}")
    if generated_by:
        lines.append(f"{F_GENERATED_BY}: {generated_by}")
    lines.append(f"{F_PROMOTED_BY}: {promoted_by}")
    lines.append(f"{F_LAST_VERIFIED}: {last_verified}")
    lines.append("---")
    # Normalize an inherited body to pure LF so a CRLF-source capture cannot
    # leak mixed endings into the snapshot (keeps the whole render LF-only).
    body = body.replace("\r\n", "\n").replace("\r", "\n")
    body = body.lstrip("\n")
    text = "\n".join(lines) + "\n"
    if body:
        text += "\n" + body if not body.startswith("\n") else body
    if not text.endswith("\n"):
        text += "\n"
    return text


def _fmt_field(key: str, value) -> str:
    """Serialize one frontmatter field. Lists render as `[a, b]` (round-trips
    through _md_parse); scalars render verbatim."""
    if isinstance(value, list):
        inner = ", ".join(str(v) for v in value)
        return f"{key}: [{inner}]"
    return f"{key}: {value}"


# --- small helpers ---------------------------------------------------------

def _scalar_field(raw: dict, key: str) -> Optional[str]:
    """Read a single-value frontmatter field as a trimmed string, or None. A
    list value (e.g. an empty `key:`) collapses to None -- these provenance
    pointers are always scalars."""
    v = raw.get(key)
    if isinstance(v, str):
        v = v.strip()
        return v or None
    if isinstance(v, list):
        return None
    return None if v is None else str(v)


def _note_id_matches(base_head: str, head: WorkNote, terminal_heads: list) -> bool:
    """True when base_head points at the current authoritative head. Exact note-id
    match is the fast path; a tolerant resolve (suffix) covers bare paths. Only the
    resolved current head counts -- pointing at a stale terminal head is still a
    mismatch (that is the optimistic-lock failure we must catch).

    Invariant (b): base-head is a note-id (repo-relative path), NEVER an entity.
    The optimistic lock therefore rejects a token that matches the head only by a
    bare filename-stem -- e.g. an entity (`project/iii-pivot/issue/db-migration`)
    whose last segment collides with the head's file stem (`db-migration`). A
    note-id must look like a path: it equals the note-id, is a path-suffix of it,
    or ends in `.md`. This closes the entity/note-id namespace leak WITHOUT
    loosening resolve_head's supersedes tolerance (which keeps the bare-stem
    fallback for authored supersedes pointers)."""
    if not base_head:
        return False
    resolved = _resolve_note_id(base_head, [head] + list(terminal_heads))
    if resolved is None or resolved.note_id != head.note_id:
        return False
    # Accept only when the token is itself note-id-shaped against this head:
    # exact note-id, a path-suffix of it, or a `.md`-suffixed bare path. A bare
    # stem / entity string that resolved only by filename-stem collision is
    # rejected (it is not a note-id, so it must not satisfy the optimistic lock).
    t = base_head.strip().replace("\\", "/")
    if t == head.note_id or head.note_id.endswith("/" + t) or head.note_id == t.lstrip("./"):
        return True
    return t.endswith(".md")


def _as_worknote(vault_dir, candidate) -> WorkNote:
    """Accept a WorkNote directly, or coerce a duck-typed object/dict into one."""
    if isinstance(candidate, WorkNote):
        return candidate
    # duck-typed: needs .entity/.raw/.note_id; rebuild via a vault scan match.
    note_id = getattr(candidate, "note_id", None)
    if note_id:
        for n in scan_work_notes(vault_dir):
            if n.note_id == note_id:
                return n
    raise TypeError("promote() needs a WorkNote (from scan_work_notes) or a note_id")


def _is_empty(v) -> bool:
    if v is None:
        return True
    if isinstance(v, str):
        return v.strip() == ""
    if isinstance(v, (list, dict)):
        return len(v) == 0
    return False


def _today_iso() -> str:
    from datetime import date
    return date.today().isoformat()
