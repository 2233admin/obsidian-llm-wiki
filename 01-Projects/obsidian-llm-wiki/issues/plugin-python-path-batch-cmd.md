---
type: issue
entity: project/obsidian-llm-wiki/issue/plugin-python-path-batch-cmd
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/plugin-python-path-batch-cmd
description: "Plugin 0.4.0: runtime.python.path accepting .bat/.cmd reintroduces cmd.exe parsing (injection on old Electron, EINVAL crash on new) — validator must reject script wrappers"
status: active
priority: 2
blocked-by: []
last-verified: 2026-07-16
---

Plugin: reject .bat/.cmd/.ps1 for runtime.python.path

## Context (verified against GitHub main, plugin 0.4.0-beta.1)

`executable-command.ts` `buildPythonInvocation` + `main.ts:187-192` use
`execFile` without `shell: true` — correct for native executables. But on
Windows, spawning a `.bat`/`.cmd` target routes through cmd.exe:

- Node with the CVE-2024-27980 fix (modern Electron/Obsidian): `execFile`
  throws EINVAL → promote hard-fails with an opaque error.
- Older Node/Electron: cmd.exe metacharacter parsing applies to every arg,
  including `noteId` (= `file.path`, arbitrary vault filenames with
  `&|^%"` — attacker-influenced in shared/synced vaults) → command
  injection.

pyenv-win shims (`python.bat`) and some venv/uv wrappers are exactly this
shape, so users WILL configure it. Nothing validates the setting today.

Either failure mode is bad; the validator should refuse script wrappers up
front with a clear message.

## Fix

- Settings validator for `runtime.python.path` (and any future executable
  setting): reject `.bat`/`.cmd`/`.ps1`, message pointing at the underlying
  `python.exe`/`uv.exe`.
- Same check at invocation time as backstop (setting may predate the
  validator).

## Acceptance

- Configuring `python.bat` → immediate clear validation error, not a
  promote-time mystery.
- Native `.exe` paths unaffected.
- Test covering the rejection.
