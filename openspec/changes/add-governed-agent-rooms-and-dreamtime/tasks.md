## 1. Prerequisite and clean-room baseline

- [x] 1.1 Complete Beta acceptance task 8.5, archive `complete-settings-platform-and-fleet-release`, and confirm canonical settings, Work Run, and Fleet specs before applying this change
- [x] 1.2 Register `https://github.com/EXXETA/exxperts` through the supported URL Source Registration flow and record inspected commit `035594aad68db78ef92899578b2e4839343f53d9` as research evidence
- [x] 1.3 Add a clean-room/license decision record that prohibits copying EXXETA product code, prompts, tests, UI text, styles, icons, and assets and records that no EXXETA dependency is introduced
- [x] 1.4 Inventory current agent memory, passport, handoff, context wakeup, workflow, settings, connector, and fleet paths and map each legacy record to the new domain or an explicit retirement path
- [x] 1.5 Add characterization tests for existing memory, context, Work Run, settings, Project Hub, plugin settings, and fleet behavior before changing schemas

## 2. Shared agent domain contracts

- [x] 2.1 Define versioned schemas and validators for Agent Profile, Project Agent Binding, Thread, Room identity, and Room projection
- [x] 2.2 Add vault-scoped Agent Profile persistence with stable IDs, optimistic revision checks, and secret/path rejection tests
- [x] 2.3 Add Project Agent Binding persistence and enforce Project Context, profile-version, role, enablement, and grant-reference constraints
- [x] 2.4 Add durable Thread lifecycle and ordered message, artifact, and Work Run references without treating messages as approved memory
- [x] 2.5 Implement the derived Room read model and prove that it reuses canonical Project, Thread, Work Run, and Memory identities without a parallel project ledger
- [x] 2.6 Add Room doctor diagnostics for missing profiles, disabled bindings, stale fingerprints, unresolved runs, and unavailable capabilities with redaction tests

## 3. Context Envelope compiler

- [x] 3.1 Define the versioned four-layer Context Envelope schema, per-layer provenance, token accounting, content hashes, aggregate fingerprint, and model lock
- [x] 3.2 Implement Platform Kernel and Agent Constitution compilation from immutable governance rules and locked Profile/Binding versions
- [x] 3.3 Implement Governed Working Memory compilation from one approved Memory Revision and reject proposals or stale revisions as execution context
- [x] 3.4 Implement Runtime Envelope compilation from Project Context, Work Item/Run, Thread window, Settings snapshot, device capability, grants, and token budget
- [x] 3.5 Implement deterministic layer-aware trimming with mandatory-content preservation and omission diagnostics
- [x] 3.6 Add retry and join guards that reject fingerprint drift or create an explicit new execution attempt
- [x] 3.7 Add secret, credential, machine-path, lease-token, and process-state leak tests for serialized Context Envelopes

## 4. Dream Time proposal and revision core

- [x] 4.1 Define Memory Proposal, Memory Revision, Memory Event, approval decision, warning, protected directive, and lifecycle schemas
- [x] 4.2 Implement immutable proposal storage with source identities, expected revision, fingerprint, provenance, model lock, expiry, and candidate diff validation
- [x] 4.3 Implement a proposal-only Dream Time worker boundary with no write tools, network, connectors, or protected-knowledge authority
- [x] 4.4 Implement fingerprinted approval and rejection operations with actor authorization, optimistic revision checks, transition-token idempotency, and stale fail-closed behavior
- [x] 4.5 Implement copy-on-write Memory Revision storage and append-only events retaining previous revision, exact diff, actor, provenance, timestamp, and policy result
- [x] 4.6 Enforce must-keep sections, protected directives, unresolved conflicts, and byte-preservation rules for sections outside an operation's scope
- [x] 4.7 Add multi-device concurrent-approval, interrupted-commit replay, expired-proposal, and tampered-fingerprint tests

## 5. Checkpoint vertical slice

- [x] 5.1 Implement checkpoint input collection from a canonical Thread or Work Run with explicit source cutoff and artifact citations
- [x] 5.2 Implement checkpoint candidate validation limited to Recent Context and Open Items
- [x] 5.3 Add MCP operations for checkpoint proposal creation, proposal inspection, approval, rejection, revision read, and Dream Time doctor
- [x] 5.4 Add CLI/compiler integration that locks the approved Memory Revision fingerprint into a subsequent Context Envelope
- [x] 5.5 Add an end-to-end test: create Profile and Binding, open Room, create and approve checkpoint, then resume from another Thread and device using the approved fingerprint
- [x] 5.6 Preserve compatibility reads for existing memory/passport/handoff paths and generate a migration report without overwriting user files

