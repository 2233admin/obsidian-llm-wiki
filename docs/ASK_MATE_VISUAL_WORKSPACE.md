# Ask Mate visual workspace: experimental release contract

Ask Mate is the Obsidian control surface for two host-neutral LLM Wiki
capabilities:

- Visual Workspace owns Mind Map Documents, source interpretation, Visual Edit
  Plans, deterministic projections, and hash-locked apply.
- Problem Intake owns Problem Observations, deduplication, lifecycle,
  Issue Change Plans, and user-selected external contribution plans.
- The governed tracker/forge execution layer owns pending, success,
  cancellation, and outcome-unknown contribution receipts. Problem Intake
  retains canonical plan identity and execution-projection locks, not a second
  receipt ledger.

Markdown under the managed map section and Work-OS issue notes remain the
human-readable sources of truth. Ask Mate, Canvas, Mermaid, Project Hub, Bases,
and plugin data are control or projection surfaces; they do not acquire domain
authority.

## Experimental enablement and rollback

The first release is enabled at the prerelease-artifact boundary. Install the
MCP and Obsidian plugin artifacts produced from the same verified commit, then
open **Ask Mate for managed project map (LLM Wiki)** on a canonical Project map.
There is no supported hidden command that bypasses the release gate and no
requirement for a paid or community mind-map plugin.

Before enabling the artifact, run:

```text
python scripts/verify_release_security.py --json
python scripts/verify_plugin_upgrade_rollback.py --candidate obsidian-plugin --baseline <reviewed-baseline-archive> --json
```

The release-security command is offline. It fails closed when a required
schema, operation, generated bundle, domain build output, test source,
operator document, package manifest, lockfile, or reviewed runtime-license
record is missing or stale.

Rollback means reinstalling the reviewed baseline MCP/plugin pair and
restarting Obsidian. It does not delete canonical map Markdown, Problem
Observations, audit receipts, or Work-OS issues. A baseline that does not know
these records must leave them untouched. Canvas and Mermaid projections are
derived and may be removed or regenerated. Do not roll back by deleting
managed sections or copying plugin data between devices.

## Migration and Doctor

No bulk rewrite runs when the experimental artifact is installed.

- A canonical managed Markdown map is read in place.
- An ordinary note is interpreted as a read-only adoption candidate. Adoption
  creates a Visual Edit Plan and writes canonical nested-list Markdown only
  after explicit confirmation.
- A user-authored Canvas is interpreted as a read-only candidate. Ambiguous
  roots, parents, directions, unsupported nodes, and unsupported fields must
  be resolved or rejected before adoption.
- Existing Work-OS issues stay under `01-Projects/<project>/issues/`. Problem
  Intake may call `project.issue.create`, `project.issue.update`, or
  `project.comment.add`; it never migrates or writes issue truth directly.

After install, upgrade, rollback, or Project migration, run `settings.doctor`,
`project.context.doctor`, `host.doctor`, and `workflow.doctor` as applicable.
Then verify one canonical map with `visual.map.read`, list the Project's
observations, and open Project Hub. Unavailable Graphify, model, plugin
diagnostic, tracker, or forge bindings must be reported as degraded or
unavailable; they must not be rewritten as healthy.

A stale source hash, plan fingerprint, Settings snapshot, Project head,
repository base, permission fact, or transition token fails closed. Generate
a fresh preview; never repair a mismatch by editing a receipt.

## Canvas supported subset

The adoption reader accepts Obsidian core Canvas JSON with `nodes` and `edges`
arrays. The supported node subset is:

- `text` nodes with non-empty `text`;
- `file` nodes with a non-empty vault-relative `file` reference and optional
  `subpath`;
- `link` nodes with a non-empty `url`;
- `group` nodes with a non-empty `label`.

Supported presentation fields are `x`, `y`, `width`, `height`, and `color`.
Supported edge fields are `id`, `fromNode`, `fromSide`, `fromEnd`, `toNode`,
`toSide`, `toEnd`, `color`, and `label`. Arrow direction may supply a parent
candidate. An undirected edge, multiple roots, multiple possible parents,
duplicate identity, missing endpoint, unknown node type, or unknown field is a
diagnostic, not permission to guess.

