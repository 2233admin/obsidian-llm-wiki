## 1. Characterize Existing Behavior

- [x] 1.1 Add a cross-runtime fixture containing one logical project record, one Work-OS anchor, one knowledge root, one local binding, and representative legacy records.
- [x] 1.2 Add TypeScript characterization tests for current `project`, `workflow`, `source`, `context`, and `vault.project` path resolution before changing production code.
- [x] 1.3 Add Python characterization tests for workspace adoption, Work Driver issue discovery, leases, and existing `Projects/` records.
- [x] 1.4 Add a regression test proving current project recall misses Work-OS-only issues so the intended correction is explicit.
- [x] 1.5 Document the authoritative owner and retention rule for every project-related file found by the fixture.

## 2. Establish Shared Project Identity

- [x] 2.1 Add TypeScript `ProjectId`, `ProjectRef`, and validation helpers for canonical `project/<slug>` identities.
- [x] 2.2 Add Python Project ID parsing and normalization with the same accepted and rejected conformance cases.
- [x] 2.3 Extend shared project record parsing to expose lifecycle, aliases, and diagnostics without accepting machine paths or secrets.
- [x] 2.4 Add shared conformance fixtures and make TypeScript and Python produce equivalent normalized identity results.
- [x] 2.5 Update project adoption so new shared records and Work-OS anchors explicitly carry the same Project ID.

## 3. Build Project Context Resolution

- [x] 3.1 Implement the TypeScript Project Context Resolver with exact-ID, alias/slug, local-binding, ambiguity, and not-found behavior.
- [x] 3.2 Implement the Python resolver adapter against the existing workspace registry and local bindings.
- [x] 3.3 Return canonical registry, Work-OS, and knowledge roots plus optional workspace and projection descriptors from the resolver.
- [x] 3.4 Add compatibility diagnostics for public operations that still supply a bare project name or path-derived reference.
- [x] 3.5 Add resolver doctor checks for missing anchors, duplicate aliases, stale bindings, orphan domain roots, and cross-runtime disagreement.
- [x] 3.6 Expose read-only `project.registry.list`, `project.registry.get`, and `project.context.resolve` operations.

## 4. Move Domain Callers Behind the Resolver

- [x] 4.1 Refactor TypeScript project operations to resolve Project ID once and stop constructing paths from an unchecked `project` string.
- [x] 4.2 Refactor workflow state and agent operations to use resolved Work-OS roots and persist Project ID.
- [x] 4.3 Refactor Source Registration to use the resolved knowledge root and persist Project ID instead of a path-derived project name.
- [x] 4.4 Refactor context wakeup and recall to query both Work-OS and knowledge roots with distinct Knowledge Item types and authority.
- [x] 4.5 Refactor Python Work Driver discovery to select canonical `01-Projects/<slug>/issues/` items through Project Context.
- [x] 4.6 Deprecate legacy `vault.project` implicit creation and route unambiguous compatibility calls through the Project Registry.
- [x] 4.7 Add regression tests proving unknown projects cannot create implicit directories in any domain root.

## 5. Add Safe Layout Migration

- [x] 5.1 Implement a side-effect-free inventory of registry, Work-OS, knowledge, legacy, binding, lease, and workflow representations.
- [x] 5.2 Implement deterministic candidate matching by Project ID and explicit alias, with path basename used only as non-authoritative evidence.
- [x] 5.3 Implement migration conflict records for duplicate aliases, incompatible lifecycle, divergent anchors, and stale hashes.
- [x] 5.4 Implement a default dry-run plan containing proposed writes, redirects, hashes, warnings, conflicts, and retained domain ownership.
- [x] 5.5 Add apply-mode atomic writes, audit manifests, resumable batch state, and restoration evidence through Operation Write Policy.
- [x] 5.6 Add canonical-write and compatibility-read behavior with observable compatibility counters.
- [x] 5.7 Add tests proving inventory and dry-run are byte-preserving and apply rejects ambiguity, path escape, and stale preconditions.
- [x] 5.8 Add tests proving retired `10-Projects/<project>/docket/**` items can migrate only to current `01-Projects/<project>/issues/` paths.

## 6. Unify Work Run Coordination

- [x] 6.1 Define a language-neutral Work Run schema, lifecycle transition table, transition token, output class, and provenance fixture.
- [x] 6.2 Make Python Work Driver create a Work Run ID and durable run record after successfully acquiring a lease.
- [x] 6.3 Store only lease tokens and machine-local coordination data in `.vault-mind/_leases.json` and link them to Work Run ID.
- [x] 6.4 Update TypeScript agent join, step, checkpoint, leave, and doctor operations to require or resolve the same Work Run ID.
- [x] 6.5 Implement idempotent transition handling and reject invalid or post-terminal transitions in both runtimes.
- [x] 6.6 Implement interrupted-run recovery for expired leases without discarding durable run history.
- [x] 6.7 Route Work Run outputs through Run Output Class, Promotion Policy, Operation Write Policy, and explicit external-side-effect approval.
- [x] 6.8 Add cross-runtime tests covering lease-to-join, retries, expiry, review-required output, completion, failure, and cancellation.

## 7. Compose the Project Hub

- [x] 7.1 Implement `project.hub.get` as a read-only composition over registry, Work-OS, knowledge, runtime, settings, capability, workspace, and integration queries.
- [x] 7.2 Include owner, freshness, health, and drift metadata for every Project Hub section.
- [x] 7.3 Integrate effective Settings Snapshot metadata and Secret References without resolving or returning secret values.
- [x] 7.4 Report unavailable local workspaces without making the rest of the Project Hub unavailable.
- [x] 7.5 Add External Projection descriptors and drift reporting without copying provider-owned workflow state.
- [x] 7.6 Add tests proving Project Hub mutations route to owning operations and no writable Hub state exists.

## 8. Retire Conflicting Behavior

- [x] 8.1 Remove retired docket paths from Operation Write Policy after migration coverage is active.
- [x] 8.2 Add deprecation diagnostics and documentation for path-derived project parameters and legacy `vault.project` behavior.
- [x] 8.3 Add a release-gated doctor check that reports remaining compatibility reads by operation and Project ID.
- [x] 8.4 Remove each compatibility reader only after fixtures are migrated and the configured release window reports zero use.
- [x] 8.5 Update `CONTEXT.md`, local projects, memory governance, ingest, workflow integration, and MCP operation reference documentation to use Project ID consistently.

## 9. Verify the Architecture

- [x] 9.1 Run targeted TypeScript project, context, source, workflow, settings, and write-policy tests.
- [x] 9.2 Run targeted Python workspace, Work Driver, forge, currency, and metadata tests.
- [x] 9.3 Run TypeScript typecheck, lint, full test suite, and build with no new dependency.
- [x] 9.4 Run the full Python test suite and static checks used by the repository.
- [x] 9.5 Run OpenSpec strict validation and confirm the change remains apply-ready.
- [x] 9.6 Execute an end-to-end fixture: adopt project, resolve context, register source, discover issue, lease Work Run, checkpoint, route output, read Project Hub, and restore a migration batch.
