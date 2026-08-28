# Project Hub Recovery Flow v2 tasks

## Delivery contract

`tasks.md` tracks reviewable work packages. The executable step-by-step source-bound plan is `docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md`.

Luna receives one reviewed Task at a time. It may alter internal implementation shape, add/split focused files, extract helpers, adjust focused tests, and create a local commit. It must stop before changing approved public operation/schema names, stages/actions, authority, dependency edges, write policy, privacy/security, crash invariants, or observable behavior. It may not push, merge, or perform external mutation. The controller reviews, runs full verification, aligns plan/file maps, and accepts or rewrites the commit.

## Phase 0 — approved design and planning gate

- [x] **T0.1 Approve product and migration direction** — Promote the recovery-required S01B–S08 path into Foundation exit; keep S01 v1 as historical completion; clean-cut to V2 at S04A without a compatibility shim.
- [x] **T0.2 Approve Flow contract** — Confirm `project-hub-recovery-flow-request/v2`, `project-hub-recovery-flow/v2`, `project-hub-recovery-plan/v2`, request actions `open|search|plan|refresh-plan|restart`, response stages `open|searched|needs-agent-selection|planned|stale|unavailable`, chained Flow Fingerprints, layered owner locks, stateless recomputation, mandatory repeatable search, explicit plan refresh, and candidate override.
- [x] **T0.3 Approve authority and mutation boundary** — Confirm `project.hub.recovery.flow` is read-only and ends at Plan; authenticated actor identity binds only in `workflow.recovery.apply`; `workflow.agent.leave` is the claimed output completion boundary; Ask Mate Project Context is primary; plugin Flow state is ephemeral.
- [x] **T0.4 Approve Luna contract** — Permit internal implementation-shape autonomy and local Task commits; forbid unapproved contract/authority/effect changes, push, merge, and external mutation; controller owns full verification and canonical plan updates.
- [x] **T0.5 Align durable artifacts** — Added reviewed S01B and direct S02–S08 chain; aligned parent brief, roadmap, detailed 17-task plan, `CONTEXT.md`, and ADR; strict OpenSpec and Work-OS projection pass; independent reviewer approved the corrected contract/plan. Planning commit closes this gate before Phase 1.

## Phase 1 — S01B complete internal V2 contract kernel

- [x] **T1.1 Shared closed-contract support (R1, R2, R4)** — Add `mcp-server/src/project-hub/contract-support.ts` and its test; migrate reusable canonical JSON/fingerprint/safety helpers from `recovery.ts` without changing V1 bytes while V1 remains live.
- [x] **T1.2 Recovery Flow request/response reducer (R1, R2, R4)** — Add `mcp-server/src/project-hub/recovery-flow.ts`, its test, and internal export. Implement every request action/response stage, exact nullable arms, bounds, owner-lock ordering, chained Flow Fingerprints, minimal-input prerequisite descriptors, full-prior-Plan validation requirements, and stale/unavailable shapes. Do not register a public partial V2 operation.
- [x] **T1.3 Verify S01B** — From `mcp-server/`, run `npm exec bun -- test src/project-hub/contract-support.test.ts src/project-hub/recovery-flow.test.ts src/project/project-hub.test.ts` and `npm run typecheck`. Prove V1 bytes remain unchanged and record evidence in `p0-s01b-project-hub-recovery-flow-v2.md`; independent review precedes reviewed/executable S02.

## Phase 2 — S02 open/context and Workflow read seams

- [x] **T2.1 Extract Work Run store** — Add `mcp-server/src/workflow/work-run-store.ts` and its test; migrate `workflow.ts` lock, durable run, local lease, atomic write, rollback, recovery-claim, and output-claim primitives without changing current operation behavior.
- [x] **T2.2 Add bounded Workflow read model (R3)** — Add `mcp-server/src/workflow/workflow-read-model.ts` and its test. Read durable Work Run identity/lifecycle and matching agent-event checkpoints; test active/terminal/expired/malformed/mismatched records, deterministic ordering, locks, and private-field exclusion.
- [x] **T2.3 Compose V2 open stage (R2–R4)** — Add `mcp-server/src/project-hub/recovery-open.ts` and its test; modify internal exports. Compose current V1-equivalent action facts plus bounded authoritative context, capability summary, citations, owner locks, suggested queries, omission facts, and open Flow Fingerprint. No public Flow operation registration yet.
- [x] **T2.4 Verify S02** — Run `npm exec bun -- test src/project-hub/recovery-flow.test.ts src/project-hub/recovery-open.test.ts src/workflow/work-run-store.test.ts src/workflow/workflow-read-model.test.ts src/workflow/workflow.test.ts src/project/agent-room-legacy-characterization.test.ts` and `npm run typecheck`. Record evidence in `p0-s02-resumable-agent-context.md`.

