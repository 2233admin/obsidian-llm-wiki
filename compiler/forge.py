"""Task 9 / PR 9C: SHARED FORGE ADAPTER SCAFFOLDING (zero-dependency, stdlib only).

> The forge layer is a PULL-ONLY, post-attached PROJECTION on top of the local
> work truth (Task 8). A remote change never edits current-truth directly: it
> becomes a `status: draft` candidate stamped with `origin:` + `base-head`, flows
> through 8D triage -> 8P promote (the PR gate) -> reviewed current-truth, and
> only a REVIEWED snapshot is ever projected back out (push). Code activity is
> evidence only -- it never auto-closes a work item (Task 9 §0 #12).

This module is the foundation 9D (GitHub) / 9E (Linear) reuse. It deliberately
lands ONLY the provider-agnostic seam; the concrete Gitea/GitHub/Linear API
shapes land per-provider on top of it.

Locked design (TASK9 §7 -- followed EXACTLY, do NOT deviate):
  * zero-dep stdlib only. HTTP goes through `urllib.request` ONLY -- NO requests,
    NO httpx. The `Transport` is an INJECTABLE interface; tests pass a
    `FakeTransport` with canned responses and NEVER hit a live API.
  * pull-only. NO webhook receiver, NO daemon (§0 #11): an adapter is a one-shot
    API client driven by `sync pull` / `sync plan` / `sync apply`.
  * tokens come from the ENVIRONMENT (GITEA_TOKEN / GITHUB_TOKEN / LINEAR_TOKEN).
    Endpoints + repo/project bindings come from gitignored
    `<vault>/.vault-mind/forge.json` (machine-local, NEVER committed; the file
    holds NO secrets). A missing token -> a graceful "not configured" result,
    never a crash, and the token is NEVER leaked into any error text.
  * a remote change -> a `status: draft` candidate stamped with
    `origin:{provider,object-id,revision,actor}` + `base-head` (when a current
    head exists) -> 8D triage -> 8P promote -> push. NO `supersedes` on a draft.
  * single bidirectional write path per project (§0 #10): a project declares one
    forge + one primary-board (both read-write) + read-only mirrors. A second
    bidirectional path is REFUSED (anti-loop guard) before any push.
  * dry-run is the DEFAULT for any write/push.
  * Windows: any written file is LF-only bytes (mirrors save_meta / save_bindings).

NO DB, NO embeddings, NO LLM. Markdown + machine-local JSON are the only state.
"""

from __future__ import annotations

import json
import os
import sys as _sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

# currency.py is the Task 8A state contract (work_state words, F_* fields);
# work_protocol.py is the 8P draft/candidate convention. Import works whether
# this module is imported from compiler/ or run as a script.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in _sys.path:
    _sys.path.insert(0, str(_HERE))

import currency as _currency  # noqa: E402
import work_protocol as _work_protocol  # noqa: E402


# === machine-local config: <vault>/.vault-mind/forge.json ===================
#
# The whole .vault-mind/ dir is gitignored (machine-specific paths AND now the
# forge endpoint bindings). forge.json holds NO secrets -- only provider names,
# base URLs, and repo/project bindings; tokens live in the environment.

VAULT_MIND_DIR = ".vault-mind"
FORGE_CONFIG_FILE = "forge.json"

# Provider names (the `provider:` key in a forge/board/mirror binding and in an
# `origin:` stamp). Shared spelling so 9D/9E and the candidate stamper agree.
PROVIDER_LOCAL = "local"
PROVIDER_GITEA = "gitea"
PROVIDER_GITHUB = "github"
PROVIDER_LINEAR = "linear"

# provider -> the environment variable its token is read from. A provider with
# no entry here (or a missing env var) -> token_for returns None -> the caller
# degrades to a "not configured" result rather than crashing (§7.3).
TOKEN_ENV = {
    PROVIDER_GITEA: "GITEA_TOKEN",
    PROVIDER_GITHUB: "GITHUB_TOKEN",
    PROVIDER_LINEAR: "LINEAR_TOKEN",
}

# A project's bindings are keyed under "project/<slug>" in forge.json, matching
# the entity convention used everywhere else (work_protocol / workspace).
DEFAULT_HTTP_TIMEOUT_S = 10


def _vault_mind_dir(vault) -> Path:
    return Path(vault) / VAULT_MIND_DIR


def forge_config_path(vault) -> Path:
    return _vault_mind_dir(vault) / FORGE_CONFIG_FILE


