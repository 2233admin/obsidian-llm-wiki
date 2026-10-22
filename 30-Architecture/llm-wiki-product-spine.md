---
type: architecture
entity: architecture/llm-wiki-product-spine
status: draft
last-verified: 2026-08-24
---

# LLM Wiki Product Spine

## Decision

**Obsidian LLM Wiki** is the full human-facing product name; **LLM Wiki** is the accepted short name. The product is Obsidian-first. The Obsidian plugin is the primary human-facing product and control plane. The MCP server and CLI are agent and automation access surfaces. Python compiler and adapter processes are optional capability workers behind TypeScript-owned contracts.

`obsidian-llm-wiki` remains the repository and package identifier. `llmwiki` is reserved for machine-facing identifiers. `obsdina` is treated as a voice-input transcription error, not a product name. `LMVK` is not a product name in this repository.

## Product hierarchy

```text
LLM Wiki
└── Obsidian Plugin — primary product and human control plane
    ├── Vault and Knowledge
    ├── Source and Ingest
    ├── Memory
    ├── Project and Work-OS
    ├── Ask Mate and Visual Workspace
    ├── Settings and Capability Health
    └── Promote, Review, and Governance

    Shared TypeScript Domain
    ├── settings-platform
    ├── agent-domain
    ├── visual-workspace
    ├── problem-intake
    └── project and work contracts

    Agent Access Surfaces
    ├── MCP server
    ├── CLI
    └── session archiver

    Optional Capability Workers
    ├── Python compiler and kb_meta
    ├── MemU
    ├── Graph bridges
    └── Fleet integrations
```

## Ownership boundaries

| Area | Owner | Responsibility | Must not become |
|---|---|---|---|
| Human product UX | Obsidian plugin | onboarding, vault binding, settings, capability health, project actions, user feedback | MCP-shaped configuration UI |
| Domain semantics | Shared TypeScript packages | settings, projects, memory, visual edits, problem intake, contracts | transport-specific protocol code |
| Agent access | MCP server | expose domain operations through MCP, format protocol responses, agent-safe errors | the product's primary lifecycle owner |
| Automation access | CLI | headless setup, CI, diagnostics, scripted workflows | the only supported installation path |
| Capability execution | Python workers and external adapters | compiler, legacy processing, optional search/graph capabilities | implicit product prerequisites |
| Durable user truth | vault Markdown and Work-OS notes | knowledge, project state, reviewable artifacts | derived boards or runtime caches |

## First-run product path

```text
Install or enable the Obsidian plugin
  → Open or select a vault
  → Resolve the Project and Workspace Binding
  → Show capability health and required actions
  → Complete the minimum configuration in Obsidian
  → Run the first search or ingest
  → Show the result, provenance, and next action
```

The executable first-run procedure is [Obsidian-first onboarding](../docs/ONBOARDING.md);
capability failures follow [Capability remediation](../docs/CAPABILITY_REMEDIATION.md).

PowerShell and Bash are compatibility launchers for developer, CI, and headless flows. They must not own product logic, require manual configuration copying for the normal path, or make Python a hidden prerequisite for opening the product.

## TypeScript and Python boundary

TypeScript owns the product-facing capability contract:

- stable capability ID and version
- input and output schema
- health probe and availability state
- runtime resolution
- timeout and cancellation
- structured error category and remediation
- provenance and operation status

Python remains an implementation behind that contract where migration is not yet justified. Direct `execFile("python", ...)` calls must be concentrated in capability adapters or workers, not spread through product modules and setup scripts.

Initial capability states are:

- `available`: dependency and health probe passed
- `degraded`: usable with a known limitation
- `unavailable`: capability cannot run; product remains usable if optional
- `disabled`: intentionally turned off by settings or policy

The absence of Python must produce an explained capability state, not an opaque setup failure, unless the selected capability is explicitly required by the current operation.

## Access-surface relationship

```text
Obsidian user → Obsidian Plugin → Shared TypeScript Domain → Vault / capabilities
Agent          → MCP Server      → Shared TypeScript Domain → Vault / capabilities
Automation     → CLI             → Shared TypeScript Domain → Vault / capabilities
```

The three access surfaces may share contracts and operations, but the plugin owns the human journey. MCP tool shape, CLI flags, or Python process arguments must not define the primary UX.

## Project taxonomy

### Core product

- Obsidian plugin and onboarding
- Settings and capability health
- Vault, source, ingest, memory, and search
- Project / Work-OS
- Ask Mate, Visual Workspace, Promote, and governance

### Product infrastructure

- Shared TypeScript domains
- MCP runtime adapter
- CLI access surface
- capability registry and health model
- local workspace bindings

### Compatibility and workers

- Python compiler
- `kb_meta`
- MemU and graph bridges
- legacy evaluation paths

### Later or experimental

- Fleet federation
- Gitea federation
- additional external projections
- session archiver expansion beyond its current workflow use

## Foundation before feature growth

No new MCP operations, adapters, Fleet features, or isolated setup patches should be prioritized until the following foundation exists:

1. Obsidian-first onboarding and vault binding
2. Capability health with actionable remediation
3. TypeScript-owned boundary for Python and external workers
4. Clear ownership between plugin, MCP, CLI, and durable vault state
5. Roadmap and Work-OS issues grouped by product milestone

## Non-goals

- Immediate full rewrite of the Python compiler
- Treating MCP as a replacement for the Obsidian product
- Adding a second project identity model
- Making derived boards or runtime state authoritative
- Expanding provider or Fleet scope during foundation work
