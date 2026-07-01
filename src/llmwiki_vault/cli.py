from __future__ import annotations

import argparse
from pathlib import Path

from .contract import validate_ingest_output
from .lint import lint_vault
from .scaffold import init_vault


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="llmwiki")
    sub = parser.add_subparsers(dest="command", required=True)
    vault = sub.add_parser("vault")
    vault_sub = vault.add_subparsers(dest="vault_command", required=True)

    init_parser = vault_sub.add_parser("init")
    init_parser.add_argument("path")
    init_parser.add_argument("--dry-run", action="store_true")

    lint_parser = vault_sub.add_parser("lint")
    lint_parser.add_argument("path")
    lint_parser.add_argument("--release-check", action="store_true")

    contract_parser = vault_sub.add_parser("validate-ingest-output")
    contract_parser.add_argument("path")
    contract_parser.add_argument("--vault-root")

    args = parser.parse_args(argv)
    if args.command == "vault" and args.vault_command == "init":
        report = init_vault(args.path, dry_run=args.dry_run)
        print_write_report(report)
        return report.exit_code()
    if args.command == "vault" and args.vault_command == "lint":
        report = lint_vault(args.path, release_check=args.release_check)
        print_lint_report(report)
        return report.exit_code()
    if args.command == "vault" and args.vault_command == "validate-ingest-output":
        report = validate_ingest_output(Path(args.path), vault_root=args.vault_root)
        print_lint_report(report)
        return report.exit_code()
    parser.error("unsupported command")
    return 2


def print_write_report(report) -> None:
    prefix = "dry-run " if report.dry_run else ""
    print(f"{prefix}created: {len(report.created)}")
    print(f"{prefix}updated: {len(report.updated)}")
    print(f"{prefix}skipped: {len(report.skipped)}")
    for label in ["created", "updated", "skipped", "warnings", "errors"]:
        for item in getattr(report, label):
            print(f"{label[:-1] if label.endswith('s') else label}: {item}")


def print_lint_report(report) -> None:
    print(f"errors: {len(report.errors)}")
    print(f"warnings: {len(report.warnings)}")
    print(f"infos: {len(report.infos)}")
    for issue in report.errors + report.warnings + report.infos:
        print(f"{issue.level}: {issue.path}: {issue.message}")
