from .contract import VALID_KINDS, VALID_STATUSES, ContractViolation, id_from_path, validate_note
from .sources import discover_domains

_LAZY_EXPORTS = {
    "CheckResult": (".check", "CheckResult"),
    "check_file": (".check", "check_file"),
    "check_vault": (".check", "check_vault"),
}

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


def __getattr__(name: str):
    if name not in _LAZY_EXPORTS:
        raise AttributeError(name)
    module_name, attr_name = _LAZY_EXPORTS[name]
    from importlib import import_module

    value = getattr(import_module(module_name, __name__), attr_name)
    globals()[name] = value
    return value
