"""
Fleet Message Protocol — llmwiki Multi-Agent Orchestration

Defines the message schema and types for communication between ships.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any


class MessageType(str, Enum):
    """Fleet message types."""
    # Ship outputs
    SCOUT_REPORT = "scout_report"
    WORKER_OUTPUT = "worker_output"
    VERIFY_RESULT = "verify_result"

    # Control
    REVIEW_REQUEST = "review_request"
    REVIEW_RESPONSE = "review_response"
    COMMAND = "command"

    # Hub
    DISPATCH = "dispatch"
    COLLECT = "collect"
    SYNC = "sync"
    STATUS = "status"


class ShipType(str, Enum):
    """Ship types in the fleet."""
    SCOUT = "scout"
    WORKER = "worker"
    VERIFY = "verify"
    COMMANDER = "commander"
    HUB = "hub"


class ReviewDecision(str, Enum):
    """Review point decisions."""
    APPROVE = "approve"
    REJECT = "reject"
    MODIFY = "modify"
    SKIP = "skip"


class ReviewStatus(str, Enum):
    """Review status."""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    MODIFIED = "modified"
    SKIPPED = "skipped"


@dataclass
class FleetMessage:
    """Base fleet message."""
    type: MessageType
    from_ship: ShipType
    to_ship: ShipType | None = None  # None = broadcast
    session_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    payload: dict[str, Any] = field(default_factory=dict)
    correlation_id: str | None = None  # For linking request/response

    def to_dict(self) -> dict:
        return {
            "type": self.type.value,
            "from": self.from_ship.value,
            "to": self.to_ship.value if self.to_ship else None,
            "session_id": self.session_id,
            "timestamp": self.timestamp.isoformat(),
            "payload": self.payload,
            "correlation_id": self.correlation_id,
        }

    @classmethod
    def from_dict(cls, data: dict) -> FleetMessage:
        return cls(
            type=MessageType(data["type"]),
            from_ship=ShipType(data["from"]),
            to_ship=ShipType(data["to"]) if data.get("to") else None,
            session_id=data.get("session_id", str(uuid.uuid4())[:8]),
            timestamp=datetime.fromisoformat(data["timestamp"]) if "timestamp" in data else datetime.now(timezone.utc),
            payload=data.get("payload", {}),
            correlation_id=data.get("correlation_id"),
        )


@dataclass
class ScoutReport:
    """Scout ship output."""
    session_id: str
    vault: str
    issues: list[Issue] = field(default_factory=list)
    significance_scores: list[SignificanceScore] = field(default_factory=list)
    summary: str = ""
    stats: dict[str, int] = field(default_factory=dict)

    def to_payload(self) -> dict:
        return {
            "session_id": self.session_id,
            "vault": self.vault,
            "issues": [i.to_dict() for i in self.issues],
            "significance_scores": [s.to_dict() for s in self.significance_scores],
            "summary": self.summary,
            "stats": self.stats,
        }


@dataclass
class WorkOutput:
    """Worker ship output."""
    session_id: str
    task_id: str
    task_type: str
    success: bool
    files_created: list[str] = field(default_factory=list)
    files_modified: list[str] = field(default_factory=list)
    files_deleted: list[str] = field(default_factory=list)
    output_path: str = ""
    summary: str = ""
    errors: list[str] = field(default_factory=list)
    token_cost: int = 0

    def to_payload(self) -> dict:
        return {
            "session_id": self.session_id,
            "task_id": self.task_id,
            "task_type": self.task_type,
            "success": self.success,
            "files_created": self.files_created,
            "files_modified": self.files_modified,
            "files_deleted": self.files_deleted,
            "output_path": self.output_path,
            "summary": self.summary,
            "errors": self.errors,
            "token_cost": self.token_cost,
        }


@dataclass
class VerifyResult:
    """Verify ship output."""
    session_id: str
    vault: str
    status: str  # "pass", "fail", "warning"
    checks: list[CheckResult] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)
    broken_links: list[dict] = field(default_factory=list)
    contradictions: list[dict] = field(default_factory=list)
    summary: str = ""

    def to_payload(self) -> dict:
        return {
            "session_id": self.session_id,
            "vault": self.vault,
            "status": self.status,
            "checks": [c.to_dict() for c in self.checks],
            "issues": [i.to_dict() for i in self.issues],
            "broken_links": self.broken_links,
            "contradictions": self.contradictions,
            "summary": self.summary,
        }

    def __contains__(self, key: object) -> bool:
        return key in self.to_payload()

    def __getitem__(self, key: str) -> Any:
        return self.to_payload()[key]


@dataclass
class Issue:
    """Generic issue representation."""
    id: str
    severity: str  # "critical", "high", "medium", "low"
    type: str  # "broken_link", "orphan", "stale", "contradiction", etc.
    location: str  # file path or area
    description: str
    suggestion: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "severity": self.severity,
            "type": self.type,
            "location": self.location,
            "description": self.description,
            "suggestion": self.suggestion,
        }


@dataclass
class SignificanceScore:
    """Significance assessment for a work item."""
    item: str
    entity: str
    severity: str  # "critical", "high", "medium", "low"
    impact: str
    effort: str  # "high", "medium", "low"
    reasoning: str = ""

    def to_dict(self) -> dict:
        return {
            "item": self.item,
            "entity": self.entity,
            "severity": self.severity,
            "impact": self.impact,
            "effort": self.effort,
            "reasoning": self.reasoning,
        }


@dataclass
class CheckResult:
    """Result of a single check."""
    check_type: str
    status: str  # "pass", "fail", "warning"
    message: str = ""
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "check_type": self.check_type,
            "status": self.status,
            "message": self.message,
            "details": self.details,
        }


@dataclass
class ReviewPoint:
    """Review point for human intervention."""
    id: str
    name: str
    after_ship: ShipType
    status: ReviewStatus = ReviewStatus.PENDING
    decision: ReviewDecision | None = None
    review_notes: str = ""
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    decided_at: datetime | None = None
    decided_by: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "after_ship": self.after_ship.value,
            "status": self.status.value,
            "decision": self.decision.value if self.decision else None,
            "review_notes": self.review_notes,
            "created_at": self.created_at.isoformat(),
            "decided_at": self.decided_at.isoformat() if self.decided_at else None,
            "decided_by": self.decided_by,
        }


@dataclass
class WorkTask:
    """Work task specification."""
    id: str
    entity: str  # Work item entity reference
    type: str  # "compile", "fix", "create", "review"
    input: dict[str, Any] = field(default_factory=dict)
    output: dict[str, Any] = field(default_factory=dict)
    constraints: list[str] = field(default_factory=list)
    priority: int = 2  # 1=highest, 4=lowest
    blocked_by: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "entity": self.entity,
            "type": self.type,
            "input": self.input,
            "output": self.output,
            "constraints": self.constraints,
            "priority": self.priority,
            "blocked_by": self.blocked_by,
        }
