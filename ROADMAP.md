# vault-mind Roadmap

## Phase: graphify adapter

**Goal**: Add graphify as a 5th `VaultMindAdapter`, enabling multi-format content extraction
(PDF, images, video, code) to feed into vault-mind's knowledge graph.

**Trigger condition**: graphify probe (see `.planning/todos/pending/probe-graphify-api-contract.md`) complete

**Scope**:
- `mcp-server/src/adapters/graphify.ts` -- new adapter (subprocess pattern, same as gitnexus)
- `mcp-server/src/adapters/registry.ts` -- register graphify adapter
- `vault-mind.yaml.example` -- add graphify config section
- Tests: `mcp-server/src/adapters/graphify.test.ts`
- Docs: `docs/adapters/graphify.md`

**Out of scope**:
- Bundling graphify (stays as optional external dependency)
- Modifying graphify upstream

**Definition of done**:
- [x] graphify adapter implements `search`, `graph`, `read` capabilities
- [x] Gracefully degrades if graphify CLI absent
- [x] `graph()` returns valid `GraphData` from graphify-out/graph.json
- [x] Tests pass
- [x] README updated with graphify adapter section
- [x] Docs: `docs/adapters/graphify.md`

## Phase: second-brain integration (v2.4.0)

**Goal**: Port obsidian-second-brain's workflow layer into vault-mind, adding structured note
creation tools and thinking/research slash commands on top of the existing MCP infrastructure.

**Scope**:
- 6 new MCP tools: `vault.daily`, `vault.person`, `vault.project`, `vault.decide`, `vault.meeting`, `vault.ingest`
- 10 slash commands in `commands/`: synthesize, reconcile, emerge, research, challenge, connect, panel, recap, graduate, learn
- AI-First discipline: all new tools emit `ai-first: true` frontmatter + "For future Claude" preamble

**Definition of done**:
- [x] vault.daily -- creates Daily/YYYY-MM-DD.md with AI-First frontmatter
- [x] vault.person -- creates People/{name}.md with role/company/relationship
- [x] vault.project -- creates Projects/{name}.md with status/team/milestones
- [x] vault.decide -- creates Decisions/YYYY-MM-DD--{slug}.md (ADR-lite)
- [x] vault.meeting -- creates Meetings/YYYY-MM-DD--{slug}.md with attendees/actions
- [x] vault.ingest -- creates 00-Inbox/{slug}.md with AI-First format
- [x] 10 slash commands under commands/
