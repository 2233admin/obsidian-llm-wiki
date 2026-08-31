"""
llmwiki Fleet Mode — Multi-Agent Orchestration

A production-ready fleet system for llmwiki that solves:
1. Agent 自嗨 — Ship responsibilities + boundaries
2. 上下文爆炸 — Context trimming + briefing
3. 质量失控 — Review points + automated checks

Usage:
    from fleet import FleetHub, ScoutShip, WorkerShip, VerifyShip

    # Initialize
    hub = FleetHub(vault="/path/to/vault")
    hub.init()

    # Dispatch to Scout
    briefing = hub.dispatch(task, to=ShipType.SCOUT)
    # ... run scout in separate session ...

    # Collect and review
    result = hub.collect(session_id, scout_result)
    review = hub.request_review(after_ship=ShipType.SCOUT, name="Scout Review", data=result)

    # Decide
    hub.decide_review(review.id, ReviewDecision.APPROVE)
"""

from .hub import FleetHub, FleetState, SessionState
from .message import (
    CheckResult,
    FleetMessage,
    Issue,
    MessageType,
    ReviewDecision,
    ReviewPoint,
    ReviewStatus,
    ScoutReport,
    ShipType,
    SignificanceScore,
    VerifyResult,
    WorkOutput,
    WorkTask,
)
from .registry import (
    FLEET_REGISTRY_SCHEMA_VERSION,
    FleetRegistry,
    FleetRegistryError,
    PeerProbeReport,
    PeerSpec,
    TransportEndpoint,
)
from .review import ReviewManager, ReviewSession
from .scout import ScoutShip
from .transports import (
    ExecResult,
    GiteaTransport,
    LocalFsTransport,
    ProbeResult,
    SshTransport,
    Transport,
    TransportCapabilityError,
    build_transport,
    known_transport_kinds,
)
from .verify import VerifyShip
from .worker import WorkerShip

__all__ = [
    # Fleet registry + transports
    "FLEET_REGISTRY_SCHEMA_VERSION",
    "CheckResult",
    "ExecResult",
    # Ships
    "FleetHub",
    # Message types
    "FleetMessage",
    "FleetRegistry",
    "FleetRegistryError",
    # Hub types
    "FleetState",
    "GiteaTransport",
    "Issue",
    "LocalFsTransport",
    "MessageType",
    "PeerProbeReport",
    "PeerSpec",
    "ProbeResult",
    "ReviewDecision",
    # Review
    "ReviewManager",
    "ReviewPoint",
    "ReviewSession",
    "ReviewStatus",
    "ScoutReport",
    "ScoutShip",
    "SessionState",
    "ShipType",
    "SignificanceScore",
    "SshTransport",
    "Transport",
    "TransportCapabilityError",
    "TransportEndpoint",
    "VerifyResult",
    "VerifyShip",
    "WorkOutput",
    "WorkTask",
    "WorkerShip",
    "build_transport",
    "known_transport_kinds",
]

__version__ = "0.1.0"
