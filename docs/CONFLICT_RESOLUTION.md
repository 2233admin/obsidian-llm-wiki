# Conflict Resolution

Sync conflict files are not knowledge. They are merge work.

## Detect

```bash
python scripts/vault_collab_lint.py --vault /path/to/vault
```

The lint checks common conflict-copy names such as `sync-conflict` and
`conflicted copy`.

It also flags Obsidian/Git pollution such as `.obsidian/workspace*.json`,
`.trash/`, OS metadata files, and local LLMwiki runtime state.

## Resolve

1. Compare the conflict copy with the canonical note.
2. Move useful content into the canonical note.
3. Delete the conflict copy.
4. Commit through Gitea or GitHub.

Agents should not auto-resolve conflicts in protected shared docs.

## Prevent Dirty Commits

For a Gitea/GitHub-managed vault, install the hook once:

```bash
python scripts/install_vault_git_hook.py --vault /path/to/vault
```

The hook runs `vault_collab_lint.py` before every commit.
