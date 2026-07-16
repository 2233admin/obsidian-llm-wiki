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
from .hub import FleetHub, FleetState, SessionState
from .scout import ScoutShip
from .worker import WorkerShip
from .verify import VerifyShip
from .review import ReviewManager, ReviewSession
from .registry import (
    FLEET_REGISTRY_SCHEMA_VERSION,
    FleetRegistry,
    FleetRegistryError,
    PeerProbeReport,
    PeerSpec,
    TransportEndpoint,
)
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

__all__ = [
    # Message types
    "FleetMessage",
    "MessageType",
    "ShipType",
    "ReviewDecision",
    "ReviewStatus",
    "WorkTask",
    "WorkOutput",
    "ScoutReport",
    "VerifyResult",
    "CheckResult",
    "Issue",
    "SignificanceScore",
    "ReviewPoint",
    # Hub types
    "FleetState",
    "SessionState",
    # Ships
    "FleetHub",
    "ScoutShip",
    "WorkerShip",
    "VerifyShip",
    # Review
    "ReviewManager",
    "ReviewSession",
    # Fleet registry + transports
    "FLEET_REGISTRY_SCHEMA_VERSION",
    "FleetRegistry",
    "FleetRegistryError",
    "PeerProbeReport",
    "PeerSpec",
    "TransportEndpoint",
    "Transport",
    "TransportCapabilityError",
    "SshTransport",
    "LocalFsTransport",
    "GiteaTransport",
    "ProbeResult",
    "ExecResult",
    "build_transport",
    "known_transport_kinds",
]

__version__ = "0.1.0"
