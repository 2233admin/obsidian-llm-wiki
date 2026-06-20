"""Causal concept graph — CTM-inspired adaptive traversal.

Edge confidence fusion (ADR #6, #8):
    confidence = 0.7 * llm_confidence + 0.3 * cooccur_weight
    cooccur: wikilink distance=1 → 1.0, distance=2 → 0.5, else 0.0

Adaptive causal traversal (ADR #7):
    max_depth=5, stops when cumulative_confidence < 0.3
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass

from ..meta_ontology import CAUSAL_TYPES
from .holon import CausalEdge, HolonSet


def build_wikilink_graph(holon_set: HolonSet) -> dict[str, set[str]]:
    """Map holon_id → set of holon_ids it directly wikilinks to."""
    slug_index: dict[str, str] = {}
    for h in holon_set.holons:
        slug_index[h.id] = h.id
        if "/" in h.id:
            slug_index[h.id.split("/", 1)[1]] = h.id
        title_key = h.title.lower().replace(" ", "-")
        if title_key not in slug_index:
            slug_index[title_key] = h.id

    graph: dict[str, set[str]] = defaultdict(set)
    for h in holon_set.holons:
        for wl in h.wikilinks:
            target_key = wl.lower().replace(" ", "-")
            target_id = slug_index.get(target_key) or slug_index.get(wl)
            if target_id and target_id != h.id:
                graph[h.id].add(target_id)

    return dict(graph)


def wikilink_distance(source_id: str, target_id: str, graph: dict[str, set[str]]) -> int | None:
    """BFS distance in wikilink graph (max depth 2). Returns None if unreachable."""
    if target_id in graph.get(source_id, set()):
        return 1
    for mid in graph.get(source_id, set()):
        if target_id in graph.get(mid, set()):
            return 2
    return None


def cooccur_weight(dist: int | None) -> float:
    return {1: 1.0, 2: 0.5}.get(dist, 0.0)  # type: ignore[arg-type]


def fuse_confidence(llm_conf: float, dist: int | None) -> float:
    return 0.7 * llm_conf + 0.3 * cooccur_weight(dist)


def build_edges_from_wikilinks(
    holon_set: HolonSet,
    graph: dict[str, set[str]],
) -> list[CausalEdge]:
    """Seed CausalEdges from direct wikilinks. relation='related_to' until LLM extraction."""
    edges: list[CausalEdge] = []
    for source_id, targets in graph.items():
        for target_id in targets:
            cw = cooccur_weight(1)
            edges.append(CausalEdge(
                source_id=source_id,
                target_id=target_id,
                relation="related_to",
                confidence=fuse_confidence(1.0, 1),
                llm_confidence=1.0,
                cooccur_weight=cw,
                provenance=source_id,
            ))
    return edges


def attach_edges(holon_set: HolonSet) -> HolonSet:
    """Populate causal_edges on each holon in-place and return the HolonSet."""
    graph = build_wikilink_graph(holon_set)
    all_edges = build_edges_from_wikilinks(holon_set, graph)

    edges_by_source: dict[str, list[CausalEdge]] = defaultdict(list)
    for e in all_edges:
        edges_by_source[e.source_id].append(e)

    by_id = holon_set.by_id()
    for hid, edges in edges_by_source.items():
        if hid in by_id:
            by_id[hid].causal_edges = edges

    return holon_set


@dataclass
class TraversalResult:
    path: list[str]
    edges: list[CausalEdge]
    cumulative_confidence: float
    status: str  # "complete" | "low_confidence_halt" | "max_depth_halt" | "not_found"


MAX_DEPTH = 5
MIN_CONFIDENCE = 0.3


def causal_chain(
    from_id: str,
    to_id: str,
    holon_set: HolonSet,
    max_depth: int = MAX_DEPTH,
    min_confidence: float = MIN_CONFIDENCE,
) -> TraversalResult:
    """BFS causal path with adaptive early stopping (ADR #7)."""
    by_id = holon_set.by_id()
    if from_id not in by_id:
        return TraversalResult([], [], 0.0, "not_found")

    edge_map: dict[str, list[CausalEdge]] = defaultdict(list)
    for h in holon_set.holons:
        for e in h.causal_edges:
            edge_map[e.source_id].append(e)

    queue: deque[tuple[str, list[str], list[CausalEdge], float]] = deque()
    queue.append((from_id, [from_id], [], 1.0))
    visited: set[str] = {from_id}

    while queue:
        current, path, edges, cum_conf = queue.popleft()

        if len(path) > max_depth:
            return TraversalResult(path, edges, cum_conf, "max_depth_halt")

        for edge in edge_map.get(current, []):
            nxt = edge.target_id
            if nxt in visited:
                continue
            new_conf = cum_conf * edge.confidence
            new_path = path + [nxt]
            new_edges = edges + [edge]
            if new_conf < min_confidence:
                return TraversalResult(new_path, new_edges, new_conf, "low_confidence_halt")
            if nxt == to_id:
                return TraversalResult(new_path, new_edges, new_conf, "complete")
            visited.add(nxt)
            queue.append((nxt, new_path, new_edges, new_conf))

    return TraversalResult([], [], 0.0, "not_found")
