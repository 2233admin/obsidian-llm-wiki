# Recipes

Recipes are content collectors. Each recipe ingests from one external source (a chat platform, an email inbox, a task tracker, a website) and lands raw or pre-structured markdown into the vault. They are intentionally small and single-purpose; the vault's own compile pipeline does the structural work downstream. This page catalogues the ten that ship with v2.0.0, documents the MCP surface for running them, and gives a five-step recipe for authoring a new one.

---

## What ships today

`recipes/` directory, v2.0.0:

| Recipe | Source | Typical output |
|---|---|---|
| `astrbot-to-vault` | AstrBot (LLM chatbot platform) conversations | Per-conversation note with tool-call trace. |
| `circleback-to-vault` | Circleback meeting summaries | Per-meeting note with attendees and action items. |
| `feishu-to-vault` | Feishu (Lark) chat, docs, notes | Per-thread or per-doc markdown. |
| `gmail-to-vault` | Gmail inbox filters | Thread-per-note with quoted-chain trimming. |
| `linear-to-vault` | Linear issues / projects | Per-issue note with state + comments. |
| `napcat-to-vault` | NapCat QQ bot chats | Per-session summary note. |
| `voile-to-vault` | Voile research platform | Research run note with artefacts. |
| `wechatmsg-to-vault` | WeChat message export | Per-contact or per-group summary. |
| `weflow-to-vault` | WeFlow workflow runs | Per-run note with inputs and outputs. |
| `x-to-vault` | X (Twitter) bookmarks / threads | Per-thread or per-bookmark note. |

A `collectors/` subdirectory holds shared collection primitives used by multiple recipes.

Each recipe is a markdown file that doubles as documentation and executable config. Frontmatter declares the recipe id, required secrets, and setup hints. The body is the step-by-step guide for the human.

---

## MCP surface (the `recipe.*` namespace)

From `docs/mcp-tools-reference.md`:

| Operation | Mutating | What it does |
|---|---|---|
| `recipe.list` | no | Enumerate recipes with their current secret-presence status. |
| `recipe.show` | no | Print a recipe's frontmatter and setup guide by `id`. |
| `recipe.status` | no | Check whether required secrets are configured for one recipe. |
| `recipe.doctor` | yes | Full diagnostic -- secret presence + health checks (auth, reachability) for a recipe. |
| `recipe.run` | yes | Execute the collector with an optional `timeout_ms` (default 120000). |

Secrets are MCP-server environment variables -- they never pass through tool-call arguments, so an agent invoking `recipe.run` does not see the credential. Presence is reported by `recipe.status`; configuration is the user's job.

Typical user flow:

1. `recipe.list` to see what is installed and which recipes are missing secrets.
2. `recipe.show <id>` to read the setup guide for the one you want.
3. Set the declared env vars in the MCP server's environment.
4. `recipe.doctor <id>` to verify secrets + health.
5. `recipe.run <id>` to land the content.

---

## Integration with the compile pipeline

A recipe's job is acquisition + first-pass structure. It does **not** try to resolve concepts, build wikilinks, or deduplicate against existing notes -- that is what [[Compile-Pipeline]] is for. The division is:

- Recipe -> raw markdown in a staging directory (typically `00-Inbox/<source>/` or a recipe-specific path).
- User (or `vault-ingest` skill) decides which raw notes graduate into the main vault.
- Compile pipeline picks up graduated notes, resolves wikilinks, updates the concept graph.

This means you can run `recipe.run` aggressively without corrupting the main vault. The staging directory is a disposable buffer; the worst case of a misbehaving recipe is "stuff piles up in 00-Inbox and you delete it".

See [[Persona-Design]] on `vault-ingest` for how a persona promotes staged content into integrated notes.

---

## Authoring a new recipe (five steps)

1. **Decide the source.** One source per recipe. If you need two APIs, write two recipes and a compose step.
2. **Create `recipes/<name>-to-vault.md`** with frontmatter: `id`, `source`, required env vars, output path pattern. Copy an existing recipe as a starting template -- `linear-to-vault.md` and `x-to-vault.md` are the two cleanest references.
3. **Write the collector.** If it shares logic with existing recipes, put the common part in `recipes/collectors/` and invoke it. Collectors are the only place where multi-recipe sharing lives.
4. **Declare health checks** so `recipe.doctor` can exercise the collector without landing content. At minimum: auth succeeds, the source is reachable, the output path is writable.
5. **Document idempotency and re-run behaviour.** Each recipe's body should answer: what happens if I run this twice? Does it dedupe by source id, by content hash, or not at all? If the answer is "not at all", say so loudly.

A recipe is considered shippable when `recipe.doctor <id>` passes on a fresh clone with only the declared secrets set.

---

## Secrets discipline

- Secrets live in the MCP server's environment. They are never tool-call arguments.
- Every recipe declares the env vars it needs in its frontmatter. `recipe.status` and `recipe.doctor` key off that declaration.
- Rotation is a restart-the-server problem. There is no dynamic secret store.
- If a recipe accidentally logs a secret, that is a bug -- open an issue. The `writeAIOutput` provenance frontmatter does not carry secrets by design.

---

## Limits

- Recipes are synchronous from the MCP call site. Long-running collection (e.g. backfill 10k Linear issues) should be run outside `recipe.run` (cron, manual script) and the results checked in.
- There is no incremental-state store for recipes; each `recipe.run` starts from current API state. If incremental behaviour matters, the recipe body must handle its own cursor/state file.
- Recipes do not call LLMs. If you want summarisation or structured extraction, that happens in a persona after the content has landed.

---

## See also

- [[Home]] -- page map.
- [[Compile-Pipeline]] -- what happens to staged content after a recipe lands it.
- [[Persona-Design]] -- `vault-ingest` is the persona skill that graduates staged notes.
- [[Security-Model]] -- secrets handling, and why recipes are the one place they live.
- [[Adapter-Spec]] -- adapters consume the merged vault state; recipes feed the vault state.
- `recipes/` directory -- the ten recipes themselves, each with setup guide.
- `docs/mcp-tools-reference.md` -- authoritative `recipe.*` signatures.
