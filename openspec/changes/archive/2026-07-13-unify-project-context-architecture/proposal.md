## Why

LLM Wiki currently overloads `project` to mean a folder name, repository, Work-OS root, knowledge scope, and runtime namespace. The resulting `Projects/`, `01-Projects/`, and `10-Projects/` split can make current work invisible to recall, gives the Python Work Driver and TypeScript workflow separate run models, and prevents settings and integrations from sharing one reliable project context.

## What Changes

- Promote the existing `project/<slug>` identity, shared project record, and local binding registry into the cross-runtime Project Registry contract so TypeScript and Python stop deriving identity independently.
- Define Workspace Bindings and External Projections for repositories, local directories, Obsidian vaults, GitHub/Gitea/Linear records, and other host-local or provider-local attachments.
- Add a Project Context Resolver and read-only Project Hub that compose domain-owned work, knowledge, runtime, settings, capability, workspace, and integration state.
- Unify Work Driver leasing and TypeScript agent workflow lifecycle behind one Work Run contract without introducing a daemon.
- Add compatibility and migration across the registry records in `Projects/`, Work-OS records in `01-Projects/`, knowledge records in `10-Projects/`, and older path-derived records using dual-read, canonical-write behavior and auditable migration plans; the domain roots remain separate by design.
- Deprecate path-derived internal project identity and retired docket writes after compatibility coverage exists.
- Keep the first delivery backend-only; Obsidian Project Hub and settings UX consume these contracts later.

## Capabilities

### New Capabilities

- `project-registry`: Stable project identity, lifecycle, lookup, aliases, and workspace/provider bindings.
- `project-context`: Deterministic context resolution and a read-only Project Hub assembled from domain-owned state.
- `project-layout-migration`: Safe discovery, compatibility reads, conflict reporting, and migration of legacy project layouts.
- `work-run-coordination`: One Work Run identity and lifecycle shared by next-work selection, leases, agent checkpoints, output classification, and completion.

### Modified Capabilities

None. The repository has no existing canonical capability specs; current behavior is captured as compatibility requirements in the new specs.

## Impact

- TypeScript MCP domains: `mcp-server/src/project`, `context`, `source`, `workflow`, core operations, and write policy.
- Python compiler/runtime: `compiler/work_driver.py`, knowledge metadata, project path resolution, and lease persistence.
- Vault contracts: project anchors under `01-Projects`, project-scoped knowledge under `10-Projects`, legacy `Projects/` intake, and local workspace bindings under `.vault-mind`.
- Public operations: existing project operations remain compatible while new registry, context, migration, and Work Run operations are introduced.
- Tests and documentation: characterization tests precede behavior changes; migration and cross-runtime conformance tests become release gates.
