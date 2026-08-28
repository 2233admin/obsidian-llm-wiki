# Task 14 S06B — Obsidian Recovery Flow action

Date: 2026-08-29
Base: `df55fc77e3632b1a1df98f305283b2d1dfaecf43`
Commit: `fix: harden Obsidian Recovery Flow action`

## RED → GREEN

- Full plugin suite is GREEN: 91 passed, 0 failed.
- `npm run typecheck -- --pretty false` and `npm run build` remain blocked only by the pre-existing missing `@electric-sql/pglite` and `@electric-sql/pglite/contrib/pg_trgm` modules imported by `mcp-server/src/adapters/vaultbrain/pglite-engine.ts`; the changed plugin files report no TypeScript diagnostics.
- Direct `node esbuild.config.mjs production` succeeds.
- `openspec validate project-hub-recovery-loop --strict --no-interactive` succeeds.
- `git diff --check` succeeds.

## Implementation

- Added the sole client mutation mapping, `workflow.recovery.apply`, with the complete V2 Plan, exact Plan fingerprint, normalized ephemeral `{ query, limit }`, and a deterministic `recovery-apply:<sha256>` token bound to operation, canonical Project, Plan fingerprint, and confirmation actor.
- Added an accessible inline exact-Plan confirmation/cancel step. Expired Plans cannot confirm or apply and retain explicit Refresh; no browser confirmation API is used.
- Added claimed/applied/outcome-unknown/unavailable rendering and the sanitized exact owner receipt. Outcome-unknown disables confirm/replay and provides Workflow doctor reconciliation text.
- On applied only, the panel clears ephemeral Flow/query/selection state and opens the current Project again from owner state; reload/open still resets to open.
- Exposed only `workflow.recovery.apply` in the Obsidian operation filter; no settings/data/vault persistence was added.
- Added a closed bounded client response contract: applied requires exact Plan/project/kind/Work Item/Work Run/token/receipt fingerprints, accepted owner identity, and bounded closed receipt fields; malformed, null, forged, or cross-Plan responses retain the visible Plan and cannot restart.
- Replaced raw receipt serialization with an allowlisted safe projection through existing presentation helpers; diagnostics are bounded, closed, and fail closed on unsafe/malformed values.
- Invalid or expired Plan timestamps are rejected at both confirmation and apply, with explicit Refresh retained.
- Confirmation/cancel/apply-error/outcome/restart focus targets are explicit and stable; implicit assertive alerts no longer carry a polite live-region override.
- Added hostile response, secret/path, diagnostics, invalid expiry, double activation, cancellation, focus, ARIA, and owner-restart DOM coverage.

## Privacy audit

- Raw transition tokens are created and sent only inside the immediate client request; they are not panel state, plugin data, settings, DOM attributes, logs, errors, or vault writes.
- Only the backend-provided token digest and sanitized owner receipt are rendered. Query remains the existing ephemeral S06A state and is sent only as bounded apply planning input.
- Plan/claim/receipt objects are held in ItemView memory only; after applied, the old Plan and query are discarded before owner-backed open.

## DOM states

- `planned`: full visible Plan fingerprints/facts, explicit `Refresh Plan`, and `Confirm exact Plan`.
- `confirming`: inline `role=group` confirmation with exact Plan fingerprint/Project, `Confirm and apply`, and `Cancel`.
- `claimed|applied|unavailable`: live bounded apply result and diagnostics; applied includes the exact sanitized owner receipt.
- `outcome-unknown`: alert remediation text; apply/replay controls are disabled and owner truth is not replaced.

## Manual QA / concerns

1. In desktop Obsidian, open a bound Project Hub and run Open → Search → Plan; verify the full Plan and fingerprints are visible.
2. Select Confirm exact Plan, inspect the inline step, then Cancel; verify no `workflow.recovery.apply` request or vault bytes change.
3. Confirm once; verify one apply call, claimed/applied receipt, and a fresh owner-backed Open stage. Activate Confirm/apply twice rapidly and verify one request.
4. Exercise an expired Plan and owner-stale/rebound/capability/lease/adapter failures; verify explicit Refresh or bounded unavailable/error state, never success.
5. Simulate outcome-unknown; verify Workflow doctor remediation and disabled retry. Reload/reopen and verify the panel starts at Open with no prior query/Plan/receipt.

Independent review and actual Obsidian verification remain pending by design; issue remains `in-progress`.
