---
name: vault-health
description: >
  Perform a comprehensive health check of the vault.
  Audits for orphans, broken links, stale pages, contradictions, and more.
---

# /vault-health

# Requires: vault-mind MCP server

Perform a deep audit of your knowledge base to identify "vault rot" and inconsistencies.

## Audits Performed

1.  **Orphaned Pages**: Notes with no inbound links (hard to find).
2.  **Broken Links**: Wikilinks pointing to non-existent files.
3.  **Stale Pages**: Notes not edited in over 90 days (may need review or archiving).
4.  **Unresolved Contradictions**: Active conflicts in `_contradictions.md`.
5.  **Low Coverage Concepts**: Concepts with fewer than 2 sources (needs more research).
6.  **Missing Metadata**: Notes missing required frontmatter (e.g., tags, date).
7.  **Duplicate Titles**: Multiple files with the same name in different folders.
8.  **Style Inconsistency**: Non-standard heading levels or tag formats.

## Steps

1.  **Call `vault.lint`** with `requiredFrontmatter: ["tags", "date"]`.
    -   This covers orphans, broken links, duplicates, and missing frontmatter.

2.  **Scan for Stale Pages**:
    -   Use `vault.list` to get all files.
    -   Use `vault.batch` with `vault.stat` for each file to check `mtime`.
    -   Identify files where `mtime` is > 90 days ago.

3.  **Check Contradictions**:
    -   Read `_contradictions.md` using `vault.read`.
    -   Count sections marked as `[ ]` (unresolved).

4.  **Check Coverage**:
    -   Use `vault.searchByFrontmatter` with `key: "coverage", value: "low"`.
    -   Also check `_sources.md` if available to see concept counts.

5.  **Analyze Style**:
    -   Read a sample of 5-10 recent notes.
    -   Check if they follow the standard (e.g., H1 for title, #tag/subtag format).

6.  **Present Report**:
    -   **Summary**: Total issues found by category.
    -   **Critical**: Broken links and unresolved contradictions.
    -   **Maintenance**: Orphans and stale pages.
    -   **Quality**: Missing metadata and low coverage.

## Rules

-   **Prioritize Action**: Suggest specific fixes (e.g., "Link Orphan X from Index Y").
-   **Batch Operations**: Use `vault.batch` to minimize roundtrips when checking many files.
-   **Language**: All reporting and suggestions must be in the user's language (from `_CLAUDE.md`).
