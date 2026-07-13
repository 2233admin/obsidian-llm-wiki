#!/usr/bin/env python3
"""Agent scheduler state machine for LLM Wiki Phase 5.

Also hosts the connector sweep (LMVK L1): per-source interval scheduling for
compiler/connectors/, driven by the ``connectors:`` block in vault-mind.yaml.
One process (``scheduler.py --connectors``) scans all configured sources,
runs the ones whose interval has elapsed, records last-run state, and exits
-- designed to be pulled by a single schtasks/cron entry.
"""

from __future__ import annotations

import argparse
import importlib
import json
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from evaluate import (
    ActionResult,
    AgentSettings,
    ScheduledAction,
    VaultState,
    append_log_entry,
    collect_vault_state,
    evaluate_actions,
    execute_action,
    load_settings,
    parse_simple_yaml,
    resolve_operating_mode,
    write_scheduler_state,
)

SchedulerState = str
StateProvider = Callable[[str], VaultState]
ActionEvaluator = Callable[[VaultState, AgentSettings], list[ScheduledAction]]
ActionExecutor = Callable[[ScheduledAction, VaultState, AgentSettings, str], ActionResult]


@dataclass(slots=True)
class TickReport:
    mode: str
    scheduler_state: str
    scheduled: int
    executed: int
    skipped: int
    started_at: str
    completed_at: str
    deferred_actions: list[str] = field(default_factory=list)
    results: list[ActionResult] = field(default_factory=list)


class AgentScheduler:
    def __init__(
        self,
        settings: AgentSettings,
        mode: str = "auto",
        state_provider: StateProvider | None = None,
        evaluator: ActionEvaluator | None = None,
        executor: ActionExecutor | None = None,
        logger: Callable[[str, ActionResult], object] | None = None,
    ) -> None:
        self.settings = settings
        self.mode = mode
        self.state: SchedulerState = "IDLE"
        self._state_provider = state_provider or self._default_state_provider
        self._evaluator = evaluator or evaluate_actions
        self._executor = executor or execute_action
        self._logger = logger or append_log_entry
        self._persist_state()

    def _persist_state(self, mode: str | None = None) -> None:
        write_scheduler_state(self.settings.vault_path, self.state, mode or self.mode)

    def _transition(self, next_state: SchedulerState, mode: str) -> None:
        self.state = next_state
        self._persist_state(mode)

    def _default_state_provider(self, resolved_mode: str) -> VaultState:
        return collect_vault_state(
            self.settings,
            mode=resolved_mode,
            scheduler_state=self.state,
        )

    def run_once(self) -> TickReport:
        started_at = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
        resolved_mode = resolve_operating_mode(self.mode, self.settings)

        self._transition("EVALUATE", resolved_mode)
        vault_state = self._state_provider(resolved_mode)
        actions = self._evaluator(vault_state, self.settings)

        results: list[ActionResult] = []
        deferred_actions: list[str] = []
        skipped = 0

        if resolved_mode == "day":
            deferred_actions = [action.type for action in actions]
            skipped = len(actions)
        elif actions:
            self._transition("ACTION", resolved_mode)
            for action in actions:
                results.append(self._executor(action, vault_state, self.settings, resolved_mode))

        self._transition("REPORT", resolved_mode)
        for result in results:
            self._logger(self.settings.vault_path, result)

        self._transition("IDLE", resolved_mode)
        return TickReport(
            mode=resolved_mode,
            scheduler_state=self.state,
            scheduled=len(actions),
            executed=len(results),
            skipped=skipped,
            started_at=started_at,
            completed_at=datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
            deferred_actions=deferred_actions,
            results=results,
        )

    def serve_forever(self, interval_seconds: int) -> None:
        while True:
            self.run_once()
            time.sleep(interval_seconds)


# ---------------------------------------------------------------------------
# Connector sweep (LMVK L1) -- per-source interval scheduling for
# compiler/connectors/, configured in the `connectors:` block of
# vault-mind.yaml. Single pass: run due sources, record last-run state, exit.
# ---------------------------------------------------------------------------

DEFAULT_CONNECTOR_STATE_FILE = ".vault-mind-connectors.json"
DEFAULT_CONNECTOR_OUTPUT_ROOT = "raw"
DEFAULT_CONNECTOR_INTERVAL = "60m"

_INTERVAL_RE = re.compile(r"^(\d+)\s*([smhd]?)$", re.IGNORECASE)
_INTERVAL_UNIT_SECONDS = {"": 60, "s": 1, "m": 60, "h": 3600, "d": 86400}


def parse_interval(value: object) -> int:
    """Parse a per-source interval into seconds.

    Accepts '90s' / '60m' / '6h' / '1d'. A bare integer (yaml scalar or
    unsuffixed string) is read as minutes, matching the m-heavy examples.
    """
    if isinstance(value, bool) or value is None:
        raise ValueError(f"invalid interval: {value!r}")
    if isinstance(value, int):
        candidate = str(value)
    else:
        candidate = str(value).strip()
    match = _INTERVAL_RE.match(candidate)
    if not match:
        raise ValueError(f"invalid interval: {value!r} (expected e.g. 90s / 60m / 6h / 1d)")
    amount = int(match.group(1))
    if amount <= 0:
        raise ValueError(f"invalid interval: {value!r} (must be positive)")
    return amount * _INTERVAL_UNIT_SECONDS[match.group(2).lower()]


