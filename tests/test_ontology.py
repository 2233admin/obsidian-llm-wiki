from pathlib import Path

from compiler.meta_ontology import ENTITY_BASE_TYPES, RELATION_TYPES, TRUST_LEVELS
from compiler.ontology import DomainOntology


def test_load_reads_kb_ontology(tmp_path: Path) -> None:
    kb = tmp_path / "KB"
    kb.mkdir()
    (kb / "ontology.yaml").write_text(
        """domain: test-vault
version: "1.0"
generated_by: llm
reviewed: false
entity_types:
  MacroFactor:
    parent: Concept
    description: "Macro factor"
    properties:
      - timeframe
      - region
relation_constraints:
  - from: MacroFactor
    to: [MacroFactor, Claim]
    allowed: [causes, supports]
""",
        encoding="utf-8",
    )

    ontology = DomainOntology()
    data = ontology.load(tmp_path)

    assert data["domain"] == "test-vault"
    assert data["entity_types"]["MacroFactor"]["properties"] == ["timeframe", "region"]
    assert ontology.domain == "test-vault"
    assert "MacroFactor" in ontology.entity_type_names


def test_validate_accepts_valid_ontology() -> None:
    ontology = DomainOntology(
        {
            "domain": "test",
            "version": "1.0",
            "generated_by": "human",
            "reviewed": True,
            "entity_types": {
                "EngineeringDecision": {
                    "parent": "Decision",
                    "description": "ADR",
                    "properties": ["system"],
                }
            },
            "relation_constraints": [
                {
                    "from": "EngineeringDecision",
                    "to": ["Concept"],
                    "allowed": ["requires", "refines"],
                }
            ],
        }
    )

    assert ontology.validate() == []


def test_validate_rejects_unknown_parent_and_relation() -> None:
    ontology = DomainOntology(
        {
            "domain": "test",
            "version": "1.0",
            "generated_by": "llm",
            "reviewed": False,
            "entity_types": {
                "BadType": {
                    "parent": "UnknownBase",
                    "description": "bad",
                    "properties": [],
                }
            },
            "relation_constraints": [
                {
                    "from": "BadType",
                    "to": ["MissingType"],
                    "allowed": ["invalid_relation"],
                }
            ],
        }
    )

    errors = ontology.validate()

    assert any("parent" in error for error in errors)
    assert any("MissingType" in error for error in errors)
    assert any("invalid_relation" in error for error in errors)


def test_get_allowed_relations_enforces_constraints() -> None:
    ontology = DomainOntology(
        {
            "domain": "test",
            "version": "1.0",
            "generated_by": "llm",
            "reviewed": False,
            "entity_types": {
                "ResearchFinding": {"parent": "Claim", "description": "", "properties": []},
                "TradingStrategy": {"parent": "Decision", "description": "", "properties": []},
            },
            "relation_constraints": [
                {
                    "from": "ResearchFinding",
                    "to": ["Claim", "TradingStrategy"],
                    "allowed": ["supports", "contradicts", "refines"],
                }
            ],
        }
    )

    assert ontology.get_allowed_relations("ResearchFinding", "TradingStrategy") == [
        "supports",
        "contradicts",
        "refines",
    ]
    assert "causes" not in ontology.get_allowed_relations("ResearchFinding", "TradingStrategy")
    assert ontology.get_allowed_relations("TradingStrategy", "ResearchFinding") == []


def test_meta_ontology_constants_and_trust_ordering() -> None:
    all_relations = {relation for relations in RELATION_TYPES.values() for relation in relations}

    assert {"causes", "supports", "precedes"}.issubset(all_relations)
    assert {"Concept", "Decision", "Claim"}.issubset(set(ENTITY_BASE_TYPES))
    assert list(TRUST_LEVELS) == ["human", "assisted", "extracted", "inferred"]
    assert list(TRUST_LEVELS.values()) == sorted(TRUST_LEVELS.values(), reverse=True)
