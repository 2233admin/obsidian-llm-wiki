"""Tests for HTML export module."""

import sys
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from html_export.wikilink_converter import slugify, wikilinks_to_html


def test_basic_wikilink():
    """Test basic [[wikilink]] conversion."""
    text = "See [[attention-heads]] for details."
    result = wikilinks_to_html(text)
    assert '<a href="concepts/attention-heads.html">attention-heads</a>' in result
    assert "See" in result
    assert "for details." in result


def test_alias_wikilink():
    """Test [[wikilink|display]] conversion."""
    text = "[[kv-cache|KV Cache]]"
    result = wikilinks_to_html(text)
    assert '<a href="concepts/kv-cache.html">KV Cache</a>' in result


def test_section_link():
    """Test [[wikilink#section]] conversion."""
    text = "See [[attention-heads#math]] for the math."
    result = wikilinks_to_html(text)
    assert 'href="concepts/attention-heads.html#math"' in result


def test_slugify():
    """Test slugify function."""
    assert slugify("KV Cache") == "kv-cache"
    assert slugify("Multi-Head Attention") == "multi-head-attention"
    assert slugify("Transformer (Original)") == "transformer-original"


def test_multiple_wikilinks():
    """Test multiple wikilinks in one text."""
    text = "[[a]] and [[b|display]] and [[c]]"
    result = wikilinks_to_html(text)
    assert result.count('<a href=') == 3
    assert 'concepts/a.html' in result
    assert 'concepts/b.html' in result
    assert 'concepts/c.html' in result


def test_no_wikilinks():
    """Test text without wikilinks."""
    text = "This is just plain text."
    result = wikilinks_to_html(text)
    assert result == text


def test_external_links_preserved():
    """Test that regular markdown links are left unchanged by wikilinks_to_html."""
    text = "Check [this link](https://example.com)."
    result = wikilinks_to_html(text)
    # wikilinks_to_html only converts [[wikilinks]], regular markdown links stay as-is
    assert result == text


def test_callout_conversion():
    """Test Obsidian callout conversion."""
    from html_export.exporter import _convert_callouts

    text = """> [!NOTE]
> This is a note.
> With multiple lines.
"""
    result = _convert_callouts(text)
    assert 'class="callout callout-note"' in result
    assert "<p>This is a note.</p>" in result


def test_callout_types():
    """Test all callout types."""
    from html_export.exporter import _convert_callouts

    for callout_type in ["NOTE", "TIP", "WARNING", "INFO", "EXAMPLE"]:
        text = f"> [!{callout_type}]\n> Content here.\n"
        result = _convert_callouts(text)
        assert f'class="callout callout-{callout_type.lower()}"' in result


def test_markdown_processing():
    """Test full markdown processing pipeline."""
    from pathlib import Path

    from html_export.exporter import _process_markdown

    text = """# Test Document

See [[attention-heads]] for details.

> [!TIP]
> This is a helpful tip.
"""
    result = _process_markdown(text, Path("test.md"))
    assert 'href="concepts/attention-heads.html"' in result
    assert 'class="callout callout-tip"' in result


def _make_wiki(tmp_path: Path, with_index: bool) -> Path:
    """Create a minimal wiki dir with one concept and one summary."""
    wiki_dir = tmp_path / "wiki"
    (wiki_dir / "concepts").mkdir(parents=True)
    (wiki_dir / "summaries").mkdir()
    (wiki_dir / "concepts" / "attention-heads.md").write_text(
        "# Attention Heads\n\nContent.\n", "utf-8"
    )
    (wiki_dir / "summaries" / "overview.md").write_text(
        "# Overview\n\nContent.\n", "utf-8"
    )
    if with_index:
        (wiki_dir / "_index.md").write_text(
            "# My Wiki Home\n\nHand-written index.\n", "utf-8"
        )
    return wiki_dir


def test_generate_index_fragment(tmp_path):
    """_generate_index builds links for concepts and summaries."""
    from html_export.exporter import _generate_index

    wiki_dir = _make_wiki(tmp_path, with_index=False)
    fragment = _generate_index(wiki_dir, tmp_path / "html")

    assert '<a href="concepts/attention-heads.html">Attention Heads</a>' in fragment
    assert '<a href="summaries/overview.html">Overview</a>' in fragment
    assert "<h2>Concepts</h2>" in fragment
    assert "<h2>Summaries</h2>" in fragment


def _pandoc_available() -> bool:
    from html_export.exporter import _check_pandoc

    return _check_pandoc()[0]


