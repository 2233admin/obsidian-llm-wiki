from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .domain import VaultIndexSnapshot
from .graph import (
    GraphIndexAdapter,
    GraphSearchQuery,
    ProvenanceGraphHit,
    graph_index_is_fresh,
)

GraphMode = Literal["off", "opportunistic", "required"]


class GraphQueryError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class UnifiedQueryResult:
    graph_hits: tuple[ProvenanceGraphHit, ...] = ()
    warnings: tuple[str, ...] = ()
    graph_status: str = "off"


def query_unified(
    snapshot: VaultIndexSnapshot,
    text: str,
    *,
    graph_adapter: GraphIndexAdapter | None = None,
    graph_mode: GraphMode = "opportunistic",
    source_id: str = "",
    evidence_id: str = "",
    limit: int = 10,
    snapshot_revision: str = "",
) -> UnifiedQueryResult:
    if graph_mode == "off":
        return UnifiedQueryResult(graph_status="off")
    if graph_mode not in {"opportunistic", "required"}:
        raise ValueError(f"unsupported graph_mode: {graph_mode}")
    if graph_adapter is None:
        return handle_unavailable_graph(graph_mode, "graph index unavailable")
    metadata = graph_adapter.metadata()
    if not graph_index_is_fresh(metadata, snapshot, snapshot_revision=snapshot_revision):
        return handle_unavailable_graph(graph_mode, "graph index stale or missing")
    hits = graph_adapter.search(
        GraphSearchQuery(
            text=text,
            source_id=source_id,
            evidence_id=evidence_id,
            limit=limit,
        )
    )
    return UnifiedQueryResult(graph_hits=hits, graph_status="fresh")


def handle_unavailable_graph(mode: GraphMode, message: str) -> UnifiedQueryResult:
    if mode == "required":
        raise GraphQueryError(message)
    return UnifiedQueryResult(warnings=(message,), graph_status="degraded")
