"""Task 9: ENSURE AN OBSIDIAN COMMUNITY PLUGIN IS INSTALLED + ENABLED.

> vault-mind renders a kanban board (work_driver.render_kanban_board) that only
> displays for users whose vault has the obsidian-kanban community plugin. This
> module makes "ensure the plugin is present" a first-class, idempotent, atomic,
> dry-run-by-default operation -- so a freshly-cloned vault can render the board.

Zero-dependency, stdlib only (urllib is OK, behind forge's injectable Transport).
The ONLY network seam is the downloader (default_downloader, bound to a repo +
an injected forge.Transport); tests inject a fake downloader/transport and NEVER
hit GitHub.

Obsidian plugin install convention:
  * Enabled list: <vault>/.obsidian/community-plugins.json -- a JSON ARRAY of
    enabled plugin-id strings (e.g. ["dataview","obsidian-kanban"]).
  * Plugin files: <vault>/.obsidian/plugins/<id>/{main.js, manifest.json,
    styles.css(optional)}.
  * A plugin is installed+enabled iff its dir has main.js + manifest.json AND its
    id is in community-plugins.json.

Locked design (followed EXACTLY):
  * idempotent: already installed+enabled -> no-op "already-present".
  * never clobber an existing install (main.js present) unless --force.
  * dry-run is the DEFAULT for any write/download (apply=False -> return the plan).
  * download is injectable (transport= / downloader=) -> tests are hermetic.
  * atomic / no partial state: a failed download leaves NO half-written plugin dir
    and NO community-plugins.json entry whose files are missing.
  * security: an unsafe plugin id (traversal / separator / drive letter / dot /
    control char) is REJECTED (UnsafePluginId) before any disk/network touch, so a
    write can only ever land inside .obsidian/plugins/. The download source is
    validated (host must be github.com, path under the bound repo's releases).
  * Windows: any written file is LF-only bytes (mirrors workspace.save_bindings).
"""

from __future__ import annotations

import json
import os
import sys as _sys
import tempfile
from pathlib import Path
from typing import Callable, Optional

# forge.py is the shared download seam (Transport / UrllibTransport /
# TransportError) + the id-sanitation spirit (_safe_segment). Import works whether
# this module is imported from compiler/ or run as a script.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in _sys.path:
    _sys.path.insert(0, str(_HERE))

import forge as _forge  # noqa: E402

# === filesystem layout ======================================================

OBSIDIAN_DIR = ".obsidian"
PLUGINS_SUBDIR = "plugins"
COMMUNITY_PLUGINS_FILE = "community-plugins.json"

# The required + optional plugin asset files. A plugin is INSTALLED iff BOTH
# required files are present; styles.css is optional (never required).
MAIN_JS = "main.js"
MANIFEST_JSON = "manifest.json"
STYLES_CSS = "styles.css"
REQUIRED_FILES = (MAIN_JS, MANIFEST_JSON)
OPTIONAL_FILES = (STYLES_CSS,)
ALL_ASSET_FILES = REQUIRED_FILES + OPTIONAL_FILES

DEFAULT_PLUGIN_ID = "obsidian-kanban"
DEFAULT_REPO = "mgmeyers/obsidian-kanban"


def _obsidian_dir(vault) -> Path:
    return Path(vault) / OBSIDIAN_DIR


def plugin_dir(vault, plugin_id: str) -> Path:
    """<vault>/.obsidian/plugins/<plugin_id> as a Path. Pure join; does NOT
    validate the id (callers validate via validate_plugin_id first) and does NOT
    create anything."""
    return _obsidian_dir(vault) / PLUGINS_SUBDIR / plugin_id


def community_plugins_path(vault) -> Path:
    """<vault>/.obsidian/community-plugins.json. Pure join (mirrors
    workspace.bindings_path style)."""
    return _obsidian_dir(vault) / COMMUNITY_PLUGINS_FILE


# === the security gate: validate_plugin_id ==================================

