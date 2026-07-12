# LLMwiki / Cotal Compatibility Matrix

This matrix tracks how LLMwiki Fleet Mode aligns with Cotal's shared-space
coordination model while keeping LLMwiki's vault-first architecture.

| Cotal concept | LLMwiki status | Notes |
| --- | --- | --- |
| Shared space | Supported locally | `LocalAgentSpace` stores state under `.vault-mind/spaces/<space>/`. |
| AgentCard identity | Supported | `AgentCard` covers name, role, tags, capabilities, subscriptions, and status. |
| Presence | Supported locally | `presence.json` records `idle`, `waiting`, `working`, and `offline`. |
| Multicast | Supported locally | `send` routes to subscribed online agents and appends history. |
| Unicast | Supported locally | `dm` routes to one named online agent. |
| Anycast | Supported locally | `anycast` chooses one online agent for a role. |
| Durable inbox | Supported locally | Per-agent JSONL inboxes retain messages across processes. |
| Message/Part shape | Supported in v0 | `CoordinationMessage.parts` uses A2A-style text/data parts. |
| Control plane | Partial | Existing Fleet Hub handles dispatch, collect, review, and status. |
| Console/watch | Partial | `fleet watch` tails recorded history; no live TUI yet. |
| NATS/JetStream transport | Not adopted | v0 is dependency-free; Cotal bridge can map this protocol to NATS later. |
| Cotal connector tools | Not adopted | Future bridge should be optional and not part of LLMwiki core. |
| Auth/ACL | Deferred | Local v0 assumes trusted local vault access. |

## Recommended Next Step

Build the optional bridge as an adapter over `AgentCard`, `CoordinationMessage`,
and `LocalAgentSpace` rather than changing Scout / Worker / Verify directly.
That keeps the Fleet workflow stable while allowing a Cotal mesh to become one
possible transport.
