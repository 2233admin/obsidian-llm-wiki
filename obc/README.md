# OBC - Obsidian Broken Link Checker

Static analysis tool for Obsidian vaults. Finds broken links, orphan notes, and stale notes.

## Installation

```bash
pip install -e .
```

Requires: Python 3.10+, scikit-learn

## Usage

### Check broken links

```bash
obc check <vault>
```

Output:
```
Found 2042 links in D:\knowledge
Summary:
  OK:       880
  Error:    585
  Warning:  577
```

### Find orphan notes (no incoming links)

```bash
obc orphan <vault>
```

Output:
```
Found 23 orphan notes in D:\knowledge
  [  45d] old-note.md
  [  90d] draft-idea.md
```

### Find stale notes (not updated recently)

```bash
obc stale <vault> --days 90
```

Output:
```
Found 150 stale notes (>90 days) in D:\knowledge

By folder:
  04-Research: 45
  02-Archive: 30

  [ 120d] archived-research.md
  [ 110d] old-draft.md
```

### Extract all links

```bash
obc extract <vault> --json
```

### Plan and apply fixes

```bash
# Generate fix plan
obc plan <vault> --out fix-plan.json

# Apply safe fixes (S1 only)
obc apply --plan fix-plan.json

# Apply with review fixes (S2)
obc apply --plan fix-plan.json --apply-review --backup
```

## Diagnostic Codes

| Code | Severity | Meaning |
|------|----------|---------|
| `OK_EXACT` | ok | Exact match found |
| `OK_WITH_FRAGMENT` | ok | Heading/block found |
| `OK_UNIQUE_BY_BASENAME` | ok | Single match by basename |
| `FIXABLE_CASE_NORMALIZE` | ok | Case normalization needed |
| `BROKEN_CERTAIN` | error | Target definitely not found |
| `BROKEN_FRAGMENT_ONLY` | warning | File exists, heading/block missing |
| `AMBIGUOUS_TARGET` | warning | Multiple candidates |
| `FUZZY_MATCH` | warning | Similar name found (typo fix) |
| `SEMANTIC_MATCH` | warning | Similar content found |

## Safety Levels

| Level | Meaning | Auto-apply |
|-------|---------|------------|
| S0 | No action needed | - |
| S1 | Safe auto-fix | Yes |
| S2 | Review recommended | No |
| S3 | Manual review required | No |

## Architecture

```
obc/
├── extract.py    # Link extraction (wikilinks, embeds, markdown)
├── index.py      # Vault index with headings/blocks
├── resolver.py   # Link resolution with diagnostic codes
├── semantic.py   # TF-IDF based semantic similarity
├── orphan.py     # Orphan note detection
├── stale.py      # Stale note detection
├── planner.py    # Fix planning and application
└── cli.py        # CLI interface
```

## Development

```bash
# Run tests
uv pip install pytest scikit-learn
uv run pytest tests/ -v

# Run against a vault
uv run python -m obc.cli check D:/knowledge
```

## License

GPL-3.0
