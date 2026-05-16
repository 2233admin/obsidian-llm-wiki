# Why not just grep?

A fair question. Here is the honest answer.

---

## 1. Grep finds substrings. This finds concepts.

Grep matches characters. `vault.search` matches wikilinks `[[attention-heads]]`, resolves aliases from frontmatter, and traverses tags `#transformer #NLP`. When you search "attention", grep finds the word "attention". The vault finds every note that mentions or relates to the concept of attention, including notes that use the alias "multi-head self-attention" without ever typing the word "attention".

Example: your vault has a note titled `A3: KV-Cache Optimization` with alias `kv-cache`. Running `/vault-librarian what do I know about kv-cache` returns the note even though you never typed those two characters together.

---

## 2. Grep is stateless. This is compiled.

Grep scans on every invocation. The first query costs the same as the 1,000th. LLMwiki compiles your vault once. On a 554-note vault, it produces a concept graph with 2,507 edges in under 3 seconds. Every subsequent query reuses that graph. The agent calls `vault.backlinks` and gets the full backlink map without rescanning the filesystem.

---

## 3. Grep outputs text. This outputs MCP tools.

Grep returns a list of filenames and line numbers. `vault.search` returns structured results: note path, title, matched snippet, backlink count, frontmatter tags, and mtime. The agent uses these fields to decide what to read next, cite in its answer, and surface as related notes. Grep gives the agent raw text to parse. MCP tools give the agent a data model.

---

## 4. Grep is for you. This is for your agent.

When you run grep, you interpret the results and decide what to do. When Claude Code runs `/vault-librarian what do I know about X`, the agent calls `vault.search` and `vault.read` directly and uses the citations to construct a grounded answer. The agent does not guess from a grep hit-list. It reads the cited notes and answers with evidence. Knowledge roles wrap the MCP tools so the agent knows what to ask for and how to interpret the results.
