# Project Routing

Project:
- `D:\projects\_active\obsidian-llm-wiki`

Project shape:
- story-first docs
- onboarding
- release and demo flow
- public-facing copy

Best MCP:
- `browser-bridge`
- `GitKraken`
- `codegraph`
- `documents` when writing structured artifacts

Best skills:
- `brooks-review`
- `ask`
- `browser-bridge`

Use only when relevant:
- `documents`
- `presentations`

Hooks emphasis:
- `UserPromptSubmit`: bias toward docs/demo/release workflows instead of code-heavy routing
- `PreToolUse`: protect release notes, version bumps, and publish commands
- `PostToolUse`: suggest demo-path verification after doc or release edits

Sub-agent policy:
- `explorer` for doc structure questions
- `worker` for isolated copy vs release-script changes

Recommended slash commands:
- `/browser-check`
- `/ship-note`
- `/review-env`

Avoid by default:
- security skills
- heavy quant skills