@dataclass(slots=True)
class ConnectorSource:
    name: str
    module: str
    enabled: bool
    interval_seconds: int
    options: dict


def load_connector_sources(config: dict) -> list[ConnectorSource]:
    """Extract ConnectorSource entries from a parsed vault-mind.yaml dict."""
    block = config.get("connectors")
    if not isinstance(block, dict):
        return []
    sources_cfg = block.get("sources")
    if not isinstance(sources_cfg, dict):
        return []

    sources: list[ConnectorSource] = []
    for name, entry in sources_cfg.items():
        if not isinstance(entry, dict):
            continue
        options = {key: value for key, value in entry.items() if key not in ("enabled", "interval", "connector")}
        sources.append(
            ConnectorSource(
                name=str(name),
                module=str(entry.get("connector") or name),
                enabled=bool(entry.get("enabled", False)),
                interval_seconds=parse_interval(entry.get("interval", DEFAULT_CONNECTOR_INTERVAL)),
                options=options,
            )
        )
    return sources


def read_connector_state(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def write_connector_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def connector_is_due(state_entry: dict | None, interval_seconds: int, now: datetime) -> bool:
    """A source is due when it never ran, ran >= interval ago, or has bad state."""
    last_run = (state_entry or {}).get("last_run")
    if not last_run:
        return True
    try:
        last_dt = datetime.fromisoformat(str(last_run).replace("Z", "+00:00"))
    except ValueError:
        return True
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=timezone.utc)
    return (now - last_dt).total_seconds() >= interval_seconds


def _run_connector_source(source: ConnectorSource, output_dir: Path) -> int:
    module = importlib.import_module(f"connectors.{source.module}")
    return len(module.fetch(output_dir, **source.options))


def run_connector_sweep(
    config: dict,
    vault_path: Path,
    now: datetime | None = None,
    runner: Callable[[ConnectorSource, Path], int] | None = None,
) -> dict:
    """One scheduling pass: run every enabled + due source, persist last-run state.

    Returns a json-serializable report. A failing source is recorded (and its
    last_run advanced so it waits a full interval before retry) but never
    aborts the sweep.
    """
    now = now or datetime.now(timezone.utc)
    run_source = runner or _run_connector_source

    block = config.get("connectors") if isinstance(config.get("connectors"), dict) else {}
    output_root = Path(str(block.get("output_root") or DEFAULT_CONNECTOR_OUTPUT_ROOT))
    if not output_root.is_absolute():
        output_root = vault_path / output_root
    state_path = Path(str(block.get("state_file") or DEFAULT_CONNECTOR_STATE_FILE))
    if not state_path.is_absolute():
        state_path = vault_path / state_path

    sources = load_connector_sources(config)
    state = read_connector_state(state_path)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    report: dict = {
        "swept_at": now_iso,
        "state_file": str(state_path),
        "configured": len(sources),
        "ran": [],
        "not_due": [],
        "disabled": [],
    }

    for source in sources:
        if not source.enabled:
            report["disabled"].append(source.name)
            continue
        if not connector_is_due(state.get(source.name), source.interval_seconds, now):
            report["not_due"].append(source.name)
            continue

        try:
            files_written = run_source(source, output_root / source.name)
            status = "ok"
        except Exception as exc:  # one bad source must not abort the sweep
            files_written = 0
            status = f"error: {exc}"
        state[source.name] = {
            "last_run": now_iso,
            "last_status": status,
            "files_written": files_written,
        }
        report["ran"].append({"source": source.name, "status": status, "files_written": files_written})

    if report["ran"]:
        write_connector_state(state_path, state)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description="LLM Wiki agent scheduler")
    parser.add_argument("--config", help="Path to vault-mind.yaml", default=None)
    parser.add_argument("--vault", help="Vault path override", default=None)
    parser.add_argument("--mode", choices=["day", "night", "auto"], default="auto")
    parser.add_argument("--once", action="store_true", help="Run a single scheduler tick")
    parser.add_argument("--interval", type=int, default=300, help="Loop interval in seconds")
    parser.add_argument(
        "--connectors",
        action="store_true",
        help="Run one connector sweep (per-source intervals from vault-mind.yaml) and exit",
    )
    args = parser.parse_args()

    settings = load_settings(config_path=args.config, vault_path_override=args.vault)

    if args.connectors:
        config: dict = {}
        if settings.config_path:
            config = parse_simple_yaml(Path(settings.config_path).read_text("utf-8-sig", errors="replace"))
        report = run_connector_sweep(config, Path(settings.vault_path))
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return

    scheduler = AgentScheduler(settings, mode=args.mode)

    if args.once:
        print(json.dumps(asdict(scheduler.run_once()), indent=2, ensure_ascii=False))
        return

    scheduler.serve_forever(args.interval)


if __name__ == "__main__":
    main()