class UnsafePluginId(ValueError):
    """Raised by validate_plugin_id for an id that is not a single safe path
    segment. Carries the offending id + the reason (separator / traversal /
    drive-letter / empty / bad-char) so the CLI surfaces exactly WHY it was
    refused. Subclasses ValueError so kb_meta.main's generic except-Exception
    turns it into {'error': ...} with a non-zero exit, like every other command
    error."""

    def __init__(self, plugin_id, reason: str) -> None:
        self.plugin_id = plugin_id
        self.reason = reason
        super().__init__(f"unsafe plugin id {plugin_id!r}: {reason}")


# the conservative allowlist: alphanumerics plus '-' '_' '.'. An interior dot is
# allowed (e.g. obsidian.excalidraw) but a LEADING dot or a bare '.'/'..' is not.
_ID_ALLOWED = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")


def validate_plugin_id(plugin_id: str) -> str:
    """Return the id UNCHANGED iff it is a single safe path segment; else raise
    UnsafePluginId. This is the security gate guaranteeing the plugin can only
    ever land inside .obsidian/plugins/ (no traversal / drive escape).

    Rejects: empty/blank; any '/' or '\\' separator; '.'/'..' (and ids that strip
    to those); a leading dot; a Windows drive prefix (e.g. 'c:'); absolute markers;
    NUL/control chars; anything outside the allowlist.

    The allowlist mirrors the SPIRIT of forge._safe_segment but REJECTS rather
    than rewrites, because silently rewriting a hostile id would install under a
    different name than the user asked for."""
    if not isinstance(plugin_id, str):
        raise UnsafePluginId(plugin_id, "not-a-string")
    if plugin_id.strip() == "":
        raise UnsafePluginId(plugin_id, "empty")
    # control chars / NUL anywhere -> hard reject (a newline could smuggle a path).
    for ch in plugin_id:
        if ord(ch) < 0x20 or ord(ch) == 0x7F:
            raise UnsafePluginId(plugin_id, "control-char")
    if "/" in plugin_id or "\\" in plugin_id:
        raise UnsafePluginId(plugin_id, "separator")
    # a Windows drive prefix ('c:' / 'C:\\x') or any colon -> reject (colon is not
    # in the allowlist anyway, but name the reason for the CLI).
    if ":" in plugin_id:
        raise UnsafePluginId(plugin_id, "drive-letter")
    if plugin_id.startswith("."):
        # rejects '.', '..', '.hidden', './x' (the slash case already caught).
        raise UnsafePluginId(plugin_id, "leading-dot")
    # a bare dot-run ('.', '..', '...') -> traversal-ish; reject. (Leading-dot
    # already covers these, but keep the explicit guard for clarity.)
    if set(plugin_id) == {"."}:
        raise UnsafePluginId(plugin_id, "traversal")
    for ch in plugin_id:
        if ch not in _ID_ALLOWED:
            raise UnsafePluginId(plugin_id, f"bad-char:{ch!r}")
    # a final paranoia check: the id, joined under a plugins root, must stay under
    # it (no resolved escape). This can never fail given the checks above, but it
    # is the load-bearing invariant, asserted directly.
    root = Path("/__plugins_root__")
    joined = (root / plugin_id).resolve()
    if root.resolve() not in joined.parents and joined != root.resolve():
        raise UnsafePluginId(plugin_id, "escapes-plugins-root")
    return plugin_id


# === community-plugins.json: load / save ====================================

