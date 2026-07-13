# Fleet workflow acceptance

This harness proves the LLM Wiki product contract across a real fleet handoff.
An Orca task reporting success is useful execution evidence, but it is not the
durable Project, Work Item, Work Run, or agent identity.

The fixture declares one Project, one Work Item, one remote agent, and the real
Orca task/terminal projections used for the 5090 collaboration. It deliberately
does **not** declare a Work Run ID. During `prepare`, the TypeScript Project
operations create the canonical Project and issue, then Python
`compiler/kb_meta.py work next --claim` selects that issue, acquires the local
lease, and creates the unique durable Work Run.

The acceptance marker shared with 5090 contains only the commit SHA, fixture
digest, correlation ID, canonical identities, correlated transition tokens, and
Orca projections. The local lease registry, local proof, and absolute paths are
never included. The Work Driver's raw `handoff_token` is a short-lived
capability, not an identity: it is written only to the gitignored/out-of-repo
local device state and is never placed in the marker, shared vault, Git
artifact, command arguments, log, or JSON report.

## Deterministic two-vault check

Run the whole contract locally with two independent temporary vault copies:

```powershell
bun scripts/verify_fleet_workflow.ts --phase all --json
```

`all` performs these steps:

1. prepare the Project, Work Item, dynamic Work Run, and local lease in a local
   vault;
2. copy shared vault files to an independent 5090 vault while excluding the
   entire `.vault-mind` machine layer;
3. reject missing and wrong capabilities plus wrong-agent, wrong-Work-Item,
   wrong-Work-Run, and wrong-Project joins with byte-identical
   runs/agents/events/lease manifests;
4. pass the generated capability out-of-band, join the leased run using
   `lease_mode: portable-handoff`, checkpoint, leave, and prove exact replays do
   not change bytes;
5. copy shared results back while again excluding `.vault-mind`; and
6. prove the original local lease bytes are unchanged, then run the local doctor
   and read-only Project Hub verification.

The command exits non-zero on any failed invariant. Automatically-created paths
are deleted unless `--keep` is supplied. Paths supplied with `--vault`,
`--remote-vault`, or `--device-state` are never deleted.

## Local plus real 5090 sequence

Use disposable directories. The local device proof must remain outside the
vault, and `.vault-mind` must never be copied through the shared-vault or Git
artifact channel. A device-state path inside this repository is accepted only
when Git ignores it; an outside-repository path is also valid.

On the local host:

```powershell
bun scripts/verify_fleet_workflow.ts `
  --phase prepare `
  --vault D:\fleet-acceptance\local-vault `
  --device-state D:\fleet-acceptance\local-device `
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
bun scripts/verify_fleet_workflow.ts `
  --phase remote `
  --vault D:\fleet-acceptance\remote-vault `
  --device-state D:\projects\obsidian-llm-wiki\.vault-mind\fleet-5090 `
  --tested-commit <prepare-report.commit> `
  --json
```

Environment injection is also supported without printing the value:

```powershell
$proof = Get-Content D:\secure\fleet-local-proof.json | ConvertFrom-Json
$env:LLMWIKI_FLEET_HANDOFF_TOKEN = $proof.handoffToken
bun scripts/verify_fleet_workflow.ts --phase remote `
  --vault D:\fleet-acceptance\remote-vault `
  --tested-commit <prepare-report.commit> --json
Remove-Item Env:LLMWIKI_FLEET_HANDOFF_TOKEN
Remove-Variable proof
```

For the Git artifact transport used by the 5090 workflow, generate the marker at
the product commit, commit only the disposable acceptance vault on a temporary
artifact branch, and check out that branch on 5090. The marker's product commit
must remain an ancestor of the artifact commit. `--tested-commit` explicitly
pins the product commit and must equal `marker.commit`; it allows `HEAD` to be
the descendant artifact commit. Without that flag, descendant commits are
accepted only when every changed path is inside the in-repository acceptance
vault. Product-code changes on the artifact branch are rejected.

Copy the 5090 vault files back into `local-vault`, again excluding
`.vault-mind`. Then verify on the local host:

```powershell
bun scripts/verify_fleet_workflow.ts `
  --phase verify `
  --vault D:\fleet-acceptance\local-vault `
  --device-state D:\fleet-acceptance\local-device `
  --tested-commit <prepare-report.commit> `
  --json
```

The three JSON reports must carry the same `commit`, `fixtureDigest`, and
`correlationId`. The final report must prove:

- exactly one Work Run keeps the local Work Driver's Project, Work Item, Work
  Run, and agent identities;
- the local lease registry is byte-for-byte unchanged after the remote round
  trip;
- the local workflow doctor accepts the completed run;
- the read-only Project Hub observes exactly one run;
- every mismatched join is rejected without mutation;
- missing and incorrect handoff capabilities are rejected without mutation;
- exact join/checkpoint/leave replays are byte-identical;
- Orca task/terminal references remain provider-owned projections; and
- no raw handoff capability, absolute local path, or lease field appears in the
  acceptance marker, shared artifacts, durable run, Project Hub response, or
  CLI output.

The harness refuses pre-existing acceptance targets, unsafe fixture identities,
path traversal, symlinked acceptance ancestors, and a non-empty user-supplied
remote vault. This protects disposable validation from overwriting unrelated
data.
