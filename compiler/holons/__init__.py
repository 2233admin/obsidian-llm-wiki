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
from .holon import CausalEdge, Holon, HolonSet, HyperEdge, sha256_file
from .serializer import dump_json, holon_set_from_dict, holon_set_to_dict, load_json

__all__ = [
    "CausalEdge", "Holon", "HolonSet", "HyperEdge", "sha256_file",
    "extract_holon", "extract_vault",
    "dump_json", "load_json", "holon_set_to_dict", "holon_set_from_dict",
    "TraversalResult", "attach_edges", "build_wikilink_graph",
    "causal_chain", "fuse_confidence", "cooccur_weight",
    "MAX_DEPTH", "MIN_CONFIDENCE",
]