def load_enabled(vault) -> "tuple[list, dict]":
    """Read community-plugins.json and return (enabled_ids, meta).

    enabled_ids is the parsed JSON ARRAY filtered to non-empty strings, order
    preserved, de-duped (first-seen wins). meta records what was found so a later
    save can PRESERVE formatting/trailing-newline:
        {existed, parse_ok, had_bom, trailing_newline, raw, not_array}

    Reads with utf-8-sig (strips a UTF-8 BOM, like every load_* in
    workspace/forge). Missing file -> ([], {existed:False,...}). Empty/whitespace
    -> ([], parse_ok True, treated as empty array). Malformed JSON or a non-array
    -> ([], parse_ok False / not_array True) -- NEVER raises (mirrors
    load_bindings / load_forge_config tolerance)."""
    p = community_plugins_path(vault)
    meta = {
        "existed": False,
        "parse_ok": False,
        "had_bom": False,
        "trailing_newline": False,
        "raw": None,
        "not_array": False,
    }
    if not p.exists():
        return ([], meta)
    meta["existed"] = True
    try:
        raw_bytes = p.read_bytes()
    except OSError:
        return ([], meta)
    meta["had_bom"] = raw_bytes.startswith(b"\xef\xbb\xbf")
    # decode via utf-8-sig so a BOM is stripped before parse.
    try:
        text = raw_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw_bytes.decode("utf-8", errors="replace")
    meta["raw"] = text
    meta["trailing_newline"] = text.endswith("\n")

    if text.strip() == "":
        # empty / whitespace-only -> treat as an empty array (not malformed).
        meta["parse_ok"] = True
        return ([], meta)

    try:
        data = json.loads(text)
    except ValueError:
        # malformed JSON -> tolerant empty (parse_ok stays False).
        return ([], meta)

    if not isinstance(data, list):
        # valid JSON but not an array (object/number/string) -> treat as empty.
        meta["parse_ok"] = True
        meta["not_array"] = True
        return ([], meta)

    meta["parse_ok"] = True
    ids: list = []
    seen: set = set()
    for v in data:
        if isinstance(v, str) and v.strip() != "" and v not in seen:
            seen.add(v)
            ids.append(v)
    return (ids, meta)


def _normalize_ids(ids) -> list:
    """De-dupe (first-seen) + drop non-string/empty, preserving order."""
    out: list = []
    seen: set = set()
    for v in ids:
        if isinstance(v, str) and v.strip() != "" and v not in seen:
            seen.add(v)
            out.append(v)
    return out


def _render_enabled_bytes(ids: list, meta: dict) -> bytes:
    """Serialize the enabled-id array as LF-only bytes: indent=2 (matches
    Obsidian's own writer), a trailing newline iff the prior file had one (or did
    not exist), NEVER a BOM."""
    text = json.dumps(ids, indent=2, ensure_ascii=False)
    # missing file (existed False) defaults to a trailing newline; otherwise honor
    # what was on disk.
    want_newline = meta.get("trailing_newline", True) if meta.get("existed") else True
    if want_newline:
        text += "\n"
    # LF-only, no BOM.
    return text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")


def save_enabled(vault, enabled_ids: list, meta: dict) -> Path:
    """Atomically write community-plugins.json as a JSON array, LF-only bytes, via
    the tmp-write+os.replace pattern from workspace.save_bindings. Creates
    <vault>/.obsidian/ if absent. Preserves formatting per meta (trailing newline,
    indent=2, never a BOM). De-dupes, preserves order. Returns the path written.

    Never writes if the array is byte-identical to what is on disk already
    (idempotent: a re-run produces no spurious diff)."""
    p = community_plugins_path(vault)
    ids = _normalize_ids(enabled_ids)
    data = _render_enabled_bytes(ids, meta)

    # idempotency: skip the write entirely when the bytes already match disk.
    if p.exists():
        try:
            if p.read_bytes() == data:
                return p
        except OSError:
            pass

    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    try:
        # Write bytes (NOT text mode): keep it LF-only / byte-stable across OSes
        # (mirrors workspace.save_bindings).
        tmp.write_bytes(data)
        os.replace(tmp, p)
    except Exception:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise
    return p


# === install state probes ===================================================

def is_installed(vault, plugin_id: str) -> bool:
    """True iff <vault>/.obsidian/plugins/<id>/main.js AND manifest.json BOTH
    exist (the files-present half of the install definition). Does NOT consult
    community-plugins.json (that is the 'enabled' axis). styles.css is optional
    and never required."""
    d = plugin_dir(vault, plugin_id)
    return all((d / f).exists() for f in REQUIRED_FILES)


