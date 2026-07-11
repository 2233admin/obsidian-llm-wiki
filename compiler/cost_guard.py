#!/usr/bin/env python3
"""LMVK L2 cost guardrail -- a small state file + pure gate so the 15-min
incremental-compile cron (scripts/lmvk-incremental-compile.ps1) can refuse
to spend past a daily dollar cap.

State file (JSON), one record for "today":
    {"date": "2026-07-12", "spend_usd": 3.4}

A new UTC calendar day resets the counter -- a stale date on disk reads as
0.0 spent for "today", it never carries debt across days. Pure /
deterministic: every function takes its inputs as arguments and returns a
value; no network/LLM call of its own (mirrors compiler/scheduler.py's
connector state read/write pair and compiler/work_budget.py's
before-spawn spend-gate pattern).

CLI (for the PS1 caller, which prefers an exit code over parsing JSON):

    python cost_guard.py check  --state <path> [--cap 5.0] [--today-spend 0.0]
        Exit 2 -> caller should early-exit (skip the compile run).
        Exit 0 -> under cap, proceed.

    python cost_guard.py record --state <path> --cost <float>
        Add an actual/estimated cost to today's running total.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_CAP_USD = 5.0
DEFAULT_STATE_FILENAME = ".vault-mind-cost-guard.json"


def today_utc(now: datetime | None = None) -> str:
    """UTC calendar date (YYYY-MM-DD) for `now` (default: current time)."""
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m-%d")


def read_spend_state(state_file: Path) -> dict:
    """Read {"date": ..., "spend_usd": ...} from disk.

    Missing file, unreadable file, corrupt JSON, or JSON that isn't an
    object all read as {} -- never raises (mirrors
    scheduler.read_connector_state's fail-open contract).
    """
    try:
        data = json.loads(Path(state_file).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def write_spend_state(state_file: Path, date: str, spend_usd: float) -> None:
    """Persist {"date": date, "spend_usd": spend_usd}.

    Creates parent directories as needed. Good enough for a once-per-15-min
    cron with a single writer; no locking (matches
    scheduler.write_connector_state).
    """
    path = Path(state_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"date": date, "spend_usd": spend_usd}, indent=2) + "\n",
        encoding="utf-8",
    )


def get_today_spend(state_file: Path, now: datetime | None = None) -> float:
    """Spend recorded for *today* only.

    A state file whose ``date`` doesn't match today's UTC date (stale --
    yesterday's run, or older) reads as 0.0: the daily counter resets with
    the calendar day, it does not roll over debt.
    """
    state = read_spend_state(state_file)
    if state.get("date") != today_utc(now):
        return 0.0
    try:
        return max(0.0, float(state.get("spend_usd", 0.0)))
    except (TypeError, ValueError):
        return 0.0


def should_early_exit(
    state_file: Path,
    today_spend: float = 0.0,
    cap: float = DEFAULT_CAP_USD,
    now: datetime | None = None,
) -> bool:
    """The $/day gate. True -> the caller should skip the compile run.

    Args:
        state_file: path to the JSON state file recording today's spend so
            far (see ``get_today_spend``).
        today_spend: an additional projected/known cost about to be
            incurred by the imminent run (e.g. an estimate). Pass 0.0 (the
            default) to just check the already-recorded total.
        cap: the daily dollar cap. cap <= 0 always exits (a caller that
            wants "no guardrail at all" should not call this function,
            not pass cap=0).
        now: override "current time" for deterministic tests.

    Returns True when the recorded spend already reached/exceeded cap, or
    when adding ``today_spend`` would push the total past cap.
    """
    if cap <= 0:
        return True
    recorded = get_today_spend(state_file, now)
    if recorded >= cap:
        return True
    return (recorded + max(0.0, today_spend)) > cap


def record_spend(state_file: Path, cost: float, now: datetime | None = None) -> float:
    """Add `cost` to today's running total and persist it.

    Resets to `cost` if the state file's date is stale (new day). Returns
    the new total. Negative cost is a programming error -- rejected
    (mirrors work_budget.debit: spend only ever grows).
    """
    if cost < 0:
        raise ValueError(f"cost must be non-negative, got {cost}")
    today = today_utc(now)
    new_total = get_today_spend(state_file, now) + cost
    write_spend_state(state_file, today, new_total)
    return new_total


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        prog="cost_guard.py",
        description="LMVK L2 daily $ cost guardrail",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    check = sub.add_parser(
        "check", help="Evaluate the daily cap; exit 2 if the caller should early-exit"
    )
    check.add_argument("--state", required=True, help="Path to the cost-guard state JSON file")
    check.add_argument("--cap", type=float, default=DEFAULT_CAP_USD)
    check.add_argument(
        "--today-spend", type=float, default=0.0,
        help="Additional projected cost about to be incurred (default 0.0 -- just check the recorded total)",
    )

    record = sub.add_parser("record", help="Record an actual/estimated spend against today's total")
    record.add_argument("--state", required=True)
    record.add_argument("--cost", type=float, required=True)

    args = parser.parse_args()

    if args.cmd == "check":
        state_file = Path(args.state)
        exit_now = should_early_exit(state_file, args.today_spend, args.cap)
        verdict = {
            "early_exit": exit_now,
            "spent_today": get_today_spend(state_file),
            "cap": args.cap,
        }
        print(json.dumps(verdict))
        return 2 if exit_now else 0

    if args.cmd == "record":
        new_total = record_spend(Path(args.state), args.cost)
        print(json.dumps({"spent_today": new_total}))
        return 0

    return 1  # pragma: no cover -- argparse `required=True` blocks this


if __name__ == "__main__":
    sys.exit(main())
