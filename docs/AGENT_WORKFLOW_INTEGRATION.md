# Agent workflow integration

This document is the host-neutral contract for Claude Code, Codex, and other
agent hosts that adapt external repositories, tools, skill packs, or workflow
systems into obsidian-llm-wiki.

obsidian-llm-wiki is the reviewed Markdown knowledge layer. It can register Sources,
index Evidence Notes, track work-OS issues, and link reviewed summaries, but it
does not replace the external workflow runtime that produced the evidence.

## Host entrypoints

- Claude Code reads `CLAUDE.md`, then this document before changing ingest,
  memory, source, or project workflow behavior.
- Codex reads `AGENTS.md`, then this document before changing ingest, memory,
  source, or project workflow behavior.
- Both hosts use the same vocabulary from `CONTEXT.md`: Source, Source Input,
  Source Registration, Source Note, Source Registry, Evidence Note, Ingest Run,
  Project Hub, work-OS issue, and Promotion Policy.

## External workflow intake

Before importing an external project or workflow, classify the user input:

| Input | obsidian-llm-wiki classification | Phase 1 action |
|---|---|---|
| GitHub/Gitea/GitLab URL | `Source Input` with `inputType=url`, usually `sourceKind=repo` | Register with `source.register`; record platform and recommended providers. |
| Website, doc, article, issue, release, or README URL | `Source Input` with `inputType=url` | Run `ingest.link.preflight`; register durable Source when it should be revisited. |
| Existing vault note | `Source Input` with `inputType=vaultPath` | Register as Vault Path Source; do not rewrite the original note. |
| Local clone, repo path, file path, directory path, or pasted text | Reserved Source Input types | Do not call `source.register` with these in Phase 1. Register the canonical URL when available, and cite local inspection outputs in agent draft notes. |

`source.register` Phase 1 supports only `url` and `vaultPath`. The reserved
types `repoPath`, `filePath`, `directoryPath`, and `text` are vocabulary for the
domain model, not executable registration paths yet.

## Source and evidence rules

1. Register the Source before treating it as reusable team context.
2. Use `ingest.link.preflight` for side-effect-free planning; preflight is not
   an Ingest Run and does not prove capture succeeded.
3. A successful ingest means provider output landed in the vault and is visible
   through `vault.search` or `query.unified`.
4. Source Notes live under `00-Inbox/Sources/<platform>/` globally or
   `10-Projects/<project>/sources/<platform>/` when registered with a project.
5. Evidence Notes must cite the Source, capture time, provider/toolchain,
   limitations, and reproducible artifact references. Do not store cookies,
   tokens, private headers, or local secrets.

## Agent output and promotion

Agent-authored analysis starts as draft material:

```text
00-Inbox/AI-Output/<agent>/
10-Projects/<project>/agents/<agent>/
```

Drafts are not team truth. The promotion path is:

```text
agent draft -> reviewed summary -> promoted decision/runbook/project hub link
```

Durable team truth belongs only in reviewed surfaces such as
`20-Decisions/`, `30-Architecture/`, and `40-Runbooks/`. Agents may propose
changes to those surfaces, but should not silently promote their own draft
output into protected knowledge.

## Work-OS issue routing

Actionable workflow improvements use work-OS issue notes:

```text
01-Projects/<project>/_project.md
01-Projects/<project>/issues/<slug>.md
```

Do not create or revive `10-Projects/<project>/docket/**`. Boards, Canvas, and
Bases are derived views from `01-Projects/<project>/issues/*.md`, never source
truth.

Use an issue when there is executable work, such as adding a provider,
repairing a source-registration behavior, updating agent host instructions, or
validating a workflow. Use a Source Note when the object is an external input
to be revisited. Use an agent draft when the content is unreviewed analysis.

## Skill packs and external runtimes

Skill packs and workflow runtimes are capability providers, not obsidian-llm-wiki memory.
Inventory and describe them, but keep authority boundaries clear:

- obsidian-llm-wiki may index reviewed summaries, source registrations, evidence, and
  project issues.
- The external runtime owns its execution state, config, checkpoints, and
  routing decisions.
- obsidian-llm-wiki Project Hubs should link the owning runtime and summarize only what a
  human needs to resume work.

## LazyCodex example

For `https://github.com/code-yeongyu/lazycodex`:

1. Treat the GitHub repository URL as the Source Input.
2. Register it with `source.register` using `inputType=url`, platform `github`,
   and `sourceKind=repo`.
3. If a local clone or code-intel report exists, cite it from an agent draft or
   Evidence Note as inspection evidence; do not register the local clone path as
   a Phase 1 Source.
4. Track any obsidian-llm-wiki improvement as a work-OS issue under
   `01-Projects/obsidian-llm-wiki/issues/`.
5. Promote durable conclusions only after review into the protected knowledge
   surfaces or link them from the obsidian-llm-wiki Project Hub.

## Verification checklist

Before claiming an integration is done, verify at least one evidence path:

- `source.register` produced `_llmwiki/source-registry.json` and a Source Note.
- `vault.search` or `query.unified` can find the Source Note, Evidence Note, or
  work-OS issue.
- `project.issue.list` or `project.board.get` can see the work item when the
  change created executable project work.
- The host-facing entrypoint (`CLAUDE.md` or `AGENTS.md`) links this document.