def is_enabled(vault, plugin_id: str) -> bool:
    """True iff plugin_id is in the enabled array from load_enabled (the 'enabled'
    half of the definition)."""
    ids, _ = load_enabled(vault)
    return plugin_id in ids


def plugin_status(vault, plugin_id: str) -> dict:
    """READ-ONLY. Return the full install/enable status. Writes nothing.

    {plugin_id, installed, enabled, present, has_main_js, has_manifest,
     has_styles, plugin_dir (posix), community_plugins_path (posix),
     community_plugins_exists, files_missing, id_in_list_but_files_missing,
     files_present_but_not_in_list}. The last two surface the two half-states."""
    d = plugin_dir(vault, plugin_id)
    has_main = (d / MAIN_JS).exists()
    has_manifest = (d / MANIFEST_JSON).exists()
    has_styles = (d / STYLES_CSS).exists()
    installed = has_main and has_manifest
    enabled = is_enabled(vault, plugin_id)
    cp = community_plugins_path(vault)
    files_missing = [f for f in REQUIRED_FILES if not (d / f).exists()]
    return {
        "plugin_id": plugin_id,
        "installed": installed,
        "enabled": enabled,
        "present": installed and enabled,
        "has_main_js": has_main,
        "has_manifest": has_manifest,
        "has_styles": has_styles,
        "plugin_dir": d.as_posix(),
        "community_plugins_path": cp.as_posix(),
        "community_plugins_exists": cp.exists(),
        "files_missing": files_missing,
        "id_in_list_but_files_missing": enabled and not installed,
        "files_present_but_not_in_list": installed and not enabled,
    }


# === the download seam (the ONLY network touch) =============================

def default_downloader(repo: str, transport: "_forge.Transport") -> "Callable":
    """Build the GitHub-release downloader bound to a repo (owner/name) + an
    injected Transport. Returns fetch(filename) -> bytes|None:

      issues GET https://github.com/<repo>/releases/latest/download/<filename>
      (the stable 'latest release asset' redirect URL -- the ONLY validated
      source) through transport.request, returning the body on HTTP 200, None on
      404 (asset absent -- expected for the optional styles.css), and re-raising
      TransportError for other failures.

    The host MUST be github.com and the path MUST be under the bound repo's
    releases; any other URL is refused so a poisoned manifest can't redirect the
    download elsewhere. This is the SOLE network seam: tests inject a fake
    transport/downloader and never hit GitHub."""
    repo = str(repo or "").strip().strip("/")
    base = f"https://github.com/{repo}/releases/latest/download/"

    def fetch(filename: str) -> Optional[bytes]:
        # the only segment that varies is the asset filename; it must itself be a
        # safe single segment so it cannot smuggle a different host/path.
        safe = _forge._safe_segment(filename) if ("/" in filename or "\\" in filename) else filename
        url = base + safe
        # validate the source BEFORE issuing: host must be github.com, path under
        # this repo's releases. (We constructed the URL, but assert the invariant
        # so any future change can't silently widen the source.)
        if not _is_valid_release_url(url, repo):
            raise _forge.TransportError("GET", url, None, "refused: not a github.com release asset")
        resp = transport.request("GET", url, headers={})
        status = resp.get("status")
        if status == 200:
            return resp.get("body") or b""
        if status == 404:
            return None
        # any other status is a real failure -> structured, url-redacted error.
        raise _forge.TransportError("GET", url, status, "unexpected status")

    return fetch


def _is_valid_release_url(url: str, repo: str) -> bool:
    """The download source allowlist: host must be exactly github.com and the path
    must be under /<repo>/releases/. A poisoned redirect to any other host/path is
    refused."""
    import urllib.parse
    try:
        parts = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    if parts.scheme != "https":
        return False
    if parts.netloc.lower() != "github.com":
        return False
    prefix = f"/{repo}/releases/"
    return parts.path.startswith(prefix)


# === plan (READ-ONLY) =======================================================

# plan statuses.
ST_ALREADY_PRESENT = "already-present"
ST_ENABLE_ONLY = "enable-only"
ST_INSTALL_AND_ENABLE = "install-and-enable"
ST_INSTALL_ONLY = "install-only"
ST_BLOCKED_EXISTING = "blocked-existing"