## 6. Learn Review and knowledge governance

- [x] 6.1 Implement learn proposal generation from approved Recent Context revisions with citation and stable-memory section validation
- [x] 6.2 Implement review proposal generation limited to deduplication, compression, and structure maintenance of stable working memory
- [x] 6.3 Reject uncited new claims, protected-section deletion, and cross-section mutation in learn/review validation tests
- [x] 6.4 Route decision, architecture, runbook, and durable knowledge outputs to the existing Promotion candidate path while keeping working-memory approval separate
- [x] 6.5 Add manual-approval-default policy and a disabled-by-default schema hook for future warning-free working-memory auto-approval
- [x] 6.6 Add Dream Time history, diff, conflict, warning, model-lock, and provenance projections for Project Hub and doctor
- [x] 6.7 Add disabled-by-default deterministic daily, weekly, and monthly Project-scoped cadence operations that reuse Work Run, Context Envelope, proposal-only Memory, and Usage boundaries, including two-service concurrent-create convergence with strict drift rejection

## 7. Context Consult and delegation

- [x] 7.1 Define Context Consult request/result schemas with authorization, as-of revision, fingerprint, provenance, warning, and artifact identity
- [x] 7.2 Implement read-only consult execution and tests proving that neither source nor requesting Agent memory changes
- [x] 7.3 Define Delegation Plan, Capability Grant, Child Work Run, and Artifact Projection schemas
- [x] 7.4 Implement delegation planning and explicit approval that creates exactly one idempotent Child Work Run in the same Project
- [x] 7.5 Enforce scoped and expiring grants across Project, Agent, Work Run, connector, operation, resource, and side-effect class
- [x] 7.6 Implement child completion, failure, cancellation, replay, and Artifact Projection back to the parent without inferring parent terminal state
- [x] 7.7 Add Promotion and Operation Write Policy tests for consult and child artifacts, including per-run external-side-effect approval

## 8. Host capability connectors and assignment

- [x] 8.1 Define versioned Expert Descriptor, Host Capability Connector, capability import provenance, health, and Assignment Plan schemas separate from Knowledge Adapters
- [x] 8.2 Implement descriptor and connector registries with source URL, commit/version, content hash, license review, importer version, and approval status
- [x] 8.3 Implement deterministic assignment matching and stable tie-breaking across capability, health, device, model, cost, grant, and Project policy constraints
- [x] 8.4 Integrate approved Assignment Plans with the existing Work Driver lease and Work Run join instead of expanding legacy `agent.trigger`
- [x] 8.5 Implement the governed MCP proxy `search`, `describe`, and `invoke` operations with lazy connection, timeouts, descriptor drift checks, and structured diagnostics
- [x] 8.6 Route connector configuration through Settings, credentials through Secret Reference, and authorization through Project Binding and Capability Grant
- [x] 8.7 Add stdio, HTTP, OAuth, local-model, cloud-model, unavailable-secret, unauthorized-operation, timeout, and secret-redaction contract tests
- [x] 8.8 Add connector/expert health and matching projections to doctor and Project Hub without triggering external calls
- [x] 8.9 Add the Settings-derived Knowledge Adapter profile for MemU/LightRAG/RAG-Anything/Kanban/QMD and clean-room, read-only Hindsight recall with legacy provenance, last-mile Secret Reference resolution, Doctor redaction, and no-network tests
- [x] 8.10 Move vault-to-MemU sync/write onto the same Settings-derived profile, keep private DSNs out of argv/log/result, and add Python/Node regression tests
- [x] 8.11 Decouple Host connector identity from Project Tracker providers, normalize generic/canonical selectors, server-bind connector approval provenance, and prove forge/token isolation

## 9. Work Run and Fleet integration

