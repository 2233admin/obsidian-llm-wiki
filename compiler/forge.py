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
import re as _re
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
                e.read()  # drain the response body; content is discarded (may be token-bearing)
            except Exception:
                pass
            raise TransportError(method, url, e.code,
                                 detail="http error") from None
        except urllib.error.URLError:
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

# The sync-conflict frontmatter marker (PR 9F). A candidate is FLAGGED with
# `conflict: true` when BOTH the remote item AND the local reviewed head diverged
# independently since the last sync (detect_sync_conflict). The flag is the SAME
# spelling work_protocol.classify_triage looks for to route the candidate into the
# 8D `_triage` Conflicts section instead of Pending Review -- it is NEVER silently
# overwritten into current-truth; a human must reconcile via triage/promote.
F_SYNC_CONFLICT = "conflict"
# the two revisions a conflict candidate also records, so the human reviewer sees
# exactly which local + remote versions diverged (neither is a secret).
F_CONFLICT_LOCAL_REVISION = "conflict-local-revision"
F_CONFLICT_REMOTE_REVISION = "conflict-remote-revision"


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
                             today: Optional[str] = None,
                             conflict: Optional[dict] = None) -> dict:
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

    `conflict` (PR 9F): when the caller (sync_pull, via detect_sync_conflict) has
    determined BOTH sides diverged since the last sync, it passes
    {"local_revision": R, "remote_revision": R, "reason": ...}. The candidate is
    STILL a status:draft (never an overwrite) but is FLAGGED `conflict: true` +
    both revisions, so classify_triage routes it to the `_triage` Conflicts
    section. None / falsy -> a normal Pending-Review candidate.

    Returns {note_id_hint, text, entity, state, origin, base_head, conflict} --
    text is the rendered note (LF-only); note_id_hint is the append-only filename
    the writer will use.
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
        provider=provider, today=today, title=item.title, conflict=conflict,
    )

    note_id_hint = f"{_sync_writer_dir(provider)}/{today}-{_safe_segment(item.object_id, 'item')}.md"
    return {
        "note_id_hint": note_id_hint,
        "text": text,
        "entity": entity or None,
        "state": state,
        "origin": origin,
        "base_head": base_head,
        "conflict": dict(conflict) if conflict else None,
    }


def _render_candidate(entity: str, state: str, origin: dict,
                      base_head: Optional[str], provider: str, today: str,
                      title: str, conflict: Optional[dict] = None) -> str:
    """Serialize a draft candidate note (LF-only, deterministic field order). The
    `origin:` block is a nested YAML map (the Task 8 reserved provenance field);
    `generated-by: sync/<provider>` marks this as a sync-written capture, distinct
    from an agent capture (`generated-by: <machine>-<agent>`).

    `conflict` (PR 9F): when present, the candidate is FLAGGED `conflict: true` +
    both diverged revisions, so classify_triage routes it to Conflicts. It stays a
    status:draft -- the flag NEVER converts it into a current-truth overwrite."""
    lines = ["---"]
    lines.append(f"{_work_protocol.F_TYPE}: {_work_protocol.TYPE_ISSUE}")
    if entity:
        lines.append(f"{_work_protocol.F_ENTITY}: {entity}")
    lines.append(f"{_currency.F_STATE}: {state}")
    # status:draft is the REVIEW axis and is ALWAYS draft on a capture -- a remote
    # pull is a proposal, never self-reviewed (8P / §0 #11).
    lines.append(f"{_work_protocol.F_STATUS}: {_work_protocol.STATUS_DRAFT}")
    # conflict flag (PR 9F): a candidate whose remote AND local both diverged since
    # the last sync. status stays draft -- the flag only ROUTES it to Conflicts; it
    # is never silently merged into current-truth.
    if conflict:
        lines.append(f"{F_SYNC_CONFLICT}: true")
        if conflict.get("local_revision") is not None:
            lines.append(
                f"{F_CONFLICT_LOCAL_REVISION}: {conflict['local_revision']}")
        if conflict.get("remote_revision") is not None:
            lines.append(
                f"{F_CONFLICT_REMOTE_REVISION}: {conflict['remote_revision']}")
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


# === conflict detection (PR 9F -- mirrors 8P HEAD_MISMATCH philosophy) =======
#
# A reconciliation conflict is the federation analogue of 8P's HEAD_MISMATCH: an
# incoming remote change collides with a LOCAL reviewed head that ALSO moved since
# the two were last in sync. We never silently last-write-wins; the candidate is
# written status:draft but FLAGGED so it lands in `_triage` Conflicts and a human
# reconciles it through promote (§0 #11/#12).


def detect_sync_conflict(local_head_snapshot: Optional[dict],
                         remote_item: RemoteItem,
                         remote_provider: str = ""):
    """Decide whether an incoming `remote_item` CONFLICTS with the entity's local
    reviewed head (`local_head_snapshot` from _reviewed_head_snapshot).

    Returns (is_conflict: bool, info: dict|None). `info`, when a conflict, carries
    {local_revision, remote_revision, reason} for the candidate flag + the triage
    explanation. NO token / secret is ever read here -- only revision tokens and
    the canonical work state.

    `remote_provider`, when supplied by the caller (sync_pull knows the bound
    provider name), is compared against the head's origin.provider so the
    "same synced pair" identity is provider+object-id, not object-id alone --
    defense-in-depth against two forges that happen to issue the same id string
    (an over-flag at worst routes a benign change to triage, never an overwrite).

    SCOPE NOTE (finding 9F#2): the conflict signal is the canonical 5-STATE only.
    A divergence that touches title/body but lands on the SAME canonical state
    (or where both sides independently converge on one final state) is NOT flagged
    here -- title/body are last-writer-wins on the federated text fields. This is
    a deliberate design limit (the §7 rule is "states DISAGREE"); the §0 #4
    no-current-truth-overwrite guarantee holds for work STATE, not free text.

    The conflict rule (§7 / mirrors 8P): a conflict requires BOTH sides to have
    diverged independently since the last sync. Concretely, ALL of:
      1. there IS a local reviewed head for the entity, and it carries an
         `origin` from the SAME provider+object as the remote item (so the two are
         the two ends of one synced pair -- a head with no origin, or an origin
         pointing at a different provider/object, is not the same object and so is
         NOT a conflict, just a fresh candidate);
      2. the remote revision R_remote differs from the head's recorded
         origin.revision R_local (the remote moved since the last sync);
      3. the local head ALSO moved since that sync -- detected because the head's
         CURRENT canonical work state no longer equals the state the last-synced
         remote revision would have produced (map_remote_state(remote.state)). In
         other words local truth and remote truth now DISAGREE on state, which can
         only happen if a local edit (promote) changed the head after the sync.

    The simple cases are NOT conflicts (return (False, None)):
      * no local head, or the head is not the same synced object  -> fresh
        candidate (Pending Review);
      * remote moved but the local head state still matches the remote-mapped
        state -> a benign remote-only change (Pending Review);
      * (the reverse -- local moved, remote unchanged -- is not even seen here: a
        remote_item with the SAME revision is a no-op pull; sync_apply pushes the
        local change).
    """
    if not isinstance(local_head_snapshot, dict):
        return (False, None)

    origin = _snapshot_origin(local_head_snapshot)
    if not isinstance(origin, dict):
        return (False, None)

    # (1) same synced object? provider + object-id must match the remote item.
    local_provider = str(origin.get("provider") or "").strip().lower()
    # the RemoteItem is provider-agnostic, but the caller (sync_pull) knows which
    # provider it pulled from -- thread it in so the same-pair check is
    # provider+object-id, not object-id alone.
    remote_provider = str(remote_provider or "").strip().lower()
    local_object_id = origin.get("object-id")
    if local_object_id is None or str(local_object_id).strip() == "":
        return (False, None)
    if str(local_object_id).strip() != str(remote_item.object_id).strip():
        return (False, None)
    # provider, when both known, must agree (a head synced from gitea is not the
    # same object as a github issue that happens to share a number).
    if local_provider and remote_provider and local_provider != remote_provider:
        return (False, None)

    # (2) did the remote move since the last sync?
    local_revision = origin.get("revision")
    remote_revision = remote_item.revision
    lr = (str(local_revision).strip() if local_revision is not None else "")
    rr = (str(remote_revision).strip() if remote_revision is not None else "")
    if not rr or rr == lr:
        # remote unchanged since last sync -> nothing new from remote -> no
        # conflict (sync_apply pushes any local change instead).
        return (False, None)

    # (3) did the local head ALSO move since the last sync? The head's current
    # canonical state must DIFFER from the state the incoming remote maps to. If
    # they still agree, only the remote moved (benign) -> Pending Review.
    local_state = str(local_head_snapshot.get("state") or "").strip().lower()
    remote_state = map_remote_state(remote_item.state)
    if not local_state or local_state == remote_state:
        return (False, None)

    reason = (
        f"sync conflict: remote {origin.get('provider')}#{remote_item.object_id} "
        f"moved (revision {lr or '?'} -> {rr}) while the local reviewed head "
        f"diverged (local state {local_state!r} != remote-proposed "
        f"{remote_state!r}); reconcile via triage/promote, no overwrite."
    )
    return (True, {
        "local_revision": lr or None,
        "remote_revision": rr,
        "local_state": local_state,
        "remote_state": remote_state,
        "reason": reason,
    })


