# Visual Workspace domain

`@obsidian-llm-wiki/visual-workspace` is the host-neutral, GPL-3.0-only domain core for the first Ask Mate visual workspace. It has no runtime dependencies and does not require an Obsidian community plugin.

## Canonical source

The authoritative source is a versioned managed section inside an ordinary Markdown note:

```md
<!-- llmwiki:mind-map:v1 {"id":"map-release","title":"First release"} -->
- "First release" ^release-root
  - "Ask Mate" ^ask-mate
    - "Outline editing" ^outline
  - "Graphify suggestions" ^graphify
<!-- /llmwiki:mind-map:v1 -->
```

The nested list is a single-root tree. Its Obsidian block IDs are the stable node identities. Labels use JSON string encoding so parsing and serialization are deterministic. Accepted secondary relationships are stored as deterministic `llmwiki:cross-link:v1` comments with their provenance; they never become duplicate hierarchy parents.

The parser rejects unknown contract fields, duplicate IDs or edges, multiple roots, cycles, unreachable nodes, and dangling edges. Serialization canonicalizes edge order while preserving sibling order from the node sequence. Replacing a section preserves every byte before and after the managed range.

## Read-only source adoption

`readMarkdownMindMapSource` recognizes canonical managed sections. For an ordinary note it interprets headings and nested lists into a read-only adoption candidate, retaining source byte/line ranges, block IDs, and wikilinks. Missing block IDs are proposed deterministically, never written to the source.

`readObsidianCanvasSource` reads the supported Obsidian core Canvas subset (`text`, `file`, `link`, and labeled `group` nodes plus bounded edges). Multiple roots, multiple parents, undirected edges, and unsupported fields remain explicit diagnostics. `adoptVisualSourceCandidate` requires a chosen root and an allowed parent for every other node; unselected eligible relations become secondary cross-links. Neither reader mutates its input.

## Graph evidence and portable projections

`GraphRelationEvidence` is a closed, versioned contract that preserves adapter identity/version, original relation, evidence references, and `extracted`, `inferred`, `ambiguous`, or `unknown` confidence. Vault evidence must be vault-relative, URLs must be credential-free HTTPS, and common secret-bearing or machine-local values are rejected. `acceptGraphRelationEvidence` is the explicit review boundary that turns evidence into a canonical cross-link while preserving provenance.

`deriveBoundedMindMapProjection` traverses the canonical primary tree in stable sibling order, keeps cross-links secondary, and applies a dependency-free tidy-tree layout. Node and depth limits produce deterministic diagnostics listing omitted nodes and cross-links. `renderMindMapProjectionBundle` returns:

- canonical managed Markdown;
- an ordered textual tree with a source link for every node;
- Mermaid mindmap text;
- Obsidian core Canvas JSON with stable nodes, edges, and coordinates.

The Canvas and Mermaid results are derived views. They do not own map state, and Graphify remains an optional read-side evidence provider.

## Preview and apply

`createVisualEditPlan` produces a recursively frozen preview containing:

- the before and after documents and canonical managed Markdown;
- a SHA-256 fingerprint for each document;
- a SHA-256 lock for the complete source note;
- a fingerprint for the complete plan;
- affected vault-relative paths, warnings, and proposal provenance.

Apply confirmation is deliberately separate from the immutable preview. `InMemoryVisualWorkspace.apply` requires the presented plan fingerprint, confirming actor, and a fresh transition token. It verifies the plan, checks the complete source lock, checks the managed before-snapshot, and only then changes its in-memory source. Replaying the same request returns the recorded result without applying twice. Reusing a token for a different plan or actor is rejected.

```ts
import {
  createVisualEditPlan,
  InMemoryVisualWorkspace,
  parseManagedMindMapSection,
} from "@obsidian-llm-wiki/visual-workspace";

const current = parseManagedMindMapSection(markdown);
const plan = createVisualEditPlan({
  sourcePath: "Projects/release.md",
  sourceMarkdown: markdown,
  nextDocument: {
    ...current.document,
    nodes: current.document.nodes.map((node) =>
      node.id === "ask-mate" ? { ...node, label: "Ask Mate visual workspace" } : node
    ),
  },
  provenance: { actor: "assistant/codex", origin: "assistant" },
});

const workspace = new InMemoryVisualWorkspace({ "Projects/release.md": markdown });
const applied = workspace.apply({
  plan,
  presentedFingerprint: plan.fingerprint,
  actor: "user/alice",
  transitionToken: crypto.randomUUID(),
});
```

The in-memory service is a reference transition boundary, not a persistence adapter. A host must persist `applied.source` atomically and retain equivalent transition-token semantics.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```