def load_forge_config(vault) -> dict:
    """Load `<vault>/.vault-mind/forge.json`. Shape:

        { "projects": {
            "project/<slug>": {
              "forge":         { "provider": "gitea", "base_url": "...", "repo": "org/x" },
              "primary_board": { "provider": "linear", ... } | null,
              "mirrors":       [ { "provider": "gitea-project", "mode": "read-only" }, ... ]
            }, ... } }

    Missing / unreadable / malformed -> {} (the binding is rebuildable; a corrupt
    file must never crash the read, mirroring workspace.load_bindings). The file
    holds NO secrets -- tokens come from token_for(), never from here."""
    p = forge_config_path(vault)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text("utf-8-sig"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def project_configs(vault) -> dict:
    """The `projects` map from forge.json, or {} when absent/malformed. Each
    value is a project's {forge, primary_board, mirrors} binding."""
    cfg = load_forge_config(vault)
    projects = cfg.get("projects") if isinstance(cfg, dict) else None
    return projects if isinstance(projects, dict) else {}


def token_for(provider: Optional[str]) -> Optional[str]:
    """Read a provider's API token from the ENVIRONMENT (§7.3). Returns the token
    string, or None when the provider is unknown OR the env var is unset/blank --
    the caller MUST degrade gracefully (a "not configured" result), never crash.

    Secrets live ONLY in the environment; they are never written to forge.json
    and never returned anywhere they could be logged into an error message."""
    if not provider:
        return None
    env_name = TOKEN_ENV.get(provider.strip().lower())
    if not env_name:
        return None
    tok = os.environ.get(env_name)
    if tok is None:
        return None
    tok = tok.strip()
    return tok or None


# === Transport (injectable; urllib default, FakeTransport in tests) =========
#
# The Transport is the ONLY thing that touches the network, so tests can inject a
# FakeTransport and assert the full pull->candidate / reviewed->payload mapping
# WITHOUT a live API (§7.2 / §7.7). A token is NEVER placed in any error text the
# transport raises -- the structured TransportError carries method/url/status
# only, so a leaked token can never reach a log.


class TransportError(Exception):
    """A structured transport failure. Carries method / url / status only -- it
    deliberately does NOT carry headers or the request body, so an Authorization
    token can never leak into an error string / log (§7.3)."""

    def __init__(self, method: str, url: str, status: Optional[int],
                 detail: str = "") -> None:
        self.method = method
        self.url = _redact_url(url)
        self.status = status
        self.detail = detail
        msg = f"{method} {self.url} -> {status if status is not None else 'no-response'}"
        if detail:
            msg += f": {detail}"
        super().__init__(msg)


def _redact_url(url: str) -> str:
    """Strip any `?...`/`#...` query+fragment from a URL before it lands in an
    error message -- a provider can carry a token as a query param, so the safe
    default is to keep only scheme://host/path."""
    if not isinstance(url, str):
        return str(url)
    return url.split("?", 1)[0].split("#", 1)[0]


class Transport:
    """Injectable HTTP interface. Implementations expose ONE method:

        request(method, url, headers: dict, body: bytes|None)
            -> {"status": int, "headers": dict, "body": bytes}

    so a provider's pull()/push can issue requests without knowing whether the
    bytes go to a live API (UrllibTransport) or a canned table (FakeTransport)."""

    def request(self, method: str, url: str, headers: Optional[dict] = None,
                body: Optional[bytes] = None) -> dict:
        raise NotImplementedError


class UrllibTransport(Transport):
    """The default real transport: HTTP via stdlib `urllib.request` ONLY (§7.2 --
    NO requests/httpx). A short timeout bounds a hung remote; an HTTP error (4xx/
    5xx) is surfaced as a structured TransportError that NEVER echoes the token
    (the headers dict, which may carry Authorization, is never put in the error).
    """

    def __init__(self, timeout: float = DEFAULT_HTTP_TIMEOUT_S) -> None:
        self.timeout = timeout

    def request(self, method: str, url: str, headers: Optional[dict] = None,
                body: Optional[bytes] = None) -> dict:
        # Import inside the method so merely importing forge.py pulls in nothing
        # network-related, and so the zero-dep stdlib boundary is explicit.
        import urllib.error
        import urllib.request

        req = urllib.request.Request(
            url, data=body, method=method.upper(),
            headers={k: v for k, v in (headers or {}).items()},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return {
                    "status": getattr(resp, "status", resp.getcode()),
                    "headers": dict(resp.headers.items()),
                    "body": resp.read(),
                }
        except urllib.error.HTTPError as e:
            # An HTTP error still has a body (the API's error JSON). Surface the
            # status; do NOT include request headers/body (token-bearing) in the
            # raised error text.
            try:
                err_body = e.read()
            except Exception:
                err_body = b""
            raise TransportError(method, url, e.code,
                                 detail="http error") from None
        except urllib.error.URLError as e:
            # DNS / connection / timeout: no status. The reason is a network
            # condition (never the token), but keep it terse + url-redacted.
            raise TransportError(method, url, None,
                                 detail="connection error") from None


# === RemoteItem + Provider interface ========================================
#
# A Provider is duck-typed (any object exposing `name`, `pull(...)`,
# `push_plan(...)`). The ABC below documents the contract and gives 9D/9E a base
# to inherit; a test fake may subclass it or just duck-type it.


@dataclass
class RemoteItem:
    """One normalized remote object (an issue / PR / card), provider-agnostic.

    A provider's pull() maps its raw API JSON into these so the candidate stamper
    (remote_item_to_candidate) is provider-independent:

      kind         "issue" | "pull-request" | "card" | ...  (provider's notion)
      object_id    the remote's stable id (e.g. "LIN-123", "#42")
      revision     the remote's version token (updated_at ISO) -- conflict detect
      actor        who last touched it remotely (e.g. "user/xue")
      title        the item's title (becomes the candidate body's first line)
      state        the RAW remote state word (mapped via work_state-compatible
                   words by the stamper, never trusted verbatim)
      entity_hint  the vault entity this item maps to (project/<slug>/issue/<id>)
                   -- resolved by the provider from its repo/project binding
      raw          the untouched provider JSON, for debugging / future fields
    """

    kind: str
    object_id: str
    revision: Optional[str] = None
    actor: Optional[str] = None
    title: str = ""
    state: Optional[str] = None
    entity_hint: Optional[str] = None
    raw: dict = field(default_factory=dict)


class Provider:
    """The provider interface 9D/9E implement. Duck-typed -- a subclass or any
    object exposing these is accepted.

      name                         the provider id ("gitea"/"github"/"linear").
      pull(repo_cfg, transport, token) -> [RemoteItem]
                                   one-shot read of the remote into RemoteItems.
                                   MUST tolerate token=None gracefully (return []).
      push_plan(snapshot, repo_cfg) -> dict
                                   build the API payload that WOULD project a
                                   REVIEWED current-truth snapshot outward. Pure /
                                   no I/O -- the actual network push lands later,
                                   per-provider; this is just the payload seam.
    """

    name: str = "provider"

    def pull(self, repo_cfg: dict, transport: Transport,
             token: Optional[str]) -> list:
        raise NotImplementedError

    def push_plan(self, snapshot: dict, repo_cfg: dict) -> dict:
        raise NotImplementedError


# === remote state -> work_state-compatible word =============================
#
# A remote's raw state word is NEVER trusted verbatim. We map it through the SAME
# back-compat vocabulary currency.work_state understands (open->todo, closed/
# merged/done->done, ...) so a stamped candidate carries a canonical 5-state word
# -- but as a PROPOSAL on a draft, which still must go through promote (§0 #12:
# a remote "closed" only SUGGESTS done; the PR gate decides).

# Extra remote-flavored words on top of currency's _LEGACY_STATE_MAP. work_state
# already maps open/closed/done/completed/canceled; these cover forge/board
# spellings (merged PR, Linear triage/started/backlog states).
_REMOTE_STATE_EXTRA = {
    "merged": _currency.STATE_DONE,
    "resolved": _currency.STATE_DONE,
    "started": _currency.STATE_IN_PROGRESS,
    "in review": _currency.STATE_IN_PROGRESS,
    "in-review": _currency.STATE_IN_PROGRESS,
    "triage": _currency.STATE_BACKLOG,
    "unstarted": _currency.STATE_TODO,
    "todo": _currency.STATE_TODO,
}


def map_remote_state(remote_state: Optional[str]) -> str:
    """Map a RAW remote state word to a canonical currency work state, going
    through currency.work_state's vocabulary first (open/closed/done/...) then a
    small forge/board-flavored extra table (merged/started/triage/...). An
    unknown / empty word falls back to currency.DEFAULT_STATE (backlog) so a
    candidate always carries a valid 5-state proposal -- never the raw word."""
    if not remote_state:
        return _currency.DEFAULT_STATE
    w = remote_state.strip().lower()
    if not w:
        return _currency.DEFAULT_STATE
    # currency.work_state understands a `state` field; reuse its canonicalizer.
    mapped = _currency.work_state({_currency.F_STATE: w})
    # work_state returns DEFAULT_STATE for an unrecognized word; only override
    # with the extra table when currency did not actually recognize it.
    if mapped != _currency.DEFAULT_STATE or w in _currency.CANONICAL_STATES:
        return mapped
    return _REMOTE_STATE_EXTRA.get(w, _currency.DEFAULT_STATE)


# === remote item -> draft candidate note ====================================

# Where pulled candidates are written: an append-only, per-provider inbox dir
# under the existing 8D triage tree, so classify_triage already sees them.
SYNC_INBOX_DIR = "00-Inbox/AI-Output"


def _sync_writer_dir(provider: str) -> str:
    """The append-only inbox subdir for a provider's pulled candidates, e.g.
    `00-Inbox/AI-Output/sync-gitea`. A sibling of the agent capture writer dirs,
    so 8D triage scans it unchanged."""
    return f"{SYNC_INBOX_DIR}/sync-{_safe_segment(provider)}"


def _safe_segment(s: Optional[str], fallback: str = "x") -> str:
    """A path-safe single segment (no separators / traversal / control chars),
    mirroring the capture-hook's safeSegment so a hostile provider/object-id can
    never escape the inbox dir."""
    out = []
    for ch in str(s or ""):
        if ch.isalnum() or ch in "._-":
            out.append(ch)
        else:
            out.append("-")
    cleaned = "".join(out).strip(".-").lower()[:80]
    return cleaned or fallback


def remote_item_to_candidate(item: RemoteItem, vault, provider: str,
                             base_head_resolver: Optional[Callable] = None,
                             today: Optional[str] = None) -> dict:
    """Build a `status: draft` candidate note dict from a pulled RemoteItem.

    A remote change is a PROPOSAL, never a direct edit of current-truth (§0 #11).
    The candidate carries:
      type: issue
      entity: <item.entity_hint>
      state: <map_remote_state(item.state)>   -- a canonical 5-state PROPOSAL
      status: draft                            -- ALWAYS (a capture is never self-reviewed)
      origin:{provider, object-id, revision, actor}  -- the federation provenance
      base-head: <resolver(entity)>            -- ONLY when a current head exists
      generated-by: sync/<provider>            -- this sync wrote it (not an agent)
      last-verified: <today>

    NO `supersedes` -- a draft never enters the supersession chain (8P: supersedes
    is materialized only at promote time). `base_head_resolver(entity) -> note_id
    | None` is injected so the optimistic-lock base-head can be resolved without
    this module re-scanning the vault (the caller passes a resolver bound to the
    scanned work index). When it returns falsy, base-head is omitted (a brand-new
    entity -> promote materializes a fresh head).

    Returns {note_id_hint, text, entity, state, origin} -- text is the rendered
    note (LF-only); note_id_hint is the append-only filename the writer will use.
    """
    from datetime import date as _date

    today = today or _date.today().isoformat()
    entity = (item.entity_hint or "").strip()
    state = map_remote_state(item.state)
    base_head = None
    if entity and base_head_resolver is not None:
        try:
            resolved = base_head_resolver(entity)
        except Exception:
            resolved = None
        if isinstance(resolved, str) and resolved.strip():
            base_head = resolved.strip()

    origin = {
        "provider": provider,
        "object-id": item.object_id,
        "revision": item.revision,
        "actor": item.actor,
    }

    text = _render_candidate(
        entity=entity, state=state, origin=origin, base_head=base_head,
        provider=provider, today=today, title=item.title,
    )

    note_id_hint = f"{_sync_writer_dir(provider)}/{today}-{_safe_segment(item.object_id, 'item')}.md"
    return {
        "note_id_hint": note_id_hint,
        "text": text,
        "entity": entity or None,
        "state": state,
        "origin": origin,
        "base_head": base_head,
    }


def _render_candidate(entity: str, state: str, origin: dict,
                      base_head: Optional[str], provider: str, today: str,
                      title: str) -> str:
    """Serialize a draft candidate note (LF-only, deterministic field order). The
    `origin:` block is a nested YAML map (the Task 8 reserved provenance field);
    `generated-by: sync/<provider>` marks this as a sync-written capture, distinct
    from an agent capture (`generated-by: <machine>-<agent>`)."""
    lines = ["---"]
    lines.append(f"{_work_protocol.F_TYPE}: {_work_protocol.TYPE_ISSUE}")
    if entity:
        lines.append(f"{_work_protocol.F_ENTITY}: {entity}")
    lines.append(f"{_currency.F_STATE}: {state}")
    # status:draft is the REVIEW axis and is ALWAYS draft on a capture -- a remote
    # pull is a proposal, never self-reviewed (8P / §0 #11).
    lines.append(f"{_work_protocol.F_STATUS}: {_work_protocol.STATUS_DRAFT}")
    # origin: the federation provenance (Task 8 §1 reserved field). Nested map;
    # None values are omitted so the block stays minimal + byte-stable.
    lines.append("origin:")
    lines.append(f"  provider: {origin.get('provider')}")
    if origin.get("object-id") is not None:
        lines.append(f"  object-id: {origin['object-id']}")
    if origin.get("revision") is not None:
        lines.append(f"  revision: {origin['revision']}")
    if origin.get("actor") is not None:
        lines.append(f"  actor: {origin['actor']}")
    # base-head: the optimistic lock, ONLY when a current head exists (§0 #11).
    if base_head:
        lines.append(f"{_work_protocol.F_BASE_HEAD}: {base_head}")
    lines.append(f"{_work_protocol.F_GENERATED_BY}: sync/{provider}")
    lines.append(f"{_currency.F_LAST_VERIFIED}: {today}")
    lines.append("---")
    text = "\n".join(lines) + "\n"
    body = _sanitize_remote_body(title)
    if body:
        text += "\n" + body + "\n"
    return text


def _sanitize_remote_body(title: Optional[str]) -> str:
    """Render an UNTRUSTED remote title as a safe candidate body. A malicious
    title can embed a newline + a fake `---\\nstatus: reviewed\\n---` fence,
    smuggling a second YAML block into the body. The canonical parser anchors
    frontmatter at start-of-string (FRONTMATTER_RE \\A), so the REAL block always
    wins -- but a naive downstream `---`-splitter could be tricked, and a human 8D
    reviewer could be misled. Defense-in-depth: neutralize any body line that is a
    bare YAML fence (`---` / `...`) by prefixing a zero-width-safe space, so it can
    never open a competing block. Content is preserved, only its fence role is
    defanged."""
    body = (title or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not body:
        return ""
    out = []
    for line in body.split("\n"):
        if line.strip() in ("---", "..."):
            out.append(" " + line)  # a leading space -> no longer a YAML fence.
        else:
            out.append(line)
    return "\n".join(out)


# === pull -> candidates (dry-run default) ===================================


def _provider_repo_cfg(vault, project_entity: str) -> Optional[dict]:
    """The `forge` repo binding for a project entity, or None when unbound."""
    pc = project_configs(vault).get(project_entity)
    if not isinstance(pc, dict):
        return None
    forge = pc.get("forge")
    return forge if isinstance(forge, dict) else None


def _default_base_head_resolver(vault) -> Callable:
    """Build a base-head resolver bound to the vault's scanned authoritative work
    index: entity -> current head note-id (or None). Used by pull so a pulled
    candidate's base-head equals the head promote() will independently resolve.
    Scans once and closes over the result so N items share one scan."""
    notes = _work_protocol.scan_work_notes(vault)

    def _resolve(entity: str) -> Optional[str]:
        res = _work_protocol.resolve_head(notes, entity)
        return res.head.note_id if res.head is not None else None

    return _resolve


def pull_to_candidates(vault, provider_name: str, transport: Transport,
                       provider: Optional[Provider] = None,
                       apply: bool = False,
                       today: Optional[str] = None) -> dict:
    """Pull every bound project's remote items for `provider_name` and map them to
    `status: draft` candidate notes under `00-Inbox/AI-Output/sync-<provider>/`.

    DRY-RUN by default (§7 / §0 #5): apply=False writes NOTHING and returns the
    plan (the candidate texts + where they WOULD be written). apply=True writes
    them APPEND-ONLY (exclusive create; never overwrites a head or a prior
    capture), LF-only bytes.

    Token comes from the environment (token_for). A MISSING token is NOT a crash:
    the result is {configured: False, ...} with no items pulled (§7.3). The
    `transport` is injected so tests use a FakeTransport and never hit a live API;
    `provider` is the Provider implementation (injected for the same reason -- 9C
    ships only the seam, so a missing provider yields an empty, well-formed plan).

    Returns {provider, configured, apply, candidates: [...], written: [...],
    projects: [...], reason}.
    """
    from datetime import date as _date

    today = today or _date.today().isoformat()
    token = token_for(provider_name)
    result = {
        "provider": provider_name,
        "configured": token is not None,
        "apply": apply,
        "candidates": [],
        "written": [],
        "projects": [],
        "reason": "",
    }

    if token is None:
        # graceful "not configured" -- never crash (§7.3). No token, no pull.
        result["reason"] = (
            f"no token for {provider_name} (set {TOKEN_ENV.get(provider_name, 'its token env var')}); "
            "nothing pulled."
        )
        return result

    # Find the projects bound to THIS provider's forge.
    bound = []
    for entity, pc in sorted(project_configs(vault).items()):
        forge = pc.get("forge") if isinstance(pc, dict) else None
        if isinstance(forge, dict) and forge.get("provider") == provider_name:
            bound.append((entity, forge))
    result["projects"] = [e for e, _ in bound]

    if provider is None:
        # 9C ships only the seam; without a concrete Provider there is nothing to
        # pull. Return a well-formed empty plan (NOT an error) so the CLI/tests
        # exercise the wiring even before 9D/9E land their providers.
        result["reason"] = "no provider implementation supplied (9C seam only)."
        return result

    resolver = _default_base_head_resolver(vault)
    candidates: list[dict] = []
    for entity, forge in bound:
        try:
            items = provider.pull(forge, transport, token)
        except TransportError as e:
            # a remote failure for one project must not abort the others; record
            # the redacted error and continue (the token is never in e's text).
            result.setdefault("errors", []).append(
                {"project": entity, "error": str(e)})
            continue
        for item in items or []:
            # default the entity_hint to the project entity when the provider did
            # not resolve a finer one, so a pulled item always attaches somewhere.
            if not item.entity_hint:
                item.entity_hint = entity
            cand = remote_item_to_candidate(
                item, vault, provider_name,
                base_head_resolver=resolver, today=today)
            candidates.append(cand)

    result["candidates"] = candidates

    if not apply:
        return result

    # apply: append-only writes under the per-provider inbox dir, LF bytes.
    written: list[str] = []
    for cand in candidates:
        path = _write_candidate_append_only(vault, cand["note_id_hint"], cand["text"])
        if path is not None:
            written.append(path.as_posix())
    result["written"] = written
    return result


def _write_candidate_append_only(vault, note_id_hint: str,
                                 text: str) -> Optional[Path]:
    """Write one candidate APPEND-ONLY (exclusive create; never overwrite). On a
    name collision, advance to `-2`, `-3`, ... LF-only bytes (mirrors the capture
    hook / save_meta). Returns the written path, or None if no free name found."""
    base = Path(vault) / note_id_hint
    base.parent.mkdir(parents=True, exist_ok=True)
    stem = base.stem
    suffix = base.suffix or ".md"
    parent = base.parent
    data = text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")
    for i in range(1, 100):
        name = f"{stem}{suffix}" if i == 1 else f"{stem}-{i}{suffix}"
        target = parent / name
        try:
            # 'xb' = exclusive create in binary -> never clobbers an existing
            # head/capture, and binary keeps the bytes LF-only on Windows.
            with open(target, "xb") as fh:
                fh.write(data)
            return target
        except FileExistsError:
            continue
        except OSError:
            return None
    return None


# === anti-loop guard (§0 #10 single bidirectional write path) ===============


class BidirectionalConflict(Exception):
    """Raised when a project declares more than one bidirectional (read-write)
    path -- the §0 #10 single-main-board invariant. Carries the offending paths
    so the caller can surface exactly which two would form a write loop."""

    def __init__(self, project_entity: str, paths: list) -> None:
        self.project_entity = project_entity
        self.paths = paths
        super().__init__(
            f"{project_entity}: >1 bidirectional write path "
            f"({', '.join(paths)}); only ONE forge + ONE primary-board may be "
            "read-write, all mirrors must be read-only (Task 9 §0 #10)."
        )


def _is_read_only(binding: dict) -> bool:
    """A binding is read-only when it declares mode:read-only (mirrors do)."""
    if not isinstance(binding, dict):
        return False
    mode = str(binding.get("mode", "")).strip().lower()
    return mode in ("read-only", "readonly", "ro")


def assert_single_bidirectional(project_cfg: dict,
                                project_entity: str = "?") -> list:
    """Enforce §0 #10: a project has AT MOST one bidirectional (read-write) path.

    Allowed read-write paths: one `forge` + one `primary_board`. Every `mirror`
    MUST be read-only (mode:read-only). A mirror that is NOT read-only, OR a
    second forge / second primary-board, is a second bidirectional path -> raise
    BidirectionalConflict (prevents a vault<->GitHub<->Linear sync loop).

    Returns the list of read-write path labels (for the caller's plan) when the
    config is valid. sync_apply MUST call this before any push."""
    rw_paths: list[str] = []
    forge = project_cfg.get("forge") if isinstance(project_cfg, dict) else None
    if isinstance(forge, dict) and forge.get("provider"):
        if not _is_read_only(forge):
            rw_paths.append(f"forge:{forge.get('provider')}")

    board = project_cfg.get("primary_board") if isinstance(project_cfg, dict) else None
    if isinstance(board, dict) and board.get("provider"):
        if not _is_read_only(board):
            rw_paths.append(f"primary-board:{board.get('provider')}")

    mirrors = project_cfg.get("mirrors") if isinstance(project_cfg, dict) else None
    if isinstance(mirrors, list):
        for m in mirrors:
            if isinstance(m, dict) and m.get("provider") and not _is_read_only(m):
                # a writable mirror IS a second bidirectional path -> loop risk.
                rw_paths.append(f"mirror:{m.get('provider')}(NOT read-only)")

    # forge + primary-board are the two ALLOWED rw paths; anything beyond is a
    # loop. A writable mirror is already flagged above. The invariant the guard
    # enforces: at most one forge AND at most one primary-board may be rw, and no
    # writable mirror. We allow {forge, primary-board} together (that is the
    # single-main-board design: one code forge + one board), but refuse a third.
    writable_mirrors = [p for p in rw_paths if p.startswith("mirror:")]
    if writable_mirrors:
        raise BidirectionalConflict(project_entity, rw_paths)
    return rw_paths


# === sync plan / apply (reviewed current-truth -> push payload) =============
#
# sync_plan/apply compute the push payload from the project's REVIEWED current-
# truth (never from drafts -- a draft is a proposal awaiting promote). The anti-
# loop guard runs BEFORE any push. For 9C the concrete network push is a planned
# no-op stub that returns the payload; per-provider execution lands in 9D/9E.


def _reviewed_head_snapshot(vault, project_entity: str) -> Optional[dict]:
    """The REVIEWED current-truth snapshot for a project entity (or its issues),
    as a flat field map -- NEVER a draft. Reads the authoritative head via
    resolve_head (which already excludes drafts: a `status:draft` capture is never
    a head, §3 #1), so what we push is always reviewed/legacy current-truth.

    Returns {entity, note_id, state, fields} or None when the entity has no
    authoritative head (nothing reviewed to project yet)."""
    notes = _work_protocol.scan_work_notes(vault)
    res = _work_protocol.resolve_head(notes, project_entity)
    if res.head is None:
        return None
    head = res.head
    return {
        "entity": project_entity,
        "note_id": head.note_id,
        "state": _currency.work_state(head.cm),
        "status": head.status,
        "fields": dict(head.raw),
    }


def sync_plan(vault, transport: Transport,
              providers: Optional[dict] = None) -> dict:
    """Plan the outward projection (push) for every bound project. DRY-RUN: it
    computes, per project, the push payload from the project's REVIEWED current-
    truth (never a draft) via the provider's push_plan, runs the anti-loop guard,
    and writes NOTHING.

    `providers` maps provider-name -> Provider implementation (injected; 9C ships
    only the seam, so an absent provider yields a payload-less plan entry, not an
    error). Returns {projects: [...], conflicts: [...]} where each project entry
    carries its read-write paths, the reviewed snapshot it WOULD push, and the
    per-target payloads.
    """
    providers = providers or {}
    out = {"projects": [], "conflicts": []}
    for entity, pc in sorted(project_configs(vault).items()):
        if not isinstance(pc, dict):
            continue
        entry = {"entity": entity, "rw_paths": [], "snapshot": None,
                 "payloads": []}
        try:
            entry["rw_paths"] = assert_single_bidirectional(pc, entity)
        except BidirectionalConflict as e:
            # surface the conflict; do NOT plan a push for a loop-risk project.
            out["conflicts"].append({"entity": entity, "error": str(e),
                                     "paths": e.paths})
            entry["error"] = str(e)
            out["projects"].append(entry)
            continue

        snapshot = _reviewed_head_snapshot(vault, entity)
        entry["snapshot"] = snapshot
        if snapshot is None:
            entry["reason"] = "no reviewed current-truth head to project yet."
            out["projects"].append(entry)
            continue

        # build a payload for each READ-WRITE target (forge + primary-board).
        for target_key in ("forge", "primary_board"):
            binding = pc.get(target_key)
            if not isinstance(binding, dict) or _is_read_only(binding):
                continue
            prov_name = binding.get("provider")
            provider = providers.get(prov_name)
            payload = None
            if provider is not None:
                try:
                    payload = provider.push_plan(snapshot, binding)
                except Exception as e:  # a provider bug must not abort the plan.
                    payload = {"error": f"push_plan failed: {e}"}
            entry["payloads"].append({
                "target": target_key,
                "provider": prov_name,
                "configured": token_for(prov_name) is not None,
                "payload": payload,
            })
        out["projects"].append(entry)
    return out


def sync_apply(vault, transport: Transport, providers: Optional[dict] = None,
               apply: bool = False) -> dict:
    """Apply the outward projection. DRY-RUN by default (§7 / §0 #5): apply=False
    is exactly sync_plan with apply=False markers (no push). apply=True is GATED
    and, CRITICALLY, runs the anti-loop guard (assert_single_bidirectional)
    BEFORE any push -- a project with a second bidirectional path is REFUSED
    (§0 #10), never pushed.

    For 9C the concrete network push is a PLANNED NO-OP stub: each rw target's
    result is {pushed: False, payload: ...} -- the actual API call lands per
    provider in 9D/9E. The seam (anti-loop -> reviewed snapshot -> push_plan ->
    push) is exercised end-to-end here so the per-provider work only fills in the
    final call.

    Returns {apply, projects: [...], conflicts: [...]}."""
    plan = sync_plan(vault, transport, providers=providers)
    out = {"apply": apply, "projects": [], "conflicts": plan["conflicts"]}
    for entry in plan["projects"]:
        proj = {
            "entity": entry["entity"],
            "rw_paths": entry["rw_paths"],
            "snapshot": entry["snapshot"],
            "pushed": [],
        }
        if entry.get("error"):
            # a loop-risk project was already excluded by sync_plan -> refuse.
            proj["refused"] = entry["error"]
            out["projects"].append(proj)
            continue
        if entry["snapshot"] is None:
            proj["reason"] = entry.get("reason", "")
            out["projects"].append(proj)
            continue
        for p in entry["payloads"]:
            # 9C: planned no-op. The anti-loop guard already passed in sync_plan
            # (and is re-asserted implicitly by reusing its output); the actual
            # network push is provider-specific and lands in 9D/9E.
            proj["pushed"].append({
                "target": p["target"],
                "provider": p["provider"],
                "configured": p["configured"],
                # dry-run OR 9C-stub -> never actually pushed yet.
                "pushed": False,
                "payload": p["payload"],
            })
        out["projects"].append(proj)
    return out


# ===========================================================================
# Task 9 / PR 9C (part 2): the GITEA ADAPTER
# ===========================================================================
#
# The first concrete Provider on top of the 9C scaffolding above. It speaks the
# Gitea REST API (the user's gitea is git.xart.top:8418) through the INJECTED
# Transport, so a test drives it with a FakeTransport + recorded JSON and NEVER
# hits a live API or creates a real remote repo (§7.2 / §7.7).
#
# Locked design (TASK9 §7 -- followed EXACTLY):
#   * zero-dep stdlib only -- HTTP goes through the injected Transport
#     (urllib.request under the hood); NO requests / NO httpx.
#   * pull-only -- this is a one-shot API client; NO webhook receiver, NO daemon
#     (§0 #11). pull() reads issues; push_plan/create_repo_plan/publish_plan
#     return PAYLOADS / PLANS only -- they never issue a write request.
#   * token from the ENVIRONMENT (GITEA_TOKEN), passed in as `token`; it is sent
#     in the `Authorization: token <T>` header and is NEVER logged / never put in
#     an error message (the structured error carries method/url/status only).
#   * a remote issue -> a status:draft candidate stamped with
#     origin:{provider,object-id,revision,actor} + base-head (via the shared
#     remote_item_to_candidate); code activity is evidence only (§0 #12) -- a
#     pulled "closed" issue is a PROPOSAL, never an auto-close.
#   * dry-run is the DEFAULT for any write/push -- publish_plan is a PLAN only.

GITEA_API_PREFIX = "/api/v1"

# Defensive pagination cap: never loop unboundedly against a remote (a misbehaving
# server, or a never-shrinking page, must not hang the pull). Gitea's max page
# size is 50; this caps total pages, so at most GITEA_PAGE_CAP * limit issues.
GITEA_PAGE_CAP = 20
GITEA_PAGE_LIMIT = 50

# Gitea issue state words -> the canonical 5-state vocabulary is handled by the
# shared map_remote_state (open->todo, closed->done). For the OUTWARD direction
# (push_plan) we map a canonical work state BACK to a Gitea state word: Gitea
# issues only have open|closed, so a terminal state (done/canceled) -> closed and
# every active state (backlog/todo/in-progress/blocked) -> open.
_GITEA_CLOSED_STATES = frozenset({_currency.STATE_DONE, _currency.STATE_CANCELED})

# publish_plan thresholds / secret heuristics ------------------------------
# A file larger than this is flagged as a LARGE file (a repo upload candidate
# the user almost certainly does not want to push to a code forge).
PUBLISH_LARGE_FILE_BYTES = 5 * 1024 * 1024  # 5 MB

# Defensive cap on the upload-set walk, mirroring GITEA_PAGE_CAP for the remote
# pull: a mis-adopted huge root (hundreds of thousands of files) must degrade the
# dry-run plan gracefully (a `truncated` warning) instead of hanging while every
# text file is read for secrets. Past this many entries the walk stops.
PUBLISH_WALK_FILE_CAP = 50_000

# Dirs never walked when scanning a project to publish (VCS internals / vendored
# / build output). Mirrors workspace.SKIP_DIRS so the upload set matches what a
# normal `git add` would stage.
PUBLISH_SKIP_DIRS = frozenset({
    ".git", "node_modules", ".venv", "__pycache__", "dist", "build",
    "target", "vendor", ".obsidian", ".mypy_cache", ".pytest_cache",
})

# Suspected-secret heuristics. Each is a compiled regex run over a candidate
# file's TEXT (binary / huge files are skipped). The names are surfaced in the
# plan's `secret_offenders` so the user can scrub before a push. These are
# deliberately conservative, high-signal patterns (the plan WARNS; it never
# silently uploads).
import re as _re  # local alias; stdlib only

_SECRET_PATTERNS = [
    ("aws-access-key-id", _re.compile(r"AKIA[0-9A-Z]{16}")),
    ("private-key-block", _re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    # token/secret/password assigned a non-empty value (env-style or code-style).
    ("assigned-secret", _re.compile(
        r"(?i)\b(token|secret|password|passwd|api[_-]?key)\b\s*[:=]\s*"
        r"['\"]?[^\s'\"#]{6,}")),
]

# A .env file is itself suspicious: its very contents are secrets. Any file whose
# name is exactly .env or starts with `.env.` (e.g. .env.local) is flagged.
def _is_env_file(name: str) -> bool:
    n = (name or "").lower()
    return n == ".env" or n.startswith(".env.")


# Text extensions we bother scanning for secrets. A binary blob is skipped (it is
# already covered by the large-file scan and would only produce regex noise).
_TEXT_SCAN_EXTS = frozenset({
    ".env", ".txt", ".md", ".py", ".js", ".ts", ".tsx", ".jsx", ".json",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".sh", ".bash", ".ps1",
    ".rb", ".go", ".rs", ".java", ".cs", ".php", ".sql", ".xml", ".properties",
    ".pem", ".key", ".cer", ".crt", "",  # "" = no extension (e.g. a Dockerfile)
})


class GiteaAdapter(Provider):
    """The Gitea Provider (§7.4). Reads issues into RemoteItems via the injected
    Transport, and builds (but never executes) the payloads/plans for the outward
    direction. The actual network WRITE (create repo / push) is apply-only and
    needs a live gitea + a real `git push`; it is explicitly out of scope for 9C
    -- the PLAN is the deliverable (§3 9C: dry-run by default).
    """

    name = PROVIDER_GITEA

    # --- inward: pull issues -> RemoteItems --------------------------------

    def pull(self, repo_cfg: dict, transport: Transport,
             token: Optional[str]) -> list:
        """GET /api/v1/repos/{owner}/{repo}/issues?state=all -> [RemoteItem].

        Each Gitea issue becomes a RemoteItem(kind='issue', object_id=number,
        revision=updated_at, actor=user.login, title, state, entity_hint=
        'project/<slug>/issue/<number>'). Paginated DEFENSIVELY (capped pages;
        stops on a short / empty page).

        Token=None -> [] (graceful; pull_to_candidates only calls us configured,
        but tolerate it directly too -- never crash). A 401/404/network error is
        surfaced as a structured TransportError WHOSE TEXT NEVER carries the token
        (the redacting TransportError carries method/url/status only). The caller
        (pull_to_candidates) catches it per-project; we let it propagate.
        """
        if not token:
            return []
        base = self._api_base(repo_cfg)
        owner, repo = self._owner_repo(repo_cfg)
        if not base or not owner or not repo:
            return []
        slug = _safe_segment(repo, "repo")
        headers = self._auth_headers(token)

        items: list = []
        seen_ids: set = set()
        for page in range(1, GITEA_PAGE_CAP + 1):
            url = (f"{base}/repos/{owner}/{repo}/issues"
                   f"?state=all&type=issues&page={page}&limit={GITEA_PAGE_LIMIT}")
            resp = transport.request("GET", url, headers=headers)
            self._raise_for_status("GET", url, resp)
            page_items = self._parse_issues(resp.get("body"), slug)
            if not page_items:
                break  # empty page -> done.
            new_this_page = 0
            for it in page_items:
                if it.object_id in seen_ids:
                    continue  # defensive: a server that repeats a page can't loop us.
                seen_ids.add(it.object_id)
                items.append(it)
                new_this_page += 1
            # a short page (or one with no NEW ids) means the last page is reached.
            if len(page_items) < GITEA_PAGE_LIMIT or new_this_page == 0:
                break
        return items

    def _parse_issues(self, body, slug: str) -> list:
        """Map a Gitea issues JSON array (response body bytes) to RemoteItems.

        A Gitea PULL REQUEST is also returned by the issues endpoint (it carries a
        `pull_request` object); we SKIP those here -- 9C maps issues only, PRs are
        9D evidence (§0 #12). A malformed body -> [] (never crash)."""
        data = self._json_array(body)
        out: list = []
        for raw in data:
            if not isinstance(raw, dict):
                continue
            if raw.get("pull_request") is not None:
                # a PR, not an issue -> evidence (9D), not a work candidate here.
                continue
            number = raw.get("number")
            if number is None:
                continue
            object_id = str(number)
            user = raw.get("user")
            actor = user.get("login") if isinstance(user, dict) else None
            out.append(RemoteItem(
                kind="issue",
                object_id=object_id,
                revision=raw.get("updated_at"),
                actor=actor,
                title=raw.get("title", "") or "",
                state=raw.get("state"),
                entity_hint=f"project/{slug}/issue/{object_id}",
                raw=raw,
            ))
        return out

    # --- outward: reviewed snapshot -> push payload (PLAN only) ------------

    def push_plan(self, snapshot: dict, repo_cfg: dict) -> dict:
        """Build the Gitea issue payload that WOULD project a REVIEWED snapshot
        outward (§7.4). PURE -- NO network here (the actual POST/PATCH lands in a
        later apply path; the payload is the seam).

        Method:
          * a NEW issue (no origin.object-id on the snapshot) -> POST
            /api/v1/repos/{owner}/{repo}/issues, body {title, body, state}.
          * an UPDATE (origin.object-id present) -> PATCH
            .../issues/{number}, body {title, body, state}.

        `state` is the Gitea word: a terminal canonical state (done/canceled) ->
        'closed', everything else -> 'open' (Gitea issues are open|closed only).
        """
        owner, repo = self._owner_repo(repo_cfg)
        canonical = snapshot.get("state")
        gitea_state = self._to_gitea_state(canonical)
        title = self._snapshot_title(snapshot)
        body = self._snapshot_body(snapshot)

        object_id = self._origin_object_id(snapshot)
        payload = {
            "title": title,
            "body": body,
            "state": gitea_state,
        }
        if object_id is not None:
            # UPDATE an existing issue -> PATCH at the numbered endpoint.
            return {
                "method": "PATCH",
                "endpoint": f"/repos/{owner}/{repo}/issues/{object_id}",
                "object_id": object_id,
                "entity": snapshot.get("entity"),
                "payload": payload,
            }
        # CREATE a new issue -> POST at the collection endpoint.
        return {
            "method": "POST",
            "endpoint": f"/repos/{owner}/{repo}/issues",
            "object_id": None,
            "entity": snapshot.get("entity"),
            "payload": payload,
        }

    def create_repo_plan(self, project_cfg: dict) -> dict:
        """The payload for POST /api/v1/user/repos that 'publish' would use to
        create the private repo (§7.4). PLAN only -- NO network.

        Body: {name, private: True, auto_init: False, default_branch: 'main',
        description}. `name` comes from the project's forge binding repo
        (`owner/name` -> name) or a `name` override; private is ALWAYS True (the
        one-click PRIVATE publish is the local-only safety net)."""
        owner, repo = self._owner_repo(project_cfg)
        name = (project_cfg.get("name") or repo or "").strip()
        description = (project_cfg.get("description") or "").strip()
        return {
            "method": "POST",
            "endpoint": "/user/repos",
            "payload": {
                "name": name,
                "private": True,
                "auto_init": False,
                "default_branch": project_cfg.get("default_branch", "main"),
                "description": description,
            },
        }

    # --- one-click private publish (DRY-RUN plan only) ---------------------

    def publish_plan(self, vault, entity: str,
                     transport: Optional[Transport] = None) -> dict:
        """The DRY-RUN one-click PRIVATE publish plan for a LOCAL-ONLY project
        (§3 9C / §7.4). RETURNS a plan; creates NOTHING and pushes NOTHING.

        The local path is resolved from the machine-local local-bindings (NEVER
        from a shared note -- §0 #9). Steps the plan reports, in order:
          1. .gitignore present?            (a missing one is a publish hazard)
          2. LARGE files (> PUBLISH_LARGE_FILE_BYTES) -> flagged offenders
          3. SUSPECTED SECRETS (AKIA / PRIVATE KEY / assigned token|secret|
             password / .env contents) -> flagged offenders
          4. files that WOULD upload (the staged set, minus skip dirs)
          5. the ordered apply steps: create private repo -> git remote add ->
             initial push.

        `transport` is accepted ONLY to prove the contract: publish_plan issues
        NO request on it -- a test asserts transport.calls stayed empty. The
        actual repo creation + push is apply-only (needs a live gitea + real git
        push) and is EXPLICITLY out of scope for this PR.
        """
        # import here so merely importing forge.py pulls in nothing from 9A.
        import workspace as _workspace

        result = {
            "provider": self.name,
            "entity": entity,
            "apply": False,            # dry-run is the default and the only mode here.
            "dry_run": True,
            "path": None,
            "configured": token_for(self.name) is not None,
            "has_gitignore": False,
            "large_files": [],
            "secret_offenders": [],
            "upload_files": [],
            "skipped_dirs": sorted(PUBLISH_SKIP_DIRS),
            "steps": [],
            "warnings": [],
            "reason": "",
        }

        bindings = _workspace.load_bindings(vault)
        binding = bindings.get(entity)
        path = binding.get("path") if isinstance(binding, dict) else None
        if not path:
            result["reason"] = (
                f"{entity} has no machine-local binding "
                f"(adopt it first; path lives only in local-bindings.json)."
            )
            return result
        result["path"] = Path(path).as_posix()

        root = Path(path)
        if not root.exists() or not root.is_dir():
            result["reason"] = f"bound path is gone or not a directory: {result['path']}"
            result["warnings"].append("missing-path")
            return result

        # 1) .gitignore present?
        result["has_gitignore"] = (root / ".gitignore").is_file()
        if not result["has_gitignore"]:
            result["warnings"].append(
                "no .gitignore -- a private push may include build/secret junk.")

        # 2)-4) walk the upload set; flag large files + suspected secrets.
        # Bounded by PUBLISH_WALK_FILE_CAP so a mis-adopted huge root degrades
        # gracefully (a `truncated` warning) instead of hanging the dry-run plan.
        large: list = []
        secrets: list = []
        uploads: list = []
        truncated = False
        for fpath, rel in self._walk_upload_set(root):
            if len(uploads) >= PUBLISH_WALK_FILE_CAP:
                truncated = True
                break
            uploads.append(rel)
            try:
                size = fpath.stat().st_size
            except OSError:
                size = 0
            if size > PUBLISH_LARGE_FILE_BYTES:
                large.append({"file": rel, "bytes": size})
            offence = self._scan_secrets(fpath, rel, size)
            if offence:
                secrets.append(offence)
        if truncated:
            result["warnings"].append(
                f"upload set truncated at {PUBLISH_WALK_FILE_CAP} files -- "
                "narrow the bound path (the secret/large scan is incomplete).")

        result["upload_files"] = sorted(uploads)
        result["large_files"] = sorted(large, key=lambda d: d["file"])
        result["secret_offenders"] = sorted(secrets, key=lambda d: d["file"])

        if result["large_files"]:
            result["warnings"].append(
                f"{len(result['large_files'])} large file(s) (> "
                f"{PUBLISH_LARGE_FILE_BYTES // (1024 * 1024)}MB) would upload.")
        if result["secret_offenders"]:
            result["warnings"].append(
                f"{len(result['secret_offenders'])} suspected-secret file(s) "
                "would upload -- scrub before publishing.")

        # 5) the ordered apply steps (described, NOT executed).
        owner, repo = self._owner_repo(self._forge_binding(vault, entity) or {})
        repo_name = repo or _workspace.slugify(root.name)
        remote_label = owner and repo and f"{owner}/{repo}" or repo_name
        result["steps"] = [
            {"step": "create-private-repo",
             "detail": "POST /api/v1/user/repos {private: true}",
             "plan": self.create_repo_plan(
                 {"repo": remote_label, "name": repo_name})},
            {"step": "git-remote-add",
             "detail": f"git remote add origin <gitea>/{remote_label}.git"},
            {"step": "initial-push",
             "detail": "git push -u origin HEAD"},
        ]
        result["reason"] = (
            "dry-run plan only -- no repo created, no push executed "
            "(apply is out of scope for 9C)."
        )
        return result

    def _walk_upload_set(self, root: Path):
        """Yield (abs_path, posix_rel) for every file that WOULD upload: a normal
        `git add` staged set, i.e. every file NOT under a PUBLISH_SKIP_DIR.
        Deterministic order (the caller sorts the surfaced lists anyway)."""
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in PUBLISH_SKIP_DIRS]
            for fn in filenames:
                fpath = Path(dirpath) / fn
                try:
                    rel = fpath.relative_to(root).as_posix()
                except ValueError:
                    continue
                yield fpath, rel

    def _scan_secrets(self, fpath: Path, rel: str, size: int) -> Optional[dict]:
        """Scan one file for suspected secrets. A .env(.*) file is flagged by
        NAME (its contents ARE secrets). Otherwise a text file is read and run
        through _SECRET_PATTERNS. Returns {file, kinds:[...]} or None. Binary /
        huge / unreadable files are skipped (no crash)."""
        name = fpath.name
        kinds: list = []
        if _is_env_file(name):
            kinds.append("dotenv-file")
        ext = fpath.suffix.lower()
        scannable = (ext in _TEXT_SCAN_EXTS) or _is_env_file(name)
        if scannable and size <= PUBLISH_LARGE_FILE_BYTES:
            try:
                text = fpath.read_text("utf-8", errors="ignore")
            except OSError:
                text = ""
            for label, pat in _SECRET_PATTERNS:
                if pat.search(text):
                    kinds.append(label)
        if not kinds:
            return None
        # dedupe while preserving order.
        seen: set = set()
        ordered = [k for k in kinds if not (k in seen or seen.add(k))]
        return {"file": rel, "kinds": ordered}

    # --- small helpers (pure) ---------------------------------------------

    def _api_base(self, repo_cfg: dict) -> str:
        """The API base = base_url + /api/v1 (no trailing slash). Empty when the
        binding carries no base_url."""
        if not isinstance(repo_cfg, dict):
            return ""
        base = str(repo_cfg.get("base_url", "") or "").strip().rstrip("/")
        if not base:
            return ""
        return base + GITEA_API_PREFIX

    def _owner_repo(self, repo_cfg: dict):
        """Split `repo: owner/name` into (owner, name). Tolerates a bare name
        (-> (None, name)) and a missing repo (-> (None, None))."""
        if not isinstance(repo_cfg, dict):
            return (None, None)
        repo = str(repo_cfg.get("repo", "") or "").strip().strip("/")
        if not repo:
            return (None, None)
        if "/" in repo:
            owner, name = repo.split("/", 1)
            return (owner.strip() or None, name.strip() or None)
        return (None, repo)

    def _auth_headers(self, token: str) -> dict:
        """The request headers, including `Authorization: token <T>`. The token is
        placed ONLY here (in the header dict the Transport sends) -- it is never
        copied into a URL, an error, or a log (§7.3). TransportError redacts both
        the query string and never echoes headers, so the token cannot leak."""
        return {
            "Authorization": f"token {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    def _raise_for_status(self, method: str, url: str, resp: dict) -> None:
        """Turn a non-2xx response into a structured TransportError (token-free).
        A 401/404 from Gitea thus surfaces as a graceful, redacted error rather
        than a crash, and the token is never in the message."""
        status = resp.get("status") if isinstance(resp, dict) else None
        if status is None:
            raise TransportError(method, url, None, detail="no status in response")
        if 200 <= int(status) < 300:
            return
        raise TransportError(method, url, int(status), detail="gitea api error")

    def _json_array(self, body) -> list:
        """Decode a response body (bytes/str/None) to a JSON array; anything that
        is not a list -> [] (never crash)."""
        if body is None:
            return []
        if isinstance(body, (bytes, bytearray)):
            try:
                body = bytes(body).decode("utf-8")
            except (UnicodeDecodeError, ValueError):
                return []
        if isinstance(body, str):
            try:
                body = json.loads(body) if body.strip() else []
            except ValueError:
                return []
        return body if isinstance(body, list) else []

    def _to_gitea_state(self, canonical_state: Optional[str]) -> str:
        """Map a canonical work state -> a Gitea issue state word. Gitea issues are
        open|closed only: a terminal state (done/canceled) -> 'closed'; every
        active state (backlog/todo/in-progress/blocked) -> 'open'."""
        w = (canonical_state or "").strip().lower()
        return "closed" if w in _GITEA_CLOSED_STATES else "open"

    def _origin_object_id(self, snapshot: dict):
        """The remote issue number this snapshot already maps to, from its
        `origin.object-id` (set when the work item was originally pulled). None ->
        the snapshot has no remote counterpart yet -> push_plan emits a CREATE."""
        if not isinstance(snapshot, dict):
            return None
        # origin may live directly on the snapshot or under its `fields` map
        # (the reviewed-head snapshot carries raw frontmatter under `fields`).
        for container in (snapshot, snapshot.get("fields")):
            if not isinstance(container, dict):
                continue
            origin = container.get("origin")
            if isinstance(origin, dict):
                oid = origin.get("object-id")
                if oid is not None and str(oid).strip():
                    return str(oid).strip()
        return None

    def _snapshot_title(self, snapshot: dict) -> str:
        """The issue title for an outward push: the snapshot's explicit `title`
        field if present, else its entity (a stable, human-readable fallback)."""
        if isinstance(snapshot, dict):
            fields = snapshot.get("fields") if isinstance(snapshot.get("fields"), dict) else {}
            for src in (snapshot, fields):
                t = src.get("title") if isinstance(src, dict) else None
                if isinstance(t, str) and t.strip():
                    return t.strip()
            ent = snapshot.get("entity")
            if isinstance(ent, str) and ent.strip():
                return ent.strip()
        return ""

    def _snapshot_body(self, snapshot: dict) -> str:
        """The issue body for an outward push: the snapshot's `body` if present,
        else empty. (The candidate->reviewed body is the work note prose.)"""
        if isinstance(snapshot, dict):
            for key in ("body",):
                v = snapshot.get(key)
                if isinstance(v, str) and v.strip():
                    return v.strip()
        return ""

    def _forge_binding(self, vault, entity: str) -> Optional[dict]:
        """The project's `forge` binding from forge.json (provider/base_url/repo),
        or None when the project is unbound -- used by publish_plan to name the
        remote it would create."""
        return _provider_repo_cfg(vault, entity)
