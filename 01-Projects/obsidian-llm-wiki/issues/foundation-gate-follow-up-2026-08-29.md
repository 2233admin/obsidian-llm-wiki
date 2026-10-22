---
type: issue
entity: project/obsidian-llm-wiki/issue/foundation-gate-follow-up-2026-08-29
state: done
review: reviewed
kind: bug
id: obsidian-llm-wiki/foundation-gate-follow-up-2026-08-29
description: "Resolve pre-existing Foundation verification failures before exit"
status: active
priority: 1
blocked-by:
  - obsidian-llm-wiki/issue/p0-s08-recovery-loop-acceptance
last-verified: 2026-08-29
---

# Foundation gate follow-up

Product area: Foundation verification.

This follow-up recorded the pre-existing Foundation verification failures outside the Recovery Flow and onboarding changes. All three findings now have durable resolution evidence below.

## Resolved findings

- Root verification: `python -m pytest -q` — 282 passed, 1 skipped.
- Fleet verification: 17 passed, 0 failed with the configured-wrapper fallback (`PYTHON=python`); the wrapper fallback remains the recorded invocation because the configured `py.cmd` launcher is not used for this result.
- Session-archiver privacy: the machine-absolute-path finding is resolved; the release-security path check no longer reports `mcp-server/src/scripts/session-archiver.README.md` or `mcp-server/src/scripts/session-archiver.ts`.

## Exit evidence

This follow-up is complete. S08 remains in progress because its durable-store fixture-breadth item is still open; this resolution does not declare Foundation exit.

