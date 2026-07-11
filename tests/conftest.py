"""Pytest configuration for OBC tests."""
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

import re
import uuid

import pytest


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
