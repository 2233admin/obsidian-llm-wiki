---
type: issue
entity: project/obsidian-llm-wiki/issue/fleet-agent-discovery-transports
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/fleet-agent-discovery-transports
description: "Fleet agents discover each other only via hardcoded NetBird IPs; need a transport-pluggable discovery layer (NetBird / WireGuard / SSH / orca / ...)"
status: active
priority: 2
blocked-by: []
last-verified: 2026-07-16
---

Fleet agent discovery: transport-pluggable, not NetBird-only

## Context

Today cross-machine agent work (5090 ↔ 5080/XART-80) rides on NetBird mesh
IPs (`100.80.x.x`) hardcoded in memories, scripts and habits
(`ssh -F none -p 22 Administrator@100.80.248.248`). That is one transport
baked in as THE topology. Real fleet already has more paths:

- NetBird mesh (current default)
- Plain WireGuard (no NetBird control plane)
- Raw SSH (public IP / port-forward / jump host)
- orca workspaces (`~/orca/workspaces/...` — agents on the same host
  discovering each other's worktrees, no network at all)
- Degenerate but real: shared git remote (gitea) as the only rendezvous —
  hydroid/universal-studio already syncs 5090↔5080 purely through
  `git.xart.top:8418` with no direct checkout on the peer.

If any one transport dies (NetBird control plane down, cert broken — both
observed), agents lose each other even though other paths are up.

## Direction

- A small **fleet registry**: peers + capabilities + one or more transport
  endpoints each, with a health probe per transport and ordered fallback.
  Reuse the existing shape: 9A Local Project Registry / `.vault-mind/`
  bindings for machine-local facts, `fleet/` Hub (fleet-mode-01) as the
  consumer. No new daemon — probe at scan/CLI time (§0 #8).
- Transport = adapter interface (same pattern as forge.py adapters):
  `reachable()`, `exec()`, `copy()` — NetBird/WireGuard are just IP
  providers under SSH; orca is a filesystem transport; gitea remote is a
  store-and-forward transport.
- Secrets/keys stay in env or ssh config, never in the registry file
  (LINEAR_TOKEN lesson carries over).

## Acceptance

- Registry file schema + at least 2 transports proven live: NetBird-SSH and
  one non-NetBird path (direct SSH or orca-local).
- Kill-one-transport test: primary down → fallback found without editing
  memories/scripts.
- fleet-mode-01 Hub consumes the registry instead of hardcoded IPs.
- Related: `01-Projects/obsidian-llm-wiki/issues/fleet-mode-01.md` (vault),
  `TASK9-DRAFT-workspace-federation.md`, 9B `_workspace-status.md`.

## Related upstream (2026-07-16)

GitHub main just merged PR #50 "feat: ship governed agent rooms and fleet
control plane" (fe4c89a/7433dde, 2026-07-15). Before designing the registry,
read what that control plane already provides — this ticket may narrow to
"add transport adapters + discovery to the shipped control plane" instead of
a new registry.
