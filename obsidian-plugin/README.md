# vault-mind Promote (Obsidian plugin) — Task 10C-C

Promote a vault-mind **draft candidate** into a materialized reviewed snapshot
from inside Obsidian — a command or a right-click on the note. The gesture is a
thin UI shell over `kb_meta promote`; it never bypasses the work-OS base-head
lock and never auto-commits (the real promote stays the git review gate).

## What it does

1. On the active note (or a right-clicked `.md`), runs `kb_meta promote --note
   <path>` **dry-run** and shows the materialized snapshot **plan** in a modal.
2. On confirm, runs `--apply`, which appends the reviewed snapshot (append-only;
   never edits the head or the candidate). HEAD_MISMATCH / non-draft are reported,
   not forced.
3. Shows a notice: review the new snapshot and **commit via git** yourself.

Approach C (per `TASK10C-DRAFT-promote-gesture.md`): stable Obsidian APIs only
(`addCommand` + the `file-menu` event), **not** the unstable Canvas node API.
Pair it with `kb_meta work triage-canvas` to see the candidates as a map, then
open a node's note and promote it here.

## Build

```bash
cd obsidian-plugin
npm install
npm run build      # tsc typecheck + esbuild -> main.js
```

## Install (desktop only — it shells out to Python)

Copy `manifest.json`, `main.js`, `styles.css` into:

```
<your-vault>/.obsidian/plugins/vault-mind-promote/
```

Then enable **vault-mind Promote** in Obsidian → Settings → Community plugins,
and set:

- **Python path** — the interpreter that runs kb_meta (e.g. `python`).
- **kb_meta.py path** — absolute path to vault-mind's `compiler/kb_meta.py`.

## Notes

- `isDesktopOnly: true` — uses Node `child_process`; no mobile.
- Promote runs with `cwd` = the vault root and `PYTHONUTF8=1`.
- The note's vault-relative path is its `note_id`; the candidate must be a draft
  (`status: draft` / `review: draft`) carrying an `entity`.
- Future (deferred): an optional auto-commit-to-PR-branch setting; the current
  version deliberately leaves git to you.
