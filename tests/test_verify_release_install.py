from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "verify_release_install.py"
SPEC = importlib.util.spec_from_file_location("verify_release_install", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
verify_release_install = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verify_release_install)

REQUIRED_RELEASE_OPERATIONS = verify_release_install.REQUIRED_RELEASE_OPERATIONS
required_operation_report = verify_release_install.required_operation_report


def all_required_operations() -> list[str]:
    return [
        operation
        for operations in REQUIRED_RELEASE_OPERATIONS.values()
        for operation in operations
    ]


def test_default_mcp_test_command_discovers_legacy_and_colocated_suites() -> None:
    package_json = MODULE_PATH.parents[1] / "mcp-server" / "package.json"
    scripts = json.loads(package_json.read_text(encoding="utf-8"))["scripts"]

    assert scripts["test"].split() == ["bun", "test", "tests/", "src/"]


def test_required_operation_report_covers_every_release_capability() -> None:
    report = required_operation_report(all_required_operations() + ["vault.read"])

    assert report["operationCount"] == len(set(all_required_operations() + ["vault.read"]))
    assert set(report["capabilities"]) == {
        "settings",
        "project-context",
        "project-hub",
        "project-migration",
        "workflow",
    }


def test_required_operation_report_rejects_a_stale_bundle() -> None:
    operations = set(all_required_operations())
    operations.remove("settings.snapshot.resolve")
    operations.remove("workflow.agent.leave")

    with pytest.raises(RuntimeError) as exc_info:
        required_operation_report(operations)

    message = str(exc_info.value)
    assert "shipped MCP bundle is missing required operations" in message
    assert "settings.snapshot.resolve" in message
    assert "workflow.agent.leave" in message
