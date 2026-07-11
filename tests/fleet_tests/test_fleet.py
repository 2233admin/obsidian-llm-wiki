"""
Fleet Tests — Unit tests for llmwiki fleet mode.
"""

import json
import tempfile
from pathlib import Path

import pytest

from fleet import FleetHub, ScoutShip, WorkerShip, VerifyShip
from fleet.message import ShipType, WorkTask, ReviewDecision
from fleet.context import ContextTrimmer, SessionManager


# Fixtures moved to conftest.py (temp_vault) so sibling test modules
# (e.g. test_dispatch_cycle.py) can share it too.


class TestFleetHub:
    """Tests for FleetHub."""

    def test_init(self, temp_vault):
        hub = FleetHub(vault=temp_vault)
        state = hub.init()

        assert state.fleet_id
        assert state.vault == temp_vault
        assert state.context_budget == 100_000

    def test_dispatch_scout(self, temp_vault):
        hub = FleetHub(vault=temp_vault)
        hub.init()

        task = WorkTask(
            id="test_task_1",
            entity="project/test",
            type="scout",
            input={"scope": ["01-Projects"]},
            output={"path": "reports/"},
        )

        result = hub.dispatch(task, to=ShipType.SCOUT)

        assert result["session_id"].startswith("scout_")
        assert result["to"] == "scout"
        assert "briefing" in result
        assert "task" in result
        assert "SCOUT" in result["briefing"]

    def test_dispatch_worker(self, temp_vault):
        hub = FleetHub(vault=temp_vault)
        hub.init()

        task = WorkTask(
            id="test_task_2",
            entity="project/test",
            type="compile",
            input={"topic": "01-Projects"},
            output={"path": "01-Projects/wiki"},
        )

        result = hub.dispatch(task, to=ShipType.WORKER)

        assert "WORKER" in result["briefing"]
        assert "compile" in result["briefing"]

    def test_collect(self, temp_vault):
        hub = FleetHub(vault=temp_vault)
        hub.init()

        task = WorkTask(id="t1", entity="p/t", type="scout")
        dispatch = hub.dispatch(task, to=ShipType.SCOUT)
        session_id = dispatch["session_id"]

        # Collect with result
        result = hub.collect(session_id, {"issues": [], "summary": "test"})

        assert result["session_id"] == session_id
        assert result["status"] == "completed"
        assert result["result"]["issues"] == []

    def test_review_cycle(self, temp_vault):
        hub = FleetHub(vault=temp_vault)
        hub.init()

        # Request review
        review = hub.request_review(
            after_ship=ShipType.SCOUT,
            name="Test Review",
            data={"issues": []},
        )

        assert review.id.startswith("review_scout_")
        assert review.status.value == "pending"

        # Decide
        decision = hub.decide_review(
            review.id,
            ReviewDecision.APPROVE,
            notes="Looks good",
        )

        assert decision["decision"] == "approve"
        assert decision["status"] == "approved"

    def test_context_report(self, temp_vault):
        hub = FleetHub(vault=temp_vault)
        hub.init()

        report = hub.context_report()

        assert "fleet_id" in report
        assert "main" in report
        assert "recommendations" in report


class TestScoutShip:
    """Tests for ScoutShip."""

    def test_scan_basic(self, temp_vault):
        scout = ScoutShip(vault=temp_vault)
        result = scout.scan()

        assert "issues" in result
        assert "significance_scores" in result
        assert "summary" in result
        assert "stats" in result

    def test_scan_specific_types(self, temp_vault):
        scout = ScoutShip(vault=temp_vault)
        result = scout.scan(issue_types=["broken_link"])

        # Should find the broken link
        broken_links = [
            i for i in result["issues"]
            if i["type"] == "broken_link"
        ]
        assert len(broken_links) > 0

    def test_scan_directories(self, temp_vault):
        scout = ScoutShip(vault=temp_vault)
        result = scout.scan(directories=["01-Projects"])

        # Should only scan 01-Projects
        assert "stats" in result

    def test_significance_assessment(self, temp_vault):
        scout = ScoutShip(vault=temp_vault)
        result = scout.scan()

        # All issues should have significance scores
        assert len(result["significance_scores"]) == len(result["issues"])


class TestWorkerShip:
    """Tests for WorkerShip."""

    def test_boundary_check(self, temp_vault):
        worker = WorkerShip(vault=temp_vault)

        # Valid path
        result = worker.check_boundary(
            str(Path(temp_vault) / "01-Projects" / "test.md"),
            [],
        )
        assert result["allowed"] is True

        # Invalid path (outside vault)
        result = worker.check_boundary("/tmp/malicious", [])
        assert result["allowed"] is False

        # Protected path
        result = worker.check_boundary(
            str(Path(temp_vault) / ".git" / "config"),
            [],
        )
        assert result["allowed"] is False


class TestVerifyShip:
    """Tests for VerifyShip."""

    def test_check_basic(self, temp_vault):
        verify = VerifyShip(vault=temp_vault)
        result = verify.check()

        # check() returns a VerifyResult dataclass, not a dict.
        assert result.status in ("pass", "fail", "warning")
        assert isinstance(result.checks, list)
        assert isinstance(result.issues, list)

    def test_check_focus(self, temp_vault):
        verify = VerifyShip(vault=temp_vault)
        result = verify.check(focus=["broken_links"])

        # Should only run broken links check
        check_types = [c.check_type for c in result.checks]
        assert "broken_links" in check_types


