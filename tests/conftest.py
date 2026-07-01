from __future__ import annotations

from pathlib import Path
import re
import uuid

import pytest
import importlib.util
import sys

_REPO_ROOT = Path(__file__).resolve().parents[1]
_FLEET_INIT = _REPO_ROOT / "fleet" / "__init__.py"
if _FLEET_INIT.exists():
    spec = importlib.util.spec_from_file_location(
        "fleet",
        _FLEET_INIT,
        submodule_search_locations=[str(_FLEET_INIT.parent)],
    )
    if spec and spec.loader:
        module = importlib.util.module_from_spec(spec)
        sys.modules["fleet"] = module
        spec.loader.exec_module(module)
        module.__path__.append(str(_REPO_ROOT / "tests" / "fleet"))


@pytest.fixture
def tmp_path(request: pytest.FixtureRequest) -> Path:
    """Windows-safe tmp_path replacement for restricted local runners.

    Pytest creates tmp dirs with mode 0o700. In this sandboxed Windows Python,
    those directories become unreadable to the same process. Use default mkdir
    permissions while keeping the public tmp_path fixture contract.
    """
    root = Path.cwd() / "_tmp" / "pytest-local"
    root.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", request.node.name)[:80]
    path = root / f"{safe_name}-{uuid.uuid4().hex}"
    path.mkdir()
    return path

@pytest.fixture
def temp_vault(tmp_path: Path) -> str:
    """Create a small vault fixture shared by fleet tests."""
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "01-Projects").mkdir()
    (vault / "02-Infrastructure").mkdir()
    (vault / "01-Projects" / "index.md").write_text("# Projects\n", encoding="utf-8")
    (vault / "02-Infrastructure" / "index.md").write_text("# Infrastructure\n", encoding="utf-8")
    (vault / "01-Projects" / "test.md").write_text(
        "---\ntitle: Test\n---\n# Test\n\n[[Broken Link]]\n[[Good Link]]\n",
        encoding="utf-8",
    )
    (vault / "01-Projects" / "Good Link.md").write_text("# Good Link\n", encoding="utf-8")
    return str(vault)
