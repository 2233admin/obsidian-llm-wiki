# LLM Wiki for Obsidian

The Obsidian-native control surface for LLM Wiki. Version 0.2 introduces the
first system-settings vertical slice while preserving the existing governed
Promote workflow.

## Settings surface

Open Obsidian → Settings → LLM Wiki to configure:

- the Python runtime and `compiler/kb_meta.py` binding for this device;
- semantic query behavior for the current vault;
- optional link-diagnostics semantic suggestions;
- inherited, local, or cloud Agent model connections;
- secret references for providers without storing secret values;
- effective-value provenance, inheritance, validation, and capability health.

Settings use a versioned contract and deterministic scope order:

```text
session > workspace-project > vault > user-device > product default
```

The first UI slice edits user-device and vault scopes. Workspace-project and
session remain part of the resolution contract but are not exposed until the
plugin has a real project identity and session lifecycle to bind them to.

The plugin automatically migrates the former `pythonPath` and `kbMetaPath`
fields into the versioned user-device scope. The plugin ID remains
`vault-mind-promote` so existing installations and their data continue to load.

Run **Doctor** from the settings page to check the Python runtime, LLM Wiki
entry point, Agent model mode, effective settings, LLM Wiki link-diagnostics availability, and provider secret
references. Doctor reports health but does not expose secret values or run
diagnostic mutations.

## Knowledge promotion

The existing **Promote candidate (LLM Wiki)** command and file-menu action are
unchanged. They run `kb_meta promote` as a dry-run, show the materialized plan,
and write only after explicit confirmation. The work-OS base-head lock remains
authoritative and the plugin never auto-commits.

## Agent control plane

Run **Open Agent control plane (LLM Wiki)** or use the buttons in Settings to:

- create versioned Agent Profiles and Project Agent Bindings through shared backend operations;
- inspect derived Rooms, durable Threads, related Work Runs, approved memory fingerprints, connector state, and diagnostics;
- review Dream Time diffs and warnings, approve or reject exact proposal fingerprints, inspect revision history, and hand candidates to the existing Promotion path;
- execute workflow-prepared, scoped read-only context consults and review Delegation Plans with capability, budget, device, side-effect, child-run, and artifact provenance details;
- inspect Project Hub, connector/expert health, and privacy-safe Usage summaries.

On desktop filesystem vaults the plugin loads the shared Settings, Project,
Agent, Dream Time, Consult, Delegation, Project Hub, Usage, and legacy-migration
Operations in-process through the governed Operation dispatcher. It does not
import or start the MCP listener, RAG runtime, or Python adapters. Mobile and
non-filesystem vaults report this control plane as explicitly unavailable.
`setAgentControlPlaneTransport` remains as the test and alternate-host injection
seam, and an unavailable optional Host projection degrades independently.
The Agent control plane remains a stateless client surface.
Obsidian does not copy Room state, approval state, historical Usage facts,
plaintext credentials, usable grant/lease tokens, or governance composition.
Provider credentials continue to use the Secret Reference selectors in the
Settings section.

## Build and test

```bash
cd obsidian-plugin
npm install
npm test
npm run build
```

Copy `manifest.json`, `main.js`, and `styles.css` into:

```text
<your-vault>/.obsidian/plugins/vault-mind-promote/
```

The plugin is desktop-only because runtime operations use Node child processes
and the production control plane requires a filesystem vault. The bundled
plugin is licensed under GPL-3.0-only, matching the shared Agent Domain and MCP
operation code included in the production artifact.
