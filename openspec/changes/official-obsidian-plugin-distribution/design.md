## Context

The repository publishes one umbrella `v*` release containing tarballs for the MCP server, compiler, and Obsidian plugin. Obsidian's installer instead resolves a release tag equal to `manifest.json.version` and downloads `main.js`, `manifest.json`, and optional `styles.css` as individual assets. The existing product release must remain independently versioned and gated by signed fleet evidence.

## Goals / Non-Goals

**Goals:**

- Publish an Obsidian-installable release from the existing tested plugin build.
- Keep plugin and product release versions independent.
- Validate tag, manifest, compatibility metadata, and asset names before publication.
- Support BRAT beta installation and later Community Plugins submission.

**Non-Goals:**

- Submit to the Obsidian directory automatically.
- Change the plugin ID or migrate existing plugin data.
- Add another settings backend or hosted cloud service.

## Decisions

- Add a separate workflow triggered by tags matching the plugin version without a `v` prefix. This follows Obsidian's exact tag lookup while preserving the umbrella `v*` workflow.
- Treat `obsidian-plugin/manifest.json` as the plugin version source and require the triggering tag to equal it exactly.
- Commit root `manifest.json` and `versions.json` compatibility projections because the Obsidian directory reads repository-root metadata. Validate them against the canonical files under `obsidian-plugin/`.
- Upload raw plugin files and also retain the tarball as a convenience artifact. Obsidian consumes only the raw files.
- Reuse existing plugin build, bundle-boundary, and lifecycle verifiers; add one small distribution-contract verifier rather than duplicating release logic.

## Risks / Trade-offs

- [Two release version streams can confuse maintainers] → Name workflows and documentation explicitly as Product Release versus Obsidian Plugin Release.
- [Root and plugin manifests can drift] → Fail CI and release when their bytes differ.
- [A plugin tag could publish untested files] → Build from the tagged commit and verify the generated bundle plus distribution contract before release.
- [Community review may require further policy changes] → Keep directory submission manual and address review feedback in a later change.

## Migration Plan

1. Add compatibility metadata and distribution verification.
2. Add the plugin-specific workflow.
3. Create a plugin-version tag from a commit that passes CI.
4. Install through BRAT and verify update behavior.
5. Submit a stable release to Community Plugins after beta feedback.

Rollback is deleting the plugin-specific GitHub release/tag; the umbrella product release remains unaffected.

## Open Questions

- Community directory submission timing depends on beta feedback, not implementation readiness.
