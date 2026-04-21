# Security Model

The security model has four layers: dry-run default on every mutating operation, a protected-paths deny list, preflight path-traversal rejection, and an optional bearer-token gate on the MCP transport. No feature here is enterprise grade -- this is a single-user local-first system. The goal is to prevent the obvious footguns that come with handing an agent write access to a knowledge base.

---

## Threat model (explicit)

- The agent is assumed co-operative but fallible. It will occasionally propose rewrites that the user did not mean to approve.
- The MCP transport is assumed local (stdio). We do not defend against a network attacker sitting on the wire.
- The filesystem is assumed trusted -- if an attacker can write to the vault directory directly, no MCP-level defence helps.
- Secrets in the vault are the user's problem. The server does not scan for them.

Out of scope: multi-tenant isolation, audit logging, RBAC, encrypted vaults, key rotation.

---

## Layer 1: dry-run default for mutations

Every mutating operation defaults `dryRun=true`. Authoritative list from `docs/mcp-tools-reference.md`:

| Operation | `dryRun` default | Notes |
|---|---|---|
| `vault.create` | true | Must pass `dryRun: false` to actually create. |
| `vault.modify` | true | Same. |
| `vault.delete` | true | Same -- deletes a note or folder. |
| `vault.rename` | true | Move/rename. |
| `vault.mkdir` | true | Directory creation. |
| `vault.append` | true | Content append. |
| `vault.batch` | batch-level `dryRun` | Applies to all mutating ops inside the batch unless overridden. |
| `vault.enforceDiscipline` | true | Scaffolds `_index.md` + `log.md` for topic folders. |
| `vault.writeAIOutput` | true | Writes persona analyses with provenance frontmatter. |
| `vault.sweepAIOutput` | `dry_run: true` | Same discipline, different flag casing inherited from the collector. |
| `vault.reindex` | `dryRun: false` default (count-only when true) | Intentional exception -- reindex is semantic-only, no filesystem mutation. |
| `recipe.run` | n/a | Recipes fetch external data and write to a staging directory; see recipe-specific config. |
| `compile.run` | n/a | Writes compile cache, not user notes. |

The persona prompts (see [[Persona-Design]]) inherit this default -- they do not paper over it with "just flip `dryRun` for me automatically". A persona that routinely sets `dryRun: false` without a user confirmation step is a broken persona and should be fixed.

---

## Layer 2: protected paths

The MCP server refuses mutations against paths inside the protected list:

| Pattern | Why |
|---|---|
| `.obsidian/` | Obsidian config and workspace state. Mutating this corrupts the editor's view of the vault. |
| `.trash/` | Obsidian's trash. Writing here masks data loss. |
| `.git/` | Git internals. Obvious. |
| `node_modules/` | Should not be in a vault at all; if it is, not our job to rewrite it. |

The list is conservative. Adding paths to it is a one-line change in the server config; removing entries requires deliberate review.

Protection applies regardless of `dryRun` state -- a dry-run against `.git/` still fails preflight, because the purpose is to refuse the intent, not only the effect.

---

## Layer 3: preflight path-traversal rejection

Every path argument is normalised and rejected if it escapes the vault root:

- `../` sequences that resolve outside the vault are rejected.
- Absolute paths that do not share a prefix with `vault_path` are rejected.
- Windows-style `C:\escape` paths are rejected (there is a dedicated fixture in `mcp-server/` tests for this case).
- Symlinks pointing outside the vault are treated as if they dereference to their target -- if the target is outside, the operation is rejected.

This is the cheapest layer to audit -- it is a handful of path normalisation rules executed before any adapter is invoked.

---

## Layer 4: optional bearer-token gate

`vault-mind.yaml` supports an `auth_token` field. When set, every MCP tool call must present the token in the request. When empty, the server runs ungated (the default, since stdio transport is local).

Rotate the token by editing the yaml and restarting the server. No built-in rotation cadence, no key-derivation ceremony -- this is a tripwire, not a crypto system.

---

## What the security model does not do

- **No audit log.** Tool calls are not persisted by the server. Agent hosts often keep their own transcripts; that is where forensics happens.
- **No rate limit.** An agent in a retry loop can hammer the server. Diagnose at the agent-host level.
- **No content scanning.** The server does not look for API keys or PII inside notes. If a recipe ingests a file with secrets, they land in the vault.
- **No sandbox.** The MCP server runs with the invoking user's privileges and can read/write whatever that user can. If you do not want the agent to see a file, do not put it in the vault.
- **No per-persona ACL.** All personas share the full MCP surface. `vault-janitor` is not prevented from calling `vault.modify`; it just chooses not to.

Upgrading any of the above is a real decision, not a marketing bullet. If your threat model actually requires audit + RBAC + rotation, this is the wrong tool.

---

## Operator checklist

If you are running this in a context where a slip is expensive, verify:

- [ ] `vault-mind.yaml` has `vault_path` pointing at the intended directory -- double-check on fresh clone; previous installs leaked this value historically and it is now placeholder-only.
- [ ] Protected-paths list includes everything in your vault you cannot afford to lose. Default covers `.obsidian .trash .git node_modules`; add others (e.g. `private/`) in config.
- [ ] `auth_token` is set if the transport ever leaves the local machine. Stdio defaults assume local-only.
- [ ] Your agent host's skills directory only contains personas you actually want callable. Orphan persona skills still fire if invoked.
- [ ] Your vault is under version control with a recent commit. The security model's real last resort is `git reset`.

---

## See also

- [[Rationale]] axiom 2 -- "dry-run by default for mutations" as a non-negotiable.
- [[Architecture]] -- where in the request lifecycle the preflight gates sit.
- [[Adapter-Spec]] -- adapter-level capabilities; each adapter honours the same dry-run contract.
- [[FAQ]] "My writes are not landing" -- symptom when dry-run catches the user.
- `docs/mcp-tools-reference.md` -- authoritative `dryRun` default per operation.
- `mcp-server/src/` -- preflight path normalisation code.
