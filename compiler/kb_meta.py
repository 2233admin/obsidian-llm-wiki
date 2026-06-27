#!/usr/bin/env python3
"""KB metadata engine -- zero-dependency CLI for knowledge base management.

Usage:
    python kb_meta.py init <vault> <topic>
    python kb_meta.py diff <vault> <topic>
    python kb_meta.py update-hash <vault> <topic> <file>
    python kb_meta.py update-index <vault> <topic>
    python kb_meta.py check-links <vault> <topic>
    python kb_meta.py vitality <vault> <topic>
    python kb_meta.py log-access <vault> <topic> <article>
    python kb_meta.py currency <vault> <topic> [--today YYYY-MM-DD] [--apply]
    python kb_meta.py project-scan <vault> [extra_root ...]
    python kb_meta.py project-adopt <vault> <path> --entity project/<slug> [--apply] [--today YYYY-MM-DD]
    python kb_meta.py workspace-status <vault> [--apply] [--as-of YYYY-MM-DD]
    python kb_meta.py sync-pull <vault> [--provider X] [--apply] [--today YYYY-MM-DD]
    python kb_meta.py sync-plan <vault> [--today YYYY-MM-DD]
    python kb_meta.py sync-apply <vault> [--apply] [--today YYYY-MM-DD]
    python kb_meta.py ensure-plugin <vault> [--plugin <id>] [--repo owner/name] [--apply] [--force]

All commands output JSON to stdout for machine consumption.
"""

import hashlib
import json
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

# Currency layer (Task 1 schema landing) + robust frontmatter parser.
# These live next to this file; import works whether kb_meta.py is invoked as a
# script (cwd-relative) or imported as a module from compiler/.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import currency as _currency  # noqa: E402
import work_protocol as _work_protocol  # noqa: E402
import workspace as _workspace  # noqa: E402
import forge as _forge  # noqa: E402
import plugins as _plugins  # noqa: E402
from _md_parse import parse_frontmatter as robust_parse_frontmatter  # noqa: E402


def meta_path(vault: str, topic: str) -> Path:
    return Path(vault) / topic / "_meta.json"


def load_meta(vault: str, topic: str) -> dict:
    p = meta_path(vault, topic)
    if p.exists():
        return json.loads(p.read_text("utf-8-sig"))
    return {"topic": topic, "created": today(), "sources": {}, "access_log": {}}


def save_meta(vault: str, topic: str, meta: dict) -> None:
    p = meta_path(vault, topic)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    try:
        # Write bytes (NOT text mode): json.dumps emits LF, but text-mode write
        # translates to CRLF on Windows -> platform-dependent on-disk state. Bytes
        # keep it LF-only, matching the derived views (invariant c).
        tmp.write_bytes(json.dumps(meta, indent=2, ensure_ascii=False).encode("utf-8"))
        tmp.replace(p)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def now_iso() -> str:
    from datetime import timezone
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def file_hash(path: Path) -> str:
    h = hashlib.blake2b(digest_size=8)
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_frontmatter(text: str) -> dict:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    fm = {}
    for line in text[4:end].split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        colon = line.find(":")
        if colon == -1:
            continue
        key = line[:colon].strip()
        val = line[colon + 1:].strip()
        if val.startswith('"') and val.endswith('"'):
            val = val[1:-1]
        elif val.startswith("'") and val.endswith("'"):
            val = val[1:-1]
        fm[key] = val
    return fm


def extract_wikilinks(text: str) -> list[str]:
    pattern = r"\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]"
    return [
        m.group(1).split("#")[0].strip()
        for m in re.finditer(pattern, text)
        if not m.group(1).strip().startswith("#")
    ]


def walk_md(base: Path) -> list[Path]:
    results = []
    for root, dirs, files in os.walk(base):
        skip = (".obsidian", "node_modules", ".git", "schema", ".trash")
        dirs[:] = sorted(
            d for d in dirs if d not in skip and not d.startswith("_")
        )
        for f in sorted(files):
            if f.endswith(".md"):
                results.append(Path(root) / f)
    results.sort()
    return results


# --- Commands ---

def cmd_init(vault: str, topic: str) -> dict:
    meta = load_meta(vault, topic)
    if "created" not in meta:
        meta["created"] = today()
    if "sources" not in meta:
        meta["sources"] = {}
    if "access_log" not in meta:
        meta["access_log"] = {}
    save_meta(vault, topic, meta)
    return {"ok": True, "topic": topic, "meta_path": str(meta_path(vault, topic))}


def cmd_diff(vault: str, topic: str) -> dict:
    meta = load_meta(vault, topic)
    raw_dir = Path(vault) / topic / "raw"
    if not raw_dir.exists():
        return {"new": [], "changed": [], "deleted": [], "unchanged": []}

    current_files = {}
    for f in walk_md(raw_dir):
        rel = f.relative_to(Path(vault) / topic).as_posix()
        current_files[rel] = file_hash(f)

    known = meta.get("sources", {})
    new, changed, unchanged = [], [], []
    for rel, h in sorted(current_files.items()):
        if rel not in known:
            new.append(rel)
        elif known[rel].get("hash") != h:
            changed.append(rel)
        else:
            unchanged.append(rel)

    deleted = [r for r in sorted(known) if r not in current_files]

    return {"new": new, "changed": changed, "deleted": deleted, "unchanged": unchanged}


def cmd_update_hash(vault: str, topic: str, file_rel: str) -> dict:
    file_rel = Path(file_rel).as_posix()
    meta = load_meta(vault, topic)
    full = Path(vault) / topic / file_rel
    if not full.exists():
        return {"error": f"File not found: {file_rel}"}
    h = file_hash(full)
    meta.setdefault("sources", {})[file_rel] = {
        "hash": h,
        "compiled_at": now_iso(),
    }
    save_meta(vault, topic, meta)
    return {"ok": True, "file": file_rel, "hash": h}