Canvas adoption is never an in-place rewrite of a user-authored Canvas. The
accepted hierarchy is serialized to the canonical managed Markdown form after
preview. A Canvas exported by Visual Workspace is a deterministic derived view:
text nodes contain source links, hierarchy edges are directed, reviewed
cross-links remain separate, and node/depth truncation is reported.

## Privacy, redaction, and remote approval

Local parsing, preview, diagnostics review, manual outline editing, and local
issue routing work without a model or remote provider. Credentials are resolved
only through device-local Secret References. They must not enter a Mind Map
Document, Problem Observation, Project Hub, plan, prompt transcript, plugin
data, generated bundle, test evidence, or durable receipt.

Problem evidence is bounded and reference-oriented. Authorization material,
machine-local paths, unbounded plugin-private payloads, and undeclared personal
data are rejected or redacted before persistence. The user can edit or remove
every target, title, body, label, evidence item, and redaction intended for a
remote Issue or pull request.

Contribution receipts are versioned and persisted only by the governed
tracker/forge execution layer. The canonical Problem Intake plan links to that
execution projection without copying receipt transport state into its own
schema or ledger.

Diagnostic collection never implies remote consent. `local_only` performs no
remote action. `submit_issue` and `prepare_pull_request` first produce immutable
previews. Every external mutation requires current repository facts, current
plan fingerprint, Operation Write Policy, a fresh transition token, and
explicit per-run approval. An outcome-unknown receipt blocks automatic retry.
Branch or fork push, draft pull-request creation, and ready-for-review are
separate confirmations. Merge is outside this flow.

## Accessibility and mobile acceptance

The core workflow cannot depend only on spatial rendering. Acceptance requires:

- keyboard access to intent selection, clarification, outline editing,
  structural diff selection, confirmation, and cancellation;
- an ordered textual representation of hierarchy, cross-links, source links,
  warnings, and truncation diagnostics;
- live status exposed without stealing focus;
- visible focus and controls with readable labels;
- deterministic node/depth bounds that keep the outline and preview usable in
  a narrow mobile workspace;
- safe view restoration that does not persist a parallel canonical map or
  contribution plan in plugin data.

Direct node dragging and third-party renderers are optional enhancements. Their
absence cannot remove read, edit, preview, apply, export, or cancellation.

## Clean-vault acceptance

Use a disposable vault containing only Obsidian core capabilities and the
candidate LLM Wiki plugin. The acceptance run must prove:

1. the plugin and MCP artifacts come from the same commit and pass the offline
   release-security gate;
2. a canonical Project ID resolves without a machine path becoming identity;
3. `visual.map.read` and `visual.map.plan` do not change bytes;
4. confirmed `visual.map.apply` preserves prose outside the managed section,
   rejects source drift, and returns the prior receipt on exact replay;
5. an ordinary Markdown note and supported Canvas produce read-only candidates
   and explicit ambiguity diagnostics before adoption;
6. textual, Mermaid, and Canvas projections are deterministic and bounded;
7. Ask Mate remains usable with no model, Graphify, or community plugin;
8. an OBC finding deduplicates into a local Problem Observation and a reviewed
   Issue Change Plan routes through Project Operations only;
9. closing or cancelling every preview produces no local write or remote
   mutation; and
10. upgrade, rollback, and candidate reinstall preserve unrelated vault bytes
    and recover without copying credentials or canonical state into plugin
    data.

Cross-host parity means the same versioned schemas and operation names are
present in source, the generated MCP bundle, and the generated Obsidian bundle.
It does not mean every host may bypass confirmation or execute unavailable
connectors.

## GPL-3.0-only and transitive dependency audit

LLM Wiki is released under GPL-3.0-only. Visual Workspace and Problem Intake
are first-party GPL-3.0-only packages. The core mind-map path has no runtime
dependency on a paid plugin, community plugin, hosted renderer, or Graphify.
Optional adapters run behind their own typed boundary and do not become the
canonical data owner.

`scripts/verify_release_security.py` reads package manifests and version-3
lockfiles offline. It checks that package name, version, and license metadata
match at the lock root, inventories non-development transitive dependencies,
and accepts only explicitly reviewed GPL-3.0-compatible SPDX expressions.
Unknown expressions, missing metadata, missing lockfiles, incompatible
licenses, and prohibited dependency provenance fail the release. Adding or
upgrading any runtime dependency requires a deliberate allowlist review; an
installed optional plugin is not evidence that redistribution is permitted.