def plan_install(vault, plugin_id: str, repo: str, *, force: bool = False) -> dict:
    """READ-ONLY. Compute what an apply WOULD do without touching the network or
    disk. validate_plugin_id is called FIRST; an unsafe id raises UnsafePluginId
    before any plan is formed.

    Returns {plugin_id, repo, status, actions, will_download, will_enable,
    blocked, reason}. status is one of: already-present / enable-only /
    install-and-enable / install-only / blocked-existing."""
    validate_plugin_id(plugin_id)
    installed = is_installed(vault, plugin_id)
    enabled = is_enabled(vault, plugin_id)
    d = plugin_dir(vault, plugin_id)
    main_present = (d / MAIN_JS).exists()

    actions: list = []
    will_download: list = []
    will_enable = False
    reason = ""

    if installed and enabled and not force:
        # idempotent no-op (force re-downloads even a complete install).
        return {
            "plugin_id": plugin_id, "repo": repo, "status": ST_ALREADY_PRESENT,
            "actions": [], "will_download": [], "will_enable": False,
            "blocked": False, "reason": "",
        }

    # --force re-downloads (staged-then-swapped, still atomic) even over an
    # existing/complete install. Handle it BEFORE the no-download enable-only /
    # blocked-existing branches so a forced re-download is always planned.
    if force:
        will_download = list(REQUIRED_FILES) + list(OPTIONAL_FILES)
        actions.append("download")
        if enabled:
            status = ST_INSTALL_ONLY
            will_enable = False
        else:
            status = ST_INSTALL_AND_ENABLE
            will_enable = True
            actions.append("enable")
        return {
            "plugin_id": plugin_id, "repo": repo, "status": status,
            "actions": actions, "will_download": will_download,
            "will_enable": will_enable, "blocked": False, "reason": "",
        }

    if installed and not enabled:
        # files present, id missing from the list -> only the list is edited.
        will_enable = True
        actions.append("enable")
        return {
            "plugin_id": plugin_id, "repo": repo, "status": ST_ENABLE_ONLY,
            "actions": actions, "will_download": [], "will_enable": True,
            "blocked": False, "reason": "",
        }

    # not installed (one or both required files missing) from here on.
    if main_present and not force:
        # main.js already present (a partial / foreign install) and not force ->
        # refuse to clobber. The dir is NOT installable (manifest.json missing), so
        # we must NOT enable it: adding the id would list a plugin whose required
        # files are missing -- the very 'id_in_list_but_files_missing' half-state
        # the module forbids (lines 26-27, 597-598). Obsidian would then show an
        # enabled-but-broken plugin. Leave the list untouched; the user must --force
        # (to download the missing assets) before the id can be enabled.
        reason = (f"main.js already present in {d.as_posix()} but the plugin is not "
                  "installable (manifest.json missing); re-download requires --force "
                  "(refusing to clobber an existing file or to enable a broken "
                  "plugin).")
        return {
            "plugin_id": plugin_id, "repo": repo, "status": ST_BLOCKED_EXISTING,
            "actions": actions, "will_download": [], "will_enable": False,
            "blocked": True, "reason": reason,
        }

    # a real download is needed (files missing, or force over an existing dir).
    will_download = list(REQUIRED_FILES) + list(OPTIONAL_FILES)
    actions.append("download")
    if enabled:
        # listed but files missing -> download, do NOT duplicate the list entry.
        status = ST_INSTALL_ONLY
        will_enable = False
    else:
        status = ST_INSTALL_AND_ENABLE
        will_enable = True
        actions.append("enable")
    return {
        "plugin_id": plugin_id, "repo": repo, "status": status,
        "actions": actions, "will_download": will_download,
        "will_enable": will_enable, "blocked": False, "reason": "",
    }


# === the public entry point: ensure_plugin ==================================

