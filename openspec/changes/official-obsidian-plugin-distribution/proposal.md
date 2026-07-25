## Why

LLM Wiki's Obsidian plugin currently ships only inside the umbrella `v*` release as a tarball, so Obsidian and BRAT cannot install or update it through the standard plugin mechanism. The plugin must publish the exact files and version/tag contract expected by Obsidian before ordinary users can install it without command-line steps.

## What Changes

- Add an Obsidian-plugin-specific release workflow triggered by the plugin version tag.
- Publish `main.js`, `manifest.json`, and `styles.css` as individual release assets.
- Add and validate `versions.json` compatibility metadata.
- Keep the existing umbrella product release and its signed fleet evidence gate unchanged.
- Document BRAT beta installation and the path to Community Plugins submission.

## Capabilities

### New Capabilities

- `obsidian-plugin-distribution`: Defines installable, update-compatible Obsidian plugin releases and their validation contract.

### Modified Capabilities

- `release-runtime-parity`: Requires the plugin-specific release assets to match the built and tested plugin runtime.

## Impact

- `.github/workflows/`
- `obsidian-plugin/manifest.json`, `obsidian-plugin/versions.json`, and plugin release documentation
- Release validation scripts/tests
- GitHub Releases and future Obsidian Community Plugins submission
