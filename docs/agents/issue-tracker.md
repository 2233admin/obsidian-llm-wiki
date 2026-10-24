# Issue Tracker

## Source of truth

Development work on this repository is tracked as GitHub Issues in
[2233admin/obsidian-llm-wiki](https://github.com/2233admin/obsidian-llm-wiki/issues).
Any human or agent picks up work from there; progress must not depend on a
single chat session.

- New work: open an issue with the **任务** template (背景 / 要做什么 / 验收标准).
- Write each issue so it is self-contained: files, commands, error output, and
  checkable acceptance criteria.
- Link the PR to the issue (`Fixes #N`) so merging closes it.

`01-Projects/<project>/issues/<slug>.md` is the product's work-OS issue format
(used by `project.*` tools and user vaults). It is not the tracker for
developing this repository; do not add new development tasks there.

## Issue contract

Read the issue body and acceptance criteria before implementation. Record
verification evidence and blocking relationships in the issue or the linked PR.

## Triage

Apply the labels in `docs/agents/triage-labels.md`. `ready-for-agent` means an
agent can finish it without a human; `ready-for-human` means it needs a person
or a specific machine (e.g. 5070X, 5090).
