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

The plugin is desktop-only because runtime operations use Node child processes.
