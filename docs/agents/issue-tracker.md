# Issue Tracker

## Source of truth

This repository uses local Markdown issues as the executable work tracker.

- Active issues: `01-Projects/<project>/issues/<slug>.md`
- Retired work: `10-Projects/<project>/docket/**`
- Agent drafts: `00-Inbox/AI-Output/<agent>/` or
  `10-Projects/<project>/agents/<agent>/`

The Gitea remote is used for source control. No automatic Gitea issue workflow
is configured for these skills, so do not create GitHub/GitLab issues or use
`.scratch/` as a competing tracker.

## Issue contract

Read the issue frontmatter and acceptance criteria before implementation.
Keep status, verification evidence, and blocking relationships in the issue.
Use the project's existing vocabulary and paths.

## Triage

Apply the mappings in `docs/agents/triage-labels.md` when triage skills refer
to canonical roles.
