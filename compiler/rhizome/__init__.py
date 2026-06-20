"""Rhizome: frontmatter contract enforcement for the vault compiler."""
from .check import CheckResult, check_file, check_vault
from .contract import VALID_KINDS, VALID_STATUSES, ContractViolation, validate_note
from .sources import discover_domains, id_from_path

__all__ = [
    "VALID_KINDS",
    "VALID_STATUSES",
    "ContractViolation",
    "validate_note",
    "CheckResult",
    "check_file",
    "check_vault",
    "discover_domains",
    "id_from_path",
]
