"""HTML exporter for llm-wiki compiled output.

Uses Pandoc to convert markdown to HTML with custom themes.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

from .wikilink_converter import wikilinks_to_html


@dataclass
class ExportOptions:
    """Options for HTML export."""

    theme: str = "reading"
    include_summaries: bool = True
    include_concepts: bool = True
    include_index: bool = True
    output_dir: Path | None = None
    base_url: str = ""


@dataclass
class ExportReport:
    """Report of an HTML export operation."""

    files_exported: int = 0
    files_failed: int = 0
    links_converted: int = 0
    theme: str = "reading"
    output_dir: Path | None = None


AVAILABLE_THEMES = ["article", "report", "reading", "interactive"]


def _get_theme_path(theme: str) -> Path | None:
    """Get the path to a theme's CSS file."""
    # Try to find theme relative to this file
    templates_dir = Path(__file__).parent / "templates"
    if templates_dir.exists():
        theme_dir = templates_dir / theme
        css_file = theme_dir / "style.css"
        if css_file.exists():
            return css_file
    return None


def _convert_code_blocks(text: str) -> str:
    """Convert markdown code blocks to Prism-compatible format.

    Adds data-lang attribute for Prism to detect and highlight.
    """
    import re

    # Pattern: ```language\ncontent\n```
    code_block_re = re.compile(
        r"```(\w+)\n(.*?)```",
        re.DOTALL
    )

    def replace_code_block(match: re.Match) -> str:
        lang = match.group(1).lower()
        content = match.group(2)
        # Use language-xxx class for Prism
        return f'```python\n{content}```'  # Let Pandoc handle the language

    # Don't modify - let Pandoc handle it with its own highlighting
    # Prism will re-highlight via class="language-xxx"
    return text


def _get_static_path(filename: str) -> Path | None:
    """Get path to a static asset."""
    static_dir = Path(__file__).parent / "static"
    path = static_dir / filename
    return path if path.exists() else None


def _copy_static_assets(output_dir: Path) -> None:
    """Copy wiki.js and wiki.css to output directory."""
    import shutil

    static_dir = output_dir / "static"
    static_dir.mkdir(exist_ok=True)

    for filename in ["wiki.js", "wiki.css"]:
        src = _get_static_path(filename)
        if src:
            shutil.copy2(src, static_dir / filename)


# CDN libraries for interactivity
CDN_LINKS = {
    "prism": {
        "css": "https://cdn.jsdelivr.net/npm/prismjs@1/themes/prism-tomorrow.min.css",
        "js": "https://cdn.jsdelivr.net/npm/prismjs@1/prism.min.js",
    },
    "mermaid": {
        "js": "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js",
    },
    "chart": {
        "js": "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js",
    },
}


def _inject_assets(html_content: str, has_interactive: bool = False) -> str:
    """Inject wiki.js, wiki.css, and CDN libraries into HTML content."""
    static_url = "static/"

    # Build CDN links based on needs
    cdn_links: list[str] = []

    # Prism.js for code highlighting
    cdn_links.append(f'  <link rel="stylesheet" href="{CDN_LINKS["prism"]["css"]}">')
    cdn_links.append(f'  <script src="{CDN_LINKS["prism"]["js"]}"></script>')

    # Mermaid.js for diagrams
    cdn_links.append(f'  <script src="{CDN_LINKS["mermaid"]["js"]}"></script>')

    # Chart.js for charts
    cdn_links.append(f'  <script src="{CDN_LINKS["chart"]["js"]}"></script>')

    cdn_html = "\n  ".join(cdn_links) + "\n"

    # Inject CSS before </head>
    css_link = f'  <link rel="stylesheet" href="{static_url}wiki.css">\n'
    if "</head>" in html_content:
        html_content = html_content.replace("</head>", css_link + cdn_html + "</head>")
    else:
        html_content = css_link + cdn_html + html_content

    # Inject JS before </body>
    js_script = f'  <script src="{static_url}wiki.js" defer></script>\n'
    if "</body>" in html_content:
        html_content = html_content.replace("</body>", js_script + "</body>")
    else:
        html_content = html_content + "\n" + js_script

    return html_content


