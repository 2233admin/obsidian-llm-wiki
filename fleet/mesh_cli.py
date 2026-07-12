"""CLI commands for LLMwiki Agent Coordination v0."""

from __future__ import annotations

import argparse
import json
from typing import Any

from .protocol import AgentCard, AgentStatus, CoordinationMessage
from .space import LocalAgentSpace


def register_space_commands(subparsers: argparse._SubParsersAction) -> None:
    join = subparsers.add_parser("join", help="Join a local agent coordination space")
    _add_space_args(join)
    join.add_argument("--name", required=True, help="Agent instance name")
    join.add_argument("--role", required=True, help="Addressable role/service name")
    join.add_argument("--tag", action="append", default=[], help="Agent tag; repeatable")
    join.add_argument("--capability", action="append", default=[], help="Agent capability; repeatable")
    join.add_argument("--subscribe", action="append", default=["#general"], help="Channel subscription; repeatable")
    join.add_argument("--status", choices=[s.value for s in AgentStatus], default=AgentStatus.IDLE.value)
    join.add_argument("--json", action="store_true", help="Output JSON")
    join.set_defaults(space_command=cmd_join)

    presence = subparsers.add_parser("presence", help="Show live agent presence")
    _add_space_args(presence)
    presence.add_argument("--json", action="store_true", help="Output JSON")
    presence.set_defaults(space_command=cmd_presence)

    send = subparsers.add_parser("send", help="Multicast a message to a channel")
    _add_space_args(send)
    send.add_argument("--from", dest="sender", required=True, help="Sender agent name")
    send.add_argument("channel", help="Channel name, for example #general")
    send.add_argument("text", nargs="+", help="Message text")
    send.add_argument("--json", action="store_true", help="Output JSON")
    send.set_defaults(space_command=cmd_send)

    dm = subparsers.add_parser("dm", help="Unicast a direct message to one agent")
    _add_space_args(dm)
    dm.add_argument("--from", dest="sender", required=True, help="Sender agent name")
    dm.add_argument("target", help="Target agent name")
    dm.add_argument("text", nargs="+", help="Message text")
    dm.add_argument("--json", action="store_true", help="Output JSON")
    dm.set_defaults(space_command=cmd_dm)

    anycast = subparsers.add_parser("anycast", help="Send work to any one agent with a role")
    _add_space_args(anycast)
    anycast.add_argument("--from", dest="sender", required=True, help="Sender agent name")
    anycast.add_argument("role", help="Target role/service")
    anycast.add_argument("text", nargs="+", help="Message text")
    anycast.add_argument("--json", action="store_true", help="Output JSON")
    anycast.set_defaults(space_command=cmd_anycast)

    inbox = subparsers.add_parser("inbox", help="Read an agent inbox")
    _add_space_args(inbox)
    inbox.add_argument("name", help="Agent name")
    inbox.add_argument("--limit", type=int, help="Only show the last N messages")
    inbox.add_argument("--json", action="store_true", help="Output JSON")
    inbox.set_defaults(space_command=cmd_inbox)

    watch = subparsers.add_parser("watch", help="Show the shared message log")
    _add_space_args(watch)
    watch.add_argument("--limit", type=int, default=20, help="Only show the last N messages")
    watch.add_argument("--json", action="store_true", help="Output JSON")
    watch.set_defaults(space_command=cmd_watch)


def cmd_join(args: argparse.Namespace) -> int:
    space = _space(args)
    card = AgentCard(
        name=args.name,
        role=args.role,
        tags=args.tag,
        capabilities=args.capability,
        subscriptions=args.subscribe,
        status=AgentStatus(args.status),
    )
    space.join(card)
    _print(args, card.to_dict(), f"{card.name} joined {args.space} as {card.role}")
    return 0


def cmd_presence(args: argparse.Namespace) -> int:
    cards = [card.to_dict() for card in _space(args).presence()]
    _print(args, cards, _format_presence(cards))
    return 0


def cmd_send(args: argparse.Namespace) -> int:
    message = _space(args).send(sender=args.sender, channel=args.channel, text=" ".join(args.text))
    _print(args, message.to_dict(), _format_message(message))
    return 0


def cmd_dm(args: argparse.Namespace) -> int:
    message = _space(args).dm(sender=args.sender, target=args.target, text=" ".join(args.text))
    _print(args, message.to_dict(), _format_message(message))
    return 0


def cmd_anycast(args: argparse.Namespace) -> int:
    message = _space(args).anycast(sender=args.sender, role=args.role, text=" ".join(args.text))
    _print(args, message.to_dict(), _format_message(message))
    return 0


def cmd_inbox(args: argparse.Namespace) -> int:
    messages = _space(args).inbox(args.name, limit=args.limit)
    data = [message.to_dict() for message in messages]
    _print(args, data, "\n".join(_format_message(message) for message in messages))
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    messages = _space(args).history(limit=args.limit)
    data = [message.to_dict() for message in messages]
    _print(args, data, "\n".join(_format_message(message) for message in messages))
    return 0


def _add_space_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("vault", help="Vault path")
    parser.add_argument("--space", default="default", help="Coordination space name")


def _space(args: argparse.Namespace) -> LocalAgentSpace:
    return LocalAgentSpace(args.vault, space=args.space)


def _print(args: argparse.Namespace, data: Any, text: str) -> None:
    if getattr(args, "json", False):
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        print(text)


def _format_presence(cards: list[dict[str, Any]]) -> str:
    if not cards:
        return "No agents present."
    return "\n".join(
        f"{card['name']} role={card['role']} status={card['status']} subscriptions={','.join(card['subscriptions'])}"
        for card in cards
    )


def _format_message(message: CoordinationMessage) -> str:
    destination = message.channel if message.addressing.value == "multicast" else message.target
    return f"{message.addressing.value} {message.sender} -> {destination}: {message.text}"
