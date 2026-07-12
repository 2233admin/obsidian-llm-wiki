# LLMwiki Fleet Mode

Fleet Mode is LLMwiki's local multi-agent workflow layer. It keeps the existing
Scout / Worker / Verify roles, and now exposes an Agent Coordination v0 protocol
surface so those roles can coordinate in a Cotal-shaped shared space without
taking a hard dependency on Cotal or NATS.

For the explicit Cotal comparison, see
[`LLMWIKI_COTAL_COMPATIBILITY.md`](LLMWIKI_COTAL_COMPATIBILITY.md).

## Coordination v0

The protocol surface is intentionally small:

| Primitive | Meaning |
| --- | --- |
| `AgentCard` | Agent identity: `name`, `role`, `tags`, `capabilities`, `subscriptions`, `status`. |
| `CoordinationMessage` | Portable message shape with `space`, `addressing`, `sender`, `target`, `channel`, `parts`, `payload`, and `correlation_id`. |
| `AddressingMode` | `multicast`, `unicast`, or `anycast`. |
| `AgentStatus` | `idle`, `waiting`, `working`, or `offline`. |
| `LocalAgentSpace` | File-backed local shared space under `.vault-mind/spaces/<space>/`. |

The existing `FleetMessage` workflow schema remains supported. Use
`legacy_fleet_message_to_protocol()` when older workflow messages need to be
published into the coordination layer.

## Local Shared Space

The v0 implementation is dependency-free and stores local state in the vault:

```text
.vault-mind/spaces/<space>/
  presence.json
  messages.jsonl
  inbox/<agent>.jsonl
```

Delivery rules:

- `multicast` writes to the shared log and to every online agent subscribed to
  the channel.
- `unicast` writes to exactly one named online agent.
- `anycast` selects one online agent with the requested role, preferring idle
  agents and then stable name ordering.
- All messages are appended to `messages.jsonl` for replay, watch, and recovery.

## CLI

Fleet CLI now exposes Cotal-shaped commands:

```bash
python -m fleet.cli join /path/to/vault --name scout --role scout
python -m fleet.cli presence /path/to/vault
python -m fleet.cli send /path/to/vault --from scout '#general' 'scan complete'
python -m fleet.cli dm /path/to/vault --from scout verify-1 'please verify'
python -m fleet.cli anycast /path/to/vault --from scout worker 'fix this issue'
python -m fleet.cli inbox /path/to/vault worker-1 --json
python -m fleet.cli watch /path/to/vault --json
```

Old workflow commands remain available:

```bash
python -m fleet.cli init /path/to/vault
python -m fleet.cli scout /path/to/vault
python -m fleet.cli worker /path/to/vault --task-type fix --target 01-Projects/x.md
python -m fleet.cli verify /path/to/vault
```

## Design Boundary

LLMwiki is not becoming a generic agent mesh. The source of value remains the
vault, source registry, project memory, and reviewed knowledge workflow. Fleet
Coordination v0 is the local standard surface that lets LLMwiki agents cooperate
cleanly today and leaves room for a future Cotal bridge.
