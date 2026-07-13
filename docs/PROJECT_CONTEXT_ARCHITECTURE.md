# Project Context Architecture

LLMwiki treats a Project as a stable collaboration context identified by
`project/<slug>`. Repositories, local directories, boards, Obsidian folders,
and forge records are bindings or projections; none of them defines the
Project.

## Authority and retention

| Representation | Owner | Authority | Retention |
|---|---|---|---|
| `Projects/<slug>.md` | Project Registry | Project ID, aliases, lifecycle | Shared and durable |
| `01-Projects/<slug>/_project.md` | Work-OS | Work intent and project work container | Shared and durable |
| `01-Projects/<slug>/issues/*.md` | Work-OS | Work Item state, review, priority, dependencies | Shared until archived by Work-OS policy |
| `01-Projects/<slug>/workflow/**` | Workflow | Host-neutral workflow stage and checkpoints | Shared while relevant to current work |
| `01-Projects/<slug>/runs/**` | Work Run coordination | Durable run identity, lifecycle, output class, provenance | Shared and auditable |
| `10-Projects/<slug>/sources/**` | Source Registry | Human-readable project Source Notes | Shared and durable |
| `10-Projects/<slug>/agents/**` | Memory governance | Agent drafts, handoffs, and project memory | Draft until reviewed or retired |
| `.vault-mind/local-bindings.json` | Workspace Registry | Project ID to machine-local workspace path | Device-local and rebuildable |
| `.vault-mind/_leases.json` | Work Driver | Short-lived lease tokens and machine coordination | Device-local and expiring |
| `_llmwiki/source-registry.json` | Source Registry | Source identity and ingest-registration state | Shared and durable |
| GitHub, Gitea, Linear records | External provider | Provider-owned state exposed through External Projections | Provider-defined |
| `10-Projects/<slug>/docket/**` | Retired | No current authority | Migration input only; never a write target |

## Resolution contract

Every project-scoped backend operation resolves its input before reading or
writing domain state. Resolution order is:

1. exact Project ID;
2. registered alias or slug;
3. exact machine-local Workspace Binding path;
4. explicit not-found or ambiguity error.

A bare slug remains a compatibility input at public operation boundaries. It
must produce a compatibility diagnostic and must never become the internal
join key. Unknown input cannot implicitly create a Project or a domain root.

## Project Hub contract

The Project Hub is a read-only composition. It reports each section's owner,
freshness, health, and drift, then routes mutations to the owning operation.
It never stores a machine path, secret value, copied provider workflow state,
or independent Work Item state.

## Migration contract

Project migration is dry-run by default. Plans contain candidate identity,
domain ownership, hashes, warnings, conflicts, proposed writes, and restoration
evidence. Apply mode uses atomic writes and audit manifests. Ambiguous aliases,
stale hashes, and path escapes stop the affected batch. Separate domain roots
are joined by Project ID; they are not merged into one directory.