def ensure_plugin(vault, plugin_id: str = DEFAULT_PLUGIN_ID,
                  repo: str = DEFAULT_REPO, *, apply: bool = False,
                  force: bool = False, transport: "_forge.Transport" = None,
                  downloader: "Callable" = None, today: str = None) -> dict:
    """Ensure a community plugin is installed + enabled. DRY-RUN by DEFAULT.

    validate_plugin_id(plugin_id) FIRST (raises UnsafePluginId on a hostile id).
    Build the plan via plan_install. apply=False -> return the plan, write/download
    NOTHING. apply=True:
      * status already-present -> no-op, changed:False.
      * a real install -> ATOMICALLY (1) fetch main.js + manifest.json (+styles.css
        if present) into a TEMP staging dir, requiring BOTH required files to
        download non-None or the whole op aborts leaving NO partial plugin dir and
        NO list edit; (2) os.replace the staged dir into place (never clobbering an
        existing main.js unless force); (3) only AFTER files are in place, add the
        id to community-plugins.json via save_enabled.
      * enable-only -> add to the list, NO download, NEVER clobber the existing dir.
      * blocked-existing (main.js present, not force) -> files untouched; a list-add
        may still occur if the id was missing.

    transport defaults to UrllibTransport(); downloader defaults to
    default_downloader(repo, transport); both injectable so tests are hermetic.

    Returns a status dict (dry-run vs apply shapes documented inline)."""
    from datetime import date as _date
    today = today or _date.today().isoformat()

    validate_plugin_id(plugin_id)
    plan = plan_install(vault, plugin_id, repo, force=force)

    if not apply:
        return {
            "plugin_id": plugin_id, "repo": repo, "apply": False,
            "status": plan["status"], "plan": plan, "written": [],
            "changed": False, "reason": plan.get("reason", ""),
        }

    # --- apply ---------------------------------------------------------------
    if transport is None:
        transport = _forge.UrllibTransport()
    if downloader is None:
        downloader = default_downloader(repo, transport)

    written: list = []
    downloaded: list = []
    changed = False

    status = plan["status"]

    if status == ST_ALREADY_PRESENT:
        return _apply_result(plugin_id, repo, ST_ALREADY_PRESENT, written,
                             downloaded, enabled=True, changed=False, reason="")

    if status == ST_ENABLE_ONLY:
        # files present, id missing from the list -> add to the list ONLY.
        p = _add_to_enabled(vault, plugin_id)
        if p is not None:
            written.append(p.as_posix())
            changed = True
        return _apply_result(plugin_id, repo, ST_ENABLE_ONLY, written,
                             downloaded, enabled=True, changed=changed, reason="")

    if status == ST_BLOCKED_EXISTING:
        # never clobber the existing dir; a list-add may still occur if missing.
        if plan["will_enable"]:
            p = _add_to_enabled(vault, plugin_id)
            if p is not None:
                written.append(p.as_posix())
                changed = True
        return _apply_result(plugin_id, repo, ST_BLOCKED_EXISTING, written,
                             downloaded, enabled=is_enabled(vault, plugin_id),
                             changed=changed, reason=plan["reason"])

    # status is install-and-enable or install-only -> a real download.
    try:
        staged_files, downloaded = _stage_download(vault, plugin_id, downloader)
    except _forge.TransportError as e:
        # network failure (non-200/404) -> structured, no disk mutation.
        return _apply_result(plugin_id, repo, status, [], [],
                             enabled=is_enabled(vault, plugin_id), changed=False,
                             reason=f"download failed: {e}")
    except Exception as e:
        # ANY other downloader/staging failure (e.g. a transport that returns a
        # non-bytes body -> bytes() TypeError) -> a STRUCTURED result, not an
        # unstructured crash out of the public API. _stage_download has already
        # removed its staging dir before re-raising, so there is no partial dir and
        # no list edit -- atomicity is preserved.
        return _apply_result(plugin_id, repo, status, [], [],
                             enabled=is_enabled(vault, plugin_id), changed=False,
                             reason=f"download failed: {type(e).__name__}: {e}")

    if staged_files is None:
        # a required asset 404'd -> abort, NO partial dir, NO list edit.
        return _apply_result(plugin_id, repo, status, [], downloaded,
                             enabled=is_enabled(vault, plugin_id), changed=False,
                             reason=("required asset missing (main.js or "
                                     "manifest.json was 404/None); install aborted, "
                                     "no files written."))

    # atomically swap the staged dir into place.
    try:
        _swap_into_place(vault, plugin_id, staged_files, force=force)
    except Exception as e:
        return _apply_result(plugin_id, repo, status, [], downloaded,
                             enabled=is_enabled(vault, plugin_id), changed=False,
                             reason=f"swap failed: {e}")
    changed = True
    d = plugin_dir(vault, plugin_id)
    written.extend((d / f).as_posix() for f in downloaded)

    # only AFTER the files are in place, add the id to the enabled list (so the
    # list never names a plugin whose files are missing).
    if status == ST_INSTALL_AND_ENABLE:
        p = _add_to_enabled(vault, plugin_id)
        if p is not None:
            written.append(p.as_posix())

    return _apply_result(plugin_id, repo, status, written, downloaded,
                         enabled=is_enabled(vault, plugin_id), changed=changed,
                         reason="")


