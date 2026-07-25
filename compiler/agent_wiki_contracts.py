"""Python view of the shared Agent Wiki serialization contracts.

The JSON vocabulary, schemas, and fixtures under packages/agent-wiki-contracts
are canonical. Python deliberately reads them directly instead of invoking the
TypeScript package so cross-runtime drift remains observable in tests.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

AGENT_WIKI_CONTRACT_VERSION = 1
_ROOT = Path(__file__).resolve().parents[1]
CONTRACT_ROOT = _ROOT / "packages" / "agent-wiki-contracts"
SCHEMA_ROOT = CONTRACT_ROOT / "schemas"
FIXTURE_ROOT = CONTRACT_ROOT / "fixtures" / "v1"


def _load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text("utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Agent Wiki contract must be an object: {path}")
    return value


def load_vocabulary() -> dict[str, Any]:
    vocabulary = _load_json(FIXTURE_ROOT / "vocabulary.json")
    if vocabulary.get("schemaVersion") != AGENT_WIKI_CONTRACT_VERSION:
        raise ValueError("Unsupported Agent Wiki vocabulary version")
    return vocabulary


def load_schema(name: str) -> dict[str, Any]:
    if not name or any(part in name for part in ("/", "\\", "..")):
        raise ValueError("Schema name must be a stable basename")
    schema = _load_json(SCHEMA_ROOT / f"{name}.schema.json")
    expected_id = f"https://schemas.llmwiki.org/agent-wiki/v1/{name}.schema.json"
    if schema.get("$id") != expected_id:
        raise ValueError(f"Unexpected Agent Wiki schema id for {name}")
    return schema


def load_serialization_cases() -> dict[str, dict[str, Any]]:
    fixture = _load_json(FIXTURE_ROOT / "serialization-cases.json")
    if fixture.get("schemaVersion") != AGENT_WIKI_CONTRACT_VERSION:
        raise ValueError("Unsupported Agent Wiki fixture version")
    cases = fixture.get("cases")
    if not isinstance(cases, dict):
        raise ValueError("Agent Wiki serialization cases must be an object")
    return cases


_VOCABULARY = load_vocabulary()
PROVIDER_IDS = tuple(_VOCABULARY["providerIds"])
DIAGNOSTIC_CODES = tuple(_VOCABULARY["diagnosticCodes"])
EVIDENCE_TIERS = tuple(_VOCABULARY["evidenceTiers"])
FRESHNESS_STATES = tuple(_VOCABULARY["freshnessStates"])
CAPABILITY_NAMES = tuple(_VOCABULARY["capabilityNames"])
