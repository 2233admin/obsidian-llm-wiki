"""Frontmatter contract schema and validator.

Contract fields (all notes):
    id          REQUIRED  domain/slug  e.g. trading/macro-2026
    description REQUIRED  one-line summary
    kind        REQUIRED  see VALID_KINDS
    status      OPTIONAL  default "active"
    keywords    OPTIONAL  list[str]
    links       OPTIONAL  list[str] of ids
    supersedes  OPTIONAL  list[str] of ids (kind:decision only)
    entity_type OPTIONAL  set by compiler; warn if manually set wrong

Frozen invariant: kind=decision + status=frozen → file is immutable.
The pre-commit hook (Pass 0) rejects edits to frozen notes.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

VALID_KINDS = {
    "note",
    "research",
    "decision",
    "runbook",
    "reference",
    "spec",
    "index",
    "knowledge-task",
    "ontology",
}

VALID_STATUSES = {"active", "frozen", "archived"}

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9\-]*/[a-z0-9][a-z0-9\-]*$")


@dataclass
class ContractViolation:
    field: str
    message: str
    severity: str  # "error" | "warning"


def validate_note(frontmatter: dict, path: Path | None = None) -> list[ContractViolation]:
    """Return list of contract violations for a parsed frontmatter dict.

    path is used only to suggest an auto-derived id in warnings.
    """
    violations: list[ContractViolation] = []

    # --- id ---
    id_val = frontmatter.get("id", "")
    if not id_val:
        suggested = id_from_path(path) if path else "domain/slug"
        violations.append(ContractViolation(
            field="id",
            message=f"missing; suggested: {suggested}",
            severity="warning",  # ADR #5: WARN not ERROR for existing notes
        ))
    elif not _ID_RE.match(str(id_val)):
        violations.append(ContractViolation(
            field="id",
            message=f"must match domain/slug (lowercase kebab): got '{id_val}'",
            severity="error",
        ))

    # --- description ---
    desc = frontmatter.get("description", "")
    if not desc:
        violations.append(ContractViolation(
            field="description",
            message="missing one-line summary",
            severity="warning",
        ))
    elif len(str(desc)) > 200:
        violations.append(ContractViolation(
            field="description",
            message=f"too long ({len(str(desc))} chars, max 200)",
            severity="warning",
        ))

    # --- kind ---
    kind = str(frontmatter.get("kind", "")).strip()
    if not kind:
        violations.append(ContractViolation(
            field="kind",
            message=f"missing; must be one of: {sorted(VALID_KINDS)}",
            severity="error",
        ))
    elif kind not in VALID_KINDS:
        violations.append(ContractViolation(
            field="kind",
            message=f"'{kind}' is not a valid kind; must be one of: {sorted(VALID_KINDS)}",
            severity="error",
        ))

    # --- status ---
    status = str(frontmatter.get("status", "active")).strip()
    if status not in VALID_STATUSES:
        violations.append(ContractViolation(
            field="status",
            message=f"'{status}' is not a valid status; must be one of: {sorted(VALID_STATUSES)}",
            severity="error",
        ))

    # --- supersedes: only for kind:decision ---
    supersedes = frontmatter.get("supersedes")
    if supersedes and kind and kind != "decision":
        violations.append(ContractViolation(
            field="supersedes",
            message=f"'supersedes' is only valid for kind:decision, got kind:{kind}",
            severity="warning",
        ))

    return violations


def is_frozen(frontmatter: dict) -> bool:
    """True if this note is a frozen decision (immutable)."""
    return (
        str(frontmatter.get("kind", "")).strip() == "decision"
        and str(frontmatter.get("status", "")).strip() == "frozen"
    )


def id_from_path(path: Path) -> str:
    """Derive a suggested id from a vault-relative file path.

    Examples:
        05-Engineering/rust-ownership.md  → engineering/rust-ownership
        01-Projects/docket/task-model.md  → projects/task-model
    """
    if path is None:
        return "domain/slug"
    parts = path.with_suffix("").parts
    if len(parts) >= 2:
        domain = re.sub(r"^\d+-", "", parts[-2]).lower()
        slug = parts[-1].lower()
    else:
        domain = "vault"
        slug = parts[-1].lower() if parts else "unknown"
    domain = re.sub(r"[^a-z0-9]", "-", domain).strip("-")
    slug = re.sub(r"[^a-z0-9]", "-", slug).strip("-")
    return f"{domain}/{slug}"
