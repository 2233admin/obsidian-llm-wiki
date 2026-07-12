import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "compiler"))

from compiler.concept_graph import (
    detect_causal_contradictions,
    edge_confidence,
    merge_causal_layer,
)


def test_causal_layer_merges_facts_with_wikilink_confidence():
    graph = {
        "nodes": [],
        "edges": [
            {
                "src": "macro/rates",
                "dst": "macro/bond-prices",
                "kind": "wikilink",
                "resolved": True,
            }
        ],
        "stats": {},
    }
    holons = [
        {
            "id": "macro/rates",
            "entity_type": "MacroFactor",
            "facts": [
                {
                    "claim": "Rates cause bond prices to fall",
                    "relation": "causes",
                    "target_id": "macro/bond-prices",
                    "target_type": "MacroFactor",
                    "confidence": 0.8,
                }
            ],
        }
    ]

    merged = merge_causal_layer(graph, holons)
    edge = merged["causal_edges"][0]

    assert edge["relation"] == "causes"
    assert edge["confidence"] == edge_confidence(0.8, 1.0)
    assert merged["stats"]["causal_edges"] == 1


def test_contradiction_detection_finds_causes_prevents_pair():
    edges = [
        {
            "src": "macro/rates",
            "dst": "macro/bond-prices",
            "relation": "causes",
            "confidence": 0.86,
        },
        {
            "src": "macro/rates",
            "dst": "macro/bond-prices",
            "relation": "prevents",
            "confidence": 0.79,
        },
    ]

    contradictions = detect_causal_contradictions(edges)

    assert len(contradictions) == 1
    assert contradictions[0]["source_id"] == "macro/rates"
    assert contradictions[0]["target_id"] == "macro/bond-prices"
    assert contradictions[0]["relations"] == ["causes", "prevents"]


def test_causal_layer_reports_contradiction_count():
    graph = {"nodes": [], "edges": [], "stats": {}}
    holons = [
        {
            "id": "macro/rates",
            "facts": [
                {
                    "relation": "causes",
                    "target_id": "macro/bond-prices",
                    "confidence": 0.8,
                },
                {
                    "relation": "prevents",
                    "target_id": "macro/bond-prices",
                    "confidence": 0.7,
                },
            ],
        }
    ]

    merged = merge_causal_layer(graph, holons)

    assert merged["stats"]["contradiction_count"] == 1
