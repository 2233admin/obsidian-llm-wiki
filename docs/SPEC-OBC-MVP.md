# OBC MVP - Obsidian Broken Link Checker

> A static analysis engine that compiles vault link state into auditable diagnostics and verifiable fix plans.

## Status

**Phase**: Planning complete, PR1 pending

## Problem

Obsidian wikilinks are complex. A naive "regex find [[xxx]] then check if file exists" produces false positives and misses real issues.

OBC MVP is NOT a "broken link checker" — it's a **static analysis engine**.

## Architecture

```
scan vault
  ↓
parse links
  ↓
build vault index
  ↓
resolve targets
  ↓
classify diagnosis
  ↓
generate fix plan
  ↓
dry-run patch
  ↓
rerun validation
  ↓
optional apply-safe
```

## Diagnostic Taxonomy

OBC outputs diagnostic codes, NOT boolean broken/ok:

| Code | Meaning | Severity |
|------|---------|----------|
| `OK_EXACT` | Target file exists, exact match | - |
| `OK_UNIQUE_BY_BASENAME` | Exact not found, unique basename match | - |
| `OK_WITH_FRAGMENT` | File exists, heading/block found | - |
| `BROKEN_CERTAIN` | Target file definitely doesn't exist | error |
| `BROKEN_FRAGMENT_ONLY` | File exists, fragment not found | warning |
| `AMBIGUOUS_TARGET` | Multiple candidates exist | warning |
| `UNSUPPORTED_SYNTAX` | Obsidian URI, etc. | info |
| `IGNORED_EXTERNAL` | HTTP/mailto links | - |
| `INTENTIONAL_DANGLING` | Future note placeholder | warning |

## Implementation Phases

| PR | Scope | Status |
|----|-------|--------|
| PR1 | Link Extraction | **pending** |
| PR2 | VaultIndex + Resolver | pending |
| PR3 | Fix Planner | pending |
| PR4 | apply-safe | pending |

### PR1: Link Extraction Only

**Goal**: Prove we can extract links correctly without false positives from code blocks.

**Scope**:
- Scan .md files, skip .git/.obsidian/node_modules/.trash
- Extract wikilinks: `[[A]]`, `[[A|alias]]`, `![[A]]`, `[[A#H]]`, `[[A#^id]]`
- Extract markdown links: `[text](target)`
- Skip fenced code blocks
- Skip inline code
- Output LinkRef JSON

**Acceptance**: `obc extract fixtures/basic-vault --json` produces correct LinkRef list

### PR2: VaultIndex + Resolver

**Goal**: Determine OK / broken / ambiguous for each link.

**Scope**:
- Build files_by_path, files_by_stem, files_by_basename
- Parse frontmatter aliases
- Extract headings and block IDs
- Resolve links with priority order
- Output diagnostic codes

**Acceptance**: `obc check fixtures/resolver-vault --format json` outputs stable diagnostic codes

### PR3: Fix Planner

**Goal**: Generate fix plans, don't write files.

**Scope**:
- Generate S1 patches only
- Preserve alias/embed/fragment structure
- Dry-run validation
- Output fix-plan.json + fix.patch

**Acceptance**: `git apply --check .obc/fix.patch` succeeds; post-patch check shows no new errors

### PR4: apply-safe

**Goal**: Safely write fixes with rollback.

**Scope**:
- Git clean check before write
- Rollback on validation failure
- Auto-rerun check after apply

**Acceptance**: `obc apply --safe-only` with rollback on failure

## Fix Safety Levels

| Level | When | Auto-apply |
|-------|------|------------|
| S0 | No fix | N/A |
| S1 | Exact failure + single deterministic candidate + structure preserved | Optional |
| S2 | Multiple candidates or fuzzy match | Review required |
| S3 | Unsupported syntax or destructive | Never |

## Key Design Decisions

1. **Not a broken link checker** — Static analysis engine with explicit uncertainty modeling
2. **Diagnostic taxonomy over boolean** — `BROKEN_CERTAIN` vs `BROKEN_FRAGMENT_ONLY` vs `AMBIGUOUS_TARGET`
3. **Evidence ledger** — Every diagnosis has evidence; every fix has justification
4. **Safe by default** — Generate plans, don't write files; dry-run before apply
5. **Conservative resolver** — Directory index NOT auto-resolved; aliases as suggestions not proofs
6. **Structure preservation** — Patches only modify target span, never alias/fragment

## CLI Interface

```bash
# PR1: Extract links only
obc extract ./vault --json > links.json

# PR2: Check (build index + resolve)
obc check ./vault --format json

# PR3: Generate fix plan (default)
obc plan ./vault --out .obc/fix-plan.json

# PR4: Apply safe fixes
obc apply --plan .obc/fix-plan.json --safe-only
```

## Output Artifacts

```
.obc/
├── report.md           # Human-readable diagnostics
├── report.json         # Machine-readable diagnostics
├── fix-plan.json       # Fix candidates with evidence
├── fix.patch           # Unified diff (optional)
└── validation.json     # Post-apply verification
```

## References

- Full SPEC: [SPEC-OBC-MVP.md](../D:/knowledge/.scratch/scout-llmwiki-lessons/SPEC-OBC-MVP.md)
- Obsidian Link Syntax: https://obsidian.md/help/links
- Obsidian Aliases: https://obsidian.md/help/aliases
