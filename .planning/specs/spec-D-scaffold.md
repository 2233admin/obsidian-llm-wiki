# spec-D: Scaffold (setup script + cytoscape viewer + vercel)

**Assigned worker:** creature `builder` on MiniMax-M2.7-highspeed via KT
**Budget:** 90 min. Reject if exceeds 120 min.

## Goal

Produce the plumbing that turns 6 personas + 10 demo notes into a one-paste install and a hosted demo URL.

## Input contract

- Read `/d/projects/obsidian-llm-wiki/.planning/REQUIREMENTS.md` I-01..03, D-03..04
- Read `https://github.com/garrytan/gstack/blob/main/setup` (via `gh api`) for host-detection patterns
- Read `https://github.com/tone-row/flowchart-fun/blob/main/app/package.json` for cytoscape.js usage reference (but note: we build static, NOT React)
- Existing MCP server at `mcp-server/dist/index.js` (assume already built)

## Output contract

```
.compile/specD-scaffold/
  setup                          # bash shell script (POSIX + Git Bash on Windows)
  setup.ps1                      # optional PowerShell sibling (nice-to-have, not required)
  viewer/
    index.html                   # single-file static page
    viewer.js                    # cytoscape.js loader + paste handler (no bundler)
    viewer.css                   # minimal styling
    sample-graph.json            # fallback if demo vault graph.json missing
  vercel.json                    # static deploy config pointing to viewer/
  package.json                   # npm metadata if we go npm-publishable (nice-to-have)
```

## `setup` script requirements

- Shebang `#!/usr/bin/env bash`
- Works under: Git Bash (Windows), macOS, Linux
- Detects `--host <name>` flag: `claude` (default), `codex`, `opencode`, `gemini`
- Installs skill to the right dir:
  - `claude` -> `~/.claude/skills/vault-wiki/`
  - `codex` -> `~/.codex/skills/vault-wiki/`
  - `opencode` -> `~/.config/opencode/skills/vault-wiki/`
  - `gemini` -> `~/.gemini/skills/vault-wiki/`
- Prints to stdout (after success): a paste-able `.mcp.json` snippet + a paste-able CLAUDE.md section listing the 6 personas
- Never runs `sudo`
- Exit non-zero on any detection failure with clear error

## Viewer requirements (static, no build)

- Single `index.html` that loads cytoscape.js from CDN (no npm install for end user)
- Default loads `sample-graph.json` (shipped with viewer)
- "Paste your graph.json" textarea at top -- submit swaps the rendering
- Tag edges rendered with different color than wikilink edges (our `kind` field)
- Unresolved edges dashed
- Force-directed layout with `cytoscape-cose-bilkent` (known good for 500-node range)
- Counts visible: `nodes: N  edges: E  (wikilink: W / tag: T  unresolved: U)`
- Works without build step: open `index.html` in browser, it just works
- Mobile: responsive below 768px (not required to be pretty, must not break)

## Vercel config

- `vercel.json` points to `viewer/` as static output dir
- No serverless functions
- `vercel dev` starts viewer on :3000 (for local smoke)
- `vercel deploy --prod` produces the hosted URL

## Reject signals

- REJECT if `setup` uses non-POSIX bash (bashisms are fine for Git Bash / macOS / Linux, but `[[ ]]`, `==`, process substitution must work everywhere)
- REJECT if viewer requires npm install for end-user to view a graph
- REJECT if viewer bundles cytoscape -- MUST load from CDN (unpkg or jsdelivr)
- REJECT if CSS framework added (no tailwind, no bootstrap -- raw CSS under 200 lines)
- REJECT if `vercel.json` enables any function
- REJECT if setup.sh writes anything outside `~/.claude/`, `~/.codex/`, `~/.config/opencode/`, `~/.gemini/` without asking
- REJECT if setup script tries to npm install / pip install anything

## Acceptance checklist

- [ ] `setup` script runs cleanly with `bash setup --host claude --dry-run` (prints what it WOULD do, no side effects)
- [ ] `setup` handles `--host codex`, `--host opencode`, `--host gemini` (test each prints plausible target dir)
- [ ] `setup` fails cleanly if `~/.claude/` doesn't exist (prints actionable error, not stack trace)
- [ ] Viewer `index.html` opens standalone in Chrome/Firefox, renders sample graph
- [ ] Viewer paste-JSON flow: paste valid graph.json -> re-renders in under 1s
- [ ] Viewer renders at least nodes + edges visibly distinct for 500-node graph
- [ ] `vercel.json` validates (`vercel dev` starts without error)
- [ ] Zero npm deps required for end-user to view (worker verifies: `grep -i 'require\|import' viewer/*.js` -- any match must be from CDN URL string)

## Known risk

- Cytoscape + cose-bilkent from CDN. If CDN is slow, paste-flow feels laggy. Acceptable for demo; document in README.

## Completion signal

```json
{"spec": "D", "status": "draft", "output_dir": ".compile/specD-scaffold/", "setup_hosts_tested": ["claude","codex","opencode","gemini"], "viewer_opens_standalone": true, "vercel_config_valid": true, "self_check_passed": true}
```