def test_export_fallback_index_when_no_index_md(tmp_path):
    """export_to_html generates index.html when wiki has no _index.md."""
    import pytest

    if not _pandoc_available():
        pytest.skip("pandoc not installed")

    from html_export.exporter import ExportOptions, export_to_html

    wiki_dir = _make_wiki(tmp_path, with_index=False)
    output_dir = tmp_path / "html"
    report = export_to_html(wiki_dir, output_dir, ExportOptions())

    index_html = output_dir / "index.html"
    assert index_html.exists()
    content = index_html.read_text("utf-8")
    # Listing links to exported pages
    assert 'href="concepts/attention-heads.html"' in content
    assert 'href="summaries/overview.html"' in content
    # Rendered with the shared asset pipeline
    assert "static/wiki.css" in content
    assert "static/wiki.js" in content
    # 2 pages + fallback index, no failures, no leftover temp markdown
    assert report.files_exported == 3
    assert report.files_failed == 0
    assert not (output_dir / "index.md").exists()


def test_export_uses_index_md_when_present(tmp_path):
    """export_to_html renders _index.md via Pandoc when it exists."""
    import pytest

    if not _pandoc_available():
        pytest.skip("pandoc not installed")

    from html_export.exporter import ExportOptions, export_to_html

    wiki_dir = _make_wiki(tmp_path, with_index=True)
    output_dir = tmp_path / "html"
    report = export_to_html(wiki_dir, output_dir, ExportOptions())

    content = (output_dir / "index.html").read_text("utf-8")
    assert "My Wiki Home" in content
    assert "Hand-written index." in content
    assert report.files_exported == 3
    assert report.files_failed == 0


def test_export_no_index_when_disabled(tmp_path):
    """include_index=False skips both _index.md and the fallback."""
    import pytest

    if not _pandoc_available():
        pytest.skip("pandoc not installed")

    from html_export.exporter import ExportOptions, export_to_html

    wiki_dir = _make_wiki(tmp_path, with_index=False)
    output_dir = tmp_path / "html"
    export_to_html(wiki_dir, output_dir, ExportOptions(include_index=False))

    assert not (output_dir / "index.html").exists()


def test_inject_footer_stamps_before_body_close():
    """_inject_footer inserts the build footer before </body>, with the stamp
    pointed at build-info.json rather than baked into the markup."""
    from html_export.exporter import _inject_footer

    html = "<html><body><p>hi</p></body></html>"
    result = _inject_footer(html, "2026-07-12T08:15:00Z")
    assert 'class="wiki-build-footer"' in result
    assert 'data-build-info="build-info.json"' in result
    assert result.index('class="wiki-build-footer"') < result.index("</body>")
    # The literal timestamp must NOT appear -- that is what made every page's
    # bytes change on every build.
    assert "2026-07-12T08:15:00Z" not in result


def test_inject_footer_resolves_build_info_through_asset_prefix():
    """A nested page reads the one root build-info.json, not a sibling."""
    from html_export.exporter import _inject_footer

    html = "<html><body><p>hi</p></body></html>"
    result = _inject_footer(html, "2026-07-12T08:15:00Z", asset_prefix="../")
    assert 'data-build-info="../build-info.json"' in result


def test_inject_footer_noop_when_timestamp_empty():
    """Empty build_timestamp leaves the HTML unchanged (opt-in behavior)."""
    from html_export.exporter import _inject_footer

    html = "<html><body><p>hi</p></body></html>"
    assert _inject_footer(html, "") == html


def test_footer_bytes_stable_across_builds():
    """REGRESSION GATE. Two builds minutes apart must produce identical page
    bytes. When the stamp was inlined, every page changed on every build, so
    a publish that touched three notes still pushed a 3646-file diff and took
    ~8 minutes -- at which size the NAS reverse proxy 502s or resets."""
    from html_export.exporter import _inject_footer

    html = "<html><body><p>hi</p></body></html>"
    first = _inject_footer(html, "2026-07-12T08:15:00Z")
    second = _inject_footer(html, "2026-07-12T08:45:00Z")
    assert first == second


def test_export_writes_build_info_and_leaves_pages_timestamp_free(tmp_path):
    """export_to_html emits one build-info.json carrying the stamp, and every
    page points at it instead of embedding it."""
    import json

    import pytest

    if not _pandoc_available():
        pytest.skip("pandoc not installed")

    from html_export.exporter import ExportOptions, export_to_html

    wiki_dir = _make_wiki(tmp_path, with_index=False)
    output_dir = tmp_path / "html"
    fixed_ts = "2026-07-12T03:00:00Z"
    export_to_html(wiki_dir, output_dir, ExportOptions(build_timestamp=fixed_ts))

    info = json.loads((output_dir / "build-info.json").read_text("utf-8"))
    assert info["build_timestamp"] == fixed_ts

    for rel, prefix in (
        ("index.html", ""),
        ("concepts/attention-heads.html", "../"),
        ("summaries/overview.html", "../"),
    ):
        content = (output_dir / rel).read_text("utf-8")
        assert 'class="wiki-build-footer"' in content, f"missing footer in {rel}"
        assert f'data-build-info="{prefix}build-info.json"' in content, rel
        assert fixed_ts not in content, f"{rel} still embeds the literal stamp"


