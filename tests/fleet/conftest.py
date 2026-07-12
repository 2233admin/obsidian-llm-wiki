"""Shared fixtures for fleet tests."""

import pytest


@pytest.fixture
def temp_vault(tmp_path):
    """Create temporary vault test content."""
    vault = tmp_path / "vault"
    vault.mkdir()

    (vault / "01-Projects").mkdir()
    (vault / "01-Projects").joinpath("index.md").touch()
    (vault / "02-Infrastructure").mkdir()
    (vault / "02-Infrastructure").joinpath("index.md").touch()

    test_file = vault / "01-Projects" / "test.md"
    test_file.write_text(
        """
---
title: Test
---

# Test

[[Broken Link]] [[Good Link]].

## Another

content here.
"""
    )

    (vault / "01-Projects" / "Good Link.md").write_text("# Good Link\n\nThis exists.")

    return str(vault)
