# Plugin GA Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the real `main.ts` lifecycle, registration, and Promote verification gaps needed for Plugin 0.4.0 GA without duplicating coverage that already exists.

**Architecture:** Keep migration ownership in `obsidian-plugin/src/main.ts` and preserve the existing `PluginDataMigrationPlan` and `preservePendingMigrationSource` boundaries. Extend the existing bundled Node test harness in `obsidian-plugin/tests/main-lifecycle.test.ts` and `obsidian-plugin/tests/promote-flow.test.ts`; do not introduce a second plugin runtime or test-only production seam. Update the Work-OS issue to describe current coverage and the remaining observable contracts.

**Tech Stack:** TypeScript strict mode, Obsidian plugin API, Node `node:test`, esbuild test bundling, npm scripts.

**Spec:** `01-Projects/obsidian-llm-wiki/issues/plugin-main-ts-test-coverage.md`; GA direction in `ROADMAP.md` lines 181-195.

## Global Constraints

- Preserve the existing dirty working tree; do not reset, clean, stash, stage, commit, push, fetch, or overwrite unrelated changes.
- Plugin data remains presentation preferences, device-local binding reference, and migration journal; no secrets or absolute machine paths enter shared vault content.
- Migration failure must preserve the original legacy document for a later retry.
- Migration rollback must use the device-local preimage and fail closed when it is unavailable.
- Use existing test harnesses and dependencies; add no new runtime dependency.
- Do not redesign the whole product IA or add adapters, Fleet features, or new MCP operations in this slice.

---

### Task 1: Rebaseline the coverage issue

**Files:**
- Modify: `01-Projects/obsidian-llm-wiki/issues/plugin-main-ts-test-coverage.md`
- Verify: repository Work-OS validation command discovered from `docket --help` if needed

**Interfaces:**
- Consumes: current tests in `obsidian-plugin/tests/main-lifecycle.test.ts` and `obsidian-plugin/tests/promote-flow.test.ts`.
- Produces: an issue description that distinguishes existing migration/Promote tests from remaining gaps.

- [ ] **Step 1: Replace the stale zero-coverage statement**

Change the context to state that lifecycle and Promote tests already exist. List the remaining contracts precisely: migration preimage-write failure, no-assignment save branch, activation registration, command/file-menu eligibility, unload cleanup, and any untested confirmation boundary.

- [ ] **Step 2: Update acceptance criteria**

Require observable branch coverage and a passing Plugin GA gate, not a blanket line-coverage percentage. Keep the data-loss regression requirement and name the exact test files.

- [ ] **Step 3: Validate the issue document**

Run the repository's `docket validate` command from the repository root. Expected: validation succeeds with no frontmatter or Work-OS errors.

---

### Task 2: Complete migration persistence coverage

**Files:**
- Modify: `obsidian-plugin/tests/main-lifecycle.test.ts`
- Inspect only as needed: `obsidian-plugin/src/main.ts:674-707`

**Interfaces:**
- Consumes: `MemoryAdapter`, `FailingTransport`, `TestPlugin`, `legacyStore`, `PREIMAGE_PATH`.
- Produces: deterministic tests for every migration save-order and retry branch in `applyPluginDataPlan()`.

- [ ] **Step 1: Add a preimage-write failure fixture**

Create a `MemoryAdapter` variant whose `write()` throws only for `PREIMAGE_PATH`. Start with a legacy store and an in-process settings transport, run `onload()`, and assert that migration still persists the stripped v2 document, the preimage is absent, and the rollback command is not offered as available. Do not require `migrationError`: the production path reports this condition through a Notice while keeping the migrated data applied.

- [ ] **Step 2: Add the no-assignment save branch test**

Start with a schema-v2 store that has no legacy assignments but needs a device binding or presentation update. Run `onload()` and assert one persisted v2 document with the changed field and no migration preimage file.

- [ ] **Step 3: Keep the existing retry and rollback tests as regression coverage**

Do not replace the existing tests at lines 105-191. Their assertions must continue to prove that a failed migration followed by a user save preserves `pythonPath` and `kbMetaPath`, and that a successful retry writes the preimage before stripping those fields.

- [ ] **Step 4: Run the focused migration tests**

Run from `obsidian-plugin`:

```bash
npm test
```

Expected: the bundled plugin suite passes, including the migration and rollback cases.

---

### Task 3: Complete activation and registration coverage

**Files:**
- Modify: `obsidian-plugin/tests/main-lifecycle.test.ts`
- Inspect only as needed: `obsidian-plugin/src/main.ts:149-304`
- Inspect only as needed: `obsidian-plugin/tests/obsidian-stub.ts`

