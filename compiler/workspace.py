"""Task 9 / PR 9A: the LOCAL PROJECT REGISTRY (zero-dependency, stdlib only).

> vault-mind recognises the LOCAL machine first. A project's LOGICAL identity
> (`entity: project/<slug>`) lives in the shared, committed `Projects/<slug>.md`
> note; the MACHINE PATH lives ONLY in the gitignored
> `<vault>/.vault-mind/local-bindings.json`. A machine path is NEVER written into
> any shared markdown note (Task 9 §0 #9).

This solves the user's #1 gap: projects scattered locally, forgotten, never
uploaded -- they must be manageable even with NO git, NO remote, NO board. A
project with none of those still gets detected and can be adopted.

Design invariants (locked, do NOT deviate):
  * zero-dep stdlib only -- NO PyYAML. Config + bindings are JSON.
  * `<vault>/.vault-mind/` is entirely gitignored (workspace roots AND bindings
    are machine-specific paths).
  * dry-run is the DEFAULT for any write (adopt writes nothing unless apply=True).
  * scan is READ-ONLY and one-shot (§0 #11 NO daemon): it walks dirs and reads
    marker EXISTENCE only; it never writes during a scan.
  * any file written is LF-only bytes (mirrors kb_meta.save_meta).

NO DB, NO embeddings, NO network, NO LLM. Markdown + JSON are the only state.
"""

from __future__ import annotations

import json
import os
import re
import subprocess

# currency.py is the Task 8A state contract (TYPE_PROJECT etc.) + frontmatter
# normalizer; _md_parse is the robust frontmatter parser kb_meta also uses.
# Import works whether this module is imported from compiler/ or run as a script.
import sys as _sys
from pathlib import Path
from typing import Optional

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in _sys.path:
    _sys.path.insert(0, str(_HERE))

import currency as _currency  # noqa: E402

# --- project markers --------------------------------------------------------
# A directory is a PROJECT if it DIRECTLY contains any of these markers. '*.sln'
# is a glob (any .sln file); the rest are exact basenames. A project with NO
# .git / NO remote / NO board is still detected (the whole point of 9A).
PROJECT_MARKERS = [
    ".git",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "*.sln",
    "CMakeLists.txt",
]

# Noise dirs never descended into when scanning roots (vendored/derived/VCS
# internals). A detected project's OWN subdirs are also never descended into.
SKIP_DIRS = frozenset({
    "node_modules", ".git", ".venv", "__pycache__", "dist", "build",
    "target", "vendor", ".obsidian",
})

# The machine-local config dir under each vault -- entirely gitignored.
VAULT_MIND_DIR = ".vault-mind"
BINDINGS_FILE = "local-bindings.json"
WORKSPACE_CONFIG_FILE = "workspace.json"

# Shared, committed project notes live here (logical identity only, NO path).
PROJECTS_DIR = "Projects"

# Default bounded scan depth: a root, plus up to this many nested levels.
DEFAULT_MAX_DEPTH = 3


# --- slug (match the existing compile/_slugify style) ----------------------

def slugify(name: str) -> str:
    """Slugify a directory basename: lowercase, non-alnum -> '-', collapse runs,
    trim. Mirrors compile._slugify / wikilink_converter.slugify so a project's
    slug is stable across the codebase. Capped at 80 chars."""
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-{2,}", "-", slug)
    return slug.strip("-")[:80]


# --- scanning (READ-ONLY, one-shot) ----------------------------------------

def _dir_markers(dirpath: Path) -> list[str]:
    """Return the markers a directory DIRECTLY contains (sorted, deterministic).
    Reads marker EXISTENCE only -- never opens/parses file contents. '*.sln' is
    matched as a glob; the rest are exact basenames."""
    found: list[str] = []
    try:
        names = set(os.listdir(dirpath))
    except OSError:
        return found
    for marker in PROJECT_MARKERS:
        if marker == "*.sln":
            if any(n.lower().endswith(".sln") for n in names):
                found.append(marker)
        elif marker in names:
            found.append(marker)
    return found


def _has_git_remote(dirpath: Path) -> bool:
    """True iff the directory's .git/config declares any [remote ...] section.

    READ-ONLY: reads the git config text (no git subprocess, §0 #11 no daemon /
    no shelling out). A bare/missing config -> no remote. Detection of has_git is
    separate (the .git marker); this only answers "does it have a remote"."""
    cfg = dirpath / ".git" / "config"
    if not cfg.exists():
        return False
    try:
        text = cfg.read_text("utf-8-sig", errors="replace")
    except OSError:
        return False
    return re.search(r'(?m)^\s*\[\s*remote\b', text) is not None


