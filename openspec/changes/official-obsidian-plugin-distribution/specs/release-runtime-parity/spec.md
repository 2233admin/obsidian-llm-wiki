## MODIFIED Requirements

### Requirement: Obsidian release gate
The release workflows SHALL test, typecheck, and build the Obsidian plugin, SHALL verify runtime bridges pass executable arguments without shell-dependent command concatenation, and SHALL reject plugin publication when the tag, root metadata, plugin metadata, or standard release assets are inconsistent.

#### Scenario: Windows Python launcher uses arguments
- **WHEN** the plugin invokes `py -3` for migration or doctor
- **THEN** it launches executable `py` with argument `-3` and the requested script arguments as separate argv entries

#### Scenario: Plugin distribution metadata drifts
- **WHEN** the root manifest, plugin manifest, compatibility map, or triggering plugin tag disagree
- **THEN** the release workflow fails before publication

#### Scenario: Standard plugin asset is missing
- **WHEN** the built release directory lacks `main.js`, `manifest.json`, or `styles.css`
- **THEN** the release workflow fails before publication
