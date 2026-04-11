"""Tests for mcp_server._preflight_write_gate -- Python preflight safety gate.

Uses unittest.mock to avoid needing a live WebSocket connection.
Tests the single-op path (commit 5). Batch recursion tests are added in commit 6.
"""

from __future__ import annotations

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from mcp.types import TextContent

# Import the gate function and constants directly
from mcp_server import _preflight_write_gate, WRITE_TOOLS_PATH_GATED, WRITE_TOOLS_CONTENT_GATED


# ---------- helpers ----------

async def gate(name: str, params: dict) -> dict | None:
    """Run the gate and return the parsed JSON payload, or None if it passes."""
    result = await _preflight_write_gate(name, params)
    if result is None:
        return None
    assert isinstance(result, TextContent)
    return json.loads(result.text)


def is_rejected(payload: dict | None, reason: str | None = None) -> bool:
    if payload is None:
        return False
    if payload.get("error") != "safety_gate_rejected":
        return False
    if reason is not None:
        return payload.get("reason") == reason
    return True


# ---------- path gate: single ops ----------

@pytest.mark.asyncio
async def test_vault_create_blocked_path_obsidian_config() -> None:
    payload = await gate("vault_create", {"path": ".obsidian/config.json", "content": "{}"})
    assert is_rejected(payload, "protected_path")
    assert payload["path"] == ".obsidian/config.json"


@pytest.mark.asyncio
async def test_vault_create_safe_path_passes() -> None:
    # Good content: no issues, no bridge read needed for create
    payload = await gate("vault_create", {"path": "notes/good.md", "content": "# Hello\n\nGood note.\n"})
    assert payload is None


@pytest.mark.asyncio
async def test_vault_delete_blocked_path_git_head() -> None:
    payload = await gate("vault_delete", {"path": ".git/HEAD"})
    assert is_rejected(payload, "protected_path")


@pytest.mark.asyncio
async def test_vault_delete_safe_path_passes() -> None:
    payload = await gate("vault_delete", {"path": "notes/deleteme.md"})
    assert payload is None


@pytest.mark.asyncio
async def test_vault_rename_from_checked() -> None:
    payload = await gate("vault_rename", {"from": ".obsidian/app.json", "to": "notes/ok.md"})
    assert is_rejected(payload, "protected_path")
    assert payload["path"] == ".obsidian/app.json"


@pytest.mark.asyncio
async def test_vault_rename_to_checked() -> None:
    payload = await gate("vault_rename", {"from": "notes/ok.md", "to": ".git/stolen.md"})
    assert is_rejected(payload, "protected_path")
    assert payload["path"] == ".git/stolen.md"


@pytest.mark.asyncio
async def test_vault_rename_both_safe_passes() -> None:
    payload = await gate("vault_rename", {"from": "notes/old.md", "to": "notes/new.md"})
    assert payload is None


@pytest.mark.asyncio
async def test_vault_mkdir_blocked_obsidian_plugins() -> None:
    # vault_mkdir is in WRITE_TOOLS_PATH_GATED (ADR Q2).
    # Not in TOOL_MAP, but _preflight_write_gate handles it directly.
    payload = await gate("vault_mkdir", {"path": ".obsidian/plugins"})
    assert is_rejected(payload, "protected_path")


@pytest.mark.asyncio
async def test_vault_mkdir_safe_passes() -> None:
    payload = await gate("vault_mkdir", {"path": "notes/new-folder"})
    assert payload is None


# ---------- content gate: create ----------

@pytest.mark.asyncio
async def test_vault_create_invalid_content_wikilink_mismatch() -> None:
    # Unclosed wikilink bracket
    payload = await gate("vault_create", {"path": "notes/good.md", "content": "see [[broken bracket\n"})
    assert is_rejected(payload, "content_validation_failed")
    assert "errors" in payload
    assert any("bracket" in e.lower() for e in payload["errors"])


@pytest.mark.asyncio
async def test_vault_create_invalid_content_unclosed_fence() -> None:
    payload = await gate("vault_create", {"path": "notes/broken.md", "content": "# Title\n\n```python\nunclosed\n"})
    assert is_rejected(payload, "content_validation_failed")
    assert any("code fence" in e.lower() for e in payload["errors"])


# ---------- content gate: modify (requires bridge.read mock) ----------

