"""Tests for the connector sweep (LMVK L1) in scheduler.py.

Covers interval parsing, due-source determination, last-run state file
round-trips, yaml source loading, and the sweep itself (with an injected
fake runner -- no network).
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import evaluate
import scheduler
from connectors import chubby

NOW = datetime(2026, 7, 12, 12, 0, 0, tzinfo=timezone.utc)


class ParseIntervalTest(unittest.TestCase):
    def test_suffixed_units(self) -> None:
        self.assertEqual(scheduler.parse_interval("90s"), 90)
        self.assertEqual(scheduler.parse_interval("60m"), 3600)
        self.assertEqual(scheduler.parse_interval("6h"), 21600)
        self.assertEqual(scheduler.parse_interval("1d"), 86400)

    def test_bare_number_is_minutes(self) -> None:
        self.assertEqual(scheduler.parse_interval(15), 900)
        self.assertEqual(scheduler.parse_interval("15"), 900)

    def test_invalid_values_raise(self) -> None:
        for bad in ("", "abc", "5x", "-5m", None, True, "1.5h"):
            with self.assertRaises(ValueError):
                scheduler.parse_interval(bad)


class ConnectorIsDueTest(unittest.TestCase):
    def test_never_ran_is_due(self) -> None:
        self.assertTrue(scheduler.connector_is_due(None, 3600, NOW))
        self.assertTrue(scheduler.connector_is_due({}, 3600, NOW))

    def test_recent_run_is_not_due(self) -> None:
        entry = {"last_run": "2026-07-12T11:30:00Z"}  # 30 min ago
        self.assertFalse(scheduler.connector_is_due(entry, 3600, NOW))

    def test_elapsed_interval_is_due(self) -> None:
        entry = {"last_run": "2026-07-12T10:00:00Z"}  # 2 h ago
        self.assertTrue(scheduler.connector_is_due(entry, 3600, NOW))

    def test_exact_boundary_is_due(self) -> None:
        entry = {"last_run": "2026-07-12T11:00:00Z"}  # exactly 1 h ago
        self.assertTrue(scheduler.connector_is_due(entry, 3600, NOW))

    def test_malformed_timestamp_is_due(self) -> None:
        self.assertTrue(scheduler.connector_is_due({"last_run": "not-a-date"}, 3600, NOW))


class ConnectorStateFileTest(unittest.TestCase):
    def test_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state" / "connectors.json"
            state = {"hackernews": {"last_run": "2026-07-12T11:00:00Z", "last_status": "ok", "files_written": 3}}
            scheduler.write_connector_state(path, state)
            self.assertEqual(scheduler.read_connector_state(path), state)

    def test_missing_or_corrupt_file_reads_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "nope.json"
            self.assertEqual(scheduler.read_connector_state(missing), {})
            corrupt = Path(tmp) / "corrupt.json"
            corrupt.write_text("{not json", encoding="utf-8")
            self.assertEqual(scheduler.read_connector_state(corrupt), {})
            not_dict = Path(tmp) / "list.json"
            not_dict.write_text("[1, 2]", encoding="utf-8")
            self.assertEqual(scheduler.read_connector_state(not_dict), {})


class LoadConnectorSourcesTest(unittest.TestCase):
    YAML = "\n".join(
        [
            'vault_path: "/tmp/vault"',
            "connectors:",
            '  output_root: "raw"',
            "  sources:",
            "    hackernews:",
            "      enabled: true",
            "      interval: 60m",
            "      limit: 5",
            "    chubby-radar:",
            "      connector: chubby",
            "      channel: radar",
            "      enabled: true",
            "      interval: 6h",
            '      rss: "https://www.ithome.com/rss/"',
            "    gmail:",
            "      enabled: false",
            "      interval: 12h",
        ]
    )

    def test_sources_parsed_from_yaml(self) -> None:
        config = evaluate.parse_simple_yaml(self.YAML)
        sources = {source.name: source for source in scheduler.load_connector_sources(config)}
        self.assertEqual(set(sources), {"hackernews", "chubby-radar", "gmail"})

        hn = sources["hackernews"]
        self.assertEqual((hn.module, hn.enabled, hn.interval_seconds), ("hackernews", True, 3600))
        self.assertEqual(hn.options, {"limit": 5})

        radar = sources["chubby-radar"]
        self.assertEqual((radar.module, radar.interval_seconds), ("chubby", 21600))
        self.assertEqual(radar.options, {"channel": "radar", "rss": "https://www.ithome.com/rss/"})

        self.assertFalse(sources["gmail"].enabled)

    def test_missing_block_yields_no_sources(self) -> None:
        self.assertEqual(scheduler.load_connector_sources({}), [])
        self.assertEqual(scheduler.load_connector_sources({"connectors": {}}), [])


class RunConnectorSweepTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.vault = Path(tmp.name)
        self.config = evaluate.parse_simple_yaml(LoadConnectorSourcesTest.YAML)

    def test_sweep_runs_due_sources_and_persists_state(self) -> None:
        calls: list[tuple[str, str]] = []

        def fake_runner(source: scheduler.ConnectorSource, output_dir: Path) -> int:
            calls.append((source.name, str(output_dir)))
            return 2

        report = scheduler.run_connector_sweep(self.config, self.vault, now=NOW, runner=fake_runner)

        self.assertEqual([name for name, _ in calls], ["hackernews", "chubby-radar"])
        self.assertTrue(calls[0][1].endswith(os.path.join("raw", "hackernews")))
        self.assertEqual(report["disabled"], ["gmail"])
        self.assertEqual(report["not_due"], [])
        self.assertEqual(
            {entry["source"]: entry["status"] for entry in report["ran"]},
            {"hackernews": "ok", "chubby-radar": "ok"},
        )

        state = scheduler.read_connector_state(self.vault / ".vault-mind-connectors.json")
        self.assertEqual(state["hackernews"]["files_written"], 2)
        self.assertEqual(state["hackernews"]["last_run"], "2026-07-12T12:00:00Z")

    def test_second_sweep_before_interval_runs_nothing(self) -> None:
        def fake_runner(source: scheduler.ConnectorSource, output_dir: Path) -> int:
            return 1

        scheduler.run_connector_sweep(self.config, self.vault, now=NOW, runner=fake_runner)

        def exploding_runner(source: scheduler.ConnectorSource, output_dir: Path) -> int:
            raise AssertionError("nothing should be due")

        report = scheduler.run_connector_sweep(self.config, self.vault, now=NOW, runner=exploding_runner)
        self.assertEqual(report["ran"], [])
        self.assertEqual(sorted(report["not_due"]), ["chubby-radar", "hackernews"])

    def test_failing_source_recorded_but_sweep_continues(self) -> None:
        def flaky_runner(source: scheduler.ConnectorSource, output_dir: Path) -> int:
            if source.name == "hackernews":
                raise RuntimeError("boom")
            return 1

        report = scheduler.run_connector_sweep(self.config, self.vault, now=NOW, runner=flaky_runner)
        statuses = {entry["source"]: entry["status"] for entry in report["ran"]}
        self.assertEqual(statuses["chubby-radar"], "ok")
        self.assertTrue(statuses["hackernews"].startswith("error:"))

        # failed source still advances last_run: waits a full interval, no hammering
        state = scheduler.read_connector_state(self.vault / ".vault-mind-connectors.json")
        self.assertEqual(state["hackernews"]["last_run"], "2026-07-12T12:00:00Z")
        self.assertEqual(state["hackernews"]["files_written"], 0)


class ChubbyConnectorGuardTest(unittest.TestCase):
    """No-network guards: missing install and HITL channels return []."""

    def test_missing_install_returns_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            old = os.environ.get(chubby.HOME_ENV_VAR)
            os.environ[chubby.HOME_ENV_VAR] = str(Path(tmp) / "not-installed")
            try:
                self.assertEqual(chubby.fetch(Path(tmp) / "out", channel="radar"), [])
            finally:
                if old is None:
                    os.environ.pop(chubby.HOME_ENV_VAR, None)
                else:
                    os.environ[chubby.HOME_ENV_VAR] = old
            self.assertFalse((Path(tmp) / "out").exists())

    def test_hitl_channel_returns_empty(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            for channel in ("wechat", "bilibili", "xiaohongshu", "totally-unknown"):
                self.assertEqual(chubby.fetch(Path(tmp) / "out", channel=channel), [])
            self.assertFalse((Path(tmp) / "out").exists())


if __name__ == "__main__":
    unittest.main()
