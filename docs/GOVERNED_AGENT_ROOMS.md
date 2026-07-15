# Governed Agent Rooms and Dream Time

LLM Wiki treats an Agent Room as a read-only Project projection, not as a second
project system:

```text
Room = Agent Profile × Project Context × active Thread
```

Project Context remains the identity root. Work Items and Work Runs remain the
execution facts. Approved Memory Revisions remain the only governed working
memory that can enter an execution Context Envelope.

## Shared facts and device-local state

Durable, portable facts include Project IDs, versioned Agent Profiles and
Bindings, Threads, Work Runs, approved Memory Revisions, proposal decisions,
Artifact Projections, Assignment Plans, non-secret grant summaries, device
capability advertisements, and Usage Events.

The following state must remain local to a device: plaintext credentials,
Secret Reference values, workspace paths, process handles, runtime sessions,
connector transport state, OAuth tokens, lease tokens, handoff tokens, and raw
Capability Grant credentials. Shared records may contain an expiring capability
advertisement or non-secret grant summary, never the corresponding authority
secret.

## Agent Profile, Binding, Thread, and Context Envelope

- An Agent Profile is a vault-scoped, versioned identity and constitution. It
  contains no secret, machine path, or live runtime state.
- A Project Agent Binding locks a Profile revision to one Project Context,
  project role, allowed memory scopes, and grant references. A disabled binding
  cannot create governed execution context.
- A Thread is ordered continuity metadata. It stores references to messages,
  artifacts, and Work Runs; it does not promote message bodies into memory.
- A Context Envelope has four fixed layers: Platform Kernel, Agent
  Constitution, approved Governed Working Memory, and Runtime Envelope. Each
  layer carries provenance, token accounting, content hashes, and a final
  fingerprint. Retries use the same fingerprint or create a new attempt.

Trimming is deterministic and layer-aware. Mandatory governance, exact
Profile/Binding locks, the approved Memory Revision lock, canonical Project
identity, and the Settings snapshot cannot be silently removed.

## Dream Time

Dream Time has three proposal-only operations:

1. `checkpoint` summarizes recent Thread or Work Run evidence into Recent
   Context and Open Items candidates.
2. `learn` derives cited stable working memory from an approved Recent Context
   revision.
3. `review` performs only deduplication, compression, and structural maintenance
   of stable working memory.

The model worker has no write tools, connector access, network access, or
protected-knowledge authority. It returns a fingerprinted Memory Proposal. The
approval service alone may create a copy-on-write Memory Revision after actor,
expected-revision, expiry, protected-directive, unresolved-conflict, and
transition-token checks pass.

Manual approval is the default. The Settings schema contains a disabled hook for
a future warning-free working-memory auto-approval policy; the current runtime
does not activate it. Decisions, architecture, runbooks, and other protected
knowledge always use the existing Promotion workflow.

Daily, weekly, and monthly cadence is an explicit Project-scoped orchestration
layer over those same operations: daily maps to `checkpoint`, Monday-based UTC
weeks map to `learn`, and UTC months map to `review`. All three Settings keys are
disabled by default. `dreamtime.cadence.status` only computes the deterministic
UTC window and persisted state; `dreamtime.cadence.run` must be called explicitly
and does not start a daemon or background scheduler.

One cadence invocation reuses the canonical Work Run pipeline, compiles a
Context Envelope from the active Profile/Binding, approved Memory Revision,
Project, public Settings snapshot, and optional Thread, then creates one
immutable proposal. Its Work Run remains `awaiting_review` with output class
`knowledge-claim` and approval status `pending`. Stable Project/Profile/window
identities make retries idempotent, but they never approve a proposal or write a
Memory Revision. A first approved Memory Revision must be bootstrapped through
the normal manual proposal flow before cadence can run.

## Context Consult and Delegation

Context Consult is an as-of, read-only query against an approved Agent Memory
Revision. Its result records the revision and fingerprint, provenance, warnings,
and artifact identity. A consult cannot modify the requesting or source Agent
memory.

Delegation starts with a deterministic Delegation Plan. Approval creates exactly
one idempotent Child Work Run in the same Project, with one parent Work Run and a
scoped, expiring Capability Grant. The grant is limited by Project, Agent, Work
Run, connector, operation, resource, and side-effect class. External side
effects require per-run approval.

Child completion, failure, cancellation, and replay do not infer the parent
terminal state. Results return through an Artifact Projection containing the
producer, source Work Run, Context Envelope fingerprint, inputs, content hash,
output class, and review state.

## Host capability connectors

Host Capability Connectors are execution adapters, not Knowledge Adapters.
Expert Descriptors describe capabilities, supported operations, model/device
affinity, health, cost class, source URL and inspected version. Connector records
describe the transport and approved import provenance.

Assignment planning is deterministic across capability, health, device, model,
cost, grant, and Project policy constraints. A plan locks the exact descriptor,
connector, health, device advertisement, Profile/Binding, and expected output.
Dispatch still uses the Work Driver lease and Work Run join.

Settings selects the connector registry identity, not a tracker provider. Both
`reviewed-expert` and `connector/reviewed-expert` resolve to the same canonical
`connector/reviewed-expert` identity. This selection is configuration only: the
connector and referenced Expert Descriptor must already carry reviewed import
provenance, connector registration is server-bound to an authenticated
approver, and invocation still requires the current Project Binding, Child Work
Run, Capability Grant, and approved Assignment Plan. Forge bindings and
GitHub/Gitea/Linear/Plane tracker tokens are never Host compatibility inputs.

