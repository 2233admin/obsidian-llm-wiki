# Problem Intake domain

`@obsidian-llm-wiki/problem-intake` is LLM Wiki's host-neutral,
GPL-3.0-only domain core for turning bounded diagnostic findings into reviewed
local work or explicitly approved upstream contribution plans. It has no
runtime dependencies and performs no vault, plugin, Git, forge, or network
mutation.

## Authority boundaries

- OBC, Host Capability diagnostics, approved Obsidian plugin adapters, Agents,
  and people submit versioned `ProblemReport` values.
- `ProblemObservation` is diagnostic evidence and triage history. It is not a
  Work-OS issue and never becomes one automatically.
- `IssueChangePlan` names exactly one canonical `project.issue.create`,
  `project.issue.update`, or `project.comment.add` operation. A host applies the
  immutable plan through Project Operations; this package never writes
  `01-Projects/<project>/issues/*.md`.
- `ProblemDisposition` records an explicit user choice. Installed credentials,
  a configured repository, an earlier approval, or collection of a diagnostic
  never imply remote consent.
- `ExternalContributionPlan` contains exact preview content and locked
  repository facts. A host applies it through governed tracker or forge
  adapters under Operation Write Policy and explicit per-Work-Run approval.
  Its versioned `executionProjection` locks the fingerprints of the forge
  adapter's resolved repository mapping, preflight, reviewed local head, and
  optional isolated patch artifact. The forge layer may retain richer transport
  facts, but they cannot drift from these canonical plan locks.

## Safety and determinism

Observation fingerprints use provider identity, rule identity, canonical
subject, and normalized evidence identity. Provider version and timestamps do
not split a recurring finding. The reference service retains occurrence count,
provider versions, verification history, and a separate auditable lifecycle.
`not_reproduced` verification never closes a Work-OS issue.

Unknown fields, invalid fingerprints, absolute machine paths, credentials,
unbounded evidence, stale revisions, invalid transitions, and transition-token
reuse fail closed with stable `ProblemIntakeError.code` values. Secret-bearing
provider reports are rejected before persistence. User-editable remote previews
are redacted instead, and every redaction is listed in the immutable plan.

Remote receipt state is intentionally owned by the governed tracker or forge
execution projection. That layer must record non-secret pending, success,
cancellation, and outcome-unknown receipts; an outcome-unknown create cannot be
blindly replayed. Problem Intake locks the execution projection fingerprints
but does not duplicate its receipt state.

## Example

```ts
import {
  createIssueChangePlan,
  InMemoryProblemIntake,
} from "@obsidian-llm-wiki/problem-intake";

const intake = new InMemoryProblemIntake();
const { observation } = intake.ingest(problemReport);
const plan = createIssueChangePlan({
  observation,
  actor: "person:alice",
});

// The host previews `plan`, obtains confirmation, then invokes
// `plan.operation` through canonical Project Operations.
```

## Development

```sh
npm run typecheck
npm test
npm run build
```
