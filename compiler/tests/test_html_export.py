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
    """_inject_footer inserts a build-timestamp footer before </body>."""
    from html_export.exporter import _inject_footer

    html = "<html><body><p>hi</p></body></html>"
    result = _inject_footer(html, "2026-07-12T08:15:00Z")
    assert 'class="wiki-build-footer"' in result
    assert "Compiled: 2026-07-12T08:15:00Z" in result
    assert result.index('class="wiki-build-footer"') < result.index("</body>")


def test_inject_footer_noop_when_timestamp_empty():
    """Empty build_timestamp leaves the HTML unchanged (opt-in behavior)."""
    from html_export.exporter import _inject_footer

    html = "<html><body><p>hi</p></body></html>"
    assert _inject_footer(html, "") == html


def test_export_stamps_explicit_build_timestamp_in_every_page(tmp_path):
    """export_to_html threads options.build_timestamp into every rendered page."""
    import pytest

    if not _pandoc_available():
        pytest.skip("pandoc not installed")

    from html_export.exporter import ExportOptions, export_to_html

    wiki_dir = _make_wiki(tmp_path, with_index=False)
    output_dir = tmp_path / "html"
    fixed_ts = "2026-07-12T03:00:00Z"
    export_to_html(wiki_dir, output_dir, ExportOptions(build_timestamp=fixed_ts))

    for rel in ("index.html", "concepts/attention-heads.html", "summaries/overview.html"):
        content = (output_dir / rel).read_text("utf-8")
        assert f"Compiled: {fixed_ts}" in content, f"missing footer stamp in {rel}"


def test_export_defaults_footer_timestamp_to_now(tmp_path):
    """Without an explicit build_timestamp, export_to_html stamps UTC 'now'."""
    import re

    import pytest

    if not _pandoc_available():
        pytest.skip("pandoc not installed")

    from html_export.exporter import ExportOptions, export_to_html

    wiki_dir = _make_wiki(tmp_path, with_index=False)
    output_dir = tmp_path / "html"
    export_to_html(wiki_dir, output_dir, ExportOptions())

    content = (output_dir / "index.html").read_text("utf-8")
    match = re.search(r"Compiled: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)", content)
    assert match is not None, "no footer timestamp found in exported index.html"


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

    note_content = (output_dir / "01-Projects" / "note-a.html").read_text("utf-8")
    assert f"Compiled: {fixed_ts}" in note_content

    index_content = (output_dir / "index.html").read_text("utf-8")
    assert "01-Projects" in index_content
    assert "06-Daily" in index_content
    assert "00-Inbox" not in index_content


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
