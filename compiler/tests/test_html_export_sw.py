"""Tests for the HTML export service worker (LMVK L4: PWA + SW).

spec: docs/specs/lmvk-execution-and-release.md — stale-while-revalidate +
build-time precache manifest, >100MB degrade to「索引+最近30天」, cache
version follows the build timestamp.
"""

import sys
import time
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from html_export.service_worker import (
    PRECACHE_LIMIT_BYTES,
    build_precache_manifest,
    cache_version_from_timestamp,
    emit_service_worker,
)

MB = 1024 * 1024


# ============================================================
# Cache version (缓存版本随构建时间戳失效)
# ============================================================


def test_cache_version_from_timestamp():
    """Cache name is derived deterministically from the build timestamp."""
    assert (
        cache_version_from_timestamp("2026-07-12T08:15:00Z")
        == "llm-wiki-20260712T081500Z"
    )


def test_cache_version_differs_per_build():
    """A new build timestamp yields a new cache name (old caches then get
    deleted on activate), and an empty timestamp still yields a valid name."""
    a = cache_version_from_timestamp("2026-07-12T08:15:00Z")
    b = cache_version_from_timestamp("2026-07-12T08:30:00Z")
    assert a != b
    assert cache_version_from_timestamp("") == "llm-wiki-0"


# ============================================================
# Precache manifest (fake sizes -- no 100MB fixtures)
# ============================================================


def _now() -> float:
    return time.time()


def test_precache_manifest_full_mode_under_limit():
    """Total <= 100MB: the whole site is precached, nothing dropped."""
    entries = [
        ("index.html", 10 * MB),
        ("css/style.css", 1 * MB),
        ("static/wiki.js", 1 * MB),
        ("concepts/a.html", 40 * MB),
    ]
    manifest = build_precache_manifest(entries, {}, now=_now())
    assert manifest.mode == "full"
    assert sorted(u for u, _ in entries) == manifest.urls
    assert manifest.total_bytes == 52 * MB
    assert manifest.dropped == []


def test_precache_manifest_exactly_at_limit_stays_full():
    """Spec says *>100MB* degrades -- exactly 100MB is still full-site."""
    entries = [("index.html", PRECACHE_LIMIT_BYTES)]
    manifest = build_precache_manifest(entries, {}, now=_now())
    assert manifest.mode == "full"


def test_precache_manifest_degrades_over_limit():
    """Total > 100MB: keep index page(s) + css/js + sources touched in the
    last 30 days; drop everything else."""
    now = _now()
    entries = [
        ("index.html", 1 * MB),
        ("css/style.css", 1 * MB),
        ("static/wiki.js", 1 * MB),
        ("static/wiki.css", 1 * MB),
        ("concepts/fresh.html", 60 * MB),
        ("concepts/stale.html", 60 * MB),
        ("summaries/no-mtime.html", 5 * MB),
    ]
    source_mtimes = {
        "concepts/fresh.html": now - 5 * 86400,  # 5 days old -> kept
        "concepts/stale.html": now - 90 * 86400,  # 90 days old -> dropped
        # summaries/no-mtime.html absent -> treated as stale -> dropped
    }
    manifest = build_precache_manifest(entries, source_mtimes, now=now)

    assert manifest.mode == "degraded"
    assert manifest.urls == [
        "concepts/fresh.html",
        "css/style.css",
        "index.html",
        "static/wiki.css",
        "static/wiki.js",
    ]
    assert manifest.dropped == ["concepts/stale.html", "summaries/no-mtime.html"]
    assert manifest.total_bytes == 129 * MB
    assert manifest.kept_bytes == 64 * MB


def test_precache_manifest_keeps_nested_index_pages():
    """Degraded mode keeps any */index.html, not just the root one."""
    entries = [
        ("index.html", 1 * MB),
        ("concepts/index.html", 1 * MB),
        ("concepts/old.html", 200 * MB),
    ]
    manifest = build_precache_manifest(entries, {}, now=_now())
    assert manifest.mode == "degraded"
    assert "concepts/index.html" in manifest.urls
    assert manifest.dropped == ["concepts/old.html"]


# ============================================================
# sw.js emission (no Pandoc needed -- fake export dir)
# ============================================================


def test_emit_service_worker_writes_versioned_sw(tmp_path, capsys):
    """emit_service_worker renders the template with the cache version and
    precache manifest baked in, excluding sw.js from its own manifest."""
    out = tmp_path / "html"
    (out / "concepts").mkdir(parents=True)
    (out / "index.html").write_text("<html></html>", "utf-8")
    (out / "concepts" / "a.html").write_text("<html></html>", "utf-8")

    manifest = emit_service_worker(out, "2026-07-12T08:15:00Z")

    sw = (out / "sw.js").read_text("utf-8")
    # Placeholders substituted, none left behind
    assert "__CACHE_VERSION__" not in sw
    assert "__PRECACHE_URLS__" not in sw
    assert '"llm-wiki-20260712T081500Z"' in sw
    # Manifest lists the exported files, never the worker itself
    assert '"index.html"' in sw
    assert '"concepts/a.html"' in sw
    assert '"sw.js"' not in sw
    # Tiny fixture site -> full mode, and the decision is logged
    assert manifest.mode == "full"
    assert "[sw] precache: full site" in capsys.readouterr().out


