"""Holons package — Layer 3 compiled knowledge units."""
from .concept_graph import (
    MAX_DEPTH,
    MIN_CONFIDENCE,
    TraversalResult,
    attach_edges,
    build_wikilink_graph,
    causal_chain,
    cooccur_weight,
    fuse_confidence,
)
from .extractor import extract_holon, extract_vault
from .holon import CausalEdge, Holon, HolonSet, sha256_file

__all__ = [
    "CausalEdge", "Holon", "HolonSet", "sha256_file",
    "extract_holon", "extract_vault",
    "TraversalResult", "attach_edges", "build_wikilink_graph",
    "causal_chain", "fuse_confidence", "cooccur_weight",
    "MAX_DEPTH", "MIN_CONFIDENCE",
]
