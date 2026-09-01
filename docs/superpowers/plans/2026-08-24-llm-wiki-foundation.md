# LLM Wiki Foundation Implementation Plan

> **For agentic workers:** Execute this plan task-by-task after reviewing the product spine. Keep each task independently reviewable and do not add feature work outside the foundation scope.

**Goal:** Make Obsidian LLM Wiki an Obsidian-first product with a coherent first-run path, TypeScript-owned capability boundaries, and aligned plugin/MCP/CLI ownership before resuming feature expansion.

**Architecture:** The Obsidian plugin owns the human product journey and control-plane UX. Shared TypeScript contracts own product semantics and capability health. MCP and CLI expose the same domain through agent/automation surfaces. Python compiler, `kb_meta`, MemU, and graph processes remain optional workers behind explicit capability contracts.

**Tech Stack:** TypeScript, Obsidian plugin API, `@modelcontextprotocol/sdk`, shared packages under `packages/`, Node 20, existing Python workers, Bun test runner when the host shim is repaired, and the existing Work-OS Markdown model.

## Global Constraints

- Canonical human-facing name: **Obsidian LLM Wiki**; accepted short name: **LLM Wiki**.
- Repository and package identifier remains `obsidian-llm-wiki`; `obsdina` is a voice transcription error, not a product identifier.
- Obsidian Plugin is the primary human-facing product and control plane.
- MCP Server and CLI are access surfaces and must not own the human product lifecycle.
- Python is an optional capability-worker implementation, not an implicit product prerequisite.
- Work-OS issue Markdown remains execution truth; `30-Architecture/` and `20-Decisions/` remain reviewed design truth.
- Do not add new MCP operations, adapters, Fleet functionality, or external projections during this plan.
- Do not perform a full Python rewrite. Isolate Python behind contracts first.
- Preserve existing source, ingest, memory, project, promotion, and write-policy invariants.
- Raw voice input never becomes an implementation task without terminology normalization and scope confirmation.

---

### Task 1: Extend the shared capability contract

**Files:**
- Modify: `packages/agent-wiki-contracts/src/index.ts`
- Modify: `packages/agent-wiki-contracts/schemas/toolchain-capability-profile.schema.json`
- Modify: `packages/agent-wiki-contracts/tests/contracts.test.ts`
- Create: `packages/agent-wiki-contracts/schemas/capability-health.schema.json`
- Create: `packages/agent-wiki-contracts/fixtures/v1/capability-health.json`

**Interfaces:**

Produce a versioned, JSON-safe contract consumed by the plugin, MCP runtime, and CLI:

```ts
export const CAPABILITY_STATES = [
  "available",
  "degraded",
  "unavailable",
  "disabled",
] as const;

export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export interface CapabilityHealth {
  id: string;
  version: string;
  state: CapabilityState;
  displayName: string;
  summary: string;
  required: boolean;
  checks: readonly CapabilityCheck[];
  remediation?: readonly CapabilityRemediation[];
  observedAt: string;
}

export interface CapabilityCheck {
  id: string;
  state: "pass" | "warn" | "fail" | "skipped";
  summary: string;
  detail?: string;
}

export interface CapabilityRemediation {
  id: string;
  label: string;
  action: "open-settings" | "choose-path" | "install-dependency" | "retry" | "documentation";
  target?: string;
}
```

- [ ] **Step 1: Add the state constants and interfaces to the shared contract entrypoint.**

- [ ] **Step 2: Add JSON schema and a fixture for one available capability and one unavailable optional worker.**

- [ ] **Step 3: Extend contract tests to reject unknown states, missing `observedAt`, empty IDs, and remediation actions outside the allowlist.**

- [ ] **Step 4: Run the package contract test and build.**

Run: `cd packages/agent-wiki-contracts && npm test` and `npm run build`.
Expected: existing contract tests plus the new capability-health cases pass.

- [ ] **Step 5: Commit the contract-only change.**

Commit: `feat: add shared capability health contract`

---

### Task 2: Build the TypeScript capability registry and health projection