## Phase 3 — S03 mandatory Project-scoped cited search

- [x] **T3.1 Project owner search source (R5)** — Add `mcp-server/src/project-hub/search-source.ts` and its test. Read only canonical current Project Work-OS, Project Memory, Project Source/Evidence, Session Record, and Workflow roots with exact owner locks; exclude cross-Project material before ranking; do not modify generic RRF semantics or add an index.
- [x] **T3.2 Internal searched basis only (R2, R4, R5)** — Add `mcp-server/src/project-hub/search.ts` and its test. Implement safe query normalization, deterministic bounds/order, repeated search branches, owner locks, intrinsic searched payload facts, and stale recomputation over S02 open. Do not derive candidates, read Agent Bindings, finalize searched/needs-selection/unavailable stages, or construct recommended requests in S03.
- [x] **T3.3 Verify S03** — Run `npm exec bun -- test src/project-hub/recovery-flow.test.ts src/project-hub/recovery-open.test.ts src/project-hub/search-source.test.ts src/project-hub/search.test.ts src/workflow/workflow-read-model.test.ts` and `npm run typecheck`. Record evidence in `p0-s03-project-cited-retrieval.md`.

## Phase 4 — S04A candidates, immutable Plan, complete Flow registration, V1 removal

- [x] **T4.1 Candidate, Binding, and final search-stage composition (R6)** — Add `action-candidates.ts`, `agent-selection.ts`, and focused tests. Derive resume/create candidates and exact compatible Binding/Profile revisions; one Binding creates a fingerprint-free plan intent later derived into a request; 2–16 produces needs-agent-selection; 17+ produces `binding_selection_too_large`; zero produces unavailable; no identity is guessed.
- [x] **T4.2 V2 Plan and stateless recomputation (R2, R4, R6)** — Add `action-plan.ts` and its test. Implement `plan/from-search` and `plan/override` with explicit searched-basis/planned fingerprints, full-prior-Plan validation, non-self-referential intrinsic/derived requests, five-minute expiry, explicit refresh, candidate replacement, and apply-bound actor identity.
- [x] **T4.3 Register complete Flow and clean-cut V1 (R1–R6)** — Modify `mcp-server/src/project/project-hub.ts`, its tests, `project-hub/index.ts`, core operation composition, generated-operation tests/docs inputs, and every V1 caller. Register only the complete `project.hub.recovery.flow`; remove `project.hub.get.recovery`, `project-hub-recovery/v1` types/validator/export/tests, and `mcp-server/src/project-hub/recovery.ts`. Add V1-to-V2 action-fact equivalence before deletion.
- [x] **T4.4 Verify S04A** — Required T4.4 suite: 57 passed, 0 failed; `npm run typecheck -- --pretty false`: passed; strict OpenSpec validation: passed; absence scan: no runtime V1 references or stale operation name outside permitted historical prose. Independent review remains pending.

## Phase 4.5 — S04P verified read-only `workflow.recovery.plan` Operation

> Verified S04P implementation. The read-only planning Operation separates
> planning from apply; S06A T5.3 is unblocked and resumes actual proof.