def _apply_result(plugin_id, repo, status, written, downloaded, *, enabled,
                  changed, reason) -> dict:
    return {
        "plugin_id": plugin_id, "repo": repo, "apply": True, "status": status,
        "written": written, "downloaded": downloaded, "enabled": enabled,
        "changed": changed, "reason": reason,
    }


def _add_to_enabled(vault, plugin_id: str) -> Optional[Path]:
    """Append the id to community-plugins.json (preserving prior formatting),
    de-duped. Returns the written path, or None on no-op/failure. save_enabled is
    idempotent (no spurious write when already byte-identical)."""
    ids, meta = load_enabled(vault)
    if plugin_id not in ids:
        ids = ids + [plugin_id]
    try:
        return save_enabled(vault, ids, meta)
    except OSError:
        return None


def _stage_download(vault, plugin_id: str, downloader: "Callable"):
    """Download the assets into a TEMP staging dir under .obsidian/plugins/. The
    op aborts (returns (None, downloaded)) if EITHER required asset is None/404,
    leaving NO partial dir (the staging dir is removed). Returns
    (staging_dir_path, downloaded_filenames) on success.

    A fresh randomized staging name avoids collision with a prior crashed run; on
    any abort/error the staging dir is unlinked."""
    plugins_root = _obsidian_dir(vault) / PLUGINS_SUBDIR
    plugins_root.mkdir(parents=True, exist_ok=True)
    # a sibling temp dir under the plugins root so the final os.replace is on the
    # same filesystem (atomic rename).
    staging = Path(tempfile.mkdtemp(prefix=f"{plugin_id}.tmp-", dir=plugins_root))
    downloaded: list = []
    try:
        # required files first -> abort early if a required asset is absent.
        for fname in REQUIRED_FILES:
            body = downloader(fname)
            if body is None:
                _rmtree(staging)
                return (None, downloaded)
            _write_lf_bytes(staging / fname, body)
            downloaded.append(fname)
        # optional files: a 404 (None) is fine, just skip it.
        for fname in OPTIONAL_FILES:
            body = downloader(fname)
            if body is None:
                continue
            _write_lf_bytes(staging / fname, body)
            downloaded.append(fname)
    except _forge.TransportError:
        _rmtree(staging)
        raise
    except Exception:
        _rmtree(staging)
        raise
    return (staging, downloaded)