def _snapshot_origin(snapshot: dict) -> Optional[dict]:
    """The `origin` provenance map from a reviewed-head snapshot. It may sit
    directly on the snapshot or under its `fields` map (the reviewed-head snapshot
    carries raw frontmatter under `fields`). None when absent."""
    if not isinstance(snapshot, dict):
        return None
    for container in (snapshot, snapshot.get("fields")):
        if isinstance(container, dict):
            origin = container.get("origin")
            if isinstance(origin, dict):
                return origin
    return None


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


def _reviewed_snapshot_resolver(vault) -> Callable:
    """Build a reviewed-head SNAPSHOT resolver bound to ONE vault scan: entity ->
    the {entity, note_id, state, status, fields} snapshot of the entity's
    authoritative (reviewed/legacy) head, or None. Reused by sync_pull's conflict
    detection so N remote items share a single scan (and never re-walk per item).
    Mirrors _reviewed_head_snapshot but closes over the scanned notes."""
    notes = _work_protocol.scan_work_notes(vault)

    def _resolve(entity: str) -> Optional[dict]:
        res = _work_protocol.resolve_head(notes, entity)
        if res.head is None:
            return None
        head = res.head
        return {
            "entity": entity,
            "note_id": head.note_id,
            "state": _currency.work_state(head.cm),
            "status": head.status,
            "fields": dict(head.raw),
        }

    return _resolve


# === provider registry (name -> default adapter instance) ===================
#
# The single place the three concrete adapters are wired by name, so sync_pull /
# sync_plan / sync_apply (and the CLI) pick the right one without each caller
# re-listing them. Tests INJECT their own {name: provider} map (FakeProvider) and
# never touch this -- it is only the production default.

def default_providers() -> dict:
    """provider-name -> a default Provider instance (the concrete adapter). Used by
    the CLI for the real run; tests pass their own injected map instead."""
    return {
        PROVIDER_GITEA: GiteaAdapter(),
        PROVIDER_GITHUB: GitHubAdapter(),
        PROVIDER_LINEAR: LinearAdapter(),
    }


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


def sync_pull(vault, transport: Transport, providers: Optional[dict] = None,
              apply: bool = False, today: Optional[str] = None) -> dict:
    """Pull EVERY bound project's remote items into draft candidates -- the inward
    half of reconciliation (PR 9F). For each project in forge.json with a `forge`
    (and/or `primary_board`):

      * call the bound provider's pull() -> RemoteItems -> status:draft candidates
        (via remote_item_to_candidate), AND
      * for a provider exposing pull_evidence() (GitHub), ALSO pull merged-PR
        EVIDENCE and write those as `suggested-state` candidates (never `state`),
        into the SAME sync inbox -- this wires the 9D deferred evidence path.

    CONFLICT-AWARE (the heart of 9F): before stamping each remote ISSUE candidate,
    detect_sync_conflict compares the incoming remote revision/state against the
    entity's local REVIEWED head. When BOTH diverged since the last sync the
    candidate is FLAGGED `conflict: true` (still status:draft) so classify_triage
    routes it to `_triage` Conflicts -- current-truth is NEVER overwritten.

    DRY-RUN by default (§0 #5): apply=False writes NOTHING and returns the plan
    (which candidates WOULD be written); apply=True writes them append-only, LF.
    PER-PROJECT errors are CAUGHT and reported (`errors: [...]`), never aborting the
    whole run. The token (from the env via token_for) is NEVER placed into the
    result -- only provider names, candidate texts, and redacted transport errors.

    `providers` maps provider-name -> Provider (injected; tests pass FakeProvider).
    Returns {apply, providers: [...], projects: [...], candidates: [...],
    evidence: [...], written: [...], conflicts: [...], errors: [...]}.
    """
    from datetime import date as _date

    today = today or _date.today().isoformat()
    providers = providers if providers is not None else default_providers()

    out = {
        "apply": apply,
        "providers": [],
        "projects": [],
        "candidates": [],
        "evidence": [],
        "written": [],
        "conflicts": [],
        "errors": [],
    }

    base_head_resolver = _default_base_head_resolver(vault)
    snapshot_resolver = _reviewed_snapshot_resolver(vault)
    seen_providers: set = set()

    for entity, pc in sorted(project_configs(vault).items()):
        if not isinstance(pc, dict):
            continue
        # the inward (read) side reads from EVERY declared path -- the forge and
        # the primary-board (a mirror is read-only too, but mirrors are not pulled
        # as work candidates here; only the forge + primary-board carry issues).
        for target_key in ("forge", "primary_board"):
            binding = pc.get(target_key)
            if not isinstance(binding, dict):
                continue
            prov_name = binding.get("provider")
            if not prov_name:
                continue
            seen_providers.add(prov_name)
            out["projects"].append({"entity": entity, "target": target_key,
                                    "provider": prov_name})

            token = token_for(prov_name)
            if token is None:
                # graceful "not configured" -- record + skip, never crash (§7.3).
                out["errors"].append({
                    "project": entity, "provider": prov_name,
                    "error": (f"no token for {prov_name} "
                              f"(set {TOKEN_ENV.get(prov_name, 'its token env var')}); "
                              "nothing pulled."),
                })
                continue

            provider = providers.get(prov_name)
            if provider is None:
                out["errors"].append({
                    "project": entity, "provider": prov_name,
                    "error": f"no provider implementation for {prov_name}.",
                })
                continue

            # --- inward issues -> candidates (conflict-aware) ----------------
            try:
                items = provider.pull(binding, transport, token)
            except TransportError as e:
                # a remote failure for one project must not abort the others; the
                # redacted error carries method/url/status only (never the token).
                out["errors"].append({"project": entity, "provider": prov_name,
                                      "error": str(e)})
                items = None
            except Exception as e:  # any provider bug, isolated per project.
                out["errors"].append({"project": entity, "provider": prov_name,
                                      "error": f"pull failed: {e}"})
                items = None

            for item in items or []:
                if not item.entity_hint:
                    item.entity_hint = entity
                local_snap = snapshot_resolver(item.entity_hint)
                is_conflict, info = detect_sync_conflict(
                    local_snap, item, remote_provider=prov_name)
                cand = remote_item_to_candidate(
                    item, vault, prov_name,
                    base_head_resolver=base_head_resolver, today=today,
                    conflict=info if is_conflict else None)
                out["candidates"].append(cand)
                if is_conflict:
                    out["conflicts"].append({
                        "entity": cand["entity"], "provider": prov_name,
                        "object_id": item.object_id,
                        "reason": info.get("reason") if info else "",
                    })

            # --- inward merged-PR EVIDENCE -> suggested-state candidates -----
            # only providers exposing pull_evidence (GitHub) contribute here; this
            # wires the 9D deferred evidence path through reconciliation.
            if hasattr(provider, "pull_evidence") and hasattr(
                    provider, "evidence_to_candidate"):
                try:
                    ev_items = provider.pull_evidence(binding, transport, token)
                except TransportError as e:
                    out["errors"].append({"project": entity,
                                          "provider": prov_name,
                                          "error": str(e)})
                    ev_items = None
                except Exception as e:
                    out["errors"].append({"project": entity,
                                          "provider": prov_name,
                                          "error": f"pull_evidence failed: {e}"})
                    ev_items = None
                for ev in ev_items or []:
                    if not ev.entity_hint:
                        ev.entity_hint = entity
                    ev_cand = provider.evidence_to_candidate(
                        ev, vault, base_head_resolver=base_head_resolver,
                        today=today)
                    out["evidence"].append(ev_cand)

    out["providers"] = sorted(seen_providers)

    if not apply:
        return out

    # apply: append-only writes for BOTH issue candidates and evidence candidates,
    # under the per-provider inbox dir, LF bytes (the same writer as 9C).
    written: list[str] = []
    for cand in out["candidates"] + out["evidence"]:
        path = _write_candidate_append_only(
            vault, cand["note_id_hint"], cand["text"])
        if path is not None:
            written.append(path.as_posix())
    out["written"] = written
    return out


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
                "binding": binding,
                "payload": payload,
            })
        out["projects"].append(entry)
    return out


