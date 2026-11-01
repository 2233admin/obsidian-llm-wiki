"""JSON CLI adapter for the independent Python Settings Platform."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

from settings_platform import SettingsService, default_registry_path, default_user_device_id, load_registry


def run_settings_cli(argv: list[str]) -> dict[str, Any]:
    parser = argparse.ArgumentParser(prog="kb_meta.py settings")
    subparsers = parser.add_subparsers(dest="settings_command", required=True)
    for command in ("snapshot", "validate", "migrations-plan", "doctor"):
        subparser = subparsers.add_parser(command)
        _add_context_arguments(subparser)
    explain = subparsers.add_parser("explain")
    _add_context_arguments(explain)
    explain.add_argument("--key", required=True)
    args = parser.parse_args(argv)

    at = args.at
    clock = (lambda: at) if at else None
    registry = load_registry(args.registry)
    vault = args.vault.resolve()
    service = SettingsService(
        registry=registry,
        vault_path=vault,
        user_device_id=args.user_device_id,
        user_device_path=args.user_device_path,
        vault_id=args.vault_id,
        workspace_project_id=args.project,
        session_id=args.session_id,
        python_path=args.python_path,
        compiler_path=args.compiler_path,
        environment=dict(os.environ),
        clock=clock,
    )
    if args.settings_command == "snapshot":
        return service.snapshot_resolve()
    if args.settings_command == "validate":
        return service.validate()
    if args.settings_command == "migrations-plan":
        return service.migrations_plan()
    if args.settings_command == "doctor":
        return service.doctor()
    return service.snapshot_explain(args.key)


def _add_context_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("vault", type=Path)
    parser.add_argument("--registry", type=Path, default=default_registry_path())
    parser.add_argument("--user-device-id", default=default_user_device_id(dict(os.environ)))
    parser.add_argument("--user-device-path", type=Path)
    parser.add_argument("--vault-id")
    parser.add_argument("--project")
    parser.add_argument("--session-id")
    parser.add_argument("--python-path", default=sys.executable)
    parser.add_argument("--compiler-path", default=str(Path(__file__).resolve().parent / "kb_meta.py"))
    parser.add_argument("--at")
