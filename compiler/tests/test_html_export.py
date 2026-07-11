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


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
