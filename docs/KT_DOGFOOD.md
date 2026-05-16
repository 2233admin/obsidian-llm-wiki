# Built with KohakuTerrarium

> Historical build note. This is provenance for an early implementation run, not current product positioning. Current positioning is the Team Research Memory Compiler loop in `docs/RESEARCH_COMPILER_LOOP.md`.

This repository was initially authored by a KT multi-agent run over ~4 hours on 2026-04-20.

## Why KT?

Claude Code slash commands are fine for single-agent tasks. But this project needed distinct knowledge-work roles—librarian, architect, curator, teacher, historian, janitor—each with different skills and responsibilities. Slash commands can't coordinate that.

KT solved this with dual-host role configs. Each role ran as its own agent, configured independently, communicating via typed channels. The root agent routed requests; role workers handled execution. This is historical implementation provenance, not the product architecture.

## What the Terrarium Looks Like

```
user_request
    |
    v
[vault-root]  (routes to appropriate worker)
    |
    +--> [librarian]  --> "what do I know about X"
    +--> [architect]  --> "compile graph"
    +--> [curator]    --> "clean up my vault"
    +--> [teacher]    --> "explain this note"
    +--> [historian]  --> "what was I thinking"
    +--> [janitor]    --> "prune orphans"

All workers listened on team_chat for coordination.
Results flow back via results queue.
```

## How It Worked

Each spec was assigned to a worker with specific domain knowledge. Spec-A built the role system. Spec-B created the demo vault. Spec-C wrote the README. Spec-D scaffolded setup + viewer. Spec-E wired everything into a working team.

The parallelization was real: 5 workers running simultaneously, each producing artifacts that fed into the next phase. HMS coordinated via channel broadcast. No worker waited idle if there was work to do.

## Gotchas Worth Knowing

1. **Channel design matters.** We added `compile_request` and `graph_update` channels because architect and janitor needed to coordinate on graph changes. Redesigning mid-run is expensive—sketch channels before starting.

2. **Auth tokens must be env vars.** Literal tokens in YAML get committed. KT's `${ENV_VAR}` substitution keeps secrets out of the graph.

3. **Spec ordering has soft dependencies.** Spec-E reads outputs from A, B, D. We shipped with stub smoke tests and iterated rather than blocking. It's okay to deliver partial value early.

## Reproducing This

```bash
# Clone the terrarium
git clone https://github.com/2233admin/obsidian-llm-wiki
cd obsidian-llm-wiki

# Run the KT team
kt terrarium run @vault-wiki/terrariums/vault-wiki-team

# Ask the librarian
send_message tasks "what do I know about attention heads"
```

Your markdown vault becomes a knowledge-role team. Each role is a markdown skill file. The MCP server handles tool execution. KT handles orchestration.

*Last built by KT terrarium on 2026-04-20.*
