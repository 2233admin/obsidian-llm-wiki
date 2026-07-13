# X/Twitter to Obsidian capture

LLM Wiki supports the `X-to-Obsidian-SKill` workflow as an optional installed skill: `x-to-obsidian`.

The workflow captures high-signal X/Twitter posts through the official Obsidian Web Clipper, then lets LLM Wiki index and govern the saved Markdown like any other vault note.

## Boundary

This is not an MCP-server scraper. Browser automation, logged-in X access, and Web Clipper control stay in the skill layer. The MCP server remains the vault search, memory, review, and governance surface.

## Requirements

- macOS.
- A supported browser, usually Chrome, Dia, or Edge.
- The browser is logged into X/Twitter.
- Obsidian is running.
- The official Obsidian Web Clipper extension is installed and configured for the target vault.
- LLM Wiki is installed with `./setup` or `.\setup.ps1`, which registers `x-to-obsidian` alongside the vault skills.

## Install

Run the normal LLM Wiki setup:

```bash
./setup --host claude
./setup --host codex
./setup --host opencode
./setup --host gemini
```

Windows PowerShell:

```powershell
.\setup.ps1 -VaultHost codex
```

The installed script lives under the host skill directory:

```text
~/.claude/skills/x-to-obsidian/scripts/x_to_obsidian.py
~/.codex/skills/x-to-obsidian/scripts/x_to_obsidian.py
~/.config/opencode/skills/x-to-obsidian/scripts/x_to_obsidian.py
~/.gemini/skills/x-to-obsidian/scripts/x_to_obsidian.py
```

Use the script help for current flags:

```bash
python3 ~/.claude/skills/x-to-obsidian/scripts/x_to_obsidian.py --help
```

## Recommended vault flow

1. Clip raw X posts into `X/Inbox/` or your existing source folder.
2. Use `query.unified` or `vault.search` to confirm the clipped note is visible.
3. Write analysis or synthesis into `00-Inbox/AI-Output/<actor>/`.
4. Promote durable conclusions into reviewed folders such as `20-Decisions/`, `30-Architecture/`, or `40-Runbooks/`.
5. Use `memory.handoff.write` when the capture run should be continued by another agent later.

## Example prompts

```text
/x-to-obsidian collect the top 20 posts from this X search and save them to Obsidian
/x-to-obsidian save posts above 100k views from this account, then leave a handoff
/x-to-obsidian clip this thread and file a reviewed summary candidate into AI-Output
```

## Notes

- The skill should not handcraft tweet Markdown instead of using Web Clipper.
- The skill should stop with a blocker if browser login, Obsidian, or Web Clipper is unavailable.
- LLM Wiki can search the captured notes immediately after they land in the vault.
- Source inspiration: `https://github.com/hemoouren/X-to-Obsidian-SKill`.