def test_emit_service_worker_logs_degraded_drops(tmp_path, monkeypatch, capsys):
    """The degrade decision (mode + what was dropped) is printed."""
    import html_export.service_worker as sw_mod

    out = tmp_path / "html"
    out.mkdir()
    (out / "index.html").write_text("<html></html>", "utf-8")
    (out / "old.html").write_text("<html>big</html>", "utf-8")

    # Shrink the budget instead of writing 100MB of fixtures
    monkeypatch.setattr(sw_mod, "PRECACHE_LIMIT_BYTES", 1)

    manifest = emit_service_worker(out, "2026-07-12T08:15:00Z")

    assert manifest.mode == "degraded"
    assert manifest.dropped == ["old.html"]
    logged = capsys.readouterr().out
    assert "[sw] precache: degraded" in logged
    assert "old.html" in logged


# ============================================================
# Page registration snippet
# ============================================================


def test_inject_assets_registers_sw_relative_no_query():
    """register_sw=True injects a registration pointing back to the export
    root via asset_prefix, with no cache-busting query string (it would
    defeat the basic_auth cache and split registrations per page)."""
    from html_export.exporter import _inject_assets

    html = "<html><head></head><body><p>hi</p></body></html>"
    result = _inject_assets(html, asset_prefix="../", register_sw=True)
    assert 'navigator.serviceWorker.register("../sw.js")' in result
    assert "sw.js?" not in result

    root_result = _inject_assets(html, asset_prefix="", register_sw=True)
    assert 'navigator.serviceWorker.register("sw.js")' in root_result


def test_inject_assets_no_sw_by_default():
    """Without register_sw the page stays SW-free (opt-in plumbing)."""
    from html_export.exporter import _inject_assets

    html = "<html><head></head><body><p>hi</p></body></html>"
    assert "serviceWorker" not in _inject_assets(html)


# ============================================================
# End-to-end wiring (both export modes; needs Pandoc)
# ============================================================


def _pandoc_available() -> bool:
    from html_export.exporter import _check_pandoc

    return _check_pandoc()[0]


def _make_wiki(tmp_path: Path) -> Path:
    """Minimal topic wiki (concepts/summaries convention)."""
    wiki_dir = tmp_path / "wiki"
    (wiki_dir / "concepts").mkdir(parents=True)
    (wiki_dir / "summaries").mkdir()
    (wiki_dir / "concepts" / "attention-heads.md").write_text(
        "# Attention Heads\n\nContent.\n", "utf-8"
    )
    (wiki_dir / "summaries" / "overview.md").write_text(
        "# Overview\n\nContent.\n", "utf-8"
    )
    return wiki_dir


def _make_organic_vault(tmp_path: Path) -> Path:
    """PARA-style vault for export_vault_direct (no topic convention)."""
    vault = tmp_path / "vault"
    (vault / "01-Projects").mkdir(parents=True)
    (vault / "01-Projects" / "note-a.md").write_text("# Note A\n\nHello.\n", "utf-8")
    (vault / "06-Daily" / "2026-07-12").mkdir(parents=True)
    (vault / "06-Daily" / "2026-07-12" / "log.md").write_text(
        "# Log\n\nDaily.\n", "utf-8"
    )
    return vault


def test_export_to_html_emits_sw_and_registers_every_page(tmp_path):
    """Topic export: sw.js at the output root, every page (root and nested)
    registers it with a depth-correct relative URL."""
    import pytest

    if not _pandoc_available():
        pytest.skip("pandoc not installed")

    from html_export.exporter import ExportOptions, export_to_html

    wiki_dir = _make_wiki(tmp_path)
    output_dir = tmp_path / "html"
    fixed_ts = "2026-07-12T08:15:00Z"
    report = export_to_html(wiki_dir, output_dir, ExportOptions(build_timestamp=fixed_ts))

    sw = (output_dir / "sw.js").read_text("utf-8")
    assert '"llm-wiki-20260712T081500Z"' in sw
    assert '"concepts/attention-heads.html"' in sw
    assert report.precache_mode == "full"

    index_content = (output_dir / "index.html").read_text("utf-8")
    assert 'navigator.serviceWorker.register("sw.js")' in index_content
    concept_content = (output_dir / "concepts" / "attention-heads.html").read_text("utf-8")
    assert 'navigator.serviceWorker.register("../sw.js")' in concept_content


def test_export_vault_direct_emits_sw(tmp_path):
    """Whole-vault direct export (production path): same sw.js wiring,
    registration prefix follows page depth in the mirrored tree."""
    import pytest

    if not _pandoc_available():
        pytest.skip("pandoc not installed")

    from html_export.exporter import ExportOptions, export_vault_direct

    vault = _make_organic_vault(tmp_path)
    output_dir = tmp_path / "html"
    fixed_ts = "2026-07-12T09:00:00Z"
    report = export_vault_direct(vault, output_dir, ExportOptions(build_timestamp=fixed_ts))

    sw = (output_dir / "sw.js").read_text("utf-8")
    assert '"llm-wiki-20260712T090000Z"' in sw
    assert '"01-Projects/note-a.html"' in sw
    assert '"06-Daily/2026-07-12/log.html"' in sw
    assert report.precache_mode == "full"

    deep_content = (output_dir / "06-Daily" / "2026-07-12" / "log.html").read_text("utf-8")
    assert 'navigator.serviceWorker.register("../../sw.js")' in deep_content


def test_export_service_worker_disabled(tmp_path):
    """service_worker=False (--no-sw): no sw.js, no registration snippet."""
    import pytest

    if not _pandoc_available():
        pytest.skip("pandoc not installed")

    from html_export.exporter import ExportOptions, export_to_html

    wiki_dir = _make_wiki(tmp_path)
    output_dir = tmp_path / "html"
    report = export_to_html(wiki_dir, output_dir, ExportOptions(service_worker=False))

    assert not (output_dir / "sw.js").exists()
    assert report.precache_mode == ""
    assert "serviceWorker" not in (output_dir / "index.html").read_text("utf-8")


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
