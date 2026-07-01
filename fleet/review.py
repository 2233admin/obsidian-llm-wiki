"""
Review Point Management — Human intervention coordination.

Handles review point lifecycle:
- Request review
- Await decision
- Process decision
- Unblock execution
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .message import ReviewDecision, ReviewPoint, ReviewStatus, ShipType


@dataclass
class ReviewSession:
    """A review session awaiting human decision."""
    review_point: ReviewPoint
    data: dict[str, Any]  # Data to review
    blocking: bool = True  # Whether to block execution
    timeout_seconds: int | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class ReviewManager:
    """
    Manages review points for human intervention.

    Usage:
        manager = ReviewManager(vault="/path/to/vault")

        # Request review after Scout
        session = manager.request(
            after_ship=ShipType.SCOUT,
            name="Scout Report Review",
            data=scout_report
        )

        # Check if decision is ready
        decision = manager.get_decision(session.review_point.id)

        # Process decision
        manager.process_decision(
            review_id=session.review_point.id,
            decision=ReviewDecision.APPROVE,
            notes="Looks good, proceed."
        )
    """

    def __init__(self, vault: str, state_dir: str | None = None):
        self.vault = Path(vault)
        self.state_dir = Path(state_dir) if state_dir else self.vault / ".vault-mind" / "fleet"
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.sessions: dict[str, ReviewSession] = {}

    def request(
        self,
        after_ship: ShipType,
        name: str,
        data: dict[str, Any],
        blocking: bool = True,
        timeout_seconds: int | None = None,
    ) -> ReviewSession:
        """
        Request a review.

        Args:
            after_ship: Which ship should complete before review
            name: Human-readable name for the review
            data: Data to review
            blocking: Whether to block execution until decided
            timeout_seconds: Optional timeout

        Returns:
            ReviewSession that can be used to check status
        """
        review_id = f"review_{after_ship.value}_{uuid.uuid4().hex[:8]}"

        review_point = ReviewPoint(
            id=review_id,
            name=name,
            after_ship=after_ship,
            status=ReviewStatus.PENDING,
        )

        session = ReviewSession(
            review_point=review_point,
            data=data,
            blocking=blocking,
            timeout_seconds=timeout_seconds,
        )

        self.sessions[review_id] = session
        self._save_pending()

        return session

    def is_blocked(self, review_id: str) -> bool:
        """Check if execution is blocked by a review."""
        session = self.sessions.get(review_id)
        if not session:
            return False
        return session.blocking and session.review_point.status == ReviewStatus.PENDING

    def is_decided(self, review_id: str) -> bool:
        """Check if a decision has been made."""
        session = self.sessions.get(review_id)
        if not session:
            return False
        return session.review_point.status != ReviewStatus.PENDING

    def get_decision(self, review_id: str) -> ReviewDecision | None:
        """Get the decision if made."""
        session = self.sessions.get(review_id)
        if not session or session.review_point.status == ReviewStatus.PENDING:
            return None
        return session.review_point.decision

    def process_decision(
        self,
        review_id: str,
        decision: ReviewDecision,
        notes: str = "",
        decided_by: str = "human",
    ) -> dict[str, Any]:
        """
        Process a review decision.

        Args:
            review_id: ID of the review
            decision: The decision (approve/reject/modify/skip)
            notes: Optional notes
            decided_by: Who made the decision

        Returns:
            dict with result
        """
        session = self.sessions.get(review_id)
        if not session:
            return {"error": f"Review {review_id} not found"}

        # Update review point
        status_map = {
            ReviewDecision.APPROVE: ReviewStatus.APPROVED,
            ReviewDecision.REJECT: ReviewStatus.REJECTED,
            ReviewDecision.MODIFY: ReviewStatus.MODIFIED,
            ReviewDecision.SKIP: ReviewStatus.SKIPPED,
        }

        session.review_point.status = status_map.get(decision, ReviewStatus.PENDING)
        session.review_point.decision = decision
        session.review_point.review_notes = notes
        session.review_point.decided_at = datetime.now(timezone.utc)
        session.review_point.decided_by = decided_by

        self._save_pending()

        return {
            "review_id": review_id,
            "decision": decision.value,
            "status": session.review_point.status.value,
            "can_proceed": decision in (ReviewDecision.APPROVE, ReviewDecision.SKIP),
        }

    def get_pending(self) -> list[dict[str, Any]]:
        """Get all pending reviews."""
        return [
            {
                "id": review_id,
                "name": session.review_point.name,
                "after_ship": session.review_point.after_ship.value,
                "status": session.review_point.status.value,
                "blocking": session.blocking,
                "created_at": session.created_at.isoformat(),
                "data_summary": self._summarize_data(session.data),
            }
            for review_id, session in self.sessions.items()
            if session.review_point.status == ReviewStatus.PENDING
        ]

    def get_review_data(self, review_id: str) -> dict[str, Any] | None:
        """Get the data associated with a review."""
        session = self.sessions.get(review_id)
        if not session:
            return None
        return session.data

    def _summarize_data(self, data: dict[str, Any]) -> str:
        """Create a brief summary of review data."""
        if "issues" in data:
            return f"{len(data.get('issues', []))} issues found"
        if "summary" in data:
            return data["summary"][:100]
        if "status" in data:
            return f"Status: {data['status']}"
        return str(data)[:100]

    def _save_pending(self) -> None:
        """Save pending reviews to disk."""
        pending_file = self.state_dir / "pending_reviews.json"
        pending = {
            review_id: {
                "review_point": session.review_point.to_dict(),
                "data_summary": self._summarize_data(session.data),
                "blocking": session.blocking,
                "created_at": session.created_at.isoformat(),
            }
            for review_id, session in self.sessions.items()
            if session.review_point.status == ReviewStatus.PENDING
        }
        pending_file.write_text(json.dumps(pending, indent=2, ensure_ascii=False))

    def format_review_prompt(self, review_id: str) -> str:
        """
        Format a review as a prompt for human decision.

        Usage:
            prompt = manager.format_review_prompt("review_scout_abc123")
            # Show prompt to human, collect decision
        """
        session = self.sessions.get(review_id)
        if not session:
            return f"Review {review_id} not found"

        rp = session.review_point
        data = session.data

        lines = [
            f"# Review Point: {rp.name}",
            f"",
            f"**ID**: {rp.id}",
            f"**After**: {rp.after_ship.value}",
            f"**Created**: {rp.created_at.strftime('%Y-%m-%d %H:%M:%S')}",
            f"",
            f"---",
            f"",
        ]

        # Format data based on type
        if rp.after_ship == ShipType.SCOUT:
            lines.extend([
                f"## Scout Report Summary",
                f"",
                f"**Stats**:",
            ])
            if "stats" in data:
                for key, value in data.get("stats", {}).items():
                    lines.append(f"- {key}: {value}")
            lines.append(f"")

            if "issues" in data and data["issues"]:
                lines.append(f"## Issues ({len(data['issues'])})")
                for issue in data["issues"][:10]:  # Show top 10
                    lines.append(f"- [{issue.get('severity', '?').upper()}] {issue.get('location', '?')}")
                    lines.append(f"  {issue.get('description', '')}")
                if len(data["issues"]) > 10:
                    lines.append(f"- ... and {len(data['issues']) - 10} more")
                lines.append("")

        elif rp.after_ship == ShipType.WORKER:
            lines.extend([
                f"## Worker Output",
                f"",
                f"**Success**: {'Yes' if data.get('success') else 'No'}",
                f"**Files Created**: {len(data.get('files_created', []))}",
                f"**Files Modified**: {len(data.get('files_modified', []))}",
                f"",
            ])
            if data.get("errors"):
                lines.append(f"## Errors")
                for error in data["errors"]:
                    lines.append(f"- {error}")
                lines.append("")

        elif rp.after_ship == ShipType.VERIFY:
            lines.extend([
                f"## Verification Result",
                f"",
                f"**Status**: {data.get('status', 'unknown').upper()}",
                f"",
            ])
            if "checks" in data:
                lines.append(f"## Checks")
                for check in data.get("checks", []):
                    icon = {"pass": "✓", "fail": "✗", "warning": "⚠"}.get(check.get("status", "?"), "?")
                    lines.append(f"- {icon} {check.get('check_type', '?')}: {check.get('message', '')}")
                lines.append("")

        lines.extend([
            f"---",
            f"",
            f"## Decision",
            f"",
            f"Please review the above and decide:",
            f"",
            f"| Decision | Action |",
            f"|----------|--------|",
            f"| **APPROVE** | Continue to next step |",
            f"| **REJECT** | Stop and fix issues |",
            f"| **MODIFY** | Continue with modifications |",
            f"| **SKIP** | Skip this review point |",
            f"",
            f"Reply with your decision and optional notes.",
        ])

        return "\n".join(lines)


# CLI helpers
def main():
    """CLI helpers for review management."""
    import argparse

    parser = argparse.ArgumentParser(description="Review point management")
    subparsers = parser.add_subparsers(dest="command")

    # List pending
    list_parser = subparsers.add_parser("list", help="List pending reviews")
    list_parser.add_argument("vault", help="Vault path")

    # Get review data
    get_parser = subparsers.add_parser("get", help="Get review data")
    get_parser.add_argument("vault", help="Vault path")
    get_parser.add_argument("review_id", help="Review ID")

    args = parser.parse_args()

    if args.command == "list":
        manager = ReviewManager(vault=args.vault)
        pending = manager.get_pending()
        if not pending:
            print("No pending reviews")
        else:
            for review in pending:
                print(f"\n## {review['name']}")
                print(f"ID: {review['id']}")
                print(f"After: {review['after_ship']}")
                print(f"Blocking: {review['blocking']}")
                print(f"Summary: {review['data_summary']}")

    elif args.command == "get":
        manager = ReviewManager(vault=args.vault)
        data = manager.get_review_data(args.review_id)
        if data is None:
            print(f"Review {args.review_id} not found")
        else:
            print(json.dumps(data, indent=2, ensure_ascii=False, default=str))

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
