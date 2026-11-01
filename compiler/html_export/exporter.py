"""HTML exporter for llm-wiki compiled output.

Uses Pandoc to convert markdown to HTML with custom themes.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from .service_worker import emit_service_worker
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
    # Footer build timestamp stamped into every exported page (LMVK L2 --
    # lets a viewer eyeball freshness, spec SLA is "footer timestamp <=30min
    # old"). None -> export_to_html() stamps "now" (UTC) once, shared by
    # every page in the run. Pass an explicit value for reproducible tests
    # or to align the footer with e.g. the compiling commit's timestamp.
    build_timestamp: str | None = None
    # LMVK L4 (PWA): emit sw.js at the export root (stale-while-revalidate
    # + build-time precache manifest, cache version = build timestamp) and
    # register it from every page. False -> no sw.js, no registration
    # snippet (--no-sw on the CLI).
    service_worker: bool = True


@dataclass
class ExportReport:
    """Report of an HTML export operation."""

    files_exported: int = 0
    files_failed: int = 0
    links_converted: int = 0
    theme: str = "reading"
    output_dir: Path | None = None
    # LMVK L4: "full" | "degraded" when a service worker was emitted,
    # "" when service_worker=False.
    precache_mode: str = ""


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

    Currently a no-op: Pandoc emits ``language-xxx`` classes on ``<code>``
    elements, which Prism.js re-highlights at load time, so no preprocessing
    is needed here.
    """
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


def _inject_assets(
    html_content: str,
    has_interactive: bool = False,
    asset_prefix: str = "",
    register_sw: bool = False,
) -> str:
    """Inject wiki.js, wiki.css, and CDN libraries into HTML content.

    Args:
        asset_prefix: Relative path prefix to the output root, e.g. ``"../"``
            when the document lives one directory below the output root
            (as concepts/*.html and summaries/*.html do). Empty string for
            documents at the output root (e.g. index.html).
        register_sw: When True, also inject the LMVK L4 service worker
            registration snippet (see ``_sw_register_snippet``).
    """
    static_url = f"{asset_prefix}static/"

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
    if register_sw:
        js_script += _sw_register_snippet(asset_prefix)
    if "</body>" in html_content:
        html_content = html_content.replace("</body>", js_script + "</body>")
    else:
        html_content = html_content + "\n" + js_script

    return html_content


def _sw_register_snippet(asset_prefix: str) -> str:
    """Inline service worker registration script (LMVK L4).

    The URL is relative (``asset_prefix`` walks back up to the export root)
    so every page, at any depth, registers the *same* sw.js; the default
    scope is sw.js's own directory = the export root, i.e. ``/`` when the
    site is served at the domain root (the L3 caddy deployment). Plain
    same-origin registration keeps basic_auth working -- the browser
    attaches credentials itself -- and no cache-busting query string is
    appended (it would both split registrations per page and defeat the
    browser's auth cache).
    """
    return (
        "  <script>\n"
        '  if ("serviceWorker" in navigator) {\n'
        f'    navigator.serviceWorker.register("{asset_prefix}sw.js");\n'
        "  }\n"
        "  </script>\n"
    )


