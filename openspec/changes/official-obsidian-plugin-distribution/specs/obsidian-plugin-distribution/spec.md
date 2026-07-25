## ADDED Requirements

### Requirement: Obsidian-compatible release identity
The repository SHALL publish an Obsidian plugin release whose Git tag exactly equals the semantic version in the plugin manifest.

#### Scenario: Plugin release tag matches manifest
- **WHEN** a plugin release workflow runs for tag `0.4.0-beta.3`
- **THEN** the plugin manifest version is `0.4.0-beta.3`

#### Scenario: Plugin release tag differs from manifest
- **WHEN** the triggering tag and manifest version differ
- **THEN** publication fails before creating or updating a GitHub Release

### Requirement: Standard plugin release assets
The plugin release SHALL attach `main.js`, `manifest.json`, and `styles.css` as individually downloadable files.

#### Scenario: Obsidian installs the release
- **WHEN** Obsidian resolves the release matching the manifest version
- **THEN** all three standard plugin files are available under their exact names

### Requirement: Repository metadata compatibility
The repository root SHALL expose the current `manifest.json`, README, and `versions.json` metadata needed by Obsidian's Community Plugins directory.

#### Scenario: Directory reads plugin metadata
- **WHEN** the Community Plugins directory inspects the repository
- **THEN** root metadata identifies the current plugin version and its minimum compatible Obsidian version

### Requirement: Existing installation identity remains stable
Official distribution SHALL retain the existing plugin ID so manual and BRAT installations update in place without losing plugin data.

#### Scenario: Existing user installs official release
- **WHEN** a vault already contains plugin ID `vault-mind-promote`
- **THEN** the official package is installed as an update to that plugin identity