- [x] 9.1 Extend Work Run durable records with locked Agent/Binding versions, Assignment Plan, Context Envelope fingerprint, parent/child relation, non-secret grant summary, and Artifact Projections
- [x] 9.2 Add join-conflict and replay tests proving connector or remote Agent responses cannot overwrite canonical Project, Work Item, Work Run, Agent, or context identity
- [x] 9.3 Implement expiring device capability and health advertisements without shared paths, secrets, process handles, or lease tokens
- [x] 9.4 Extend portable handoff with parent/child identities, locked assignment, context fingerprint, grant summary, artifact inputs, expected output, and transition tokens
- [x] 9.5 Extend fleet verification for deterministic no-match, stale device, unauthorized capacity, remote replay, child artifact provenance, and local/remote evidence parity
- [x] 9.6 Run a 5090 workflow acceptance test for one delegated Child Work Run and prove shared durable identities plus isolated device-local execution state

## 10. Usage ledger and policy projections

- [x] 10.1 Define append-only Usage Event schema and stable idempotency keys for model, Dream Time, consult, delegation, and connector calls
- [x] 10.2 Implement usage writers that preserve provider-reported facts and explicit unknown token, price, currency, and attribution states
- [x] 10.3 Implement deterministic Project, Agent, Thread, Work Run, Provider, Device, operation, and time-window projections with source-event and unknown counts
- [x] 10.4 Implement versioned budget, quota, warning, and admission-policy evaluation as projections that never mutate historical Usage Events
- [x] 10.5 Add duplicate-report, price-change, local-model unknown, cross-device sync, and secret/prompt/path redaction tests
- [x] 10.6 Add Usage MCP/CLI operations and Project Hub projections before building charts in the plugin

## 11. Obsidian control plane

- [x] 11.1 Add Agent Profile and Project Binding settings using shared backend operations and Secret Reference selectors
- [x] 11.2 Add Room and Thread views that display canonical Project, Agent, Work Run, memory fingerprint, connector, and diagnostic state
- [x] 11.3 Add Dream Time proposal diff, warning, approve, reject, stale-conflict, revision-history, and Promotion handoff controls
- [x] 11.4 Add consult and delegation plan review with capability, budget, device, side-effect, child status, and artifact provenance visibility
- [x] 11.5 Add connector/expert health and Usage summaries while keeping configuration, approval, and historical facts in the backend
- [x] 11.6 Add plugin tests proving it does not compose governance prompts, persist lease/grant tokens, store plaintext secrets, or maintain a second approval state

## 12. Migration release and verification

- [x] 12.1 Implement a dry-run migration from legacy agent memory/passport/handoff records to initial Profile/Binding/Thread/Memory Revision proposals with rollback metadata
- [x] 12.2 Document Room, Dream Time, consult/delegation, connector, multi-device, usage, migration, clean-room, and troubleshooting contracts
- [x] 12.3 Run targeted unit and integration tests for every new operation plus existing memory, workflow, Project Hub, work driver, settings, plugin, and fleet regression suites
- [x] 12.4 Run full lint, typecheck, build, bundle smoke, static analysis, dependency/license review, and generated-bundle verification
- [x] 12.5 Run secret, credential, machine-path, lease-token, prompt-body, and EXXETA code/asset provenance leak scans across source, fixtures, bundles, and release artifacts
- [x] 12.6 Run strict OpenSpec validation, local and 5090 fleet acceptance, Beta packaging, clean install/upgrade smoke, rollback smoke, and record evidence before release

## 13. Project Tracker projection separation and Plane

- [x] 13.1 Add the independent `providers.project_tracker.*` canonical Settings profile and keep Host Capability configuration out of Forge resolution
- [x] 13.2 Implement the Plane work-items adapter with self-hosted base URL, `X-API-Key`, explicit workspace/project binding, and non-guessed state mappings
- [x] 13.3 Reuse SecretRef last-mile, binding/Settings/reviewed-head drift, end-to-end deadline, and same-origin HTTPS redirect gates for Plane pull/apply
- [x] 13.4 Add network-free Settings and Forge contract tests for Plane pull, pure plans, create/update apply, fail-closed configuration, provenance, and redaction
- [x] 13.5 Document Project Tracker ownership, Plane current API contract, local projection boundaries, and clean-room Source evidence
- [x] 13.6 Add shared canonical create receipts for GitHub, Gitea, Plane, and Linear with remote identity parsing, zero-network replay, drift refusal, and unknown-outcome documentation/tests
