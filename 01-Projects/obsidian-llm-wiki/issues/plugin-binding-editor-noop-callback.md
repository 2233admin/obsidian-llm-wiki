---
type: issue
entity: project/obsidian-llm-wiki/issue/plugin-binding-editor-noop-callback
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/plugin-binding-editor-noop-callback
description: "Plugin 0.4.0: profile/binding editor modals get no-op completion callbacks — new bindings may have no observable effect until reload (needs confirm vs control-plane-ui.ts)"
status: active
priority: 3
blocked-by: []
last-verified: 2026-07-16
---

Plugin: binding editor completion callbacks are no-ops

## Context (from GitHub main, plugin 0.4.0-beta.1 — partially unconfirmed)

`main.ts:151-163` — `openAgentProfileEditor` / `openProjectBindingEditor`
pass `async () => undefined` as the completion callback.
`AgentControlPlaneModal` receives
`defaultProjectId: this.data.deviceBinding?.workspaceProjectId`
(`main.ts:147`), implying plugin-side `deviceBinding` is the current-binding
source of truth — but creating a binding through the editor never updates it
or triggers refresh.

⚠️ First step: read `control-plane-ui.ts` (not audited — outside the fetched
file set) to check whether the modals refresh internally. If they do, close
this ticket as no-bug.

## Fix (if confirmed)

Wire callbacks to update `deviceBinding.workspaceProjectId` and re-render /
`refreshSettings`.

## Acceptance

- Create binding via modal → visible in settings tab immediately, no plugin
  reload needed.
