# vault-agent-closeout -- file a session closeout into AI-Output

Use this skill when an agent finishes a meaningful work unit and the result
should survive the session as a reviewable draft.

## Goal

Create one concise closeout note under:

```text
00-Inbox/AI-Output/{agent}/YYYY-MM-DD-{slug}.md
```

The closeout is quarantine output, not durable team memory. Humans review and
promote later.

## When to use

- A code change, release step, research pass, or debugging session finished.
- The user asks to save, file, archive, or preserve what happened.
- A long-running agent needs a handoff record for another host.

Do not use it for trivial shell output, navigation, or throwaway chat.

## Required content

Write a short Markdown body with these headings:

```markdown
# Closeout

## Outcome

## Changes

## Verification

## Evidence

## Blockers

## Next
```

Keep it factual. Include paths, commands, commit/tag/manifest hashes, artifact
paths, PR/issue links, and dates when available. Separate verified facts from
inference.

## Tool call

Persist with `vault.writeAIOutput`:

```js
const result = vault.writeAIOutput({
  persona: "<agent host: codex | claude | opencode | gemini>",
  parentQuery: "<the user's work request or closeout request>",
  sourceNodes: [
    "[[path-or-note-used-as-evidence]]"
  ],
  agent: "<model or host identifier>",
  body: "<closeout markdown>",
  scope: "project",
  quarantineState: "new",
  dryRun: false
});
```

If the host cannot truthfully identify itself, use `persona: "vault-agent"` and
say why in the body. Prefer the concrete host name when known.

Surface `result.path` and any `result.warnings`. Never suppress warnings.

## Guardrails

- Do not invent source nodes. Empty `sourceNodes` is allowed when the evidence is
  external to the vault, but the body must still list concrete files, commands,
  or artifact links.
- Do not write directly into durable paths.
- Do not mark the note reviewed or user-confirmed.
- If the user only wants a local answer and not a saved record, answer normally.