**Interfaces:**
- Consumes: the existing `LLMWikiPlugin.onload()` registration path and the test-time Obsidian runtime stub.
- Produces: host-level assertions for registrations and cleanup without changing production registration behavior.

- [ ] **Step 1: Extend the fake App only with observable registration state**

Track registered views, commands, ribbon callbacks, file-menu callbacks, setting tabs, detached view types, and transport disposal in the existing test fixture. Keep the fake implementation in the test file or existing stub; do not add a production registry abstraction.

- [ ] **Step 2: Assert required registrations after `onload()`**

Assert that `llmwiki-ask-mate` is registered, the Open LLM Wiki ribbon and commands are present, the rollback command is present, and the file-menu handler adds the expected actions only for supported file types and bound Project context.

- [ ] **Step 3: Assert eligibility boundaries**

Exercise the `checkCallback` functions for Markdown, Canvas, no active file, and no Project binding. Verify that unsupported combinations return `false` and do not invoke activation callbacks.

- [ ] **Step 4: Assert unload cleanup**

Call `onunload()` and verify the Ask Mate view is detached and the injected transport is disposed once. The test must not inspect implementation-private timer details.

- [ ] **Step 5: Run the focused activation tests**

Run from `obsidian-plugin`:

```bash
npm test
```

Expected: registration and lifecycle assertions pass alongside all existing tests.

---

### Task 4: Complete Promote boundary coverage

**Files:**
- Existing coverage: `obsidian-plugin/tests/promote-flow.test.ts`
- Completed in Task 3: `obsidian-plugin/tests/main-lifecycle.test.ts`
- Inspect only as needed: `obsidian-plugin/src/main.ts:617-671`

**Interfaces:**
- Consumes: `PromoteTestPlugin`, `stubRunPromote`, existing `PromoteResult` fixtures, the `openPromoteConfirmation()` injection seam, and the activation command registry assertions from Task 3.
- Produces: coverage proving the exact dry-run/confirmation/apply boundary and user-visible failure behavior without duplicating an already-covered test.

- [ ] **Step 1: Reuse existing dry-run and apply coverage**

Keep the existing `promote-flow.test.ts` cases for dry-run outcomes, confirmation, one apply invocation, executable arguments, and success/failure feedback. Task 3's host-level registration case covers the command's Markdown-versus-Canvas eligibility boundary.

- [ ] **Step 2: Add only a remaining stable boundary**

If the current tests do not already prove it, capture the confirmation callback, invoke it once, and assert exactly one apply invocation. Do not assert private modal DOM or add a duplicate test when the existing case already proves the invariant.

- [ ] **Step 3: Run the full plugin test bundle**

Run from `obsidian-plugin`:

```bash
npm test
```

Expected: dry-run errors never apply, MATERIALIZED results require confirmation, apply occurs once, unsupported command inputs are unavailable, and failures remain explicit.

---

### Task 5: Run Plugin GA safety gates

**Files:**
- No additional source files; verify all changed files from Tasks 1-4

**Interfaces:**
- Consumes: the completed lifecycle, registration, and Promote tests.
- Produces: reproducible evidence for Plugin 0.4.0 GA safety readiness.

- [ ] **Step 1: Run the complete plugin test suite**

```bash
cd obsidian-plugin
npm test
```

Expected: zero failures and no skipped test introduced by this slice.

- [ ] **Step 2: Run strict type checking**

```bash
npm run typecheck
```

Expected: TypeScript exits zero.

- [ ] **Step 3: Build the production bundle**

```bash
npm run build
```

Expected: TypeScript and production esbuild complete successfully.

- [ ] **Step 4: Verify the bundle boundary**

```bash
npm run verify:bundle-boundary
```

Expected: generated bundle remains within the repository's packaging and dependency boundary.

- [ ] **Step 5: Inspect the final diff and status**

Confirm only the issue document, the two existing plugin test files, and any explicitly required test-stub changes changed. Confirm all pre-existing staged, unstaged, and untracked user work remains untouched.

---

## Plan self-review

- Existing migration and Promote tests are reused; the plan adds only uncovered observable contracts.
- No new runtime dependency, store, authority boundary, or production protocol is introduced.
- Every production behavioral claim is paired with a test or an existing test retained as regression coverage.
- The plan does not claim that Product IA convergence, Recovery evaluation expansion, Fleet federation, Gitea federation, or retrieval acceleration is complete; those remain later goal phases.