@pytest.mark.asyncio
async def test_vault_modify_safe_passes() -> None:
    original = "# Title\n\nOriginal content.\n"
    mock_vb = AsyncMock()
    mock_vb.call = AsyncMock(return_value={"content": original})
    with patch("mcp_server.get_bridge", return_value=mock_vb):
        payload = await gate("vault_modify", {"path": "notes/existing.md", "content": "# Title\n\nUpdated content.\n"})
    assert payload is None


@pytest.mark.asyncio
async def test_vault_modify_invalid_content_drops_wikilinks() -> None:
    original = "# Title\n\nSee [[ImportantLink]] for details.\n"
    mock_vb = AsyncMock()
    mock_vb.call = AsyncMock(return_value={"content": original})
    with patch("mcp_server.get_bridge", return_value=mock_vb):
        payload = await gate("vault_modify", {
            "path": "notes/existing.md",
            "content": "# Title\n\nDropped the link entirely.\n",
        })
    assert is_rejected(payload, "content_validation_failed")
    assert any("wikilink" in e.lower() or "dropped" in e.lower() for e in payload["errors"])


# ---------- read-only tools pass gate untouched ----------

@pytest.mark.asyncio
async def test_vault_read_passes_gate() -> None:
    # vault_read is not in WRITE_TOOLS_PATH_GATED or WRITE_TOOLS_CONTENT_GATED
    payload = await gate("vault_read", {"path": ".obsidian/config.json"})
    assert payload is None


@pytest.mark.asyncio
async def test_vault_list_passes_gate() -> None:
    payload = await gate("vault_list", {"path": ".git"})
    assert payload is None


@pytest.mark.asyncio
async def test_vault_search_passes_gate() -> None:
    payload = await gate("vault_search", {"query": "test"})
    assert payload is None


# ---------- WRITE_TOOLS_PATH_GATED and WRITE_TOOLS_CONTENT_GATED sets ----------

def test_write_tools_path_gated_has_six_entries() -> None:
    assert "vault_create" in WRITE_TOOLS_PATH_GATED
    assert "vault_modify" in WRITE_TOOLS_PATH_GATED
    assert "vault_append" in WRITE_TOOLS_PATH_GATED
    assert "vault_delete" in WRITE_TOOLS_PATH_GATED
    assert "vault_rename" in WRITE_TOOLS_PATH_GATED
    assert "vault_mkdir" in WRITE_TOOLS_PATH_GATED


def test_write_tools_content_gated_has_three_entries() -> None:
    assert WRITE_TOOLS_CONTENT_GATED == frozenset({"vault_create", "vault_modify", "vault_append"})
    assert "vault_mkdir" not in WRITE_TOOLS_CONTENT_GATED
    assert "vault_delete" not in WRITE_TOOLS_CONTENT_GATED


# ---------- vault_batch sub-op recursion (commit 6) ----------

def make_batch_params(*ops: dict) -> dict:
    """Helper: build vault_batch params from list of {method, params} dicts."""
    return {"operations": list(ops)}


@pytest.mark.asyncio
async def test_batch_safe_write_op_passes() -> None:
    # Batch with one safe vault.create sub-op -> gate passes
    payload = await gate("vault_batch", make_batch_params(
        {"method": "vault.create", "params": {"path": "notes/good.md", "content": "# Hi\n"}},
    ))
    assert payload is None


@pytest.mark.asyncio
async def test_batch_read_only_ops_pass() -> None:
    # Batch with only read-only ops -> gate passes entirely
    payload = await gate("vault_batch", make_batch_params(
        {"method": "vault.read", "params": {"path": "notes/any.md"}},
        {"method": "vault.list", "params": {"path": ""}},
        {"method": "vault.search", "params": {"query": "test"}},
    ))
    assert payload is None


@pytest.mark.asyncio
async def test_batch_rejected_vault_create_sub_op() -> None:
    # Batch with a blocked vault.create sub-op -> whole batch rejected
    payload = await gate("vault_batch", make_batch_params(
        {"method": "vault.read", "params": {"path": "notes/any.md"}},
        {"method": "vault.create", "params": {"path": ".obsidian/evil.json", "content": "{}"}},
    ))
    assert is_rejected(payload, "batch_sub_operation_rejected")
    assert payload["index"] == 1
    assert payload["method"] == "vault.create"
    assert "detail" in payload
    assert payload["detail"]["reason"] == "protected_path"


