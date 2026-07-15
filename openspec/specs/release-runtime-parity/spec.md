# release-runtime-parity Specification

## Purpose
TBD - created by archiving change complete-settings-platform-and-fleet-release. Update Purpose after archive.
## Requirements
### Requirement: Source and shipped bundle parity
The generated MCP bundle SHALL expose the same operation names and contracts as the TypeScript source registry used to build it.

#### Scenario: Release bundle smoke runs
- **WHEN** CI starts the generated bundle through the supported setup path
- **THEN** settings, project context, Project Hub, migration, and workflow operations are discoverable and callable

### Requirement: Complete default test discovery
The default MCP test command and CI SHALL execute both legacy `tests/**` suites and colocated `src/**/*.test.ts` suites.

#### Scenario: A colocated regression test fails
- **WHEN** a failing test exists under `mcp-server/src/`
- **THEN** the default test command and release workflow fail

### Requirement: Obsidian release gate
The release workflow SHALL test, typecheck, and build the Obsidian plugin and SHALL verify runtime bridges pass executable arguments without shell-dependent command concatenation.

#### Scenario: Windows Python launcher uses arguments
- **WHEN** the plugin invokes `py -3` for migration or doctor
- **THEN** it launches executable `py` with argument `-3` and the requested script arguments as separate argv entries

### Requirement: Reproducible generated artifacts
Generated release artifacts SHALL be rebuilt during verification and SHALL leave no uncommitted diff when the committed artifacts are current.

#### Scenario: Source operation changes without bundle rebuild
- **WHEN** an operation is added to source but the committed bundle is stale
- **THEN** the release gate fails before merge or publication

