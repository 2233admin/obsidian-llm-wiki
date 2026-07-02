#!/usr/bin/env python3
"""
OBC CLI - Obsidian Broken Link Checker

Usage:
    obc extract <vault> [--json]
    obc check <vault> [--format json|md]
    obc orphan <vault> [--json] [--min-age days]
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
    """Check vault links with resolution."""
    from obc.index import build_index
    from obc.resolver import Resolver

    # Build index and extract links
    index = build_index(vault)
    links = extract_vault_links(vault)
    resolver = Resolver(index, vault_path=vault)
    diagnostics = resolver.resolve_all(links)

    # Group by severity
    from collections import Counter
    by_severity = Counter(d.severity for d in diagnostics)

    if args.format == "json":
        output = {
            "version": "1.0",
            "vault": str(vault),
            "summary": {
                "total_links": len(links),
                "total_files": index.summary()["total_files"],
                "ok": by_severity.get("ok", 0),
                "error": by_severity.get("error", 0),
                "warning": by_severity.get("warning", 0),
                "info": by_severity.get("info", 0),
            },
            "diagnostics": [d.to_dict() for d in diagnostics],
        }
        print(json.dumps(output, indent=2, ensure_ascii=False))
    else:
        print(f"Found {len(links)} links in {vault}")
        print(f"Index: {index.summary()['total_files']} files\n")

        print("Summary:")
        print(f"  OK:       {by_severity.get('ok', 0)}")
        print(f"  Error:    {by_severity.get('error', 0)}")
        print(f"  Warning:  {by_severity.get('warning', 0)}")
        print(f"  Info:     {by_severity.get('info', 0)}")

        print("\nDiagnostics:")
        for d in diagnostics:
            icon = {"ok": "✓", "warning": "⚠", "error": "✗", "info": "ℹ"}.get(d.severity, "?")
            print(f"  {icon} [{d.code.value}] {d.link.raw_text}")
            print(f"      at {d.link.source_file.name}:{d.link.line}")
            if d.message:
                print(f"      {d.message}")

    return 0


def cmd_orphan(vault: Path, args: argparse.Namespace) -> int:
    """Find orphan notes in vault."""
    from obc.orphan import find_orphans, OrphanReport

    orphans = find_orphans(vault)
    report = OrphanReport(vault=str(vault), orphans=orphans)

    if args.json:
        print(json.dumps(report.to_dict(), indent=2, ensure_ascii=False))
    else:
        print(f"Found {len(orphans)} orphan notes in {vault}")
        print()
        for orphan in orphans[:20]:
            from datetime import datetime
            age_days = (datetime.now().timestamp() - orphan.last_modified) / 86400
            print(f"  [{age_days:5.0f}d] {orphan.path}")
        if len(orphans) > 20:
            print(f"  ... and {len(orphans) - 20} more")

    return 0


def cmd_plan(vault: Path, args: argparse.Namespace) -> int:
    """Generate fix plan from vault diagnostics."""
    from obc.index import build_index
    from obc.resolver import Resolver
    from obc.planner import FixPlanner

    # Build index and extract links
    index = build_index(vault)
    links = extract_vault_links(vault)
    resolver = Resolver(index, vault_path=vault)
    diagnostics = resolver.resolve_all(links)
    planner = FixPlanner()
    plan = planner.plan(diagnostics, vault=str(vault))

    if args.out:
        output_path = Path(args.out)
        output_path.write_text(json.dumps(plan.to_dict(), indent=2, ensure_ascii=False))
        print(f"Plan written to {output_path}")
    else:
        print(json.dumps(plan.to_dict(), indent=2, ensure_ascii=False))

    return 0


def cmd_apply(args: argparse.Namespace) -> int:
    """Apply fixes from a plan."""
    from obc.planner import FixPlanner, FixPlan, FixCandidate

    plan_path = Path(args.plan)
    if not plan_path.exists():
        print(f"Plan file not found: {plan_path}", file=sys.stderr)
        return 1

    # Load plan
    plan_data = json.loads(plan_path.read_text())

    # Reconstruct FixPlan object
    plan = FixPlan()
    plan.version = plan_data.get("version", "1.0")
    plan.created_at = plan_data.get("created_at", "")
    plan.vault = plan_data.get("vault", "")

    # Reconstruct FixCandidates from plan data
    for fix_data in plan_data.get("review_fixes", []):
        fix = FixCandidate(
            diagnostic=None,  # type: ignore
            safety_level=fix_data["safety_level"],
            old_text=fix_data["old_text"],
            new_text=fix_data["new_text"],
            source_file=Path(fix_data["source_file"]),
            line=fix_data["line"],
            reason=fix_data.get("reason", ""),
            target_path=fix_data.get("target_path"),
        )
        plan.review_fixes.append(fix)

    plan.total_candidates = len(plan.safe_fixes) + len(plan.review_fixes)

    # Check what we're applying
    safe_count = len(plan.safe_fixes)
    review_count = len(plan.review_fixes)

    print(f"Plan: {plan_path}")
    print(f"  Safe fixes: {safe_count}")
    print(f"  Review fixes: {review_count}")

    if review_count > 0 and not args.apply_review:
        print("\nNote: Use --apply-review to apply S2 fixes")
        print("Dry-run only. Files will not be modified.")

    # Apply fixes
    planner = FixPlanner()
    modified, errors, backups = planner.apply_fixes(
        plan,
        dry_run=(review_count > 0 and not args.apply_review),
        apply_review=args.apply_review,
        backup=args.backup
    )

    if modified:
        print(f"\nModified files: {len(modified)}")
        for f in modified:
            print(f"  - {f}")
    else:
        print("\nNo files modified (dry-run or no fixes to apply)")

    if backups:
        print(f"\nBackup files: {len(backups)}")
        for b in backups:
            print(f"  - {b}")

    if errors:
        print(f"\nErrors: {len(errors)}")
        for e in errors:
            print(f"  - {e}")

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

    # orphan
    orphan_parser = subparsers.add_parser("orphan", help="Find orphan notes")
    orphan_parser.add_argument("vault", help="Path to vault")
    orphan_parser.add_argument("--json", action="store_true", help="Output JSON")

    # plan
    plan_parser = subparsers.add_parser("plan", help="Generate fix plan")
    plan_parser.add_argument("vault", help="Path to vault")
    plan_parser.add_argument("--out", help="Output path")

    # apply
    apply_parser = subparsers.add_parser("apply", help="Apply fixes")
    apply_parser.add_argument("--plan", required=True, help="Fix plan path")
    apply_parser.add_argument("--apply-review", action="store_true",
                             help="Also apply S2 review fixes")
    apply_parser.add_argument("--backup", action="store_true",
                             help="Create .bak backup files before modifying")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    if args.command == "extract":
        return cmd_extract(Path(args.vault), args)
    elif args.command == "check":
        return cmd_check(Path(args.vault), args)
    elif args.command == "orphan":
        return cmd_orphan(Path(args.vault), args)
    elif args.command == "plan":
        return cmd_plan(Path(args.vault), args)
    elif args.command == "apply":
        return cmd_apply(args)
    else:
        print(f"Command '{args.command}' not yet implemented", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
