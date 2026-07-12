# Obsidian Canvas diagrams

LLMwiki bundles [Archify](https://github.com/tt-a1i/archify) as diagramming
inspiration, but the Obsidian-native output for `/vault-diagram` is a built-in
Canvas `.canvas` board.

Use:

```text
/vault-diagram draw the request lifecycle for [[api-gateway]]
/vault-diagram convert this Mermaid workflow into an Obsidian Canvas board
/vault-diagram update [[system-map.canvas]] with the new queue worker
```

## Source of truth

The `.canvas` file is the maintained source. Generated HTML/SVG/PNG files,
Mermaid snippets, Archify JSON, and Excalidraw drawings are exports or
intermediate references, not the working artifact.

Canvas files use the JSON Canvas format:

```json
{
  "nodes": [],
  "edges": []
}
```

This makes live boards easier to maintain than compressed drawing formats:
future agents can parse the board, patch known nodes, preserve user edits, and
validate edge references with ordinary JSON tooling.

## Default location

Follow the vault's existing layout:

```text
00-Index/{slug}.canvas
```

Use a user-specified path first. Do not create new top-level folders by default.
Do not default Canvas boards to `00-Inbox/` or `00-Inbox/AI-Output/`; those
folders are for draft notes and agent output quarantine, not maintained boards.

## Diagram types

| Type | Canvas shape language |
|---|---|
| `architecture` | grouped cards, file nodes, service boundaries, dependency edges |
| `workflow` | text/file cards and directed edges |
| `sequence` | ordered columns, actor cards, call edges |
| `dataflow` | staged groups and labeled data edges |
| `lifecycle` | state cards and transition edges |

## Maintenance model

Use stable semantic ids so updates can patch a live board instead of replacing
it. Preserve user-moved node positions and sizes unless the user asks for
relayout.

Before writing a changed Canvas file:

- Read the existing JSON and record hash/mtime.
- Preserve unknown/user-created nodes and edges.
- Re-read before writing and abort if the file changed.
- Format JSON with two-space indentation.
- Validate unique ids, edge references, and geometry.

## Visual defaults

Obsidian Canvas does not store a global background color; the board follows the
user's Obsidian theme. `/vault-diagram` should therefore use roomy cards,
groups, short edge labels, and restrained Canvas colors that work in dark mode.

Default workflow cards should be at least `360x180`, with at least 80px between
cards and 140px between parallel lanes.
