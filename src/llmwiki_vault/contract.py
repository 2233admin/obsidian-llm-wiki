from __future__ import annotations

from pathlib import Path
from typing import Any

from .lint import LintReport, normalize_list
from .markdown import FrontmatterError, parse_markdown
from .safety import PathSafetyError, resolve_vault_path, validate_relative_path


def validate_ingest_output(path: str | Path, *, vault_root: str | Path | None = None) -> LintReport:
    contract_path = Path(path).expanduser().resolve(strict=False)
    root = resolve_vault_path(vault_root) if vault_root else contract_path.parent
    report = LintReport()
    if not contract_path.exists():
        report.add("error", str(contract_path), "ingest output contract file is missing")
        return report
    try:
        fm, _ = parse_markdown(contract_path)
    except FrontmatterError as exc:
        report.add("error", str(contract_path), str(exc))
        return report
    validate_contract_frontmatter(root, contract_path, fm, report)
    return report


def validate_contract_frontmatter(root: Path, contract_path: Path, fm: dict[str, Any], report: LintReport) -> None:
    rel = contract_path.name
    if fm.get("contract") != "llmwiki.ingest.output":
        report.add("error", rel, "contract must be llmwiki.ingest.output")
    if fm.get("version") != 1:
        report.add("error", rel, "version must be 1")
    required_outputs = normalize_list(fm.get("required_outputs", []))
    if not required_outputs:
        report.add("error", rel, "required_outputs must list source and evidence notes")
    has_source = any(str(item).startswith("sources/") and str(item).endswith(".md") for item in required_outputs)
    has_evidence = any(str(item).startswith("evidence/") and str(item).endswith(".md") for item in required_outputs)
    if not has_source:
        report.add("error", rel, "required_outputs must include a source note")
    if not has_evidence:
        report.add("error", rel, "required_outputs must include an evidence note")
    for item in required_outputs:
        validate_contract_path(root, rel, str(item), report, must_exist=True)
    artifact_paths = normalize_list(fm.get("artifact_paths", []))
    missing_reason = fm.get("missing_artifact_reason")
    if not artifact_paths and not missing_reason:
        report.add("error", rel, "artifact_paths or missing_artifact_reason is required")
    for item in artifact_paths:
        validate_contract_path(root, rel, str(item), report, must_exist=False)
    source_status = str(fm.get("source_status", ""))
    if source_status == "blocked_auth" and not missing_reason:
        report.add("error", rel, "blocked_auth ingest output must be explicit about missing artifacts")
    if source_status == "unsupported":
        report.add("warning", rel, "ingest output records unsupported source")


def validate_contract_path(root: Path, rel: str, value: str, report: LintReport, *, must_exist: bool) -> None:
    try:
        path = validate_relative_path(root, value, must_exist=False)
    except PathSafetyError as exc:
        report.add("error", rel, str(exc))
        return
    if must_exist and not path.exists():
        report.add("error", rel, f"required output is missing: {value}")
