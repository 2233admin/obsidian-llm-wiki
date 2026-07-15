# Fleet workflow acceptance

> **Current governed v2 gate:** the default fixture is now
> `tests/fixtures/fleet-workflow.v2.json`. It creates one local parent Work Run
> and uses `kb_meta work next --governed-assignment <json-file>` to create one
> schema v2 child Work Run for 5090. The deterministic two-vault gate is
> automated. Product commit `7433dde2df77f0b37aae8f63d46e74556f352f87`
> completed the fresh real 5090 round trip for `v2.8.0-beta.1`; its signed
> schema-v2 evidence is recorded in
> [`docs/release-evidence/v2.8.0-beta.1.json`](release-evidence/v2.8.0-beta.1.json).
> The historical evidence below remains evidence for earlier contracts only.

> **Accepted baseline evidence:** product commit
> `89cf831ed4615270c56edd2784928a29e52e1789` passed the deterministic
> independent two-vault harness and the real local ↔ 5090 sequence below.
> Orca task `task_085ffa2467a6` executed the remote phase exactly once; the
> returned state passed local verification. The beta candidate must repeat this
> sequence at its new product commit after Agent model binding lands.

The baseline run used fixture digest
`615b5359e836d8224f5b6ebaf92fcdb7c724cfc89e0e7e3d89a92f873bc580a7`
and correlation ID `3c27a18c-b199-4f31-af19-5cfc586e8472`. The out-of-band
proof contents were not printed or copied into the vault.

> **Accepted beta candidate evidence:** product commit
> `7433dde2df77f0b37aae8f63d46e74556f352f87` passed the complete clean-worktree
> 5090 gate and a fresh real local ↔ 5090 round trip. The accepted Work Run's
> fixture-declared External Projections are Orca task `task_192b70c714e0` and
> terminal `term_88dba0af-df72-4390-b427-9e916f8fb03c`; they are provider-owned
> execution projections, not Project or Work Run identities. Runtime
> `82a396cc-c9ed-4d64-a108-73a013b240f2` performed the remote phase and the
> deliberate recovery replay. The later evidence-only documentation commit does
> not replace the tested product SHA.

The beta run used fixture digest
`3c449083070cf7e4bba1d389bf10d74688dd80df496f1cc7b65bf31b59b25613`
and correlation ID `6697af1f-909b-4754-bb50-5b6fc195aa2d`. Prepare, remote,
remote replay, and verify reports agreed on product
commit, fixture digest, and correlation ID. Returned-state verification proved
the original local lease bytes and identity unchanged, the exact remotely
completed Work Run, local Doctor acceptance, one Project Hub Work Run, external
projection boundaries, and absence of machine-local paths or lease fields from
shared state. Missing/wrong capability and identity attempts were rejected
without mutation. The full remote recovery replay produced the same SHA-256
bytes as the initial remote report and left the shared worktree clean. The
out-of-band proof contents were encrypted to a one-time 5090 RSA public key,
were never printed or copied into the vault, and were not committed in plaintext.

This harness proves the LLM Wiki product contract across a real fleet handoff.
An Orca task reporting success is useful execution evidence, but it is not the
durable Project, Work Item, Work Run, or agent identity.

The v2 fixture declares one Project, a non-terminal local parent Work Run, one
delegated Work Item, one remote agent, a locked governed assignment, input
artifacts, expected output, and the real Orca task/terminal projections used for
the 5090 collaboration. It deliberately does **not** declare the child Work Run
ID. During `prepare`, the TypeScript Project operations create the canonical
Project and issues, then Python `compiler/kb_meta.py work next --claim
--governed-assignment <json-file>` selects the delegated issue, acquires the
local lease, and creates the unique schema v2 child Work Run. The generated
child identity is then attached to the parent and included in the portable
handoff marker.

The v2 acceptance marker shared with 5090 contains only the commit SHA, fixture
digest, correlation ID, canonical parent/child identities, locked Profile,
Binding and Assignment Plan versions, Context Envelope fingerprint, non-secret
grant summary, input Artifact Projections, expected output, correlated
transition tokens, and Orca projections. The local lease registry, local proof,
absolute paths, credentials, and usable grant/lease tokens are never included.
The Work Driver's raw `handoff_token` is a short-lived
capability, not an identity: it is written only to the gitignored/out-of-repo
local device state and is never placed in the marker, shared vault, Git
artifact, command arguments, log, or JSON report.

