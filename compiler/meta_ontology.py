"""Meta-ontology: universal causal types and entity classes.

This is the top layer of the 3-tier ontology:
  Layer 1: Meta-Ontology (this file) — universal, framework-level
  Layer 2: Domain Ontology (KB/ontology.yaml) — per-vault, project-specific
  Layer 3: Instance Data (compiled holons) — per-note

Causal types and entity classes here are intentionally domain-agnostic.
'MacroFactor→Price' is NOT here. 'causes' IS here.
"""

from __future__ import annotations

# Universal causal relationship types.
CAUSAL_TYPES: frozenset[str] = frozenset({
    "causes",
    "enables",
    "inhibits",
    "correlates_with",
    "contradicts",
    "supports",
    "supersedes",
    "derives_from",
    "part_of",
    "related_to",
})

# Universal entity classes.
ENTITY_CLASSES: frozenset[str] = frozenset({
    "Concept",
    "Entity",
    "Event",
    "Decision",
    "Finding",
    "Model",
    "Process",
    "System",
    "Person",
    "Organization",
    "Reference",
})

DEFAULT_ENTITY_CLASS = "Concept"

KIND_DEFAULT_ENTITY: dict[str, str] = {
    "note": "Concept",
    "research": "Finding",
    "decision": "Decision",
    "runbook": "Process",
    "reference": "Reference",
    "spec": "Model",
    "index": "Concept",
    "knowledge-task": "Process",
    "ontology": "Concept",
}


def resolve_entity_class(kind: str, entity_type: str | None, domain_types: set[str]) -> str:
    """Return the best entity class for a holon.

    Resolution order:
    1. entity_type is known in meta or domain types → use it
    2. KIND_DEFAULT_ENTITY[kind]
    3. DEFAULT_ENTITY_CLASS
    """
    all_known = ENTITY_CLASSES | domain_types
    if entity_type and entity_type in all_known:
        return entity_type
    return KIND_DEFAULT_ENTITY.get(kind, DEFAULT_ENTITY_CLASS)