def _conflicted_entities(vault, today: Optional[str] = None) -> set:
    """The set of entities that currently have an UNRESOLVED conflict in `_triage`
    Conflicts (PR 9F). sync_apply skips PUSHING these -- a known conflict must be
    reconciled via triage/promote first, never blindly overwritten outward (§0 #12
    / mirrors 8P). Reuses work_protocol.classify_triage so the conflict notion is
    the single 8D one (multi-head / stale base-head / competing / sync-conflict),
    never re-implemented here."""
    out: set = set()
    try:
        items = _work_protocol.classify_triage(vault, today=today)
    except Exception:
        return out
    for it in items:
        if getattr(it, "section", None) == _work_protocol.TRIAGE_CONFLICTS \
                and getattr(it, "entity", None):
            out.add(it.entity)
    return out


def _entity_has_conflict(config_entity: str, conflicted: set) -> bool:
    """Does a forge-config key `config_entity` have an unresolved conflict to gate
    on (PR 9F#3)? True when the key is itself a conflicted entity OR is a PREFIX of
    a conflicted entity (a per-issue conflict candidate -- entity_hint
    `project/<slug>/issue/<n>` -- lives UNDER a project-level config key
    `project/<slug>`). Prefix-aware so a project-level forge.json key still gates
    the push when ANY descendant issue is conflicted. This only ever WIDENS the
    skip (the conservative direction -- a known conflict is never overwritten)."""
    if not config_entity:
        return False
    if config_entity in conflicted:
        return True
    prefix = config_entity.rstrip("/") + "/"
    return any(c == config_entity or c.startswith(prefix) for c in conflicted)


