# Archived Task Drafts

This directory preserves the historical planning drafts produced during
the v0.x and v2.4–v2.5 design phase (2026-06-28 → 2026-07-13). Each
draft informed one or more shipped features in `v2.8.0-beta.1` →
`v2.8.0-beta.3` and the Plugin 0.4.0-beta series.

These documents are **archived, not authoritative**. The current work
plan lives in:

- `01-Projects/obsidian-llm-wiki/issues/` — one Markdown issue per
  tracked unit of work, with rhizome-compliant frontmatter
  (`state`, `review`, `priority`, `blocked-by`, `assignee`).
- `ROADMAP.md` — shipped phases and next planned releases.

## Index

| Draft | Topic | Shipped in |
|---|---|---|
| `TASK7-DRAFT-project-currency.md` | currency engine for project / decision / action drift defense | v0.x internal phase |
| `TASK8-DRAFT-work-os.md` | work-OS transactional protocol + 3-tier alignment | v2.8.0-beta.1 (Agent Domain, Settings Platform) |
| `TASK9-DRAFT-workspace-federation.md` | local-first workspace federation | v2.8.0-beta.1 (Fleet control plane) |
| `TASK10-DRAFT-structure-into-view.md` | AI structures conversation into views (`_work-os.canvas`, capture digest) | Plugin 0.4.0-beta.3 |
| `TASK10C-DRAFT-promote-gesture.md` | Obsidian promote-gesture: in-view submit candidate | Plugin 0.4.0-beta.5 |
| `TASK11-DRAFT-work-driver.md` + `TASK11-GRILL-BRIEF.md` | work driver / execution loop | v2.8.0-beta.1 (`work next`, `work budget`) |
| `TASK12-DRAFT-context-core.md` | context core: knowledge as a versionable, portable artifact | partially shipped in `compiler/currency.py`; remaining gap tracked as open issue |
| `TASK13-DRAFT-recall-revival.md` | NL recall with PG-FTS floor + ingest wiring | partial (recall layer live, ingest gap tracked) |
| `TASK14-DRAFT-multi-platform-compile.md` | multi-platform true-value compile + drift guard | designed only; 14A/14B/14C PRs not started |

## Why archive rather than delete

Each draft captures a design discussion that drove the shipped
implementation. Future contributors asking "why was this built this
way" will find the original design rationale here. Keeping the drafts
also documents the rejected alternatives and the §0 invariants each
shipped feature was measured against.

## Status notation in archived drafts

The drafts use the original `TASK N（草案）` headings and the
**APPROVED / DRAFT / DESIGNED** status markers from their time of
writing. These statuses reflect the state of the draft at archive
time, not the current state of the code. Refer to the Issue tracker
and `ROADMAP.md` for current truth.
