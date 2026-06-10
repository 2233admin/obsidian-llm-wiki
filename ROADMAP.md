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
