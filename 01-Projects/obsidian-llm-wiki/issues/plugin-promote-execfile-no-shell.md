---
type: issue
entity: project/obsidian-llm-wiki/issue/plugin-promote-execfile-no-shell
state: canceled
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/plugin-promote-execfile-no-shell
description: "Promote plugin: replace exec string concat + hand-rolled quoting with execFile (shell injection / Windows quoting bug)"
status: active
priority: 1
blocked-by: []
last-verified: 2026-07-16
---

Promote plugin: replace `exec` + hand-rolled quoting with `execFile`

## RESOLVED 2026-07-16: already fixed upstream

GitHub main (plugin 0.3.0+, now 0.4.0-beta.1) already uses
`execFile` via `buildPythonInvocation` (`executable-command.ts`). The audited
0.1.0 on 5090 local was stale. Residual `.bat`/`.cmd` wrapper risk split out
to `plugin-python-path-batch-cmd`.

## Context

`obsidian-plugin/src/main.ts` `runPromote()` builds a command line by string
concatenation with a local `q()` that only escapes `"`. Escaping rules differ
between Windows cmd and POSIX shells:

- A vault filename containing backticks or `$()` can inject commands on POSIX.
- Paths with spaces + embedded quotes break quoting on Windows cmd.

`noteId` comes straight from `file.path`, i.e. attacker-influenced by any file
that lands in the vault (capture hook writes AI output into `00-Inbox/`).

## Fix

Use `execFile(pythonPath, [kbMetaPath, "promote", "--note", noteId, ...], {cwd, env})`
— no shell, whole quoting/injection class gone. Keep the stdout-recovery path
for exit-code-1 JSON errors.

## Acceptance

- No `exec(` with concatenated strings left in the plugin.
- Promote works with a note path containing spaces, quotes, CJK, backticks.
- ⚠️ Before touching: check whether the 5080 beta line (b0c447a, Settings
  Platform, evolved plugin) already restructured this file; fix on whichever
  line is canonical to avoid being clobbered by the beta merge.
