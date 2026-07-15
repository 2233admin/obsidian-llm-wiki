# Agent Room and Dream Time Migration Inventory

This inventory freezes the pre-change ownership boundaries for `add-governed-agent-rooms-and-dreamtime`. It is a migration map, not permission to rename or overwrite user memory. Every migration first produces a dry-run report or Memory Proposal.

## Authority map

| Existing surface | Current implementation and durable path | New-domain role | Disposition |
| --- | --- | --- | --- |
| Project identity | `mcp-server/src/project/project-context.ts`; `Projects/<slug>.md` | Project Context aggregate root | Keep. Room always resolves this identity and never infers a Project from a repository, directory, Agent, or Thread. |
| Work-OS anchor and items | `01-Projects/<slug>/_project.md`, `issues/*.md` | Project work authority | Keep. Agent Rooms read and link Work Items; they do not copy issue state. |
| Durable Work Run | `mcp-server/src/workflow/workflow.ts`; `01-Projects/<slug>/runs/*.json` | Execution truth, including future assignment, parent/child, context fingerprint, grants, and artifacts | Extend in place with versioned optional fields. Preserve existing lifecycle and transition-token behavior. |
| Agent lifetime compatibility state | `01-Projects/<slug>/agents/<agent>/lifetime.md` and `events.jsonl` | Legacy Agent activity projection | Compatibility read during migration. New Room projection uses canonical Work Runs and Threads; do not promote lifetime Markdown into a second execution ledger. |
| Project Agent memory | `mcp-server/src/memory/memory.ts`; `10-Projects/<slug>/agents/<actor>/memory/` | Input to Agent Profile, Thread history, and initial Memory Revision proposals | Preserve bytes. Inventory and propose a split; never rewrite in place. |
| Global Agent memory fallback | `00-Inbox/Agent-Memory/<actor>/` | Project-less compatibility memory | Keep read compatibility. Project binding requires explicit user review before any content becomes Project-scoped. |
| Passport | `passport.md` with Goal, Constraints, Decisions, Open Questions, Pointers | Agent Constitution candidate plus working-memory references | Parse through a versioned adapter. Stable identity/config becomes an Agent Profile proposal; project facts remain working memory or Promotion candidates. |
| Handoff | `handoff.md` with Current State, Next Steps, Risks, Files | Recent Context checkpoint input | Preserve and cite as migration provenance. Convert only through an approved checkpoint proposal. |
| Session notes | `memory/sessions/*.md` | Thread/history input | Preserve as source artifacts. Import ordering and cutoff into Thread references without treating message text as approved memory. |
| Conversation decisions | `memory/decisions/*.md`; conversation capture operations | Working-memory or knowledge-promotion candidates | Do not auto-promote. Classification decides whether the output remains Agent memory or enters human-reviewed Promotion. |
| Legacy key-value memory | `_ai_memory.json`; `memory.set/get/list/forget` | Compatibility-only personal key/value store | Do not use as Room or Dream Time storage. Retain operations until a separately reviewed retirement plan exists. |
| Wakeup and recall | `mcp-server/src/context/context.ts`; `context.wakeup`, `context.recall`, `context.deep_search` | Inputs to Context Envelope | Reuse retrieval and citations. Replace L0/L1 response assembly gradually with the four-layer compiler; keep compatibility output until clients migrate. |
| Settings | `packages/settings-platform/`; `_llmwiki/settings/**`; `mcp-server/src/settings/settings.ts` | Non-secret Agent/model/connector policy and immutable Settings Snapshot | Keep and extend the canonical registry. Secret values remain last-mile and never enter Agent Profile, Room, Work Run, or plugin data. |
| Obsidian settings control plane | `obsidian-plugin/src/settings*.ts`; plugin data schema v2 | Presentation, device binding, and migration marker only | Keep. Plugin data must discard Room, Work Run, Memory approval, grant-token, and connector-secret copies. |
| Project Hub | `mcp-server/src/project/project-hub.ts`; `project.hub.get` | Read-only composition point for Room, connector, usage, and health projections | Extend read-only. It never becomes a write authority or owns provider state. |
| Knowledge Adapters | `mcp-server/src/adapters/**` | Search/read/graph/embedding/file-event capability | Keep separate. They do not become executable Host Capability Connectors. |
| MCP filesystem transport | `mcp-server/src/connector/fs-transport.ts` | MCP server plumbing and vault operations | Keep as infrastructure. It is not the future third-party capability proxy or connector registry. |
| Compile trigger and legacy `agent.trigger` | `mcp-server/src/compile-trigger.ts` and operation registration | Existing compiler invocation compatibility | Do not expand into a general Agent runtime. New execution uses Assignment Plan, Work Driver lease, Work Run join, and Host Capability Connector. |
| Fleet acceptance | `scripts/verify_fleet_workflow.ts`, `tests/fixtures/fleet-workflow.v1.json` | Current one-Work-Run portable-handoff baseline | Extend only after Beta spec archive. Preserve same durable identities and device-local path/secret/lease isolation. |
| Source Registry | `mcp-server/src/source/source.ts`; `_llmwiki/source-registry.json` and Source Notes | Provenance for external products, skills, connectors, and repositories | Keep. URL and vaultPath remain the only supported Phase 1 inputs. |

