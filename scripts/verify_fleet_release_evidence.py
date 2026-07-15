#!/usr/bin/env python
"""Fail closed unless a release tag carries exact-SHA real-fleet evidence."""
from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SHA256 = re.compile(r"^[0-9a-f]{64}$")
COMMIT = re.compile(r"^[0-9a-f]{40}$")
CORRELATION = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)
REPORT_PHASES = ("prepare", "remote", "verify")
CANONICAL_FIXTURE = Path("tests/fixtures/fleet-workflow.v2.json")
ATTESTATION_ALGORITHM = "ed25519"
ATTESTATION_NAMESPACE = "llmwiki-fleet-release-v1"
TRUST_ANCHOR_ROOT = Path("docs/release-evidence/trust")
REQUIRED_CHECK_IDS = {
    "prepare": {"governed-child-created"},
    "remote": {"portable-handoff-guarded-replay"},
    "verify": {
        "local-lease-identity",
        "remote-work-run-completed",
        "governed-parent-child-graph",
        "child-artifact-projection",
        "remote-shared-digest",
        "doctor-completed-run",
        "project-hub-graph",
        "external-ref-boundary",
        "shared-state-secret-free",
    },
}
EVIDENCE_ONLY_PATHS = {
    "docs/FLEET_WORKFLOW_ACCEPTANCE.md",
    "openspec/changes/add-governed-agent-rooms-and-dreamtime/tasks.md",
}