def scan_roots(roots, max_depth: int = DEFAULT_MAX_DEPTH) -> list[dict]:
    """Walk each root to a bounded depth and detect projects. READ-ONLY.

    A directory is a PROJECT when it DIRECTLY contains any PROJECT_MARKER. We do
    NOT descend INTO a detected project (its subdirs are not separate projects),
    and we skip the SKIP_DIRS noise everywhere. A project with no .git / no
    remote / no board is still detected.

    Returns a list of dicts (sorted by path) -- one per detected project:
        {path: <abs POSIX>, slug, markers: [...], has_git: bool, has_remote: bool}

    `roots` is an iterable of directory paths (str/Path). Missing roots are
    skipped silently. `max_depth` bounds how deep below each root we walk: 0 =
    the root dir itself only, 1 = root + immediate children, etc."""
    detected: dict[str, dict] = {}  # keyed by abs-posix path -> dedupe overlapping roots

    for root in roots:
        root_path = Path(root)
        try:
            root_path = root_path.resolve()
        except OSError:
            continue
        if not root_path.is_dir():
            continue
        _scan_one_root(root_path, max_depth, detected)

    return [detected[k] for k in sorted(detected)]


def _scan_one_root(root_path: Path, max_depth: int, detected: dict) -> None:
    """Bounded DFS from one root. Mutates `detected` (abs-posix -> record).
    Stops descending into a detected project and into SKIP_DIRS."""
    # stack of (dir, depth). depth 0 = the root itself.
    stack: list[tuple[Path, int]] = [(root_path, 0)]
    while stack:
        cur, depth = stack.pop()
        markers = _dir_markers(cur)
        if markers:
            key = cur.as_posix()
            if key not in detected:
                detected[key] = {
                    "path": key,
                    "slug": slugify(cur.name),
                    "markers": markers,
                    "has_git": ".git" in markers,
                    "has_remote": _has_git_remote(cur) if ".git" in markers else False,
                }
            # do NOT descend into a detected project (its subdirs are not
            # separate projects).
            continue
        if depth >= max_depth:
            continue
        try:
            children = sorted(
                c for c in cur.iterdir()
                # `is_dir()` follows symlinks; a dir-symlink could point OUT of
                # the root, pulling an unrelated tree into the registry (path
                # traversal). Skip symlinks so scan stays bounded within the root
                # (and a self-referential loop can't recurse).
                if c.is_dir() and not c.is_symlink() and c.name not in SKIP_DIRS
            )
        except OSError:
            continue
        # push in reverse so the sorted order is preserved on the LIFO stack.
        for child in reversed(children):
            stack.append((child, depth + 1))


# --- machine-local registry (gitignored JSON) ------------------------------

def _vault_mind_dir(vault) -> Path:
    return Path(vault) / VAULT_MIND_DIR


def bindings_path(vault) -> Path:
    return _vault_mind_dir(vault) / BINDINGS_FILE


def workspace_config_path(vault) -> Path:
    return _vault_mind_dir(vault) / WORKSPACE_CONFIG_FILE


def load_bindings(vault) -> dict:
    """Load `<vault>/.vault-mind/local-bindings.json`. Shape:
        { "project/<slug>": { "path": "<abs posix>" }, ... }
    Missing / unreadable / malformed -> {} (the registry is rebuildable by
    re-adopting; a corrupt file must not crash the read)."""
    p = bindings_path(vault)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text("utf-8-sig"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save_bindings(vault, mapping: dict) -> Path:
    """Write the bindings map to `<vault>/.vault-mind/local-bindings.json` as
    LF-only bytes (mirrors kb_meta.save_meta). Keys are sorted for a byte-stable,
    diff-minimal, idempotent file. Returns the path written."""
    p = bindings_path(vault)
    p.parent.mkdir(parents=True, exist_ok=True)
    ordered = {k: mapping[k] for k in sorted(mapping)}
    tmp = p.with_suffix(p.suffix + ".tmp")
    try:
        # Write bytes (NOT text mode): json.dumps emits LF, but a text-mode write
        # translates to CRLF on Windows -> platform-dependent on-disk state.
        # Bytes keep it LF-only, byte-stable across OSes (mirrors save_meta).
        tmp.write_bytes(
            json.dumps(ordered, indent=2, ensure_ascii=False).encode("utf-8")
        )
        tmp.replace(p)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    return p


def load_roots(vault) -> list[str]:
    """Read the configured workspace roots from
    `<vault>/.vault-mind/workspace.json` -> { "workspace-roots": [...] }.
    Missing / unreadable / malformed -> []. (Roots are machine-specific paths,
    so the whole .vault-mind/ dir is gitignored.)"""
    p = workspace_config_path(vault)
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text("utf-8-sig"))
    except (OSError, ValueError):
        return []
    roots = data.get("workspace-roots") if isinstance(data, dict) else None
    if not isinstance(roots, list):
        return []
    return [str(r) for r in roots if isinstance(r, str) and r.strip()]


