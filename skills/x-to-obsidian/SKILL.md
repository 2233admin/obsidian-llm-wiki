---
name: x-to-obsidian
description: Capture high-signal X/Twitter posts into an Obsidian vault through the official Obsidian Web Clipper, then let LLM Wiki search, review, and promote the saved notes.
---

# X to Obsidian capture

Use this skill when the user wants to collect X/Twitter posts into the same Obsidian vault that LLM Wiki indexes.

This workflow is adapted for LLM Wiki from `hemoouren/X-to-Obsidian-SKill`. Keep the upstream boundary intact:

- Do not handcraft tweet Markdown as a substitute for saving.
- Do use the official Obsidian Web Clipper for the final save.
- Do not claim completion unless the note exists in the vault.
- Stop with a clear blocker if macOS, a supported browser session, Obsidian, or Web Clipper is missing.

## What this adds to LLM Wiki

The capture step is outside the MCP server. After Web Clipper writes the note, LLM Wiki can use normal tools such as `vault.search`, `query.unified`, `vault.searchByFrontmatter`, `memory.handoff.write`, and `vault.writeAIOutput` to index, find, summarize, and review the imported material.

Recommended target paths:

- `X/Inbox/` for raw clipped posts.
- `00-Inbox/AI-Output/<actor>/` for agent-authored summaries about the clipped posts.
- `20-Decisions/`, `30-Architecture/`, or `40-Runbooks/` only after human review.

## Preconditions

- macOS.
- Chrome, Dia, Edge, or another browser supported by the bundled script.
- Logged-in X/Twitter session in that browser.
- Obsidian running with the official Web Clipper extension configured for the target vault.
- Network access to X/Twitter.

If any precondition is missing, explain the missing dependency and do not fake the capture.

## Bundled script

The script is bundled relative to this skill:

```bash
python3 scripts/x_to_obsidian.py --help
```

Installed host paths usually look like:

```text
~/.claude/skills/x-to-obsidian/scripts/x_to_obsidian.py
~/.codex/skills/x-to-obsidian/scripts/x_to_obsidian.py
~/.config/opencode/skills/x-to-obsidian/scripts/x_to_obsidian.py
~/.gemini/skills/x-to-obsidian/scripts/x_to_obsidian.py
```

Use the script's own `--help` output as the source of truth for supported flags.

## Operating procedure

1. Confirm the user provided a target X URL, account, search page, or query.
2. Run the script in dry-run / preview mode when available, especially for broad collection requests.
3. Filter for the user's quality threshold, such as minimum views or maximum number of posts.
4. Save through Obsidian Web Clipper only.
5. Use LLM Wiki MCP search to confirm the clipped note can be found in the vault.
6. Optionally write `memory.handoff.write` with what was clipped, where it landed, and what remains to review.

## Good prompts

```text
/x-to-obsidian save the top 20 posts from this X search into my vault
/x-to-obsidian collect posts above 100k views from this account and leave a handoff
/x-to-obsidian clip this thread, then summarize it into AI-Output for review
```

## Safety and quality rules

- Respect platform access limits and user account boundaries.
- Do not bypass login, paywalls, deleted content, or private accounts.
- Do not store credentials in the vault or in command history.
- Prefer fewer high-signal posts over bulk clipping.
- Preserve source URLs and visible metadata so later LLM Wiki answers can cite the saved note.
