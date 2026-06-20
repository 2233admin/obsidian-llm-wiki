"""Holons package — Layer 3 compiled knowledge units."""
from .holon import CausalEdge, Holon, HolonSet, sha256_file
from .extractor import extract_holon, extract_vault
from .concept_graph import (
    TraversalResult,
    attach_edges,
    build_wikilink_graph,
    causal_chain,
    fuse_confidence,
    cooccur_weight,
    MAX_DEPTH,
    MIN_CONFIDENCE,
)

__all__ = [
    "CausalEdge", "Holon", "HolonSet", "sha256_file",
    "extract_holon", "extract_vault",
    "TraversalResult", "attach_edges", "build_wikilink_graph",
    "causal_chain", "fuse_confidence", "cooccur_weight",
    "MAX_DEPTH", "MIN_CONFIDENCE",
]
