"""
Fleet Dispatch Cycle Tests — TDD for multi-agent orchestration.

Red Phase: Write failing tests for the dispatch cycle:
1. Scout → Review → Worker → Verify
2. Sequential execution with review points
3. State propagation between ships
"""

import pytest

from fleet import FleetHub, ScoutShip, WorkerShip, VerifyShip
from fleet.message import ShipType, WorkTask, ReviewDecision, ReviewStatus


class TestFleetDispatchCycle:
    """
    Tests for the full fleet dispatch cycle:
    Scout → Review → Worker → Review → Verify
    """

    @pytest.fixture
    def hub_and_vault(self, temp_vault):
        """Create hub and ships."""
        hub = FleetHub(vault=temp_vault)
        hub.init()
        scout = ScoutShip(vault=temp_vault)
        worker = WorkerShip(vault=temp_vault)
        verify = VerifyShip(vault=temp_vault)
        return hub, scout, worker, verify, temp_vault

    # === RED PHASE: Write failing tests ===

    def test_should_dispatch_scout_and_collect_result(self, hub_and_vault):
        """
        RED: Should dispatch to Scout, run scan, and collect result.

        Currently fails because we need to define the full cycle.
        """
        hub, scout, worker, verify, vault = hub_and_vault

        # Dispatch to Scout
        task = WorkTask(
            id="dispatch_test_1",
            entity="test/project",
            type="scout",
            input={"scope": ["01-Projects"]},
            output={"path": "reports/"},
        )
        scout_briefing = hub.dispatch(task, to=ShipType.SCOUT)

        # Run Scout
        scout_result = scout.scan(directories=["01-Projects"])

        # Collect result
        collected = hub.collect(scout_briefing["session_id"], scout_result)

        # Assert
        assert collected["status"] == "completed"
        assert collected["result"]["stats"]["total_issues"] >= 0

    def test_should_block_on_review_until_decision(self, hub_and_vault):
        """
        RED: Should block on review point until human decides.

        Currently fails because we need review blocking logic.
        """
        hub, scout, worker, verify, vault = hub_and_vault

        # Setup: dispatch and run scout
        task = WorkTask(id="review_block_test", entity="t/p", type="scout")
        scout_briefing = hub.dispatch(task, to=ShipType.SCOUT)
        scout_result = scout.scan()
        hub.collect(scout_briefing["session_id"], scout_result)

        # Request review
        review = hub.request_review(
            after_ship=ShipType.SCOUT,
            name="Test Review",
            data=scout_result,
        )

        # Review should be pending
        assert review.status == ReviewStatus.PENDING

        # Hub should report blocking reviews exist
        pending = hub.get_pending_reviews()
        assert len(pending) == 1
        assert pending[0]["status"] == "pending"

    def test_should_approve_and_proceed_to_worker(self, hub_and_vault):
        """
        RED: After approval, should proceed to Worker.

        Currently fails because we need sequential dispatch logic.
        """
        hub, scout, worker, verify, vault = hub_and_vault

        # Phase 1: Scout
        scout_task = WorkTask(
            id="sequential_test",
            entity="test/project",
            type="scout",
            input={"scope": ["01-Projects"]},
            output={"path": "reports/"},
        )
        scout_briefing = hub.dispatch(scout_task, to=ShipType.SCOUT)
        scout_result = scout.scan(directories=["01-Projects"])
        hub.collect(scout_briefing["session_id"], scout_result)

        # Phase 2: Review and approve
        review = hub.request_review(
            after_ship=ShipType.SCOUT,
            name="Scout Review",
            data=scout_result,
        )
        hub.decide_review(review.id, ReviewDecision.APPROVE)

        # Phase 3: Worker
        worker_task = WorkTask(
            id="sequential_test",
            entity="test/project",
            type="compile",
            input={"topic": "01-Projects", "model": "haiku"},
            output={"path": "01-Projects/wiki"},
            constraints=["dry-run"],  # Don't actually compile
        )
        worker_briefing = hub.dispatch(worker_task, to=ShipType.WORKER)

        # Assert worker was dispatched
        assert worker_briefing["session_id"].startswith("worker_")
        assert "compile" in worker_briefing["briefing"]

    def test_should_track_full_execution_history(self, hub_and_vault):
        """
        RED: Should track full execution history across all ships.

        Currently fails because we need history tracking.
        """
        hub, scout, worker, verify, vault = hub_and_vault

        # Run full cycle
        task = WorkTask(id="history_test", entity="t/p", type="scout")
        briefing = hub.dispatch(task, to=ShipType.SCOUT)
        scout_result = scout.scan()
        hub.collect(briefing["session_id"], scout_result)
        review = hub.request_review(after_ship=ShipType.SCOUT, name="R", data=scout_result)
        hub.decide_review(review.id, ReviewDecision.APPROVE)

        # Check history
        state = hub.sync()
        dispatch_log = state["dispatch_log"]

        # Should have 2 dispatches (scout + implied worker)
        assert len(dispatch_log) >= 1

        # All dispatches should have timestamps
        for entry in dispatch_log:
            assert "timestamp" in entry
            assert "session_id" in entry
            assert "to" in entry

    def test_should_reject_and_stop_execution(self, hub_and_vault):
        """
        RED: Should stop execution when review is rejected.

        Currently fails because we need rejection handling.
        """
        hub, scout, worker, verify, vault = hub_and_vault

        # Scout
        task = WorkTask(id="reject_test", entity="t/p", type="scout")
        briefing = hub.dispatch(task, to=ShipType.SCOUT)
        scout_result = scout.scan()
        hub.collect(briefing["session_id"], scout_result)

        # Review and reject
        review = hub.request_review(
            after_ship=ShipType.SCOUT,
            name="Reject Test",
            data=scout_result,
        )
        decision = hub.decide_review(review.id, ReviewDecision.REJECT)

        # Decision should be rejected
        assert decision["decision"] == "reject"
        assert decision["status"] == "rejected"

        # No new dispatches should be auto-created; rejection stops the cycle.
        assert len(hub.sync()["dispatch_log"]) == 1

    def test_should_run_full_scout_worker_verify_cycle(self, hub_and_vault):
        """
        RED: Should run full Scout → Worker → Verify cycle with reviews.

        This is the main integration test for the dispatch cycle.
        """
        hub, scout, worker, verify, vault = hub_and_vault

        # === PHASE 1: SCOUT ===
        scout_task = WorkTask(
            id="full_cycle_test",
            entity="test/full-cycle",
            type="scout",
            input={"scope": ["01-Projects"]},
            output={"path": "reports/"},
        )

        # Dispatch
        scout_briefing = hub.dispatch(scout_task, to=ShipType.SCOUT)
        assert scout_briefing["session_id"].startswith("scout_")

        # Execute
        scout_result = scout.scan(directories=["01-Projects"])

        # Collect
        hub.collect(scout_briefing["session_id"], scout_result)

        # Review point
        scout_review = hub.request_review(
            after_ship=ShipType.SCOUT,
            name="Scout Report Review",
            data=scout_result,
        )

        # Decide
        hub.decide_review(scout_review.id, ReviewDecision.APPROVE)

        # === PHASE 2: VERIFY (instead of Worker for dry-run) ===
        # In production, this would be Worker then Verify
        verify_task = WorkTask(
            id="full_cycle_test",
            entity="test/full-cycle",
            type="verify",
            input={"scope": ["01-Projects"]},
            output={"path": "reports/"},
        )

        verify_briefing = hub.dispatch(verify_task, to=ShipType.VERIFY)
        assert verify_briefing["session_id"].startswith("verify_")

        # Execute
        verify_result = verify.check(directories=["01-Projects"])

        # Collect
        hub.collect(verify_briefing["session_id"], verify_result.to_payload())

        # Final review point
        verify_review = hub.request_review(
            after_ship=ShipType.VERIFY,
            name="Verification Review",
            data=verify_result.to_payload(),
        )

        # Decide
        final_decision = hub.decide_review(verify_review.id, ReviewDecision.APPROVE)

        # === ASSERTIONS ===
        # Full cycle completed
        state = hub.sync()
        assert len(state["sessions"]) >= 2  # scout + verify

        # All reviews decided
        for review_id, review in state["review_points"].items():
            assert review["status"] in ["approved", "rejected"]

        # Final decision should be approved
        assert final_decision["decision"] == "approve"


