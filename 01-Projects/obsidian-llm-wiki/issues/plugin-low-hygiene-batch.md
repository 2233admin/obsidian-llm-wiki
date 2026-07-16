---
type: issue
entity: project/obsidian-llm-wiki/issue/plugin-low-hygiene-batch
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/plugin-low-hygiene-batch
description: "Plugin 0.4.0 LOW batch: secret-locator UI silent discard / execFile timeout+maxBuffer+apply Notice / argv backslash parsing / settings-platform dependency hygiene"
status: active
priority: 3
blocked-by: []
last-verified: 2026-07-16
---

Plugin: four LOW hygiene fixes (one PR)

## Items (all verified against GitHub main, plugin 0.4.0-beta.1)

1. **Secret-reference field silently discards provider-only changes**
   (`main.ts:469-490`): input shows only a placeholder, never the existing
   locator; `if (!locator) return;` drops a provider switch without Notice.
   Fix: populate the field with the existing locator (it's a reference, not
   the secret) or Notice on discard.
2. **execFile has no timeout/maxBuffer; apply phase has no feedback**
   (`main.ts:176-219`): hung kb_meta hangs forever; >1MiB plan truncates →
   JSON.parse fails generically; "computing promote plan…" Notice only
   before dry-run, nothing during `--apply`. Fix: timeout + raised
   maxBuffer + apply-phase Notice.
3. **`parseExecutableCommand` backslash rule is naive**
   (`executable-command.ts:16-46`): 1-char lookahead instead of
   CommandLineToArgvW run-length counting; paths with `\\` before a closing
   quote misparse. Fix: standard run-length algorithm + table test.
4. **settings-platform coupling via raw relative paths**
   (`settings-client.ts` imports `../../packages/settings-platform/src/types`,
   `settings-host.ts` imports `.../dist/src/index.js`; package.json declares
   no dependency): skipped/stale `platforms:build` → typecheck against fresh
   src, runtime from stale dist. Fix: explicit workspace dependency, one
   resolved entry point.

## Acceptance

- Each item has its own small test where testable (2, 3) or manual QA note
  (1); build fails loudly when settings-platform dist is stale (4).
