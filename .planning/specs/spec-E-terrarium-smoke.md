# spec-E: KT Terrarium Wiring + End-to-End Smoke

**Assigned worker:** creature `integrator` on MiniMax-M2.7-highspeed via KT
**Budget:** 60 min. Reject if exceeds 90 min.

## Goal

Produce the terrarium YAML that turns 6 personas into a coordinated team, plus an end-to-end smoke test that proves: paste install prompt -> Claude Code auto-install -> run /vault-librarian -> citation-backed answer. This is the piece that makes the "built with KT" dogfood story concrete.

## Input contract

- Read `/d/projects/KohakuTerrarium/kohaku-creatures/terrariums/swe_team/terrarium.yaml` as topology template
- Wait for spec-A completion -> read `.compile/specA-personas/creatures/<name>/config.yaml` x6
- Wait for spec-B completion -> read `.compile/specB-demo-vault/`
- Wait for spec-D completion -> read `.compile/specD-scaffold/setup`
- Read `/d/projects/obsidian-llm-wiki/.planning/REQUIREMENTS.md` S-01..04

## Output contract

```
.compile/specE-terrarium/
  terrariums/
    vault-wiki-team.yaml              # wires the 6 creatures together
  smoke/
    01-install-prompt.md              # the exact sentence user pastes into Claude Code
    02-expected-outputs.md            # what success looks like, step-by-step
    03-smoke-script.sh                # automated smoke (when possible) or manual checklist
    04-recording-notes.md             # what the GIF should capture (timings, frames)
  docs/
    KT_DOGFOOD.md                     # the meta-narrative: "this was built by a KT terrarium"
```

## vault-wiki-team.yaml topology

```
user_request -> root
root distributes:
  - queries / "what do I know about X" -> librarian
  - "clean up my vault" -> curator
  - "explain this note" -> teacher
  - "what was I thinking" -> historian
  - "compile graph" -> architect
  - "prune orphans" -> janitor

All creatures listen on `team_chat` broadcast for coordination.
Outputs flow back via `results` queue.
```

Use `kohaku-creatures/terrariums/swe_team/terrarium.yaml` structure. Swap `swe` + `reviewer` for our 6 creatures. Adapt channel names: `tasks`, `results`, `team_chat` stay; add `compile_request`, `graph_update` for architect <-> janitor coordination.

Controller for all 6 creatures + root MUST use:
```yaml
controller:
  model: MiniMax-M2.7-highspeed
  auth_mode: anthropic-key
  reasoning_effort: "${REASONING:medium}"
  tool_format: native
```

Token from env `${ANTHROPIC_AUTH_TOKEN}` + base URL from `${ANTHROPIC_BASE_URL}`. Neither appears in YAML literally.

## Smoke test (step-by-step)

`smoke/03-smoke-script.sh` must run this sequence end-to-end:

1. **Setup**: fresh temp dir, export MINIMAX_TOKEN env var (from caller shell)
2. **Install**: simulate paste of `01-install-prompt.md` -- run the exact bash it would produce
3. **MCP server up**: verify `node mcp-server/dist/index.js` launches against demo vault
4. **Terrarium up**: `kt terrarium run @vault-wiki/terrariums/vault-wiki-team` (or direct file path)
5. **Librarian query**: send to `tasks` channel: `"what do I know about attention heads"`
6. **Assert output on `results`**: response contains a citation to `attention-heads.md` (demo vault) within 60s
7. **Teardown**: `kt terrarium stop`, rm temp dir

If full automation not feasible on first pass, ship `03-smoke-script.sh` as a manual checklist with "run this command, expect this output" format. The MANUAL version is acceptable; the fake-pass version is NOT.

## KT_DOGFOOD.md requirements

Under 400 words. Must cover:
- Why KT (not just Claude Code slash commands): dual-host creature configs
- What the terrarium looks like (include a 10-line text diagram)
- Meta-claim: "This repo was authored by a 5-creature KT terrarium run over ~4 hours on 2026-04-20." (Honest, dated, reproducible.)
- 3 gotchas worth documenting for others trying this pattern

## Reject signals

- REJECT if terrarium.yaml is not parsed by `kt validate` (or equivalent lint -- worker tries it)
- REJECT if smoke script claims success without actually running the 7 steps (dry-run only is OK; fake-pass is NOT)
- REJECT if any creature controller references a token literal (must be env-var substitution)
- REJECT if KT_DOGFOOD.md contains the word "seamlessly" or "powerful" or "cutting-edge"
- REJECT if smoke test doesn't exercise at least 2 creatures (librarian minimum; ideally librarian + architect)
- REJECT if `docs/KT_DOGFOOD.md` is over 400 words

## Acceptance checklist

- [ ] `vault-wiki-team.yaml` validates structurally (required fields: `terrarium.name`, `terrarium.root`, `terrarium.creatures`, `terrarium.channels`)
- [ ] All 6 creatures listed + root, all use MiniMax-M2.7-highspeed controller
- [ ] No literal secrets in YAML (grep `sk-` -> zero matches)
- [ ] Channels: at least `tasks`, `results`, `team_chat` + 2 workflow-specific ones
- [ ] Smoke script runs to completion OR is a clearly labeled manual checklist
- [ ] KT_DOGFOOD.md under 400 words, zero buzzwords
- [ ] Install prompt is ONE sentence, paste-able into Claude Code

## Hard dependency ordering

- spec-A MUST finish before spec-E starts (E reads creature configs)
- spec-B finishing speeds up E (smoke needs demo vault) but E can ship a stub smoke + iterate later if B is late
- spec-D finishing speeds up E (smoke references setup script) but E can manual-mode if D is late

## Completion signal

```json
{"spec": "E", "status": "draft", "output_dir": ".compile/specE-terrarium/", "terrarium_valid": true, "smoke_mode": "automated|manual", "dogfood_words": 380, "self_check_passed": true}
```