class TestFleetDispatchSequencing:
    """
    Tests for dispatch sequencing and dependencies.
    """

    @pytest.fixture
    def hub_and_vault(self, temp_vault):
        hub = FleetHub(vault=temp_vault)
        hub.init()
        return hub, temp_vault

    def test_should_dispatch_multiple_ships_sequentially(self, hub_and_vault):
        """
        RED: Should dispatch to multiple ships in sequence.
        """
        hub, vault = hub_and_vault

        # Dispatch Scout
        task1 = WorkTask(id="seq1", entity="t/p", type="scout")
        b1 = hub.dispatch(task1, to=ShipType.SCOUT)

        # Dispatch Worker (after Scout completes)
        task2 = WorkTask(id="seq2", entity="t/p", type="worker")
        b2 = hub.dispatch(task2, to=ShipType.WORKER)

        # Both should have different session IDs
        assert b1["session_id"] != b2["session_id"]

        # Both should have correct ship types
        assert b1["to"] == "scout"
        assert b2["to"] == "worker"

    def test_should_not_allow_dispatch_to_unknown_ship(self, hub_and_vault):
        """
        RED: Should reject dispatch to unknown ship type.
        """
        hub, vault = hub_and_vault

        # This should raise or return an error
        # For now, just verify the enum check works
        from fleet.message import ShipType
        assert ShipType.SCOUT.value == "scout"
        assert ShipType.WORKER.value == "worker"
        assert ShipType.VERIFY.value == "verify"