def _git(repo: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=repo,
        check=check,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def report_sha256(report: dict[str, Any]) -> str:
    canonical = json.dumps(
        report,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def canonical_attestation_payload(payload: dict[str, Any]) -> bytes:
    """Return the only bytes that a 5090 release attestation may sign."""
    attestation = payload.get("attestation")
    reports = payload.get("reports")
    provenance = payload.get("executionProvenance")
    if not isinstance(attestation, dict):
        raise RuntimeError("attestation is required")
    if not isinstance(reports, dict) or set(reports) != set(REPORT_PHASES):
        raise RuntimeError("evidence must contain exactly prepare, remote, and verify reports")
    if not isinstance(provenance, dict):
        raise RuntimeError("executionProvenance is required")
    report_digests: dict[str, str] = {}
    for phase in REPORT_PHASES:
        entry = reports.get(phase)
        report = entry.get("report") if isinstance(entry, dict) else None
        if not isinstance(report, dict):
            raise RuntimeError(f"{phase} evidence must contain the raw report")
        report_digests[phase] = report_sha256(report)
    canonical = {
        "schemaVersion": 1,
        "attestationContext": {
            "algorithm": attestation.get("algorithm"),
            "keyId": attestation.get("keyId"),
            "namespace": ATTESTATION_NAMESPACE,
            "trustAnchor": attestation.get("trustAnchor"),
        },
        "releaseTag": payload.get("releaseTag"),
        "testedCommit": payload.get("testedCommit"),
        "fixtureDigest": payload.get("fixtureDigest"),
        "correlationId": payload.get("correlationId"),
        "reportDigests": report_digests,
        "executionProvenance": provenance,
    }
    return (
        json.dumps(
            canonical,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8")


def _exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    if set(value) != expected:
        raise RuntimeError(f"{label} fields do not match the evidence schema")


def _git_blob(repo: Path, commit: str, relative_path: str, label: str) -> bytes:
    result = subprocess.run(
        ["git", "show", f"{commit}:{relative_path}"],
        cwd=repo,
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"{label} is not committed at the required revision")
    return result.stdout


def _trust_anchor_path(value: object) -> str:
    raw = str(value or "")
    candidate = Path(raw)
    normalized = candidate.as_posix()
    if (
        not raw
        or raw != normalized
        or candidate.is_absolute()
        or ".." in candidate.parts
        or candidate.suffix != ".json"
        or candidate.parent != TRUST_ANCHOR_ROOT
    ):
        raise RuntimeError("attestation trustAnchor is invalid")
    return normalized


def _openssl() -> str:
    executable = shutil.which("openssl")
    if not executable:
        raise RuntimeError("OpenSSL is required for fleet release attestation verification")
    return executable


def _public_key_der(public_key_pem: str) -> bytes:
    with tempfile.TemporaryDirectory(prefix="llmwiki-attestation-key-") as temporary:
        public_path = Path(temporary) / "public.pem"
        public_path.write_text(public_key_pem, encoding="ascii")
        result = subprocess.run(
            [
                _openssl(), "pkey", "-pubin", "-in", str(public_path),
                "-outform", "DER",
            ],
            check=False,
            capture_output=True,
        )
    if result.returncode != 0 or not result.stdout:
        raise RuntimeError("fleet release trust anchor public key is invalid")
    return result.stdout


def _parse_trust_anchor(raw: bytes) -> dict[str, Any]:
    try:
        anchor = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("fleet release trust anchor is invalid") from error
    if not isinstance(anchor, dict):
        raise RuntimeError("fleet release trust anchor is invalid")
    _exact_keys(
        anchor,
        {
            "schemaVersion", "algorithm", "keyId", "deviceId", "namespace",
            "publicKeyPem",
        },
        "fleet release trust anchor",
    )
    if (
        anchor.get("schemaVersion") != 1
        or anchor.get("algorithm") != ATTESTATION_ALGORITHM
        or anchor.get("deviceId") != "device/cloud-5090"
        or anchor.get("namespace") != ATTESTATION_NAMESPACE
    ):
        raise RuntimeError("fleet release trust anchor metadata is invalid")
    key_id = str(anchor.get("keyId", "")).lower()
    public_key_pem = str(anchor.get("publicKeyPem", "")).replace("\r\n", "\n")
    if not SHA256.fullmatch(key_id):
        raise RuntimeError("fleet release trust anchor keyId is invalid")
    if (
        not public_key_pem.startswith("-----BEGIN PUBLIC KEY-----\n")
        or not public_key_pem.endswith("-----END PUBLIC KEY-----\n")
        or "PRIVATE KEY" in public_key_pem
        or "\x00" in public_key_pem
    ):
        raise RuntimeError("fleet release trust anchor public key is invalid")
    fingerprint = hashlib.sha256(_public_key_der(public_key_pem)).hexdigest()
    if key_id != fingerprint:
        raise RuntimeError("fleet release trust anchor keyId does not match its public key")
    anchor["publicKeyPem"] = public_key_pem
    return anchor


def _verify_signature(public_key_pem: str, canonical: bytes, signature: bytes) -> None:
    with tempfile.TemporaryDirectory(prefix="llmwiki-attestation-verify-") as temporary:
        root = Path(temporary)
        public_path = root / "public.pem"
        payload_path = root / "payload.json"
        signature_path = root / "signature.bin"
        public_path.write_text(public_key_pem, encoding="ascii")
        payload_path.write_bytes(canonical)
        signature_path.write_bytes(signature)
        result = subprocess.run(
            [
                _openssl(), "pkeyutl", "-verify", "-pubin",
                "-inkey", str(public_path), "-rawin", "-in", str(payload_path),
                "-sigfile", str(signature_path),
            ],
            check=False,
            capture_output=True,
        )
    if result.returncode != 0:
        raise RuntimeError("fleet release attestation signature verification failed")


def _verify_attestation(
    repo: Path,
    payload: dict[str, Any],
    tested_commit: str,
    release_commit: str,
) -> dict[str, str]:
    attestation = payload.get("attestation")
    if not isinstance(attestation, dict):
        raise RuntimeError("attestation is required")
    _exact_keys(
        attestation,
        {"algorithm", "keyId", "trustAnchor", "payloadSha256", "signature"},
        "attestation",
    )
    trust_anchor = _trust_anchor_path(attestation.get("trustAnchor"))
    tested_anchor = _git_blob(repo, tested_commit, trust_anchor, "trust anchor")
    release_anchor = _git_blob(repo, release_commit, trust_anchor, "trust anchor")
    if tested_anchor != release_anchor:
        raise RuntimeError("trust anchor changed after testedCommit")
    anchor = _parse_trust_anchor(tested_anchor)
    algorithm = str(attestation.get("algorithm", ""))
    key_id = str(attestation.get("keyId", "")).lower()
    if algorithm != anchor["algorithm"] or key_id != anchor["keyId"]:
        raise RuntimeError("attestation key does not match the frozen trust anchor")
    canonical = canonical_attestation_payload(payload)
    payload_digest = str(attestation.get("payloadSha256", "")).lower()
    if not SHA256.fullmatch(payload_digest):
        raise RuntimeError("attestation payloadSha256 is invalid")
    if payload_digest != hashlib.sha256(canonical).hexdigest():
        raise RuntimeError("fleet release attestation signature verification failed")
    signature_text = str(attestation.get("signature", ""))
    try:
        signature = base64.b64decode(signature_text, validate=True)
    except (ValueError, binascii.Error) as error:
        raise RuntimeError("fleet release attestation signature is invalid") from error
    if len(signature) != 64:
        raise RuntimeError("fleet release attestation signature is invalid")
    _verify_signature(str(anchor["publicKeyPem"]), canonical, signature)
    return {
        "algorithm": algorithm,
        "keyId": key_id,
        "trustAnchor": trust_anchor,
        "payloadSha256": payload_digest,
    }


def verify_evidence(
    repo: Path,
    evidence_path: Path,
    release_commit: str,
    release_tag: str,
) -> dict[str, Any]:
    relative_evidence = evidence_path.resolve().relative_to(repo.resolve()).as_posix()
    expected_path = f"docs/release-evidence/{release_tag}.json"
    if relative_evidence != expected_path:
        raise RuntimeError(f"release evidence must be {expected_path}")
    release_commit = _git(repo, "rev-parse", "--verify", f"{release_commit}^{{commit}}").stdout.strip().lower()
    if not COMMIT.fullmatch(release_commit):
        raise RuntimeError("releaseCommit must resolve to a full Git commit SHA")
    evidence_bytes = evidence_path.read_bytes()
    payload = json.loads(evidence_bytes.decode("utf-8"))
    release_payload = json.loads(
        _git_blob(repo, release_commit, relative_evidence, "release evidence").decode("utf-8")
    )
    if payload != release_payload:
        raise RuntimeError("release evidence does not match the release commit")
    if not isinstance(payload, dict):
        raise RuntimeError("release evidence must be a JSON object")
    _exact_keys(payload, {
        "schemaVersion", "releaseTag", "testedCommit", "fixtureDigest",
        "correlationId", "executionProvenance", "reports", "attestation",
    }, "release evidence")
    if payload.get("schemaVersion") != 2 or payload.get("releaseTag") != release_tag:
        raise RuntimeError("release evidence schema or tag does not match the release")
    tested_commit = str(payload.get("testedCommit", "")).lower()
    if not COMMIT.fullmatch(tested_commit):
        raise RuntimeError("testedCommit must be a full Git commit SHA")
    fixture_digest = str(payload.get("fixtureDigest", "")).lower()
    correlation_id = str(payload.get("correlationId", ""))
    if not SHA256.fullmatch(fixture_digest):
        raise RuntimeError("fixtureDigest must be a SHA-256 digest")
    canonical_fixture = repo / CANONICAL_FIXTURE
    actual_fixture_digest = hashlib.sha256(canonical_fixture.read_bytes()).hexdigest()
    if fixture_digest != actual_fixture_digest:
        raise RuntimeError("fixtureDigest does not match the canonical fleet-workflow.v2 fixture")
    if not CORRELATION.fullmatch(correlation_id):
        raise RuntimeError("correlationId must be a UUID")

    reports = payload.get("reports")
    if not isinstance(reports, dict) or set(reports) != set(REPORT_PHASES):
        raise RuntimeError("evidence must contain exactly prepare, remote, and verify reports")
    report_digests: dict[str, str] = {}
    for phase in REPORT_PHASES:
        report_entry = reports[phase]
        if not isinstance(report_entry, dict) or set(report_entry) != {"report", "sha256"}:
            raise RuntimeError(f"{phase} evidence must contain the raw report and its sha256")
        report = report_entry.get("report")
        if not isinstance(report, dict) or report.get("ok") is not True:
            raise RuntimeError(f"{phase} report did not pass")
        _exact_keys(report, {
            "harnessSchemaVersion", "ok", "phase", "fixture", "vault",
            "deviceState", "commit", "fixtureDigest", "correlationId",
            "externalRefs", "checks",
        }, f"{phase} report")
        if report.get("harnessSchemaVersion") != 2:
            raise RuntimeError(f"{phase} report harness schema is unsupported")
        if report.get("phase") != phase:
            raise RuntimeError(f"{phase} report phase does not match")
        if report.get("fixture") != CANONICAL_FIXTURE.as_posix():
            raise RuntimeError(f"{phase} report did not use the canonical v2 fixture")
        if report.get("vault") not in {"<provided-acceptance-vault>", "<temporary-vault>"}:
            raise RuntimeError(f"{phase} report leaked or changed the vault placeholder")
        if report.get("deviceState") != "<machine-local-state-redacted>":
            raise RuntimeError(f"{phase} report leaked or changed device-local state")
        if str(report.get("commit", "")).lower() != tested_commit:
            raise RuntimeError(f"{phase} report commit does not match testedCommit")
        if str(report.get("fixtureDigest", "")).lower() != fixture_digest:
            raise RuntimeError(f"{phase} fixtureDigest does not match")
        if report.get("correlationId") != correlation_id:
            raise RuntimeError(f"{phase} correlationId does not match")
        checks = report.get("checks")
        if not isinstance(checks, list) or not checks or any(
            not isinstance(check, dict) or check.get("ok") is not True for check in checks
        ):
            raise RuntimeError(f"{phase} report checks are missing or failed")
        for check in checks:
            if not {"id", "name", "ok"} <= set(check) <= {"id", "name", "ok", "detail"}:
                raise RuntimeError(f"{phase} report contains an invalid check schema")
        check_ids = [str(check.get("id", "")) for check in checks]
        if len(check_ids) != len(set(check_ids)):
            raise RuntimeError(f"{phase} report contains duplicate check IDs")
        missing_checks = sorted(REQUIRED_CHECK_IDS[phase] - set(check_ids))
        if missing_checks:
            raise RuntimeError(f"{phase} report is missing required checks: {', '.join(missing_checks)}")
        external_refs = report.get("externalRefs")
        if not isinstance(external_refs, list) or any(
            not isinstance(ref, dict) or set(ref) != {"kind", "target"} for ref in external_refs
        ):
            raise RuntimeError(f"{phase} report External Projections are invalid")
        report_digest = str(report_entry.get("sha256", "")).lower()
        if not SHA256.fullmatch(report_digest) or report_digest != report_sha256(report):
            raise RuntimeError(f"{phase} report sha256 does not match its canonical bytes")
        report_digests[phase] = report_digest
    if len(set(report_digests.values())) != len(REPORT_PHASES):
        raise RuntimeError("prepare, remote, and verify report digests must be distinct")
    remote_refs = reports["remote"]["report"].get("externalRefs")
    provenance = payload.get("executionProvenance")
    if not isinstance(provenance, dict):
        raise RuntimeError("executionProvenance is required")
    _exact_keys(
        provenance,
        {"environment", "deviceId", "orcaTask", "orcaTerminal", "runtimeId"},
        "executionProvenance",
    )
    if provenance.get("environment") != "5090" or provenance.get("deviceId") != "device/cloud-5090":
        raise RuntimeError("executionProvenance must identify the real 5090 device")
    if not re.fullmatch(r"task_[a-z0-9-]+", str(provenance.get("orcaTask", ""))):
        raise RuntimeError("executionProvenance.orcaTask is invalid")
    if not re.fullmatch(r"term_[a-z0-9-]+", str(provenance.get("orcaTerminal", ""))):
        raise RuntimeError("executionProvenance.orcaTerminal is invalid")
    if not CORRELATION.fullmatch(str(provenance.get("runtimeId", ""))):
        raise RuntimeError("executionProvenance.runtimeId must be a UUID")
    for kind, provenance_field in (
        ("orca-task", "orcaTask"),
        ("orca-terminal", "orcaTerminal"),
    ):
        matching_targets = [
            ref.get("target")
            for ref in remote_refs
            if isinstance(ref, dict) and ref.get("kind") == kind
        ] if isinstance(remote_refs, list) else []
        if matching_targets != [provenance[provenance_field]]:
            raise RuntimeError(
                f"remote report must contain exactly one {kind} projection matching "
                f"executionProvenance.{provenance_field}"
            )

    attestation = _verify_attestation(repo, payload, tested_commit, release_commit)

    ancestor = _git(repo, "merge-base", "--is-ancestor", tested_commit, release_commit, check=False)
    if ancestor.returncode != 0:
        raise RuntimeError("testedCommit is not an ancestor of the release commit")
    changed = {
        path.replace("\\", "/")
        for path in _git(repo, "diff", "--name-only", f"{tested_commit}..{release_commit}").stdout.splitlines()
        if path.strip()
    }
    allowed = EVIDENCE_ONLY_PATHS | {relative_evidence}
    product_changes = sorted(changed - allowed)
    if product_changes:
        raise RuntimeError(
            "release commit contains product changes not covered by the tested SHA: "
            + ", ".join(product_changes)
        )
    if relative_evidence not in changed:
        raise RuntimeError("release evidence was not committed after the tested product SHA")
    return {
        "ok": True,
        "releaseTag": release_tag,
        "releaseCommit": release_commit,
        "testedCommit": tested_commit,
        "fixtureDigest": fixture_digest,
        "correlationId": correlation_id,
        "reportDigests": report_digests,
        "executionProvenance": provenance,
        "attestation": attestation,
        "evidenceOnlyChanges": sorted(changed),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("--release-commit", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        report = verify_evidence(ROOT, args.evidence, args.release_commit, args.tag)
    except Exception as error:
        if args.json:
            print(json.dumps({"ok": False, "error": str(error)}, indent=2))
        else:
            print(f"Fleet release evidence: failed: {error}", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("Fleet release evidence: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
