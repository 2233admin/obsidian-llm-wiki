import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
COMPILER = ROOT / "compiler"
if str(COMPILER) not in sys.path:
    sys.path.insert(0, str(COMPILER))

from agent_wiki_contracts import (  # noqa: E402
    AGENT_WIKI_CONTRACT_VERSION,
    CAPABILITY_NAMES,
    DIAGNOSTIC_CODES,
    EVIDENCE_TIERS,
    FRESHNESS_STATES,
    PROVIDER_IDS,
    load_schema,
    load_serialization_cases,
    load_vocabulary,
)

SCHEMA_CASES = {
    "toolchain-capability-profile": "toolchainCapabilityProfile",
    "ingest-run": "ingestRun",
    "contribution-manifest": "contributionManifest",
    "maintenance-queue-entry": "maintenanceQueueEntry",
    "execution-receipt": "executionReceipt",
    "embedding-fingerprint": "embeddingFingerprint",
    "query-trace": "queryTrace",
}


def test_python_vocabulary_is_the_canonical_shared_fixture():
    vocabulary = load_vocabulary()
    assert vocabulary["schemaVersion"] == AGENT_WIKI_CONTRACT_VERSION
    assert tuple(vocabulary["providerIds"]) == PROVIDER_IDS
    assert tuple(vocabulary["diagnosticCodes"]) == DIAGNOSTIC_CODES
    assert tuple(vocabulary["evidenceTiers"]) == EVIDENCE_TIERS
    assert tuple(vocabulary["freshnessStates"]) == FRESHNESS_STATES
    assert tuple(vocabulary["capabilityNames"]) == CAPABILITY_NAMES


@pytest.mark.parametrize(("schema_name", "case_name"), SCHEMA_CASES.items())
def test_serialization_fixture_matches_versioned_schema_surface(schema_name: str, case_name: str):
    schema = load_schema(schema_name)
    value = load_serialization_cases()[case_name]
    assert value["schemaVersion"] == AGENT_WIKI_CONTRACT_VERSION
    assert set(schema["required"]) <= set(value)
    assert set(value) <= set(schema["properties"])


def test_common_schema_enums_match_python_vocabulary():
    common_path = ROOT / "packages" / "agent-wiki-contracts" / "schemas" / "common.schema.json"
    common = json.loads(common_path.read_text("utf-8"))
    assert tuple(common["$defs"]["providerId"]["enum"]) == PROVIDER_IDS
    assert tuple(common["$defs"]["diagnosticCode"]["enum"]) == DIAGNOSTIC_CODES
    assert tuple(common["$defs"]["evidenceTier"]["enum"]) == EVIDENCE_TIERS
    assert tuple(common["$defs"]["freshnessState"]["enum"]) == FRESHNESS_STATES
    assert tuple(common["$defs"]["capabilityName"]["enum"]) == CAPABILITY_NAMES


def test_schema_loader_rejects_path_traversal():
    with pytest.raises(ValueError, match="stable basename"):
        load_schema("../settings-platform/registry")
