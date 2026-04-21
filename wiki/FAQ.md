# FAQ

First-draft FAQ. These are the questions the author predicts users will ask. The v2 answers below will be wrong in spots until real users actually ask questions; every wrong answer here becomes an issue and an edit. If you hit a question this page does not cover, open an issue -- that is the loop this page relies on.

---

## Setup and install

### Does it need Obsidian running?

No. The `filesystem` adapter is always available and reads plain markdown. Obsidian is optional via the `obsidian` adapter, which requires the separate `obsidian-vault-bridge` plugin. If you never install that, you still get 90% of the surface.

### Do I need a vector database?

No. The default stack is a compiled concept graph stored as files -- no Postgres, no pgvector, no Redis. If you want semantic similarity at scale, enable the optional `memU` adapter. See [[Adapter-Spec]].

### What agent hosts does it work with?

Anything that speaks MCP stdio transport. Tested with Claude Code, Codex CLI, OpenCode, Gemini CLI. `./setup --host <name>` installs the persona skills into that host's skills directory.

### Windows, macOS, Linux?

All three. Windows is the primary development target (author's machine). CI runs on Linux. macOS is tested manually. Path handling is `path.posix`-normalized internally; on Windows you can use forward or backward slashes.

### Python version?

3.11+. The compiler is zero-dep and uses only stdlib. The MCP server is Node/TypeScript.

---

## Using it

### What do I type to use it?

Once setup copies the skills, in Claude Code (or your MCP host): `/vault-librarian what do I know about X`. Five other personas: `vault-architect`, `vault-curator`, `vault-teacher`, `vault-historian`, `vault-janitor`. See `README.md` for the full table.

### Why dry-run by default for writes?

Because an agent with write access to your vault will, at least once, propose a rewrite that you did not mean to approve. Dry-run default makes every `vault.create`, `vault.modify`, `vault.delete`, `vault.rename`, `vault.mkdir`, and `vault.append` emit a diff preview. You flip `dryRun: false` when you want the write to land. This is an axiom; see [[Rationale]] #2.

### Can I turn off dry-run globally?

You can pass `dryRun: false` per call, and the `vault.batch` operation accepts a batch-level override. There is no "disable dry-run globally" flag. If you think you want one, you probably want the `vault-janitor` persona, which is designed for batch cleanup with human-reviewed dry-run diffs.

### Which operation should I call for search?

Three flavors, pick by intent:

- `vault.search` -- raw filesystem grep, unranked. Use when you know what string you want to find.
- `query.search` -- filesystem-only ranked search. Same scoring as `query.unified` but one adapter.
- `query.unified` -- weighted multi-adapter search. Use for "best answer anywhere".

For agents, `query.unified` is usually the right default. `docs/mcp-tools-reference.md` has the full signature for each.

### What does `compile.run` actually do?

Walks the vault, parses frontmatter and wikilinks, resolves aliases, builds the concept graph, writes the graph back to disk. Incremental by default -- reuses unchanged nodes. Takes ~3 seconds per 500 notes on a modern laptop.

---

## Limits and honest answers

### How big a vault does this handle?

Reference testing: 500-2000 notes, sub-second for most operations, ~3 seconds for full compile. 10k+ notes have not been stress-tested. If you have that many, open an issue -- that is when we would want a real benchmark to cite here instead of a guess.

### Does it index the contents of my code blocks?

The search operations index the text of the markdown file, so code blocks are searchable as strings. There is no AST-level understanding of the code -- `foo()` and `foo ( )` are different strings. For code-aware search, enable the optional `gitnexus` adapter for vaults that contain source trees.

### Can two agents write to the vault at the same time?

There is no write lock in v2.0.0. If you have two concurrent agents mutating the same file, you are on your own. The dry-run default reduces the blast radius; it does not prevent the footgun.

### What happens if my vault has 500 MB of PDFs in it?

The compiler ignores non-markdown files. PDFs do not get indexed. If you want PDF content in the graph, extract to markdown first and let the compiler pick it up.

### Does it sync to my Obsidian graph view in real time?

Only while the `obsidian-vault-bridge` plugin is running. Without the bridge, Obsidian sees file changes on its own file-watcher interval, not through this tool.

---

## Philosophy and positioning

### Is this an Obsidian plugin?

No. It is a headless MCP server. It can optionally cooperate with an Obsidian plugin (the separate `obsidian-vault-bridge` repo). See [[Rationale]] "Why not just an Obsidian plugin" for the long version.

### Is this replacing grep / ripgrep?

No. Grep is better at "find this exact string right now". This is better at "help an agent reason over the concept graph across 1000 notes". Use both. See [[Rationale]] #1.

### Is this replacing a vector database?

No. It is trying to get you to not reach for a vector database until you actually need one. When you do, enable the `memU` adapter.

### Why six personas and not one?

Because different queries want different tool-call patterns. `vault-librarian` reads and cites; `vault-curator` lints and prunes; `vault-historian` answers by date. Collapsing them into one persona either bloats the system prompt or loses the specialization. The personas are opinionated wrappers over the same underlying MCP surface -- if you want to build your own, the surface is the contract.

### Is the product positioning going to change?

Probably. Specifically: the sibling `obsidian-vault-bridge` repo is being repositioned to absorb more plugin-mediated commands. If that holds, several of the "obsidian adapter is thin" claims in this wiki will need rewriting. See [[Rationale]] "Product drift we are watching".

---

## Troubleshooting

### `./setup` printed a path but nothing else happened

That is expected -- setup only copies skills into your host's skills directory and prints the `.mcp.json` snippet you need to register. Restart your agent host after that so the MCP registration takes effect.

### The agent says "vault.search is not a valid tool"

Your agent host has not reloaded its MCP config. Restart the host. If it still fails, check that `.mcp.json` lists this server and that the stdio command resolves.

### `compile.run` crashes on my vault

Open an issue with the first line of the traceback and, if possible, the offending filename. The compiler is zero-dep Python; traces are readable.

### My writes are not landing

Check `dryRun`. It defaults to `true`. If you expected a write to hit disk and it did not, it was a dry-run. Pass `dryRun: false` explicitly.

### I cloned the repo and ran setup, but my host cannot find the skills

`./setup --host <name>` copies a 1.6 MB curated bundle to `<host-skills-dir>/obsidian-llm-wiki/`. If `<name>` is wrong or the host writes to a non-standard directory, the copy goes nowhere. Re-run with the right `--host`.

---

## Contributing

### Where should I file a bug?

GitHub issues on `2233admin/obsidian-llm-wiki`. One issue per bug; attach a minimal vault reproducer if possible.

### Where should I file a FAQ question that this page does not answer?

Also GitHub issues, labeled `faq`. The FAQ is under-specified on purpose until real questions surface.

### Can I add an adapter?

Yes. See [[Adapter-Spec]] "Adding a new adapter". Five-step recipe. The capability declaration is the important part -- it lets the registry know which operations your adapter services.

---

## See also

- [[Home]] -- page map.
- [[Architecture]] -- if the answer you want is "how does it work under the hood".
- [[Rationale]] -- if the answer you want is "why is it shaped this way".
- [[Adapter-Spec]] -- adapter contract, capability matrix, failure modes.
- `README.md` -- the 30-second pitch and the example prompts.
- `docs/GUIDE.md` -- the long-form user guide.