The governed proxy exposes only `search`, `describe`, and `invoke`. Connections
are lazy. Settings owns non-sensitive endpoint and transport configuration,
Secret Reference owns credentials, and Project Binding plus Capability Grant own
authorization. Doctor and Project Hub projections never connect to an external
host.

Supported connector policy shapes include stdio, HTTP, OAuth, local-model, and
cloud-model. A missing Secret Reference, descriptor drift, timeout, stale device,
or unauthorized operation fails closed with a redacted diagnostic.

### Host authorization and invocation sequence

Host authority is issued for one exact descriptor version. A delegation request
that intends to call `expert/code-review` version `1.0.0` must include the
resource `descriptor/expert/code-review@1.0.0` in
`requestedCapabilityScope.resources`; a connector name alone never grants every
descriptor that may be registered later.

The complete backend-owned sequence is:

1. an authenticated human, approver, or admin registers and reviews the Expert
   Descriptor and its connector identity;
2. a Project Binding is created for the locked Agent Profile revision;
3. `delegation.plan` names the exact connector, operation, resource, budget,
   device constraints, expected output, and side-effect classes;
4. `delegation.approve` issues one expiring Grant and one Child Work Run;
5. the client passes only the Project ID, Binding ID, and Grant ID to
   `host.proxy.search` and `host.proxy.describe`;
6. the user reviews and approves the deterministic Assignment Plan; and
7. `host.proxy.invoke` reloads the Binding, Profile, Child Work Run, Grant,
   descriptor, assignment, and Settings snapshot before opening the transport.

The Obsidian control plane follows the same sequence. Changing the Project,
Binding ID, or Grant ID invalidates the visible Host workflow until Refresh has
successfully validated the new references. A `descriptor-not-granted` result
means the delegation scope must be recreated with the exact
`descriptor/<descriptorId>@<version>` resource; it is not repaired by editing
connector configuration or pasting a token into invocation input.

## Usage ledger

Usage is an append-only fact ledger for model, Dream Time, consult, delegation,
and connector calls. A stable idempotency key prevents retry duplication.
Provider-reported token and cost facts are retained as reported. Unknown token,
price, currency, or attribution is represented as unknown, never as zero.

Budgets, quotas, warnings, and admission decisions are versioned projections;
they do not rewrite historical Usage Events. Project Hub may group by Project,
Agent, Thread, Work Run, provider, model, device, operation, and time window.
Prompt bodies, machine paths, and secrets are rejected from events.

## Multi-device and Fleet acceptance

A remote device receives a portable handoff that carries canonical parent/child
Work Run identities, locked Assignment Plan, Context fingerprint, non-secret
grant summary, artifact inputs, expected output, and transition tokens. The raw
handoff capability is transferred through a separate local channel and never
written to the shared vault or evidence artifact.

Fleet acceptance requires:

- the remote checkout is the exact final release commit;
- the Child Work Run is created exactly once and remains in the same Project;
- stale, unauthorized, or no-match device capability cannot dispatch;
- remote replay is idempotent;
- Artifact Projection provenance and local/remote serialized evidence are
  byte-equivalent;
- the parent is not marked terminal merely because the child ended; and
- shared evidence contains no path, secret, process state, lease token, or
  handoff token.

## Legacy migration and rollback

`agent.migration.plan` is a dry-run inventory of legacy `_ai_memory.json`,
passport, handoff, and session records. It produces reviewed proposals for an
initial Profile, disabled Project Binding, Thread references, and an initial
Memory Revision candidate. The operation never overwrites legacy bytes.

The report records every source's vault-relative path, content hash, byte count,
and proposed destination. Rollback metadata contains exact source guards and no
restore actions because the dry-run performs no writes. Content that resembles
a credential or machine-local path is omitted from proposal material and
reported for manual remediation.

## Clean-room boundary

`https://github.com/EXXETA/exxperts` and
`https://github.com/Radiant303/SpringNote` are registered only as
product-research Source evidence. LLM Wiki does not copy their product code,
prompts, tests, UI text, styles, icons, screenshots, fixtures, or assets and does
not add either product as a dependency. The governed Agent domain, operation
names, schemas, fixtures, tests, cadence rules, and Obsidian controls are
independently implemented under LLM Wiki terminology and existing Project, Work
Run, Settings, Memory, Promotion, Usage, and Fleet contracts. Exact inspected
commits and license decisions are recorded in ADR 0009.

## Troubleshooting

| Diagnostic | Meaning | Recovery |
| --- | --- | --- |
| `missing_profile` | Binding or Room references an unavailable Profile revision. | Restore/import the exact Profile revision or create a reviewed new Binding. |
| `disabled_binding` | Project Binding is not enabled. | Review grants and enable through the backend operation. |
| `stale_fingerprint` | Context, proposal, descriptor, or Project identity changed. | Re-read canonical state and create a new proposal/attempt; do not force overwrite. |
| `unresolved_run` | A related Work Run is nonterminal or has incomplete evidence. | Resume/cancel through Work Run transitions, then refresh Room. |
| `capability_unavailable` | Connector, health record, device, model, or grant cannot satisfy the plan. | Run doctor, refresh the advertisement, or approve a different deterministic plan. |
| `secret_reference_unavailable` | Connector auth is configured but cannot be resolved locally. | Configure the Secret Reference in Settings on the executing device. |
| `proposal_expired` | Dream Time proposal expired before approval. | Generate a new proposal from the current approved revision. |
| `revision_conflict` | Another device committed the expected revision first. | Inspect history and regenerate/revise against the new fingerprint. |

Doctor and Project Hub diagnostics are read-only and redacted. They must not be
used as a health probe that opens connector transports or resolves secret
values.