- [x] **T4.5.1 Register planning Operation and shared service (R12, R13, R15)** — Define `WORKFLOW_RECOVERY_PLAN_REQUEST_SCHEMA_VERSION = "workflow-recovery-plan-request/v1"`, `WorkflowRecoveryPlanEnvelopeV1 { schemaVersion; request: RecoveryPlanFromSearchRequestV2 | RecoveryPlanOverrideRequestV2 | RecoveryRefreshPlanRequestV2 }`, `RecoveryPlanningService { capabilityFact; plan(request): Promise<RecoveryPlannedResponseV2 | RecoveryStaleResponseV2 | RecoveryUnavailableResponseV2> }`, and `createRecoveryPlanningService(dependencies): RecoveryPlanningService`. Construct one default Recovery runtime with the plan capability fact, create the service from its capability-aware dependencies, and inject the same runtime/service into `makeProjectHubOps(registry, settingsService?, options?)` and `makeWorkflowOps(vaultPath, options?)` before either operation array is built. The Operation unwraps the envelope and calls the service; semantics, validators, and fingerprints are not duplicated. Plan arm source is `project-hub-recovery-flow-request/v2`; there is no `workflow-recovery-plan/v1` Plan or response schema.
- [x] **T4.5.2 Introduce planning capability fact (R14, R15)** — Register `workflow.recovery.plan` with `mutating: false`; its capability fact is `available`, independent of `workflow.recovery.apply`. Operation order does not determine visibility. Add Workflow/core integration tests proving the fact appears even when Workflow operations are built before Project Hub operations, while apply remains absent/unusable before S04B.
- [x] **T4.5.3 Update candidate composition and validator (R12, R14)** — Modify `composeRecoveryCandidates` and Compatible Agent Profile requirements to check `workflow.recovery.plan: available`, not apply. Migrate `validateRecoveryPlanV2` in `mcp-server/src/project-hub/recovery-flow.ts` from requiring available apply to requiring available plan; retain Plan `owningOperation: 'workflow.recovery.apply'`. Missing planning capability produces bounded `capability_unavailable` remediation.
- [x] **T4.5.4 Expand fixtures/tests (R6, R12–R15)** — Migrate apply-only fixture facts to plan in `action-plan.test.ts`, `search.test.ts`, `agent-selection.test.ts`, `action-candidates.test.ts`, `project/project-hub.test.ts`, and `recovery-flow.test.ts`. Add plan-only → planned, apply absent/unusable, and later S04B apply-rejects-without-apply cases. Assert valid multiple Bindings return `needs-agent-selection` with bindings/candidates and no generated Plan request; do not report `no_compatible_binding` or `no_safe_candidate` for that valid multiple-Binding state.
- [x] **T4.5.5 Verify S04P and generated catalog (R12–R15)** — Run `workflow/recovery-plan.test.ts`, Workflow/core operation and catalog tests, all listed planning fixtures, and `mcp-server/src/scripts/generate-tools-doc.test.ts`; run `npm run generate-tools-doc` and verify `docs/mcp-tools-reference.md`. Change `mcp-server/src/scripts/generate-tools-doc.ts` only if catalog handling requires new rendering; its current fallback should handle the new namespace. Prove no-write SHA-256/byte equality. Record S04P evidence in `p0-s04p-workflow-recovery-plan.md`; S06A T5.3 is blocked pending principal approval and promotion.

## Phase 5 — S06A Ask Mate Recovery Flow preview

- [x] **T5.1 Stateless Flow client (R9.1–R9.3)** — Add `obsidian-plugin/src/project-hub/recovery-client.ts` and its test; modify `main.ts`, lifecycle tests, and `test-settings.mjs`. Map only read-only Flow actions/stages; no apply method, server validator copy, retry store, or persisted Flow state. Automated evidence: focused client test passed; `npm run typecheck -- --pretty false` passed after installing declared MCP dependencies.
- [x] **T5.2 Project-context Flow panel (R9.1–R9.3)** — Add `obsidian-plugin/src/project-hub/recovery-panel.ts` and its view test; modify `ask-mate/view.ts`, its test, styles, and test loader. Render open/search/Binding selection/planned/stale/unavailable, auto-submit only the closed recommended request, allow candidate replacement, require explicit plan refresh, and preserve keyboard/focus/cancellation/no-write behavior. Automated evidence: focused panel/lifecycle tests passed; `npm run build` passed. Actual Obsidian keyboard/visual/principal evidence remains T5.3.
- [x] **T5.3 Verify S06A in actual Obsidian** — Accepted in isolated sanitized `qa-vault` on Obsidian 1.13.7. Observed all six stages; repeated search; unique auto-follow; explicit multi-Binding selection; candidate replacement; expired Plan with explicit refresh; stale restart; bounded unavailable; citation activation; visible cancellation; keyboard focus; reload reset; and zero byte/SHA-256 changes across 13 fixture, owner, and plugin-data files. Plugin tests passed 84/84, and principal accepted the surface. S04B is unblocked.

**Stop conditions:**
- Missing `workflow.recovery.plan` capability → stop and return bounded evidence; apply is not the planning gate.
- Failure to reach `planned` while plan is available and apply is absent/unusable → stop and file a defect; this is not an expected result.
- Any byte is written to vault/plugin data during read-only stages → stop, file bug.
- Keyboard/focus/cancellation does not work → stop, file bug.

**Rollback:** If the shared service introduces regressions in `project.hub.recovery.flow` plan actions, revert the delegation call to inline planning. Rollback does not require reverting the Operation registration itself.

## Phase 6 — S04B claim-first Workflow apply

