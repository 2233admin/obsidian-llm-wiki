# spec-C: README rewrite + WHY_NOT_JUST_GREP.md

**Assigned worker:** creature `copywriter` on MiniMax-M2.7-highspeed via KT
**Budget:** 60 min. Reject if exceeds 90 min.

## Goal

Rewrite `README.md` and write `docs/WHY_NOT_JUST_GREP.md`. Target: a Claude Code user lands on README, sees GIF + 1-sentence value prop, pastes install prompt, trying `/vault-librarian` inside 3 minutes.

## Input contract

- Read current `/d/projects/obsidian-llm-wiki/README.md`
- Read `https://github.com/garrytan/gstack` README (use `gh repo view garrytan/gstack`)
- Read `https://github.com/heygen-com/hyperframes` README
- Read `https://github.com/tone-row/flowchart-fun` README
- Read `.planning/REQUIREMENTS.md` R-01..06

## Output contract

```
.compile/specC-readme/
  README.md                      # new top-level README (replaces existing)
  docs/WHY_NOT_JUST_GREP.md     # meta-defense doc
  docs/INSTALL.md                # moved-out detailed install (keep readme short)
  docs/gif-script.md             # 10-second GIF scenario (for recording later)
```

## README.md structure (fixed, non-negotiable)

```
<logo or title>

<tagline: one sentence under 15 words>

<GIF placeholder: ![demo](docs/gif/demo.gif)>

<3-line "why" paragraph: the pain, not the feature>

## Quick start (30 seconds)

<paste-to-Claude-Code install prompt, ONE backtick block>

## Who this is for

- <persona 1>
- <persona 2>
- <persona 3>

## Try it: example prompts

<4 example prompts, mirror gstack format: cold / warm / specific / iterate>

## 6 personas

<table: name | what it does | primary MCP tools>

## How it works (30-second tour)

<2 paragraphs: your markdown -> MCP tools + concept graph -> any agent reads it>

## Install (if quick-start didn't work)

<link to docs/INSTALL.md>

## Open questions / honest limits

<3 bullets: things it does NOT do>

## License

MIT. Fork it. Improve it. Make it yours.
```

## Voice constraints

- Tagline: 1 sentence, < 15 words, must include either "vault" OR "markdown" + "agent"
- No em-dashes glued together ("---" as visual divider, never "--" inside prose)
- No emoji
- No "we" -- say "it" for the tool
- Every claim over 20% growth/productivity requires citation OR a deliberate "informal estimate:" prefix
- Imperative mood for CTAs

## Tagline candidates (pick 1, or propose 2-3 for HMS review)

- "Your markdown vault, compiled into a 6-persona team for any agent."
- "Markdown in. Concept graph + MCP server out. Your agent reads your notes."
- "Turn your vault into slash commands for Claude Code, Codex, OpenCode, Gemini."

## WHY_NOT_JUST_GREP.md outline (non-negotiable)

Address these objections in order, each with 1-3 sentences + a concrete example:
1. "Grep finds substrings; this finds **concepts** -- [[wikilinks]] + aliases + frontmatter tags resolve semantically."
2. "Grep is stateless; this is **compiled** -- 554 notes -> 2507 edges in 3 seconds, reused across queries."
3. "Grep outputs text; this outputs **MCP tools** -- Claude Code calls vault.search, vault.backlinks, vault.graph directly."
4. "Grep is for you; this is for **your agent** -- 6 personas wrap the MCP tools so Claude/Codex know what to ask for."

Length cap: 500 words total.

## Reject signals

- REJECT if README top (before first "##") exceeds 40 lines
- REJECT if tagline > 15 words
- REJECT if quickstart is not a single paste-to-Claude-Code sentence (must mirror gstack: one backtick block, one prompt)
- REJECT if any mention of "vector embeddings", "semantic search", "AI-powered" (buzzword flags)
- REJECT if "enterprise" appears anywhere
- REJECT if emoji count > 0
- REJECT if WHY_NOT_JUST_GREP.md doesn't address all 4 objections or exceeds 500 words

## Inputs you need from other specs

- spec-A persona list (6 names + taglines) -- worker reads `.compile/specA-personas/README.md` if available, else uses REQUIREMENTS.md P-01..06 names directly
- spec-B demo vault structure (for "Try it: example prompts" section) -- read `.compile/specB-demo-vault/` if available

If A or B not done yet, write R-05 (WHY_NOT_JUST_GREP.md) first, README last.

## Acceptance checklist

- [ ] 4 files under `.compile/specC-readme/`
- [ ] README top-of-fold under 40 lines
- [ ] Tagline picked + 2 alternates listed for HMS review
- [ ] 4 example prompts mirror gstack cold/warm/specific/iterate structure
- [ ] WHY_NOT_JUST_GREP.md addresses 4 objections, under 500 words
- [ ] No buzzwords (ctrl-F list above all return zero)
- [ ] MIT license mention included

## Completion signal

```json
{"spec": "C", "status": "draft", "output_dir": ".compile/specC-readme/", "tagline_picked": "...", "readme_above_fold_lines": 38, "self_check_passed": true}
```