**Files:**
- Create: `mcp-server/src/capabilities/types.ts`
- Create: `mcp-server/src/capabilities/registry.ts`
- Create: `mcp-server/src/capabilities/health.ts`
- Modify: `mcp-server/src/adapters/settings-runtime.ts`
- Modify: `mcp-server/src/index.ts`
- Create: `mcp-server/src/capabilities/health.test.ts`
- Modify: `mcp-server/src/adapters/settings-runtime.test.ts`

**Interfaces:**

Implement a registry that accepts capability descriptors and returns deterministic health projections without executing user operations:

```ts
export interface CapabilityDescriptor {
  id: string;
  version: string;
  displayName: string;
  required: boolean;
  probe: (context: CapabilityProbeContext) => Promise<CapabilityHealth>;
}

export interface CapabilityRegistry {
  register(descriptor: CapabilityDescriptor): void;
  list(): readonly CapabilityDescriptor[];
  health(context: CapabilityProbeContext): Promise<readonly CapabilityHealth[]>;
}
```

- [ ] **Step 1: Implement pure normalization for probe results and deterministic ordering by capability ID.**

- [ ] **Step 2: Register existing filesystem, compiler, MemU, graph, and embedding capabilities without changing their execution behavior.**

- [ ] **Step 3: Project missing Python, missing scripts, invalid settings, and disabled adapters into `unavailable` or `disabled` states with remediation; do not throw from the health aggregation path.**

- [ ] **Step 4: Expose the health projection through the existing runtime/control-plane response path instead of adding a second settings source.**

- [ ] **Step 5: Add tests for optional-worker degradation, required-capability failure, disabled capability, invalid settings, and stable ordering.**

- [ ] **Step 6: Run the MCP typecheck and focused tests.**

Run: `cd mcp-server && npm run typecheck` and `npm run test:source -- src/capabilities/health.test.ts src/adapters/settings-runtime.test.ts`.
Expected: typecheck passes and health projection tests pass.

- [ ] **Step 7: Commit the capability registry.**

Commit: `feat: add TypeScript capability health registry`

---

### Task 3: Make Obsidian the first-run product surface

**Files:**
- Modify: `obsidian-plugin/src/main.ts`
- Modify: `obsidian-plugin/src/settings.ts`
- Modify: `obsidian-plugin/src/production-control-plane-host.ts`
- Modify: `obsidian-plugin/src/control-plane-client.ts`
- Modify: `obsidian-plugin/src/control-plane-ui.ts`
- Create: `obsidian-plugin/src/onboarding/onboarding-state.ts`
- Create: `obsidian-plugin/src/onboarding/onboarding-view.ts`
- Create: `obsidian-plugin/src/onboarding/onboarding-state.test.ts`
- Modify: `obsidian-plugin/tests/main-lifecycle.test.ts`
- Modify: `obsidian-plugin/tests/settings.test.ts`

**Interfaces:**

The plugin must expose one resumable first-run state machine:

```ts
type OnboardingStep =
  | "vault"
  | "project"
  | "capabilities"
  | "minimum-settings"
  | "first-search"
  | "complete";

interface OnboardingState {
  step: OnboardingStep;
  vaultPath?: string;
  projectId?: string;
  capabilityHealth: readonly CapabilityHealth[];
  nextAction: string;
}
```

- [ ] **Step 1: Add a pure onboarding-state reducer that maps missing binding, missing capability, incomplete settings, and successful first search to the next step and user action.**

- [ ] **Step 2: Add a Getting Started section to the plugin control plane showing vault binding, Project ID, capability health summary, and the next action.**

- [ ] **Step 3: Keep advanced settings behind the existing settings surface; do not duplicate Settings Platform definitions in the plugin.**

- [ ] **Step 4: Make capability failures actionable from the plugin with `open-settings`, `choose-path`, `install-dependency`, `retry`, or documentation actions.**

- [ ] **Step 5: Add the empty, loading, degraded, and complete states for the first-run flow.**

- [ ] **Step 6: Add tests for a fresh vault, missing optional Python worker, invalid required setting, and successful first search transition.**

- [ ] **Step 7: Run plugin typecheck and the focused onboarding/control-plane tests.**

Run: `cd obsidian-plugin && npm run typecheck` and the repository's focused Bun test command for the new onboarding tests.
Expected: the plugin compiles and the reducer/state tests cover every onboarding transition.

- [ ] **Step 8: Commit the Obsidian-first onboarding slice.**

