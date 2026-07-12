"""Local shared space for LLMwiki Agent Coordination v0.

This is intentionally local-first and dependency-free.  It gives Fleet a
Cotal-shaped standard surface without requiring NATS/JetStream in v0.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .protocol import AddressingMode, AgentCard, AgentStatus, CoordinationMessage, MessagePart


def _safe_name(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip())
    if not safe or safe in {".", ".."}:
        raise ValueError(f"invalid shared-space name: {value!r}")
    return safe


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class LocalAgentSpace:
    """File-backed shared space with presence, log, and per-agent inboxes."""

    def __init__(self, vault: str | Path, space: str = "default") -> None:
        self.vault = Path(vault)
        self.space = space
        self.root = self.vault / ".vault-mind" / "spaces" / _safe_name(space)
        self.inbox_dir = self.root / "inbox"
        self.presence_file = self.root / "presence.json"
        self.log_file = self.root / "messages.jsonl"
        self.inbox_dir.mkdir(parents=True, exist_ok=True)
        self.root.mkdir(parents=True, exist_ok=True)

    def join(self, card: AgentCard) -> AgentCard:
        records = self._read_presence_records()
        records[card.name] = {
            **card.to_dict(),
            "last_seen": _utc_now(),
        }
        self._write_presence_records(records)
        self._inbox_path(card.name).touch(exist_ok=True)
        return card

    def leave(self, name: str) -> AgentCard:
        records = self._read_presence_records()
        if name not in records:
            raise KeyError(f"agent not present: {name}")
        records[name]["status"] = AgentStatus.OFFLINE.value
        records[name]["last_seen"] = _utc_now()
        self._write_presence_records(records)
        return AgentCard.from_dict(records[name])

    def set_status(self, name: str, status: AgentStatus | str) -> AgentCard:
        records = self._read_presence_records()
        if name not in records:
            raise KeyError(f"agent not present: {name}")
        records[name]["status"] = AgentStatus(status).value
        records[name]["last_seen"] = _utc_now()
        self._write_presence_records(records)
        return AgentCard.from_dict(records[name])

    def presence(self) -> list[AgentCard]:
        return [AgentCard.from_dict(record) for record in self._read_presence_records().values()]

    def send(
        self,
        *,
        sender: str,
        channel: str,
        text: str,
        payload: dict[str, Any] | None = None,
        correlation_id: str | None = None,
    ) -> CoordinationMessage:
        return self.publish(
            CoordinationMessage(
                space=self.space,
                addressing=AddressingMode.MULTICAST,
                sender=sender,
                channel=channel,
                parts=[MessagePart(text=text)],
                payload=payload or {},
                correlation_id=correlation_id,
            )
        )

    def dm(
        self,
        *,
        sender: str,
        target: str,
        text: str,
        payload: dict[str, Any] | None = None,
        correlation_id: str | None = None,
    ) -> CoordinationMessage:
        return self.publish(
            CoordinationMessage(
                space=self.space,
                addressing=AddressingMode.UNICAST,
                sender=sender,
                target=target,
                parts=[MessagePart(text=text)],
                payload=payload or {},
                correlation_id=correlation_id,
            )
        )

    def anycast(
        self,
        *,
        sender: str,
        role: str,
        text: str,
        payload: dict[str, Any] | None = None,
        correlation_id: str | None = None,
    ) -> CoordinationMessage:
        recipient = self._select_anycast_recipient(role=role, sender=sender)
        next_payload = {"role": role, **(payload or {})}
        return self.publish(
            CoordinationMessage(
                space=self.space,
                addressing=AddressingMode.ANYCAST,
                sender=sender,
                target=recipient.name,
                parts=[MessagePart(text=text)],
                payload=next_payload,
                correlation_id=correlation_id,
            )
        )

    def publish(self, message: CoordinationMessage) -> CoordinationMessage:
        recipients = self._recipients_for(message)
        self._append_jsonl(self.log_file, message.to_dict())
        for recipient in recipients:
            self._append_jsonl(self._inbox_path(recipient), message.to_dict())
        return message

    def inbox(self, name: str, *, limit: int | None = None) -> list[CoordinationMessage]:
        messages = [CoordinationMessage.from_dict(item) for item in self._read_jsonl(self._inbox_path(name))]
        return messages[-limit:] if limit else messages

    def history(self, *, limit: int | None = None) -> list[CoordinationMessage]:
        messages = [CoordinationMessage.from_dict(item) for item in self._read_jsonl(self.log_file)]
        return messages[-limit:] if limit else messages

    def _recipients_for(self, message: CoordinationMessage) -> list[str]:
        cards = [card for card in self.presence() if card.status != AgentStatus.OFFLINE]
        if message.addressing == AddressingMode.MULTICAST:
            assert message.channel is not None
            return [card.name for card in cards if card.subscribes_to(message.channel)]
        assert message.target is not None
        known = {card.name for card in cards}
        if message.target not in known:
            raise ValueError(f"target is not present in space {self.space}: {message.target}")
        return [message.target]

    def _select_anycast_recipient(self, *, role: str, sender: str) -> AgentCard:
        candidates = [
            card
            for card in self.presence()
            if card.role == role and card.name != sender and card.status != AgentStatus.OFFLINE
        ]
        if not candidates:
            raise ValueError(f"no available agent for role: {role}")
        candidates.sort(key=lambda card: (card.status != AgentStatus.IDLE, card.name))
        return candidates[0]

    def _read_presence_records(self) -> dict[str, dict[str, Any]]:
        if not self.presence_file.exists():
            return {}
        return json.loads(self.presence_file.read_text(encoding="utf-8"))

    def _write_presence_records(self, records: dict[str, dict[str, Any]]) -> None:
        tmp = self.presence_file.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.presence_file)

    def _inbox_path(self, name: str) -> Path:
        return self.inbox_dir / f"{_safe_name(name)}.jsonl"

    @staticmethod
    def _append_jsonl(path: Path, item: dict[str, Any]) -> None:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(item, ensure_ascii=False, sort_keys=True))
            handle.write("\n")

    @staticmethod
    def _read_jsonl(path: Path) -> list[dict[str, Any]]:
        if not path.exists():
            return []
        items: list[dict[str, Any]] = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                items.append(json.loads(line))
        return items