class TestContextTrimmer:
    """Tests for ContextTrimmer."""

    def test_estimate_tokens(self):
        trimmer = ContextTrimmer(vault="/tmp")
        # 4 chars per token
        assert trimmer.estimate_tokens("hello world") == 2

    def test_trim_within_budget(self):
        trimmer = ContextTrimmer(vault="/tmp", max_tokens=1000)
        small_content = "# Header\n\nContent here."

        result = trimmer.trim(small_content, "scout", "t1")

        assert result.trimmed is False
        assert result.content == small_content

    def test_trim_exceeds_budget(self):
        trimmer = ContextTrimmer(vault="/tmp", max_tokens=10)
        large_content = "x" * 1000  # ~250 tokens

        result = trimmer.trim(large_content, "scout", "t1")

        assert result.trimmed is True
        assert result.tokens_estimate <= trimmer.max_tokens

    def test_trim_for_scout(self):
        # Budget must be smaller than the content's estimated tokens so
        # trim() actually dispatches to the scout-specific trimming path
        # instead of short-circuiting on the "within budget" fast path.
        trimmer = ContextTrimmer(vault="/tmp", max_tokens=5)
        content = """
# index.md
index content

# Header
regular content

2026-01-01 some date
""".strip()

        result = trimmer.trim(content, "scout", "t1")

        assert result.trimmed is True
        # Should keep index.md and dates
        assert "index" in result.content

    def test_generate_briefing_scout(self):
        trimmer = ContextTrimmer(vault="/tmp")
        task = {
            "id": "t1",
            "entity": "p/t",
            "type": "scout",
        }

        briefing = trimmer.generate_briefing(task, "scout")

        assert "SCOUT" in briefing
        assert "Mission" in briefing
        assert "scout" in briefing.lower()

    def test_summarize_result(self):
        trimmer = ContextTrimmer(vault="/tmp", max_tokens=2000)
        result = {
            "status": "pass",
            "issues": [
                {"severity": "high", "type": "broken_link", "location": "test.md"},
                {"severity": "low", "type": "stale", "location": "old.md"},
            ],
            "summary": "Found 2 issues",
        }

        summary = trimmer.summarize_result(result)

        # Should be valid JSON
        data = json.loads(summary)
        assert data["status"] == "pass"
        assert data["item_count"] == 2


class TestSessionManager:
    """Tests for SessionManager."""

    def test_create_session(self):
        manager = SessionManager(vault="/tmp")
        task = {"id": "t1", "type": "scout"}

        session = manager.create_session("s1", task, "scout")

        assert session["id"] == "s1"
        assert session["status"] == "created"

    def test_update_session(self):
        manager = SessionManager(vault="/tmp")
        task = {"id": "t1", "type": "scout"}
        manager.create_session("s1", task, "scout")

        manager.update_session("s1", {"status": "running"})

        session = manager.get_session("s1")
        assert session["status"] == "running"

    def test_close_session(self):
        manager = SessionManager(vault="/tmp")
        task = {"id": "t1", "type": "scout"}
        manager.create_session("s1", task, "scout")

        closed = manager.close_session("s1")

        assert closed["status"] == "closed"
        # close_session() marks status but keeps the session retrievable
        # (audit trail); get_active_sessions() is what filters it out.
        assert manager.get_session("s1")["status"] == "closed"

    def test_get_active_sessions(self):
        manager = SessionManager(vault="/tmp")
        task = {"id": "t1", "type": "scout"}
        manager.create_session("s1", task, "scout")
        manager.create_session("s2", task, "worker")
        manager.close_session("s1")

        active = manager.get_active_sessions()
        assert len(active) == 1
        assert active[0]["id"] == "s2"


# Integration test
class TestFleetIntegration:
    """Integration tests for the full fleet."""

    def test_full_scout_verify_cycle(self, temp_vault):
        # Initialize hub
        hub = FleetHub(vault=temp_vault)
        hub.init()

        # Dispatch to scout
        task = WorkTask(
            id="full_test",
            entity="test/project",
            type="scout",
            input={"scope": ["01-Projects"]},
            output={"path": "reports/"},
        )

        scout_briefing = hub.dispatch(task, to=ShipType.SCOUT)

        # Run scout
        scout = ScoutShip(vault=temp_vault)
        scout_result = scout.scan(directories=["01-Projects"])

        # Collect result
        hub.collect(scout_briefing["session_id"], scout_result)

        # Request review
        review = hub.request_review(
            after_ship=ShipType.SCOUT,
            name="Full Test Review",
            data=scout_result,
        )

        # Approve
        hub.decide_review(review.id, ReviewDecision.APPROVE)

        # Verify
        verify = VerifyShip(vault=temp_vault)
        verify_result = verify.check()

        # Should have completed
        assert verify_result.status in ("pass", "fail", "warning")

        # Check session is tracked
        state = hub.sync()
        assert len(state["sessions"]) >= 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
