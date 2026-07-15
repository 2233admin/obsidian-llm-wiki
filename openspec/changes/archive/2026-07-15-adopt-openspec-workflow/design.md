## Context

LLMwiki already has several overlapping coordination surfaces:

- GSD handles long-running execution phases and task state.
- Work-OS issue notes under `01-Projects/<project>/issues/` are LLMwiki's current project-work source truth.
- Vault memory distinguishes unreviewed agent drafts from reviewed durable knowledge.
- Release and onboarding behavior is guarded by repository tests, distribution manifests, setup scripts, plugin manifests, and CI.

OpenSpec fits best as a change-intent layer: proposal, requirement deltas, design rationale, implementation checklist, validation, and archive history. It should make future engineering work easier to review without becoming another runtime state owner.

## Goals / Non-Goals

**Goals:**

- Provide a lightweight OpenSpec workflow for future multi-file or cross-cutting LLMwiki changes.
- Encode LLMwiki-specific naming, memory, source-registration, and work-OS constraints in `openspec/config.yaml`.
- Keep OpenSpec artifacts repo-local and reviewable in Git.
- Make OpenSpec validation part of the change-prep checklist.

**Non-Goals:**

- Replace GSD, work-OS, vault memory, or release CI.
- Import historical plans or current dirty worktree state into OpenSpec.
- Require OpenSpec for trivial edits.
- Add OpenSpec to published LLMwiki plugin/setup artifacts in this change.

## Decisions

### Decision: Use repo-local OpenSpec, not an external store

Repo-local `openspec/` keeps specs and change history next to the code they govern. An OpenSpec store could be useful later for team-wide planning, but it would add another shared state surface before this project has proven the local workflow.

Alternative considered: use a global or standalone OpenSpec store. Rejected for this first pass because LLMwiki already has enough external coordination surfaces.

### Decision: Generate Codex OpenSpec skills locally

`openspec init . --tools codex` creates project-local `.codex/skills/openspec-*` adapters. This keeps `/opsx:*` behavior reproducible for this repository without modifying global Codex skills.

Alternative considered: use only the global `openspec` CLI. Rejected because the user wants to try OpenSpec as a development workflow, and local skills make the intended entrypoints visible in the repo.

### Decision: Treat OpenSpec as additive governance

OpenSpec artifacts must reference canonical LLMwiki docs instead of redefining the domain model. Runtime contracts remain enforced by implementation tests and release checks, not by Markdown alone.

Alternative considered: make OpenSpec the single source of all development state. Rejected because GSD, work-OS issue notes, and vault memory already own distinct state domains.

## Risks / Trade-offs

- Spec drift -> Mitigation: require `openspec validate <change-id> --strict` before implementation and archive completed changes.
- Process overhead on small edits -> Mitigation: explicitly allow skipping OpenSpec for trivial or emergency changes.
- Confusion with GSD and work-OS -> Mitigation: config and specs state ownership boundaries directly.
- Hidden local-tool dependency -> Mitigation: OpenSpec remains a developer workflow; runtime code and release artifacts do not depend on it.

## Migration Plan

1. Initialize OpenSpec repo-local structure and Codex skills.
2. Add LLMwiki project context and artifact rules.
3. Create this adoption change as the first apply-ready example.
4. Document the local workflow in `docs/OPENSPEC_WORKFLOW.md`.
5. Validate OpenSpec artifacts with the CLI.

Rollback is deletion of `.codex/skills/openspec-*` and `openspec/`; no runtime code depends on these files.

## Open Questions

- Whether future release-blocking changes should require an OpenSpec change in CI.
- Whether completed OpenSpec specs should eventually be linked from work-OS project issues or reviewed vault notes.
- Whether an OpenSpec store is useful once multiple contributors plan changes concurrently.
