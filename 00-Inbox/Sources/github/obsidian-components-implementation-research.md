---
llmwiki-source: true
llmwiki_type: source_record
source_id: "src_obsidian_components_release_3_1_260826"
url: "https://github.com/obsidian-components/obsidian-components-release"
canonical: "https://github.com/obsidian-components/obsidian-components-release"
platform: "github"
source_kind: "release-repository"
access_context: "public"
status: planned
actor: "codex"
tags: ["obsidian-components", "obsidian-plugin", "release-only", "closed-source", "visual-workspace", "provenance", "supply-chain"]
created_at: "2026-08-27T00:00:00.000Z"
updated_at: "2026-08-31T00:00:00.000Z"
---

# Obsidian Components implementation research

<!-- REVIEW: COMPLETE -->
<!--
  Review date: 2026-09-02
  Reviewer: codex
  Findings:
    1. COMPLETENESS: Core APIs covered. Gaps noted below.
    2. BROKEN LINKS: None found. All GitHub URLs point to valid paths.
    3. ADR ALIGNMENT: Aligns with docs/superpowers/specs/2026-08-27-components-internalization-design.md
       and with packages/agent-wiki-contracts/src/template-manifest.ts and
       packages/visual-workspace/src/template-import.ts. The local manifest contract is narrower
       than the observed sample schema (see gaps below); this is intentional per the design doc
       and correctly documented in section "Local implementation and contract evidence".
    4. ADR PROMOTION CANDIDATE: Section "Effect on the bounded internalization slice" encodes
       three significant architectural decisions that should be lifted to formal ADRs:
         - Store .components as opaque hash-locked external-observation artifacts
         - Use manifest-plus-artifact envelope for all write operations
         - Stop condition: no code internalization without license + dependency audit
       Recommend authoring ADR-0007 for these three supply-chain provenance decisions.
  Gaps (minor):
    - Sample Home.components reveals component types not explicitly named in the bundle-string
      section: dynamicDataView, quote, countdown, time. These appear as type values in the
      sample but not as feature labels in the bundle scan. Add to Feature-string evidence.
    - TemplateManifestV1 component types (multi, data-view, form, card, count, markdown, time)
      are a proper subset of the sample's observed types (dynamicDataView, quote, countdown,
      dynamicDataView with viewType). This is intentional per the design spec but could
      confuse a reader who expects 1:1 correspondence. A note clarifying the mapping gap
      would help.
    - The "Bounded first internalization slice" is a roadmap; it is unclear which items
      are implemented vs. planned. Consider adding a status column or checklist.
-->

## Source

