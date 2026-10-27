---
name: doctor
description: Check that LLM Wiki is set up on this machine and get a new vault ready to use
---

Check that LLM Wiki works here, fix what can be fixed, and tell the user what to try first. Run this after installing, or whenever something seems off.

Steps:
1. Call `context.vault_status`.
   - If the LLM Wiki tools are missing or fail with "No vault found", stop and tell the user: start the agent inside their Obsidian vault (any folder containing `.obsidian/`), or set the vault path. In Claude Code that is `/plugin configure llmwiki@obsidian-llm-wiki`; other hosts set `VAULT_MIND_VAULT_PATH` on the `vault-mind` MCP server. Then restart the agent.
2. Call `settings.doctor`. Report only what blocks something the user might use:
   - `vault.filesystem` not available: the vault path is wrong.
   - `runtime.python` not available: compile and promote need Python 3.11+. Give the install command for their platform.
   - `runtime.kb_meta` not available: compile and promote need the compiler. It ships with the Claude Code plugin; elsewhere point `LLMWIKI_COMPILER_PATH` at `compiler/` in the plugin checkout.
   - Skip anything reported as intentionally disabled; those are optional providers.
3. If `context.vault_status` says the vault is empty, offer to create a starter layout. Call `vault.init` with `methodology: "generic"` and `dryRun: true`, show the folders it would create, and run it again with `dryRun: false` only after the user agrees.
4. If semantic recall is off, say in one line that keyword recall already works and that `ollama pull bge-m3` (or any OpenAI-compatible embedding endpoint) turns on semantic recall.

Report: one line per check as ✓ or ✗ with the fix, then three things to try in this vault, for example `/llmwiki:vault-librarian what do I know about <a topic from their notes>`.
