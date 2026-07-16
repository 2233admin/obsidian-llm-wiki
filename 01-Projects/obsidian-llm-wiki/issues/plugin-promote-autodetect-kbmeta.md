---
type: issue
entity: project/obsidian-llm-wiki/issue/plugin-promote-autodetect-kbmeta
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/plugin-promote-autodetect-kbmeta
description: "Promote plugin: auto-detect kb_meta.py via .vault-mind/ binding instead of a hand-typed absolute path setting"
status: active
priority: 3
blocked-by: []
last-verified: 2026-07-16
---

Promote plugin: auto-detect kb_meta.py, keep manual path as override

## Context

Settings require hand-typing an absolute path to `compiler/kb_meta.py`.
The vault already carries machine-local bindings under `<vault>/.vault-mind/`
(9A Local Project Registry — gitignored, allowed to hold paths per §0 #9).
Host registration (setup.ps1) also knows where the repo lives.

## REWRITTEN 2026-07-16 against 0.4.0-beta.1

Mechanism changed upstream: paths now come from Settings Platform
(`effectiveValue("runtime.kb_meta.path")`, requires absolute path), not
plugin settings. Ticket becomes: seed the Settings Platform defaults from
the `.vault-mind/` host binding at first bind, so a registered host needs
zero hand-typed paths.

## Fix

- Resolution order inside Settings Platform defaulting: explicit assignment
  (if set) → `.vault-mind/` binding-derived default → clear error pointing
  at settings.
- Reuse the existing binding files; do NOT invent a third registration
  mechanism (same consolidation direction as the
  host-install-registration-wheel ticket).

## Acceptance

- Fresh install on a registered host: promote works with zero settings
  typed.
- Explicit setting still wins when present.
- Unresolvable → clear Notice, no crash.