## Cryptographic release-evidence gate

Real-device reports are not self-authenticating. A release evidence document now
uses schema v2 and must carry an Ed25519 attestation produced by 5090's
device-local private key. The corresponding public trust anchor is frozen at
[`docs/release-evidence/trust/device-cloud-5090.json`](release-evidence/trust/device-cloud-5090.json),
and its enrollment and signing procedure is documented in
[`docs/release-evidence/trust/README.md`](release-evidence/trust/README.md).

The signature covers the exact tested commit, release tag, canonical fixture
digest, correlation ID, recomputed canonical digests of all three raw reports,
and the complete execution provenance including the Orca task, terminal, and
runtime ID. The release verifier loads the public anchor from both the tested
product commit and release commit and requires the two Git blobs to be
byte-identical. It then recomputes the public-key DER fingerprint and payload
digest before OpenSSL verifies the strict-base64 Ed25519 signature.
The remote raw report must also contain exactly one `orca-task` and one
`orca-terminal` External Projection whose targets equal the signed provenance;
duplicate or detached projections are rejected.

Unsigned evidence, self-authored replacement reports, recomputed report hashes
without a new 5090 signature, wrong-key signatures, provenance changes, and
evidence commits that introduce or rotate their own trust anchor all fail
closed. Historical acceptance prose above remains useful context, but it is not
a substitute for a signed per-release evidence document. This repository does
not fabricate a final evidence document; it must be produced only after a fresh
real 5090 run at the final tested product SHA.

## Deterministic two-vault check

Run the whole contract locally with two independent temporary vault copies:

```powershell
bun scripts/verify_fleet_workflow.ts --phase all --json
```

This developer preflight may run against an uncommitted worktree, so its
reported `commit` is not release evidence by itself. Final-SHA acceptance must
run from a clean checkout and add `--require-clean`; that gate rejects both
tracked and untracked changes before any acceptance state is created.

`all` performs these steps:

1. prepare the Project, delegated Work Item, non-terminal parent, dynamic child,
   and local lease in a local vault;
2. copy shared vault files to an independent 5090 vault while excluding the
   entire `.vault-mind` machine layer;
3. reject missing and wrong capabilities plus wrong-agent, wrong-Work-Item,
   wrong-Work-Run, and wrong-Project joins with byte-identical
   runs/agents/events/lease manifests;
4. pass the generated capability out-of-band, assert the locked governed
   assignment, join the leased child using `lease_mode: portable-handoff`,
   checkpoint, leave, and prove exact transition replays do not change bytes;
5. project a provenance-complete child output artifact to both child and parent,
   while leaving the parent non-terminal;
6. resubmit the complete portable handoff and prove it reports the existing
   child without changing shared bytes;
7. copy shared results back while again excluding `.vault-mind`, prove the local
   and remote shared file manifests are byte-identical, and verify the remote
   shared-byte digest; and
8. prove the original local lease bytes are unchanged, then run the local doctor
   and read-only Project Hub verification.

The command exits non-zero on any failed invariant. Automatically-created paths
are deleted unless `--keep` is supplied. Paths supplied with `--vault`,
`--remote-vault`, or `--device-state` are never deleted.

The previous interface remains available for regression checks:

```powershell
bun scripts/verify_fleet_workflow.ts --phase all `
  --fixture tests/fixtures/fleet-workflow.v1.json --json
```

## Local plus real 5090 sequence

Use disposable directories. The local device proof must remain outside the
vault, and `.vault-mind` must never be copied through the shared-vault or Git
artifact channel. A device-state path inside this repository is accepted only
when Git ignores it; an outside-repository path is also valid.

On the local host:

```powershell
$acceptanceRoot = Join-Path $env:TEMP 'llmwiki-fleet-acceptance'
$localVault = Join-Path $acceptanceRoot 'local-vault'
$localDeviceState = Join-Path $acceptanceRoot 'local-device'
bun scripts/verify_fleet_workflow.ts `
  --phase prepare `
  --vault $localVault `
  --device-state $localDeviceState `
  --require-clean `
  --json
```

Copy `local-vault` to the 5090 acceptance directory while excluding
`local-vault\.vault-mind` (for example with a sync rule that excludes that
directory). Do not commit or copy `local-device` through the artifact branch.

Transfer the capability through a separate secret channel. Supported 5090
inputs (which must agree if more than one is present) are:

- `LLMWIKI_FLEET_HANDOFF_TOKEN` in the 5090 process environment;
- `--handoff-token-file <path>` pointing to a raw-token file or the JSON local
  proof; or
- `--device-state <path>` pointing to a securely transferred remote copy of the
  device-state directory.

The file/device-state path must be outside the repository or covered by
`.gitignore`. Never pass the raw token as a command-line argument. For example,
after securely copying `fleet-local-proof.json` to a 5090-only ignored path:

On 5090, at the exact commit printed by `prepare`:

```powershell
$acceptanceRoot = Join-Path $env:TEMP 'llmwiki-fleet-acceptance'
$remoteVault = Join-Path $acceptanceRoot 'remote-vault'
$remoteDeviceState = Join-Path $env:LOCALAPPDATA 'llmwiki-fleet-5090'
bun scripts/verify_fleet_workflow.ts `
  --phase remote `
  --vault $remoteVault `
  --device-state $remoteDeviceState `
  --tested-commit <prepare-report.commit> `
  --require-clean `
  --json
```

If the remote response is lost, run the same remote command again with the same
marker and out-of-band capability. For v2, the verifier must report the existing
completed child and leave every shared byte unchanged. A duplicate child
identity is a failure.

Environment injection is also supported without printing the value:

```powershell
$proofPath = Join-Path $env:LOCALAPPDATA 'llmwiki-fleet-proof.json'
$proof = Get-Content $proofPath | ConvertFrom-Json
$env:LLMWIKI_FLEET_HANDOFF_TOKEN = $proof.handoffToken
bun scripts/verify_fleet_workflow.ts --phase remote `
  --vault $remoteVault `
  --tested-commit <prepare-report.commit> --json
Remove-Item Env:LLMWIKI_FLEET_HANDOFF_TOKEN
Remove-Variable proof
```

For the Git artifact transport used by the 5090 workflow, generate the marker at
the product commit, commit only the disposable acceptance vault on a temporary
artifact branch, and check out that branch on 5090. The marker's product commit
must remain an ancestor of the artifact commit. `--tested-commit` explicitly
pins the product commit and must equal `marker.commit`; it allows `HEAD` to be
the descendant artifact commit. Every descendant requires that flag and is
accepted only when every changed path is inside the in-repository acceptance
vault. Product-code changes on the artifact branch are rejected even when the
tested product commit was pinned explicitly.

Copy the 5090 vault files back into `local-vault`, again excluding
`.vault-mind`. Then verify on the local host:

```powershell
bun scripts/verify_fleet_workflow.ts `
  --phase verify `
  --vault $localVault `
  --device-state $localDeviceState `
  --tested-commit <prepare-report.commit> `
  --require-clean `
  --json
```

The three JSON reports must carry the same `commit`, `fixtureDigest`, and
`correlationId`. The final v2 report must prove:

- one CLI-created schema v2 child keeps the local Work Driver's Project, Work
  Item, Work Run, agent, parent, locked Profile/Binding/Assignment, Context
  fingerprint, grant summary, artifact input, expected output, and transition
  identities;
- the parent and child share one Project, the parent names exactly that child,
  and child completion does not infer a terminal parent state;
- the local lease registry is byte-for-byte unchanged after the remote round
  trip;
- the child output Artifact Projection appears on the parent with producer,
  source child Work Run, approved context fingerprint, input refs, content hash,
  output class, and review state; missing provenance keeps acceptance failed;
- a full remote replay returns the existing child and changes no shared bytes;
- the returned local shared manifest is byte-identical to the remote manifest,
  and the local verifier reproduces the remote shared-byte digest;
- the local workflow doctor accepts the completed run;
- the read-only Project Hub observes the two-run parent/child graph;
- every mismatched join is rejected without mutation;
- missing and incorrect handoff capabilities are rejected without mutation;
- exact join/checkpoint/leave replays are byte-identical;
- Orca task/terminal references remain provider-owned projections; and
- no raw handoff/grant/lease capability, plaintext secret, credential, absolute
  local path, workspace/process state, or machine-local lease field appears in
  the acceptance marker, shared artifacts, durable graph, Project Hub response,
  or CLI output. Correlated transition tokens are non-secret idempotency
  receipts and are intentionally part of the portable handoff.

The harness refuses pre-existing acceptance targets, unsafe fixture identities,
path traversal, symlinked acceptance ancestors, and a non-empty user-supplied
remote vault. This protects disposable validation from overwriting unrelated
data.