def cmd_update_index(vault: str, topic: str) -> dict:
    base = Path(vault) / topic
    wiki = base / "wiki"
    if not wiki.exists():
        return {"error": "wiki/ directory not found"}

    def scan_dir(subdir: str) -> list[dict]:
        d = wiki / subdir
        if not d.exists():
            return []
        rows = []
        for f in sorted(d.iterdir()):
            if not f.name.endswith(".md") or f.name.startswith("_"):
                continue
            text = f.read_text("utf-8-sig", errors="replace")
            # extract first non-heading, non-frontmatter paragraph as one-liner
            lines = text.split("\n")
            one_liner = ""
            in_fm = False
            for line in lines:
                if line.strip() == "---":
                    in_fm = not in_fm
                    continue
                if in_fm:
                    continue
                if line.startswith("#"):
                    continue
                stripped = line.strip()
                if stripped:
                    one_liner = stripped[:150]
                    break
            rows.append({
                "file": f"{subdir}/{f.stem}",
                "one_liner": one_liner,
            })
        return rows

    summaries = scan_dir("summaries")
    concepts = scan_dir("concepts")
    queries = scan_dir("queries")

    # count raw sources
    raw_dir = base / "raw"
    source_count = len(walk_md(raw_dir)) if raw_dir.exists() else 0

    # build index content
    def table_rows(items):
        return "\n".join(f"| [[{r['file']}]] | {r['one_liner']} |" for r in items) if items else ""

    index_content = (
        f"# {topic} Knowledge Base\n\n"
        f"> Auto-maintained index. Do not edit manually.\n"
        f"> Sources: {source_count} | Articles: {len(summaries)}"
        f" | Concepts: {len(concepts)}"
        f" | Last compiled: {today()}\n\n"
        f"## Summaries\n| File | One-liner |\n|------|-----------|\n{table_rows(summaries)}\n\n"
        f"## Concepts\n| File | One-liner |\n|------|-----------|\n{table_rows(concepts)}\n\n"
        f"## Queries\n| File | One-liner |\n|------|-----------|\n{table_rows(queries)}\n"
    )

    # --- ADDITIVE: entities/ scan + STALE/UNSUPPORTED visibility (Task 2) ----
    # Appended AFTER the existing sections so the Summaries/Concepts/Queries
    # blocks above stay byte-identical. The Entities section appears only when
    # an entities/ dir exists with notes; the Stale / Unsupported sections appear
    # only when the currency passes find entries. When nothing is stale/
    # unsupported and there is no entities/ dir, the output is unchanged.
    entities = scan_dir("entities")
    extra = ""
    if entities:
        extra += (
            f"\n## Entities\n| File | One-liner |\n|------|-----------|\n"
            f"{table_rows(entities)}\n"
        )

    stale_rows: list[str] = []
    unsupported_rows: list[str] = []
    try:
        cur = cmd_currency(vault, topic, apply=False)
        for entity, info in sorted(cur.get("entities", {}).items()):
            reason = "; ".join(info.get("reasons", []))
            cell = f"| {entity} | {info['note_id']} | {reason} |"
            if "STALE" in info.get("marker", ""):
                stale_rows.append(cell)
            if "UNSUPPORTED" in info.get("marker", ""):
                unsupported_rows.append(cell)
    except Exception:
        pass  # currency passes are additive; never break the base index.

    if stale_rows:
        extra += (
            "\n## Stale\n| Entity | Note | Reason |\n|--------|------|--------|\n"
            + "\n".join(stale_rows) + "\n"
        )
    if unsupported_rows:
        extra += (
            "\n## Unsupported\n| Entity | Note | Reason |\n|--------|------|--------|\n"
            + "\n".join(unsupported_rows) + "\n"
        )

    index_content = index_content + extra

    index_path = wiki / "_index.md"
    tmp = index_path.with_suffix(".tmp")
    try:
        # Write bytes (NOT text mode) so the derived _index.md is LF-only and
        # byte-stable across OSes -- text-mode write_text applies OS newline
        # translation (CRLF on Windows), defeating the recomputable contract
        # (invariant c), the same reason the work-OS/currency views write bytes.
        tmp.write_bytes(index_content.replace("\r\n", "\n").encode("utf-8"))
        tmp.replace(index_path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise

    return {
        "ok": True,
        "summaries": len(summaries),
        "concepts": len(concepts),
        "queries": len(queries),
        "source_count": source_count,
    }


def cmd_check_links(vault: str, topic: str) -> dict:
    base = Path(vault) / topic
    wiki = base / "wiki"
    if not wiki.exists():
        return {"broken": [], "total_links": 0}

    broken = []
    total = 0
    # pre-collect wiki subdirs once (avoid re-scanning per link)
    wiki_subdirs = [d for d in wiki.iterdir() if d.is_dir() and not d.name.startswith("_")]
    for f in walk_md(wiki):
        text = f.read_text("utf-8-sig", errors="replace")
        links = extract_wikilinks(text)
        rel_from = f.relative_to(base).as_posix()
        for link in links:
            total += 1
            candidates = [
                base / link,
                base / (link + ".md"),
                wiki / link,
                wiki / (link + ".md"),
            ]
            for subdir in wiki_subdirs:
                candidates.append(subdir / link)
                candidates.append(subdir / (link + ".md"))
            if not any(c.exists() for c in candidates):
                broken.append({"from": rel_from, "to": link})

    return {"broken": broken, "total_links": total}


def cmd_vitality(vault: str, topic: str) -> dict:
    meta = load_meta(vault, topic)
    base = Path(vault) / topic / "wiki"
    if not base.exists():
        return {"accessed": [], "never_accessed": [], "total": 0}

    access_log = meta.get("access_log", {})
    accessed, never_accessed = [], []

    for f in walk_md(base):
        if f.name.startswith("_"):
            continue
        rel = f.relative_to(Path(vault) / topic).as_posix()
        if rel not in access_log:
            never_accessed.append(rel)
        else:
            last = access_log[rel].get("last_access", "")
            count = access_log[rel].get("count", 0)
            accessed.append({"path": rel, "last_access": last, "count": count})

    # sort accessed by last_access ascending (oldest = most stale first)
    accessed.sort(key=lambda x: x["last_access"])

    return {
        "accessed": accessed,
        "never_accessed": sorted(never_accessed),
        "total": len(accessed) + len(never_accessed),
    }


def cmd_log_access(vault: str, topic: str, article: str) -> dict:
    meta = load_meta(vault, topic)
    log = meta.setdefault("access_log", {})
    entry = log.setdefault(article, {"count": 0})
    entry["count"] = entry.get("count", 0) + 1
    entry["last_access"] = now_iso()
    save_meta(vault, topic, meta)
    return {"ok": True, "article": article, "count": entry["count"]}


# --- Currency passes (Task 2): supersession / staleness / unsupported -------
#
# Three derived passes that run AFTER the existing compile. NO LLM, NO network,
# NO git probe. They read note frontmatter via the robust parser, normalize via
# currency.py, and emit DERIVED, recomputable, gitignored artifacts. Source
# notes are NEVER mutated -- markers live only in the derived view/log.

# Derived output filenames (gitignored, recomputed every run).
CURRENT_TRUTH_FILE = "_current-truth.md"
SUPERSESSION_FILE = "_supersession.md"
# Machine-readable report consumed by the Node connector (Task 3). byNote maps a
# vault-root-relative note_id -> its currency verdict, so vault.search/read can
# inline markers without recomputing anything on the Node side.
CURRENCY_REPORT_FILE = "_currency.json"
# Task 7B: per-project current-truth view (DERIVED). Compiled from the entity
# graph: a `type: project` entity plus its project/<slug>/... actions & decisions.
PROJECT_STATUS_FILE = "_project-status.md"
# Task 8D: triage view (DERIVED). Lists UNCONSUMED candidate captures from
# 00-Inbox/AI-Output/** in three sections (Unclassified / Pending Review /
# Conflicts). A capture consumed by a promotes:/rejects: reference disappears.
TRIAGE_FILE = "_triage.md"
# Task 8E: initiative status view (DERIVED). Rolls each `type: initiative` entity
# (and any project carrying `initiative: initiative/<slug>`) up over its member
# projects: per-member status/marker/open/blocker counts + an initiative health
# (at-risk iff any member is STALE / has blockers, else on-track).
# Built on TOP of the _pass4 project_status (markers reused, not recomputed).
INITIATIVE_STATUS_FILE = "_initiative-status.md"
# Task 8F: per-cycle status view (DERIVED). Groups every authoritative work item
# whose current-truth head carries a `cycle:` value by that cycle id, and reports
# each cycle's completion rate (done / total). Mirrors the initiative pass: built
# on the already-resolved current_truth heads (drafts quarantined in _pass1), so a
# draft `state:done` never moves a cycle's completion. Additive, never alters the
# _pass4 / _pass5 output above (which must stay byte-stable).
CYCLE_STATUS_FILE = "_cycle-status.md"

# Task 10A: the work-OS map as an Obsidian JSONCanvas (DERIVED, gitignored,
# byte-stable). Obsidian reads .canvas natively -- no plugin needed.
WORK_OS_CANVAS_FILE = "_work-os.canvas"

# A sentinel that sorts BEFORE every real ISO date, so a missing last-verified
# is treated as "infinitely old" and loses every recency comparison.
_OLDEST_DATE = ""


class CurrencyNote:
    """A scanned note carrying its normalized currency metadata + location.

    note_id is the POSIX path relative to the vault root (stable, location-aware
    so wiki/ and 00-Inbox/ notes for the same entity coexist in one group)."""

    __slots__ = ("note_id", "path", "cm", "body_first_line", "markers", "reasons")

    def __init__(self, note_id: str, path: Path, cm, body_first_line: str) -> None:
        self.note_id = note_id
        self.path = path
        self.cm = cm
        self.body_first_line = body_first_line
        self.markers: list[str] = []
        self.reasons: list[str] = []

    @property
    def sort_key(self):
        # Recency: higher last_verified wins. Tiebreak: reviewed > draft >
        # missing, then alphabetical note_id (stable). Negate via tuple order in
        # the caller; here we expose comparable parts.
        lv = self.cm.last_verified or _OLDEST_DATE
        # REVIEW axis: read the new `review` field first, fall back to the legacy
        # `status` field (mirrors work_protocol._status). This is a recency
        # tiebreak only -- it never changes which notes are authoritative -- but
        # keep the precedence consistent so ranking matches the work-OS.
        _rev = (self.cm.raw.get("review") or "")
        _rev = _rev.strip().lower() if isinstance(_rev, str) else ""
        _rev = _rev or (self.cm.status or "")
        status_rank = {"reviewed": 2, "draft": 1}.get(_rev, 0)
        return (lv, status_rank, self.note_id)


def _first_body_line(text: str) -> str:
    """First non-empty, non-frontmatter, non-heading line of a note body."""
    body = text
    m = re.match(r"\A---\r?\n.*?\r?\n---\r?\n", text, re.DOTALL)
    if m:
        body = text[m.end():]
    for line in body.splitlines():
        s = line.strip()
        if s and not s.startswith("#"):
            return s[:200]
    return ""


# Task 7A: vault-global work-state folders also scanned for entity-bearing notes
# (project / decision / meeting-action), so project status drift is visible.
# Configurable; absent folders are skipped. Only notes carrying `entity` are kept.
WORK_DIRS = ("Projects", "Decisions", "Meetings")


def _scan_entity_notes(vault: str, topic: str) -> list[CurrencyNote]:
    """Scan <topic>/wiki/**, <vault>/00-Inbox/**, and the vault-global work
    folders (WORK_DIRS) for notes carrying an `entity` field. Returns notes
    sorted by note_id for deterministic output."""
    vault_root = Path(vault)
    roots = [vault_root / topic / "wiki", vault_root / "00-Inbox"]
    roots += [vault_root / d for d in WORK_DIRS]
    notes: list[CurrencyNote] = []
    seen: set[str] = set()
    for root in roots:
        if not root.exists():
            continue
        for f in walk_md(root):
            note_id = f.relative_to(vault_root).as_posix()
            if note_id in seen:
                continue
            try:
                text = f.read_text("utf-8-sig", errors="replace")
            except OSError:
                continue
            fm = robust_parse_frontmatter(text)
            cm = _currency.normalize(fm)
            if not cm.entity:
                continue
            seen.add(note_id)
            notes.append(CurrencyNote(note_id, f, cm, _first_body_line(text)))
    notes.sort(key=lambda n: n.note_id)
    return notes


def _resolve_supersedes(target: str, group: list[CurrencyNote]) -> CurrencyNote | None:
    """Resolve a `supersedes` pointer to a note in this entity's group.

    Tries, in order: exact note_id, posix-normalized match, filename-stem match.
    Returns None if the pointer is dangling / external (logged by caller)."""
    if not target:
        return None
    t = target.strip().replace("\\", "/")
    for n in group:
        if n.note_id == t:
            return n
    # tolerate leading ./ or differing prefixes -> suffix match
    for n in group:
        if n.note_id.endswith("/" + t) or n.note_id == t.lstrip("./"):
            return n
    # filename / stem match (e.g. supersedes: iii.md or iii)
    t_stem = Path(t).name
    t_stem_noext = t_stem[:-3] if t_stem.endswith(".md") else t_stem
    for n in group:
        if n.path.name == t_stem or n.path.stem == t_stem_noext:
            return n
    return None


def _pass1_supersession(notes: list[CurrencyNote]) -> tuple[dict, list, list]:
    """Group by entity; select current-truth; mark the rest SUPERSEDED.

    Returns (current_truth_by_entity, superseded_records, warnings).
    superseded_records: list of dicts {entity, note_id, topped_by, reason,
    status, last_verified, body}. current_truth_by_entity: entity -> CurrencyNote.
    """
    groups: dict[str, list[CurrencyNote]] = {}
    for n in notes:
        groups.setdefault(n.cm.entity, []).append(n)

    current_truth: dict[str, CurrencyNote] = {}
    superseded: list[dict] = []
    warnings: list[str] = []

    for entity in sorted(groups):
        group = sorted(groups[entity], key=lambda n: n.note_id)

        # Task 8P (P0-2): the authoritative WORK index never selects a `status:
        # draft` capture as current-truth. A draft is a candidate proposal (it
        # lives in _triage), so when a work entity also has an authoritative note
        # (reviewed snapshot or legacy work note) the drafts are quarantined here
        # -- the head is chosen ONLY among authoritative notes, so a draft
        # `state:done` can never become current-truth or move the _pass4 count.
        # SCOPE (§0 #8): this only applies to WORK entities (a note carrying a
        # work signal -- state/issue/action). A pure knowledge entity keeps the
        # generic Task 0-3 currency behaviour, where a newer *unreviewed* (draft)
        # note legitimately supersedes the old reviewed one. Guards: act only
        # when some note in the group is a work note, AND keep the group intact
        # when every note is a draft (a never-reviewed work item).
        if any(_work_protocol.is_work_note(n.cm) for n in group):
            authoritative = [n for n in group
                             if _work_protocol.is_authoritative_work_note(n.cm)]
            if authoritative:
                group = authoritative

        # Build explicit supersession map: superseded_note -> topping note.
        superseded_by: dict[str, CurrencyNote] = {}
        for n in group:
            tgt = n.cm.supersedes
            if not tgt:
                continue
            victim = _resolve_supersedes(tgt, group)
            if victim is None:
                warnings.append(
                    f"{entity}: {n.note_id} supersedes dangling target '{tgt}'"
                )
                continue
            if victim.note_id == n.note_id:
                continue  # self-reference, ignore
            superseded_by[victim.note_id] = n

        # Detect circular supersession; fall back to recency for the whole group.
        circular = False
        for vid, topper in superseded_by.items():
            if topper.note_id in superseded_by and superseded_by[topper.note_id].note_id == vid:
                circular = True
                break
        if circular:
            warnings.append(f"{entity}: circular supersedes -> falling back to recency")
            superseded_by = {}

        # Candidates = notes NOT explicitly superseded.
        survivors = [n for n in group if n.note_id not in superseded_by]
        if not survivors:
            # all superseded (cycle/fail-safe) -> use full group by recency
            survivors = group

        # current-truth = highest recency among survivors.
        winner = max(survivors, key=lambda n: n.sort_key)
        current_truth[entity] = winner

        # Everything that is not the winner is superseded (explicit or recency).
        for n in group:
            if n.note_id == winner.note_id:
                continue
            topper = superseded_by.get(n.note_id)
            if topper is not None:
                reason = f"explicitly by {topper.note_id}"
                topped_by = topper.note_id
            else:
                reason = f"recency (current-truth verified {winner.cm.last_verified or '?'})"
                topped_by = winner.note_id
            n.markers.append(_currency.MARK_SUPERSEDED)
            n.reasons.append(reason)
            superseded.append({
                "entity": entity,
                "note_id": n.note_id,
                "topped_by": topped_by,
                "reason": reason,
                "status": n.cm.status,
                "last_verified": n.cm.last_verified,
                "body": n.body_first_line,
            })

    return current_truth, superseded, warnings


def _parse_iso(d: str | None):
    if not d:
        return None
    try:
        return date.fromisoformat(d.strip())
    except (ValueError, AttributeError):
        return None


# Task 8B sort_key: an open action with no due date sorts AFTER every dated one
# (`due or DATE_MAX`). date.max is a stable, comparable sentinel.
_DATE_MAX = date.max


def _pass2_3_stale_unsupported(
    vault: str, topic: str, current_truth: dict, meta: dict, today_date: date,
) -> None:
    """On each current-truth note: PASS 3 (unsupported) then PASS 2 (staleness).

    Mutates each note's markers/reasons in place. Order per the brief: a note
    that is UNSUPPORTED skips the staleness check; a note with a valid source is
    checked for STALE via hash-change first, then age."""
    sources = meta.get("sources", {})
    topic_root = Path(vault) / topic

    for entity in sorted(current_truth):
        n = current_truth[entity]
        cm = n.cm

        # PASS 3: unsupported.
        if not cm.has_source:
            # Task 7C: a project is anchored by its own activity, not a commit --
            # an empty source is not "unsupported"; fall through to age-staleness.
            if cm.type != _currency.TYPE_PROJECT:
                n.markers.append(_currency.MARK_UNSUPPORTED)
                n.reasons.append("source field is empty")
                continue
        elif cm.source_scheme is None:
            n.markers.append(_currency.MARK_UNSUPPORTED)
            n.reasons.append(f"unrecognized source scheme: {cm.source!r}")
            continue

        # PASS 2: staleness. Hash-change signal first (path: scheme only).
        stale = False
        reason = ""
        if cm.source_scheme == "path":
            target_rel = cm.source_target or ""
            # normalize to topic-relative rel key used in _meta.json sources.
            rel_key = target_rel
            if rel_key.startswith(topic + "/"):
                rel_key = rel_key[len(topic) + 1:]
            target_path = topic_root / rel_key
            if not target_path.exists():
                stale, reason = True, f"source path unreachable: {target_rel}"
            else:
                recorded = sources.get(rel_key, {}).get("hash")
                if recorded is None:
                    stale, reason = True, f"source hash never recorded: {target_rel}"
                else:
                    current_hash = file_hash(target_path)
                    if current_hash != recorded:
                        stale, reason = True, f"source changed: {target_rel}"

        # Age signal (all schemes) -- only if not already stale by hash.
        if not stale:
            lv = _parse_iso(cm.last_verified)
            threshold = _currency.stale_threshold_days(cm.type)
            # Task 7A: a project in a terminal status (completed/archived) is
            # done, not drifting -- its age is expected, so skip age-staleness.
            project_terminal = (
                cm.type == _currency.TYPE_PROJECT
                and _currency.is_terminal_project_status(cm.status)
            )
            if project_terminal:
                pass
            elif lv is None:
                stale, reason = True, "last-verified missing/unparseable"
            else:
                age_days = (today_date - lv).days
                if age_days > threshold:
                    stale = True
                    reason = f"age {age_days}d > {threshold}d threshold ({cm.type})"

        if stale:
            n.markers.append(_currency.MARK_STALE)
            n.reasons.append(reason)
        else:
            n.markers.append(_currency.MARK_OK)


def _render_current_truth(topic: str, current_truth: dict, today_date: date) -> str:
    """Grep-friendly per-entity current-truth view (DERIVED)."""
    lines = [
        f"# {topic} -- current truth",
        "",
        "> DERIVED, recomputable, gitignored. Regenerated by `kb_meta currency`.",
        "> Do not edit; do not commit. Markers live here, never in source notes.",
        f"> Compiled: {today_date.isoformat()}",
        "",
    ]
    for entity in sorted(current_truth):
        n = current_truth[entity]
        cm = n.cm
        # markers excluding the bookkeeping OK -> show explicit verdict tags
        verdict = [m for m in n.markers if m != _currency.MARK_OK]
        marker_str = " + ".join(verdict) if verdict else _currency.MARK_OK
        reason_str = "; ".join(n.reasons) if n.reasons else ""
        lines.append(f"## {entity}")
        lines.append(f"- current-truth: {n.body_first_line}")
        lines.append(f"- note: {n.note_id}")
        lines.append(f"- source: {cm.source or '(none)'}")
        lines.append(f"- last-verified: {cm.last_verified or '(none)'}")
        lines.append(f"- status: {cm.status or '(none)'}")
        marker_line = f"- marker: {marker_str}"
        if reason_str:
            marker_line += f" ({reason_str})"
        lines.append(marker_line)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _render_supersession(topic: str, current_truth: dict, superseded: list) -> str:
    """Supersession log (DERIVED): superseded note -> what topped it."""
    lines = [
        f"# {topic} -- supersession log",
        "",
        "> DERIVED, recomputable, gitignored. Regenerated by `kb_meta currency`.",
        "> Superseded notes are NOT deleted; they are surfaced here only.",
        "",
    ]
    by_entity: dict[str, list[dict]] = {}
    for rec in superseded:
        by_entity.setdefault(rec["entity"], []).append(rec)

    for entity in sorted(by_entity):
        ct = current_truth.get(entity)
        lines.append(f"## {entity}")
        if ct is not None:
            lines.append(
                f"- current-truth: {ct.note_id} "
                f"(verified {ct.cm.last_verified or '?'}, status {ct.cm.status or '?'})"
            )
        lines.append("- superseded:")
        for rec in sorted(by_entity[entity], key=lambda r: r["note_id"]):
            lines.append(
                f"  - {rec['note_id']} -> topped by {rec['topped_by']} "
                f"[{rec['reason']}] (status {rec['status'] or '?'}, "
                f"verified {rec['last_verified'] or '?'}): {rec['body']}"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _current_truth_index(current_truth: dict) -> list:
    """Task 8C: build a work_protocol index (one WorkNote per entity) from the
    already-resolved current-truth heads.

    The blocker graph (effective_state / blocker_status) is computed against the
    AUTHORITATIVE heads -- which is exactly what `current_truth` already is after
    _pass1_supersession (drafts quarantined, supersession resolved, one winner
    per entity). Wrapping each CurrencyNote as a WorkNote lets _pass4 reuse the
    canonical blocker logic from work_protocol without re-scanning the disk or
    re-deriving relations here. A blocked-by target outside the project prefix is
    still resolvable because EVERY current-truth entity (project or not) is in
    this index."""
    return [
        _work_protocol.WorkNote(
            note_id=sn.note_id, path=sn.path, cm=sn.cm,
            raw=sn.cm.raw, body=sn.body_first_line,
        )
        for sn in current_truth.values()
    ]


def _pass4_project_status(current_truth: dict, today_date: date) -> dict:
    """Task 7B + 8C: compile per-project current-truth from the entity graph.

    A project is a `type: project` entity `project/<slug>`; its actions and
    decisions are entities namespaced under `project/<slug>/...`. Reuses the
    current-truth + staleness already computed by passes 1-3 -- the only new
    grouping is the entity-name prefix. Adds no new pass over the source notes.

    Task 8C wires the REAL Blockers view: an action is a blocker when its derived
    `effective_state == 'blocked'` (the real blocked-by graph -- active state AND
    an unresolved blocker). Legacy `status: blocked` notes that carry NO relation
    are still surfaced under Blockers, marked `[LEGACY-BLOCKED:NO-RELATION]`, so
    old data is never lost. Classification (mutually exclusive, in order):
      decision -> decisions; effective blocked -> blockers (real);
      legacy_blocked (no relation) -> blockers (legacy); done|canceled -> closed;
      else -> open_actions (active AND not blocked).

    Task 8B (PR5) adds, additively, ISSUE PROPERTIES to the open-action list:
    each open action carries [URGENT] (currency.is_urgent == priority 1, strictly
    not <=1), [OVERDUE] (parse_due < today AND work_state not in done|canceled),
    and [UNASSIGNED] (currency.resolve_assignee == UNASSIGNED -- owner stays a
    valid assignee alias; this REPLACES 7B's UNOWNED). open_actions are sorted by
    the 8B sort_key (urgent&overdue first, then PRIORITY_RANK, then overdue, then
    due date, then entity). The project section also surfaces `open_estimate`, the
    sum of open-action estimates (missing estimates are ignored). None of this
    changes generic current-truth / ranking / currency behaviour (§0 #6): it only
    reshapes the per-project open-action presentation.

    Returns project_entity -> {note_id, status, marker, reasons, open_actions,
    blockers, decisions, closed_count, open_estimate}."""
    out: dict = {}
    index = _current_truth_index(current_truth)
    projects = [e for e in sorted(current_truth)
                if current_truth[e].cm.type == _currency.TYPE_PROJECT]
    for pe in projects:
        pn = current_truth[pe]
        prefix = pe + "/"
        open_actions, blockers, decisions = [], [], []
        closed = 0
        for eid in sorted(current_truth):
            if not eid.startswith(prefix):
                continue
            sn = current_truth[eid]
            # Task 8P/8A contract: classify actions off the canonical WORK axis
            # (currency.work_state), NOT raw cm.status. work_state maps done/
            # completed/canceled/archived -> done|canceled and the legacy
            # `blocked` word -> in-progress + a legacy_blocked flag, so a capture
            # that says "done" via the work axis is counted consistently. Drafts
            # never reach here -- they were quarantined from current-truth
            # selection in _pass1_supersession, so a non-authoritative draft
            # cannot move a count.
            wstate = _currency.work_state(sn.cm)
            entry = {
                "entity": eid,
                "note_id": sn.note_id,
                "body": sn.body_first_line,
                "status": sn.cm.status,
                "owner": sn.cm.owner,
                "due": sn.cm.due,
                "last_verified": sn.cm.last_verified,
            }
            if "/decision/" in eid:
                decisions.append(entry)
                continue
            # everything else under the project is an action.
            eff = _work_protocol.effective_state(index, eid)
            if eff["state"] == _currency.STATE_BLOCKED:
                # REAL blocker: active head + unresolved blocked-by relation.
                entry["blocked_by"] = [b["target"] for b in eff["blockers"]]
                entry["blocker_detail"] = list(eff["blockers"])
                blockers.append(entry)
            elif _currency.legacy_blocked(sn.cm):
                # legacy status:blocked with no relation -> keep it visible but
                # mark it so new data is steered toward real blocked-by relations.
                entry["legacy_blocked"] = True
                blockers.append(entry)
            elif wstate in (_currency.STATE_DONE, _currency.STATE_CANCELED):
                closed += 1
            else:
                # Task 8B ISSUE PROPERTIES on the open action. urgent/overdue/
                # unassigned are read through the canonical currency helpers so the
                # `urgent <=> priority == 1` and `assignee > owner alias` semantics
                # are shared with the state contract, not re-spelled here.
                urgent = _currency.is_urgent(sn.cm)
                due_d = _currency.parse_due(sn.cm)
                # OVERDUE: due in the past. Terminal (done/canceled) heads were
                # already classified to `closed` above and never reach here, so the
                # suppression of OVERDUE for done/canceled is satisfied by
                # classification -- no redundant wstate guard needed.
                overdue = due_d is not None and due_d < today_date
                unassigned = (
                    _currency.resolve_assignee(sn.cm) == _currency.UNASSIGNED
                )
                flags = []
                if urgent:
                    flags.append("URGENT")
                if overdue:
                    flags.append("OVERDUE")
                if unassigned:
                    flags.append("UNASSIGNED")
                entry["assignee"] = _currency.resolve_assignee(sn.cm)
                entry["priority"] = _currency.work_priority(sn.cm)
                entry["estimate"] = _currency.work_estimate(sn.cm)
                entry["urgent"] = urgent
                entry["overdue"] = overdue
                entry["unassigned"] = unassigned
                entry["due_date"] = due_d  # parsed date or None, for the sort_key
                entry["flags"] = flags
                open_actions.append(entry)
        # Task 8B sort_key: urgent&overdue first, then priority rank, then overdue,
        # then due date (missing -> DATE_MAX so they sink), then entity for a
        # stable deterministic tie-break.
        open_actions.sort(key=lambda a: (
            0 if (a["urgent"] and a["overdue"]) else 1,
            _currency.PRIORITY_RANK.get(a["priority"], _currency.PRIORITY_RANK[None]),
            0 if a["overdue"] else 1,
            a["due_date"] or _DATE_MAX,
            a["entity"],
        ))
        # Task 8B estimate rollup: sum of open-action estimates, ignoring missing.
        open_estimate = sum(a["estimate"] for a in open_actions
                            if a["estimate"] is not None)
        decisions.sort(key=lambda d: (d["last_verified"] or "", d["entity"]), reverse=True)
        verdict = [m for m in pn.markers if m != _currency.MARK_OK]
        out[pe] = {
            "note_id": pn.note_id,
            "status": pn.cm.status,
            "marker": " + ".join(verdict) if verdict else _currency.MARK_OK,
            "reasons": list(pn.reasons),
            "open_actions": open_actions,
            "blockers": blockers,
            "decisions": decisions,
            "closed_count": closed,
            "open_estimate": open_estimate,
        }
    return out


def _render_project_status(project_status: dict, today_date: date) -> str:
    """Per-project current-truth view (DERIVED)."""
    lines = [
        "# project status -- current truth (DERIVED)",
        "",
        "> DERIVED, recomputable, gitignored. Regenerated by `kb_meta currency`.",
        "> Do not edit; do not commit. Compiled from the entity graph",
        "> (project/<slug> + project/<slug>/... actions & decisions).",
        f"> Compiled: {today_date.isoformat()}",
        "",
    ]
    for pe in sorted(project_status):
        p = project_status[pe]
        lines.append(f"## {pe}")
        status_line = f"- status: {p['status'] or '(none)'}"
        if p["marker"] and p["marker"] != _currency.MARK_OK:
            r = "; ".join(p["reasons"])
            status_line += f"  [{p['marker']}" + (f": {r}" if r else "") + "]"
        lines.append(status_line)
        lines.append(f"- note: {p['note_id']}")
        open_line = f"- open actions: {len(p['open_actions'])}"
        # Task 8B estimate rollup: surface the summed open-action estimate when
        # any open action carries one (missing estimates were ignored in the sum).
        if p.get("open_estimate"):
            open_line += f"  (open estimate: {p['open_estimate']} pts)"
        lines.append(open_line)
        for a in p["open_actions"]:
            tag = ("  " + "".join(f"[{f}]" for f in a.get("flags", []))) if a.get("flags") else ""
            lines.append(f"  - {a['entity']} -- {a['body']}{tag}")
        if p["blockers"]:
            lines.append(f"- blockers: {len(p['blockers'])}")
            for b in p["blockers"]:
                if b.get("legacy_blocked"):
                    # legacy status:blocked with no relation graph.
                    lines.append(f"  - {b['entity']} -- {b['body']}  [LEGACY-BLOCKED:NO-RELATION]")
                else:
                    # real blocked-by graph: name the unresolved dependencies.
                    detail = "; ".join(
                        f"{d['target']} ({d['status']})" for d in b.get("blocker_detail", [])
                    )
                    suffix = f"  [blocked-by: {detail}]" if detail else ""
                    lines.append(f"  - {b['entity']} -- {b['body']}{suffix}")
        if p["decisions"]:
            lines.append("- recent decisions:")
            for d in p["decisions"]:
                lines.append(f"  - {d['entity']} -- {d['body']} (verified {d['last_verified'] or '?'})")
        if p["closed_count"]:
            lines.append(f"- closed/superseded actions: {p['closed_count']} (see _supersession.md)")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# Task 8E: initiative health verdicts.
INITIATIVE_ON_TRACK = "on-track"
INITIATIVE_AT_RISK = "at-risk"


def _pass5_initiative_status(current_truth: dict, project_status: dict,
                             today_date: date) -> dict:
    """Task 8E: roll member projects up under their initiative.

    Two ways an initiative is discovered (UNION):
      1. a `type: initiative` note whose entity is `initiative/<slug>` -- its own
         record, used for the title/body/marker of the initiative section.
      2. any project that carries `initiative: initiative/<slug>` in its
         frontmatter -- it becomes a MEMBER of that initiative (even if no
         explicit initiative note exists, so a dangling linkage is still visible).

    For each initiative the rollup lists every member project's
    {entity, status, marker, open_count, blocker_count} -- REUSING the
    marker/open/blocker already computed by _pass4_project_status (this pass NEVER
    recomputes a project marker, per §0). Membership is built by iterating
    project_status, so every member is by construction backed by a project_status
    entry (a project whose authoritative head is missing/superseded was already
    pruned from current-truth in _pass1 and simply does not appear).

    Initiative health: 'at-risk' if ANY member is STALE or has blockers; else
    'on-track'. Totals (open/blocker/closed) are summed across the members.
    Deterministic ordering (initiatives + members sorted by entity).

    Returns initiative_entity -> {note_id, status, marker, reasons, health,
    members:[...], total_open, total_blockers, total_closed, member_count}.
    Empty dict when there are no initiatives at all (mirrors _pass4)."""
    # 1. project entity -> its declared initiative entity (from frontmatter link).
    #    Read off the authoritative current-truth project head, so a draft cannot
    #    forge membership (drafts were already quarantined in _pass1).
    member_of: dict = {}
    for pe in sorted(project_status):
        head = current_truth.get(pe)
        if head is None:
            continue
        link = _currency._scalar(head.cm.raw, _currency.F_INITIATIVE)
        if link:
            member_of[pe] = link.strip()

    # 2. initiative notes (type: initiative) keyed by their own entity.
    initiative_notes: dict = {}
    for ent in sorted(current_truth):
        n = current_truth[ent]
        if n.cm.type == _currency.TYPE_INITIATIVE:
            initiative_notes[ent] = n

    # 3. the UNION of initiative entities: those with a note + those merely linked.
    all_initiatives = set(initiative_notes) | set(member_of.values())
    if not all_initiatives:
        return {}

    out: dict = {}
    for ie in sorted(all_initiatives):
        # members = the project entities linking to this initiative.
        member_entities = sorted(pe for pe, link in member_of.items() if link == ie)
        members: list = []
        total_open = total_blockers = total_closed = 0
        at_risk = False
        for pe in member_entities:
            # membership keys come from project_status (see member_of build
            # above), so ps is always present -- no missing-member case exists.
            ps = project_status[pe]
            marker = ps["marker"]
            open_count = len(ps["open_actions"])
            blocker_count = len(ps["blockers"])
            closed_count = ps["closed_count"]
            members.append({
                "entity": pe, "status": ps["status"], "marker": marker,
                "open_count": open_count, "blocker_count": blocker_count,
                "closed_count": closed_count,
            })
            total_open += open_count
            total_blockers += blocker_count
            total_closed += closed_count
            # at-risk iff any member is STALE or carries blockers.
            if _currency.MARK_STALE in (marker or "") or blocker_count > 0:
                at_risk = True

        note = initiative_notes.get(ie)
        if note is not None:
            verdict = [m for m in note.markers if m != _currency.MARK_OK]
            out[ie] = {
                "note_id": note.note_id,
                "status": note.cm.status,
                "marker": " + ".join(verdict) if verdict else _currency.MARK_OK,
                "reasons": list(note.reasons),
            }
        else:
            # linkage-only initiative (no own note): still surfaced, no marker.
            out[ie] = {"note_id": None, "status": None,
                       "marker": _currency.MARK_OK, "reasons": []}
        out[ie].update({
            "health": INITIATIVE_AT_RISK if at_risk else INITIATIVE_ON_TRACK,
            "members": members,
            "total_open": total_open,
            "total_blockers": total_blockers,
            "total_closed": total_closed,
            "member_count": len(members),
        })
    return out


def _render_initiative_status(initiative_status: dict, today_date: date) -> str:
    """Per-initiative rollup view (DERIVED). One section per initiative with its
    health + member project rollup. LF-only, byte-stable (mirrors
    _render_project_status)."""
    lines = [
        "# Initiative Status",
        "",
        "> DERIVED, recomputable, gitignored. Regenerated by `kb_meta currency`.",
        "> Do not edit; do not commit. Rolled up from the project status graph",
        "> (initiative/<slug> + the projects that carry initiative: <it>).",
        f"> Compiled: {today_date.isoformat()}",
        "",
    ]
    for ie in sorted(initiative_status):
        it = initiative_status[ie]
        lines.append(f"## {ie}")
        health_line = f"- health: {it['health']}"
        lines.append(health_line)
        status_line = f"- status: {it['status'] or '(none)'}"
        if it["marker"] and it["marker"] != _currency.MARK_OK:
            r = "; ".join(it["reasons"])
            status_line += f"  [{it['marker']}" + (f": {r}" if r else "") + "]"
        lines.append(status_line)
        lines.append(f"- note: {it['note_id'] or '(no initiative note -- linkage only)'}")
        lines.append(
            f"- rollup: {it['member_count']} projects, "
            f"{it['total_open']} open, {it['total_blockers']} blockers, "
            f"{it['total_closed']} closed"
        )
        lines.append("- members:")
        for m in it["members"]:
            mk = m["marker"] if m["marker"] and m["marker"] != _currency.MARK_OK else "OK"
            lines.append(
                f"  - {m['entity']} -- status {m['status'] or '(none)'} [{mk}] "
                f"({m['open_count']} open, {m['blocker_count']} blockers, "
                f"{m['closed_count']} closed)"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _pass6_cycle_status(current_truth: dict, today_date: date) -> dict:
    """Task 8F: group authoritative work items by their `cycle:` id + completion.

    A work item declares its cycle via the `cycle:` field on the work axis (an
    opaque time-box id such as `2026-W26`, NOT an entity). This pass reads that id
    off each already-resolved current-truth head -- the heads were chosen in
    _pass1_supersession with drafts quarantined, so a `status:draft state:done`
    capture can NEVER move a cycle's completion (mirrors _pass4 / _pass5).

    Only notes carrying a non-empty `cycle:` are grouped; a note with no cycle is
    ignored entirely (so a cycle-less vault yields {} and writes no view).

    Per cycle, every member contributes {entity, note_id, work_state, flags}; the
    canonical work axis (currency.work_state) classifies it, so legacy status
    words map consistently.

    COMPLETION RULE (Linear-sensible, documented):
      done = work_state == done. CANCELED issues are EXCLUDED from the denominator
      entirely -- a canceled issue is neither a success nor outstanding work, so
      counting it would understate a cycle that legitimately dropped scope (this
      matches Linear, which excludes canceled issues from a cycle's progress).
      Thus  completion = done_count / countable, where countable = total - canceled
      (done + active states). When a cycle has only canceled issues, countable == 0
      and completion is reported as 0.0 (no progress to measure, not a div-by-zero).

    Deterministic ordering: cycles by id, members within a cycle by entity.

    Returns cycle_id -> {issues:[...], total, done_count, canceled_count,
    countable, active_count, completion}.
    """
    by_cycle: dict[str, list] = {}
    for ent in sorted(current_truth):
        n = current_truth[ent]
        cyc = _currency._scalar(n.cm.raw, _currency.F_CYCLE)
        if not cyc:
            continue
        wstate = _currency.work_state(n.cm)
        flags = []
        if _currency.is_urgent(n.cm):
            flags.append("URGENT")
        due_d = _currency.parse_due(n.cm)
        if (due_d is not None and due_d < today_date
                and wstate not in (_currency.STATE_DONE, _currency.STATE_CANCELED)):
            flags.append("OVERDUE")
        by_cycle.setdefault(cyc.strip(), []).append({
            "entity": ent,
            "note_id": n.note_id,
            "body": n.body_first_line,
            "work_state": wstate,
            "flags": flags,
        })

    out: dict = {}
    for cyc in sorted(by_cycle):
        issues = sorted(by_cycle[cyc], key=lambda i: i["entity"])
        total = len(issues)
        done_count = sum(1 for i in issues
                         if i["work_state"] == _currency.STATE_DONE)
        canceled_count = sum(1 for i in issues
                             if i["work_state"] == _currency.STATE_CANCELED)
        # canceled excluded from the denominator (documented rule above).
        countable = total - canceled_count
        completion = (done_count / countable) if countable else 0.0
        out[cyc] = {
            "issues": issues,
            "total": total,
            "done_count": done_count,
            "canceled_count": canceled_count,
            "countable": countable,
            "active_count": countable - done_count,
            "completion": completion,
        }
    return out


def _render_cycle_status(cycle_status: dict, today_date: date) -> str:
    """Per-cycle status view (DERIVED). One section per cycle: completion rate
    (done / countable, canceled excluded) + the issue list. LF-only, byte-stable
    (mirrors _render_initiative_status)."""
    lines = [
        "# Cycle Status",
        "",
        "> DERIVED, recomputable, gitignored. Regenerated by `kb_meta currency`.",
        "> Do not edit; do not commit. Grouped from authoritative work items that",
        "> carry a cycle: id. Completion = done / (total - canceled); canceled",
        "> issues are excluded from the denominator (Linear-sensible).",
        f"> Compiled: {today_date.isoformat()}",
        "",
    ]
    for cyc in sorted(cycle_status):
        c = cycle_status[cyc]
        pct = round(c["completion"] * 100)
        lines.append(f"## {cyc}")
        lines.append(
            f"- completion: {pct}% ({c['done_count']}/{c['countable']} done"
            + (f", {c['canceled_count']} canceled excluded" if c["canceled_count"] else "")
            + ")"
        )
        lines.append(
            f"- issues: {c['total']} "
            f"({c['done_count']} done, {c['active_count']} active, "
            f"{c['canceled_count']} canceled)"
        )
        for i in c["issues"]:
            tag = ("  " + "".join(f"[{f}]" for f in i["flags"])) if i["flags"] else ""
            lines.append(f"  - {i['entity']} -- {i['work_state']} -- {i['body']}{tag}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _render_triage(triage_items: list, today_date: date) -> str:
    """Task 8D triage view (DERIVED): unconsumed candidate captures grouped into
    Unclassified / Pending Review / Conflicts. Mirrors the _project-status render
    style. Consumed captures are already excluded by classify_triage, so they do
    not appear here."""
    lines = [
        "# triage -- unconsumed captures (DERIVED)",
        "",
        "> DERIVED, recomputable, gitignored. Regenerated by `kb_meta currency`.",
        "> Do not edit; do not commit. Captures are append-only -- accept via a",
        "> reviewed snapshot (promotes:) or reject via a decision note (rejects:);",
        "> a consumed capture disappears from this view (source bytes never change).",
        f"> Compiled: {today_date.isoformat()}",
        "",
    ]
    sections = (
        _work_protocol.TRIAGE_UNCLASSIFIED,
        _work_protocol.TRIAGE_PENDING_REVIEW,
        _work_protocol.TRIAGE_CONFLICTS,
    )
    for section in sections:
        rows = [it for it in triage_items if it.section == section]
        if not rows:
            continue
        lines.append(f"## {section} ({len(rows)})")
        for it in rows:
            head = it.entity or "(no entity)"
            body = f" -- {it.body}" if it.body else ""
            lines.append(f"- {head}{body}")
            lines.append(f"  - capture: {it.note_id}")
            lines.append(f"  - state: {it.state or '(none)'}; {it.reason}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# Task 10A: JSONCanvas color presets (Obsidian 1-6). done/canceled/backlog are
# left uncolored so Obsidian renders them neutral gray ("done 灰").
_CANVAS_COLOR_STALE = "1"        # red
_CANVAS_COLOR_BLOCKED = "2"      # orange
_CANVAS_COLOR_IN_PROGRESS = "4"  # green
_CANVAS_COLOR_TODO = "5"         # cyan


def _canvas_id(value: str) -> str:
    """Slug an entity into a canvas-safe node id (mirrors the TS canvasId)."""
    s = re.sub(r"[^a-z0-9_-]+", "-", (value or "").lower()).strip("-")
    return s or "node"


def _blocked_by_targets(note) -> list[str]:
    """The entities a note declares it is blocked by (frontmatter `blocked-by`,
    scalar or list), for canvas edges -- sorted for deterministic output."""
    if note is None:
        return []
    v = (note.cm.raw or {}).get("blocked-by")
    if not v:
        return []
    items = [v] if isinstance(v, str) else (v if isinstance(v, list) else [])
    return sorted(str(t).strip() for t in items if str(t).strip())


def _canvas_node_color(note, index, entity):
    """Issue-node color: STALE wins (red), then effective-blocked (orange), then
    work-state (in-progress green / todo cyan); done/canceled/backlog stay
    uncolored (Obsidian neutral gray)."""
    if _currency.MARK_STALE in note.markers:
        return _CANVAS_COLOR_STALE
    if _work_protocol.effective_state(index, entity)["state"] == _currency.STATE_BLOCKED:
        return _CANVAS_COLOR_BLOCKED
    ws = _currency.work_state(note.cm)
    if ws == _currency.STATE_IN_PROGRESS:
        return _CANVAS_COLOR_IN_PROGRESS
    if ws == _currency.STATE_TODO:
        return _CANVAS_COLOR_TODO
    return None


def _render_work_os_canvas(current_truth: dict, project_status: dict,
                           initiative_status: dict, today_date: date) -> str:
    """Task 10A: compile the work-OS current-truth into an Obsidian JSONCanvas
    map (DERIVED, gitignored, byte-stable). Initiatives frame their member
    projects, projects frame their issues, `blocked-by` relations are edges, and
    node color encodes STALE / effective-blocked / work-state. Layout is a
    deterministic grid (sorted entities + fixed geometry, no random / wall-clock)
    so two runs emit identical bytes. Returns the .canvas JSON text."""
    index = _current_truth_index(current_truth)

    # deterministic geometry
    ISSUE_W, ISSUE_H, ISSUE_GAP = 320, 90, 16
    P_PAD_X, P_PAD_TOP, P_PAD_BOT, P_GAP = 24, 56, 24, 48
    I_PAD, I_HEADER, I_GAP = 40, 60, 96
    PROJECT_W = ISSUE_W + 2 * P_PAD_X

    nodes: list[dict] = []
    edges: list[dict] = []
    node_for_entity: dict[str, str] = {}

    projects = [e for e in sorted(current_truth)
                if current_truth[e].cm.type == _currency.TYPE_PROJECT]

    # bucket projects by their initiative linkage (frontmatter `initiative:`);
    # unaffiliated projects go in a trailing band with no outer frame.
    buckets: dict[str, list] = {}
    for pe in projects:
        init = (current_truth[pe].cm.raw or {}).get("initiative") or ""
        buckets.setdefault(init, []).append(pe)
    ordered = sorted(k for k in buckets if k) + (["" ] if "" in buckets else [])

    n_issue = sum(1 for e in current_truth
                  if any(e.startswith(p + "/") for p in projects))
    nodes.append({
        "id": "title", "type": "text", "x": 0, "y": -160,
        "width": 460, "height": 110, "color": "6",
        "text": (f"# work-OS map (DERIVED)\n\n{len(projects)} projects · "
                 f"{n_issue} issues\n\nCompiled: {today_date.isoformat()}"),
    })

    band_y = 0
    for init in ordered:
        members = sorted(buckets[init])
        proj_x = I_PAD if init else 0
        max_h = 0
        for pe in members:
            prefix = pe + "/"
            children = [e for e in sorted(current_truth) if e.startswith(prefix)]
            p_h = (P_PAD_TOP + max(1, len(children)) * (ISSUE_H + ISSUE_GAP)
                   - ISSUE_GAP + P_PAD_BOT)
            py = band_y + (I_HEADER if init else 0)
            marker = project_status.get(pe, {}).get("marker", _currency.MARK_OK)
            stale_proj = _currency.MARK_STALE in current_truth[pe].markers
            nodes.append({
                "id": f"project-{_canvas_id(pe)}", "type": "group",
                "x": proj_x, "y": py, "width": PROJECT_W, "height": p_h,
                "label": pe + (f"  [{marker}]" if marker and marker != _currency.MARK_OK else ""),
                "color": _CANVAS_COLOR_STALE if stale_proj else "2",
            })
            iy = py + P_PAD_TOP
            for eid in children:
                inode = current_truth[eid]
                color = _canvas_node_color(inode, index, eid)
                node = {
                    "id": f"issue-{_canvas_id(eid)}", "type": "file",
                    "x": proj_x + P_PAD_X, "y": iy,
                    "width": ISSUE_W, "height": ISSUE_H, "file": inode.note_id,
                }
                if color:
                    node["color"] = color
                nodes.append(node)
                node_for_entity[eid] = node["id"]
                iy += ISSUE_H + ISSUE_GAP
            max_h = max(max_h, p_h)
            proj_x += PROJECT_W + P_GAP

        if init:
            health = (initiative_status.get(init) or {}).get("health")
            nodes.append({
                "id": f"init-{_canvas_id(init)}", "type": "group",
                "x": 0, "y": band_y,
                "width": max(proj_x - P_GAP + I_PAD, PROJECT_W + 2 * I_PAD),
                "height": I_HEADER + max_h + I_PAD,
                "label": init + (f"  [{health}]" if health else ""), "color": "4",
            })
            band_y += I_HEADER + max_h + I_PAD + I_GAP
        else:
            band_y += max_h + I_GAP

    for eid in sorted(node_for_entity):
        for target in _blocked_by_targets(current_truth.get(eid)):
            if target in node_for_entity:
                edges.append({
                    "id": f"edge-{_canvas_id(target)}-{_canvas_id(eid)}",
                    "fromNode": node_for_entity[target], "fromSide": "right",
                    "toNode": node_for_entity[eid], "toSide": "left",
                    "label": "blocks", "color": "1",
                })

    return json.dumps({"nodes": nodes, "edges": edges},
                      indent=2, ensure_ascii=False) + "\n"


def cmd_currency(vault: str, topic: str, today_str: str | None = None,
                 apply: bool = False) -> dict:
    """Run the three currency passes and emit derived artifacts.

    Dry-run by default (no writes). --apply writes the derived view + log under
    wiki/ and refreshes the index with STALE/UNSUPPORTED visibility."""
    base = Path(vault) / topic
    wiki = base / "wiki"
    if not wiki.exists():
        return {"error": "wiki/ directory not found"}

    today_date = _parse_iso(today_str) or date.today()
    meta = load_meta(vault, topic)

    notes = _scan_entity_notes(vault, topic)
    current_truth, superseded, warnings = _pass1_supersession(notes)
    _pass2_3_stale_unsupported(vault, topic, current_truth, meta, today_date)

    current_truth_md = _render_current_truth(topic, current_truth, today_date)
    supersession_md = _render_supersession(topic, current_truth, superseded)
    project_status = _pass4_project_status(current_truth, today_date)
    project_status_md = _render_project_status(project_status, today_date)

    # Task 8E: roll the projects up under their initiatives. Built strictly on TOP
    # of project_status (markers reused, not recomputed) -- additive, never alters
    # the _pass4 output above (which must stay byte-stable).
    initiative_status = _pass5_initiative_status(
        current_truth, project_status, today_date)
    initiative_status_md = _render_initiative_status(initiative_status, today_date)

    # Task 8F: group authoritative work items by their cycle: id + completion rate.
    # Built on the already-resolved current_truth heads (drafts quarantined in
    # _pass1) -- additive, never alters the _pass4 / _pass5 output above.
    cycle_status = _pass6_cycle_status(current_truth, today_date)
    cycle_status_md = _render_cycle_status(cycle_status, today_date)

    # Task 10A: compile the SAME resolved structures into a JSONCanvas work-OS
    # map. Derived view like _project-status (Obsidian reads .canvas natively);
    # built on top, never alters the passes above.
    work_os_canvas = _render_work_os_canvas(
        current_truth, project_status, initiative_status, today_date)

    # Task 8D triage: scan 00-Inbox/AI-Output/** for UNCONSUMED candidate
    # captures (status:draft not referenced by any promotes:/rejects:) and
    # classify them Unclassified / Pending Review / Conflicts. Scoped to the
    # vault root (captures live outside the topic), additive, read-only.
    triage_items = _work_protocol.classify_triage(vault, today=today_date.isoformat())
    triage_md = _render_triage(triage_items, today_date)
    triage_out = [
        {"note_id": it.note_id, "entity": it.entity, "section": it.section,
         "state": it.state, "reason": it.reason}
        for it in triage_items
    ]

    # Summaries for machine consumption (returned even in dry-run).
    entities_out = {}
    stale_ids, unsupported_ids = [], []
    for entity in sorted(current_truth):
        n = current_truth[entity]
        verdict = [m for m in n.markers if m != _currency.MARK_OK]
        marker = " + ".join(verdict) if verdict else _currency.MARK_OK
        entities_out[entity] = {
            "note_id": n.note_id,
            "marker": marker,
            "reasons": list(n.reasons),
            "last_verified": n.cm.last_verified,
            "source": n.cm.source,
        }
        if _currency.MARK_STALE in n.markers:
            stale_ids.append(n.note_id)
        if _currency.MARK_UNSUPPORTED in n.markers:
            unsupported_ids.append(n.note_id)

    # Machine-readable report for the Node connector (Task 3): every scanned note
    # keyed by note_id, current-truth notes with their OK/STALE/UNSUPPORTED verdict
    # and superseded notes flagged SUPERSEDED. The connector reads this verbatim.
    by_note: dict = {}
    for entity, info in entities_out.items():
        by_note[info["note_id"]] = {
            "marker": info["marker"],
            "reasons": info["reasons"],
            "entity": entity,
            "currentTruth": True,
        }
    for r in superseded:
        by_note[r["note_id"]] = {
            "marker": _currency.MARK_SUPERSEDED,
            "reasons": [r["reason"]],
            "entity": r["entity"],
            "currentTruth": False,
        }
    report_json = json.dumps(
        {"topic": topic, "compiled": today_date.isoformat(), "byNote": by_note},
        indent=2, ensure_ascii=False,
    )

    written = []
    if apply:
        artifacts = [
            (CURRENT_TRUTH_FILE, current_truth_md),
            (SUPERSESSION_FILE, supersession_md),
            (CURRENCY_REPORT_FILE, report_json),
        ]
        # Task 7B: only emit the project view when there are project entities,
        # so non-project vaults get no extra derived file.
        if project_status:
            artifacts.append((PROJECT_STATUS_FILE, project_status_md))
            # Task 10A: the canvas map ships with the project view (same gate --
            # a vault with no projects gets no map).
            artifacts.append((WORK_OS_CANVAS_FILE, work_os_canvas))
        # Task 8E: only emit the initiative view when there are initiatives,
        # mirroring _project-status -- a vault with no initiatives gets no file.
        if initiative_status:
            artifacts.append((INITIATIVE_STATUS_FILE, initiative_status_md))
        # Task 8F: only emit the cycle view when some work item carries a cycle: id,
        # mirroring _project-status -- a vault with no cycles gets no file.
        if cycle_status:
            artifacts.append((CYCLE_STATUS_FILE, cycle_status_md))
        # Task 8D: only emit the triage view when there are unconsumed captures,
        # mirroring _project-status -- a vault with nothing to triage gets no file.
        if triage_items:
            artifacts.append((TRIAGE_FILE, triage_md))
        for fname, content in artifacts:
            p = wiki / fname
            tmp = p.with_suffix(".tmp")
            try:
                # Write bytes (NOT text mode): the _render_* helpers emit pure LF,
                # and text-mode write_text applies OS newline translation (CRLF on
                # Windows), making the on-disk artifact platform-dependent and
                # defeating the recomputable/byte-stable contract (invariant f).
                # Bytes keep the file byte-identical to the LF-only render.
                tmp.write_bytes(content.encode("utf-8"))
                tmp.replace(p)
            except Exception:
                tmp.unlink(missing_ok=True)
                raise
            written.append(str(p))
        # refresh index additively with STALE/UNSUPPORTED visibility.
        cmd_update_index(vault, topic)

    return {
        "ok": True,
        "topic": topic,
        "today": today_date.isoformat(),
        "apply": apply,
        "entities": entities_out,
        "current_truth": {e: current_truth[e].note_id for e in sorted(current_truth)},
        "superseded": [
            {"entity": r["entity"], "note_id": r["note_id"], "topped_by": r["topped_by"],
             "reason": r["reason"]}
            for r in superseded
        ],
        "stale": sorted(stale_ids),
        "unsupported": sorted(unsupported_ids),
        "warnings": warnings,
        "written": written,
        "by_note": by_note,
        "current_truth_md": current_truth_md,
        "supersession_md": supersession_md,
        "project_status": project_status,
        "project_status_md": project_status_md,
        "work_os_canvas": work_os_canvas,
        "initiative_status": initiative_status,
        "initiative_status_md": initiative_status_md,
        "cycle_status": cycle_status,
        "cycle_status_md": cycle_status_md,
        "triage": triage_out,
        "triage_md": triage_md,
    }


# --- Task 9 / PR 9A: local project registry CLI -----------------------------
#
# `project-scan` is READ-ONLY (one-shot, §0 #11 NO daemon): it walks the
# configured workspace roots, detects projects by marker existence, and reports
# detected / new / registered. It never writes.
#
# `project-adopt` is DRY-RUN by default: --apply writes the machine-local binding
# (the ONLY place the path is recorded) and the SHARED Projects/<slug>.md note
# (logical identity only, NO machine path -- §0 #9).

def cmd_project_scan(vault: str, extra_roots: list[str] | None = None) -> dict:
    """READ-ONLY scan: configured roots (+ optional extra roots) -> detected /
    new / registered. Writes NOTHING."""
    return _workspace.scan_report(vault, extra_roots=extra_roots or [])


def cmd_project_adopt(vault: str, path: str, entity: str,
                      apply: bool = False, today: str | None = None) -> dict:
    """Adopt a local project. DRY-RUN by default; --apply writes the binding +
    the shared project note. Path lives ONLY in the gitignored binding."""
    return _workspace.adopt(vault, path, entity, apply=apply, today=today)


# --- Task 9 / PR 9B: workspace health CLI -----------------------------------
#
# `workspace-status` inspects every bound project (READ-ONLY git probes) and
# compiles the six-section health table. DRY-RUN by default: it returns the
# structured verdict + the rendered markdown but writes NOTHING. --apply writes
# the MACHINE-LOCAL <vault>/.vault-mind/_workspace-status.md (gitignored, so it
# may contain machine paths -- the one human-readable path view §0 #9 allows).

def cmd_workspace_status(vault: str, apply: bool = False,
                         as_of: str | None = None) -> dict:
    """Compile the workspace health table. DRY-RUN by default (writes nothing,
    returns the structured status + rendered md); --apply writes the
    machine-local _workspace-status.md under .vault-mind/. `as_of` (ISO date)
    pins the forgotten/age math for deterministic output."""
    status = _workspace.workspace_status(vault, today=as_of)
    md = _workspace.render_workspace_status(status)
    written = []
    if apply:
        p = _workspace.write_workspace_status(vault, md)
        written.append(str(p))
    return {
        "ok": True,
        "apply": apply,
        "today": status["today"],
        "status": status,
        "workspace_status_md": md,
        "written": written,
    }


# --- Task 9 / PR 9F: reconciliation CLI -------------------------------------
#
# `sync-pull` pulls remote items (issues + GitHub merged-PR evidence) into
# status:draft candidates (conflict-aware); `sync-plan` previews the outward push
# from the REVIEWED current-truth; `sync-apply` executes those pushes (anti-loop
# first, conflicted entities skipped). DRY-RUN is the default for all three; only
# --apply writes / pushes. The token is read from the env inside forge (never a
# CLI arg, never echoed). `transport` / `providers` are INJECTABLE so tests drive
# these with a FakeTransport + FakeProvider and never touch a live API; production
# builds a real UrllibTransport + the default adapter registry.

def _sync_transport(transport):
    """The injected transport, or a real UrllibTransport for the production run.
    Tests pass a FakeTransport; nothing else constructs network access."""
    return transport if transport is not None else _forge.UrllibTransport()


def cmd_sync_pull(vault: str, provider: str | None = None,
                  apply: bool = False, today: str | None = None,
                  transport=None, providers=None) -> dict:
    """Pull bound projects' remote items into draft candidates (conflict-aware).
    DRY-RUN by default; --apply writes them append-only. `provider` (optional)
    restricts the pull to one provider; None pulls every configured provider.
    `transport`/`providers` are injected by tests (FakeTransport/FakeProvider)."""
    t = _sync_transport(transport)
    provs = providers if providers is not None else _forge.default_providers()
    if provider:
        # restrict to the named provider only (an unknown name -> empty map -> a
        # well-formed run that simply pulls nothing for it).
        provs = {provider: provs[provider]} if provider in provs else {}
    return _forge.sync_pull(vault, t, providers=provs, apply=apply, today=today)


def cmd_sync_plan(vault: str, today: str | None = None,
                  transport=None, providers=None) -> dict:
    """Preview the outward push from each project's REVIEWED current-truth (never a
    draft). Performs NO network write. `transport`/`providers` are injected by
    tests."""
    t = _sync_transport(transport)
    provs = providers if providers is not None else _forge.default_providers()
    return _forge.sync_plan(vault, t, providers=provs)


def cmd_sync_apply(vault: str, apply: bool = False, today: str | None = None,
                   transport=None, providers=None) -> dict:
    """Apply the outward projection. DRY-RUN by default (== sync-plan with no
    push); --apply executes each planned push (anti-loop first, conflicted
    entities skipped). `transport`/`providers` are injected by tests."""
    t = _sync_transport(transport)
    provs = providers if providers is not None else _forge.default_providers()
    return _forge.sync_apply(vault, t, providers=provs, apply=apply, today=today)


# --- Task 9: ensure an Obsidian community plugin is installed + enabled ------
#
# `ensure-plugin` makes the vault's kanban board (work_driver.render_kanban_board)
# actually render for users who lack the obsidian-kanban plugin. DRY-RUN by
# default: it returns the plan and writes/downloads NOTHING. --apply performs the
# atomic install (stage -> swap -> enable); --force re-downloads over an existing
# dir. The download is injectable (transport=/downloader=) at the PYTHON API layer
# only, so tests are hermetic; the CLI always uses the real UrllibTransport.

def cmd_ensure_plugin(vault: str, plugin: str = _plugins.DEFAULT_PLUGIN_ID,
                      repo: str = _plugins.DEFAULT_REPO, apply: bool = False,
                      force: bool = False, transport=None, downloader=None,
                      today: str | None = None) -> dict:
    """Ensure a community plugin is installed + enabled. DRY-RUN by default;
    --apply performs the atomic install + enable; --force re-downloads over an
    existing plugin dir. An unsafe plugin id raises UnsafePluginId (a ValueError),
    which main() surfaces as {"error": ...} with a non-zero exit. `transport` /
    `downloader` are injectable at this API layer only (tests pass a fake); the CLI
    always uses the real UrllibTransport."""
    return _plugins.ensure_plugin(
        vault, plugin, repo, apply=apply, force=force,
        transport=transport, downloader=downloader, today=today)


# --- CLI ---
#
# The project-* argv parsers are module-level pure functions (not closures) so the
# branchy flag logic -- --entity consuming the next token, missing positionals /
# missing --entity raising IndexError, --apply/--today stripping -- is directly
# unit-testable without driving sys.argv. `args` is sys.argv[1:] (args[0] is the
# subcommand). Each returns the kwargs for the matching cmd_* call.

def _parse_project_scan_args(args: list[str]) -> dict:
    """Parse 'project-scan <vault> [extra_root ...]' (positionals only, READ-ONLY).
    Returns {vault, extra_roots}. Missing <vault> -> IndexError."""
    pos = [a for a in args[1:] if not a.startswith("--")]
    if not pos:
        raise IndexError("project-scan needs <vault>")
    return {"vault": pos[0], "extra_roots": pos[1:]}


def _parse_project_adopt_args(args: list[str]) -> dict:
    """Parse 'project-adopt <vault> <path> --entity project/<slug> [--apply]
    [--today YYYY-MM-DD]' (dry-run default). Returns {vault, path, entity, apply,
    today}. Missing positionals -> IndexError; missing --entity -> IndexError.
    --entity / --today consume the FOLLOWING token (so a value that itself starts
    with '--', or the flag landing at end-of-args, is handled deterministically)."""
    pos = [a for a in args[1:] if not a.startswith("--")]
    if len(pos) < 2:
        raise IndexError("project-adopt needs <vault> <path> --entity ...")
    entity = None
    apply = False
    today_str = None
    i = 1
    while i < len(args):
        a = args[i]
        if a == "--entity" and i + 1 < len(args):
            entity = args[i + 1]
            i += 2
            continue
        if a == "--today" and i + 1 < len(args):
            today_str = args[i + 1]
            i += 2
            continue
        if a == "--apply":
            apply = True
        i += 1
    if not entity:
        raise IndexError("project-adopt requires --entity project/<slug>")
    return {"vault": pos[0], "path": pos[1], "entity": entity,
            "apply": apply, "today": today_str}


def _parse_workspace_status_args(args: list[str]) -> dict:
    """Parse 'workspace-status <vault> [--apply] [--as-of YYYY-MM-DD]' (dry-run
    default). Returns {vault, apply, as_of}. Missing <vault> -> IndexError.
    --as-of consumes the FOLLOWING token (so a value starting with '--', or the
    flag landing at end-of-args, is handled deterministically)."""
    pos = [a for a in args[1:] if not a.startswith("--")]
    if not pos:
        raise IndexError("workspace-status needs <vault>")
    apply = False
    as_of = None
    i = 1
    while i < len(args):
        a = args[i]
        if a == "--as-of" and i + 1 < len(args):
            as_of = args[i + 1]
            i += 2
            continue
        if a == "--apply":
            apply = True
        i += 1
    return {"vault": pos[0], "apply": apply, "as_of": as_of}


def _parse_sync_pull_args(args: list[str]) -> dict:
    """Parse 'sync-pull <vault> [--provider X] [--apply] [--today YYYY-MM-DD]'
    (dry-run default). Returns {vault, provider, apply, today}. Missing <vault> ->
    IndexError. --provider/--today consume the FOLLOWING token."""
    pos = [a for a in args[1:] if not a.startswith("--")]
    if not pos:
        raise IndexError("sync-pull needs <vault>")
    provider = None
    apply = False
    today_str = None
    i = 1
    while i < len(args):
        a = args[i]
        if a == "--provider" and i + 1 < len(args):
            provider = args[i + 1]
            i += 2
            continue
        if a == "--today" and i + 1 < len(args):
            today_str = args[i + 1]
            i += 2
            continue
        if a == "--apply":
            apply = True
        i += 1
    return {"vault": pos[0], "provider": provider, "apply": apply,
            "today": today_str}


def _parse_sync_plan_args(args: list[str]) -> dict:
    """Parse 'sync-plan <vault> [--today YYYY-MM-DD]' (no network write). Returns
    {vault, today}. Missing <vault> -> IndexError; --today consumes the next token."""
    pos = [a for a in args[1:] if not a.startswith("--")]
    if not pos:
        raise IndexError("sync-plan needs <vault>")
    today_str = None
    i = 1
    while i < len(args):
        if args[i] == "--today" and i + 1 < len(args):
            today_str = args[i + 1]
            i += 2
            continue
        i += 1
    return {"vault": pos[0], "today": today_str}


def _parse_sync_apply_args(args: list[str]) -> dict:
    """Parse 'sync-apply <vault> [--apply] [--today YYYY-MM-DD]' (dry-run default).
    Returns {vault, apply, today}. Missing <vault> -> IndexError; --today consumes
    the following token."""
    pos = [a for a in args[1:] if not a.startswith("--")]
    if not pos:
        raise IndexError("sync-apply needs <vault>")
    apply = False
    today_str = None
    i = 1
    while i < len(args):
        a = args[i]
        if a == "--today" and i + 1 < len(args):
            today_str = args[i + 1]
            i += 2
            continue
        if a == "--apply":
            apply = True
        i += 1
    return {"vault": pos[0], "apply": apply, "today": today_str}


def _parse_ensure_plugin_args(args: list[str]) -> dict:
    """Parse 'ensure-plugin <vault> [--plugin <id>] [--repo owner/name] [--apply]
    [--force]' (dry-run default). Returns {vault, plugin, repo, apply, force}.
    Missing <vault> -> IndexError. --plugin / --repo consume the FOLLOWING token
    (mirrors the --entity/--today consume-next pattern, so a value beginning with
    '--' or a flag at end-of-args is handled deterministically). An absent flag
    keeps its default (obsidian-kanban / mgmeyers/obsidian-kanban)."""
    pos = [a for a in args[1:] if not a.startswith("--")]
    if not pos:
        raise IndexError("ensure-plugin needs <vault>")
    plugin = _plugins.DEFAULT_PLUGIN_ID
    repo = _plugins.DEFAULT_REPO
    apply = False
    force = False
    i = 1
    while i < len(args):
        a = args[i]
        if a == "--plugin" and i + 1 < len(args):
            plugin = args[i + 1]
            i += 2
            continue
        if a == "--repo" and i + 1 < len(args):
            repo = args[i + 1]
            i += 2
            continue
        if a == "--apply":
            apply = True
        elif a == "--force":
            force = True
        i += 1
    return {"vault": pos[0], "plugin": plugin, "repo": repo, "apply": apply,
            "force": force}


def cmd_work_next(vault, *, claim_agent=None, ttl_seconds=3600, now=None,
                  projected_cost=0):
    """Task 11A-iii heartbeat: select the next executable item from the
    AUTHORITATIVE work index and optionally lease it. One-shot, no daemon
    (§0 #4): a cron / ScheduleWakeup tick invokes this once and exits.

    Returns {"selected": {...} | None, "budget": {...}, ["lease": {...}]}.
    Selection reuses work_driver.select_next over the authoritative work notes;
    the lease is the base-head-locked claim. The 11B budget gate runs *before*
    the claim (the lease is the spawn authorization): an exhausted pool stops the
    heartbeat with no lease and no spawn, so the ledger reaches the cap but never
    crosses it. `projected_cost` is the caller's estimate of the next run's spend
    -- the gate refuses a run that would push the pool past the cap.
    NOTE: multi-note-per-entity head resolution is a forthcoming refinement --
    distinct-entity work items select cleanly today.
    """
    import time
    import currency
    import work_protocol
    import work_driver
    import work_budget

    notes = work_protocol._walk_work_notes(vault, require_entity=True)
    authoritative = [n for n in notes if n.is_authoritative]
    actionable = [n for n in authoritative
                  if work_driver.is_actionable(n, authoritative)]
    pick = work_driver.select_next(authoritative)
    if pick is None:
        # idle: nothing actionable -> a self-pacing trigger stops re-arming here.
        return {"selected": None, "status": "idle", "remaining": 0}
    result = {
        "selected": {
            "note_id": pick.note_id,
            "entity": pick.entity,
            "state": currency.work_state(pick.cm),
        },
        # `remaining` = open actionable items (incl. this one). A demand-driven
        # ScheduleWakeup loop re-arms only while status == "selected" and stops on
        # "idle" / "budget_exhausted" -- no fixed cadence, no daemon (§0 #4).
        "remaining": len(actionable),
    }
    cap, spent = work_budget.resolve_pool(pick, authoritative)
    b = work_budget.check(cap, spent, projected=projected_cost)
    result["budget"] = {
        "outcome": b.outcome, "cap": b.cap, "spent": b.spent,
        "projected": b.projected, "remaining": b.remaining,
    }
    if b.outcome == work_budget.OUTCOME_EXHAUSTED:
        result["status"] = "budget_exhausted"
        return result  # hard stop before spawn -- never overspend (green bar 3)
    if claim_agent:
        if now is None:
            now = int(time.time())
        r = work_driver.acquire_lease(
            vault, pick.note_id, claim_agent,
            current_head=pick.note_id, base_head=pick.note_id,
            ttl_seconds=ttl_seconds, now=now,
        )
        result["lease"] = {"outcome": r.outcome, "agent_id": claim_agent}
    result["status"] = "selected"
    return result


def cmd_work_board(vault, *, project=None, write=False, lang=None):
    """Render the work-OS authoritative notes into an Obsidian Kanban board (a
    derived view -- the source stays the issue notes). With --write, the board is
    written next to the project (regenerable, never a source). This is the
    unification: the scheduling brain (work_protocol) now also speaks kanban, so
    the separate docket store is unnecessary. `lang` localizes the lane headings;
    when unset it honors $VAULT_MIND_LANG then auto-detects from the vault."""
    from pathlib import Path
    import os
    import work_protocol
    import work_driver

    notes = work_protocol._walk_work_notes(vault, require_entity=True)
    authoritative = [n for n in notes if n.is_authoritative]
    if lang is None:
        lang = os.environ.get("VAULT_MIND_LANG") or work_driver.detect_vault_lang(notes)
    board = work_driver.render_kanban_board(authoritative, project=project, lang=lang)
    result = {"project": project, "lang": lang, "board": board}
    if write and project:
        anchor = next((n for n in notes if n.entity == f"project/{project}"), None) \
            or next((n for n in authoritative
                     if (n.entity or "").startswith(f"project/{project}/")), None)
        if anchor:
            out = Path(vault) / Path(anchor.note_id).parent / "board.md"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(board.encode("utf-8"))
            result["written"] = str(out.relative_to(Path(vault))).replace("\\", "/")
    return result


def cmd_work_budget(vault, *, project=None):
    """Report budget pools (cap / spent / remaining / status) -- a read-only view
    of the markdown ledger, so the quota stays auditable (§7, no side-channel).
    A pool is a project container note that declares a `budget`; with --project
    only that pool is reported, otherwise every declared pool."""
    import work_protocol
    import work_budget

    notes = work_protocol._walk_work_notes(vault, require_entity=True)
    pools = []
    for n in notes:
        if (n.raw or {}).get("type") != "project":
            continue
        slug = work_budget.pool_slug(n.entity)
        if project and slug != project:
            continue
        cap, spent = work_budget.read_budget(n)
        if cap is None:
            continue
        b = work_budget.check(cap, spent)
        pools.append({
            "project": slug, "entity": n.entity, "cap": cap, "spent": spent,
            "remaining": b.remaining, "outcome": b.outcome,
        })
    pools.sort(key=lambda p: p["entity"])
    return {"project": project, "pools": pools}


def cmd_work_debit(vault, *, project, cost, apply=False):
    """Write a run's token `cost` back into a project pool's ledger -- the
    after-run half of the 11B budget loop (the `work next` gate is the
    before-spawn half). Dry-run by default; --apply bumps `budget-spent` in the
    project container note (markdown truth, git-gated -- the change is a one-line
    ledger diff). One-shot (§0 #4): the loop calls this once after a run, exits.
    """
    from pathlib import Path
    import work_protocol
    import work_budget

    notes = work_protocol._walk_work_notes(vault, require_entity=True)
    anchor = next((n for n in notes if n.entity == f"project/{project}"
                   and (n.raw or {}).get("type") == "project"), None)
    if anchor is None:
        return {"error": f"no project container for '{project}'"}
    cap, spent = work_budget.read_budget(anchor)
    p = Path(vault) / anchor.note_id
    try:
        new_text = work_budget.record_spend(p.read_text(encoding="utf-8"), cost)
    except (ValueError, OSError) as e:
        return {"error": str(e)}
    result = {"project": project, "note_id": anchor.note_id, "cap": cap,
              "spent_before": spent, "spent_after": spent + cost, "cost": cost,
              "apply": apply}
    if apply:
        p.write_bytes(new_text.encode("utf-8"))
        result["written"] = anchor.note_id
    return result


def cmd_work_briefing(vault, *, note=None, entity=None):
    """Task 11G bootstrap briefing: compile the read-only current-truth slice
    around a work item (state, unresolved blockers, open siblings, required
    reading) so a waking agent has team context without a cold start. Read-only
    (§0 -- a derived view, never edits the source). One-shot; the loop injects it
    once at bootstrap. Select the item by --note <id> or --entity <e>."""
    import work_protocol
    import work_driver

    notes = work_protocol._walk_work_notes(vault, require_entity=True)
    auth = [n for n in notes if n.is_authoritative]
    target = None
    if note:
        target = next((n for n in auth if n.note_id == note), None)
    elif entity:
        target = next((n for n in auth if n.entity == entity), None)
    if target is None:
        return {"error": "work item not found (note/entity not in authoritative index)"}
    return {"entity": target.entity, "note_id": target.note_id,
            "briefing": work_driver.render_briefing(auth, target.entity)}


def cmd_promote(vault, *, note=None, entity=None, promoted_by=None,
                today=None, apply=False):
    """Task 10C-A: promote a draft candidate into a materialized reviewed snapshot
    -- the single CLI entry over work_protocol.promote (base-head optimistic lock
    + complete-snapshot materialize). Dry-run by default: returns the planned
    snapshot (the `plan`) and writes nothing; --apply appends the reviewed note
    (append-only, never edits the head or the candidate). HEAD_MISMATCH is
    reported, never a silent last-write-wins. This is the action an Obsidian
    promote gesture (10C-C) shells out to, and the real promote step the Task 11
    loop needs."""
    import work_protocol

    notes = work_protocol.scan_work_notes(vault)
    cand = None
    if note:
        cand = next((n for n in notes if n.note_id == note), None)
    elif entity:
        cand = next((n for n in notes if n.entity == entity and n.is_candidate), None)
    if cand is None:
        return {"error": "candidate not found (give --note <id> or --entity <e>)"}

    r = work_protocol.promote(vault, cand, apply=apply,
                              promoted_by=promoted_by, today=today)
    out = {
        "outcome": r.outcome, "entity": r.entity, "head_note_id": r.head_note_id,
        "snapshot_note_id": getattr(r, "snapshot_note_id", None),
        "reason": r.reason, "apply": apply,
    }
    plan = getattr(r, "snapshot_text", None)
    if plan:
        out["plan"] = plan          # the dry-run promote plan (materialized snapshot)
    if getattr(r, "written", None):
        out["written"] = r.written
    return out


def main():
    args = sys.argv[1:]
    if len(args) < 1:
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    cmd = args[0]

    def _currency_cli():
        # positional: <vault> <topic>; flags: --today YYYY-MM-DD, --apply
        pos = [a for a in args[1:] if not a.startswith("--")]
        today_str = None
        apply = False
        i = 1
        while i < len(args):
            if args[i] == "--today" and i + 1 < len(args):
                today_str = args[i + 1]
                i += 2
                continue
            if args[i] == "--apply":
                apply = True
            i += 1
        return cmd_currency(pos[0], pos[1], today_str=today_str, apply=apply)

    def _project_scan_cli():
        p = _parse_project_scan_args(args)
        return cmd_project_scan(p["vault"], extra_roots=p["extra_roots"])

    def _project_adopt_cli():
        p = _parse_project_adopt_args(args)
        return cmd_project_adopt(p["vault"], p["path"], p["entity"],
                                 apply=p["apply"], today=p["today"])

    def _workspace_status_cli():
        p = _parse_workspace_status_args(args)
        return cmd_workspace_status(p["vault"], apply=p["apply"],
                                    as_of=p["as_of"])

    def _sync_pull_cli():
        p = _parse_sync_pull_args(args)
        return cmd_sync_pull(p["vault"], provider=p["provider"],
                             apply=p["apply"], today=p["today"])

    def _sync_plan_cli():
        p = _parse_sync_plan_args(args)
        return cmd_sync_plan(p["vault"], today=p["today"])

    def _sync_apply_cli():
        p = _parse_sync_apply_args(args)
        return cmd_sync_apply(p["vault"], apply=p["apply"], today=p["today"])

    def _ensure_plugin_cli():
        p = _parse_ensure_plugin_args(args)
        # the CLI always uses the real UrllibTransport (download is injectable only
        # at the Python API layer, for hermetic tests).
        return cmd_ensure_plugin(p["vault"], plugin=p["plugin"], repo=p["repo"],
                                 apply=p["apply"], force=p["force"])

    def _work_cli():
        # `work next   <vault> [--claim <agent>] [--ttl <sec>] [--projected <n>]`
        # `work board  <vault> [--project <slug>] [--write] [--lang <code>]`
        # `work budget   <vault> [--project <slug>]`
        # `work debit    <vault> --project <slug> --cost <n> [--apply]`
        # `work briefing <vault> [--note <id>] [--entity <e>]`
        sub = args[1] if len(args) > 1 else None
        pos = [a for a in args[2:] if not a.startswith("--")]

        def _opt(name):
            if name in args:
                idx = args.index(name)
                if idx + 1 < len(args):
                    return args[idx + 1]
            return None

        if sub == "next":
            return cmd_work_next(pos[0], claim_agent=_opt("--claim"),
                                 ttl_seconds=int(_opt("--ttl") or 3600),
                                 projected_cost=int(_opt("--projected") or 0))
        if sub == "board":
            return cmd_work_board(pos[0], project=_opt("--project"),
                                  write=("--write" in args), lang=_opt("--lang"))
        if sub == "budget":
            return cmd_work_budget(pos[0], project=_opt("--project"))
        if sub == "debit":
            return cmd_work_debit(pos[0], project=_opt("--project"),
                                  cost=int(_opt("--cost") or 0),
                                  apply=("--apply" in args))
        if sub == "briefing":
            return cmd_work_briefing(pos[0], note=_opt("--note"),
                                     entity=_opt("--entity"))
        raise IndexError  # unknown work subcommand

    def _promote_cli():
        # `promote <vault> (--note <id> | --entity <e>) [--apply] [--by <who>] [--today <iso>]`
        def _o(name):
            if name in args:
                i = args.index(name)
                if i + 1 < len(args):
                    return args[i + 1]
            return None
        pos = [a for a in args[1:] if not a.startswith("--")]
        return cmd_promote(pos[0], note=_o("--note"), entity=_o("--entity"),
                           promoted_by=_o("--by"), today=_o("--today"),
                           apply=("--apply" in args))

    dispatch = {
        "init": lambda: cmd_init(args[1], args[2]),
        "diff": lambda: cmd_diff(args[1], args[2]),
        "update-hash": lambda: cmd_update_hash(args[1], args[2], args[3]),
        "update-index": lambda: cmd_update_index(args[1], args[2]),
        "check-links": lambda: cmd_check_links(args[1], args[2]),
        "vitality": lambda: cmd_vitality(args[1], args[2]),
        "log-access": lambda: cmd_log_access(args[1], args[2], args[3]),
        "currency": _currency_cli,
        "project-scan": _project_scan_cli,
        "project-adopt": _project_adopt_cli,
        "workspace-status": _workspace_status_cli,
        "sync-pull": _sync_pull_cli,
        "sync-plan": _sync_plan_cli,
        "sync-apply": _sync_apply_cli,
        "ensure-plugin": _ensure_plugin_cli,
        "work": _work_cli,
        "promote": _promote_cli,
    }

    if cmd not in dispatch:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    try:
        result = dispatch[cmd]()
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except IndexError:
        print(f"Missing arguments for '{cmd}'. See usage.", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