def _check_pandoc() -> tuple[bool, str]:
    """Check if Pandoc is installed and return version."""
    try:
        result = subprocess.run(
            ["pandoc", "--version"],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            version = result.stdout.split("\n")[0]
            return True, version
        return False, ""
    except FileNotFoundError:
        return False, ""


def _run_pandoc(
    input_file: Path,
    output_file: Path,
    css_file: Path | None,
    title: str = "",
) -> bool:
    """Run Pandoc to convert markdown to HTML.

    Args:
        input_file: Input markdown file
        output_file: Output HTML file
        css_file: Optional CSS file to include
        title: Document title (for <title> tag)

    Returns:
        True if conversion succeeded
    """
    cmd = [
        "pandoc",
        str(input_file),
        "--standalone",
        "--from=markdown",
        "--to=html",
        "--no-highlight",  # Let Prism.js handle highlighting via CDN
        f"--output={output_file}",
    ]

    if css_file and css_file.exists():
        cmd.append(f"--css=css/style.css")

    if title:
        cmd.extend(["--metadata", f"title={title}"])

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  [warn] Pandoc error: {result.stderr}", file=sys.stderr)
        return False

    # Post-process: inject wiki.js and wiki.css
    if output_file.exists():
        html_content = output_file.read_text("utf-8")
        html_content = _inject_assets(html_content)
        output_file.write_text(html_content, "utf-8")

    return True


def _process_markdown(content: str, source_path: Path | None = None) -> str:
    """Pre-process markdown content before Pandoc conversion.

    - Convert wikilinks to HTML anchors
    - Convert tabs syntax
    - Convert Obsidian callouts
    - Clean up Obsidian-specific syntax
    """
    import re

    # Convert code blocks for Prism.js (before Pandoc processes them)
    content = _convert_code_blocks(content)

    # Convert wikilinks first
    content = wikilinks_to_html(content, source_path)

    # Convert tab panels: ```tabs\n```tab:Label\n...```\n```
    content = _convert_tabs(content)

    # Convert Obsidian callouts
    content = _convert_callouts(content)

    # Convert collapsed syntax: > [!collapsed]
    content = _convert_collapsed(content)

    # Convert Obsidian-specific syntax
    content = _clean_obsidian_syntax(content)

    return content


def _convert_tabs(text: str) -> str:
    """Convert tabs syntax to HTML tab panels.

    Syntax:
        ```tabs
        ```tab:Label1
        Content for tab 1
        ```

        ```tab:Label2
        Content for tab 2
        ```
        ```
    """
    import re

    # Pattern for tab blocks
    tab_block_re = re.compile(
        r"```tab:([^\n]+)\n(.*?)```",
        re.DOTALL
    )

    tabs: list[tuple[str, str]] = []
    output: list[str] = []
    last_end = 0

    for match in tab_block_re.finditer(text):
        # Collect any text before this match
        if match.start() > last_end:
            output.append(text[last_end:match.start()])

        label = match.group(1).strip()
        content = match.group(2).strip()
        tabs.append((label, content))
        last_end = match.end()

    # If we found tabs, wrap them
    if tabs:
        output.append(text[last_end:])
        remaining = "".join(output)

        # Wrap all consecutive tabs in a tab-set div
        # This is a simplified approach - full implementation would need
        # to preserve surrounding content properly
        tab_content = ['<div class="tab-set">']
        for label, content in tabs:
            safe_label = re.sub(r"[^\w\s-]", "", label)
            tab_content.append(f'<div class="tab" data-label="{label}">')
            tab_content.append(content)
            tab_content.append("</div>")
        tab_content.append("</div>")

        return "".join(tab_content) + remaining

    return text


def _convert_callouts(text: str) -> str:
    """Convert Obsidian callouts to HTML divs with classes.

    Syntax:
        > [!NOTE]
        > Content line 1
        > Content line 2
    """
    import re

    # Pattern: complete callout block (header + all > content lines until non-> line)
    # Matches from > [!TYPE] to the line before a non-blockquote line
    callout_re = re.compile(
        r"^> \[!(NOTE|TIP|WARNING|INFO|EXAMPLE|COLLAPSED)\](?::\s*([^\]]*))?\s*\n"
        r"((?:> (?!```)[^\n]*\n)+)",
        re.MULTILINE | re.IGNORECASE
    )

    def replace_callout(match: re.Match) -> str:
        callout_type = match.group(1).lower()
        title = match.group(2) or callout_type
        content = match.group(3)

        # Convert > content lines to paragraphs
        paragraphs: list[str] = []
        for line in content.strip().split("\n"):
            line = line.lstrip("> ").strip()
            if line:
                paragraphs.append(f"<p>{line}</p>")

        return (
            f'<div class="callout callout-{callout_type}">\n'
            f"<strong>{title}</strong>\n"
            + "\n".join(paragraphs) +
            f"\n</div>\n"
        )

    return callout_re.sub(replace_callout, text)


def _convert_collapsed(text: str) -> str:
    """Convert > [!collapsed] to collapsible details."""
    import re

    # Convert collapsed callouts to details/summary
    collapsed_re = re.compile(
        r'<div class="callout callout-collapsed">\s*<p></p>\s*(.*?)\s*</div>',
        re.DOTALL
    )

    def replace_collapsed(match: re.Match) -> str:
        content = match.group(1).strip()
        return f'<details class="callout callout-collapsed"><summary>Click to expand</summary>{content}</details>'

    return collapsed_re.sub(replace_collapsed, text)


def _clean_obsidian_syntax(text: str) -> str:
    """Remove or convert Obsidian-specific syntax that Pandoc doesn't handle."""
    import re

    # Remove YAML frontmatter if present
    text = re.sub(r"^---\n.*?\n---\n", "", text, flags=re.DOTALL)

    # Convert #tag to styled spans (keep them, just mark them)
    # (Pandoc handles #heading fine, but standalone tags need help)

    # Convert ^footnote references (keep as-is)

    return text


def _generate_index(wiki_dir: Path, output_dir: Path) -> str:
    """Generate index.html with links to all concepts and summaries."""
    index_items: list[tuple[str, str, str]] = []  # (type, name, slug)

    concepts_dir = wiki_dir / "concepts"
    summaries_dir = wiki_dir / "summaries"

    if concepts_dir.exists():
        for f in sorted(concepts_dir.iterdir()):
            if f.suffix == ".md" and not f.name.startswith("_"):
                name = _extract_title(f) or f.stem
                index_items.append(("concept", name, f.stem))

    if summaries_dir.exists():
        for f in sorted(summaries_dir.iterdir()):
            if f.suffix == ".md" and not f.name.startswith("_"):
                name = _extract_title(f) or f.stem
                index_items.append(("summary", name, f.stem))

    html_items = []
    current_type = None
    for item_type, name, slug in index_items:
        if item_type != current_type:
            if current_type is not None:
                html_items.append("</ul>")
            current_type = item_type
            html_items.append(f'<h2>{item_type.title()}s</h2><ul class="index-list">')
        html_items.append(f'  <li><a href="{item_type}s/{slug}.html">{name}</a></li>')

    if current_type is not None:
        html_items.append("</ul>")

    return "\n".join(html_items)


def _extract_title(file_path: Path) -> str | None:
    """Extract the title (# heading) from a markdown file."""
    content = file_path.read_text("utf-8-sig", errors="replace")
    for line in content.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return None


def _iter_wiki_files(wiki_dir: Path, options: ExportOptions) -> Iterator[tuple[Path, str]]:
    """Iterate over wiki files to export.

    Yields (source_file, output_subdir) tuples.
    """
    if options.include_index:
        yield wiki_dir / "_index.md", ""

    if options.include_concepts:
        concepts_dir = wiki_dir / "concepts"
        if concepts_dir.exists():
            for f in concepts_dir.iterdir():
                if f.suffix == ".md" and not f.name.startswith("_"):
                    yield f, "concepts"

    if options.include_summaries:
        summaries_dir = wiki_dir / "summaries"
        if summaries_dir.exists():
            for f in summaries_dir.iterdir():
                if f.suffix == ".md" and not f.name.startswith("_"):
                    yield f, "summaries"


def export_to_html(
    wiki_dir: Path,
    output_dir: Path,
    options: ExportOptions,
) -> ExportReport:
    """Export compiled wiki markdown files to styled HTML.

    Args:
        wiki_dir: Path to the compiled wiki directory (contains concepts/, summaries/)
        output_dir: Output directory for HTML files
        options: Export options

    Returns:
        ExportReport with statistics

    Raises:
        RuntimeError: If Pandoc is not installed
    """
    # Check Pandoc
    pandoc_ok, pandoc_version = _check_pandoc()
    if not pandoc_ok:
        raise RuntimeError(
            "Pandoc not found. HTML export requires Pandoc.\n"
            "Install from: https://pandoc.org/installing.html\n"
            "Or via package manager:\n"
            "  macOS: brew install pandoc\n"
            "  Ubuntu/Debian: sudo apt install pandoc\n"
            "  Windows: winget install pandoc"
        )

    # Get theme CSS
    theme_css = _get_theme_path(options.theme)
    if not theme_css:
        raise ValueError(
            f"Theme '{options.theme}' not found. Available: {AVAILABLE_THEMES}"
        )

    # Create output directory structure
    output_dir.mkdir(parents=True, exist_ok=True)
    css_dir = output_dir / "css"
    css_dir.mkdir(exist_ok=True)

    # Copy theme CSS
    import shutil

    css_dest = css_dir / "style.css"
    shutil.copy2(theme_css, css_dest)

    # Copy static assets (wiki.js, wiki.css)
    _copy_static_assets(output_dir)

    # Create subdirectories
    concepts_dir = output_dir / "concepts"
    summaries_dir = output_dir / "summaries"
    concepts_dir.mkdir(exist_ok=True)
    summaries_dir.mkdir(exist_ok=True)

    report = ExportReport(
        theme=options.theme,
        output_dir=output_dir,
    )

    # Process files
    for source_file, subdir in _iter_wiki_files(wiki_dir, options):
        # Determine output path
        if subdir:
            output_subdir = output_dir / subdir
            output_file = output_subdir / f"{source_file.stem}.html"
        else:
            output_file = output_dir / "index.html"

        # Read and preprocess
        try:
            content = source_file.read_text("utf-8-sig", errors="replace")
            processed = _process_markdown(content, source_file)

            # Count wikilinks converted
            import re

            wikilink_count = len(re.findall(r"\[\[([^\]]+)\]\]", content))
            report.links_converted += wikilink_count

            # Write processed markdown to temp file
            temp_md = output_file.with_suffix(".md")
            temp_md.write_text(processed, "utf-8")

            # Run Pandoc
            title = _extract_title(source_file) or source_file.stem
            if _run_pandoc(temp_md, output_file, css_dest, title):
                report.files_exported += 1
            else:
                report.files_failed += 1

            # Clean up temp file
            temp_md.unlink(missing_ok=True)

        except Exception as e:
            print(f"  [warn] Failed to export {source_file.name}: {e}", file=sys.stderr)
            report.files_failed += 1

    return report


def main() -> None:
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Export llm-wiki to HTML")
    parser.add_argument("wiki_dir", type=Path, help="Path to wiki/ directory")
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        help="Output directory (default: <wiki_dir>/../html)",
    )
    parser.add_argument(
        "--theme",
        default="reading",
        choices=["article", "report", "reading", "interactive"],
        help="HTML theme",
    )
    parser.add_argument(
        "--no-summaries",
        action="store_true",
        help="Skip summaries directory",
    )
    parser.add_argument(
        "--no-concepts",
        action="store_true",
        help="Skip concepts directory",
    )
    parser.add_argument(
        "--no-index",
        action="store_true",
        help="Skip index generation",
    )

    args = parser.parse_args()

    # Resolve output directory
    if args.output:
        output_dir = args.output
    else:
        output_dir = args.wiki_dir.parent / "html"

    options = ExportOptions(
        theme=args.theme,
        include_summaries=not args.no_summaries,
        include_concepts=not args.no_concepts,
        include_index=not args.no_index,
        output_dir=output_dir,
    )

    print(f"Exporting {args.wiki_dir} to {output_dir}")
    print(f"Theme: {args.theme}")

    try:
        report = export_to_html(args.wiki_dir, output_dir, options)
        print(f"\nExport complete:")
        print(f"  Files exported: {report.files_exported}")
        print(f"  Files failed:   {report.files_failed}")
        print(f"  Links converted: {report.links_converted}")
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
