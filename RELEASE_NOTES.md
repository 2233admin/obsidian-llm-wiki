# LLMwiki v2.2.0

**Reviewed team memory compiler.**

LLMwiki now focuses on one clear loop: scattered research and agent output
become compiled wiki, cited AI drafts, and reviewed team memory.

## What changed

- README and guides now tell the product story directly:
  `capture -> compile -> ask -> file -> review -> promote`.
- New five-minute demo path lets users verify the loop before connecting an
  agent host.
- Added collaborative vault governance docs, templates, and an example
  `examples/collab-vault`.
- Added report-only health and doctor tools for team vaults.
- Cleaned public branding to **LLMwiki**.

## Try it

```bash
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git
cd obsidian-llm-wiki
python compiler/compile.py examples/collab-vault/research-compiler --tier haiku --dry-run
python scripts/knowledge_health.py --vault examples/collab-vault --json
python scripts/llmwiki_doctor.py --vault examples/collab-vault --json
```

The dry-run compiler uses stub extraction, so it does not need an API key.

## Expected warning

`llmwiki_doctor.py` reports `git-missing` for `examples/collab-vault`. That is
expected: the demo vault is not its own Git worktree.
