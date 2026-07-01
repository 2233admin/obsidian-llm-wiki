#!/usr/bin/env python3
"""
Fleet CLI — Command-line interface for llmwiki fleet mode.

Usage:
    python -m fleet.cli init <vault>           # Initialize fleet
    python -m fleet.cli scout <vault>          # Run scout
    python -m fleet.cli worker <vault> ...     # Run worker
    python -m fleet.cli verify <vault>         # Run verify
    python -m fleet.cli status <vault>         # Show fleet status
    python -m fleet.cli review <vault>        # Show pending reviews
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from fleet import FleetHub, ScoutShip, WorkerShip, VerifyShip, ReviewManager
from fleet.message import ShipType, WorkTask, ReviewDecision


def cmd_init(vault: str, args: argparse.Namespace) -> int:
    """Initialize fleet."""
    hub = FleetHub(vault=vault)
    state = hub.init()
    print(f"Fleet initialized: {state.fleet_id}")
    print(f"Vault: {vault}")
    print(f"Context budget: {state.context_budget} tokens")
    return 0


def cmd_scout(vault: str, args: argparse.Namespace) -> int:
    """Run scout ship."""
    scout = ScoutShip(vault=vault)

    directories = args.directories.split(",") if args.directories else None
    issue_types = args.types.split(",") if args.types else None

    print(f"Scanning vault: {vault}")
    if directories:
        print(f"Directories: {directories}")
    if issue_types:
        print(f"Issue types: {issue_types}")

    result = scout.scan(directories=directories, issue_types=issue_types)

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"\n{result['summary']}")
        print(f"\nIssues by severity:")
        for severity, count in result["stats"]["by_severity"].items():
            print(f"  {severity}: {count}")
        print(f"\nIssues by type:")
        for issue_type, count in result["stats"]["by_type"].items():
            print(f"  {issue_type}: {count}")

        if result["issues"] and not args.quiet:
            print(f"\nTop issues:")
            for issue in result["issues"][:5]:
                print(f"  [{issue['severity']}] {issue['location']}")
                print(f"    {issue['description']}")

    return 0


def cmd_worker(vault: str, args: argparse.Namespace) -> int:
    """Run worker ship."""
    worker = WorkerShip(vault=vault)

    if args.task_type == "compile":
        if not args.topic:
            print("Error: --topic required for compile task", file=sys.stderr)
            return 1

        result = worker.execute(
            task_type="compile",
            input_spec={"topic": args.topic, "model": args.model or "haiku"},
            output_spec={"path": f"{vault}/{args.topic}/wiki"},
            constraints=["dry-run"] if args.dry_run else [],
        )

    elif args.task_type == "fix":
        if not args.target:
            print("Error: --target required for fix task", file=sys.stderr)
            return 1

        result = worker.execute(
            task_type="fix",
            input_spec={"target": args.target},
            output_spec={"path": args.target},
            constraints=[],
        )

    else:
        print(f"Error: Unknown task type: {args.task_type}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result.to_payload(), indent=2, ensure_ascii=False))
    else:
        status = "✓" if result.success else "✗"
        print(f"{status} {result.task_type}: {result.summary}")
        if result.errors:
            print(f"\nErrors:")
            for error in result.errors:
                print(f"  - {error}")

    return 0 if result.success else 1


def cmd_verify(vault: str, args: argparse.Namespace) -> int:
    """Run verify ship."""
    verify = VerifyShip(vault=vault)

    directories = args.directories.split(",") if args.directories else None
    focus = args.focus.split(",") if args.focus else None

    print(f"Verifying vault: {vault}")
    if directories:
        print(f"Directories: {directories}")
    if focus:
        print(f"Focus: {focus}")

    result = verify.check(focus=focus, directories=directories)

    if args.json:
        print(json.dumps(result.to_payload(), indent=2, ensure_ascii=False))
    else:
        print(f"\n{result.summary}")
        print(f"\nChecks:")
        for check in result.checks:
            icon = {"pass": "✓", "fail": "✗", "warning": "⚠"}.get(check.status, "?")
            print(f"  {icon} {check.check_type}: {check.message}")

        if result.issues and not args.quiet:
            print(f"\nIssues:")
            for issue in result.issues[:10]:
                print(f"  [{issue.severity}] {issue.location}")
                print(f"    {issue.description}")

    return 0 if result.status == "pass" else 1


def cmd_status(vault: str, args: argparse.Namespace) -> int:
    """Show fleet status."""
    hub = FleetHub(vault=vault)
    state = hub.sync()
    context = hub.context_report()

    print(f"Fleet: {state['fleet_id']}")
    print(f"Vault: {state['vault']}")
    print(f"\nSessions:")
    for session_id, session in state["sessions"].items():
        ship_type = session.get('ship_type', session.get('ship', 'unknown'))
        print(f"  {ship_type}: {session.get('status', 'unknown')}")

    print(f"\nContext:")
    main = context.get("main", {})
    print(f"  Budget: {main.get('budget', 'N/A')} tokens")
    print(f"  Spent: {main.get('spent', 0)} tokens")
    print(f"  Remaining: {main.get('remaining', 'N/A')} tokens")

    recommendations = context.get("recommendations", [])
    if recommendations:
        print(f"\nRecommendations:")
        for rec in recommendations:
            print(f"  - {rec}")

    return 0


def cmd_review(vault: str, args: argparse.Namespace) -> int:
    """Show pending reviews."""
    hub = FleetHub(vault=vault)
    pending = hub.get_pending_reviews()

    if not pending:
        print("No pending reviews")
        return 0

    for review in pending:
        print(f"\n## {review['name']}")
        print(f"ID: {review['id']}")
        print(f"After: {review['after_ship']}")

        # Get full data from review
        state = hub.sync()
        review_point = state.get("review_points", {}).get(review["id"])
        if review_point:
            # Extract data summary
            issues = review_point.get("payload", {}).get("issues", [])
            if issues:
                print(f"Issues: {len(issues)}")

        if args.full:
            # Get full review data if available
            print(f"Full data available via Hub API")

    return 0


def cmd_dispatch(vault: str, args: argparse.Namespace) -> int:
    """Dispatch a task to a ship."""
    hub = FleetHub(vault=vault)

    # Create task
    task = WorkTask(
        id=args.task_id or f"task_{id(object())}",
        entity=args.entity or "",
        type=args.task_type,
        input={"source": args.input or ""},
        output={"path": args.output or ""},
        constraints=args.constraints or [],
    )

    ship_type = ShipType(args.to)

    # Dispatch
    dispatch_result = hub.dispatch(task, to=ship_type)

    print(f"Dispatched to {args.to}")
    print(f"Session: {dispatch_result['session_id']}")
    print(f"\nBriefing:\n{dispatch_result['briefing']}")

    return 0


def main():
    parser = argparse.ArgumentParser(
        description="llmwiki Fleet CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="Command")

    # init
    init_parser = subparsers.add_parser("init", help="Initialize fleet")
    init_parser.add_argument("vault", help="Vault path")

    # scout
    scout_parser = subparsers.add_parser("scout", help="Run scout ship")
    scout_parser.add_argument("vault", help="Vault path")
    scout_parser.add_argument("--directories", help="Comma-separated directories to scan")
    scout_parser.add_argument("--types", help="Comma-separated issue types")
    scout_parser.add_argument("--json", action="store_true", help="Output JSON")
    scout_parser.add_argument("--quiet", action="store_true", help="Suppress issue details")

    # worker
    worker_parser = subparsers.add_parser("worker", help="Run worker ship")
    worker_parser.add_argument("vault", help="Vault path")
    worker_parser.add_argument("--task-type", required=True,
                              choices=["compile", "fix", "create", "review"],
                              help="Task type")
    worker_parser.add_argument("--topic", help="Topic for compile task")
    worker_parser.add_argument("--target", help="Target for fix task")
    worker_parser.add_argument("--model", help="Model tier (haiku/sonnet/opus)")
    worker_parser.add_argument("--dry-run", action="store_true", help="Dry run")
    worker_parser.add_argument("--json", action="store_true", help="Output JSON")

    # verify
    verify_parser = subparsers.add_parser("verify", help="Run verify ship")
    verify_parser.add_argument("vault", help="Vault path")
    verify_parser.add_argument("--directories", help="Comma-separated directories")
    verify_parser.add_argument("--focus", help="Comma-separated check types")
    verify_parser.add_argument("--json", action="store_true", help="Output JSON")
    verify_parser.add_argument("--quiet", action="store_true", help="Suppress issue details")

    # status
    status_parser = subparsers.add_parser("status", help="Show fleet status")
    status_parser.add_argument("vault", help="Vault path")

    # review
    review_parser = subparsers.add_parser("review", help="Show pending reviews")
    review_parser.add_argument("vault", help="Vault path")
    review_parser.add_argument("--full", action="store_true", help="Show full data")

    # dispatch
    dispatch_parser = subparsers.add_parser("dispatch", help="Dispatch a task")
    dispatch_parser.add_argument("vault", help="Vault path")
    dispatch_parser.add_argument("--to", required=True,
                                choices=["scout", "worker", "verify"],
                                help="Target ship")
    dispatch_parser.add_argument("--task-type", default="compile", help="Task type")
    dispatch_parser.add_argument("--task-id", help="Task ID")
    dispatch_parser.add_argument("--entity", help="Entity reference")
    dispatch_parser.add_argument("--input", help="Input spec")
    dispatch_parser.add_argument("--output", help="Output spec")
    dispatch_parser.add_argument("--constraints", nargs="*", help="Constraints")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return 1

    vault = getattr(args, "vault", None)
    if not vault:
        print("Error: vault path required", file=sys.stderr)
        return 1

    commands = {
        "init": cmd_init,
        "scout": cmd_scout,
        "worker": cmd_worker,
        "verify": cmd_verify,
        "status": cmd_status,
        "review": cmd_review,
        "dispatch": cmd_dispatch,
    }

    return commands[args.command](vault, args)


if __name__ == "__main__":
    sys.exit(main())
