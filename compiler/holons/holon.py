"""Holon dataclass — Layer 3 instance data.

A Holon is simultaneously:
  - A complete knowledge unit (atomic, self-contained)
  - Part of a larger domain graph (connected via causal edges)

This is the compiled form of a vault note.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class CausalEdge:
    source_id: str
    target_id: str
    relation: str       # from meta_ontology.CAUSAL_TYPES
    confidence: float   # fused: 0.7*llm + 0.3*cooccur
    llm_confidence: float = 1.0
    cooccur_weight: float = 0.0
    provenance: str = ""


@dataclass
class Holon:
    id: str
    kind: str
    entity_type: str
    title: str
    summary: str
    content_hash: str
    wikilinks: list[str] = field(default_factory=list)
    causal_edges: list[CausalEdge] = field(default_factory=list)
    source_path: str = ""
    compiled_at: str = ""
    status: str = "active"
    keywords: list[str] = field(default_factory=list)

    @property
    def is_frozen(self) -> bool:
        return self.kind == "decision" and self.status == "frozen"


@dataclass
class HolonSet:
    holons: list[Holon] = field(default_factory=list)
    version: str = ""
    vault_path: str = ""

    def by_id(self) -> dict[str, Holon]:
        return {h.id: h for h in self.holons}

    def ids(self) -> set[str]:
        return {h.id for h in self.holons}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()
