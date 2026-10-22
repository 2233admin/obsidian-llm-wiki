# AGENTS.md - obsidian-llm-wiki Codex Contract

Codex works in this repository as an obsidian-llm-wiki agent host. Follow the same host-neutral workflow contract as Claude Code.

## Required Reading

Before changing ingest, memory, source registration, project/work-OS behavior, or external workflow integration, read:

1. `CONTEXT.md` for canonical vocabulary.
2. `docs/AGENT_WORKFLOW_INTEGRATION.md` for Claude Code/Codex workflow intake.
3. `docs/MEMORY_GOVERNANCE.md` for draft, review, and promotion boundaries.
4. `docs/INGEST.md` for Source Registration and ingest preflight rules.
5. `docs/LOCAL_PROJECTS.md` for current work-OS issue paths.

## Non-Negotiable Paths

- Supported Phase 1 Source Registration inputs: `url`, `vaultPath`.
- Reserved Source Input vocabulary that must not be passed to `source.register` yet: `repoPath`, `filePath`, `directoryPath`, `text`.
- Agent drafts: `00-Inbox/AI-Output/<agent>/` or `10-Projects/<project>/agents/<agent>/`.
- Current work items: `01-Projects/<project>/issues/<slug>.md`.
- Retired work store: `10-Projects/<project>/docket/**`.
- Protected durable knowledge: `20-Decisions/`, `30-Architecture/`, `40-Runbooks/`.

External repositories and skill packs are Sources or workflow capability providers first. Register canonical URLs, cite local inspection artifacts as evidence, and promote durable conclusions only after review.

## Default workflow

Use the repository's BMAD-lite intake before implementation:

```text
raw voice → normalized intent → product brief → architecture / UX boundary
→ Work-OS issue → implementation plan → code → verification evidence
```

Voice input is draft material. Normalize product and module names against
`CONTEXT.md`; if a transcription ambiguity can change scope or architecture,
ask one focused clarification before creating code work. Keep the raw input and
unreviewed interpretation under the draft paths, keep executable work under the
Work-OS issue paths, and record approved architecture in `30-Architecture/`.
BMAD-lite supplements Work-OS; it does not create a second task system.

## Agent skills

### Issue tracker

Executable work is tracked as local Markdown issues under
`01-Projects/<project>/issues/`; see `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default labels defined in `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repository. Read the root `CONTEXT.md` and relevant
ADRs under `docs/adr/`; see `docs/agents/domain.md`.

