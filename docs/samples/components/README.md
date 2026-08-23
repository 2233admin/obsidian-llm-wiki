# Sample Vaults

This directory redistributes third-party Obsidian vaults as usage
references for the LLM Wiki MCP server and Obsidian plugin. Every entry
ships with the upstream `LICENSE` intact and is included only because
its license permits redistribution.

| Vault | License | Upstream / notes |
|---|---|---|
| `Literature-Zotero-Obsidian/` | GPL-3.0 | Reference vault integrating Zotero with Obsidian |
| `blog-sample-vaul/` | Apache-2.0 | Sample vault demonstrating a blog-style layout |
| `para-sample-vault/` | Apache-2.0 | Sample PARA-methodology vault |

LLM Wiki does not modify the contents of these vaults; their
`.obsidian/` configuration and any embedded assets come from the
upstream. If you redistribute this directory, preserve each upstream
`LICENSE` file and the corresponding upstream notice where present.

## What is NOT here

A previous version of this repo shipped a `Components/` directory at
the repository root containing 276 MB of mixed material — unlicensed
sample vaults, vendor driver bundles (Realtek / MTK), a Microsoft Edge
installer, an 11 MB unnamed mp4, third-party Obsidian plugin zips, and
`*.components` bundles. None of that material had a permissive license
and most was user-private. It has been removed; only the three
LICENSE-bearing vaults above are retained, relocated to
`docs/samples/components/`.

If you previously cloned or referenced `Components/`, the upstream
sources for the licensed vaults are still cited in their individual
README files.
