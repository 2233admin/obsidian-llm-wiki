# Capability remediation

Use this guide when **System status** or **Getting Started** reports a degraded or
unavailable capability. The Settings Platform is the owner of capability health;
the Obsidian plugin only renders the explanation and invokes the existing setting
operation.

## Rules

1. Read the capability summary and remediation code before changing anything.
2. Repair the owning setting at the smallest applicable scope.
3. Keep credentials in a Secret Reference or device environment; never put them in
   argv, Markdown, Project records, screenshots, or diagnostics.
4. Run **Refresh / Run Doctor** after the change.
5. Treat `available` as a passed probe, `degraded` as usable with a limitation,
   `unavailable` as not runnable, and `disabled` as intentionally off.

## Common states

| Capability | State or code | Safe repair | Verification |
|---|---|---|---|
| `runtime.python` | `configure-python` / `repair-python` | Set `runtime.python.path` to a real Python executable. Do not point it at `.cmd`, `.bat`, or `.ps1` wrappers. | Run Doctor; then run the operation that needs the worker. |
| `query.semantic` | degraded because Python is unavailable | Repair `runtime.python.path`, or disable semantic query when filesystem search is sufficient. | Search still works through the filesystem adapter; semantic health changes after Doctor. |
| `diagnostics.obc.semantic` | unavailable or degraded | Repair semantic-query prerequisites, or leave semantic suggestions disabled. Deterministic diagnostics remain available. | Run the link-diagnostics operation and inspect its bounded result. |
| `models.agent` | `agent-model-secret-missing` or invalid model settings | Set the model mode and endpoint. For cloud mode bind a device-local Secret Reference; for local mode use an OpenAI-compatible local endpoint. | Run Doctor and confirm the model capability is `available` or the intended `disabled`. |
| `adapters.memu` | missing DSN, user, or Python graph worker | Configure the adapter through Settings Platform and resolve its Secret Reference. | Run Doctor; normal vault search must remain usable if MemU is unavailable. |
| `adapters.qmd` / `adapters.lightrag` / `adapters.raganything` / `adapters.hindsight` | invalid settings or provider unavailable | Correct the endpoint/profile or disable the optional adapter. Never copy the provider secret into the vault. | Run Doctor and retry only the adapter-owned operation. |
| `providers.host-capability` | missing connector, grant, or Secret Reference | Review connector provenance, enable the connector, and resolve its device-local Secret Reference. | Run the host capability doctor; no raw secret should appear in its output. |
| `settings.doctor` | `retry-doctor` | Leave editable settings intact and select **Retry** or **Run Doctor**. | System status refreshes with a new timestamp. |
| `settings-platform` | `retry-settings` | Confirm the desktop filesystem vault and local control-plane runtime are available, then refresh. | The Settings Platform snapshot and definitions render again. |

## When repair should stop

Stop and leave the capability unavailable when:

- the provider requires login, cookies, a paywall, region access, or manual browser
  action;
- the endpoint is not HTTPS or contains URL userinfo/query credentials;
- the diagnostic includes an absolute path, transcript body, token, or secret;
- a required operation still reports `unavailable` after a successful Doctor run;
- a run has `outcome-unknown`; reconcile the owner before retrying.

These are honest capability boundaries, not setup failures. Record a bounded issue or
agent draft if follow-up work is needed; do not silently downgrade the state to make an
operation appear successful.

## Headless verification

Use the CLI only for developer or automation verification. It must invoke the same
Operation Interface as MCP and Obsidian:

```bash
node mcp-server/recovery-flow-cli.js open \
  --vault /absolute/path/to/vault \
  --project project/my-project
node mcp-server/recovery-flow-cli.js search \
  --vault /absolute/path/to/vault \
  --input-file search-request.json
node mcp-server/recovery-flow-cli.js plan \
  --vault /absolute/path/to/vault \
  --input-file plan-request.json
```

Later-stage JSON files contain the complete prior request. Do not pass a Plan,
stale proof, transition token, or credential as a command-line argument. CLI errors
redact credentials and absolute paths.

## Escalation evidence

When a repair fails, capture only:

- capability ID and state;
- remediation code;
- timestamp and Settings snapshot ID;
- bounded error code/message;
- the exact verification operation and result.

Keep raw environment values and private provider responses out of the evidence.
