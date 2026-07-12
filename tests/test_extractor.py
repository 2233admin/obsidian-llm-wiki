import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "compiler"))

from compiler.extractor import extract_causal_schema, normalize_holon_extraction
from compiler.meta_ontology import RELATION_TYPES
from compiler.ontology import DomainOntology


def _ontology() -> DomainOntology:
    return DomainOntology(
        {
            "domain": "test",
            "version": "1.0",
            "generated_by": "human",
            "reviewed": True,
            "entity_types": {
                "MacroFactor": {
                    "parent": "Concept",
                    "description": "Macro factor",
                    "properties": [],
                },
                "ResearchFinding": {
                    "parent": "Claim",
                    "description": "Research finding",
                    "properties": [],
                },
            },
            "relation_constraints": [
                {
                    "from": "MacroFactor",
                    "to": ["MacroFactor"],
                    "allowed": ["causes", "prevents", "enables", "requires"],
                },
                {
                    "from": "ResearchFinding",
                    "to": ["MacroFactor"],
                    "allowed": ["supports", "contradicts", "refines"],
                },
            ],
        }
    )


def test_causal_extraction_outputs_entity_type_and_facts():
    result = extract_causal_schema(
        "利率上升历史上总是导致债券价格下跌。",
        _ontology(),
        entity_type="MacroFactor",
        target_type="MacroFactor",
    )
    valid_relations = {rel for group in RELATION_TYPES.values() for rel in group}

    assert result["entity_type"] == "MacroFactor"
    assert result["facts"]
    assert any(fact["relation"] == "causes" for fact in result["facts"])
    assert all(fact["relation"] in valid_relations for fact in result["facts"])


def test_ontology_constraint_blocks_invalid_relation():
    result = normalize_holon_extraction(
        {
            "entity_type": "ResearchFinding",
            "facts": [
                {
                    "claim": "Study finding causes bond prices",
                    "relation": "causes",
                    "target_id": "macro/bond-prices",
                    "target_type": "MacroFactor",
                    "confidence": 0.9,
                }
            ],
        },
        _ontology(),
        default_entity_type="ResearchFinding",
    )

    assert result["entity_type"] == "ResearchFinding"
    assert result["facts"] == []


def test_meta_ontology_blocks_unknown_relation():
    result = normalize_holon_extraction(
        {
            "entity_type": "MacroFactor",
            "facts": [
                {
                    "claim": "Rates are vaguely related to prices",
                    "relation": "loosely_related",
                    "target_id": "macro/bond-prices",
                    "target_type": "MacroFactor",
                    "confidence": 0.9,
                }
            ],
        },
        _ontology(),
        default_entity_type="MacroFactor",
    )

    assert result["facts"] == []