def sync_apply(vault, transport: Transport, providers: Optional[dict] = None,
               apply: bool = False, today: Optional[str] = None) -> dict:
    """Apply the outward projection -- the push half of reconciliation (PR 9F).

    DRY-RUN by default (§7 / §0 #5): apply=False is exactly sync_plan with
    {pushed: False} markers (NO network write). apply=True is GATED and, in order:
      1. the anti-loop guard (assert_single_bidirectional, via sync_plan) has
         ALREADY refused any project with a second bidirectional write path
         (§0 #10) -- such a project is `refused`, never pushed;
      2. a project whose entity has an UNRESOLVED conflict in `_triage` Conflicts
         is SKIPPED (a known conflict must be reconciled via triage/promote first,
         never blindly overwritten -- §0 #12);
      3. each remaining rw-target's push_plan is EXECUTED via the provider's
         execute_push (the real POST/PATCH/GraphQL mutation) through the INJECTED
         transport. A target with no token / no provider is recorded
         not-configured, never crashing.

    The token is read from the env per provider (token_for) and passed ONLY into
    execute_push (which places it in a header, never the URL/record). It is NEVER
    written into this result.

    Returns {apply, projects: [...], conflicts: [...], skipped: [...]} where each
    project's `pushed` lists per-target {executed/pushed, method, ...} records."""
    providers = providers if providers is not None else default_providers()
    plan = sync_plan(vault, transport, providers=providers)
    conflicted = _conflicted_entities(vault, today=today) if apply else set()
    out = {"apply": apply, "projects": [], "conflicts": plan["conflicts"],
           "skipped": []}
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
        # CONFLICT GATE: a known unresolved conflict for this entity is NOT pushed.
        if apply and _entity_has_conflict(entry["entity"], conflicted):
            proj["skipped"] = "unresolved conflict in _triage; reconcile first."
            out["skipped"].append({"entity": entry["entity"],
                                   "reason": proj["skipped"]})
            out["projects"].append(proj)
            continue
        for p in entry["payloads"]:
            prov_name = p["provider"]
            provider = providers.get(prov_name)
            record = {
                "target": p["target"],
                "provider": prov_name,
                "configured": p["configured"],
                "pushed": False,
                "payload": p["payload"],
            }
            if not apply:
                # dry-run: the planned push, never executed.
                proj["pushed"].append(record)
                continue
            token = token_for(prov_name)
            if provider is None or token is None or not isinstance(
                    p["payload"], dict) or p["payload"].get("error"):
                # not configured / no provider / a failed push_plan -> do NOT push.
                record["reason"] = ("not configured" if token is None
                                    else "no provider / unbuildable payload")
                proj["pushed"].append(record)
                continue
            try:
                res = provider.execute_push(
                    p["payload"], p.get("binding") or {}, transport, token)
            except TransportError as e:
                # a redacted, token-free error -- one target's failure must not
                # abort the others.
                record["error"] = str(e)
                proj["pushed"].append(record)
                continue
            except Exception as e:
                record["error"] = f"execute_push failed: {e}"
                proj["pushed"].append(record)
                continue
            record["pushed"] = bool(res.get("executed"))
            record["executed"] = res
            proj["pushed"].append(record)
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
# silently uploads). (_re imported at module top.)
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

    def execute_push(self, plan: dict, repo_cfg: dict, transport: Transport,
                     token: Optional[str]) -> dict:
        """EXECUTE a push_plan against Gitea (PR 9F apply path). Issues the
        plan's POST (create) or PATCH (update) to {base_url}/api/v1{endpoint} with
        the JSON payload, through the INJECTED transport (so a test records it with
        a FakeTransport and never hits a live API). The token rides ONLY in the
        Authorization header -- never the URL, never the returned record.

        Returns {executed, method, url, object_id, entity, status} -- the `url` is
        REDACTED of any query/fragment, and the record carries NO header/token.
        token=None -> {executed: False, reason: not configured} (never crash)."""
        if not token:
            return {"executed": False, "entity": plan.get("entity"),
                    "method": plan.get("method"), "reason": "not configured"}
        base = self._api_base(repo_cfg)
        method = plan.get("method", "POST")
        url = f"{base}{plan.get('endpoint', '')}"
        body = json.dumps(plan.get("payload") or {}).encode("utf-8")
        resp = transport.request(method, url, headers=self._auth_headers(token),
                                 body=body)
        self._raise_for_status(method, url, resp)
        return {
            "executed": True,
            "method": method,
            "url": _redact_url(url),
            "object_id": plan.get("object_id"),
            "entity": plan.get("entity"),
            "status": resp.get("status") if isinstance(resp, dict) else None,
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
        `origin.object-id` -- but ONLY when origin.provider is gitea (a snapshot
        whose origin points at a DIFFERENT provider has no Gitea counterpart, so
        a push to gitea CREATES rather than PATCHing a foreign id). None ->
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
                prov = str(origin.get("provider") or "").strip().lower()
                if prov and prov != self.name:
                    # origin is a different forge -> no Gitea issue yet -> CREATE.
                    return None
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


# ===========================================================================
# Task 9 / PR 9D: the GITHUB ADAPTER
# ===========================================================================
#
# The second concrete Provider on top of the 9C scaffolding. It speaks the GitHub
# Issues REST API through the INJECTED Transport, so a test drives it with a
# FakeTransport + recorded GitHub JSON and NEVER hits a live API (§7.2 / §7.7).
#
# Locked design (TASK9 §7 -- mirrors GiteaAdapter EXACTLY; do NOT deviate):
#   * zero-dep stdlib only -- HTTP goes through the injected Transport
#     (urllib.request under the hood); NO requests / NO httpx.
#   * pull-only -- one-shot API client; NO webhook receiver, NO daemon (§0 #11).
#     pull() reads issues; push_plan() returns a PAYLOAD only (never a write).
#   * token from the ENVIRONMENT (GITHUB_TOKEN), passed in as `token`; it is sent
#     in the `Authorization: Bearer <T>` header ONLY and is NEVER logged / never
#     put in a URL / error / candidate (the structured error carries
#     method/url/status only).
#   * a remote issue -> a status:draft candidate stamped with
#     origin:{provider,object-id,revision,actor} + base-head (via the shared
#     remote_item_to_candidate); code activity is EVIDENCE ONLY (§0 #12) -- a
#     pulled "closed" issue is a PROPOSAL, never an auto-close, and a MERGED PR
#     becomes a `suggested-state` candidate (NOT a direct state:done), so it still
#     flows through triage/promote.
#   * a GitHub issues payload ALSO carries pull requests (each PR object has a
#     `pull_request` key); those are DROPPED from pull() -- PRs are evidence, not
#     work issues -- and surfaced only via the explicit pull_evidence() path.
#   * dry-run is the DEFAULT for any write/push -- push_plan is a PLAN only.
#
# DEFERRED FOLLOW-UP (out of scope for 9D): GitHub Projects V2 (the GraphQL board
# API). 9D is Issues REST + PR-evidence only; a Projects-V2 board adapter would
# land as a separate primary-board provider on top of this same seam.

GITHUB_API_BASE = "https://api.github.com"
GITHUB_API_VERSION = "2022-11-28"

# Defensive pagination cap: never loop unboundedly against a remote (a misbehaving
# server, or a never-shrinking page, must not hang the pull). GitHub's max page
# size is 100; this caps total pages, so at most GITHUB_PAGE_CAP * limit issues.
GITHUB_PAGE_CAP = 20
GITHUB_PAGE_LIMIT = 100

# GitHub issue state words: open|closed. A closed issue carries a `state_reason`
# of 'completed' or 'not_planned' (or null) -- 'not_planned' means the work was
# DROPPED, so it maps to canceled (not done). The shared map_remote_state already
# turns the raw word through currency.work_state (open->todo, closed->done,
# canceled->canceled); the adapter pre-resolves the RAW word it feeds the stamper.
GITHUB_STATE_NOT_PLANNED = "not_planned"

# For the OUTWARD direction (push_plan) a canonical work state maps BACK to a
# GitHub issue state + state_reason: GitHub issues are open|closed only.
#   done     -> closed, state_reason: completed
#   canceled -> closed, state_reason: not_planned
#   active   -> open,   state_reason: null
_GITHUB_CLOSED_STATES = frozenset({_currency.STATE_DONE, _currency.STATE_CANCELED})


class GitHubAdapter(Provider):
    """The GitHub Provider (§7 / PR 9D). Reads issues into RemoteItems via the
    injected Transport, drops pull requests (PRs are evidence, surfaced only via
    pull_evidence), and builds (but never executes) the push payload for the
    outward direction. The actual network WRITE is apply-only and out of scope for
    this PR -- the payload/plan is the deliverable (dry-run by default).
    """

    name = PROVIDER_GITHUB

    # --- inward: pull issues -> RemoteItems --------------------------------

    def pull(self, repo_cfg: dict, transport: Transport,
             token: Optional[str]) -> list:
        """GET /repos/{owner}/{repo}/issues?state=all&per_page=100 -> [RemoteItem].

        A GitHub issues payload INCLUDES pull requests (each PR object carries a
        `pull_request` key); those are DROPPED here -- PRs are 9D evidence, not
        work candidates (§0 #12). Each real issue becomes a RemoteItem(kind=
        'issue', object_id=number, revision=updated_at, actor=user.login, title,
        state, entity_hint='project/<slug>/issue/<number>'). A closed issue whose
        state_reason is 'not_planned' is mapped to the raw word 'canceled' (so the
        shared stamper proposes canceled, not done). Paginated DEFENSIVELY (capped
        pages; stops on a short / empty page).

        Token=None -> [] (graceful; never crash). A 401/403/404/non-2xx is
        surfaced as a structured TransportError WHOSE TEXT NEVER carries the token
        (method/url/status only). The caller (pull_to_candidates) catches it
        per-project; we let it propagate.
        """
        if not token:
            return []
        owner, repo = self._owner_repo(repo_cfg)
        if not owner or not repo:
            return []
        slug = _safe_segment(repo, "repo")
        headers = self._auth_headers(token)

        items: list = []
        seen_ids: set = set()
        for page in range(1, GITHUB_PAGE_CAP + 1):
            url = (f"{GITHUB_API_BASE}/repos/{owner}/{repo}/issues"
                   f"?state=all&per_page={GITHUB_PAGE_LIMIT}&page={page}")
            resp = transport.request("GET", url, headers=headers)
            self._raise_for_status("GET", url, resp)
            page_raw = self._json_array(resp.get("body"))
            if not page_raw:
                break  # empty page -> done.
            new_this_page = 0
            for raw in page_raw:
                it = self._issue_to_item(raw, slug)
                if it is None:
                    continue  # a PR / malformed entry -> not a work issue here.
                if it.object_id in seen_ids:
                    continue  # defensive: a repeated page can't loop us.
                seen_ids.add(it.object_id)
                items.append(it)
                new_this_page += 1
            # a short page (fewer than the limit) means the last page is reached.
            # new_this_page can be 0 on a page that is ALL PRs, so the short-page
            # length check (not new_this_page) decides termination.
            if len(page_raw) < GITHUB_PAGE_LIMIT:
                break
        return items

    def _issue_to_item(self, raw, slug: str) -> Optional[RemoteItem]:
        """Map ONE GitHub issue JSON object to a RemoteItem, or None when it is a
        pull request (carries a `pull_request` key) or is malformed. A closed
        issue with state_reason 'not_planned' is mapped to the raw word 'canceled'
        so the shared stamper proposes canceled (the work was dropped), not done.
        """
        if not isinstance(raw, dict):
            return None
        if raw.get("pull_request") is not None:
            # a PR, not an issue -> evidence (pull_evidence), not a work candidate.
            return None
        number = raw.get("number")
        if number is None:
            return None
        object_id = str(number)
        user = raw.get("user")
        actor = user.get("login") if isinstance(user, dict) else None
        state = raw.get("state")
        # a closed+not_planned issue is a CANCEL, not a completion.
        if (str(state or "").strip().lower() == "closed"
                and str(raw.get("state_reason") or "").strip().lower()
                == GITHUB_STATE_NOT_PLANNED):
            state = _currency.STATE_CANCELED
        return RemoteItem(
            kind="issue",
            object_id=object_id,
            revision=raw.get("updated_at"),
            actor=actor,
            title=raw.get("title", "") or "",
            state=state,
            entity_hint=f"project/{slug}/issue/{object_id}",
            raw=raw,
        )

    # --- inward: merged PRs -> EVIDENCE (suggested-state, never state) ------

    def pull_evidence(self, repo_cfg: dict, transport: Transport,
                      token: Optional[str]) -> list:
        """GET /repos/{owner}/{repo}/pulls?state=all -> [RemoteItem] of MERGED PRs
        as EVIDENCE only (§0 #12). A merged PR is code activity: it at most
        SUGGESTS a 'done' state -- it NEVER auto-closes a work item. Each merged PR
        becomes a RemoteItem with kind='pull-request' and state set to a special
        'suggested-state' sentinel carried in `raw` so evidence_to_candidate emits
        a `suggested-state: done` + an evidence ref (github:pr/<n>), NOT a direct
        state:done. An UNMERGED / open PR yields NOTHING (no suggestion).

        Token=None -> [] (graceful). Errors propagate as a redacted TransportError.
        """
        if not token:
            return []
        owner, repo = self._owner_repo(repo_cfg)
        if not owner or not repo:
            return []
        slug = _safe_segment(repo, "repo")
        headers = self._auth_headers(token)

        items: list = []
        seen_ids: set = set()
        for page in range(1, GITHUB_PAGE_CAP + 1):
            url = (f"{GITHUB_API_BASE}/repos/{owner}/{repo}/pulls"
                   f"?state=all&per_page={GITHUB_PAGE_LIMIT}&page={page}")
            resp = transport.request("GET", url, headers=headers)
            self._raise_for_status("GET", url, resp)
            page_raw = self._json_array(resp.get("body"))
            if not page_raw:
                break
            for raw in page_raw:
                it = self._pr_to_evidence(raw, slug)
                if it is None:
                    continue  # not merged -> no suggestion.
                if it.object_id in seen_ids:
                    continue
                seen_ids.add(it.object_id)
                items.append(it)
            if len(page_raw) < GITHUB_PAGE_LIMIT:
                break
        return items

    def _pr_to_evidence(self, raw, slug: str) -> Optional[RemoteItem]:
        """Map ONE GitHub PR JSON to an EVIDENCE RemoteItem, or None when the PR is
        not merged. A merged PR carries a truthy `merged_at` (or merged=True). The
        item's `raw` is flagged so evidence_to_candidate renders a suggested-state
        (NOT a state). entity_hint targets the PR's number under the repo slug."""
        if not isinstance(raw, dict):
            return None
        merged = bool(raw.get("merged_at")) or bool(raw.get("merged"))
        if not merged:
            return None
        number = raw.get("number")
        if number is None:
            return None
        object_id = str(number)
        user = raw.get("user")
        actor = user.get("login") if isinstance(user, dict) else None
        return RemoteItem(
            kind="pull-request",
            object_id=object_id,
            revision=raw.get("updated_at") or raw.get("merged_at"),
            actor=actor,
            title=raw.get("title", "") or "",
            # NOT a work state: the sentinel is carried so evidence_to_candidate
            # emits suggested-state, never a direct state. state stays None so a
            # naive consumer can't read it as a closing state.
            state=None,
            entity_hint=f"project/{slug}/pr/{object_id}",
            raw={"_evidence": True, "pr_number": object_id, **(raw if isinstance(raw, dict) else {})},
        )

    def evidence_to_candidate(self, item: RemoteItem, vault, *,
                              base_head_resolver: Optional[Callable] = None,
                              today: Optional[str] = None) -> dict:
        """Build a `status: draft` candidate from a merged-PR EVIDENCE RemoteItem.

        CRITICAL (§0 #12): the candidate carries a `suggested-state: done` PLUS an
        `evidence:` ref (github:pr/<n>) -- it does NOT carry a direct `state: done`.
        A merged PR is code activity that SUGGESTS the work is done; the human 8D
        triage / 8P promote (the PR gate) decides whether to actually close it.
        This keeps the never-auto-close invariant: evidence flows through review.

        Returns {note_id_hint, text, entity, suggested_state, evidence, origin}.
        """
        from datetime import date as _date

        today = today or _date.today().isoformat()
        entity = (item.entity_hint or "").strip()
        base_head = None
        if entity and base_head_resolver is not None:
            try:
                resolved = base_head_resolver(entity)
            except Exception:
                resolved = None
            if isinstance(resolved, str) and resolved.strip():
                base_head = resolved.strip()

        pr_number = item.object_id
        evidence_ref = f"{self.name}:pr/{pr_number}"
        origin = {
            "provider": self.name,
            "object-id": pr_number,
            "revision": item.revision,
            "actor": item.actor,
        }

        text = self._render_evidence_candidate(
            entity=entity, origin=origin, base_head=base_head,
            evidence_ref=evidence_ref, today=today, title=item.title)

        note_id_hint = (f"{_sync_writer_dir(self.name)}/"
                        f"{today}-pr-{_safe_segment(pr_number, 'pr')}.md")
        return {
            "note_id_hint": note_id_hint,
            "text": text,
            "entity": entity or None,
            "suggested_state": _currency.STATE_DONE,
            "evidence": evidence_ref,
            "origin": origin,
            "base_head": base_head,
        }

    def _render_evidence_candidate(self, entity: str, origin: dict,
                                   base_head: Optional[str], evidence_ref: str,
                                   today: str, title: str) -> str:
        """Serialize a merged-PR evidence candidate note (LF-only). It carries
        `suggested-state: done` + `evidence: github:pr/<n>` instead of a direct
        `state:` -- so it never auto-closes; it must go through triage/promote.
        NO top-level `state:` field is emitted (a merged PR only SUGGESTS done)."""
        lines = ["---"]
        lines.append(f"{_work_protocol.F_TYPE}: {_work_protocol.TYPE_ISSUE}")
        if entity:
            lines.append(f"{_work_protocol.F_ENTITY}: {entity}")
        # NO `state:` -- evidence only SUGGESTS a state (it never sets one).
        lines.append(f"suggested-state: {_currency.STATE_DONE}")
        lines.append(f"evidence: {evidence_ref}")
        lines.append(f"{_work_protocol.F_STATUS}: {_work_protocol.STATUS_DRAFT}")
        lines.append("origin:")
        lines.append(f"  provider: {origin.get('provider')}")
        if origin.get("object-id") is not None:
            lines.append(f"  object-id: {origin['object-id']}")
        if origin.get("revision") is not None:
            lines.append(f"  revision: {origin['revision']}")
        if origin.get("actor") is not None:
            lines.append(f"  actor: {origin['actor']}")
        if base_head:
            lines.append(f"{_work_protocol.F_BASE_HEAD}: {base_head}")
        lines.append(f"{_work_protocol.F_GENERATED_BY}: sync/{self.name}")
        lines.append(f"{_currency.F_LAST_VERIFIED}: {today}")
        lines.append("---")
        text = "\n".join(lines) + "\n"
        body = _sanitize_remote_body(title)
        if body:
            text += "\n" + body + "\n"
        return text

    # --- outward: reviewed snapshot -> push payload (PLAN only) ------------

    def push_plan(self, snapshot: dict, repo_cfg: dict) -> dict:
        """Build the GitHub issue payload that WOULD project a REVIEWED snapshot
        outward (§7 / PR 9D). PURE -- NO network here (the actual POST/PATCH lands
        in a later apply path; the payload is the seam).

        Method:
          * a NEW issue (no origin.object-id, OR an origin from a DIFFERENT
            provider) -> POST /repos/{owner}/{repo}/issues, body {title, body}.
          * an UPDATE (origin.object-id present AND origin.provider == 'github') ->
            PATCH /repos/{owner}/{repo}/issues/{number}, body
            {title, body, state, state_reason}.

        State mapping (GitHub issues are open|closed):
          done     -> state: closed, state_reason: completed
          canceled -> state: closed, state_reason: not_planned
          active   -> state: open,   state_reason: null
        """
        owner, repo = self._owner_repo(repo_cfg)
        canonical = snapshot.get("state")
        gh_state, gh_reason = self._to_github_state(canonical)
        title = self._snapshot_title(snapshot)
        body = self._snapshot_body(snapshot)

        object_id = self._origin_object_id(snapshot)
        if object_id is not None:
            # UPDATE an existing GitHub issue -> PATCH at the numbered endpoint.
            return {
                "method": "PATCH",
                "endpoint": f"/repos/{owner}/{repo}/issues/{object_id}",
                "object_id": object_id,
                "entity": snapshot.get("entity"),
                "payload": {
                    "title": title,
                    "body": body,
                    "state": gh_state,
                    "state_reason": gh_reason,
                },
            }
        # CREATE a new issue -> POST at the collection endpoint. GitHub creates an
        # issue OPEN; a create payload does not carry state/state_reason.
        return {
            "method": "POST",
            "endpoint": f"/repos/{owner}/{repo}/issues",
            "object_id": None,
            "entity": snapshot.get("entity"),
            "payload": {
                "title": title,
                "body": body,
            },
        }

    def execute_push(self, plan: dict, repo_cfg: dict, transport: Transport,
                     token: Optional[str]) -> dict:
        """EXECUTE a push_plan against GitHub (PR 9F apply path). Issues the plan's
        POST (create) or PATCH (update) to GITHUB_API_BASE{endpoint} with the JSON
        payload, through the INJECTED transport. The token rides ONLY in the Bearer
        Authorization header -- never the URL, never the returned record.

        Returns {executed, method, url, object_id, entity, status}; the url is
        redacted and carries NO header/token. token=None -> {executed: False}."""
        if not token:
            return {"executed": False, "entity": plan.get("entity"),
                    "method": plan.get("method"), "reason": "not configured"}
        method = plan.get("method", "POST")
        url = f"{GITHUB_API_BASE}{plan.get('endpoint', '')}"
        body = json.dumps(plan.get("payload") or {}).encode("utf-8")
        resp = transport.request(method, url, headers=self._auth_headers(token),
                                 body=body)
        self._raise_for_status(method, url, resp)
        return {
            "executed": True,
            "method": method,
            "url": _redact_url(url),
            "object_id": plan.get("object_id"),
            "entity": plan.get("entity"),
            "status": resp.get("status") if isinstance(resp, dict) else None,
        }

    # --- small helpers (pure) ---------------------------------------------

    def _owner_repo(self, repo_cfg: dict):
        """Split `repo: owner/name` into (owner, name). Tolerates a bare name
        (-> (None, name)) and a missing repo (-> (None, None)). GitHub always
        needs an owner, so a bare name yields no pull (owner None)."""
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
        """The request headers, including `Authorization: Bearer <T>` + the GitHub
        Accept + API-version headers. The token is placed ONLY here (in the header
        dict the Transport sends) -- it is never copied into a URL, an error, or a
        log (§7.3). TransportError redacts the query string and never echoes
        headers, so the token cannot leak."""
        return {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
        }

    def _raise_for_status(self, method: str, url: str, resp: dict) -> None:
        """Turn a non-2xx response into a structured TransportError (token-free).
        A 401/403/404 from GitHub thus surfaces as a graceful, redacted error
        rather than a crash, and the token is never in the message."""
        status = resp.get("status") if isinstance(resp, dict) else None
        if status is None:
            raise TransportError(method, url, None, detail="no status in response")
        if 200 <= int(status) < 300:
            return
        raise TransportError(method, url, int(status), detail="github api error")

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

    def _to_github_state(self, canonical_state: Optional[str]):
        """Map a canonical work state -> (github_state, state_reason). GitHub
        issues are open|closed only: done -> (closed, completed); canceled ->
        (closed, not_planned); every active state -> (open, None)."""
        w = (canonical_state or "").strip().lower()
        if w == _currency.STATE_DONE:
            return ("closed", "completed")
        if w == _currency.STATE_CANCELED:
            return ("closed", GITHUB_STATE_NOT_PLANNED)
        return ("open", None)

    def _origin_object_id(self, snapshot: dict):
        """The remote issue number this snapshot already maps to, from its
        `origin.object-id` -- but ONLY when origin.provider is github (a snapshot
        whose origin points at a DIFFERENT provider has no GitHub counterpart, so
        a push to github CREATES). None -> push_plan emits a CREATE."""
        if not isinstance(snapshot, dict):
            return None
        # origin may live directly on the snapshot or under its `fields` map.
        for container in (snapshot, snapshot.get("fields")):
            if not isinstance(container, dict):
                continue
            origin = container.get("origin")
            if isinstance(origin, dict):
                prov = str(origin.get("provider") or "").strip().lower()
                if prov and prov != self.name:
                    # origin is a different forge -> no GitHub issue yet -> CREATE.
                    return None
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
        else empty."""
        if isinstance(snapshot, dict):
            v = snapshot.get("body")
            if isinstance(v, str) and v.strip():
                return v.strip()
        return ""


# ===========================================================================
# Task 9 / PR 9E: the LINEAR ADAPTER
# ===========================================================================
#
# The third concrete Provider on top of the 9C scaffolding. Unlike Gitea/GitHub
# (REST), Linear is a SINGLE GraphQL endpoint: every read is a `query` and every
# write is a `mutation`, both POSTed to https://api.linear.app/graphql through the
# INJECTED Transport. A test drives it with a FakeTransport + recorded Linear
# GraphQL JSON and NEVER hits a live API (§7.2 / §7.7).
#
# Locked design (TASK9 §7 -- mirrors the Gitea/GitHub adapters EXACTLY; do NOT
# deviate):
#   * zero-dep stdlib only -- HTTP goes through the injected Transport
#     (urllib.request under the hood); NO requests / NO httpx. The GraphQL body is
#     a stdlib `json.dumps({query, variables})`.
#   * pull-only -- one-shot API client; NO webhook receiver, NO daemon (§0 #11).
#     pull() runs a query; push_plan() returns a MUTATION payload only (it never
#     issues a write).
#   * token from the ENVIRONMENT (LINEAR_TOKEN), passed in as `token`; Linear uses
#     the RAW token (NO 'Bearer ' prefix) in the `Authorization` header ONLY and
#     it is NEVER logged / never put in a URL / error / candidate (the structured
#     error carries method/url/status only).
#   * a remote issue -> a status:draft candidate stamped with
#     origin:{provider,object-id,revision,actor} + base-head (via the shared
#     remote_item_to_candidate). Linear's `state.type` (backlog/unstarted/started/
#     completed/canceled) is the CANONICAL signal -- NOT the human-renamable
#     `state.name`; it maps to the 5-state work vocabulary, but a pulled
#     "completed" issue is only a PROPOSAL (status:draft), never an auto-close
#     (§0 #12).
#   * dry-run is the DEFAULT for any write/push -- push_plan is a PLAN only.
#
# Linear state IDs are WORKFLOW-STATE objects that are workspace-specific (each
# team defines its own `WorkflowState` rows with their own UUIDs). There is no
# global "done" id, so push_plan emits the intended state TYPE (started/completed/
# canceled) and leaves the concrete `stateId` resolution as a documented config
# seam: repo_cfg may carry a `state_type_ids` map (state-type -> workspace stateId);
# when it is absent, the plan records a 'needs stateId mapping' note rather than
# guessing an id.

LINEAR_API_URL = "https://api.linear.app/graphql"

# Defensive pagination cap: never loop unboundedly against the cursor API (a
# misbehaving server / a never-advancing cursor must not hang the pull). At most
# LINEAR_PAGE_CAP * LINEAR_PAGE_LIMIT issues are read.
LINEAR_PAGE_CAP = 20
LINEAR_PAGE_LIMIT = 50

# Linear's `state.type` -> the raw word the shared map_remote_state understands.
# state.type is the CANONICAL, machine-stable signal (state.name is human-renamable
# and must NOT be trusted). map_remote_state already maps these raw words through
# currency.work_state + the forge-extra table (unstarted->todo, started->
# in-progress, completed->done, canceled->canceled, backlog->backlog), so the
# adapter feeds it the type verbatim.
_LINEAR_STATE_TYPE_TO_RAW = {
    "backlog": "backlog",
    "unstarted": "unstarted",
    "started": "started",
    "completed": "completed",
    "canceled": "canceled",
    "cancelled": "canceled",
    "triage": "triage",
}

# For the OUTWARD direction (push_plan) a canonical work state maps to the Linear
# state TYPE we INTEND (the workspace-specific stateId is resolved via the
# state_type_ids config seam, never guessed). Linear has all 5 native types, so
# the mapping is 1:1 (no lossy open|closed collapse).
_WORK_STATE_TO_LINEAR_TYPE = {
    _currency.STATE_BACKLOG: "backlog",
    _currency.STATE_TODO: "unstarted",
    _currency.STATE_IN_PROGRESS: "started",
    _currency.STATE_DONE: "completed",
    _currency.STATE_CANCELED: "canceled",
}

# The GraphQL query that reads issues scoped to a team/project. Cursor-paginated
# (pageInfo.hasNextPage/endCursor). `state { name type }` -> we trust `type`;
# `assignee { displayName }` -> the actor. `identifier` is the human key (ABC-123)
# for the entity_hint; `id` is the STABLE id used by issueUpdate.
_LINEAR_ISSUES_QUERY = """\
query Issues($filter: IssueFilter, $first: Int!, $after: String) {
  issues(filter: $filter, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      identifier
      title
      updatedAt
      state { name type }
      assignee { displayName }
    }
  }
}"""

# The OUTWARD GraphQL mutations executed by execute_push (PR 9F apply path). Each
# returns the issue id + the success flag so the apply record can confirm it; the
# `input` variable is the issueCreate/issueUpdate input the push_plan built.
_LINEAR_ISSUE_CREATE_MUTATION = """\
mutation IssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) { success issue { id identifier } }
}"""
_LINEAR_ISSUE_UPDATE_MUTATION = """\
mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
  issueUpdate(id: $id, input: $input) { success issue { id identifier } }
}"""

# mutation-name -> the GraphQL document execute_push POSTs for it.
_LINEAR_MUTATION_DOCS = {
    "issueCreate": _LINEAR_ISSUE_CREATE_MUTATION,
    "issueUpdate": _LINEAR_ISSUE_UPDATE_MUTATION,
}


class LinearAdapter(Provider):
    """The Linear Provider (§7 / PR 9E). Linear is a single GraphQL endpoint, so
    reads are queries and writes are mutations -- both POSTed to LINEAR_API_URL
    through the injected Transport. pull() runs the issues query and maps each node
    into a RemoteItem (trusting state.type, not state.name); push_plan() returns
    the issueCreate / issueUpdate mutation payload for the outward direction. The
    actual network WRITE is apply-only and out of scope for this PR -- the mutation
    payload is the deliverable (dry-run by default).
    """

    name = PROVIDER_LINEAR

    # --- inward: query issues -> RemoteItems -------------------------------

    def pull(self, repo_cfg: dict, transport: Transport,
             token: Optional[str]) -> list:
        """POST a GraphQL `issues` query to LINEAR_API_URL -> [RemoteItem].

        Scoped to the team/project from repo_cfg (`team_id` / `project_id`, or a
        bare `team`/`project` key). Each node becomes a RemoteItem(kind='issue',
        object_id=id (the STABLE Linear id used for issueUpdate), revision=
        updatedAt, actor=assignee.displayName, title, state=state.type (the
        canonical signal), entity_hint='project/<slug>/issue/<identifier>').
        Cursor-paginated DEFENSIVELY (capped pages; stops when hasNextPage is
        false / the cursor stops advancing / a page is empty).

        Token=None -> [] (graceful; never crash). A GraphQL `errors` array, or a
        non-2xx HTTP status, is surfaced as a structured error WHOSE TEXT NEVER
        carries the token (method/url/status only). The caller (pull_to_candidates)
        catches a TransportError per-project; we let it propagate.
        """
        if not token:
            return []
        headers = self._auth_headers(token)
        slug = self._project_slug(repo_cfg)
        issue_filter = self._issue_filter(repo_cfg)

        items: list = []
        seen_ids: set = set()
        after: Optional[str] = None
        for _page in range(1, LINEAR_PAGE_CAP + 1):
            variables = {"first": LINEAR_PAGE_LIMIT, "after": after}
            if issue_filter:
                variables["filter"] = issue_filter
            body = self._graphql_body(_LINEAR_ISSUES_QUERY, variables)
            resp = transport.request("POST", LINEAR_API_URL,
                                     headers=headers, body=body)
            self._raise_for_status("POST", LINEAR_API_URL, resp)
            data = self._graphql_data("POST", LINEAR_API_URL, resp)
            conn = data.get("issues") if isinstance(data, dict) else None
            if not isinstance(conn, dict):
                break
            nodes = conn.get("nodes")
            if not isinstance(nodes, list) or not nodes:
                break
            new_this_page = 0
            for node in nodes:
                it = self._node_to_item(node, slug)
                if it is None:
                    continue
                if it.object_id in seen_ids:
                    continue  # defensive: a repeated page can't loop us.
                seen_ids.add(it.object_id)
                items.append(it)
                new_this_page += 1
            page_info = conn.get("pageInfo")
            page_info = page_info if isinstance(page_info, dict) else {}
            has_next = bool(page_info.get("hasNextPage"))
            end_cursor = page_info.get("endCursor")
            # stop when the server says there is no more, the cursor did not
            # advance (would loop), or this page surfaced no new ids.
            if (not has_next or not end_cursor or end_cursor == after
                    or new_this_page == 0):
                break
            after = end_cursor
        return items

    def _node_to_item(self, node, slug: str) -> Optional[RemoteItem]:
        """Map ONE Linear issue node to a RemoteItem, or None when malformed. The
        canonical state signal is `state.type` (NOT the human-renamable
        `state.name`); we feed the TYPE to the shared stamper. object_id is the
        STABLE Linear `id` (used by issueUpdate); identifier (ABC-123) keys the
        entity_hint."""
        if not isinstance(node, dict):
            return None
        object_id = node.get("id")
        if object_id is None or not str(object_id).strip():
            return None
        object_id = str(object_id)
        identifier = node.get("identifier")
        identifier = str(identifier).strip() if identifier is not None else ""
        state = node.get("state")
        # state.type is canonical; map it to a raw word the stamper understands.
        state_type = None
        if isinstance(state, dict):
            st = state.get("type")
            if st is not None:
                state_type = self._state_type_to_raw(st)
        assignee = node.get("assignee")
        actor = (assignee.get("displayName")
                 if isinstance(assignee, dict) else None)
        return RemoteItem(
            kind="issue",
            object_id=object_id,
            revision=node.get("updatedAt"),
            actor=actor,
            title=node.get("title", "") or "",
            state=state_type,
            # entity_hint keys off the raw human identifier (ABC-123), unsanitized,
            # matching the GitHub/Gitea providers (only the repo `slug` goes
            # through _safe_segment; the issue id/number does not).
            entity_hint=f"project/{slug}/issue/{identifier or object_id}",
            raw=node,
        )

    def _state_type_to_raw(self, state_type) -> str:
        """Map a Linear `state.type` to the raw word the shared map_remote_state
        understands. An unknown type falls through as-is (map_remote_state then
        defaults it to backlog) -- the type, never the renamable name, is trusted.
        """
        w = str(state_type or "").strip().lower()
        return _LINEAR_STATE_TYPE_TO_RAW.get(w, w)

    # --- outward: reviewed snapshot -> mutation payload (PLAN only) ---------

    def push_plan(self, snapshot: dict, repo_cfg: dict) -> dict:
        """Build the Linear GraphQL MUTATION that WOULD project a REVIEWED snapshot
        outward (§7 / PR 9E). PURE -- NO network here (the actual POST lands in a
        later apply path; the mutation payload is the seam).

        Mutation:
          * a NEW issue (no origin.object-id, OR an origin from a DIFFERENT
            provider) -> `issueCreate` with input {title, description, teamId,
            stateId?}.
          * an UPDATE (origin.object-id present AND origin.provider == 'linear') ->
            `issueUpdate(id, input{title, description, stateId?})`.

        State: Linear workflow-state ids are WORKSPACE-SPECIFIC, so the plan emits
        the intended state TYPE (started/completed/canceled/...) and resolves the
        concrete `stateId` ONLY via repo_cfg['state_type_ids'][type]. When that map
        lacks the type, NO stateId is put in the input and the plan records a
        'needs stateId mapping' note -- it NEVER guesses an id. Returns
        {mutation, variables, object_id, entity, state_type, notes}.
        """
        canonical = snapshot.get("state")
        state_type = self._to_linear_type(canonical)
        title = self._snapshot_title(snapshot)
        description = self._snapshot_body(snapshot)
        state_id, needs_mapping = self._resolve_state_id(state_type, repo_cfg)

        notes: list = []
        if needs_mapping:
            notes.append(
                f"needs stateId mapping: state-type '{state_type}' has no entry "
                "in repo_cfg['state_type_ids']; the push will not set a state "
                "until a workspace stateId is configured.")

        object_id = self._origin_object_id(snapshot)
        if object_id is not None:
            # UPDATE an existing Linear issue -> issueUpdate(id, input{...}).
            input_obj: dict = {"title": title, "description": description}
            if state_id is not None:
                input_obj["stateId"] = state_id
            return {
                "mutation": "issueUpdate",
                "variables": {"id": object_id, "input": input_obj},
                "object_id": object_id,
                "entity": snapshot.get("entity"),
                "state_type": state_type,
                "notes": notes,
            }
        # CREATE a new issue -> issueCreate(input{title, description, teamId, ...}).
        team_id = self._team_id(repo_cfg)
        create_input: dict = {"title": title, "description": description}
        if team_id is not None:
            create_input["teamId"] = team_id
        else:
            notes.append(
                "needs teamId: repo_cfg has no team_id/team; issueCreate requires "
                "a teamId to place the new issue.")
        if state_id is not None:
            create_input["stateId"] = state_id
        return {
            "mutation": "issueCreate",
            "variables": {"input": create_input},
            "object_id": None,
            "entity": snapshot.get("entity"),
            "state_type": state_type,
            "notes": notes,
        }

    def execute_push(self, plan: dict, repo_cfg: dict, transport: Transport,
                     token: Optional[str]) -> dict:
        """EXECUTE a push_plan against Linear (PR 9F apply path). POSTs the plan's
        issueCreate/issueUpdate GraphQL MUTATION (+ its variables) to LINEAR_API_URL
        through the INJECTED transport. The RAW token rides ONLY in the
        Authorization header (NO Bearer) -- never the URL, never the record.

        Returns {executed, method, url, mutation, object_id, entity, status}; the
        url is redacted and carries NO header/token. A GraphQL `errors` array (even
        with HTTP 200) surfaces as a redacted, token-free TransportError via
        _graphql_data. token=None -> {executed: False}."""
        if not token:
            return {"executed": False, "entity": plan.get("entity"),
                    "mutation": plan.get("mutation"), "reason": "not configured"}
        mutation = plan.get("mutation", "issueCreate")
        doc = _LINEAR_MUTATION_DOCS.get(mutation)
        if doc is None:
            return {"executed": False, "entity": plan.get("entity"),
                    "mutation": mutation, "reason": f"unknown mutation {mutation}"}
        body = self._graphql_body(doc, plan.get("variables") or {})
        resp = transport.request("POST", LINEAR_API_URL,
                                 headers=self._auth_headers(token), body=body)
        self._raise_for_status("POST", LINEAR_API_URL, resp)
        # raises a token-free TransportError on a GraphQL `errors` array.
        self._graphql_data("POST", LINEAR_API_URL, resp)
        return {
            "executed": True,
            "method": "POST",
            "url": _redact_url(LINEAR_API_URL),
            "mutation": mutation,
            "object_id": plan.get("object_id"),
            "entity": plan.get("entity"),
            "status": resp.get("status") if isinstance(resp, dict) else None,
        }

    # --- small helpers (pure) ---------------------------------------------

    def _auth_headers(self, token: str) -> dict:
        """The request headers. Linear uses the RAW token in `Authorization` (NO
        'Bearer ' prefix), plus JSON content-type for the GraphQL POST body. The
        token is placed ONLY here (in the header dict the Transport sends) -- never
        in a URL, an error, or a log (§7.3). TransportError redacts the query
        string and never echoes headers, so the token cannot leak."""
        return {
            "Authorization": token,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _graphql_body(self, query: str, variables: dict) -> bytes:
        """Serialize a GraphQL request body to UTF-8 JSON bytes ({query, variables}).
        None values inside variables are kept (GraphQL treats them as null, e.g.
        an absent cursor `after: null`)."""
        return json.dumps({"query": query, "variables": variables}).encode("utf-8")

    def _raise_for_status(self, method: str, url: str, resp: dict) -> None:
        """Turn a non-2xx HTTP response into a structured TransportError (token-
        free). A GraphQL endpoint can also 200 with an `errors` array -- that is
        handled separately in _graphql_data; this only guards the HTTP layer."""
        status = resp.get("status") if isinstance(resp, dict) else None
        if status is None:
            raise TransportError(method, url, None, detail="no status in response")
        if 200 <= int(status) < 300:
            return
        raise TransportError(method, url, int(status), detail="linear api error")

    def _graphql_data(self, method: str, url: str, resp: dict) -> dict:
        """Decode a GraphQL response body to its `data` map. A GraphQL endpoint
        signals failure with a top-level `errors` array (often WITH a 200 status),
        so we surface that as a structured TransportError whose TEXT carries ONLY
        a terse, token-free summary (the error MESSAGES from the API, never the
        request headers/body/token). A malformed body -> {} (no crash)."""
        body = resp.get("body") if isinstance(resp, dict) else None
        if isinstance(body, (bytes, bytearray)):
            try:
                body = bytes(body).decode("utf-8")
            except (UnicodeDecodeError, ValueError):
                return {}
        if isinstance(body, str):
            try:
                body = json.loads(body) if body.strip() else {}
            except ValueError:
                return {}
        if not isinstance(body, dict):
            return {}
        errors = body.get("errors")
        if errors:
            # surface a terse, token-free summary. We deliberately do NOT embed the
            # API's error `message` strings: a GraphQL endpoint's response is NOT
            # trusted -- a buggy/malicious/MITM endpoint can echo the request's
            # Authorization token back inside `errors[].message`, and that would
            # then ride into the raised error -> logs -> pull_to_candidates'
            # result["errors"] (a token leak). Only the COUNT (a number that can
            # never carry a secret) plus the API's own GraphQL error `code`
            # extensions (an enum like AUTHENTICATION_ERROR, never free text) are
            # surfaced. The status + redacted url come from TransportError.
            count = len(errors) if isinstance(errors, list) else 1
            codes: list = []
            if isinstance(errors, list):
                for err in errors:
                    if not isinstance(err, dict):
                        continue
                    ext = err.get("extensions")
                    code = ext.get("code") if isinstance(ext, dict) else None
                    # an error `code` is an enum (UPPER_SNAKE); accept ONLY that
                    # shape so a free-text value masquerading as a code can never
                    # smuggle a token in. Bound the set so a huge errors[] can't
                    # bloat the message.
                    if (isinstance(code, str) and code
                            and code.replace("_", "").isalnum()
                            and code == code.upper()
                            and len(code) <= 64 and code not in codes):
                        codes.append(code)
                        if len(codes) >= 5:
                            break
            detail = f"graphql errors ({count})"
            if codes:
                detail += f": {', '.join(codes)}"
            raise TransportError(method, url, int(resp.get("status") or 200),
                                 detail=detail)
        data = body.get("data")
        return data if isinstance(data, dict) else {}

    def _issue_filter(self, repo_cfg: dict) -> Optional[dict]:
        """Build the GraphQL IssueFilter from the binding: scope to a team and/or
        project when their ids are configured. Returns None when neither is set
        (an unscoped query reads the whole workspace, which is still valid)."""
        if not isinstance(repo_cfg, dict):
            return None
        f: dict = {}
        team_id = self._team_id(repo_cfg)
        if team_id is not None:
            f["team"] = {"id": {"eq": team_id}}
        project_id = self._project_id(repo_cfg)
        if project_id is not None:
            f["project"] = {"id": {"eq": project_id}}
        return f or None

    def _team_id(self, repo_cfg: dict) -> Optional[str]:
        """The Linear team id from the binding (`team_id` or a bare `team`)."""
        return self._cfg_str(repo_cfg, "team_id", "team")

    def _project_id(self, repo_cfg: dict) -> Optional[str]:
        """The Linear project id from the binding (`project_id`, `project-id`, or
        a bare `project`)."""
        return self._cfg_str(repo_cfg, "project_id", "project-id", "project")

    def _cfg_str(self, repo_cfg: dict, *keys: str) -> Optional[str]:
        """First non-empty string value among `keys` in repo_cfg, else None."""
        if not isinstance(repo_cfg, dict):
            return None
        for k in keys:
            v = repo_cfg.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        return None

    def _project_slug(self, repo_cfg: dict) -> str:
        """A path-safe slug for the entity_hint: the binding's explicit `slug`/
        `repo`, else its project id, else 'linear'. Always safe (no separators)."""
        raw = self._cfg_str(repo_cfg, "slug", "repo") or self._project_id(repo_cfg)
        return _safe_segment(raw, "linear")

    def _to_linear_type(self, canonical_state: Optional[str]) -> str:
        """Map a canonical work state -> the Linear state TYPE we intend. An
        unknown/empty state -> Linear's 'backlog' type (matches currency's default
        state). Linear has all 5 native types, so this is a 1:1 mapping."""
        w = (canonical_state or "").strip().lower()
        return _WORK_STATE_TO_LINEAR_TYPE.get(w, "backlog")

    def _resolve_state_id(self, state_type: str, repo_cfg: dict):
        """Resolve the WORKSPACE-SPECIFIC stateId for a state TYPE via the config
        seam repo_cfg['state_type_ids'][type]. Returns (state_id, needs_mapping):
        (id, False) when configured, (None, True) when the map is absent or lacks
        the type. NEVER guesses an id -- an absent mapping is reported, not faked.
        """
        mapping = repo_cfg.get("state_type_ids") if isinstance(repo_cfg, dict) else None
        if isinstance(mapping, dict):
            sid = mapping.get(state_type)
            if isinstance(sid, str) and sid.strip():
                return (sid.strip(), False)
        return (None, True)

    def _origin_object_id(self, snapshot: dict):
        """The Linear issue id this snapshot already maps to, from its
        `origin.object-id` -- but ONLY when origin.provider is linear (a snapshot
        whose origin points at a DIFFERENT provider has no Linear counterpart, so
        a push to linear CREATES). None -> push_plan emits an issueCreate."""
        if not isinstance(snapshot, dict):
            return None
        for container in (snapshot, snapshot.get("fields")):
            if not isinstance(container, dict):
                continue
            origin = container.get("origin")
            if isinstance(origin, dict):
                prov = str(origin.get("provider") or "").strip().lower()
                if prov and prov != self.name:
                    # origin is a different forge -> no Linear issue yet -> CREATE.
                    return None
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
        """The issue description for an outward push: the snapshot's `body` if
        present, else empty (Linear's issue prose field is `description`)."""
        if isinstance(snapshot, dict):
            v = snapshot.get("body")
            if isinstance(v, str) and v.strip():
                return v.strip()
        return ""
