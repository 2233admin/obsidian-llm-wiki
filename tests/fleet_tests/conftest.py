"""Shared fixtures for fleet tests."""

import pytest


@pytest.fixture
def temp_vault(tmp_path):
    """Create a temporary vault with test content."""
    vault = tmp_path / "vault"
    vault.mkdir()

    # Create test structure
    (vault / "01-Projects").mkdir()
    (vault / "01-Projects").touch("index.md")
    (vault / "02-Infrastructure").mkdir()
    (vault / "02-Infrastructure").touch("index.md")

    # Create a file with broken link
    test_file = vault / "01-Projects" / "test.md"
    test_file.write_text("""
---
title: Test
---

# Test

This has a [[Broken Link]] and a [[Good Link]].

## Another Section

More content here.
""")

    # Create good link target
    (vault / "01-Projects" / "Good Link.md").write_text("# Good Link\n\nThis exists.")

    return str(vault)