@pytest.mark.asyncio
async def test_batch_vault_init_sub_op_passes_gate() -> None:
    # vault.init is absent from reverse_map (ADR Q1 invariant).
    # As a batch sub-op it should NOT be gated -- gate returns None.
    payload = await gate("vault_batch", make_batch_params(
        {"method": "vault.init", "params": {"topic": "test-topic"}},
    ))
    assert payload is None


@pytest.mark.asyncio
async def test_batch_vault_mkdir_sub_op_blocked_obsidian() -> None:
    # vault.mkdir IS in reverse_map (ADR Q2 invariant).
    # A batch sub-op targeting .obsidian must be rejected.
    payload = await gate("vault_batch", make_batch_params(
        {"method": "vault.mkdir", "params": {"path": ".obsidian"}},
    ))
    assert is_rejected(payload, "batch_sub_operation_rejected")
    assert payload["index"] == 0
    assert payload["method"] == "vault.mkdir"
    assert payload["detail"]["reason"] == "protected_path"


@pytest.mark.asyncio
async def test_batch_vault_mkdir_sub_op_safe_passes() -> None:
    # Safe mkdir as batch sub-op -> gate passes
    payload = await gate("vault_batch", make_batch_params(
        {"method": "vault.mkdir", "params": {"path": "notes/new-folder"}},
    ))
    assert payload is None


@pytest.mark.asyncio
async def test_batch_mixed_read_and_blocked_write() -> None:
    # Batch: read (ok), safe create (ok), blocked delete (.git) -> rejected at index 2
    payload = await gate("vault_batch", make_batch_params(
        {"method": "vault.read", "params": {"path": "notes/a.md"}},
        {"method": "vault.create", "params": {"path": "notes/good.md", "content": "# Hi\n"}},
        {"method": "vault.delete", "params": {"path": ".git/config"}},
    ))
    assert is_rejected(payload, "batch_sub_operation_rejected")
    assert payload["index"] == 2
    assert payload["method"] == "vault.delete"


@pytest.mark.asyncio
async def test_batch_empty_operations_passes() -> None:
    payload = await gate("vault_batch", {"operations": []})
    assert payload is None


# ---------- Gap #4: vault_mkdir end-to-end via vault_batch ----------
# vault_mkdir is NOT in TOOL_MAP so it can only be reached via vault_batch.
# These tests exercise the call_tool -> _handle_batch -> reverse_map path.

@pytest.mark.asyncio
async def test_call_tool_vault_batch_mkdir_blocked_obsidian_plugins() -> None:
    # Calling gate with vault_batch containing vault.mkdir to a protected path
    # must produce a batch_sub_operation_rejected error.
    payload = await gate("vault_batch", make_batch_params(
        {"method": "vault.mkdir", "params": {"path": ".obsidian/plugins"}},
    ))
    assert is_rejected(payload, "batch_sub_operation_rejected")
    assert payload["index"] == 0
    assert payload["method"] == "vault.mkdir"
    assert payload["detail"]["reason"] == "protected_path"
    assert payload["detail"]["path"] == ".obsidian/plugins"


@pytest.mark.asyncio
async def test_call_tool_vault_batch_mkdir_safe_path_passes() -> None:
    # vault.mkdir to a safe directory path must not be blocked.
    payload = await gate("vault_batch", make_batch_params(
        {"method": "vault.mkdir", "params": {"path": "notes/subfolder"}},
    ))
    assert payload is None


# ---------- Gap #5: vault_mkdir does NOT invoke validateVaultWrite ----------
# vault_mkdir is path-only gated (ADR Q2). The content gate (validateVaultWrite)
# must never be called for a vault_mkdir preflight check.

@pytest.mark.asyncio
async def test_vault_mkdir_does_not_call_validate_vault_write() -> None:
    with patch("mcp_server.validate_vault_write") as mock_validate:
        payload = await gate("vault_mkdir", {"path": "notes/safe-folder"})
    assert payload is None
    mock_validate.assert_not_called()


@pytest.mark.asyncio
async def test_vault_mkdir_blocked_does_not_call_validate_vault_write() -> None:
    with patch("mcp_server.validate_vault_write") as mock_validate:
        payload = await gate("vault_mkdir", {"path": ".obsidian/plugins"})
    assert is_rejected(payload, "protected_path")
    mock_validate.assert_not_called()
