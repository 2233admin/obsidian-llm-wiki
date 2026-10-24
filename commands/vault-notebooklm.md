---
name: vault-notebooklm
description: Push vault notes to NotebookLM, ask cited questions, generate reports (experimental)
---

Bridge the vault and Google NotebookLM via the notebooklm-py collector.

Usage: /vault-notebooklm push|ask|report [args]

Steps:
1. Resolve the vault path (env VAULT_MIND_VAULT_PATH, vault-mind.yaml, or cwd) and locate `recipes/collectors/notebooklm-collector.py` (repo or plugin install dir)
2. Parse intent:
   - **push**: user names notes, a folder, or a topic. Use `vault.search`/`vault.list` to resolve to concrete .md paths (confirm the list with the user if >10 files). Pick a notebook title from the user's words or default to the topic name
   - **ask**: user gives a question and (optionally) a notebook name. If no notebook named, list notebooks via `notebooklm list --json` and pick the obvious one or ask
   - **report**: user names a notebook and optionally a format (briefing-doc | study-guide | blog-post)
3. Run the collector via Bash:
   `python recipes/collectors/notebooklm-collector.py <cmd> --vault <vault> --notebook <title> [args]`
4. Handle the JSON result:
   - exit 2 -> tell the user to run `notebooklm login` once, stop
   - error mentioning RPC/schema -> warn that Google may have changed the undocumented API; suggest `pip install -U notebooklm-py`
   - ok push -> report notebook + per-file source status
   - ok ask -> `vault.read` the created note, give the answer inline plus the note path
   - ok report -> report the saved path; offer /vault-synthesize on it
5. For ask results: if citations map to vault notes you pushed (source title == file stem), add wikilinks to those notes in the saved answer via `vault.append`

Report: action taken, notebook used, vault paths created, citation count.