Commit: `feat: add Obsidian-first onboarding state and capability health`

---

### Task 4: Consolidate setup behind a TypeScript headless entrypoint

**Files:**
- Create: `mcp-server/src/scripts/setup.ts`
- Create: `mcp-server/src/scripts/setup.test.ts`
- Modify: `mcp-server/package.json`
- Modify: `setup`
- Modify: `setup.ps1`
- Modify: `docs/GUIDE.md`
- Modify: `docs/INSTALL.md`

**Interfaces:**

The Node entrypoint owns the machine-readable setup contract:

```text
llmwiki setup --host <claude|codex|opencode|gemini> [--vault <path>]
llmwiki setup --list [--json]
llmwiki setup --doctor [--vault <path>] [--json]
llmwiki setup --dry-run ...
```

- [ ] **Step 1: Extract host definitions, bundle validation, vault binding, registration payload generation, and doctor checks into TypeScript functions.**

- [ ] **Step 2: Make `--list --json` return host IDs, skill root, MCP registration target, and support status.**

- [ ] **Step 3: Make `--doctor --json` return structured capability health and remediation rather than invoking `llmwiki_doctor.py` as the primary check.**

- [ ] **Step 4: Make setup write the supported host registration through the existing host-specific config boundary when permissions allow it; when it cannot write, return an exact actionable handoff instead of a generic paste block.**

- [ ] **Step 5: Keep `setup` and `setup.ps1` as thin launchers that forward arguments and exit codes to the Node entrypoint. They must not duplicate host lists, doctor logic, or Python invocation.**

- [ ] **Step 6: Retain Python doctor only as a compatibility capability check while the TS doctor covers product readiness. Label it as optional/legacy in output.**

- [ ] **Step 7: Add tests for host listing, unknown host, dry-run non-mutation, JSON doctor output, missing vault, and already-registered host configuration.**

- [ ] **Step 8: Update setup documentation so Obsidian is the normal entrypoint and CLI setup is explicitly headless/developer-oriented.**

- [ ] **Step 9: Run `node dist/scripts/setup.js --list --json`, the setup focused tests, and both shell launcher smoke commands.**

Expected: the same host list comes from one TypeScript source, `setup.ps1 -List` and `setup --list` agree, and ordinary setup no longer requires manual PowerShell/Python supplementation.

- [ ] **Step 10: Commit the setup consolidation.**

Commit: `feat: make setup a TypeScript-owned headless entrypoint`

---

### Task 5: Isolate Python workers behind the capability boundary

**Files:**
- Modify: `mcp-server/src/compile/compile-worker.ts`
- Modify: `mcp-server/src/compile-trigger.ts`
- Modify: `mcp-server/src/adapters/memu.ts`
- Modify: `mcp-server/src/agent/agent-runner-port.ts`
- Create: `mcp-server/src/capabilities/python-worker.ts`
- Create: `mcp-server/src/capabilities/python-worker.test.ts`
- Modify: affected existing compile, MemU, and agent runner tests

**Interfaces:**

Use one process boundary adapter for Python workers:

```ts
interface PythonWorkerRequest {
  capabilityId: string;
  executable: string;
  args: readonly string[];
  cwd?: string;
  timeoutMs: number;
  environment: NodeJS.ProcessEnv;
}

interface PythonWorkerResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
  timedOut: boolean;
  diagnosticCode?: string;
}
```

- [ ] **Step 1: Centralize `execFile` lifecycle, timeout, cancellation, environment handling, stderr redaction, and exit classification in `python-worker.ts`.**

- [ ] **Step 2: Refactor compiler, MemU, and legacy evaluate callers to use the worker adapter without changing their domain inputs or outputs.**

- [ ] **Step 3: Make missing Python, missing script, timeout, invalid output, and non-zero exit produce capability diagnostics instead of generic subprocess errors.**

- [ ] **Step 4: Ensure secrets remain in the environment or resolved settings boundary and never enter argv or diagnostic text.**

- [ ] **Step 5: Add tests for successful execution, missing executable, timeout, cancellation, invalid JSON/output, redacted environment values, and Windows path arguments.**

- [ ] **Step 6: Run compile-trigger, MemU, agent runner, and Python-worker focused tests plus MCP typecheck.**

