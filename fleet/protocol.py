"""LLMwiki Agent Coordination v0 protocol types.

The Fleet workflow layer still owns Scout/Worker/Verify orchestration.  This
module defines the thinner coordination contract under it: agent identity,
presence, addressing, and portable message shape.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any
import uuid


class AgentStatus(str, Enum):
    """Live state advertised by an agent in a shared space."""

    IDLE = "idle"
    WAITING = "waiting"
    WORKING = "working"
    OFFLINE = "offline"


class AddressingMode(str, Enum):
    """Message delivery modes inspired by Cotal/SLIM."""

    MULTICAST = "multicast"
    UNICAST = "unicast"
    ANYCAST = "anycast"


@dataclass(frozen=True)
class MessagePart:
    """A small A2A-style message part."""

    type: str = "text"
    text: str | None = None
    data: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        item: dict[str, Any] = {"type": self.type}
        if self.text is not None:
            item["text"] = self.text
        if self.data is not None:
            item["data"] = self.data
        return item

    @classmethod
    def from_dict(cls, data: dict[str, Any] | str) -> "MessagePart":
        if isinstance(data, str):
            return cls(text=data)
        return cls(
            type=str(data.get("type", "text")),
            text=data.get("text"),
            data=data.get("data"),
        )


@dataclass
class AgentCard:
    """Identity and routing surface for one LLMwiki agent node."""

    name: str
    role: str
    tags: list[str] = field(default_factory=list)
    capabilities: list[str] = field(default_factory=list)
    subscriptions: list[str] = field(default_factory=lambda: ["#general"])
    status: AgentStatus = AgentStatus.IDLE

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("AgentCard.name is required")
        if not self.role:
            raise ValueError("AgentCard.role is required")
        self.status = AgentStatus(self.status)
        self.tags = list(dict.fromkeys(self.tags))
        self.capabilities = list(dict.fromkeys(self.capabilities))
        self.subscriptions = list(dict.fromkeys(self.subscriptions))

    def subscribes_to(self, channel: str) -> bool:
        return "*" in self.subscriptions or channel in self.subscriptions

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "role": self.role,
            "tags": self.tags,
            "capabilities": self.capabilities,
            "subscriptions": self.subscriptions,
            "status": self.status.value,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AgentCard":
        return cls(
            name=str(data["name"]),
            role=str(data["role"]),
            tags=list(data.get("tags", [])),
            capabilities=list(data.get("capabilities", [])),
            subscriptions=list(data.get("subscriptions", ["#general"])),
            status=AgentStatus(data.get("status", AgentStatus.IDLE.value)),
        )


@dataclass
class CoordinationMessage:
    """Portable message shape for the LLMwiki shared agent space."""

    space: str
    addressing: AddressingMode
    sender: str
    parts: list[MessagePart] = field(default_factory=list)
    channel: str | None = None
    target: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    correlation_id: str | None = None
    message_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __post_init__(self) -> None:
        if not self.space:
            raise ValueError("CoordinationMessage.space is required")
        if not self.sender:
            raise ValueError("CoordinationMessage.sender is required")
        self.addressing = AddressingMode(self.addressing)
        self.parts = [part if isinstance(part, MessagePart) else MessagePart.from_dict(part) for part in self.parts]
        if self.addressing == AddressingMode.MULTICAST and not self.channel:
            raise ValueError("multicast messages require channel")
        if self.addressing in (AddressingMode.UNICAST, AddressingMode.ANYCAST) and not self.target:
            raise ValueError(f"{self.addressing.value} messages require target")

    @property
    def text(self) -> str:
        return "\n".join(part.text for part in self.parts if part.text)

    def to_dict(self) -> dict[str, Any]:
        return {
            "message_id": self.message_id,
            "space": self.space,
            "addressing": self.addressing.value,
            "sender": self.sender,
            "target": self.target,
            "channel": self.channel,
            "parts": [part.to_dict() for part in self.parts],
            "payload": self.payload,
            "correlation_id": self.correlation_id,
            "timestamp": self.timestamp.isoformat(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CoordinationMessage":
        timestamp = data.get("timestamp")
        return cls(
            message_id=str(data.get("message_id") or data.get("id") or uuid.uuid4()),
            space=str(data["space"]),
            addressing=AddressingMode(data["addressing"]),
            sender=str(data["sender"]),
            target=data.get("target"),
            channel=data.get("channel"),
            parts=[MessagePart.from_dict(part) for part in data.get("parts", [])],
            payload=dict(data.get("payload", {})),
            correlation_id=data.get("correlation_id"),
            timestamp=datetime.fromisoformat(timestamp) if timestamp else datetime.now(timezone.utc),
        )


FleetProtocolMessage = CoordinationMessage


def legacy_fleet_message_to_protocol(message: Any, *, space: str = "default") -> CoordinationMessage:
    """Wrap the older workflow FleetMessage shape in the coordination protocol."""

    data = message.to_dict() if hasattr(message, "to_dict") else dict(message)
    sender = data.get("from") or data.get("sender") or "hub"
    target = data.get("to") or data.get("target")
    addressing = AddressingMode.UNICAST if target else AddressingMode.MULTICAST
    return CoordinationMessage(
        space=space,
        addressing=addressing,
        sender=str(sender),
        target=str(target) if target else None,
        channel="#fleet" if not target else None,
        parts=[MessagePart(text=str(data.get("type", "message")))],
        payload=data,
        correlation_id=data.get("correlation_id"),
    )