## Compatibility invariants

1. `ProjectContext` remains the only Project identity root; `Room` is a derived read model.
2. Existing `memory.*`, `context.*`, and `workflow.agent.*` operations remain readable until their replacements have parity evidence and a documented compatibility window.
3. Migration never overwrites `passport.md`, `handoff.md`, sessions, decisions, `_ai_memory.json`, lifetime Markdown, or event logs.
4. Existing Work Run IDs, Work Item IDs, transition tokens, output classification, Promotion Policy, and Operation Write Policy keep their meaning.
5. Read-only Context and Project Hub operations do not create a second state store.
6. Plugin data owns only presentation, device binding, and migration state.
7. Shared state never contains secret values, portable-handoff tokens, lease tokens, process handles, or machine-local workspace paths.

## Resolved pre-implementation drift

The repository originally had `01-Projects/obsidian-llm-wiki/_project.md` but no shared `Projects/obsidian-llm-wiki.md` registry record. After Beta acceptance and archive completed, `project.migration.plan` produced one conflict-free, hash-guarded `adopt_work_os_anchor_as_shared_project` action. Batch `agent-rooms-prereq-20260715` applied that action and created `Projects/obsidian-llm-wiki.md`; the local restore manifest remains under `.vault-mind/project-migrations/` and is not shared durable state. Strict Project Context resolution can now be used before project-scoped Agent bindings or Source migration begin.

`source.register` upserts a canonical URL while retaining its existing Source Note path. A later project-scoped upsert would not by itself move the current global Source Note. Any Source projectization requires an explicit migration operation with a manifest and rollback rather than an ad hoc re-registration.

## Regression baseline

The following tests are the behavior lock before schema changes:

- `mcp-server/src/project/agent-room-legacy-characterization.test.ts`: one Project identity across memory, context, Work Run, Settings Snapshot, and Project Hub; read projections do not mutate state or expose local/secret data.
- `mcp-server/src/memory/memory.test.ts`: fixed memory paths, canonical Project resolution, and unknown-Project rejection.
- `mcp-server/src/context/context.test.ts`: wakeup compatibility, deterministic truncation, and separate Work-OS/knowledge recall authorities.
- `mcp-server/src/workflow/workflow.test.ts`: Work Run identity, lease/join, idempotency, side-effect policy, portable handoff, and secret/path rejection.
- `mcp-server/src/project/project-hub.test.ts`: read-only composition, health/drift, and secret redaction.
- `mcp-server/src/settings/settings.test.ts` plus `packages/settings-platform/tests/**`: Settings ownership, optimistic revisions, validation, local/cloud model boundary, and Secret Reference resolution.
- `obsidian-plugin/tests/settings.test.ts`: plugin-data ownership and authoritative SettingsService transport.
- `scripts/verify_fleet_workflow.test.ts`: local/remote Work Run identity, capability rejection, replay, and device-local isolation.

The baseline is complete only when these targeted suites pass before the first shared Agent-domain schema is introduced.
