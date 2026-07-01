from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Iterable, Protocol

from .domain import VaultIndexSnapshot


@dataclass(frozen=True, slots=True)
class TemporalFact:
    id: str
    subject: str
    predicate: str
    object: str
    observed_at: str
    source_id: str
    evidence_id: str
    artifact_paths: tuple[str, ...] = ()
    valid_from: str = ""
    valid_to: str = ""
    temporal_status: str = "atemporal"
    confidence: float = 1.0
    extraction_method: str = "manual"


@dataclass(frozen=True, slots=True)
class ProvenanceGraphHit:
    id: str
    score: float
    fact_id: str
    subject: str
    predicate: str
    object: str
    source_id: str
    evidence_id: str
    artifact_paths: tuple[str, ...]
    snippet: str
    observed_at: str
    valid_from: str = ""
    valid_to: str = ""
    temporal_status: str = "atemporal"
    extraction_method: str = "manual"


@dataclass(frozen=True, slots=True)
class GraphIndexMetadata:
    snapshot_hash: str
    snapshot_revision: str = ""


@dataclass(frozen=True, slots=True)
class GraphIndexState:
    metadata: GraphIndexMetadata
    facts: tuple[TemporalFact, ...]


@dataclass(frozen=True, slots=True)
class GraphSearchQuery:
    text: str = ""
    source_id: str = ""
    evidence_id: str = ""
    limit: int = 10


class GraphIndexAdapter(Protocol):
    def rebuild(
        self,
        snapshot: VaultIndexSnapshot,
        facts: Iterable[TemporalFact],
        *,
        snapshot_revision: str = "",
    ) -> GraphIndexState:
        ...

    def search(self, query: GraphSearchQuery) -> tuple[ProvenanceGraphHit, ...]:
        ...

    def metadata(self) -> GraphIndexMetadata | None:
        ...


class InMemoryGraphIndexAdapter:
    def __init__(self) -> None:
        self._state: GraphIndexState | None = None

    def rebuild(
        self,
        snapshot: VaultIndexSnapshot,
        facts: Iterable[TemporalFact],
        *,
        snapshot_revision: str = "",
    ) -> GraphIndexState:
        fact_tuple = tuple(facts)
        source_ids = set(snapshot.source_by_id)
        evidence_ids = set(snapshot.evidence_by_id)
        for fact in fact_tuple:
            validate_temporal_fact(fact, source_ids, evidence_ids)
        self._state = GraphIndexState(
            metadata=GraphIndexMetadata(
                snapshot_hash=snapshot_hash(snapshot),
                snapshot_revision=snapshot_revision,
            ),
            facts=tuple(sorted(fact_tuple, key=lambda fact: fact.id)),
        )
        return self._state

    def search(self, query: GraphSearchQuery) -> tuple[ProvenanceGraphHit, ...]:
        if self._state is None:
            return ()
        terms = normalize_terms(query.text)
        hits: list[ProvenanceGraphHit] = []
        for fact in self._state.facts:
            if query.source_id and fact.source_id != query.source_id:
                continue
            if query.evidence_id and fact.evidence_id != query.evidence_id:
                continue
            haystack = " ".join(
                [
                    fact.id,
                    fact.subject,
                    fact.predicate,
                    fact.object,
                    fact.source_id,
                    fact.evidence_id,
                ]
            ).lower()
            if terms and not all(term in haystack for term in terms):
                continue
            hits.append(graph_hit_from_fact(fact, score=score_fact(fact, terms)))
        return tuple(sorted(hits, key=lambda hit: (-hit.score, hit.id))[: query.limit])

    def metadata(self) -> GraphIndexMetadata | None:
        if self._state is None:
            return None
        return self._state.metadata


def snapshot_hash(snapshot: VaultIndexSnapshot) -> str:
    payload = {
        "schema_version": snapshot.schema_version,
        "sources": [source.to_frontmatter() for source in snapshot.sources],
        "evidence": [evidence.to_frontmatter() for evidence in snapshot.evidence],
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def graph_index_is_fresh(
    metadata: GraphIndexMetadata | None,
    snapshot: VaultIndexSnapshot,
    *,
    snapshot_revision: str = "",
) -> bool:
    if metadata is None:
        return False
    if metadata.snapshot_hash != snapshot_hash(snapshot):
        return False
    return not snapshot_revision or metadata.snapshot_revision == snapshot_revision


def validate_temporal_fact(
    fact: TemporalFact,
    source_ids: set[str],
    evidence_ids: set[str],
) -> None:
    if not fact.source_id:
        raise ValueError(f"temporal fact {fact.id} missing source_id")
    if not fact.evidence_id:
        raise ValueError(f"temporal fact {fact.id} missing evidence_id")
    if fact.source_id not in source_ids:
        raise ValueError(f"temporal fact {fact.id} references unknown source_id")
    if fact.evidence_id not in evidence_ids:
        raise ValueError(f"temporal fact {fact.id} references unknown evidence_id")
    if not fact.observed_at:
        raise ValueError(f"temporal fact {fact.id} missing observed_at")
    if not fact.temporal_status:
        raise ValueError(f"temporal fact {fact.id} missing temporal_status")
    if fact.extraction_method == "llm" and fact.confidence <= 0:
        raise ValueError(f"temporal fact {fact.id} llm extraction requires confidence")


def graph_hit_from_fact(fact: TemporalFact, *, score: float) -> ProvenanceGraphHit:
    snippet = f"{fact.subject} {fact.predicate} {fact.object}"
    return ProvenanceGraphHit(
        id=f"graph:{fact.id}",
        score=score,
        fact_id=fact.id,
        subject=fact.subject,
        predicate=fact.predicate,
        object=fact.object,
        source_id=fact.source_id,
        evidence_id=fact.evidence_id,
        artifact_paths=fact.artifact_paths,
        snippet=snippet,
        observed_at=fact.observed_at,
        valid_from=fact.valid_from,
        valid_to=fact.valid_to,
        temporal_status=fact.temporal_status,
        extraction_method=fact.extraction_method,
    )


def normalize_terms(text: str) -> tuple[str, ...]:
    return tuple(term for term in text.lower().split() if term)


def score_fact(fact: TemporalFact, terms: tuple[str, ...]) -> float:
    if not terms:
        return fact.confidence
    haystack = {
        "subject": fact.subject.lower(),
        "predicate": fact.predicate.lower(),
        "object": fact.object.lower(),
    }
    score = fact.confidence
    for term in terms:
        if term in haystack["subject"]:
            score += 2.0
        if term in haystack["predicate"]:
            score += 1.0
        if term in haystack["object"]:
            score += 1.0
    return score