class TestFleetReviewBlocking:
    """
    Tests for review point blocking behavior.
    """

    @pytest.fixture
    def hub_and_vault(self, temp_vault):
        hub = FleetHub(vault=temp_vault)
        hub.init()
        return hub, temp_vault

    def test_should_track_pending_reviews(self, hub_and_vault):
        """
        RED: Should accurately track pending reviews.
        """
        hub, vault = hub_and_vault

        # Create some reviews
        r1 = hub.request_review(after_ship=ShipType.SCOUT, name="R1", data={})
        hub.request_review(after_ship=ShipType.WORKER, name="R2", data={})

        pending = hub.get_pending_reviews()

        assert len(pending) == 2

        # Decision on one should reduce pending
        hub.decide_review(r1.id, ReviewDecision.APPROVE)
        pending = hub.get_pending_reviews()
        assert len(pending) == 1

    def test_should_record_review_decision_with_notes(self, hub_and_vault):
        """
        RED: Should record decision and notes.
        """
        hub, vault = hub_and_vault

        review = hub.request_review(
            after_ship=ShipType.SCOUT,
            name="Decision Test",
            data={"test": True},
        )

        decision = hub.decide_review(
            review.id,
            ReviewDecision.APPROVE,
            notes="Looks good, approved for next phase",
            decided_by="test_agent",
        )

        assert decision["decision"] == "approve"
        assert "approved" in decision["status"]

    def test_should_support_skip_decision(self, hub_and_vault):
        """
        RED: Should support SKIP decision to bypass review.
        """
        hub, vault = hub_and_vault

        review = hub.request_review(after_ship=ShipType.SCOUT, name="Skip Test", data={})
        decision = hub.decide_review(review.id, ReviewDecision.SKIP)

        assert decision["decision"] == "skip"
        assert decision["can_proceed"] is True  # SKIP allows proceeding


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
