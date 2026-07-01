"""Tests for link extraction (PR1)."""
import pytest
from pathlib import Path
from obc.extract import extract_links, extract_vault_links, LinkKind


class TestExtractLinks:
    """Test extract_links function."""

    def test_extract_wikilink(self):
        """Should extract simple wikilink."""
        content = "[[Target]]"
        links = extract_links(content, Path("test.md"), iter([0]))

        assert len(links) == 1
        assert links[0].kind == LinkKind.WIKILINK
        assert links[0].target_raw == "Target"
        assert links[0].raw_text == "[[Target]]"

    def test_extract_wikilink_with_alias(self):
        """Should extract wikilink with alias."""
        content = "[[Target|Display Text]]"
        links = extract_links(content, Path("test.md"), iter([0]))

        assert len(links) == 1
        assert links[0].alias == "Display Text"
        assert links[0].target_raw == "Target"

    def test_extract_wikilink_with_fragment(self):
        """Should extract wikilink with heading fragment."""
        content = "[[Target#Heading]]"
        links = extract_links(content, Path("test.md"), iter([0]))

        assert len(links) == 1
        assert links[0].target_path_part == "Target"
        assert links[0].fragment == "Heading"

    def test_extract_wikilink_with_block(self):
        """Should extract wikilink with block reference."""
        content = "[[Target#^block-id]]"
        links = extract_links(content, Path("test.md"), iter([0]))

        assert len(links) == 1
        assert links[0].target_path_part == "Target"
        assert links[0].fragment == "^block-id"

    def test_extract_embed(self):
        """Should extract embed."""
        content = "![[Target]]"
        links = extract_links(content, Path("test.md"), iter([0]))

        assert len(links) == 1
        assert links[0].kind == LinkKind.EMBED
        assert links[0].target_raw == "Target"

    def test_extract_markdown_link(self):
        """Should extract markdown link."""
        content = "[Display](target.md)"
        links = extract_links(content, Path("test.md"), iter([0]))

        assert len(links) == 1
        assert links[0].kind == LinkKind.MARKDOWN
        assert links[0].target_raw == "target.md"
        assert links[0].alias == "Display"

    def test_extract_markdown_link_with_fragment(self):
        """Should extract markdown link with fragment."""
        content = "[Display](target.md#Heading)"
        links = extract_links(content, Path("test.md"), iter([0]))

        assert len(links) == 1
        assert links[0].target_path_part == "target.md"
        assert links[0].fragment == "Heading"

    def test_skip_external_links(self):
        """Should skip external http links."""
        content = "[Google](https://google.com)"
        links = extract_links(content, Path("test.md"), iter([0]))

        assert len(links) == 0

    def test_skip_code_blocks(self):
        """Should skip links inside code blocks."""
        content = """
```
[[Target]]
```
[[RealTarget]]
"""
        links = extract_links(content, Path("test.md"), iter([0]))

        assert len(links) == 1
        assert links[0].target_raw == "RealTarget"

    def test_skip_inline_code(self):
        """Should skip links inside inline code."""
        content = "`[[Target]]` and [[RealTarget]]"
        links = extract_links(content, Path("test.md"), iter([0]))

        assert len(links) == 1
        assert links[0].target_raw == "RealTarget"

    def test_multiple_links(self):
        """Should extract multiple links."""
        content = "[[Link1]] and [[Link2]] and [Text](link3.md)"
        links = extract_links(content, Path("test.md"), iter([0]))

        assert len(links) == 3

    def test_preserves_line_numbers(self):
        """Should preserve correct line numbers."""
        content = """Line 1
Line 2
[[Target]]
Line 4"""
        links = extract_links(content, Path("test.md"), iter([0]))

        assert len(links) == 1
        assert links[0].line == 3
