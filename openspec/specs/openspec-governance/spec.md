# openspec-governance Specification

## Purpose
TBD - created by archiving change adopt-openspec-workflow. Update Purpose after archive.
## Requirements
### Requirement: OpenSpec planning scope
LLMwiki SHALL use OpenSpec as a repo-local planning and review surface for non-trivial engineering changes while preserving existing ownership boundaries for GSD, work-OS, vault memory, and external workflow runtimes.

#### Scenario: Non-trivial engineering change starts
- **WHEN** a change affects multiple files, workflows, release behavior, MCP contracts, agent coordination, or durable documentation
- **THEN** the change SHOULD begin with an OpenSpec change under `openspec/changes/<change-id>/` before implementation

#### Scenario: External workflow integration is proposed
- **WHEN** an OpenSpec change concerns an external workflow system, skill pack, agent runtime, or project-management surface
- **THEN** its proposal and design MUST state which system owns execution state and which LLMwiki surfaces may index, cite, or summarize reviewed outputs

### Requirement: LLMwiki authority boundaries
OpenSpec artifacts SHALL NOT redefine LLMwiki source registration, memory governance, project issue routing, or durable knowledge promotion in ways that contradict the repository's canonical docs.

#### Scenario: Source registration behavior is specified
- **WHEN** an OpenSpec spec mentions `source.register`
- **THEN** it MUST preserve Phase 1 support for `url` and `vaultPath` inputs unless the same change includes implementation and tests for additional input types

#### Scenario: Agent output promotion is specified
- **WHEN** an OpenSpec spec mentions agent-authored analysis, plans, or reports
- **THEN** it MUST keep draft output outside durable team truth until reviewed or promoted through the documented path

#### Scenario: Work item routing is specified
- **WHEN** an OpenSpec spec mentions executable LLMwiki project work
- **THEN** it MUST route current work through `01-Projects/<project>/issues/<slug>.md` and MUST NOT create new `10-Projects/<project>/docket/**` source-truth work

### Requirement: OpenSpec validation gate
LLMwiki SHALL validate OpenSpec artifacts before using a change as implementation authority.

#### Scenario: Change artifacts are ready for implementation
- **WHEN** `proposal.md`, `design.md`, `tasks.md`, and at least one `specs/**/spec.md` file exist for a change
- **THEN** `openspec validate <change-id> --strict` MUST pass before the change is treated as apply-ready

#### Scenario: Change is completed
- **WHEN** implementation and verification tasks are complete
- **THEN** the change SHOULD be archived with OpenSpec so durable current specs can be updated and the historical proposal remains available

### Requirement: Minimal repository disruption
OpenSpec adoption SHALL be additive and SHALL NOT alter runtime behavior or release packaging unless a later change explicitly proposes that behavior.

#### Scenario: OpenSpec is initialized
- **WHEN** the repository contains OpenSpec config and local Codex OpenSpec skills
- **THEN** existing setup, release, MCP, compiler, fleet, and documentation tests MUST remain responsible for runtime correctness

#### Scenario: Small change is requested
- **WHEN** a task is a small typo fix, narrow one-file patch, emergency hotfix, or mechanical formatting change
- **THEN** maintainers MAY skip OpenSpec and use the existing direct edit/test/review path
