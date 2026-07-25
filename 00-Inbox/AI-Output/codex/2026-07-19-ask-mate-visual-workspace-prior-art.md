---
llmwiki_type: analysis
status: draft
agent: codex
project-id: project/obsidian-llm-wiki
created: 2026-07-19
topic: ask-mate-visual-workspace-prior-art
---

# Ask Mate, Visual Workspace, and Problem Intake: primary-source prior art

## Recommendation

Build one first-party `MindMapDocument` domain model and keep one managed nested-list Markdown section as its authoritative editable form. Use the public Obsidian API for the `ItemView`, commands, file access, lifecycle, and secret references; use `mdast-util-from-markdown` and `mdast-util-to-markdown` only if their bounded parsing value survives the implementation spike. The first release uses a keyboard-operable outline with live deterministic preview and has no visual-editor dependency. Mind Elixir or an installed Obsidian mind-map extension can be adapted later for direct node manipulation without becoming canonical state. Generate JSON Canvas and Mermaid as deterministic projections. Keep Ask Mate as a thin interaction surface over existing LLM Wiki query, edit-plan, Project Operations, and forge operations.

Treat Graphify as an important optional Knowledge Adapter. It can propose structural relations from project code and documents, but it is not a mind-map editor and never owns the map. Preserve its original relation, confidence, adapter identity, and source evidence; visually distinguish extracted, inferred, ambiguous, and unknown evidence; require explicit acceptance before any suggestion enters a `VisualEditPlan`.

Problem Intake should expose exactly three explicit outcomes:

1. `local_only`: create/update the reviewed local Work-OS issue through Project Operations.
2. `submit_issue`: show a redacted immutable preview, then call GitHub's create-Issue endpoint only after a separate confirmation.
3. `prepare_pull_request`: create an isolated local change, run declared regression checks, show the exact diff, confirm push separately, then create a PR with `draft: true`; never mark ready or merge automatically.

This stack adds two narrowly scoped parser packages plus one framework-agnostic editor. It does not add React/Svelte, a second agent runtime, a second work-state store, or an unofficial Canvas runtime dependency.

## Why these boundaries fit Obsidian