- Input and canonical source: [obsidian-components/obsidian-components-release](https://github.com/obsidian-components/obsidian-components-release)
- Source kind: public GitHub release repository for the Obsidian `Components` plugin; the repository describes itself only as “Obsidian missing components.”
- Research scope: latest published tag/release `3.1.260826`, its attached assets, the tag tree and release automation, the owning organization and author links, and the linked first-party site.
- Clean-room rule: the published `main.js` was inspected only for feature strings/labels. No bundled implementation was copied, decompiled, or reproduced.

## Preflight / Access

### Repository relationship

The release repository's `3.1.260826` tree contains `README.md`, `manifest.json`, `manifest-BETA.json`, and `nightlyRelease.sh`; the tree does not contain plugin source files or a license file ([tag tree](https://github.com/obsidian-components/obsidian-components-release/tree/3.1.260826)). The README contains only the repository title and the short description ([README](https://raw.githubusercontent.com/obsidian-components/obsidian-components-release/3.1.260826/README.md)).

The `obsidian-components` organization page lists three public repositories: the release repository, `para-sample-vault`, and `blog-sample-vault` ([organization](https://github.com/obsidian-components)). Neither sample vault is a plugin source repository. The author's public repository list does expose a separate `vran-dev/obsidian-components-site` (“web site for obsidian components plugin”), plus related templates/projects, but no public source repository for the plugin implementation ([author repositories](https://github.com/vran-dev?tab=repositories)). Therefore, **no public plugin source repository was found in the inspected organization and author repository listings**. This is a bounded negative finding, not proof that a private or unlisted source repository does not exist.

### Latest release and cadence

The latest release page inspected is `3.1.260826`, marked **Pre-release**, published by `vran-dev` on 2026-08-26 ([release page](https://github.com/obsidian-components/obsidian-components-release/releases/tag/3.1.260826)). The release Atom feed records ten entries from 2026-08-03 through 2026-08-26, including consecutive date-stamped releases `3.1.260823` through `3.1.260826`; it also records the earlier `3.0.260819` title despite the `3.1.260819` tag URL ([raw release feed](https://github.com/obsidian-components/obsidian-components-release/releases.atom)). The observed pattern is a date-stamped beta cadence with several short runs and gaps, **not evidence of a guaranteed daily SLA**.

The stable manifest identifies plugin id `components`, name `Components`, version `3.1.0`, minimum Obsidian version `0.14.0`, author `vran`, desktop support `false`, and the funding URL ([stable manifest](https://raw.githubusercontent.com/obsidian-components/obsidian-components-release/3.1.260826/manifest.json)). The beta manifest carries the date-stamped version `3.1.260826` with the same id, minimum app version, author, and platform fields ([beta manifest](https://raw.githubusercontent.com/obsidian-components/obsidian-components-release/3.1.260826/manifest-BETA.json)). The stable/beta version difference is observable; its release-channel policy is not documented in the release-only repository.

## Findings

### Artifact inventory for `3.1.260826`

The expanded GitHub asset listing exposes six release assets ([expanded assets](https://github.com/obsidian-components/obsidian-components-release/releases/expanded_assets/3.1.260826)):

| Asset | Observed size / timestamp | Published SHA-256 when shown | What it establishes |
|---|---:|---|---|
| `3.1.260826.zip` | 4.31 MB, 2026-08-26 01:18:29Z | `d62c9dac746ac1f04f927e6a17f386b22165f69ffbdcfc87bc4871933aef143b` | Packaged plugin release archive |
| `main.js` | 8.67 MB, 2026-08-26 01:18:33Z | `90c70dcbef13bb5e60dab58ffca05f517d030a8d85b056edd2a2f69a5f2fae81` | Bundled executable JavaScript artifact |
| `manifest.json` | 296 bytes, 2026-08-26 01:18:33Z | `033ba9a6178c706a55c7a99b58ecacd3c4559b8800e9b2fa21bbb6476ec5d3a0` | Stable-channel manifest asset |
| `styles.css` | 815 KB, 2026-08-26 01:18:36Z | `fd7d36420d9891c80e68623779835b7d77c85d8c73500fc75a15fe080b627825` | Stylesheet artifact |
| Source code (zip) | 2026-08-26 01:17:55Z | not shown | Archive of the release repository tag, not plugin source |
| Source code (tar.gz) | 2026-08-26 01:17:55Z | not shown | Archive of the release repository tag, not plugin source |

The direct bundle URL is [published `main.js`](https://github.com/obsidian-components/obsidian-components-release/releases/download/3.1.260826/main.js). The inventory establishes availability and integrity hashes, but not build reproducibility, source correspondence, or dependency provenance.

### Feature-string evidence from the published bundle

<!-- REVIEW NOTE: Gaps in bundle-string section — the scan misses type values that appear
     in the sample Home.components but not as feature labels in main.js:
       - dynamicDataView (observed as type: "dynamicDataView" in sample)
       - quote (observed as type: "quote" in sample)
       - countdown (observed as type: "countdown" in sample)
     These may be settings-only strings, internalized identifiers, or render-time labels
     not present as top-level strings. They should be noted here as "sample-only" types
     and marked as "inferred" to avoid implying they were verified in the bundle scan. -->

A string-only scan of the published bundle found the following labels/keys. These are **artifact evidence of names present in the shipped bundle, not proof of every runtime path or interaction** ([published `main.js`](https://github.com/obsidian-components/obsidian-components-release/releases/download/3.1.260826/main.js)):

- Component concepts: `components`, `custom_component`, `reference_component`, `select_component_file`, `sub_components`, and `script_folder_for_components`.
- Dataview integration labels: `Dataview`, `dataview_query`, `dataviewjs`, and “Wrap and render dataview as component.”
- Database-view labels: table, gallery, waterfall, list, calendar, group, metric, reference, charts, Markdown, button, binding, date page, time banner, built-in, and third-party view keys. `Kanban` and `Gantt` labels are also present.
- Widget labels: time, attachments, card, embedded Markdown, dynamic data view, button, clock, count, date progress, timing, countdown, quote, multi, chart, statistical number, check-in, and Dataview.
- Chart labels: heatmap, bar, horizontal bar, horizontal stack bar, stack bar, line, pie, doughnut, and funnel.
- Content/data labels: formulas and formula AI assistance, advanced query, templates, frontmatter update, and property-related settings.

The first-party site independently presents a narrower, user-facing subset: filtered data views switchable among table, gallery, kanban, calendar, and Gantt; charts including bar, line, pie, calendar heatmap, funnel, and stacked charts; “15+” composable components; Markdown embedding; JSX-created custom components; and buttons that can execute commands, create files, or open links ([deployed site](https://cp.cc1234.cc/)). These are publisher claims and should be treated as product documentation/marketing evidence rather than a substitute for source-level verification.

### Release automation observations

`nightlyRelease.sh` reads the version from `manifest.json`, keeps its first two dot-separated components, generates a `yyMMdd` date, writes that date-stamped value to `manifest-BETA.json`, then runs `git add`, commits with `Release $new_version`, pushes, creates the tag, and pushes tags ([script at tag](https://raw.githubusercontent.com/obsidian-components/obsidian-components-release/3.1.260826/nightlyRelease.sh)). The latest release commit is `b926ab65c72ec0bc020ba86da52cc956c6bbf864`; its visible diff changes only the beta manifest version from `3.1.260825` to `3.1.260826` ([commit](https://github.com/obsidian-components/obsidian-components-release/commit/b926ab65c72ec0bc020ba86da52cc956c6bbf864)).

**[INFERENCE]** The repository is intended as a packaging/distribution mirror whose version bump and tag are automated around a date-stamped beta channel; it is not the implementation's development repository. The observed script does not itself prove that the bundle assets are rebuilt or tested by the same job.

### First-party site and related source

The author profile links `https://cp.cc1234.cc` and `https://blog.cc1234.cc`; the Components site repository identifies itself as the website for the plugin and is Apache-2.0 licensed ([site repository](https://github.com/vran-dev/obsidian-components-site)). Its Docusaurus config names `https://cp.cc1234.cc` as the deployment URL and describes the product as visual systems, dashboards, and data-driven workflows in Obsidian ([site config](https://raw.githubusercontent.com/vran-dev/obsidian-components-site/main/docusaurus.config.ts)). The site repository is first-party documentation/site code, **not the plugin implementation**.

### Licensing and supply-chain limits

- No `LICENSE` file is present in the inspected release tag tree, and neither manifest declares a plugin license ([tag tree](https://github.com/obsidian-components/obsidian-components-release/tree/3.1.260826), [manifest](https://raw.githubusercontent.com/obsidian-components/obsidian-components-release/3.1.260826/manifest.json)).
- The Apache-2.0 license visible on `vran-dev/obsidian-components-site` applies to that site repository; it must not be assumed to license the plugin bundle ([site repository](https://github.com/vran-dev/obsidian-components-site)).
- The release inventory exposes no source map, SBOM, dependency lockfile, or third-party notice alongside `main.js` ([expanded assets](https://github.com/obsidian-components/obsidian-components-release/releases/expanded_assets/3.1.260826)). The 8.67 MB bundle size and feature strings suggest substantial bundled code, but do not identify its dependencies or licenses.
- **Risk:** internalizing implementation code, or distributing a derivative, would require an explicit license/notice determination and dependency audit. The release-only evidence is insufficient for either.
### Local sample evidence (verified)

The checked-in sample materials establish provenance and handling for a local, redistributable sample vault, and provide a bounded observation of one persisted `.components` document:

- [`docs/samples/components/README.md`](../../../docs/samples/components/README.md) says this directory redistributes third-party Obsidian vaults as usage references. It says each entry retains the upstream `LICENSE`, and is included only when its license permits redistribution. Its table identifies `para-sample-vault/` as Apache-2.0. The same README says LLM Wiki does not modify these vault contents and that redistribution must preserve each upstream `LICENSE` and corresponding upstream notice where present.
- [`para-sample-vault/README.md`](../../../docs/samples/components/para-sample-vault/README.md) describes a Components-associated file for each area as a visual management entry, stored under `resource/components/area`. It also documents area/project folders and links between project `area` properties and area notes. These are sample-vault usage notes, not a plugin contract.
- [`para-sample-vault/Home.components`](../../../docs/samples/components/para-sample-vault/Home.components) is a persisted JSON document whose root object has a top-level `components` array. In representative entries, component objects have UUID-looking `id` values, a `type` (including `multi` and `count`), presentation/settings fields such as `titleAlign`, `tabTitle`, `maxWidthRatio`, `showBorder`, and `showShadow`, and ISO-like `createAt`/`updateAt` timestamps. A `multi` entry contains nested `components` references with `componentId` UUIDs and `layout` objects for `mobile` and `laptop`; those layouts expose integer `x`, `y`, `w`, and `h` fields. The same entry shows `layoutType: "grid"`, `locked: true`, and `layoutOptions: {}`. Representative `count` entries show `contentPrefix`, `contentSuffix`, `countType`, `title`, and query objects with `valueType`, `value`, and nested filters; observed filter fields include UUID `id`, `type`, `operator`, `conditions`, `property`, and `value`.

This is evidence from one redistributed local sample and one file. It does **not** establish the external plugin's complete `.components` schema, validation rules, persistence behavior, or runtime contract, and it does not change the release-only licensing and clean-room limits above.

### Local implementation and contract evidence (2026-08-31)

The local branch now has a host-neutral, contract-first path for treating a `.components` upload as evidence. This is **local LLM Wiki implementation evidence, not the external Components plugin implementation or a claim about its runtime**:

- [`packages/agent-wiki-contracts/src/template-manifest.ts`](../../../packages/agent-wiki-contracts/src/template-manifest.ts) defines the closed `TemplateManifestV1` contract: source/template SHA-256 locks, a finite component-kind set, explicit child/layout/form/action fields, diagnostics, provenance, and a deterministic fingerprint. Validation rejects unknown fields, dangling or duplicate IDs, unsafe paths/secrets, invalid layouts/actions, and fingerprint mismatches.
- [`packages/visual-workspace/src/template-import.ts`](../../../packages/visual-workspace/src/template-import.ts) consumes a caller-supplied manifest plus `{ path, sha256 }`, verifies that source lock, and returns a recursively frozen `readOnly` preview after bounded path/text checks. It does not execute plugin code or write the vault.
- [`mcp-server/src/visual-workspace/template-import-reader.ts`](../../../mcp-server/src/visual-workspace/template-import-reader.ts) accepts only the exact `{ manifest, artifactContent }` JSON envelope, enforces 2 MiB envelope/artifact limits, and hashes the supplied artifact bytes against the manifest source lock. [`mcp-server/src/visual-workspace/template-import-ops.ts`](../../../mcp-server/src/visual-workspace/template-import-ops.ts) exposes this as `visual.template.preview` with `mutating: false`; its tests verify no vault access, deterministic fingerprints, and rejection of malformed JSON, unsafe paths, source/hash mismatches, oversized input, and extra envelope fields ([operation tests](../../../mcp-server/src/visual-workspace/template-import-ops.test.ts), [manifest tests](../../../packages/agent-wiki-contracts/tests/template-manifest.test.ts), [preview tests](../../../packages/visual-workspace/tests/template-import.test.ts)).

The observed sample's nested `multi.components` entries (`componentId` plus per-device `layout`) and presentation/timestamp fields do not fit the local manifest's flat `children: string[]`, bounded layout, and allowlisted field model ([sample](../../../docs/samples/components/para-sample-vault/Home.components), [local type contract](../../../packages/agent-wiki-contracts/src/template-manifest.ts)). This mismatch is evidence for an explicit observation adapter and diagnostics, **not** evidence that the external plugin accepts or produces the local contract.

<!-- REVIEW NOTE: Type mapping summary for future readers:
     Local TemplateManifestV1 supports: multi, data-view, form, card, count, markdown, time.
     Observed sample types NOT in local contract: dynamicDataView, quote, countdown.
     This is intentional per the design spec — the contract is a bounded internal slice,
     not a 1:1 replica of the external plugin. The diagnostic system handles unmapped types. -->

### Effect on the bounded internalization slice

<!-- REVIEW NOTE: The research doc correctly references
     docs/superpowers/specs/2026-08-27-components-internalization-design.md as the design
     document. The existing ADR range (0001-0006 in the code-intel index) appears to be stale
     or points to files renamed/moved. The actual ADR files on disk (0001-project-hub-*.md,
     0002-workflow-*.md, 0003-workflow-*.md) cover project-hub recovery flows and read
     projections, not visual-workspace or external-source provenance. No conflict with this
     research note was found in the on-disk ADRs.

     RECOMMEND PROMOTION TO FORMAL ADR:
     This section encodes three architecturally significant decisions that apply beyond
     this single research note:
       1. Store external .components artifacts as opaque, hash-locked external-observation
          artifacts — never as runtime-compatible wire formats.
       2. All write operations pass through a manifest-plus-artifact envelope with source locks,
          size limits, and deterministic fingerprints; no plugin code execution, no renderer
          emulation, no write/apply behavior inferred from preview paths.
       3. Stop condition: no code internalization until the publisher provides the plugin
          license, third-party notices/dependency inventory, and implementation
          source/build provenance.
     These are supply-chain provenance decisions that affect every future external-source
     ingestion path. They should be captured as an ADR rather than living only in this
     research note, which is scoped to a single source. Aligns with
     docs/superpowers/specs/2026-08-27-components-internalization-design.md sections 2, 3.1,
     3.2, and 13. -->

1. Keep `Home.components` as an opaque, hash-locked external-observation artifact. Produce a `TemplateManifestV1` only through an explicit, versioned observation adapter; map fields covered by the local contract and emit `unsupported`/`ambiguous` diagnostics with evidence for nested layout metadata and other unmapped sample fields ([diagnostic contract](../../../packages/agent-wiki-contracts/src/template-manifest.ts), [sample](../../../docs/samples/components/para-sample-vault/Home.components)).
2. Send only the manifest-plus-artifact envelope through `visual.template.preview`; preserve the read-only, source-lock, size-limit, safe-input, and deterministic-fingerprint gates. Do not execute the plugin, emulate its renderer/database/query runtime, or infer write/apply behavior from this local preview path ([reader](../../../mcp-server/src/visual-workspace/template-import-reader.ts), [operation](../../../mcp-server/src/visual-workspace/template-import-ops.ts)).
3. This narrows the slice to provenance-backed normalization and review of observed capability data. The existing clean-room, licensing, dependency, and implementation-source/build-provenance stop conditions remain unchanged.

## Clean-room boundary

Allowed evidence in this note is limited to repository metadata, release/tag metadata, manifests, the release script, published asset inventory/hashes, first-party site text, non-executable feature strings from the published `main.js`, and the checked-in sample-vault documentation and persisted sample data identified above. No implementation logic, deminified code, class structure, algorithm, or copied bundle text is included. A feature label is recorded as a label only; local sample fields are recorded as observations from that sample, not as a complete plugin schema or runtime contract; runtime behavior is marked as a publisher claim or remains an open question unless independently documented.

## Relevance to LLM Wiki

The local `packages/agent-wiki-contracts` Foundation is a host-neutral, versioned serialization boundary for capability profiles, source-versioned manifests, evidence, and receipts. The local `packages/visual-workspace` core makes ordinary Markdown the canonical source, preserves source ranges and block IDs, records relation provenance, and requires immutable edit plans, complete source locks, and explicit apply confirmation ([local visual-workspace contract](../../../packages/visual-workspace/README.md)).

### Bounded first internalization slice

<!-- REVIEW NOTE: This slice is a roadmap but does not distinguish implemented from planned items.
     A status column or checklist would help readers understand current state.
     Refer to packages/visual-workspace/ and mcp-server/src/visual-workspace/ for
     implemented vs. pending items. -->

1. **Do not import the plugin bundle or treat this release repository as source.** Register this source note and its exact release asset hashes as external provenance.
2. Create one read-only, Foundation-compatible capability record for a small, curated subset: `Components → data views → table/gallery/kanban/calendar/Gantt`, plus `Components → Markdown/custom component`. Store each item with its source URL, observed-vs-claimed status, release version, and retrieval hash.
3. Use the existing visual-workspace Markdown contract to produce a small reviewable mind-map projection of those capability relationships. Mark bundle-string observations as `extracted`; mark site-only behavior claims as `inferred` or `unknown` until a stronger first-party contract appears. Keep Canvas/Mermaid as derived projections, never as authority.
4. Route any write through `createVisualEditPlan` and the existing source-lock/apply boundary. This slice should add provenance-backed catalog/projection evidence only; it should not execute Components, emulate its database engine, or redesign Foundation.
5. Stop before code internalization until the plugin license, third-party notices/dependency inventory, and the implementation source/build provenance are obtained from the publisher.

This slice is intentionally narrow: it tests whether a release-only external capability can be represented and reviewed inside current Markdown-first contracts without creating a second runtime or weakening provenance controls.

## Open questions

- Is the plugin implementation maintained in a private or unlisted repository, and which source/build commit produced `main.js` for `3.1.260826`?
- What license governs the plugin bundle and its bundled dependencies? Where are copyright notices and third-party attributions?
- Does the stable `3.1.0` manifest correspond to the same implementation as beta `3.1.260826`, or are they separate release channels?
- Which labels correspond to supported runtime components versus legacy, experimental, or settings-only strings?
- What exact Markdown/frontmatter/property schema does the plugin read and write, and how does it handle failures or malformed notes?
- Are site claims such as “15+ components,” AI assistance, and command/file/link buttons covered by a versioned first-party contract or only by the marketing site?

## References

1. [Release repository](https://github.com/obsidian-components/obsidian-components-release)
2. [Latest release `3.1.260826`](https://github.com/obsidian-components/obsidian-components-release/releases/tag/3.1.260826)
3. [Expanded release assets and SHA-256 values](https://github.com/obsidian-components/obsidian-components-release/releases/expanded_assets/3.1.260826)
4. [Latest tag tree](https://github.com/obsidian-components/obsidian-components-release/tree/3.1.260826)
5. [Published `main.js`](https://github.com/obsidian-components/obsidian-components-release/releases/download/3.1.260826/main.js)
6. [Stable manifest](https://raw.githubusercontent.com/obsidian-components/obsidian-components-release/3.1.260826/manifest.json)
7. [Beta manifest](https://raw.githubusercontent.com/obsidian-components/obsidian-components-release/3.1.260826/manifest-BETA.json)
8. [Release automation script](https://raw.githubusercontent.com/obsidian-components/obsidian-components-release/3.1.260826/nightlyRelease.sh)
9. [Latest release commit](https://github.com/obsidian-components/obsidian-components-release/commit/b926ab65c72ec0bc020ba86da52cc956c6bbf864)
10. [Raw release Atom feed](https://github.com/obsidian-components/obsidian-components-release/releases.atom)
11. [Owning organization repositories](https://github.com/obsidian-components)
12. [Author's repositories](https://github.com/vran-dev?tab=repositories)
13. [First-party site repository](https://github.com/vran-dev/obsidian-components-site)
14. [First-party site deployment config](https://raw.githubusercontent.com/vran-dev/obsidian-components-site/main/docusaurus.config.ts)
15. [First-party Components site](https://cp.cc1234.cc/)
