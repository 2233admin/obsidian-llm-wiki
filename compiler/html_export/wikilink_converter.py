"""Wikilink to HTML anchor converter.

Converts Obsidian-style [[wikilinks]] to HTML anchors with relative paths.
"""

from __future__ import annotations

import re
from pathlib import Path

# Pattern: [[target]] or [[target|display]] or [[target#section]]
WIKILINK_RE = re.compile(r"\[\[([^\]|#\n]+?)(?:#([^\]|\n]+))?(?:\|([^\]\n]+))?\]\]")


def slugify(name: str) -> str:
    """Convert a name to a filesystem-safe slug."""
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-{2,}", "-", slug)
    return slug.strip("-")[:80]


def wikilinks_to_html(
    text: str,
    source_path: Path | None = None,
    base_dir: Path | None = None,
) -> str:
    """Convert wikilinks in text to HTML anchors.

    Args:
        text: Markdown text containing wikilinks
        source_path: Path to the source file (for relative link calculation)
        base_dir: Base directory for output (default: source_path.parent)

    Examples:
        >>> wikilinks_to_html("See [[attention-heads]] for details.")
        'See <a href="concepts/attention-heads.html">attention-heads</a> for details.'

        >>> wikilinks_to_html("[[kv-cache|KV Cache]]")
        '<a href="concepts/kv-cache.html">KV Cache</a>'
    """
    if base_dir is None:
        base_dir = source_path.parent if source_path else Path(".")

    def replace_wikilink(match: re.Match) -> str:
        target = match.group(1).strip()
        section = match.group(2)
        display = match.group(3)

        # Split target from any sub-path (e.g., [[concepts/attention]])
        if "/" in target:
            parts = target.rsplit("/", 1)
            folder = parts[0] + "/"
            name = parts[1]
        else:
            folder = "concepts/"
            name = target

        # Slugify the name for filename
        slug = slugify(name)

        # Build the href
        href = f"{folder}{slug}.html"
        if section:
            href += f"#{slugify(section)}"

        # Use display text or fallback to name
        display_text = display.strip() if display else name

        return f'<a href="{href}">{display_text}</a>'

    return WIKILINK_RE.sub(replace_wikilink, text)


def convert_file(source: Path, target: Path, base_dir: Path | None = None) -> int:
    """Convert wikilinks in a file and write to target.

    Args:
        source: Source markdown file
        target: Target HTML file (will be written as .md first, then converted)
        base_dir: Base directory for relative paths

    Returns:
        Number of wikilinks converted
    """
    content = source.read_text("utf-8-sig", errors="replace")

    # Count wikilinks before conversion
    count = len(WIKILINK_RE.findall(content))

    # Convert wikilinks
    converted = wikilinks_to_html(content, source, base_dir)

    # Write to target (still .md for now, will be processed by Pandoc)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(converted, "utf-8")

    return count


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python wikilink_converter.py <input.md> [output.md]")
        sys.exit(1)

    input_file = Path(sys.argv[1])
    output_file = Path(sys.argv[2]) if len(sys.argv) > 2 else input_file.with_suffix(".html.md")

    count = convert_file(input_file, output_file)
    print(f"Converted {count} wikilink(s) -> {output_file}")
