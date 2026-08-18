---
type: issue
entity: project/obsidian-llm-wiki/issue/internalize-railly-agentfiles
state: done
review: reviewed
kind: feature
id: obsidian-llm-wiki/internalize-railly-agentfiles
description: Internalize Railly Agentfiles as a governed native LLM Wiki capability
status: active
priority: 2
blocked-by: []
assignee: codex
last-verified: 2026-08-08
---

Internalize Railly Agentfiles as a governed native LLM Wiki capability

## Context

`Railly/agentfiles` provides a desktop Obsidian surface for discovering,
searching, editing, creating, installing, and reviewing agent skills across
multiple coding-agent runtimes. LLM Wiki already owns the Obsidian plugin,
agent control plane, and governed draft/promotion boundaries, so the capability
must be integrated into that host rather than installed as a second plugin.

## Acceptance

- The existing LLM Wiki Obsidian plugin exposes Agentfiles as a native view and command.
- Global and project-local agent files are discoverable across the supported runtime paths.
- Search, filters, favorites, collections, creation, editing, marketplace, conversations, and analytics remain usable.
- Conversation export lands in an agent-owned draft path and does not promote external workflow content automatically.
- Existing LLM Wiki settings, agent control plane, and plugin-data migration remain intact.
- Upstream MIT attribution is retained and source-level tests/build verification pass.

## Verification

- Targeted Agentfiles tests pass.
- `npm test`, `npm run typecheck`, and production plugin build pass.
- The bundle contains the Agentfiles view and no second Obsidian plugin entrypoint.
