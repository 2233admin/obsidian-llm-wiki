"""HTML export package for llm-wiki compiled output.

Usage:
    from html_export import export_to_html, ExportOptions

    options = ExportOptions(theme="reading")
    report = export_to_html(wiki_dir, output_dir, options)
"""

from .exporter import ExportOptions, ExportReport, export_to_html
from .wikilink_converter import wikilinks_to_html

__all__ = ["ExportOptions", "ExportReport", "export_to_html", "wikilinks_to_html"]
