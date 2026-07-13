# Fleet Workflow acceptance

The fleet acceptance harness proves LLM Wiki's product-level Work Run contract;
an Orca task reporting success is not sufficient evidence by itself.

The fixture models one canonical Project with two independently leased Work
Runs. One agent executes locally and one executes on the 5090 host. Both leases
are created on the local device, while each agent retains its own Work Item,
Work Run, and agent identity. Orca task and terminal IDs are Project External
Projections: they can be used to resume provider-owned execution, but they are
never Project IDs, Work Item IDs, Work Run IDs, or agent IDs.

## One-host deterministic check

Run the complete sequence in a temporary acceptance vault:

```powershell
bun scripts/verify_fleet_workflow.ts --phase all --json
```

The command deliberately exits non-zero when the backend still permits a join
to overwrite an existing durable identity. It is an explicit release
acceptance command, not a soft orchestration smoke test.

## Local plus 5090 sequence

Use a disposable vault path that both phases can access through the fleet test
transport. Keep device-local state outside that shared path.

On the local host:

```powershell
bun scripts/verify_fleet_workflow.ts `
  --phase prepare `
  --vault D:\fleet-acceptance\vault `
  --device-state D:\fleet-acceptance\local-device `
  --json
```

Copy or sync only `D:\fleet-acceptance\vault` to the 5090 acceptance worktree.
Do not copy `D:\fleet-acceptance\local-device`; it represents the local
`.vault-mind/_leases.json`, workspace path, and lease token boundary.

On 5090, execute the remote agent phase against the shared fixture vault:

```powershell
bun scripts/verify_fleet_workflow.ts `
  --phase remote `
  --vault D:\fleet-acceptance\vault `
  --json
```

Return the shared fixture vault to the local host, then run the authoritative
doctor and Project Hub verification:

```powershell
bun scripts/verify_fleet_workflow.ts `
  --phase verify `
  --vault D:\fleet-acceptance\vault `
  --device-state D:\fleet-acceptance\local-device `
  --json
```

Release evidence must include the commit SHA and JSON reports from `prepare`,
`remote`, and `verify`. The final report must show:

- two distinct Work Run and agent identities under `project/fleet-acceptance`;
- successful workflow doctor results for both identities;
- a read-only Project Hub observing both durable runs;
- rejection of a mismatched join without changing the original run bytes;
- Orca task/terminal references owned by the external provider; and
- no device-local workspace, lease store, or lease token in durable runs or the
  Project Hub projection.