- [x] **T6.1 V2 apply request, planning proof, claims, and receipt (R7)** — Added closed `recovery-apply-request/v2`, full Plan/planning-input proof, independently injected apply authorization, digest-only Plan/token claims, existing-claim-first replay, and `claimed|applied|outcome-unknown` receipts.
- [x] **T6.2 Governed resume/create and caller migration (R7)** — Workflow resumes exact IDs or creates one deterministic actor-bound Work Run/lease, never manual start. Core, Agent Domain, Project characterization/E2E, and Fleet callers are migrated.
- [x] **T6.3 Verify S04B** — 83 focused backend tests and 14 compiled real-vault apply tests passed. Security re-review approved apply capability separation, same-token concurrency, allowlist receipt privacy, injected clocks, exact write-policy targets, and claim-index recovery. Fleet tests passed 15/15 and phase-all acceptance passed 13/13. Typecheck/build/OpenSpec/catalog/privacy/diff gates passed.

## Phase 7 — S05 claimed Work Run output governance

- [x] **T7.1 Closed leave request union, submission/quarantine/claim/receipt (R8)** — Added the exact complete/terminate union, nullable terminate contract, safe output/quarantine validation, canonical Work Run/output/token claims, bounded strict recovery scans, first-token-wins replay/rebound handling, verified accepted receipts, and outcome-unknown precedence.
- [x] **T7.2 Owner routes and completion cutover (R8)** — Routed view receipts, allowlisted Work-OS transitions, cited Project Memory drafts/existing Dream Time proposals, exact approved external effects, and effect-free quarantine. Successful/review callers now use complete-mode leave; failed/cancelled uses terminate.
- [x] **T7.3 Remove Python routing authority and verify S05** — Removed the unused Python router while retaining durable field compatibility. Source tests passed 102/102, compiled tests 80/80, Python 60/60, Fleet 15/15 and phase-all 13/13; typecheck/rebuild, strict OpenSpec, catalog, release-install, privacy, and diff gates passed.

## Phase 8 — S06B Obsidian apply, receipt, and Flow restart

- [x] **T8.1 Add exact apply mapping after S04B** — Added the sole `workflow.recovery.apply` client mapping with full Plan/fingerprint, bounded ephemeral planning input, replay-stable token, exact confirmation, and no-write cancellation.
- [x] **T8.2 Receipt/outcome/restart UI** — Added receipt/state rendering, outcome-unknown replay latch and doctor remediation, owner-backed Flow restart, focus/ARIA handling, and no Flow/query/Plan persistence.
- [x] **T8.3 Verify S06B in actual Obsidian** — Plugin and MCP tests passed; the sanitized Obsidian QA flow completed Plan confirmation, cancel, apply, owner receipt, owner restart, and reload isolation. S07 remains next.

## Phase 9 — S07 MCP and dedicated CLI parity

- [ ] **T9.1 Dedicated Recovery Flow CLI** — Add `project-hub/cli.ts` and its test; update package bin/files/build targets. Expose flow `open|search|plan|refresh-plan|restart` plus Workflow apply through shared Operations; no claim-file reads or copied transition semantics.
- [ ] **T9.2 Domain/MCP/CLI parity (R10)** — Add parity tests over identical requests/fixture. Compare stage, Flow/Plan fingerprints, locks, recommended requests, reason codes, citations, diagnostics, apply states, and receipts; redact adapter errors.
- [ ] **T9.3 Verify S07** — Run CLI/parity/Project tests, typecheck/build, and real CLI open/search/plan smoke commands. Record S07 evidence.

## Phase 10 — S08 Foundation acceptance

- [ ] **T10.1 Sanitized V2 fixture and canary matrix (R11)** — Add fixture and end-to-end test containing every owner, unique/multiple/no Binding cases, repeated queries, candidate override, expired Plan, stale locks, claims, outputs, and canaries.
- [ ] **T10.2 Automate R1–R10** — Cover clean V1 removal, stateless recomputation, branch mixing rejection, all stages/actions, apply/output crash windows and races, parity, and privacy.
- [ ] **T10.3 Actual-surface timing** — One familiarization plus three measured Obsidian runs from Open Project Hub invocation to cited immutable Plan preview; all under 60 seconds with raw timings.
- [ ] **T10.4 Exact Foundation gate** — Run complete MCP/plugin/Fleet/Python/OpenSpec verification. Any failure creates a linked issue and leaves S08/Foundation incomplete.

## Phase 11 — closeout

- [ ] **T11.1 Align durable status and generated references** — Update S01B–S08 state/review/dependencies/evidence, roadmap, generated operation docs, changelog, and release notes only for verified behavior.
- [ ] **T11.2 Independent final review** — Review R1–R11, V1 removal, authority/privacy/crash invariants, every exported caller, and test quality; resolve findings and rerun exact affected gates before principal acceptance.
