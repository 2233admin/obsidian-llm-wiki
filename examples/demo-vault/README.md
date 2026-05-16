# Demo Vault

10 synthetic markdown notes about AI engineering topics, used to demo cited query and graph health. Point the `/vault-*` skills at this vault for a working demonstration.

## How to point MCP server at this vault

```bash
export VAULT_PATH=$(pwd)  # or absolute path to this directory
```

Or in Claude Code:
```
/vault-librarian what is this vault about
```

## Graph stats

- **Nodes:** 10 markdown files
- **Wikilink edges:** 40 (within 24-36 spec; boundary)
- **Tag edges:** 29
- **Unresolved (dangling):** 1 → `[[sparse-mixture-experts]]` (intentional)

## Compiler invocation

```
python compiler/concept_graph.py .compile/specB-demo-vault --output .compile/specB-demo-vault/.compile/graph.json --skip README.md --skip COMPLETION.json
```

Stderr output from last build:
```
[concept_graph] scanned=10 nodes=10 edges=69 (wikilink=40 tag=29) unresolved=1 -> .compile/specB-demo-vault/.compile/graph.json
```

## Tag clusters

| Cluster | Tag | Notes |
|---------|-----|-------|
| inference | attention, kv-cache, speculative-decoding, mixture-of-experts, in-context-learning | attention-heads, kv-cache, speculative-decoding, mixture-of-experts, in-context-learning |
| training | training, synthetic | training-data-curation, synthetic-data |
| meta | meta, evaluation, benchmarking, memory, architecture, retrieval | karpathy-llm-wiki-concept, evaluations, retrieval-augmented-generation |

## Deliberate defects (drive role demos)

| Defect | File | Drives skill |
|--------|------|-------------|
| Dangling wikilink | `mixture-of-experts.md` → `[[sparse-mixture-experts]]` (non-existent file) | `/vault-curator` |
| Near-duplicate 1 | `attention-heads.md` | `/vault-janitor` |
| Near-duplicate 2 | `kv-cache.md` | `/vault-janitor` |
| Stale mtime | `training-data-curation.md` -- mtime = 2024-10-01 (18 months old) | `/vault-historian` |

## Notes

- `karpathy-llm-wiki-concept.md` is the anchor/landing note. It links to 5+ other notes.
- All notes are 150-400 words (technical, first-person, note-to-self tone).
- Each note has at least 1 code block (Python or pseudocode).
- No emoji in frontmatter tags (per spec).
