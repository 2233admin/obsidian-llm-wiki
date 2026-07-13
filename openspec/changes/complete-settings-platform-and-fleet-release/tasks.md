## 1. Shared baseline and conformance contract

- [x] 1.1 Commit and verify the canonical LLM Wiki naming baseline independently from feature work
- [ ] 1.2 Add the MIT `packages/settings-platform` boundary, versioned first-slice setting definition registry, and shared JSON conformance fixtures
- [ ] 1.3 Define canonical settings document, runtime context, snapshot, validation, conflict, event, and health schemas

## 2. TypeScript Settings Platform

- [ ] 2.1 Implement scope-aware settings stores for product, user-device, vault, workspace-project, and session boundaries
- [ ] 2.2 Implement deterministic snapshot resolve/explain with provenance, source revisions, unset semantics, and redaction
- [ ] 2.3 Implement expected-revision set/unset with complete validation, atomic replace, backup, and conflict results
- [ ] 2.4 Implement settings definitions, scopes, snapshot, assignment, validate, migration-plan, and doctor operations
- [ ] 2.5 Add TypeScript unit and boundary tests for precedence, validation, conflict, recovery, redaction, and Obsidian-closed operation

## 3. Python conformance and CLI

- [ ] 3.1 Implement the Python registry/schema loader and deterministic resolver over the shared fixtures
- [ ] 3.2 Implement Python user-device/vault/project persistence adapters with matching revision and atomicity semantics
- [ ] 3.3 Expose settings snapshot, validation, migration plan, and doctor through the existing Python CLI surface
- [ ] 3.4 Add Python parity tests proving canonical equivalence with the TypeScript fixtures and secret redaction

## 4. Obsidian control plane

- [ ] 4.1 Introduce an Obsidian operation client that consumes Settings Platform contracts without duplicating domain logic
- [ ] 4.2 Migrate `pythonPath` and first-slice operational fields out of plugin `data.json` into scope-correct assignments
- [ ] 4.3 Preserve only presentation preferences and device binding references in plugin data and add reversible legacy migration
- [ ] 4.4 Render effective value, winning scope, validation, apply mode, and Doctor health for the first-slice sections
- [ ] 4.5 Add Obsidian runtime tests for Doctor, migration, UI projection, and Windows executable/argv handling

## 5. Project Context and migration hardening

- [ ] 5.1 Route memory and conversation operations through the canonical Project Context resolver before path creation
- [ ] 5.2 Audit and route all remaining project-scoped source, workflow, settings, and Hub operations through the resolver
- [ ] 5.3 Compose Project Hub settings from Effective Settings Snapshot and propagate degraded/unavailable health accurately
- [ ] 5.4 Add anchor-only Project inventory, registry migration plan/apply/restore, conflict, and current-repo regression tests
- [ ] 5.5 Add strict-mode tests proving unknown or bare project inputs cannot create implicit knowledge or settings roots

## 6. Work Run and fleet identity

- [ ] 6.1 Make `workflow.agent.join` validate Project, Work Item, Work Run, agent, and lease identity before state mutation
- [ ] 6.2 Add idempotent join and mismatch conflict tests spanning Python lease state and TypeScript durable run state
- [ ] 6.3 Add a reproducible fleet workflow fixture/script covering local lease, 5090 join/checkpoint/leave, and local doctor/Hub verification
- [ ] 6.4 Verify machine-local paths and lease tokens never cross device or enter durable Work Run/Project Hub records

## 7. Release runtime parity

- [ ] 7.1 Make default MCP tests discover both `tests/**` and `src/**/*.test.ts` suites in local and CI commands
- [ ] 7.2 Add Obsidian plugin test, typecheck, and build gates to CI and release workflows
- [ ] 7.3 Regenerate `mcp-server/bundle.js` and add a clean-diff generated-artifact gate
- [ ] 7.4 Extend setup/install smoke to start the shipped bundle and assert settings, project context, Hub, migration, and workflow operations
- [ ] 7.5 Update operation reference, setup guidance, migration notes, release notes, and capability inventory

## 8. Integration and release verification

- [ ] 8.1 Integrate isolated agent commits on the shared baseline and resolve overlaps without weakening domain boundaries
- [ ] 8.2 Run targeted TypeScript, Python, Obsidian, migration, Work Run, bundle, and install smoke suites
- [ ] 8.3 Run full Python, MCP, plugin, lint/typecheck/build, static checks, and OpenSpec validation with a clean worktree
- [ ] 8.4 Repeat build/test and fleet Workflow verification on the 5090 environment and record commit-level evidence
- [ ] 8.5 Complete release audit, archive the OpenSpec change, merge the verified branch, and push main only when every blocking gate passes
