"""Data models for the KB compiler pipeline."""

from dataclasses import dataclass, field


@dataclass
class Chunk:
    content: str
    source: str
    heading: str | None
    start_line: int


@dataclass
class Concept:
    name: str
    slug: str
    definition: str
    sources: list[str] = field(default_factory=list)
    coverage: str = "low"  # "low" | "medium" | "high"


@dataclass
class Claim:
    content: str
    source: str
    date: str
    confidence: float


@dataclass
class Contradiction:
    claim_a: Claim
    claim_b: Claim
    severity: str  # "direct" | "nuanced" | "temporal"
    resolution: str | None


@dataclass
class CompileReport:
    sources_compiled: int
    summaries_written: int
    concepts_created: int
    concepts_updated: int
    contradictions_found: int
    broken_links: int
    manifests_written: int = 0
    concepts_retracted: int = 0