# --- registered vs new ------------------------------------------------------

def _normpath(p: str) -> str:
    """Normalize a path to abs-posix for stable comparison across separators."""
    try:
        return Path(p).resolve().as_posix()
    except OSError:
        return Path(p).as_posix()


def registered(detected: list[dict], bindings: dict) -> dict:
    """Split detected projects into already-registered vs new, by PATH match.

    A detected project is "registered" when some binding's `path` resolves to the
    same abs-posix path. Returns
        {"registered": [...detected...], "new": [...detected...]}
    preserving the input order within each bucket."""
    bound_paths = {
        _normpath(v["path"]) for v in bindings.values()
        if isinstance(v, dict) and isinstance(v.get("path"), str)
    }
    reg, new = [], []
    for d in detected:
        if _normpath(d["path"]) in bound_paths:
            reg.append(d)
        else:
            new.append(d)
    return {"registered": reg, "new": new}


# --- adopt (dry-run default) -----------------------------------------------

def _project_note_path(vault, slug: str) -> Path:
    return Path(vault) / PROJECTS_DIR / f"{slug}.md"


def _render_project_note(slug: str, entity: str, today: str, body: str = "") -> str:
    """Render the SHARED, committed project note for an adopted project.

    Carries ONLY the logical identity + currency stamping -- entity, type, status,
    last-verified -- exactly like a 7C-stamped project note (and the fixture
    Projects notes). It contains NO machine path: the path lives only in the
    gitignored local-bindings.json (§0 #9). `status: active` makes it a live,
    non-terminal project so it flows into project-currency as a project entity.
    LF-only; deterministic field order for a byte-stable, idempotent file."""
    lines = [
        "---",
        f"{_currency.F_ENTITY}: {entity}",
        f"{_currency.F_TYPE}: {_currency.TYPE_PROJECT}",
        f"{_currency.F_STATUS}: active",
        f"{_currency.F_LAST_VERIFIED}: {today}",
        "---",
    ]
    text = "\n".join(lines) + "\n"
    body = (body or "").replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    if body:
        text += "\n" + body + "\n"
    return text


def _existing_note_body(path: Path) -> str:
    """Return the body (after the leading frontmatter) of an existing note, so a
    re-adopt preserves any human-authored prose. No frontmatter -> whole text."""
    try:
        text = path.read_text("utf-8-sig", errors="replace")
    except OSError:
        return ""
    m = re.match(r"\A---\r?\n.*?\r?\n---\r?\n", text, re.DOTALL)
    return text[m.end():] if m else text