- [ ] **Step 7: Commit the worker-boundary change.**

Commit: `refactor: isolate Python capabilities behind TypeScript worker boundary`

---

### Task 6: Reclassify Work-OS execution slices and resume feature work only after foundation exit

**Files:**
- Modify: `01-Projects/obsidian-llm-wiki/issues/ux-audit-findings.md`
- Modify: `01-Projects/obsidian-llm-wiki/issues/host-install-registration-wheel.md`
- Modify: `01-Projects/obsidian-llm-wiki/issues/plugin-migration-data-loss.md`
- Modify: `01-Projects/obsidian-llm-wiki/issues/plugin-main-ts-test-coverage.md`
- Modify: `01-Projects/obsidian-llm-wiki/issues/temporal-graph-index-search-accelerator.md`
- Modify: `01-Projects/obsidian-llm-wiki/issues/fleet-agent-discovery-transports.md`
- Modify: `01-Projects/obsidian-llm-wiki/issues/gitea-federation-adapter.md`
- Create: `tests/test_work_os_issue_contract.py`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`

**Interfaces:**

Each issue must state one product area and one foundation dependency, using the existing Work-OS frontmatter and body conventions. Do not invent a second issue tracker or a new project identity.

- [ ] **Step 1: Add the product-area and foundation-gate statements to the current issue bodies without changing their canonical IDs.**

- [ ] **Step 2: Keep core product issues executable during foundation; move Fleet, Gitea federation, and search accelerator work to deferred/later status unless a foundation dependency is explicitly cleared.**

- [ ] **Step 3: Update the roadmap and handoff after each foundation slice so the current branch, current milestone, and issue counts remain factual.**

- [ ] **Step 4: Add a deterministic issue-contract test and run it after issue edits.**

Run: `PYTHONUTF8=1 python -m pytest tests/test_work_os_issue_contract.py -q`.
Expected: every canonical issue has valid frontmatter, a canonical `entity`, a supported workflow state, and no issue is written under the retired `10-Projects/<project>/docket/**` path.

- [ ] **Step 5: Commit the project alignment changes.**

Commit: `docs: align Work-OS issues with product foundation milestones`

---

### Task 7: Foundation verification and release gate

**Files:**
- Modify: `docs/INSTALL.md`
- Modify: `docs/GUIDE.md`
- Modify: `30-Architecture/llm-wiki-product-spine.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Run MCP and plugin typechecks.**

Run: `cd mcp-server && npm run typecheck`; `cd obsidian-plugin && npm run typecheck`.

- [ ] **Step 2: Run focused contract, capability, onboarding, setup, compile, MemU, and worker tests.**

Expected: each changed contract has a behavior-level test, and optional capability failures are represented as health states rather than startup crashes.

- [ ] **Step 3: Run the actual first-run smoke path in Obsidian with a fixture vault.**

Verify: fresh vault → binding → health display → minimum configuration → first search/result/provenance.

- [ ] **Step 4: Run setup smoke paths on Windows and POSIX-compatible shell.**

Verify: `--list`, `--doctor`, `--dry-run`, and normal registration use the same TypeScript source of truth.

- [ ] **Step 5: Update the architecture and roadmap documents with the accepted foundation exit evidence.**

- [ ] **Step 6: Only after the foundation exit gate passes, reopen the Plugin 0.4.0 GA safety backlog and schedule deferred extension work.**

- [ ] **Step 7: Commit the foundation evidence and handoff.**

Commit: `docs: record LLM Wiki foundation exit evidence`

## Exit Criteria

The foundation is complete only when all of the following are true:

- A new user can enter through Obsidian without manual PowerShell/Python supplementation.
- The plugin explains vault binding, Project identity, capability availability, and the next action.
- MCP and CLI expose the same domain-owned state without owning the human lifecycle.
- Missing Python or optional adapters degrade into explicit health states with remediation.
- Setup shell wrappers contain no duplicated host list, doctor logic, or product decision logic.
- Work-OS issues and roadmap group work by product milestone and foundation gate.
- The first-run smoke path reaches a real search result with provenance.
- Only after these conditions pass may new adapters, Fleet work, Gitea federation, or other feature expansion resume.
