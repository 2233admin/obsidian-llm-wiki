#!/usr/bin/env python3
"""
OBC CLI - Obsidian Broken Link Checker

Usage:
    obc extract <vault> [--json]
    obc check <vault> [--format json|md]
    obc plan <vault> [--out <path>]
    obc apply [--plan <path>] [--safe-only]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from obc.extract import extract_vault_links, LinkRef


def cmd_extract(vault: Path, args: argparse.Namespace) -> int:
    """Extract links from vault."""
    links = extract_vault_links(vault)

    if args.json:
        output = {
            "version": "1.0",
            "vault": str(vault),
            "total_links": len(links),
            "links": [link.to_dict() for link in links],
        }
        print(json.dumps(output, indent=2, ensure_ascii=False))
    else:
        print(f"Found {len(links)} links in {vault}")
        for link in links:
            icon = {
                "wikilink": "[[",
                "embed": "![[",
                "markdown": "[",
            }.get(link.kind.value, "?")

            flag = ""
            if link.in_code_block:
                flag = " [code]"
            elif link.in_inline_code:
                flag = " [inline]"

            print(f"  {icon}{link.raw_text}{flag}] at {link.source_file.name}:{link.line}")

    return 0


def cmd_check(vault: Path, args: argparse.Namespace) -> int:
    """Check vault links (PR2 will add resolution)."""
    links = extract_vault_links(vault)

    print(f"Found {len(links)} links in {vault}")
    print()
    print("PR2 pending: Link resolution and diagnostic classification")
    print("Currently only extraction is implemented.")

    return 0


def main():
    parser = argparse.ArgumentParser(
        description="OBC - Obsidian Broken Link Checker",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    subparsers = parser.add_subparsers(dest="command", help="Command")

    # extract
    extract_parser = subparsers.add_parser("extract", help="Extract links from vault")
    extract_parser.add_argument("vault", help="Path to vault")
    extract_parser.add_argument("--json", action="store_true", help="Output JSON")

    # check
    check_parser = subparsers.add_parser("check", help="Check vault links")
    check_parser.add_argument("vault", help="Path to vault")
    check_parser.add_argument("--format", choices=["json", "md"], default="md")

    # plan
    plan_parser = subparsers.add_parser("plan", help="Generate fix plan")
    plan_parser.add_argument("vault", help="Path to vault")
    plan_parser.add_argument("--out", help="Output path")

    # apply
    apply_parser = subparsers.add_parser("apply", help="Apply fixes")
    apply_parser.add_argument("--plan", required=True, help="Fix plan path")
    apply_parser.add_argument("--safe-only", action="store_true", help="Only apply safe fixes")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    if args.command == "extract":
        return cmd_extract(Path(args.vault), args)
    elif args.command == "check":
        return cmd_check(Path(args.vault), args)
    else:
        print(f"Command '{args.command}' not yet implemented", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
