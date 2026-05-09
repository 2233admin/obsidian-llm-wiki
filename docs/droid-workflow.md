# Droid CLI Workflow

How to drive this repo with the Factory droid CLI in non-interactive mode.

## Prerequisites

- Install the CLI: `irm https://app.factory.ai/cli/windows | iex`
  (PowerShell remote install; see Factory docs for macOS/Linux variants).
- Set the API key in your shell:
  - bash/zsh: `export FACTORY_API_KEY=fk_...`
  - PowerShell: `$env:FACTORY_API_KEY = "fk_..."`
- Confirm Node 20+, Python 3.11+, and ripgrep are on PATH (see CLAUDE.md).
- Run from the repo root or pass `--cwd` to point at a worktree.

Never commit the key. Keep it in `.env.local` or your OS keychain only.

## Read-only survey (no writes)

Use a tightly scoped task to map the MCP server without touching files:

```
droid exec --cwd D:/projects/obsidian-llm-wiki-droid-wt \
  --output-format json \
  'List every vault.* tool registered in mcp-server/src and report the
   file and line for each registration. Do not edit any file.'
```

This runs in default approval mode, so any write would prompt and be
blocked under `exec`. The JSON envelope contains `result` (string),
`session_id` (string), `usage` (object with `input_tokens`,
`output_tokens`, `cache_read`, `cache_creation`), `is_error` (bool),
`duration_ms` (number), and `num_turns` (number).

## Low-risk auto write task

For a small, reversible edit, opt into `--auto low`:

```
droid exec --cwd D:/projects/obsidian-llm-wiki-droid-wt \
  --auto low \
  --output-format json \
  'In compiler/kb_meta.py, fix typos in docstrings only. Do not change
   behavior. Run python -m pyflakes compiler/kb_meta.py before exit.'
```

`--auto low` permits non-destructive edits and benign shell calls but
still refuses network installs, deletions, and pushes.

## Worktree mode keeps main clean

`-w` (or `--worktree`) creates an isolated git worktree and runs the
task there:

```
droid exec -w \
  --cwd D:/projects/obsidian-llm-wiki-droid-wt \
  --auto low \
  'Add a failing pytest for compiler/chunker edge cases.'
```

The worktree directory defaults to a sibling path next to the repo and
can be overridden with `--worktree-dir <path>`. `main` and your current
branch stay untouched. Inspect the worktree with `git -C <wt> diff`,
then cherry-pick or discard. Drop it with `git worktree remove <wt>`.

## Parsing JSON and resuming with -s

Pipe `--output-format json` through `jq` to capture the session id:

```
SID=$(droid exec --output-format json 'survey mcp-server/src' \
      | jq -r '.session_id')
droid exec -s "$SID" --output-format json \
  'Now list every compile.* tool and reuse the prior survey context.'
```

`-s <session_id>` resumes the same conversation, so the second turn
keeps prior tool results and saves tokens. On Windows PowerShell use
`$SID = (droid exec ... | ConvertFrom-Json).session_id`.
