from __future__ import annotations

RELATION_TYPES: dict[str, list[str]] = {
    "causal": ["causes", "enables", "requires", "prevents"],
    "epistemic": ["supports", "contradicts", "refines", "implies"],
    "temporal": ["precedes", "triggers"],
}

ENTITY_BASE_TYPES: list[str] = [
    "Concept",
    "Event",
    "Decision",
    "Claim",
    "Evidence",
]

TRUST_LEVELS: dict[str, float] = {
    "human": 1.0,
    "assisted": 0.8,
    "extracted": 0.6,
    "inferred": 0.4,
}

FRONTMATTER_KINDS: list[str] = [
    "note",
    "research",
    "decision",
    "runbook",
    "reference",
    "spec",
    "index",
    "knowledge-task",
    "ontology",
]

DEFAULT_ENTITY_CLASS = "Concept"

KIND_DEFAULT_ENTITY: dict[str, str] = {
    "note": "Concept",
    "research": "Claim",
    "decision": "Decision",
    "runbook": "Concept",
    "reference": "Evidence",
    "spec": "Concept",
    "index": "Concept",
    "knowledge-task": "Event",
    "ontology": "Concept",
}

CAUSAL_TYPES: frozenset[str] = frozenset(
    relation for relations in RELATION_TYPES.values() for relation in relations
)
ENTITY_CLASSES: frozenset[str] = frozenset([*ENTITY_BASE_TYPES, "Entity", "Finding", "Model", "Process"])


def resolve_entity_class(kind: str, entity_type: str | None, domain_types: set[str]) -> str:
    known_types = ENTITY_CLASSES | domain_types
    if entity_type and entity_type in known_types:
        return entity_type
    return KIND_DEFAULT_ENTITY.get(kind, DEFAULT_ENTITY_CLASS)
