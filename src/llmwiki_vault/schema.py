from __future__ import annotations

SCHEMA_VERSION = 1

SOURCE_REQUIRED_FIELDS = (
    "id",
    "platform",
    "source_kind",
    "raw_url",
    "canonical_url",
    "provider",
    "pipeline",
    "status",
    "artifact_paths",
    "evidence_notes",
    "fetched_at",
    "limitations",
    "schema_version",
)

EVIDENCE_REQUIRED_FIELDS = (
    "id",
    "source_id",
    "provider",
    "artifact_paths",
    "captured_at",
    "generated_by",
    "limitations",
    "schema_version",
)

SOURCE_STATUSES = (
    "new",
    "supported",
    "partial",
    "blocked_auth",
    "unsupported",
    "stale",
    "conflict",
    "archived",
)

SOURCE_TEMPLATE_FRONTMATTER = {
    "id": "source-id",
    "platform": "web",
    "source_kind": "document",
    "raw_url": "",
    "canonical_url": "",
    "provider": "",
    "pipeline": "",
    "status": "new",
    "artifact_paths": [],
    "evidence_notes": [],
    "fetched_at": "",
    "limitations": [],
    "schema_version": SCHEMA_VERSION,
}

EVIDENCE_TEMPLATE_FRONTMATTER = {
    "id": "evidence-id",
    "source_id": "source-id",
    "provider": "",
    "artifact_paths": [],
    "captured_at": "",
    "generated_by": "",
    "limitations": [],
    "missing_artifact_reason": "",
    "schema_version": SCHEMA_VERSION,
}
