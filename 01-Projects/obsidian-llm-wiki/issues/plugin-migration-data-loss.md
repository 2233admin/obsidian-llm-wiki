---
type: issue
entity: project/obsidian-llm-wiki/issue/plugin-migration-data-loss
state: done
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/plugin-migration-data-loss
description: "Plugin 0.4.0: legacy settings migration can permanently destroy unmigrated data and brick rollback (stripped doc saved early + digest-less preimage journal)"
status: active
priority: 1
blocked-by: []
last-verified: 2026-09-01
---

Plugin migration: transactional guarantee is broken (HIGH)

## Context (verified against GitHub main, plugin 0.4.0-beta.1)

Three linked defects in the legacy plugin-data migration:

1. `main.ts:76-78` — `onload()` assigns the already-STRIPPED
   `planPluginDataMigration` output to `this.data` unconditionally, before
   Settings Platform accepts anything. The guard comment ("Do not save the
   stripped document until Settings Platform accepts all assignments") only
   protects the failure branch inside `applyPluginDataPlan`; any OTHER
   `savePluginData()` in the same session (advanced-settings toggle
   `main.ts:372-377`, `setEditingScope` `main.ts:246-249`) persists the
   stripped doc and permanently destroys the unmigrated legacy fields.
2. `settings.ts:139-151` — `readLegacyPreimageJournal` never computes
   `assignmentDigest`, so plaintext-preimage markers upgrade into journal
   entries with `hadAssignment: true` but no digest; `verifyPreimage`
   (`settings.ts:356-358`) then rejects `rollbackPluginDataMigration`
   forever.
3. `settings.ts:218-222` — `leakedLegacyPreimage` forces `migrated: true`
   even with zero assignments, so the digest-less journal is silently
   persisted on the FIRST onload after upgrade (`main.ts:237-239` branch),
   no Notice.

`settings.test.ts:280-303` never asserts on `assignmentDigest` — zero
coverage on this path.

## Fix

- Do not finalize `this.data` to the stripped shape until migration has
  actually been accepted and persisted.
- Compute `assignmentDigest` at sanitization time (async path) so rollback
  stays possible.
- Notice when rollback capability is being dropped.
- Add the missing test asserting digest presence after legacy upgrade.

## Acceptance

- Kill Settings Platform mid-migration → toggle advanced settings → legacy
  fields still intact on next onload.
- Legacy plaintext-preimage vault upgrades → rollback still works.
- New regression test red on old code, green on fix.

## Verification evidence (Plugin 0.4.0 GA safety slice)

- Legacy plaintext preimage sanitization now computes and persists
  `assignmentDigest` asynchronously while omitting the plaintext assignment.
- Regression coverage first failed on the old behavior with 15 passing tests
  and the new rollback test failing because the digest was empty; after the
  fix the focused settings run passed 16/16.
- Pending migration save regression first failed with
  `legacyMigration.preimage` still present; after sanitization it passed and
  retained the retry-required legacy fields without the plaintext preimage.
- `obsidian-plugin/npm run typecheck` passed.
- `obsidian-plugin/npm run build` passed.
- Full plugin test suite passed 100/100.
- `git diff --check` passed.
- The existing rollback failure Notice remains the user-visible fallback; no
  new Notice was added because this slice restores the missing rollback
  capability without dropping it.
