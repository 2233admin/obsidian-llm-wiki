# session-archiver

CLI that archives local Claude Code and Codex sessions into a vault as
Work-OS issue notes. It reads from three session sources:

1. `~/.claude/history.jsonl` — prompt history entries
2. `~/.claude/projects/**/*.jsonl` — per-project transcript files
3. `~/.codex/session_index.jsonl` — Codex session index

Each new session is written to
`01-Projects/<project-slug>/sessions/<YYYY-MM-DD>-<id-prefix>.md` with
the Work-OS frontmatter so it shows up on the project board. The
project slug is derived from the session's reported project (path tail,
history entry, etc.) and falls back to `inbox` when ambiguous.

## Usage

```bash
npm run rebuild                            # tsc + esbuild bundle once
node session-archiver.js --vault /path/to/vault           # real write
node session-archiver.js --vault PATH --dry-run           # preview only
node session-archiver.js --vault PATH -v                  # verbose
```

`VAULT_MIND_VAULT_PATH` (or `VAULT_BRIDGE_VAULT`) may be set instead
of `--vault`.

## Path layout

```
<vault>/01-Projects/<project-slug>/sessions/<YYYY-MM-DD>-<id-prefix>.md
```

`_project.md` is created under each affected project on first write
so the directory has the canonical Work-OS project anchor. The
`inbox/` project is created when session.project is empty / unsafe.

## Privacy / redaction

Before any vault write, every prompt is run through a conservative
redaction pass:

- Bearer / API key / token assignments (`api_key=...`, `bearer ...`)
- Vendor key shapes (`sk-ant-…`, `sk-or-…`, `ghp_…`, `xox?-…`)
- Provider env-style assignments (`ANTHROPIC_API_KEY=…`)
- Absolute paths under Windows user profiles and Unix home directories

Matches are replaced with `<REDACTED>`. False positives are accepted
as the safer failure mode.

## State

The archiver keeps its sync state at
`~/.vault-mind/session-archiver/state.json`. This file is **machine-local**
and is **not** checked in. It records last-sync timestamp, per-source
counters, and the set of session IDs already archived so re-runs are
idempotent.

To force a re-archive after the local state has grown stale, edit or
delete the state file directly.

## Out of scope

The original header mentioned a fourth source
(`~/.claude-mem/claude-mem.db`). The current implementation does not
read it. Wiring it in requires a SQLite client (`better-sqlite3` or
`node:sqlite` on Node ≥ 22.5) and is tracked as a follow-up. The
field is left on `SyncState` so stats continue to be readable when
the source is added later.

## Build pipeline

```
mcp-server/src/scripts/session-archiver.ts
  → tsc → dist/scripts/session-archiver.js
  → esbuild → mcp-server/session-archiver.js   (committed bin)
```

`npm run rebuild` runs both stages. The committed bundle
(`mcp-server/session-archiver.js`) is regenerated; it is **not** source
of truth. The `.ts` file is.
