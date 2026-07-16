"""Service worker emission for HTML exports (LMVK L4).

spec: docs/specs/lmvk-execution-and-release.md — "html_export 产物加 service
worker——stale-while-revalidate + 构建时 precache manifest 全站预缓存，>100MB
降级「索引+最近30天」；缓存版本随构建时间戳失效；与 basic_auth 同源兼容。"

Zero-dep like the rest of the compiler: ``sw.js`` is produced from a static
template (``static/sw.template.js``) by plain placeholder substitution --
no bundler, no npm. The build-time decisions live here in Python; the
template only receives a cache name and a URL list.

basic_auth compatibility (L3 caddy front): the worker only touches
same-origin GET requests via plain ``fetch(request)``, so the browser
attaches the Authorization header itself, and no cache-busting query
params are ever appended (they would defeat the browser's auth cache).
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

SW_FILENAME = "sw.js"
SW_TEMPLATE_FILENAME = "sw.template.js"

# Full-site precache budget. At or under this, the whole export is precached
# on install; over it we degrade to「索引+最近30天」-- index page(s) + css/js
# assets + pages whose *source note* mtime falls within the window (LMVK L4).
PRECACHE_LIMIT_BYTES = 100 * 1024 * 1024

# Degraded-mode recency window ("最近30天"), keyed off the source note's
# mtime -- not the exported HTML's mtime, which is always "just now" after
# a build and would make every page look recent.
RECENT_WINDOW_DAYS = 30


@dataclass
class PrecacheManifest:
    """Build-time precache decision for one export run."""

    mode: str = "full"  # "full" | "degraded"
    urls: list[str] = field(default_factory=list)
    total_bytes: int = 0  # whole-site size the decision was made on
    kept_bytes: int = 0
    dropped: list[str] = field(default_factory=list)
    limit_bytes: int = PRECACHE_LIMIT_BYTES


def cache_version_from_timestamp(build_timestamp: str) -> str:
    """Derive the versioned Cache Storage name from the build timestamp
    (LMVK L4: "缓存版本随构建时间戳失效"). Same timestamp -> same name; any
    new build -> new name, so ``activate`` drops every previous build's
    cache. Non-alphanumerics are squashed because the name is embedded in a
    JS string literal in the template."""
    slug = re.sub(r"[^0-9A-Za-z]+", "", build_timestamp) or "0"
    return f"llm-wiki-{slug}"


def _is_index_or_static(rel_url: str) -> bool:
    """Degraded-mode always-keep set: index page(s) plus css/js assets
    (theme ``css/style.css``, ``static/wiki.js``/``wiki.css``) -- the shell
    needed to render whatever pages do get cached offline."""
    if rel_url.split("/")[-1] == "index.html":
        return True
    return rel_url.endswith(".css") or rel_url.endswith(".js")


def build_precache_manifest(
    entries: list[tuple[str, int]],
    source_mtimes: dict[str, float],
    now: float | None = None,
    limit_bytes: int | None = None,
    recent_days: int = RECENT_WINDOW_DAYS,
) -> PrecacheManifest:
    """Decide the precache URL set from ``(rel_url, size_bytes)`` entries.

    Pure function of its inputs -- sizes and mtimes are passed in, never
    stat'd here -- so the >100MB degrade branch is testable with fake sizes
    instead of 100MB of fixtures.

    Args:
        entries: every exported file, as (POSIX path relative to the output
            root, size in bytes). ``sw.js`` itself must not be included.
        source_mtimes: rel path -> source note mtime (epoch seconds) for
            pages that have a markdown source; assets and generated pages
            simply aren't in the dict and rely on ``_is_index_or_static``.
        now: epoch seconds for the recency cutoff (default: ``time.time()``;
            pin it in tests).
        limit_bytes / recent_days: overridable thresholds (defaults are the
            LMVK L4 spec values: 100MB, 30 days). ``limit_bytes=None`` reads
            ``PRECACHE_LIMIT_BYTES`` at call time so tests can monkeypatch
            the module constant.
    """
    if limit_bytes is None:
        limit_bytes = PRECACHE_LIMIT_BYTES
    total = sum(size for _, size in entries)
    if total <= limit_bytes:
        return PrecacheManifest(
            mode="full",
            urls=sorted(url for url, _ in entries),
            total_bytes=total,
            kept_bytes=total,
            limit_bytes=limit_bytes,
        )

    cutoff = (now if now is not None else time.time()) - recent_days * 86400
    kept: list[str] = []
    dropped: list[str] = []
    kept_bytes = 0
    for rel_url, size in entries:
        if _is_index_or_static(rel_url) or source_mtimes.get(rel_url, 0) >= cutoff:
            kept.append(rel_url)
            kept_bytes += size
        else:
            dropped.append(rel_url)
    return PrecacheManifest(
        mode="degraded",
        urls=sorted(kept),
        total_bytes=total,
        kept_bytes=kept_bytes,
        dropped=sorted(dropped),
        limit_bytes=limit_bytes,
    )


def _collect_export_entries(output_dir: Path) -> list[tuple[str, int]]:
    """Enumerate every file under the export root as (rel POSIX url, bytes).

    ``sw.js`` itself is excluded -- the worker must not precache its own
    script (the browser refetches it on navigation to detect new builds).
    """
    root = Path(output_dir)
    entries: list[tuple[str, int]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(root).as_posix()
        if rel == SW_FILENAME:
            continue
        entries.append((rel, path.stat().st_size))
    return entries


def _log_precache_decision(manifest: PrecacheManifest) -> None:
    """Print which precache mode was chosen and what got dropped (LMVK L4
    observability -- the compile leg's schtasks log is the only place a
    headless build's decisions are visible)."""
    total_mb = manifest.total_bytes / (1024 * 1024)
    limit_mb = manifest.limit_bytes // (1024 * 1024)
    if manifest.mode == "full":
        print(
            f"  [sw] precache: full site "
            f"({len(manifest.urls)} files, {total_mb:.1f} MB <= {limit_mb} MB limit)"
        )
        return
    kept_mb = manifest.kept_bytes / (1024 * 1024)
    preview = ", ".join(manifest.dropped[:5])
    if len(manifest.dropped) > 5:
        preview += ", ..."
    print(
        f"  [sw] precache: degraded -- site is {total_mb:.1f} MB > {limit_mb} MB limit"
    )
    print(
        f"  [sw]   keeping {len(manifest.urls)} files ({kept_mb:.1f} MB): "
        f"index + css/js + sources touched in last {RECENT_WINDOW_DAYS} days"
    )
    print(f"  [sw]   dropped {len(manifest.dropped)} files: {preview}")


def emit_service_worker(
    output_dir: Path,
    build_timestamp: str,
    source_mtimes: dict[str, float] | None = None,
) -> PrecacheManifest:
    """Write ``sw.js`` at the export root with the build-time precache
    manifest baked in.

    Call this *after* every page/asset has been written so the manifest
    sees the complete export. Returns the manifest so callers (and tests)
    can inspect the full/degraded decision.
    """
    entries = _collect_export_entries(output_dir)
    manifest = build_precache_manifest(entries, source_mtimes or {})

    template = (Path(__file__).parent / "static" / SW_TEMPLATE_FILENAME).read_text("utf-8")
    sw_js = template.replace("__CACHE_VERSION__", cache_version_from_timestamp(build_timestamp))
    sw_js = sw_js.replace("__PRECACHE_URLS__", json.dumps(manifest.urls))
    (Path(output_dir) / SW_FILENAME).write_text(sw_js, "utf-8")

    _log_precache_decision(manifest)
    return manifest
