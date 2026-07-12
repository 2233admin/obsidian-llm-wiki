"""Tests for LLMwiki Agent Coordination v0."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from fleet.message import FleetMessage, MessageType, ShipType
from fleet.protocol import (
    AddressingMode,
    AgentCard,
    AgentStatus,
    CoordinationMessage,
    MessagePart,
    legacy_fleet_message_to_protocol,
)
from fleet.space import LocalAgentSpace


ROOT = Path(__file__).resolve().parents[2]


def test_agent_card_round_trip() -> None:
    card = AgentCard(
        name="worker-1",
        role="worker",
        tags=["python", "python"],
        capabilities=["fix", "verify"],
        subscriptions=["#general", "#review"],
        status=AgentStatus.WORKING,
    )

    restored = AgentCard.from_dict(card.to_dict())

    assert restored == AgentCard(
        name="worker-1",
        role="worker",
        tags=["python"],
        capabilities=["fix", "verify"],
        subscriptions=["#general", "#review"],
        status=AgentStatus.WORKING,
    )


def test_coordination_message_round_trip() -> None:
    message = CoordinationMessage(
        space="demo",
        addressing=AddressingMode.MULTICAST,
        sender="scout",
        channel="#general",
        parts=[MessagePart(text="found drift")],
        payload={"severity": "medium"},
        correlation_id="corr-1",
    )

    restored = CoordinationMessage.from_dict(message.to_dict())

    assert restored.space == "demo"
    assert restored.addressing == AddressingMode.MULTICAST
    assert restored.sender == "scout"
    assert restored.channel == "#general"
    assert restored.text == "found drift"
    assert restored.payload == {"severity": "medium"}
    assert restored.correlation_id == "corr-1"


def test_legacy_fleet_message_can_be_wrapped_in_protocol() -> None:
    legacy = FleetMessage(
        type=MessageType.DISPATCH,
        from_ship=ShipType.HUB,
        to_ship=ShipType.WORKER,
        payload={"task": "fix docs"},
        correlation_id="task-1",
    )

    message = legacy_fleet_message_to_protocol(legacy, space="fleet")

    assert message.space == "fleet"
    assert message.addressing == AddressingMode.UNICAST
    assert message.sender == "hub"
    assert message.target == "worker"
    assert message.payload["payload"] == {"task": "fix docs"}
    assert message.correlation_id == "task-1"


def test_local_space_routes_multicast_dm_anycast_and_persists(temp_vault: str) -> None:
    space = LocalAgentSpace(temp_vault, space="demo")
    space.join(AgentCard(name="scout", role="scout", subscriptions=["#general"]))
    space.join(AgentCard(name="worker-1", role="worker", subscriptions=["#general"]))
    space.join(AgentCard(name="verify-1", role="verify", subscriptions=["#review"]))

    multicast = space.send(sender="scout", channel="#general", text="scan complete")
    direct = space.dm(sender="scout", target="verify-1", text="please verify")
    delegated = space.anycast(sender="scout", role="worker", text="fix the issue")

    assert multicast.addressing == AddressingMode.MULTICAST
    assert direct.addressing == AddressingMode.UNICAST
    assert delegated.addressing == AddressingMode.ANYCAST
    assert delegated.target == "worker-1"

    worker_inbox = space.inbox("worker-1")
    verify_inbox = space.inbox("verify-1")
    assert [message.text for message in worker_inbox] == ["scan complete", "fix the issue"]
    assert [message.text for message in verify_inbox] == ["please verify"]

    restored = LocalAgentSpace(temp_vault, space="demo")
    assert [card.name for card in restored.presence()] == ["scout", "worker-1", "verify-1"]
    assert [message.text for message in restored.history()] == [
        "scan complete",
        "please verify",
        "fix the issue",
    ]


def test_fleet_cli_coordination_smoke(temp_vault: str) -> None:
    def run(*args: str) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [sys.executable, "-m", "fleet.cli", *args],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        return result

    run("join", temp_vault, "--space", "cli", "--name", "scout", "--role", "scout")
    run("join", temp_vault, "--space", "cli", "--name", "worker-1", "--role", "worker")
    run("join", temp_vault, "--space", "cli", "--name", "verify-1", "--role", "verify")
    run("send", temp_vault, "--space", "cli", "--from", "scout", "#general", "hello", "team")
    run("dm", temp_vault, "--space", "cli", "--from", "scout", "verify-1", "check", "this")
    run("anycast", temp_vault, "--space", "cli", "--from", "scout", "worker", "take", "task")

    worker_inbox = run("inbox", temp_vault, "--space", "cli", "worker-1", "--json")
    worker_messages = json.loads(worker_inbox.stdout)
    assert [message["addressing"] for message in worker_messages] == ["multicast", "anycast"]

    history = run("watch", temp_vault, "--space", "cli", "--json")
    history_messages = json.loads(history.stdout)
    assert [message["addressing"] for message in history_messages] == [
        "multicast",
        "unicast",
        "anycast",
    ]
