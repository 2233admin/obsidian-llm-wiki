import importlib.util
from pathlib import Path

import pytest


def load_run_aide():
    path = Path(__file__).resolve().parents[1] / "run_aide.py"
    spec = importlib.util.spec_from_file_location("run_aide_security_test", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_aide_credentials_must_be_supplied_out_of_band(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    module = load_run_aide()

    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY is required"):
        module.require_runtime_credentials()


def test_aide_runtime_preserves_explicit_endpoint(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only-reference")
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://example.invalid/anthropic")
    module = load_run_aide()

    module.require_runtime_credentials()

    assert module.os.environ["ANTHROPIC_BASE_URL"] == "https://example.invalid/anthropic"