def build_timestamp_now() -> str:
    """Current UTC time formatted for the footer (and reusable by any
    caller, e.g. compile.py, that wants to stamp a build without importing
    ``datetime`` itself). Matches the ``%Y-%m-%dT%H:%M:%SZ`` convention used
    elsewhere in this repo (compiler/scheduler.py, compiler/evaluate.py)."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _inject_footer(html_content: str, build_timestamp: str) -> str:
    """Insert a build-timestamp footer before ``</body>``.

    LMVK L2 (spec: docs/specs/lmvk-execution-and-release.md, verification
    "页脚时间戳 ≤30min") -- lets a viewer on the served static site eyeball
    how fresh the page is without checking git log. Applied to every
    exported page (index, concepts/*, summaries/*) via ``_run_pandoc`` so
    the same build carries one consistent timestamp.
    """
    if not build_timestamp:
        return html_content
    footer = f'  <footer class="wiki-build-footer">Compiled: {build_timestamp}</footer>\n'
    if "</body>" in html_content:
        return html_content.replace("</body>", footer + "</body>")
    return html_content + "\n" + footer


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
    asset_prefix: str = "",
    build_timestamp: str = "",
    register_sw: bool = False,
) -> bool:
    """Run Pandoc to convert markdown to HTML.

    Args:
        input_file: Input markdown file
        output_file: Output HTML file
        css_file: Optional CSS file to include
        title: Document title (for <title> tag)
        asset_prefix: Relative path prefix to the output root (see
            ``_inject_assets``). Applied to both the Pandoc ``--css`` link
            and the injected static assets so pages nested under
            concepts/summaries resolve css/js correctly instead of looking
            for them under their own subdirectory.
        build_timestamp: When non-empty, stamped into a footer via
            ``_inject_footer`` (LMVK L2 freshness indicator). Empty ->
            no footer, unchanged behavior.
        register_sw: When True, the page gets the LMVK L4 service worker
            registration snippet (see ``_sw_register_snippet``).

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
        cmd.append(f"--css={asset_prefix}css/style.css")

    if title:
        cmd.extend(["--metadata", f"title={title}"])

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  [warn] Pandoc error: {result.stderr}", file=sys.stderr)
        return False

    # Post-process: inject wiki.js and wiki.css, then the build footer
    if output_file.exists():
        html_content = output_file.read_text("utf-8")
        html_content = _inject_assets(
            html_content, asset_prefix=asset_prefix, register_sw=register_sw
        )
        html_content = _inject_footer(html_content, build_timestamp)
        output_file.write_text(html_content, "utf-8")

    return True


def _process_markdown(content: str, source_path: Path | None = None) -> str:
    """Pre-process markdown content before Pandoc conversion.

    - Convert wikilinks to HTML anchors
    - Convert tabs syntax
    - Convert Obsidian callouts
    - Clean up Obsidian-specific syntax
    """

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
            tab_content.append(f'<div class="tab" data-label="{safe_label}">')
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
            "\n</div>\n"
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
    """Generate index.html body with links to all concepts and summaries."""
    sections = [
        ("Concepts", wiki_dir / "concepts"),
        ("Summaries", wiki_dir / "summaries"),
    ]

    html_items: list[str] = []
    for heading, section_dir in sections:
        if not section_dir.exists():
            continue
        links = [
            (_extract_title(f) or f.stem, f"{section_dir.name}/{f.stem}.html")
            for f in sorted(section_dir.iterdir())
            if f.suffix == ".md" and not f.name.startswith("_")
        ]
        if not links:
            continue
        html_items.append(f'<h2>{heading}</h2><ul class="index-list">')
        for name, href in links:
            html_items.append(f'  <li><a href="{href}">{name}</a></li>')
        html_items.append("</ul>")

    return "\n".join(html_items)


def _write_fallback_index(
    wiki_dir: Path,
    output_dir: Path,
    css_dest: Path,
    build_timestamp: str = "",
    register_sw: bool = False,
) -> bool:
    """Write index.html from a generated listing when _index.md is missing.

    Builds the body with ``_generate_index`` and renders it through the same
    ``_run_pandoc``/``_inject_assets`` path as regular pages (raw HTML passes
    through Pandoc markdown untouched), so the fallback page gets the theme
    CSS and static assets like every other page.

    Returns:
        True if the index was written successfully
    """
    body = _generate_index(wiki_dir, output_dir)
    title = wiki_dir.resolve().name or "Wiki Index"

    temp_md = output_dir / "index.md"
    temp_md.write_text(body + "\n", "utf-8")
    try:
        return _run_pandoc(
            temp_md, output_dir / "index.html", css_dest, title,
            build_timestamp=build_timestamp, register_sw=register_sw,
        )
    finally:
        temp_md.unlink(missing_ok=True)


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

    ``_index.md`` is only yielded when it exists; ``export_to_html`` falls
    back to a generated index page otherwise.
    """
    if options.include_index:
        index_md = wiki_dir / "_index.md"
        if index_md.exists():
            yield index_md, ""

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

    # Build footer timestamp -- computed once so every page in this export
    # run (index, concepts/*, summaries/*, fallback index) carries the same
    # stamp (LMVK L2). Caller can pin it via options.build_timestamp for
    # reproducible tests or to align with e.g. the compiling commit's time.
    build_timestamp = options.build_timestamp or build_timestamp_now()

    # Source note mtimes keyed by output-relative URL (LMVK L4: the >100MB
    # degraded precache keeps only pages whose *source* was touched in the
    # last 30 days -- exported-HTML mtimes are useless, they're all "now").
    source_mtimes: dict[str, float] = {}

    # Process files
    index_exported = False
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

            # Run Pandoc. Files under a subdir (concepts/, summaries/) are
            # one level below the output root, so their css/static asset
            # links need a "../" prefix to resolve correctly.
            title = _extract_title(source_file) or source_file.stem
            asset_prefix = "../" if subdir else ""
            if _run_pandoc(
                temp_md, output_file, css_dest, title,
                asset_prefix=asset_prefix, build_timestamp=build_timestamp,
                register_sw=options.service_worker,
            ):
                report.files_exported += 1
                source_mtimes[output_file.relative_to(output_dir).as_posix()] = (
                    source_file.stat().st_mtime
                )
                if not subdir:
                    index_exported = True
            else:
                report.files_failed += 1

            # Clean up temp file
            temp_md.unlink(missing_ok=True)

        except Exception as e:
            print(f"  [warn] Failed to export {source_file.name}: {e}", file=sys.stderr)
            report.files_failed += 1

    # Fallback: no _index.md (or it failed to render) — generate a listing
    # of concepts/summaries so the export always has a root index.html.
    if options.include_index and not index_exported:
        if _write_fallback_index(
            wiki_dir, output_dir, css_dest,
            build_timestamp=build_timestamp, register_sw=options.service_worker,
        ):
            report.files_exported += 1
        else:
            report.files_failed += 1

    # LMVK L4: emit sw.js last so the precache manifest sees every file
    # this run produced (pages, css/, static/).
    if options.service_worker:
        manifest = emit_service_worker(output_dir, build_timestamp, source_mtimes)
        report.precache_mode = manifest.mode

    return report


# Directory *names* always pruned from a direct vault walk, regardless of
# --exclude: version-control/app-state dirs that are never wiki content.
_ALWAYS_EXCLUDED_DIR_NAMES = {".git", ".obsidian", ".space", ".makemd", ".vault-mind", ".trash"}

# LMVK L2 default exclusion (wayfinder #20: review gate = directory boundary,
# "00-Inbox 不编不发" -- not compiled, not published). Callers of
# export_vault_direct can extend this via the exclude_dirs argument.
DEFAULT_VAULT_EXCLUDE_DIRS = {"00-Inbox"}


def _iter_vault_markdown_files(
    vault_root: Path, exclude_dirs: set[str]
) -> Iterator[tuple[Path, str]]:
    """Recursively walk an organic (non-topic) vault for ``*.md`` files.

    Unlike ``_iter_wiki_files`` (flat, hard-coded to the compiler's
    ``concepts/summaries/_index.md`` topic convention), this walks an
    arbitrary directory tree -- e.g. a real PARA-method Obsidian vault that
    has no ``raw/``/``wiki/`` structure at all.

    Yields (source_file, rel_dir) where ``rel_dir`` is the POSIX-style path
    of the file's parent directory relative to ``vault_root`` (``""`` for
    files at the root). Directories are pruned *during* the walk (not
    filtered after), so an excluded directory's descendants are never even
    stat'd -- this matters at ~20k-file vault scale. Pruning applies at
    every depth, not just the top level (PARA vaults nest), and dotdirs are
    always pruned on top of whatever ``exclude_dirs`` names.
    """
    import os

    exclude_lower = {d.lower() for d in exclude_dirs} | {
        d.lower() for d in _ALWAYS_EXCLUDED_DIR_NAMES
    }
    root = Path(vault_root)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(
            d for d in dirnames if d.lower() not in exclude_lower and not d.startswith(".")
        )
        rel_dir = Path(dirpath).relative_to(root).as_posix()
        if rel_dir == ".":
            rel_dir = ""
        for fname in sorted(filenames):
            if fname.lower().endswith(".md"):
                yield Path(dirpath) / fname, rel_dir


def _generate_vault_index(pages: list[tuple[str, str]]) -> str:
    """Group exported pages by top-level directory for the whole-vault index
    (``export_vault_direct`` has no concepts/summaries convention to key
    off of, so it groups by the vault's own top-level folders instead)."""
    groups: dict[str, list[tuple[str, str]]] = {}
    for title, href in pages:
        top = href.split("/")[0] if "/" in href else "(root)"
        groups.setdefault(top, []).append((title, href))

    html_items: list[str] = []
    for top in sorted(groups):
        html_items.append(f'<h2>{top}</h2><ul class="index-list">')
        for title, href in sorted(groups[top], key=lambda pair: pair[1]):
            html_items.append(f'  <li><a href="{href}">{title}</a></li>')
        html_items.append("</ul>")
    return "\n".join(html_items)


def _write_vault_index(
    pages: list[tuple[str, str]],
    output_dir: Path,
    css_dest: Path,
    build_timestamp: str = "",
    register_sw: bool = False,
) -> bool:
    """Write the whole-vault ``index.html`` for ``export_vault_direct``,
    through the same Pandoc/asset/footer pipeline as every other page."""
    body = _generate_vault_index(pages)
    temp_md = output_dir / "index.md"
    temp_md.write_text(body + "\n", "utf-8")
    try:
        return _run_pandoc(
            temp_md, output_dir / "index.html", css_dest, "Vault Index",
            build_timestamp=build_timestamp, register_sw=register_sw,
        )
    finally:
        temp_md.unlink(missing_ok=True)


def export_vault_direct(
    vault_root: Path,
    output_dir: Path,
    options: ExportOptions,
    exclude_dirs: set[str] | None = None,
) -> ExportReport:
    """Render every markdown file under an organic (non-topic) vault straight
    to HTML -- LMVK L2's whole-vault baseline (spec: docs/specs/lmvk-execution-
    and-release.md).

    ``export_to_html`` assumes the compiler's topic convention (``wiki_dir``
    contains ``concepts/``, ``summaries/``, ``_index.md`` -- produced by
    ``compile.py``'s LLM extraction pipeline). A real, organically-structured
    vault (e.g. a local knowledge directory, PARA folders, no ``raw/``/``wiki/``
    anywhere) has none of that. This function walks the vault directly and
    mirrors its directory tree 1:1 into ``output_dir``, one ``.html`` per
    ``.md``, reusing the exact same Pandoc/theme/wikilink/footer pipeline as
    the topic exporter. Zero LLM calls -- pure rendering, same as
    ``export_to_html``.

    exclude_dirs: directory *names* (matched case-insensitively at any
    depth) to prune entirely. Defaults to ``DEFAULT_VAULT_EXCLUDE_DIRS``
    (``{"00-Inbox"}`` -- wayfinder #20: review gate = directory boundary,
    "00-Inbox 不编不发"). Version-control/app-state dirs (``.git``,
    ``.obsidian``, ``.space``, ``.makemd``, ``.vault-mind``, ``.trash``) are
    always pruned regardless of this argument.
    """
    exclude = set(exclude_dirs) if exclude_dirs is not None else set(DEFAULT_VAULT_EXCLUDE_DIRS)

    pandoc_ok, _pandoc_version = _check_pandoc()
    if not pandoc_ok:
        raise RuntimeError(
            "Pandoc not found. HTML export requires Pandoc.\n"
            "Install from: https://pandoc.org/installing.html\n"
            "Or via package manager:\n"
            "  macOS: brew install pandoc\n"
            "  Ubuntu/Debian: sudo apt install pandoc\n"
            "  Windows: winget install pandoc"
        )

    theme_css = _get_theme_path(options.theme)
    if not theme_css:
        raise ValueError(
            f"Theme '{options.theme}' not found. Available: {AVAILABLE_THEMES}"
        )

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    css_dir = output_dir / "css"
    css_dir.mkdir(exist_ok=True)

    import shutil

    css_dest = css_dir / "style.css"
    shutil.copy2(theme_css, css_dest)
    _copy_static_assets(output_dir)

    report = ExportReport(theme=options.theme, output_dir=output_dir)
    build_timestamp = options.build_timestamp or build_timestamp_now()
    pages: list[tuple[str, str]] = []
    # Source note mtimes keyed by output-relative URL (LMVK L4 degraded
    # precache -- see the matching comment in export_to_html).
    source_mtimes: dict[str, float] = {}

    for source_file, rel_dir in _iter_vault_markdown_files(Path(vault_root), exclude):
        depth = len(rel_dir.split("/")) if rel_dir else 0
        asset_prefix = "../" * depth
        out_subdir = output_dir / rel_dir if rel_dir else output_dir
        out_subdir.mkdir(parents=True, exist_ok=True)
        output_file = out_subdir / f"{source_file.stem}.html"

        try:
            content = source_file.read_text("utf-8-sig", errors="replace")
            processed = _process_markdown(content, source_file)

            import re

            report.links_converted += len(re.findall(r"\[\[([^\]]+)\]\]", content))

            temp_md = output_file.with_suffix(".md")
            temp_md.write_text(processed, "utf-8")

            title = _extract_title(source_file) or source_file.stem
            try:
                ok = _run_pandoc(
                    temp_md, output_file, css_dest, title,
                    asset_prefix=asset_prefix, build_timestamp=build_timestamp,
                    register_sw=options.service_worker,
                )
            finally:
                temp_md.unlink(missing_ok=True)

            if ok:
                report.files_exported += 1
                href = f"{rel_dir}/{output_file.name}" if rel_dir else output_file.name
                pages.append((title, href))
                source_mtimes[href] = source_file.stat().st_mtime
            else:
                report.files_failed += 1

        except Exception as e:
            print(f"  [warn] Failed to export {source_file}: {e}", file=sys.stderr)
            report.files_failed += 1

    if options.include_index:
        if _write_vault_index(
            pages, output_dir, css_dest,
            build_timestamp=build_timestamp, register_sw=options.service_worker,
        ):
            report.files_exported += 1
        else:
            report.files_failed += 1

    # LMVK L4: emit sw.js last so the precache manifest sees every file
    # this run produced (pages, css/, static/).
    if options.service_worker:
        manifest = emit_service_worker(output_dir, build_timestamp, source_mtimes)
        report.precache_mode = manifest.mode

    return report


def main() -> None:
    """CLI entry point."""
    import argparse

    parser = argparse.ArgumentParser(description="Export llm-wiki to HTML")
    parser.add_argument("wiki_dir", type=Path, help="Path to wiki/ directory (or a vault root, with --direct)")
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
    parser.add_argument(
        "--no-sw",
        action="store_true",
        help=(
            "Skip the service worker (LMVK L4). By default sw.js is emitted "
            "at the output root with a build-time precache manifest and "
            "every page registers it."
        ),
    )
    parser.add_argument(
        "--direct",
        action="store_true",
        help=(
            "LMVK L2 whole-vault mode: treat wiki_dir as an organic vault root "
            "(no raw/wiki topic convention) and recursively render every .md "
            "file, mirroring the directory tree into --output."
        ),
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="DIR_NAME",
        help=(
            "--direct only: directory name to prune from the walk (repeatable). "
            "'00-Inbox' is always excluded in addition to whatever is passed here."
        ),
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
        service_worker=not args.no_sw,
    )

    print(f"Exporting {args.wiki_dir} to {output_dir}")
    print(f"Theme: {args.theme}")

    try:
        if args.direct:
            exclude = set(DEFAULT_VAULT_EXCLUDE_DIRS) | set(args.exclude)
            print(f"Mode: direct vault walk (excluding: {sorted(exclude)})")
            report = export_vault_direct(args.wiki_dir, output_dir, options, exclude_dirs=exclude)
        else:
            report = export_to_html(args.wiki_dir, output_dir, options)
        print("\nExport complete:")
        print(f"  Files exported: {report.files_exported}")
        print(f"  Files failed:   {report.files_failed}")
        print(f"  Links converted: {report.links_converted}")
        if report.precache_mode:
            print(f"  Precache mode:  {report.precache_mode}")
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
