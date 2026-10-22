# Task 14 S06B — Obsidian Recovery Flow action

Date: 2026-08-29
Base: `df55fc77e3632b1a1df98f305283b2d1dfaecf43`
Commit: `fix: harden Obsidian Recovery Flow action`

## Verification

- Plugin suite: `npm test` — 93 passed, 0 failed.
- MCP source suite: `bun test src/` — 818 passed, 18 skipped, 0 failed.
- Focused Workflow/write-policy suite: 70 passed, 0 failed.
- Direct production bundle build, `npm run verify:bundle-boundary`, and `git diff --check` passed.
- TypeScript typecheck: plugin and MCP `npm run typecheck` both passed after the final owner-receipt and policy fixes.

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

## Review resolution

- Outcome-unknown now latches the panel against Plan refresh and all apply paths until Workflow doctor reconciliation; the regression test verifies no refresh request is sent.
- Apply planning input is normalized and bounded client-side; response actor identity is checked against the confirmation actor.
- Workflow recovery apply explicitly authorizes its own bounded owner paths. Resume join no longer forces `leased` when the durable run is already `running`; first and replay owner receipts include Work Item identity.

## Actual Obsidian verification

- In the sanitized `.gstack/qa-vault`, Open → Search (`recovery`) → exact Plan displayed all fingerprints and citations.
- Cancel returned to the Plan without invoking apply. Confirm and apply returned `applied`, rendered the sanitized owner receipt, and reopened `open` from current owner state.
- Final bundle reload started at `open` with no Plan, apply result, query, or transition token in the UI; plugin `data.json` remained limited to presentation and device binding.
- Failure-path behavior is covered by the plugin DOM tests, including expired Plan, malformed/forged responses, cancellation, focus/ARIA, and outcome-unknown replay blocking.

S06B is accepted. S07 MCP/CLI parity remains the next slice.