def test_export_defaults_build_info_timestamp_to_now(tmp_path):
    """Without an explicit build_timestamp, export_to_html stamps UTC 'now'
    into build-info.json."""
    import json
    import re

    import pytest

    if not _pandoc_available():
        pytest.skip("pandoc not installed")

    from html_export.exporter import ExportOptions, export_to_html

    wiki_dir = _make_wiki(tmp_path, with_index=False)
    output_dir = tmp_path / "html"
    export_to_html(wiki_dir, output_dir, ExportOptions())

    info = json.loads((output_dir / "build-info.json").read_text("utf-8"))
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", info["build_timestamp"])


def test_export_pages_identical_across_two_builds(tmp_path):
    """End-to-end form of the regression gate: run the real exporter twice
    with different timestamps; only build-info.json (and sw.js, which
    versions its cache off the stamp by design) may differ."""
    import pytest

    if not _pandoc_available():
        pytest.skip("pandoc not installed")

    from html_export.exporter import ExportOptions, export_to_html

    wiki_dir = _make_wiki(tmp_path, with_index=False)

    def _render(out: Path, ts: str) -> dict[str, bytes]:
        export_to_html(wiki_dir, out, ExportOptions(build_timestamp=ts))
        return {
            p.relative_to(out).as_posix(): p.read_bytes()
            for p in sorted(out.rglob("*"))
            if p.is_file()
        }

    first = _render(tmp_path / "html-a", "2026-07-12T03:00:00Z")
    second = _render(tmp_path / "html-b", "2026-07-12T03:30:00Z")

    assert first.keys() == second.keys()
    changed = {rel for rel in first if first[rel] != second[rel]}
    assert changed <= {"build-info.json", "sw.js"}, f"unexpected churn: {sorted(changed)}"
    assert "build-info.json" in changed, "build-info.json should carry the new stamp"


def _make_organic_vault(tmp_path: Path) -> Path:
    """Build a PARA-style vault with no raw/wiki topic convention at all --
    mirrors D:\\knowledge's real shape (LMVK L2 export_vault_direct target)."""
    vault = tmp_path / "vault"
    (vault / "01-Projects").mkdir(parents=True)
    (vault / "01-Projects" / "note-a.md").write_text("# Note A\n\nHello.\n", "utf-8")
    (vault / "06-Daily" / "2026-07-12").mkdir(parents=True)
    (vault / "06-Daily" / "2026-07-12" / "log.md").write_text("# Log\n\nDaily.\n", "utf-8")
    (vault / "00-Inbox").mkdir(parents=True)
    (vault / "00-Inbox" / "unsorted.md").write_text("# Unsorted\n\nSecret draft.\n", "utf-8")
    (vault / ".obsidian").mkdir(parents=True)
    (vault / ".obsidian" / "workspace.json").write_text("{}", "utf-8")
    return vault


def test_iter_vault_markdown_files_recurses_and_prunes(tmp_path):
    """_iter_vault_markdown_files walks nested dirs and skips excluded/dot dirs."""
    from html_export.exporter import _iter_vault_markdown_files

    vault = _make_organic_vault(tmp_path)
    found = sorted(
        (str(p.relative_to(vault).as_posix()), rel_dir)
        for p, rel_dir in _iter_vault_markdown_files(vault, {"00-Inbox"})
    )
    assert found == [
        ("01-Projects/note-a.md", "01-Projects"),
        ("06-Daily/2026-07-12/log.md", "06-Daily/2026-07-12"),
    ]


def test_export_vault_direct_excludes_00_inbox_and_stamps_footer(tmp_path):
    """export_vault_direct (LMVK L2 whole-vault baseline): zero LLM, mirrors
    directory tree, 00-Inbox absent from output entirely, footer stamped."""
    import pytest

    if not _pandoc_available():
        pytest.skip("pandoc not installed")

    from html_export.exporter import ExportOptions, export_vault_direct

    vault = _make_organic_vault(tmp_path)
    output_dir = tmp_path / "html"
    fixed_ts = "2026-07-12T09:00:00Z"
    report = export_vault_direct(
        vault, output_dir, ExportOptions(build_timestamp=fixed_ts)
    )

    assert (output_dir / "01-Projects" / "note-a.html").exists()
    assert (output_dir / "06-Daily" / "2026-07-12" / "log.html").exists()
    assert not (output_dir / "00-Inbox").exists()

    # 2 real pages + generated index, no failures
    assert report.files_exported == 3
    assert report.files_failed == 0

    import json

    note_content = (output_dir / "01-Projects" / "note-a.html").read_text("utf-8")
    assert 'class="wiki-build-footer"' in note_content
    assert 'data-build-info="../build-info.json"' in note_content
    assert fixed_ts not in note_content

    info = json.loads((output_dir / "build-info.json").read_text("utf-8"))
    assert info["build_timestamp"] == fixed_ts

    index_content = (output_dir / "index.html").read_text("utf-8")
    assert "01-Projects" in index_content
    assert "06-Daily" in index_content
    assert "00-Inbox" not in index_content


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