def adopt(vault, path, entity: str, apply: bool = False,
          today: Optional[str] = None) -> dict:
    """Adopt a local project into the registry. DRY-RUN by default.

    On apply (apply=True) this does TWO writes:
      1. the machine-local binding entity -> {"path": <abs posix>} into
         `<vault>/.vault-mind/local-bindings.json` (the path lives ONLY here);
      2. the SHARED note `Projects/<slug>.md` with frontmatter
         entity / type:project / status:active / last-verified, stamped like 7C
         with NO machine path in it.

    Idempotent: re-adopting the same project writes a byte-identical note and
    binding (the body of a pre-existing note is preserved). apply=False writes
    NOTHING and returns the plan only.

    Re-pointing an EXISTING entity to a DIFFERENT path is intentional (the entity
    is the logical id; this is how a project moves), so the new path wins and the
    prior binding is replaced -- but never silently: the plan's `warnings` lists
    the discarded->new rebind. Re-adopting the same path warns nothing.

    `entity` is the logical identity `project/<slug>`; the slug for the note
    filename is derived from the entity leaf (so the shared note name matches the
    logical id, independent of the machine dir basename). `today` pins the
    last-verified stamp (ISO date) for deterministic, byte-assertable notes;
    defaults to date.today() when None.

    Returns a plan dict: {entity, slug, path (abs posix), binding, note_path,
    note_text, apply, warnings: [...], written: [...]}.
    """
    from datetime import date as _date

    abs_path = _normpath(str(path))
    entity = entity.strip()
    # slug from the entity leaf -> the shared note's name matches the logical id.
    leaf = entity.rstrip("/").split("/")[-1] or slugify(Path(abs_path).name)
    slug = slugify(leaf)
    today = today or _date.today().isoformat()

    note_path = _project_note_path(vault, slug)
    body = _existing_note_body(note_path) if note_path.exists() else ""
    note_text = _render_project_note(slug, entity, today, body)

    binding = {"path": abs_path}

    # A re-adopt that re-points an existing entity to a DIFFERENT path is
    # intentional (the entity IS the logical id, so re-pointing is how you move a
    # project), but it must NOT be silent: surface it as a warning so the caller
    # sees the prior path is being discarded. Re-adopting the SAME path is a pure
    # idempotent no-op and warns nothing.
    warnings: list[str] = []
    existing = load_bindings(vault).get(entity)
    if isinstance(existing, dict) and isinstance(existing.get("path"), str):
        old_path = _normpath(existing["path"])
        if old_path != abs_path:
            warnings.append(
                f"rebinding {entity}: {old_path} -> {abs_path} "
                "(previous binding discarded)"
            )

    plan = {
        "entity": entity,
        "slug": slug,
        "path": abs_path,
        "binding": {entity: binding},
        "note_path": note_path.as_posix(),
        "note_text": note_text,
        "apply": apply,
        "warnings": warnings,
        "written": [],
    }

    if not apply:
        return plan

    # (1) machine-local binding -- the ONLY place the path is recorded. Re-pointing
    # an entity to a new path intentionally replaces the prior binding (warned
    # above); re-adopting the same path is byte-identical (idempotent).
    bindings = load_bindings(vault)
    bindings[entity] = binding
    bpath = save_bindings(vault, bindings)
    plan["written"].append(bpath.as_posix())

    # (2) shared, committed project note -- logical identity only, NO path.
    note_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = note_path.with_suffix(note_path.suffix + ".tmp")
    try:
        # Write bytes (NOT text mode): note_text is pure LF; text-mode write
        # applies OS newline translation (CRLF on Windows), defeating the
        # byte-stable / idempotent contract. Bytes keep it byte-identical.
        tmp.write_bytes(note_text.encode("utf-8"))
        tmp.replace(note_path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    plan["written"].append(note_path.as_posix())

    return plan


# --- top-level scan report (READ-ONLY) -------------------------------------

def scan_report(vault, extra_roots=None, max_depth: int = DEFAULT_MAX_DEPTH) -> dict:
    """Full READ-ONLY scan report for a vault. Reads roots from the machine-local
    config (load_roots) plus any `extra_roots` (for testing / ad-hoc roots),
    scans them, and splits the detected projects into registered vs new against
    the current bindings. Writes NOTHING.

    Returns {detected: [...], new: [...], registered: [...], roots: [...]}.
    """
    roots = list(load_roots(vault))
    if extra_roots:
        roots += [str(r) for r in extra_roots]
    detected = scan_roots(roots, max_depth=max_depth)
    split = registered(detected, load_bindings(vault))
    return {
        "detected": detected,
        "new": split["new"],
        "registered": split["registered"],
        "roots": roots,
    }


# === Task 9 / PR 9B: WORKSPACE HEALTH ======================================
#
# The 9A registry answers "what's on this machine". 9B turns that into the
# user's #1 deliverable: a single "what's unpushed, what's forgotten, what's
# gone" table -- `_workspace-status.md`.
#
# Every git probe below is READ-ONLY (status / remote / rev-list / log /
# rev-parse), each invoked as `git -C <path> ...` with a short timeout, and each
# tolerates a non-repo / missing path / git error / timeout by returning a SAFE
# DEFAULT -- it NEVER raises out and NEVER mutates a repo (§0 hard constraints,
# §0 #11 no daemon). We shell to the system `git` because that is the only
# zero-dep way to read upstream/ahead-behind state (no third-party git lib).
#
# The report is MACHINE-LOCAL: it is written to <vault>/.vault-mind/
# _workspace-status.md, which is gitignored (the whole .vault-mind/ dir is), so
# it is the ONE human-readable view where machine paths are allowed -- it is
# never committed, so §0 #9 (no paths in shared notes) is not violated.

GIT_TIMEOUT_S = 5

# Repo-health primary labels, worst-first. repo_health() returns the FIRST that
# applies; the raw flags it also returns let the report place a project in
# MULTIPLE §2 buckets (a dirty+unpushed repo shows in both).
HEALTH_MISSING = "missing"
HEALTH_NO_GIT = "no-git"
HEALTH_DIVERGED = "diverged"
HEALTH_UNPUSHED = "unpushed"
HEALTH_DIRTY = "dirty"
HEALTH_LOCAL_ONLY = "local-only"
HEALTH_CLEAN = "clean"

# The machine-local derived report (gitignored under .vault-mind/).
WORKSPACE_STATUS_FILE = "_workspace-status.md"


def _git(path, *args) -> Optional[str]:
    """Run `git -C <path> <args...>` READ-ONLY and return stripped stdout, or
    None on ANY failure (non-repo, missing git, non-zero exit, timeout, OS
    error). Never raises out; never mutates. Used only for status/remote/
    rev-list/log/rev-parse -- all read-only porcelain/plumbing."""
    try:
        proc = subprocess.run(
            ["git", "-C", str(path), *args],
            capture_output=True, text=True,
            timeout=GIT_TIMEOUT_S,
            # No shell; env inherited. We never pass user-controlled flags as the
            # first token, so there is no option-injection surface here.
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    return proc.stdout.strip()


def is_git_repo(path) -> bool:
    """True iff `path` is inside a git work tree. READ-ONLY (`rev-parse
    --is-inside-work-tree`). Missing path / non-repo / git error -> False."""
    p = Path(path)
    try:
        if not p.exists():
            return False
    except OSError:
        return False
    out = _git(p, "rev-parse", "--is-inside-work-tree")
    return out == "true"


def git_has_remote(path) -> bool:
    """True iff the repo declares at least one remote. READ-ONLY (`git remote`).
    Non-repo / no remote / error -> False. (9A has a .git/config text-based
    detector; this is the subprocess sibling used by the health probe so a
    worktree / non-standard layout is handled by git itself.)"""
    out = _git(path, "remote")
    return bool(out)


def git_is_dirty(path) -> bool:
    """True iff the work tree has uncommitted changes (tracked or untracked).
    READ-ONLY (`status --porcelain`). Non-repo / error -> False (a path we
    cannot read is not reported as dirty; missing-ness is a separate axis)."""
    out = _git(path, "status", "--porcelain")
    # _git returns None on error and "" for a clean tree; only a non-empty
    # porcelain listing means dirty.
    return bool(out)


def git_ahead_behind(path):
    """Return (ahead, behind) commit counts vs the branch's upstream.

    READ-ONLY (`rev-list --left-right --count @{u}...HEAD` -> "behind\\tahead").
    When the branch has NO upstream (or the repo is unreadable), returns
    (None, None) -- ahead=None is the explicit "no upstream" signal the caller
    uses to decide unpushed-because-no-upstream. A clean, fully-pushed branch
    returns (0, 0)."""
    out = _git(path, "rev-list", "--left-right", "--count", "@{u}...HEAD")
    if out is None:
        return (None, None)
    parts = out.split()
    if len(parts) != 2:
        return (None, None)
    try:
        # `@{u}...HEAD` with --left-right: left side (@{u}) = commits we are
        # BEHIND, right side (HEAD) = commits we are AHEAD.
        behind = int(parts[0])
        ahead = int(parts[1])
    except ValueError:
        return (None, None)
    return (ahead, behind)


def git_last_commit_date(path) -> Optional[str]:
    """ISO-8601 date (`%cI`, committer date) of HEAD, or None for an empty repo /
    non-repo / error. READ-ONLY (`log -1 --format=%cI`)."""
    out = _git(path, "log", "-1", "--format=%cI")
    if not out:
        return None
    return out


def repo_health(path) -> dict:
    """Inspect a project path and return its repo health.

    {label, missing, no_git, local_only, dirty, ahead, behind, no_upstream,
     last_commit_date}

    `label` is the single worst-first primary verdict; the raw flags let the
    report place a project in MULTIPLE §2 buckets (e.g. a repo that is both
    dirty AND unpushed appears under Dirty/Forgotten AND Unpushed).

    `diverged` (ahead>0 AND behind>0) means a plain push would be REJECTED (the
    behind side); such repos are routed into the Remote Drift bucket too (not
    just Unpushed), so a user can tell 'safe to push' from 'will be rejected'.

    `probe_error` is True iff the path IS a git repo but a sub-probe could not be
    read (e.g. a concurrent index.lock, or a status that exceeded the timeout on
    a huge tree). A probe failure under-reports (a dirty/ahead repo would look
    cleaner), so such repos are surfaced in a 'Needs Recheck' note rather than
    silently landing in a benign bucket.

    Precedence (worst first):
      missing  (path gone)
      no-git   (exists, not a repo)
      diverged (ahead>0 AND behind>0)
      unpushed (ahead>0, OR a remote exists but the branch has no upstream)
      dirty    (uncommitted changes)
      local-only (git repo with no remote at all)
      clean
    """
    p = Path(path)
    flags = {
        "missing": False,
        "no_git": False,
        "local_only": False,
        "dirty": False,
        "ahead": None,
        "behind": None,
        "no_upstream": False,
        "probe_error": False,
        "last_commit_date": None,
    }

    # missing: the bound path no longer exists on disk.
    try:
        exists = p.exists()
    except OSError:
        exists = False
    if not exists:
        flags["missing"] = True
        return {"label": HEALTH_MISSING, **flags}

    # no-git: exists but not a git work tree.
    if not is_git_repo(p):
        flags["no_git"] = True
        return {"label": HEALTH_NO_GIT, **flags}

    has_remote = git_has_remote(p)
    flags["local_only"] = not has_remote
    # status --porcelain directly so we can tell 'confirmed clean' ("" -> dirty
    # False) from 'could not determine' (None -> probe_error). git_is_dirty
    # collapses both to False; here, on a confirmed repo, None is a probe error.
    porcelain = _git(p, "status", "--porcelain")
    if porcelain is None:
        flags["probe_error"] = True
    flags["dirty"] = bool(porcelain)
    flags["last_commit_date"] = git_last_commit_date(p)

    ahead, behind = git_ahead_behind(p)
    flags["ahead"] = ahead
    flags["behind"] = behind
    # No upstream is signalled by ahead=None from git_ahead_behind. It only
    # contributes to "unpushed" when a remote actually exists (a local-only repo
    # with no upstream is just local-only, not unpushed -- there is nowhere to
    # push yet; that is 9C's job to offer publishing).
    flags["no_upstream"] = ahead is None
    no_upstream_with_remote = (ahead is None) and has_remote

    # Precedence, worst first.
    if (ahead or 0) > 0 and (behind or 0) > 0:
        label = HEALTH_DIVERGED
    elif (ahead or 0) > 0 or no_upstream_with_remote:
        label = HEALTH_UNPUSHED
    elif flags["dirty"]:
        label = HEALTH_DIRTY
    elif not has_remote:
        label = HEALTH_LOCAL_ONLY
    else:
        label = HEALTH_CLEAN

    return {"label": label, **flags}


def local_presence(path) -> str:
    """'present' iff the path exists on disk, else 'missing'."""
    try:
        return "present" if Path(path).exists() else "missing"
    except OSError:
        return "missing"


# --- the six §2 buckets -----------------------------------------------------

def _days_between(today_iso: str, last_commit_iso: Optional[str]) -> Optional[int]:
    """Whole days between a commit's date and `today` (ISO date strings). The
    commit date may carry a time/offset (`%cI`); we compare DATE parts only, so
    a timezone offset never shifts the day count. None when uncomparable."""
    if not last_commit_iso:
        return None
    from datetime import date as _date

    def _to_date(s: str):
        # Take the leading YYYY-MM-DD; tolerate a trailing T.../offset.
        head = s.strip()[:10]
        try:
            return _date.fromisoformat(head)
        except ValueError:
            return None

    t = _to_date(today_iso)
    c = _to_date(last_commit_iso)
    if t is None or c is None:
        return None
    return (t - c).days


def workspace_status(vault, today: Optional[str] = None, dirty_days: int = 14,
                     forgotten_days: int = 30) -> dict:
    """Inspect every BOUND project (entity -> path from local-bindings.json) and
    classify it into the six §2 buckets. READ-ONLY; writes nothing.

    Buckets (a project MAY appear in several):
      local_only       git repo with NO remote (candidate for one-click publish)
      unpushed         ahead>0, OR a remote exists but the branch has no upstream
      dirty_forgotten  uncommitted changes, OR last commit older than
                       forgotten_days vs `today` (the "developed but forgot"
                       case). Each row carries why={dirty, forgotten, age_days}.
      missing_path     the bound path is gone from disk
      board_unbound    ALWAYS (board health needs 9C+ adapters) -> TODO marker
      remote_drift     diverged repos (ahead>0 AND behind>0 -> push rejected);
                       also the future home for board/remote-adapter drift
      needs_recheck    repo whose sub-probe failed (under-reported; recheck)

    Deterministic: bindings are processed in sorted entity order; every bucket
    list is in entity order. `today` (ISO date) pins the forgotten/age math for
    reproducible output; defaults to date.today().

    Returns {today, dirty_days, forgotten_days, projects: {...by entity...},
    local_only, unpushed, dirty_forgotten, missing_path, board_unbound,
    remote_drift, needs_recheck, todos}.
    """
    from datetime import date as _date
    today = today or _date.today().isoformat()

    bindings = load_bindings(vault)
    # entity -> path, deterministic order.
    items = []
    for entity in sorted(bindings):
        v = bindings[entity]
        if not isinstance(v, dict) or not isinstance(v.get("path"), str):
            continue
        items.append((entity, v["path"]))

    projects: dict[str, dict] = {}
    local_only: list[dict] = []
    unpushed: list[dict] = []
    dirty_forgotten: list[dict] = []
    missing_path: list[dict] = []
    remote_drift: list[dict] = []
    needs_recheck: list[dict] = []

    for entity, path in items:
        health = repo_health(path)
        presence = local_presence(path)
        age_days = _days_between(today, health["last_commit_date"])
        record = {
            "entity": entity,
            "path": Path(path).as_posix(),
            "presence": presence,
            "health": health["label"],
            "ahead": health["ahead"],
            "behind": health["behind"],
            "no_upstream": health["no_upstream"],
            "dirty": health["dirty"],
            "local_only": health["local_only"],
            "probe_error": health.get("probe_error", False),
            "last_commit_date": health["last_commit_date"],
            "age_days": age_days,
        }
        projects[entity] = record

        if health["missing"]:
            # A missing path can be in no other code-health bucket (we cannot
            # inspect a gone repo); it lands only under Missing Local Path.
            missing_path.append(record)
            continue

        if health["no_git"]:
            # No git -> nothing to push/diverge; it is neither local-only (that
            # means "git, no remote") nor unpushed. It can still be "forgotten"
            # only via age, but with no commits there is no age -> skip. A no-git
            # project is surfaced by 9A's registry, not by a health bucket here.
            continue

        # local-only: git repo with no remote at all.
        if health["local_only"]:
            local_only.append(record)

        # unpushed: commits ahead, OR no upstream while a remote exists.
        no_upstream_with_remote = health["no_upstream"] and not health["local_only"]
        if (health["ahead"] or 0) > 0 or no_upstream_with_remote:
            unpushed.append(record)

        # remote_drift: diverged (ahead>0 AND behind>0). The 'behind' side means
        # a plain push would be REJECTED, so we surface diverged repos here in
        # ADDITION to Unpushed -- this is the worst-first 'diverged' label given
        # its own home, letting a user tell 'safe to push' from 'will be
        # rejected'. (remote_drift remains the home for future board/remote
        # adapters too.)
        if (health["ahead"] or 0) > 0 and (health["behind"] or 0) > 0:
            remote_drift.append(record)

        # needs_recheck: the path IS a git repo but a sub-probe could not be read
        # (e.g. a held index.lock or a >timeout status). A probe failure
        # under-reports, so flag it instead of trusting the cleaner bucket it
        # would otherwise fall into.
        if health.get("probe_error"):
            needs_recheck.append(record)

        # dirty / forgotten: uncommitted changes OR a stale last commit.
        forgotten = age_days is not None and age_days > forgotten_days
        if health["dirty"] or forgotten:
            why = {
                "dirty": bool(health["dirty"]),
                "forgotten": bool(forgotten),
                "age_days": age_days,
            }
            dirty_forgotten.append({**record, "why": why})

    # Board Unbound: until 9C+ board adapters exist, board-health is unknown for
    # every project. We surface ALL bound projects here with a TODO marker rather
    # than silently dropping the section, so the report shape is stable and the
    # gap is visible. Remote Drift needs the same adapters -> empty for now.
    board_unbound = [
        {"entity": e, "note": "board-health TODO (needs 9C+ adapters)"}
        for e, _ in items
    ]

    return {
        "today": today,
        "dirty_days": dirty_days,
        "forgotten_days": forgotten_days,
        "projects": projects,
        "local_only": local_only,
        "unpushed": unpushed,
        "dirty_forgotten": dirty_forgotten,
        "missing_path": missing_path,
        "board_unbound": board_unbound,
        # remote_drift now carries diverged repos (push-would-be-rejected); it is
        # still the future home for board/remote-adapter drift (9C-9E).
        "remote_drift": remote_drift,
        "needs_recheck": needs_recheck,
        "todos": ["board-health (9C+)", "remote-drift adapters (9C-9E)"],
    }


# --- render + write (machine-local, gitignored) -----------------------------

def _fmt_ahead_behind(rec: dict) -> str:
    """Compact 'ahead N / behind M' or 'no upstream' descriptor for a row."""
    if rec.get("no_upstream"):
        return "no upstream"
    ahead = rec.get("ahead") or 0
    behind = rec.get("behind") or 0
    bits = []
    if ahead:
        bits.append(f"{ahead} ahead")
    if behind:
        bits.append(f"{behind} behind")
    return ", ".join(bits) if bits else "in sync"


def render_workspace_status(status: dict) -> str:
    """Render the six-section `_workspace-status.md` (LF-only, deterministic).

    This view MAY include machine paths -- it is written under .vault-mind/
    (gitignored, never committed), the one place a human-readable path view is
    allowed (§0 #9 still forbids paths in shared Projects/*.md)."""
    lines = [
        "# Workspace Status",
        "",
        "> DERIVED, recomputable, MACHINE-LOCAL. Regenerated by "
        "`kb_meta workspace-status`.",
        "> Lives under .vault-mind/ (gitignored) -- never committed, so machine",
        "> paths are allowed here and ONLY here.",
        f"> Compiled: {status['today']}  "
        f"(forgotten > {status['forgotten_days']}d)",
        "",
    ]

    def section(title: str, hint: str, rows: list[str]) -> None:
        lines.append(f"## {title}")
        if hint:
            lines.append(f"_{hint}_")
        if rows:
            lines.extend(rows)
        else:
            lines.append("- (none)")
        lines.append("")

    # Local Only
    rows = [
        f"- {r['entity']} -- {r['path']}"
        for r in status["local_only"]
    ]
    section("Local Only", "git, no remote -> candidate for one-click private "
            "publish", rows)

    # Unpushed
    rows = [
        f"- {r['entity']} -- {r['path']}  ({_fmt_ahead_behind(r)})"
        for r in status["unpushed"]
    ]
    section("Unpushed", "N commits ahead / branch has no upstream", rows)

    # Dirty / Forgotten
    rows = []
    for r in status["dirty_forgotten"]:
        why = r.get("why", {})
        tags = []
        if why.get("dirty"):
            tags.append("dirty")
        if why.get("forgotten"):
            age = why.get("age_days")
            tags.append(f"forgotten ({age}d since last commit)"
                        if age is not None else "forgotten")
        tag = ", ".join(tags) if tags else ""
        suffix = f"  [{tag}]" if tag else ""
        rows.append(f"- {r['entity']} -- {r['path']}{suffix}")
    section("Dirty / Forgotten", "uncommitted changes / last commit long ago",
            rows)

    # Missing Local Path
    rows = [
        f"- {r['entity']} -- {r['path']}  (path gone)"
        for r in status["missing_path"]
    ]
    section("Missing Local Path", "registry has it, disk does not", rows)

    # Board Unbound
    rows = [
        f"- {r['entity']} -- {r['note']}"
        for r in status["board_unbound"]
    ]
    section("Board Unbound", "active but no external board (TODO: 9C+ adapters)",
            rows)

    # Remote Drift (now: diverged repos -- a push would be REJECTED; future:
    # board/remote-adapter drift once adapters land).
    rows = []
    for r in status["remote_drift"]:
        ent = r.get("entity", "?")
        path = r.get("path")
        if path:
            rows.append(f"- {ent} -- {path}  ({_fmt_ahead_behind(r)}) "
                        "[diverged: push would be rejected]")
        else:
            rows.append(f"- {ent}")
    section("Remote Drift", "diverged (ahead AND behind) -> push rejected; "
            "later: Linear/GitHub vs vault (needs adapters)", rows)

    # Needs Recheck: a git repo whose probe failed -> possibly under-reported.
    rows = [
        f"- {r['entity']} -- {r['path']}  (probe failed -- recompute)"
        for r in status.get("needs_recheck", [])
    ]
    section("Needs Recheck", "git probe could not be read (lock/timeout) -- the "
            "row above may under-report; re-run when free", rows)

    return "\n".join(lines).rstrip() + "\n"


def workspace_status_path(vault) -> Path:
    return _vault_mind_dir(vault) / WORKSPACE_STATUS_FILE


def write_workspace_status(vault, md: str) -> Path:
    """Write the rendered report to <vault>/.vault-mind/_workspace-status.md as
    LF-only bytes (mirrors save_meta / save_bindings). The .vault-mind/ dir is
    gitignored, so this machine-local view is never committed. Returns the
    path written."""
    p = workspace_status_path(vault)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    try:
        # Bytes (NOT text mode): the render is pure LF; a text-mode write would
        # translate to CRLF on Windows, defeating the byte-stable contract.
        tmp.write_bytes(md.replace("\r\n", "\n").encode("utf-8"))
        tmp.replace(p)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    return p
