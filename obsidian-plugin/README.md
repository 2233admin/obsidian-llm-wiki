# LLM Wiki for Obsidian

The Obsidian-native control surface for LLM Wiki.

## First run

1. Click the **sparkles** icon in Obsidian's left ribbon, or run **Open Ask Mate
   (LLM Wiki)** from the command palette.
2. Enter a stable Project ID such as `project/my-project`. The binding stays on
   this device.
3. Ask Mate opens the active Markdown note, selected text, core Canvas, or the
   current Project when no supported file is active.

You can change the binding later in **Settings → LLM Wiki → Get started**.
Ask Mate reads only the context shown in its panel and never scans the vault
implicitly.

## Install

During beta, install [BRAT](https://github.com/TfTHacker/obsidian42-brat), choose
**Add a beta plugin**, and enter
`https://github.com/2233admin/obsidian-llm-wiki`. Then enable **LLM Wiki**.

After acceptance into Obsidian's Community Plugins directory, install it from
**Settings → Community plugins → Browse** by searching for **LLM Wiki**.
For a manual install, download `main.js`, `manifest.json`, and `styles.css` from
the matching plugin-version GitHub release and copy them to
`<vault>/.obsidian/plugins/vault-mind-promote/`.

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

## Ask Mate

For a workspace bound to a Project, Ask Mate can:

- read the LLM Wiki managed nested-list section through the shared Visual
  Workspace Operations;
- revise the hierarchy in a keyboard-operable outline and show a deterministic
  textual preview;
- create an immutable, source-hash-bound change plan without writing;
- apply only after the exact current plan is explicitly confirmed;
- show optional Graphify relation, confidence, adapter, and source evidence
  without silently accepting it into the hierarchy.

Graphify is optional. When enabled through Settings, the desktop host initializes
the shared adapter and can read an existing `graphify-out/graph.json` even when
the Graphify CLI is unavailable. If Graphify is disabled, missing, or stale,
managed-map outline, preview, and apply remain usable.

Ordinary Markdown and core Canvas are bounded, read-only context until the user
reviews a supported plan. Ask Mate does not provide direct node dragging;
ecosystem mind-map plugins remain optional enhancers rather than required state
owners.

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
