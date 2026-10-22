# Project Hub Recovery Flow v2

Status: **APPROVED DESIGN — implementation not started**

This change replaces the shipped `project-hub-recovery/v1` Snapshot contract with the stateless staged `project-hub-recovery-flow/v2` and completes the first interrupted-work recovery journey. S01 v1 remains completed history. S01B–S08 deliver the V2 contract kernel, read stages, clean cutover, Obsidian proof, Workflow apply/output governance, parity, and acceptance.

## Read order

1. [`docs/adr/0001-project-hub-recovery-flow-v2.md`](../../../docs/adr/0001-project-hub-recovery-flow-v2.md) — why Snapshot v1 is replaced by a stateless Flow.
2. [`proposal.md`](proposal.md) — product scope and migration.
3. [`design.md`](design.md) — exact stage, request, fingerprint, authority, apply, and output decisions.
4. [`specs/project-hub-recovery-loop/spec.md`](specs/project-hub-recovery-loop/spec.md) — observable R1–R11 requirements and rejection scenarios.
5. [`tasks.md`](tasks.md) — reviewed work-package sequence and implementation gates.
6. [`docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md`](../../../docs/superpowers/plans/2026-08-27-project-hub-recovery-loop.md) — exact source-bound implementation tasks, file maps, tests, and commands.

## Work-OS links

- Parent brief: `01-Projects/obsidian-llm-wiki/issues/llmwiki-project-driven-knowledge-workspace.md`
- Historical S01 v1: `01-Projects/obsidian-llm-wiki/issues/p0-s01-project-hub-recovery-snapshot.md`
- V2 contract kernel: `01-Projects/obsidian-llm-wiki/issues/p0-s01b-project-hub-recovery-flow-v2.md`
- Delivery issues: S02–S08, including S04A/S04B and S06A/S06B, in the same issue directory.

## Delegation boundary

Luna receives one reviewed Task at a time. It may alter internal implementation shape, add/split focused files, extract helpers, adjust focused tests, and create a local commit. It must stop before changing approved public contracts, authority, dependencies, write policy, privacy/security, crash invariants, or observable behavior. It may not push, merge, or perform external mutation. The controller reviews, runs full verification, updates the canonical plan/file map, and accepts or rewrites the commit.