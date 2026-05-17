"""Tests for HTML export module."""

import sys
from pathlib import Path

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from html_export.wikilink_converter import wikilinks_to_html, slugify


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
    from html_export.exporter import _process_markdown
    from pathlib import Path

    text = """# Test Document

See [[attention-heads]] for details.

> [!TIP]
> This is a helpful tip.
"""
    result = _process_markdown(text, Path("test.md"))
    assert 'href="concepts/attention-heads.html"' in result
    assert 'class="callout callout-tip"' in result


if __name__ == "__main__":
    import pytest

    pytest.main([__file__, "-v"])
