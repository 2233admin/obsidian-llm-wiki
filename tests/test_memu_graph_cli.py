from __future__ import annotations

import sys
from types import SimpleNamespace

from memu_graph.cli import _get_pg_pool


def test_pg_pool_does_not_inject_a_default_password(monkeypatch):
    calls: list[tuple[str, dict[str, str]]] = []
    connection = SimpleNamespace(autocommit=True)
    monkeypatch.delenv("PGUSER", raising=False)
    monkeypatch.delenv("PGPASSWORD", raising=False)
    monkeypatch.setitem(
        sys.modules,
        "psycopg2",
        SimpleNamespace(connect=lambda dsn, **kwargs: calls.append((dsn, kwargs)) or connection),
    )

    assert _get_pg_pool("postgresql://localhost/wiki") is connection
    assert calls == [("postgresql://localhost/wiki", {})]
    assert connection.autocommit is False


def test_pg_pool_passes_environment_credentials_out_of_band(monkeypatch):
    calls: list[tuple[str, dict[str, str]]] = []
    connection = SimpleNamespace(autocommit=True)
    monkeypatch.setenv("PGUSER", "wiki-user")
    monkeypatch.setenv("PGPASSWORD", "fixture-password")
    monkeypatch.setitem(
        sys.modules,
        "psycopg2",
        SimpleNamespace(connect=lambda dsn, **kwargs: calls.append((dsn, kwargs)) or connection),
    )

    assert _get_pg_pool("postgresql://localhost/wiki") is connection
    assert calls == [(
        "postgresql://localhost/wiki",
        {"user": "wiki-user", "password": "fixture-password"},
    )]
