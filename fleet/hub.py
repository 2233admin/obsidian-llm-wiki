"""
Fleet Hub — Central orchestration for llmwiki multi-agent fleet.

Responsible for:
- Dispatching tasks to ships
- Collecting results
- Managing session state
- Context trimming
- Review point coordination
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .message import (
    FleetMessage,
    MessageType,
    ReviewDecision,
    ReviewPoint,
    ReviewStatus,
    ShipType,
    SignificanceScore,
    WorkTask,
    WorkOutput,
    VerifyResult,
    ScoutReport,
)


@dataclass
class SessionState:
    """State for a single ship session."""
    id: str
    ship_type: ShipType
    task_id: str | None = None
    status: str = "idle"  # idle, running, completed, failed
    started_at: datetime | None = None
    completed_at: datetime | None = None
    result: dict | None = None
    error: str | None = None


@dataclass
class FleetState:
    """Global fleet state."""
    vault: str
    fleet_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    sessions: dict[str, SessionState] = field(default_factory=dict)
    review_points: dict[str, ReviewPoint] = field(default_factory=dict)
    dispatch_log: list[dict] = field(default_factory=list)
    context_budget: int = 100_000  # Max tokens per session
    token_spent: int = 0

    def to_dict(self) -> dict:
        return {
            "fleet_id": self.fleet_id,
            "vault": self.vault,
            "created_at": self.created_at.isoformat(),
            "sessions": {
                k: {
                    "id": v.id,
                    "ship_type": v.ship_type.value,
                    "task_id": v.task_id,
                    "status": v.status,
                    "started_at": v.started_at.isoformat() if v.started_at else None,
                    "completed_at": v.completed_at.isoformat() if v.completed_at else None,
                    "result": v.result,
                    "error": v.error,
                }
                for k, v in self.sessions.items()
            },
            "review_points": {
                k: v.to_dict() for k, v in self.review_points.items()
            },
            "dispatch_log": self.dispatch_log,
            "context_budget": self.context_budget,
            "token_spent": self.token_spent,
        }


class FleetHub:
    """
    Central orchestration hub for llmwiki fleet.

    Usage:
        hub = FleetHub(vault="/path/to/vault")
        hub.init()

        # Dispatch to Scout
        scout_briefing = hub.dispatch(
            task=task,
            to=ShipType.SCOUT,
            context={"scope": ["01-Projects", "02-Infrastructure"]}
        )

        # ... run scout in separate session ...

        # Collect result
        result = hub.collect("scout_session_id")

        # Request review
        review = hub.request_review(
            after_ship=ShipType.SCOUT,
            name="Scout Report Review",
            data=result
        )
    """

    def __init__(self, vault: str, state_dir: str | None = None):
        self.vault = Path(vault)
        self.state_dir = Path(state_dir) if state_dir else self.vault / ".vault-mind" / "fleet"
        self.state_dir.mkdir(parents=True, exist_ok=True)

        self.state_file = self.state_dir / "fleet_state.json"
        self._state: FleetState | None = None

    @property
    def state(self) -> FleetState:
        if self._state is None:
            self._state = self._load_state()
        return self._state

    def _load_state(self) -> FleetState:
        """Load or create fleet state."""
        if self.state_file.exists():
            try:
                data = json.loads(self.state_file.read_text(encoding="utf-8"))
                sessions = {
                    k: SessionState(
                        id=v["id"],
                        ship_type=ShipType(v["ship_type"]),
                        task_id=v.get("task_id"),
                        status=v.get("status", "idle"),
                        started_at=datetime.fromisoformat(v["started_at"]) if v.get("started_at") else None,
                        completed_at=datetime.fromisoformat(v["completed_at"]) if v.get("completed_at") else None,
                        result=v.get("result"),
                        error=v.get("error"),
                    )
                    for k, v in data.get("sessions", {}).items()
                }
                # Load review points
                review_points = {}
                for k, v in data.get("review_points", {}).items():
                    from .message import ReviewPoint, ReviewStatus, ReviewDecision
                    review_points[k] = ReviewPoint(
                        id=v["id"],
                        name=v["name"],
                        after_ship=ShipType(v["after_ship"]),
                        status=ReviewStatus(v["status"]),
                        decision=ReviewDecision(v["decision"]) if v.get("decision") else None,
                        review_notes=v.get("review_notes", ""),
                        created_at=datetime.fromisoformat(v["created_at"]) if v.get("created_at") else None,
                        decided_at=datetime.fromisoformat(v["decided_at"]) if v.get("decided_at") else None,
                        decided_by=v.get("decided_by", ""),
                    )
                return FleetState(
                    vault=data.get("vault", str(self.vault)),
                    fleet_id=data.get("fleet_id", str(uuid.uuid4())[:8]),
                    sessions=sessions,
                    review_points=review_points,
                    dispatch_log=data.get("dispatch_log", []),
                    context_budget=data.get("context_budget", 100_000),
                    token_spent=data.get("token_spent", 0),
                )
            except (json.JSONDecodeError, KeyError):
                pass
        return FleetState(vault=str(self.vault))

    def _save_state(self) -> None:
        """Persist fleet state."""
        self.state_file.write_text(json.dumps(self.state.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8")

    def init(self) -> FleetState:
        """Initialize fleet."""
        self.state.sessions.clear()
        self.state.review_points.clear()
        self.state.dispatch_log.clear()
        self.state.token_spent = 0
        self._save_state()
        return self.state

    def dispatch(
        self,
        task: WorkTask,
        to: ShipType,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """
        Dispatch a task to a ship.

        Returns a briefing dict with:
        - session_id: For the dispatched session
        - briefing: Trimmed context for the ship
        - task: The work task
        """
        session_id = f"{to.value}_{str(uuid.uuid4())[:8]}"

        # Create session
        session = SessionState(
            id=session_id,
            ship_type=to,
            task_id=task.id,
            status="idle",
        )
        self.state.sessions[session_id] = session

        # Log dispatch
        self.state.dispatch_log.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "session_id": session_id,
            "to": to.value,
            "task_id": task.id,
        })

        # Generate briefing
        briefing = self._generate_briefing(task, to, context)

        self._save_state()

        return {
            "session_id": session_id,
            "to": to.value,
            "briefing": briefing,
            "task": task.to_dict(),
            "context_budget": self.state.context_budget,
        }

    def _generate_briefing(
        self,
        task: WorkTask,
        to: ShipType,
        context: dict[str, Any] | None,
    ) -> str:
        """
        Generate trimmed briefing for a ship session.

        This is the key to context management: only inject what's needed
        for the specific task and ship type.
        """
        lines = [
            f"# Fleet Briefing — {to.value.upper()}",
            f"",
            f"## Task",
            f"- ID: {task.id}",
            f"- Entity: {task.entity}",
            f"- Type: {task.type}",
            f"- Priority: {task.priority}",
            f"",
        ]

        # Ship-specific context
        if to == ShipType.SCOUT:
            lines.extend([
                f"## Scout Mission",
                f"",
                f"Your job: Discover issues in the vault and assess significance.",
                f"",
                f"### Scope",
            ])
            if context and "scope" in context:
                for scope in context["scope"]:
                    lines.append(f"- {scope}")
            else:
                lines.append(f"- All directories")

            lines.extend([
                f"",
                f"### Constraints",
                f"- Do NOT modify files",
                f"- Report findings in structured format",
                f"- Assess significance for each issue",
                f"",
                f"### Output Format",
                f"Return a JSON with:",
                f'- issues: list of {{id, severity, type, location, description}}',
                f'- significance_scores: list of {{item, severity, impact, effort}}',
                f'- summary: one-line summary',
            ])

        elif to == ShipType.WORKER:
            lines.extend([
                f"## Worker Mission",
                f"",
                f"Your job: Execute the task and produce outputs.",
                f"",
                f"### Input",
                f"- Source: {task.input.get('source', 'N/A')}",
                f"- Spec: {task.input.get('spec', 'N/A')}",
                f"",
                f"### Output Target",
                f"- Path: {task.output.get('path', 'N/A')}",
                f"- Format: {task.output.get('format', 'markdown')}",
                f"",
                f"### Constraints",
            ])
            for constraint in task.constraints:
                lines.append(f"- {constraint}")
            if not task.constraints:
                lines.append(f"- Do NOT modify files outside output path")
                lines.append(f"- Follow existing code style")

            lines.extend([
                f"",
                f"### Output Format",
                f"Return a JSON with:",
                f'- success: boolean',
                f'- files_created/modified/deleted: lists',
                f'- summary: description of what was done',
            ])

        elif to == ShipType.VERIFY:
            lines.extend([
                f"## Verify Mission",
                f"",
                f"Your job: Check outputs and verify quality.",
                f"",
                f"### Focus Areas",
            ])
            if context and "focus" in context:
                for focus in context["focus"]:
                    lines.append(f"- {focus}")
            else:
                lines.extend([
                    f"- Broken links",
                    f"- Contradictions",
                    f"- Orphan pages",
                    f"- Stale content",
                ])

            lines.extend([
                f"",
                f"### Output Format",
                f"Return a JSON with:",
                f'- status: "pass" | "fail" | "warning"',
                f'- checks: list of {{check_type, status, message}}',
                f'- issues: list of issues found',
                f'- summary: overall assessment',
            ])

        lines.extend([
            f"",
            f"---",
            f"*This briefing is trimmed for context efficiency.*",
            f"*Report results via fleet hub when complete.*",
        ])

        return "\n".join(lines)

    def collect(self, session_id: str, result: dict | None = None) -> dict[str, Any]:
        """
        Collect results from a ship session.

        If result is provided, store it. Otherwise, retrieve stored result.
        """
        session = self.state.sessions.get(session_id)
        if not session:
            return {"error": f"Session {session_id} not found"}

        if result:
            # Store result
            session.result = result
            session.status = "completed"
            session.completed_at = datetime.now(timezone.utc)

            # Update token spent
            if "token_cost" in result:
                self.state.token_spent += result.get("token_cost", 0)

            self._save_state()

        return {
            "session_id": session_id,
            "status": session.status,
            "result": session.result,
            "error": session.error,
        }

    def request_review(
        self,
        after_ship: ShipType,
        name: str,
        data: dict,
        requires: str = "approve",
    ) -> ReviewPoint:
        """
        Request human review at a review point.

        Returns a ReviewPoint that blocks further execution until decided.
        """
        review_id = f"review_{after_ship.value}_{len(self.state.review_points)}"

        review = ReviewPoint(
            id=review_id,
            name=name,
            after_ship=after_ship,
            status=ReviewStatus.PENDING,
        )
        self.state.review_points[review_id] = review
        self._save_state()

        return review

    def decide_review(
        self,
        review_id: str,
        decision: ReviewDecision,
        notes: str = "",
        decided_by: str = "human",
    ) -> dict[str, Any]:
        """
        Record a review decision.

        This unblocks the fleet to continue execution.
        """
        review = self.state.review_points.get(review_id)
        if not review:
            return {"error": f"Review {review_id} not found"}

        review.status = {
            ReviewDecision.APPROVE: ReviewStatus.APPROVED,
            ReviewDecision.REJECT: ReviewStatus.REJECTED,
            ReviewDecision.MODIFY: ReviewStatus.MODIFIED,
            ReviewDecision.SKIP: ReviewStatus.SKIPPED,
        }.get(decision, ReviewStatus.PENDING)

        review.decision = decision
        review.review_notes = notes
        review.decided_at = datetime.now(timezone.utc)
        review.decided_by = decided_by

        self._save_state()

        return {
            "review_id": review_id,
            "decision": decision.value,
            "status": review.status.value,
            "can_proceed": decision in (ReviewDecision.APPROVE, ReviewDecision.SKIP),
        }

    def get_pending_reviews(self) -> list[dict]:
        """Get all pending review points."""
        return [
            {
                "id": k,
                **v.to_dict(),
            }
            for k, v in self.state.review_points.items()
            if v.status == ReviewStatus.PENDING
        ]

    def sync(self) -> dict[str, Any]:
        """Get current fleet state."""
        return self.state.to_dict()

    def context_report(self) -> dict[str, Any]:
        """Get context usage report."""
        sessions = []
        total_used = 0

        for session_id, session in self.state.sessions.items():
            used = 0
            if session.result:
                # Estimate from result size
                used = len(json.dumps(session.result)) // 4  # Rough token estimate

            sessions.append({
                "id": session_id,
                "ship": session.ship_type.value,
                "status": session.status,
                "tokens_estimate": used,
            })
            total_used += used

        return {
            "fleet_id": self.state.fleet_id,
            "main": {
                "budget": self.state.context_budget,
                "spent": self.state.token_spent,
                "remaining": self.state.context_budget - self.state.token_spent,
            },
            "sessions": sessions,
            "total_spent_estimate": total_used,
            "recommendations": self._context_recommendations(total_used),
        }

    def _context_recommendations(self, used: int) -> list[str]:
        """Generate context recommendations."""
        recommendations = []
        budget = self.state.context_budget

        if used > budget * 0.8:
            recommendations.append("CRITICAL: Context usage > 80%. Consider compacting.")
        elif used > budget * 0.6:
            recommendations.append("WARNING: Context usage > 60%. Monitor closely.")

        if len(self.state.sessions) > 5:
            recommendations.append("Consider completing some sessions before starting new ones.")

        if not recommendations:
            recommendations.append("Context usage healthy.")

        return recommendations

    def create_message(
        self,
        msg_type: MessageType,
        from_ship: ShipType,
        to_ship: ShipType | None,
        payload: dict,
    ) -> FleetMessage:
        """Create a fleet message."""
        return FleetMessage(
            type=msg_type,
            from_ship=from_ship,
            to_ship=to_ship,
            payload=payload,
        )