def _swap_into_place(vault, plugin_id: str, staging: Path, *, force: bool) -> None:
    """Move the completed staging dir to its final plugin dir ATOMICALLY, never
    leaving a destroyed-old-dir-but-no-new-dir half-state and never clobbering the
    user's non-asset files (data.json etc.).

    Without force, an existing dir with main.js present is NOT clobbered (caller
    routes those to blocked-existing, so here force=True or the dir is
    absent/partial).

    No existing dir -> a single os.replace(staging, final) (already atomic).

    Existing dir -> a backup-aside swap that is restartable from any failure point:
      (1) os.replace the old dir to a sibling backup name (atomic rename); the old
          install is now safely aside, not deleted.
      (2) os.replace the staging dir into the now-free final path. If THIS raises
          (EXDEV, a locked file, perms, a transient FS error) the old dir is
          restored from backup so the previously-working install is never lost, and
          the staging dir is removed -- so a failure leaves the vault EXACTLY as it
          was found (old files intact, no orphaned .tmp- dir).
      (3) carry the user's preserved non-asset files (data.json -- plugin settings /
          board config) over from the backup into the freshly-installed dir, then
          delete the backup. A force re-download thus refreshes only the asset
          files and never wipes the user's settings.

    On ANY exception the staging dir is cleaned before re-raising, so ensure_plugin
    never has to (no leaked staging dir on the swap-failure path)."""
    final = plugin_dir(vault, plugin_id)
    if not final.exists():
        # nothing to preserve or restore -> a single atomic rename. Clean staging
        # if even that fails so no .tmp- dir is left behind.
        try:
            final.parent.mkdir(parents=True, exist_ok=True)
            os.replace(staging, final)
        except Exception:
            _rmtree(staging)
            raise
        return

    if not force and (final / MAIN_JS).exists():
        # defensive: should never reach here (blocked-existing handled it).
        _rmtree(staging)
        raise FileExistsError(f"{final.as_posix()} exists (use --force)")

    # an existing dir is being replaced. Move it ASIDE first (atomic rename) so it
    # is never destroyed before the new dir is in place.
    backup = final.parent / f"{plugin_id}.bak-{os.urandom(4).hex()}"
    final.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.replace(final, backup)
    except Exception:
        # could not even move the old dir aside -> old dir untouched; just drop the
        # staging dir and re-raise (no mutation, no leak).
        _rmtree(staging)
        raise

    try:
        os.replace(staging, final)
    except Exception:
        # the swap failed AFTER the old dir was moved aside -> RESTORE it so the
        # working install is not lost, then clean the staging dir, then re-raise.
        try:
            os.replace(backup, final)
        except Exception:
            _rmtree(staging)
            raise
        _rmtree(staging)
        raise

    # new dir is in place. Carry the user's preserved non-asset files (data.json,
    # etc.) over from the backup, WITHOUT overwriting any freshly-downloaded asset,
    # then delete the backup. Best-effort: a copy failure must not undo the swap.
    _carry_preserved_files(backup, final)
    _rmtree(backup)


# Files a --force re-download is allowed to replace; everything ELSE in the old
# plugin dir (most importantly data.json -- the plugin's persisted settings/board
# config) is the user's and is carried across the swap.
_ASSET_FILES = frozenset(ALL_ASSET_FILES)


def _carry_preserved_files(backup: Path, final: Path) -> None:
    """Copy every NON-asset file from the old dir (backup) into the new dir (final)
    that the new dir does not already provide, so a force re-download preserves
    data.json and any other user/plugin-created file. Best-effort; never raises."""
    import shutil
    try:
        entries = list(backup.iterdir())
    except OSError:
        return
    for src in entries:
        try:
            if src.name in _ASSET_FILES:
                continue  # refreshed by the download; do not resurrect the old one.
            dst = final / src.name
            if dst.exists():
                continue  # new dir already has it; do not clobber.
            if src.is_dir():
                shutil.copytree(src, dst)
            else:
                shutil.copy2(src, dst)
        except Exception:
            # one un-copyable file must not abort the whole carry-over.
            continue


def _write_lf_bytes(path: Path, body: bytes) -> None:
    """Write asset bytes verbatim (binary assets like main.js/manifest.json are
    not newline-normalized -- they are downloaded artifacts, written byte-exact)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(body if isinstance(body, (bytes, bytearray)) else bytes(body))


def _rmtree(path: Path) -> None:
    """Best-effort recursive delete of a staging/old dir (never raises out)."""
    import shutil
    try:
        shutil.rmtree(path, ignore_errors=True)
    except Exception:
        pass
