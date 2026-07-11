"""Tests for the LMVK L2 daily cost guardrail (compiler/cost_guard.py).

All state files live under pytest's tmp_path -- never the real
.vault-mind-cost-guard.json a live cron would write.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import cost_guard

NOW = datetime(2026, 7, 12, 12, 0, 0, tzinfo=timezone.utc)


def test_today_utc_formats_date():
    assert cost_guard.today_utc(NOW) == "2026-07-12"


def test_missing_state_file_reads_zero_spend(tmp_path):
    state = tmp_path / "cost-guard.json"
    assert cost_guard.get_today_spend(state, now=NOW) == 0.0
    assert cost_guard.should_early_exit(state, cap=5.0, now=NOW) is False


def test_corrupt_state_file_reads_zero_spend(tmp_path):
    state = tmp_path / "cost-guard.json"
    state.write_text("{not json", encoding="utf-8")
    assert cost_guard.get_today_spend(state, now=NOW) == 0.0


def test_non_dict_state_file_reads_zero_spend(tmp_path):
    state = tmp_path / "cost-guard.json"
    state.write_text("[1, 2, 3]", encoding="utf-8")
    assert cost_guard.get_today_spend(state, now=NOW) == 0.0


def test_write_then_read_round_trip(tmp_path):
    state = tmp_path / "nested" / "cost-guard.json"
    cost_guard.write_spend_state(state, "2026-07-12", 2.5)
    assert cost_guard.read_spend_state(state) == {"date": "2026-07-12", "spend_usd": 2.5}
    assert cost_guard.get_today_spend(state, now=NOW) == 2.5


def test_under_cap_does_not_exit(tmp_path):
    state = tmp_path / "cost-guard.json"
    cost_guard.write_spend_state(state, "2026-07-12", 3.0)
    assert cost_guard.should_early_exit(state, cap=5.0, now=NOW) is False


def test_at_cap_exits(tmp_path):
    state = tmp_path / "cost-guard.json"
    cost_guard.write_spend_state(state, "2026-07-12", 5.0)
    assert cost_guard.should_early_exit(state, cap=5.0, now=NOW) is True


def test_over_cap_exits(tmp_path):
    state = tmp_path / "cost-guard.json"
    cost_guard.write_spend_state(state, "2026-07-12", 7.5)
    assert cost_guard.should_early_exit(state, cap=5.0, now=NOW) is True


def test_projected_spend_pushes_past_cap(tmp_path):
    state = tmp_path / "cost-guard.json"
    cost_guard.write_spend_state(state, "2026-07-12", 4.5)
    assert cost_guard.should_early_exit(state, today_spend=0.6, cap=5.0, now=NOW) is True
    assert cost_guard.should_early_exit(state, today_spend=0.4, cap=5.0, now=NOW) is False


def test_stale_date_resets_to_zero(tmp_path):
    state = tmp_path / "cost-guard.json"
    cost_guard.write_spend_state(state, "2026-07-11", 9.0)  # yesterday, over any sane cap
    assert cost_guard.get_today_spend(state, now=NOW) == 0.0
    assert cost_guard.should_early_exit(state, cap=5.0, now=NOW) is False


def test_cap_zero_or_negative_always_exits(tmp_path):
    state = tmp_path / "cost-guard.json"
    assert cost_guard.should_early_exit(state, cap=0.0, now=NOW) is True
    assert cost_guard.should_early_exit(state, cap=-1.0, now=NOW) is True


def test_record_spend_accumulates_same_day(tmp_path):
    state = tmp_path / "cost-guard.json"
    cost_guard.record_spend(state, 1.5, now=NOW)
    total = cost_guard.record_spend(state, 2.0, now=NOW)
    assert total == 3.5
    assert cost_guard.get_today_spend(state, now=NOW) == 3.5


def test_record_spend_resets_on_new_day(tmp_path):
    state = tmp_path / "cost-guard.json"
    cost_guard.write_spend_state(state, "2026-07-11", 9.0)
    total = cost_guard.record_spend(state, 1.0, now=NOW)
    assert total == 1.0


def test_record_spend_rejects_negative_cost(tmp_path):
    state = tmp_path / "cost-guard.json"
    with pytest.raises(ValueError):
        cost_guard.record_spend(state, -1.0, now=NOW)


def test_cli_check_exit_code_over_cap(tmp_path, monkeypatch):
    state = tmp_path / "cost-guard.json"
    cost_guard.write_spend_state(state, cost_guard.today_utc(), 6.0)
    monkeypatch.setattr(
        sys, "argv", ["cost_guard.py", "check", "--state", str(state), "--cap", "5.0"]
    )
    assert cost_guard.main() == 2


def test_cli_check_exit_code_under_cap(tmp_path, monkeypatch):
    state = tmp_path / "cost-guard.json"
    monkeypatch.setattr(
        sys, "argv", ["cost_guard.py", "check", "--state", str(state), "--cap", "5.0"]
    )
    assert cost_guard.main() == 0


def test_cli_record_writes_state(tmp_path, monkeypatch):
    state = tmp_path / "cost-guard.json"
    monkeypatch.setattr(
        sys, "argv", ["cost_guard.py", "record", "--state", str(state), "--cost", "1.25"]
    )
    assert cost_guard.main() == 0
    assert cost_guard.get_today_spend(state) == 1.25


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
