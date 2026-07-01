from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from .schema import SCHEMA_VERSION


@dataclass(frozen=True, slots=True)
class SourceRecord:
    id: str
    platform: str
    source_kind: str
    raw_url: str
    canonical_url: str
    provider: str
    pipeline: str
    status: str
    artifact_paths: tuple[str, ...]
    evidence_notes: tuple[str, ...]
    fetched_at: str
    limitations: tuple[str, ...]
    schema_version: int = SCHEMA_VERSION

    @classmethod
    def from_frontmatter(cls, frontmatter: dict[str, Any]) -> "SourceRecord":
        return cls(
            id=str(frontmatter.get("id", "")),
            platform=str(frontmatter.get("platform", "")),
            source_kind=str(frontmatter.get("source_kind", "")),
            raw_url=str(frontmatter.get("raw_url", "")),
            canonical_url=str(frontmatter.get("canonical_url", "")),
            provider=str(frontmatter.get("provider", "")),
            pipeline=str(frontmatter.get("pipeline", "")),
            status=str(frontmatter.get("status", "")),
            artifact_paths=as_str_tuple(frontmatter.get("artifact_paths", ())),
            evidence_notes=as_str_tuple(frontmatter.get("evidence_notes", ())),
            fetched_at=str(frontmatter.get("fetched_at", "")),
            limitations=as_str_tuple(frontmatter.get("limitations", ())),
            schema_version=as_int(frontmatter.get("schema_version", SCHEMA_VERSION)),
        )

    def to_frontmatter(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "platform": self.platform,
            "source_kind": self.source_kind,
            "raw_url": self.raw_url,
            "canonical_url": self.canonical_url,
            "provider": self.provider,
            "pipeline": self.pipeline,
            "status": self.status,
            "artifact_paths": list(self.artifact_paths),
            "evidence_notes": list(self.evidence_notes),
            "fetched_at": self.fetched_at,
            "limitations": list(self.limitations),
            "schema_version": self.schema_version,
        }


@dataclass(frozen=True, slots=True)
class EvidenceRecord:
    id: str
    source_id: str
    provider: str
    artifact_paths: tuple[str, ...]
    captured_at: str
    generated_by: str
    limitations: tuple[str, ...]
    missing_artifact_reason: str = ""
    schema_version: int = SCHEMA_VERSION

    @classmethod
    def from_frontmatter(cls, frontmatter: dict[str, Any]) -> "EvidenceRecord":
        return cls(
            id=str(frontmatter.get("id", "")),
            source_id=str(frontmatter.get("source_id", "")),
            provider=str(frontmatter.get("provider", "")),
            artifact_paths=as_str_tuple(frontmatter.get("artifact_paths", ())),
            captured_at=str(frontmatter.get("captured_at", "")),
            generated_by=str(frontmatter.get("generated_by", "")),
            limitations=as_str_tuple(frontmatter.get("limitations", ())),
            missing_artifact_reason=str(frontmatter.get("missing_artifact_reason", "")),
            schema_version=as_int(frontmatter.get("schema_version", SCHEMA_VERSION)),
        )

    def to_frontmatter(self) -> dict[str, Any]:
        data = {
            "id": self.id,
            "source_id": self.source_id,
            "provider": self.provider,
            "artifact_paths": list(self.artifact_paths),
            "captured_at": self.captured_at,
            "generated_by": self.generated_by,
            "limitations": list(self.limitations),
            "schema_version": self.schema_version,
        }
        if self.missing_artifact_reason:
            data["missing_artifact_reason"] = self.missing_artifact_reason
        return data


@dataclass(frozen=True, slots=True)
class VaultIndexSnapshot:
    sources: tuple[SourceRecord, ...]
    evidence: tuple[EvidenceRecord, ...]
    schema_version: int = SCHEMA_VERSION

    @classmethod
    def from_records(
        cls,
        sources: Iterable[SourceRecord],
        evidence: Iterable[EvidenceRecord],
    ) -> "VaultIndexSnapshot":
        return cls(
            sources=tuple(sorted(sources, key=lambda record: record.id)),
            evidence=tuple(sorted(evidence, key=lambda record: record.id)),
        )

    @property
    def source_by_id(self) -> dict[str, SourceRecord]:
        return {record.id: record for record in self.sources}

    @property
    def evidence_by_id(self) -> dict[str, EvidenceRecord]:
        return {record.id: record for record in self.evidence}


def as_str_tuple(value: Any) -> tuple[str, ...]:
    if value is None or value == "":
        return ()
    if isinstance(value, str):
        return (value,)
    if isinstance(value, Iterable):
        return tuple(str(item) for item in value)
    return (str(value),)


def as_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return SCHEMA_VERSION