- Obsidian's public `Vault` API supports cached reads and recommends `Vault.process()` for collision-safe read/modify/write; its own guidance says to re-check content after asynchronous work. That maps directly to preview plus base-hash-locked apply. ([Vault guide](https://docs.obsidian.md/Plugins/Vault))
- Obsidian exposes `Editor` for active Markdown changes, `ItemView`/`registerView()` for a custom workspace view, `registerEvent()` for unload-safe subscriptions, and `MetadataCache` for parsed headings/links. Prefer these public APIs over Canvas internals or private plugin objects. ([Editor](https://docs.obsidian.md/Plugins/Editor/Editor), [Views](https://docs.obsidian.md/Plugins/User%20interface/Views), [Events](https://docs.obsidian.md/Plugins/Events), [MetadataCache API](https://docs.obsidian.md/Reference/TypeScript%20API/MetadataCache))
- Obsidian's release checklist recommends `Vault.process`, `FileManager.processFrontMatter`, `requestUrl`, dependency minimization, no client-side telemetry, and disclosure of network/external access. Newer plugins can use `SecretStorage` so settings store a secret name rather than the token. ([plugin checklist](https://docs.obsidian.md/oo/plugin), [SecretStorage guide](https://docs.obsidian.md/plugins/guides/secret-storage))
- JSON Canvas 1.0 is an open file format with top-level `nodes`/`edges`; core node types are `text`, `file`, `link`, and `group`. It is safe as a file-level interchange/projection contract, but the public spec is not an interactive Obsidian Canvas plug-in API. Read only the supported core subset from user-authored canvases; generate new deterministic projections rather than mutating a user's layout. ([JSON Canvas 1.0](https://jsoncanvas.org/spec/1.0/), [official repository](https://github.com/obsidianmd/jsoncanvas))
- Mermaid mind maps are indentation-based and support tidy-tree layout, but Mermaid still labels the diagram type experimental. Use fenced Mermaid for portable preview/export, not as the canonical round-trip editor format. ([Mermaid mindmap syntax](https://mermaid.js.org/syntax/mindmap.html), [Mermaid repository](https://github.com/mermaid-js/mermaid))

## Markdown and interactive editing design

Parse headings and nested ordered/unordered lists into stable internal nodes. Retain source positions and a base content hash. Unsupported Markdown blocks stay outside the editable map slice; ambiguous mixtures of headings and lists require user confirmation before adoption. Serialize only the accepted slice, preview the patch, then apply through `Vault.process()` only if the base hash still matches.

`mdast-util-from-markdown` produces mdast from Markdown, and `mdast-util-to-markdown` serializes mdast; both are MIT-licensed and small enough to keep the parser boundary explicit. ([parser README](https://github.com/syntax-tree/mdast-util-from-markdown), [parser license](https://raw.githubusercontent.com/syntax-tree/mdast-util-from-markdown/main/license), [serializer README](https://github.com/syntax-tree/mdast-util-to-markdown), [serializer license](https://raw.githubusercontent.com/syntax-tree/mdast-util-to-markdown/main/license))

Mind Elixir is framework-agnostic and already supplies drag/drop editing, keyboard operations, multi-select, undo/redo, an operation event bus, import/export, and pre-operation guards. It is not needed for the first-release outline editor. If adopted later, treat its nested object format strictly as transient UI state: translate it to edit intents against `MindMapDocument`; do not persist it as another source of truth. ([README/API examples](https://github.com/SSShooter/mind-elixir-core), [MIT license](https://raw.githubusercontent.com/SSShooter/mind-elixir-core/master/LICENSE))

## Graphify's role

The repository already has a subprocess-based Graphify adapter at `mcp-server/src/adapters/graphify.ts`, registered through the shared read-side adapter registry and documented at `docs/adapters/graphify.md`. That is the correct boundary:

- Graphify may enrich `vault.search`, `vault.graph`, and `vault.read`.
- A file-level graph edge may aggregate multiple provenance records while retaining Graphify's original relation, normalized confidence, adapter identity, and source evidence path.
- Extracted evidence can be presented with higher confidence than inferred or ambiguous evidence, but none of them authorizes a write.
- Graphify being unavailable must degrade to an empty optional signal and must not block outline editing, deterministic preview, or confirmed Markdown write-back.
- Ask Mate may turn selected Graphify evidence into a proposed structural diff. Only the user's acceptance places that relation into a `VisualEditPlan`.

Graphify is distributed as the MIT-licensed `graphifyy` package and remains an optional subprocess dependency. ([PyPI project](https://pypi.org/project/graphifyy/))

Local verification on 2026-07-19 found `graphify 0.8.47` available on PATH but no repository-local `graph.json`; adapter compatibility is therefore covered by deterministic extracted/inferred/ambiguous fixtures, while a real-vault smoke test remains part of the later integration gate.

## Candidate matrix

| Candidate | License | Direct reuse | Concept only | Self-build boundary |
|---|---|---|---|---|
| Obsidian API and sample plugin | API MIT; sample 0BSD | Plugin lifecycle, `ItemView`, commands, events, Vault/Editor/MetadataCache/SecretStorage patterns | — | Governance, edit plans, diagnostics contracts, and domain operations remain LLM Wiki code. ([API](https://github.com/obsidianmd/obsidian-api), [sample](https://github.com/obsidianmd/obsidian-sample-plugin)) |
| `mdast-util-from-markdown` + `mdast-util-to-markdown` | MIT | Parse/serialize bounded Markdown AST | — | Define the accepted outline grammar, stable IDs, ambiguity rules, opaque-block preservation, and hash-locked patching. |
| Mind Elixir | MIT | Optional follow-on tree widget behind an adapter | Its visual styling and persistence model are not product architecture | Keep it out of the first-release critical path; translate later UI operations into governed `MindMapDocument` edit intents. |
| Graphify (`graphifyy`) | MIT | Important optional read-side knowledge adapter and relation suggestions | It is neither a visual editor nor canonical map state | Preserve provenance and confidence; require user acceptance before a suggestion becomes a map edit. ([PyPI](https://pypi.org/project/graphifyy/)) |
| JSON Canvas | MIT specification/repository | Types/validation for core file interchange and deterministic export | Do not depend on unexposed Obsidian Canvas internals | Supported-subset importer, stable IDs/layout, provenance, and non-destructive projection policy. ([repo license](https://raw.githubusercontent.com/obsidianmd/jsoncanvas/main/LICENSE)) |
| Mermaid | MIT | Emit fenced `mindmap` projections and let Obsidian render them | Its experimental mindmap grammar is not the round-trip source | Escaping, deterministic projection, and graceful unsupported-node fallback. ([license](https://raw.githubusercontent.com/mermaid-js/mermaid/develop/LICENSE)) |
| Markmap | MIT | Optional read-only SVG preview if Mermaid is insufficient | Old Obsidian Mind Map demonstrates a pinned, current-note-following pane | Do not add Markmap beside Mind Elixir in the first slice; one renderer is enough. ([Markmap](https://github.com/markmap/markmap), [license](https://raw.githubusercontent.com/markmap/markmap/master/LICENSE), [Obsidian Mind Map](https://github.com/lynchjames/obsidian-mind-map)) |
| Obsidian Canvas MindMap | No repository license detected | None | Keyboard/navigation/layout ideas only | Reimplement against public JSON Canvas and Obsidian APIs; absence of a license grants no code-reuse permission. ([repository](https://github.com/Quorafind/Obsidian-Canvas-MindMap)) |
| React Flow / xyflow | MIT | None in the minimal stack | Strong general node-editor interaction reference | Avoid React/Svelte and graph-editor complexity for a tree-first slice. ([repository and license statement](https://github.com/xyflow/xyflow)) |
| Obsidian Copilot | AGPL-3.0 | None while the deliverable must stay GPL-3.0-only | `@` context, command palette, chat pane, and explicit edit/apply affordances | Rebuild Ask Mate over LLM Wiki operations; do not copy AGPL code into the GPL-only package. ([README](https://github.com/logancyang/obsidian-copilot), [license](https://raw.githubusercontent.com/logancyang/obsidian-copilot/master/LICENSE)) |
| Smart Connections | Custom source-available restriction | None | Related-note/context UX only | Its license restricts competing general-purpose Obsidian products and is incompatible with GPL's no-further-restrictions rule. ([repository](https://github.com/brianpetro/obsidian-smart-connections), [license](https://raw.githubusercontent.com/brianpetro/obsidian-smart-connections/main/LICENSE)) |
| Octokit REST.js | MIT | Optional only if the existing forge adapter cannot cover GitHub | — | Prefer the existing governed provider boundary; adding a second GitHub client would duplicate auth, receipts, and error policy. ([repository](https://github.com/octokit/rest.js), [license](https://raw.githubusercontent.com/octokit/rest.js/main/LICENSE)) |

## Ask Mate and diagnostic interoperability

Ask Mate should borrow the interaction vocabulary of a context-aware chat pane, not another agent/state architecture: attach current note/selection/map/observation as explicit context chips; return cited answers or typed proposed actions; render an immutable preview; require confirmation at the operation boundary.

For OBC and other plugin diagnostics, expose versioned, typed, read-only Host Capability Connectors. A connector should return provider/rule identity, subject, severity, bounded evidence references, health, and required permissions. Do not enumerate or call arbitrary private plug-in objects, scrape hidden `.obsidian` data, ingest raw logs wholesale, or let a diagnostic become an Issue automatically. Register listeners with `registerEvent`, wait for `onLayoutReady`, and isolate failures so a missing/incompatible provider reports degraded health instead of breaking Ask Mate. This follows Obsidian's lifecycle and compatibility guidance, including deferred-view checks in newer Obsidian versions. ([events](https://docs.obsidian.md/Plugins/Events), [load-time guidance](https://docs.obsidian.md/plugins/guides/load-time), [deferred views](https://docs.obsidian.md/plugins/guides/defer-views))

## GitHub Issue and verified draft-PR boundary

- GitHub's create-Issue endpoint is a real notification-producing side effect, can fail when Issues are disabled, and requires appropriate repository permission. Preserve the local observation and immutable outbound preview independently of the remote call and receipt. ([Issues REST API](https://docs.github.com/en/rest/issues/issues#create-an-issue))
- GitHub's create-PR endpoint accepts `draft: true`, requires a pushed head branch/write conditions, triggers notifications, and returns distinct permission/validation failures. Branch push and PR creation therefore need separate confirmations and replay receipts. ([Pull Requests REST API](https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request))
- Verification should bind the reviewed local head, declared test results, and exact diff/changed-file set to the contribution plan before push. GitHub's compare endpoint can corroborate the remote head/base relationship after push, but it does not replace local tests or user diff review. ([compare two commits](https://docs.github.com/en/rest/commits/commits#compare-two-commits))

## GPL-3.0-only conclusion

MIT, ISC, BSD, and 0BSD components can be included in a GPL-3.0-only combined distribution when their copyright/license notices are preserved. GPLv3 section 5 requires the combined covered work to remain GPLv3 and section 10 forbids further restrictions. GPLv3 section 13 permits combination with AGPLv3, but the AGPL portion and its network-source obligation remain; that does not meet this project's stricter “GPL-3.0-only” product constraint. Therefore:

- safe candidates for direct reuse: Obsidian API/sample patterns, mdast utilities, Mind Elixir, JSON Canvas definitions, Mermaid emission, and optionally Markmap/Octokit;
- concept-only: Obsidian Copilot (AGPL), Smart Connections (field-of-use/competition restriction), and unlicensed Canvas MindMap code;
- preserve a dependency/notice inventory and inspect transitive licenses before shipping.

Primary license text: [GNU GPL version 3](https://www.gnu.org/licenses/gpl-3.0.html). This is an engineering compatibility assessment, not legal advice.

## Minimal implementation order

1. Bounded Markdown outline parser/serializer plus stable IDs and hash-locked edit plans.
2. Obsidian `ItemView` with a keyboard outline, live preview, and confirmed apply.
3. Deterministic JSON Canvas and Mermaid projections; supported-core Canvas import remains read-only.
4. Graphify-assisted, provenance-visible, opt-in relation suggestions.
5. Ask Mate context/clarification UI over existing query and edit-plan operations.
6. Typed OBC/plugin diagnostic connectors feeding deduplicated Problem Intake observations.
7. Three-way contribution chooser, with local issue first; GitHub Issue second; verified isolated draft PR last.

## Granularity correction

The 63 OpenSpec checkboxes are a useful completeness checklist, but they mix domain contracts, implementation, cross-host integration, and release gates. They should not become 63 independently scheduled issues.

Use eight user-verifiable tracer bullets:

1. **Vocabulary and executable contracts** — canonical terms, strict schemas, negative validators, and reference fixtures.
2. **Markdown map safe round trip** — read one managed nested-list map, preview a structural change, hash-lock and apply it, preserving all surrounding bytes.
3. **Portable projections** — deterministic textual tree, Mermaid source, and JSON Canvas from the same document.
4. **Ask Mate minimum experience** — understand the active source, clarify ambiguity, preview changes, apply only after confirmation, and degrade without a model.
5. **OBC to local Work-OS loop** — normalize and deduplicate findings, show a local issue plan, and apply through Project Operations.
6. **Optional plugin diagnostics and Project Hub trace** — one allowlisted reference adapter, health/version drift, observation-to-issue-to-verification links.
7. **User-approved upstream Issue** — editable redacted preview, explicit approval, receipts, and outcome-unknown reconciliation.
8. **Verified draft PR** — isolated worktree, bounded diff, regression evidence, separate push confirmation, draft creation, and no merge.

Each tracer bullet needs one user-visible result, one deterministic fixture, one failure-closed scenario, and one cross-host or Obsidian acceptance check. Documentation and global release gates stay attached to the slice they verify instead of becoming a separate feature.

## Open questions reduced by evidence

- Canonical writes should emit one restricted syntax; ordinary headings and lists may still be accepted as read-only import candidates with ambiguity diagnostics.
- First Canvas import should support text nodes, file nodes, and directed edges. Groups can be preserved and reported but should not determine canonical parentage until fixtures prove the interpretation.
- OBC remains the first diagnostic provider. Advanced Canvas is a strong locally installed candidate for a later compatibility adapter because it has a documented JSON format extension and namespaced events; adoption still requires a versioned spike.
- Node/depth limits should be decided by a mobile performance and accessibility prototype, not by preference.
- Gitea should follow GitHub before GitLab because this repository already has a governed Gitea remote and therefore supplies a real acceptance environment.

## Product decision resolved

The first public Ask Mate slice is **outline-first**: edit a keyboard-operable structured outline, see a live deterministic visual preview, and apply through the governed plan/confirmation boundary. Direct node dragging and installed Obsidian mind-map extensions are optional follow-on adapters.

Graphify is important but optional. The core loop must work without it; when present, its provenance-bearing relations improve understanding and suggested structure without becoming authoritative.
