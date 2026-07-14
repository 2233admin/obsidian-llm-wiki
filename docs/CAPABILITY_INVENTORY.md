# LLM Wiki capability inventory

This inventory names the owner and authority boundary of the current release candidate. A capability may be callable without Obsidian; the Obsidian plugin is the primary human control plane, not the backend.

| Capability | Owning domain | Primary operations or entrypoint | Single device | Multiple devices |
|---|---|---|---|---|
| Shared system settings | Settings Platform | `settings.*`, Python settings CLI, Obsidian settings page | Deterministic scoped snapshot | Shared vault/project assignments plus independent user-device bindings |
| Secret configuration | Settings Platform + host resolver | Secret Reference, `settings.doctor` | Redacted presence health | Each device resolves its own reference; no secret sync through vault/Git |
| Agent model connection | Settings Platform + Agent/Compiler host bridge | `models.agent.*`, Obsidian Agent model section | `inherit`, `local`, or `cloud` | Local mode strips cloud credentials; cloud mode resolves a device-local Secret Reference only for the child process |
| Project identity and context | Project Context | `project.registry.*`, `project.context.*` | Canonical `project/<slug>` joins all domains | Device paths remain local Workspace Bindings |
| Linear-style work management | Work-OS | `project.issue.*`, `project.board.get` | Markdown issue truth and derived views | Shared issue truth; external trackers remain projections unless explicitly authoritative |
| Project overview | Project Hub | `project.hub.get` | Read-only composition of owner sections | Shows binding/integration drift without copying provider state |
| Project layout migration | Project migration | `project.migration.*` | Preview, hash guard, backup, restore | Shared canonical records; machine bindings stay device-local |
| Work Run lifecycle | Workflow + Work Driver | `workflow.agent.*`, `workflow.doctor` | Active local lease validation | Portable handoff binds the remote join to the same Project, Work Item, and Work Run |
| Fleet acceptance | Release verification | `scripts/verify_fleet_workflow.ts` | Deterministic independent two-vault exercise | Local prepare → remote join/checkpoint/leave → local doctor/Hub verify |
| Reviewed memory | Memory/governance | `memory.*`, `conversation.decision.capture` | Draft, review, promotion boundaries | Shared reviewed Markdown; agent drafts remain quarantined |
| Source registration | Source Registry | `source.*`, `ingest.link.preflight` | `url` and `vaultPath` registration | Stable source identity; provider access remains device/host-specific |
| Search and RAG adapters | Adapter registry | `query.*`, `vault.search` | Filesystem baseline plus optional adapters | Each device reports adapter availability independently |
| Link diagnostics | `obc` compatibility package | OBC CLI and diagnostic integration | Deterministic Obsidian link diagnostics | Consumes shared settings; does not own the product or settings backend |
| Obsidian control plane | Obsidian plugin | Settings page, Doctor, governed Promote | Presentation and device binding only | One binding per device; no copied runtime path or credential |
| External project tools | Provider-owned connectors | Git/GitHub/Gitea/Linear/Orca projections | Optional | Provider IDs are provenance/projections, never Project or Work Run identity |

## Fleet identity and security boundary

A fleet handoff keeps one canonical Project ID, Work Item ID, Work Run ID, agent identity, and idempotent transition-token sequence. The local lease registry and workspace paths never cross devices.

`workflow.agent.join` defaults to `lease_mode=local`. A remote device uses `lease_mode=portable-handoff` and presents the short-lived handoff capability through a separate local channel. The durable Work Run stores only the capability hash and expiry. The raw capability is never written to the shared vault, Project Hub, Git artifact, workflow evidence, CLI report, or acceptance marker.

The release harness also proves that wrong Project, Work Item, Work Run, agent, missing capability, and incorrect capability attempts fail without mutating shared state. Exact join/checkpoint/leave retries must be byte-identical.

## Release evidence status

| Evidence | Status for this release candidate |
|---|---|
| Reproducible local two-vault acceptance harness | Implemented; part of the local release gate |
| 5090/Orca workflow recipe and artifact boundary | Documented in [FLEET_WORKFLOW_ACCEPTANCE.md](FLEET_WORKFLOW_ACCEPTANCE.md) |
| Real local ↔ 5090 run at the beta product commit | Pending rerun; `89cf831ed4615270c56edd2784928a29e52e1789` remains the accepted pre-Agent-binding baseline |
| Beta prerelease | Pending exact-commit 5090 rerun and release audit |
| Final main-branch release | Pending beta acceptance, OpenSpec archive, merge, and main push |

The baseline 5090 run used fixture digest `615b5359e836d8224f5b6ebaf92fcdb7c724cfc89e0e7e3d89a92f873bc580a7` and correlation ID `3c27a18c-b199-4f31-af19-5cfc586e8472`. It proves the workflow before Agent model binding, but it is not substituted for beta-candidate evidence.

Baseline commit-level gate evidence: Settings `28/28`; MCP `401 passed, 18 skipped`; Obsidian `11/11`; root Python `197 passed`; compiler `789 passed, 15 subtests`; isolated shipped-install smoke `124` operations; Fleet safety `5/5`; local Fleet phase-all `8/8`; returned-state verification `6/6`; canonical Ruff, typecheck, build, bundle clean-diff, and strict OpenSpec all passed. The out-of-band proof contents were never printed or copied into the vault.
