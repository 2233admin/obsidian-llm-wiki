"""Markdown-first LLMwiki vault tools."""

from .domain import EvidenceRecord, SourceRecord, VaultIndexSnapshot
from .graph import (
    GraphIndexMetadata,
    GraphSearchQuery,
    InMemoryGraphIndexAdapter,
    ProvenanceGraphHit,
    TemporalFact,
)
from .query import GraphQueryError, UnifiedQueryResult, query_unified
from .read import (
    ReadIssue,
    ReadResult,
    VaultReadError,
    read_evidence_record,
    read_source_record,
    read_vault_index,
    render_evidence_record,
    render_source_record,
)

__all__ = [
    "EvidenceRecord",
    "GraphIndexMetadata",
    "GraphQueryError",
    "GraphSearchQuery",
    "InMemoryGraphIndexAdapter",
    "ProvenanceGraphHit",
    "ReadIssue",
    "ReadResult",
    "SourceRecord",
    "TemporalFact",
    "UnifiedQueryResult",
    "VaultIndexSnapshot",
    "VaultReadError",
    "query_unified",
    "read_evidence_record",
    "read_source_record",
    "read_vault_index",
    "render_evidence_record",
    "render_source_record",
    "__version__",
]

__version__ = "0.1.0"
