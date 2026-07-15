from __future__ import annotations

import base64
import importlib.util
import hashlib
import json
import subprocess
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "verify_fleet_release_evidence.py"
SPEC = importlib.util.spec_from_file_location("verify_fleet_release_evidence", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
verify_fleet_release_evidence = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verify_fleet_release_evidence)

TRUST_ANCHOR = "docs/release-evidence/trust/device-cloud-5090-test.json"
REAL_TRUST_ANCHOR = (
    Path(__file__).resolve().parents[1]
    / "docs" / "release-evidence" / "trust" / "device-cloud-5090.json"
)
REAL_KEY_ID = "0554ab8225edfaacd693ec4844fdae01b8e0ba59f61d520b1745a4dd43ff3645"


def _git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=repo, check=True,
        capture_output=True, text=True, encoding="utf-8",
    ).stdout.strip()


def _commit(repo: Path, message: str) -> str:
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", message)
    return _git(repo, "rev-parse", "HEAD")


def _generate_keypair(root: Path, name: str) -> Path:
    key = root / f"{name}.pem"
    key.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["openssl", "genpkey", "-algorithm", "Ed25519", "-out", str(key)],
        check=True,
        capture_output=True,
    )
    return key


def _public_key(key: Path) -> tuple[str, str]:
    public = subprocess.run(
        ["openssl", "pkey", "-in", str(key), "-pubout"],
        check=True,
        capture_output=True,
    ).stdout.decode("ascii")
    der = subprocess.run(
        ["openssl", "pkey", "-pubin", "-outform", "DER"],
        input=public.encode("ascii"),
        check=True,
        capture_output=True,
    ).stdout
    return public, hashlib.sha256(der).hexdigest()


def _write_trust_anchor(repo: Path, key: Path) -> str:
    public_key, key_id = _public_key(key)
    anchor = repo / TRUST_ANCHOR
    anchor.parent.mkdir(parents=True, exist_ok=True)
    anchor.write_text(json.dumps({
        "schemaVersion": 1,
        "algorithm": "ed25519",
        "keyId": key_id,
        "deviceId": "device/cloud-5090",
        "namespace": verify_fleet_release_evidence.ATTESTATION_NAMESPACE,
        "publicKeyPem": public_key,
    }, indent=2) + "\n", encoding="utf-8")
    return key_id


def _sign_payload(payload: dict[str, object], key: Path, key_id: str) -> None:
    payload["attestation"] = {
        "algorithm": "ed25519",
        "keyId": key_id,
        "trustAnchor": TRUST_ANCHOR,
        "payloadSha256": "0" * 64,
        "signature": "pending",
    }
    canonical = verify_fleet_release_evidence.canonical_attestation_payload(payload)
    payload["attestation"]["payloadSha256"] = hashlib.sha256(canonical).hexdigest()  # type: ignore[index]
    message = key.parent / "fleet-release-attestation.json"
    signature = key.parent / "fleet-release-attestation.sig"
    message.write_bytes(canonical)
    signature.unlink(missing_ok=True)
    try:
        subprocess.run(
            [
                "openssl", "pkeyutl", "-sign", "-rawin", "-inkey", str(key),
                "-in", str(message), "-out", str(signature),
            ],
            check=True,
            capture_output=True,
        )
        payload["attestation"]["signature"] = base64.b64encode(  # type: ignore[index]
            signature.read_bytes()
        ).decode("ascii")
    finally:
        message.unlink(missing_ok=True)
        signature.unlink(missing_ok=True)


def _repo(tmp_path: Path, tag: str = "v9.9.9-beta.1") -> tuple[Path, Path, str, str]:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init")
    _git(repo, "config", "user.email", "qa@example.invalid")
    _git(repo, "config", "user.name", "QA")
    (repo / "mcp-server").mkdir()
    (repo / "mcp-server" / "bundle.js").write_text("product\n", encoding="utf-8")
    fixture_path = repo / "tests" / "fixtures" / "fleet-workflow.v2.json"
    fixture_path.parent.mkdir(parents=True)
    fixture_path.write_text('{"schemaVersion":2}\n', encoding="utf-8")
    key = _generate_keypair(tmp_path / "keys", "device-cloud-5090")
    key_id = _write_trust_anchor(repo, key)
    tested = _commit(repo, "product")
    evidence = repo / "docs" / "release-evidence" / f"{tag}.json"
    evidence.parent.mkdir(parents=True, exist_ok=True)
    fixture = hashlib.sha256(fixture_path.read_bytes()).hexdigest()
    correlation = "12345678-1234-4123-8123-123456789abc"
    reports = {}
    for phase in ("prepare", "remote", "verify"):
        report = {
            "harnessSchemaVersion": 2,
            "ok": True,
            "phase": phase,
            "fixture": "tests/fixtures/fleet-workflow.v2.json",
            "vault": "<provided-acceptance-vault>",
            "deviceState": "<machine-local-state-redacted>",
            "commit": tested,
            "fixtureDigest": fixture,
            "correlationId": correlation,
            "externalRefs": [
                {"kind": "orca-task", "target": "task_fixture-run"},
                {"kind": "orca-terminal", "target": "term_fixture-run"},
            ],
            "checks": [
                {"id": check_id, "name": check_id.replace("-", " "), "ok": True}
                for check_id in sorted(verify_fleet_release_evidence.REQUIRED_CHECK_IDS[phase])
            ],
        }
        reports[phase] = {
            "report": report,
            "sha256": verify_fleet_release_evidence.report_sha256(report),
        }
    payload: dict[str, object] = {
        "schemaVersion": 2,
        "releaseTag": tag,
        "testedCommit": tested,
        "fixtureDigest": fixture,
        "correlationId": correlation,
        "executionProvenance": {
            "environment": "5090",
            "deviceId": "device/cloud-5090",
            "orcaTask": "task_fixture-run",
            "orcaTerminal": "term_fixture-run",
            "runtimeId": "82a396cc-c9ed-4d64-a108-73a013b240f2",
        },
        "reports": reports,
    }
    _sign_payload(payload, key, key_id)
    evidence.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    release = _commit(repo, "evidence")
    return repo, evidence, tested, release


def test_exact_sha_evidence_allows_only_evidence_descendant(tmp_path: Path) -> None:
    repo, evidence, tested, release = _repo(tmp_path)
    report = verify_fleet_release_evidence.verify_evidence(repo, evidence, release, "v9.9.9-beta.1")
    assert report["ok"] is True
    assert report["testedCommit"] == tested
    assert report["evidenceOnlyChanges"] == ["docs/release-evidence/v9.9.9-beta.1.json"]
    assert report["attestation"]["keyId"] == json.loads(
        evidence.read_text(encoding="utf-8")
    )["attestation"]["keyId"]


def test_enrolled_5090_trust_anchor_matches_declared_public_key() -> None:
    anchor = verify_fleet_release_evidence._parse_trust_anchor(REAL_TRUST_ANCHOR.read_bytes())
    assert anchor["keyId"] == REAL_KEY_ID
    assert "PRIVATE KEY" not in anchor["publicKeyPem"]


def test_canonical_attestation_payload_covers_release_reports_and_full_provenance(
    tmp_path: Path,
) -> None:
    _, evidence, _, _ = _repo(tmp_path)
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    canonical = json.loads(
        verify_fleet_release_evidence.canonical_attestation_payload(payload)
    )
    assert canonical["releaseTag"] == payload["releaseTag"]
    assert canonical["testedCommit"] == payload["testedCommit"]
    assert canonical["fixtureDigest"] == payload["fixtureDigest"]
    assert canonical["correlationId"] == payload["correlationId"]
    assert canonical["executionProvenance"] == payload["executionProvenance"]
    assert canonical["attestationContext"] == {
        "algorithm": "ed25519",
        "keyId": payload["attestation"]["keyId"],
        "namespace": verify_fleet_release_evidence.ATTESTATION_NAMESPACE,
        "trustAnchor": TRUST_ANCHOR,
    }
    assert canonical["reportDigests"] == {
        phase: payload["reports"][phase]["sha256"]
        for phase in verify_fleet_release_evidence.REPORT_PHASES
    }
    original_prepare_digest = canonical["reportDigests"]["prepare"]
    payload["reports"]["prepare"]["sha256"] = "f" * 64
    recomputed = json.loads(
        verify_fleet_release_evidence.canonical_attestation_payload(payload)
    )
    assert recomputed["reportDigests"]["prepare"] == original_prepare_digest


def test_missing_openssl_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(verify_fleet_release_evidence.shutil, "which", lambda _: None)
    with pytest.raises(RuntimeError, match="OpenSSL is required"):
        verify_fleet_release_evidence._openssl()


def test_missing_attestation_is_rejected(tmp_path: Path) -> None:
    repo, evidence, _, _ = _repo(tmp_path)
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    del payload["attestation"]
    evidence.write_text(json.dumps(payload), encoding="utf-8")
    release = _commit(repo, "unsigned evidence")
    with pytest.raises(RuntimeError, match="fields do not match"):
        verify_fleet_release_evidence.verify_evidence(repo, evidence, release, "v9.9.9-beta.1")


def test_self_forged_report_with_recomputed_digest_is_rejected(tmp_path: Path) -> None:
    repo, evidence, _, _ = _repo(tmp_path)
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    report = payload["reports"]["remote"]["report"]
    report["checks"][0]["detail"] = "self-authored replacement"
    payload["reports"]["remote"]["sha256"] = verify_fleet_release_evidence.report_sha256(report)
    evidence.write_text(json.dumps(payload), encoding="utf-8")
    release = _commit(repo, "self forged report")
    with pytest.raises(RuntimeError, match="signature verification failed"):
        verify_fleet_release_evidence.verify_evidence(repo, evidence, release, "v9.9.9-beta.1")


def test_signature_from_wrong_key_is_rejected(tmp_path: Path) -> None:
    repo, evidence, _, _ = _repo(tmp_path)
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    wrong_key = _generate_keypair(tmp_path / "wrong-keys", "wrong-device")
    _sign_payload(payload, wrong_key, payload["attestation"]["keyId"])
    evidence.write_text(json.dumps(payload), encoding="utf-8")
    release = _commit(repo, "wrong key signature")
    with pytest.raises(RuntimeError, match="signature verification failed"):
        verify_fleet_release_evidence.verify_evidence(repo, evidence, release, "v9.9.9-beta.1")


def test_malformed_base64_signature_is_rejected(tmp_path: Path) -> None:
    repo, evidence, _, _ = _repo(tmp_path)
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    payload["attestation"]["signature"] = "not-base64!*"
    evidence.write_text(json.dumps(payload), encoding="utf-8")
    release = _commit(repo, "malformed signature")
    with pytest.raises(RuntimeError, match="signature is invalid"):
        verify_fleet_release_evidence.verify_evidence(
            repo,
            evidence,
            release,
            "v9.9.9-beta.1",
        )


def test_tampered_execution_provenance_is_rejected(tmp_path: Path) -> None:
    repo, evidence, _, _ = _repo(tmp_path)
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    payload["executionProvenance"]["runtimeId"] = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    evidence.write_text(json.dumps(payload), encoding="utf-8")
    release = _commit(repo, "tampered provenance")
    with pytest.raises(RuntimeError, match="signature verification failed"):
        verify_fleet_release_evidence.verify_evidence(repo, evidence, release, "v9.9.9-beta.1")


def test_arbitrary_runtime_id_is_rejected_before_attestation(tmp_path: Path) -> None:
    repo, evidence, _, _ = _repo(tmp_path)
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    payload["executionProvenance"]["runtimeId"] = "runtime_forged"
    evidence.write_text(json.dumps(payload), encoding="utf-8")
    release = _commit(repo, "invalid runtime ID")
    with pytest.raises(RuntimeError, match="runtimeId must be a UUID"):
        verify_fleet_release_evidence.verify_evidence(
            repo,
            evidence,
            release,
            "v9.9.9-beta.1",
        )


def test_remote_orca_projection_must_match_signed_provenance(tmp_path: Path) -> None:
    repo, evidence, _, _ = _repo(tmp_path)
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    remote = payload["reports"]["remote"]
    remote["report"]["externalRefs"][0]["target"] = "task_other-run"
    remote["sha256"] = verify_fleet_release_evidence.report_sha256(remote["report"])
    evidence.write_text(json.dumps(payload), encoding="utf-8")
    release = _commit(repo, "mismatched Orca projection")
    with pytest.raises(RuntimeError, match="exactly one orca-task projection matching"):
        verify_fleet_release_evidence.verify_evidence(
            repo,
            evidence,
            release,
            "v9.9.9-beta.1",
        )


def test_remote_orca_projection_must_not_be_duplicated(tmp_path: Path) -> None:
    repo, evidence, _, _ = _repo(tmp_path)
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    remote = payload["reports"]["remote"]
    remote["report"]["externalRefs"].append({
        "kind": "orca-task",
        "target": payload["executionProvenance"]["orcaTask"],
    })
    remote["sha256"] = verify_fleet_release_evidence.report_sha256(remote["report"])
    evidence.write_text(json.dumps(payload), encoding="utf-8")
    release = _commit(repo, "duplicated Orca projection")
    with pytest.raises(RuntimeError, match="exactly one orca-task projection matching"):
        verify_fleet_release_evidence.verify_evidence(
            repo,
            evidence,
            release,
            "v9.9.9-beta.1",
        )


def test_trust_anchor_changed_after_tested_commit_is_rejected(tmp_path: Path) -> None:
    repo, evidence, _, _ = _repo(tmp_path)
    anchor = repo / TRUST_ANCHOR
    payload = json.loads(anchor.read_text(encoding="utf-8"))
    payload["keyId"] = "device/cloud-5090/forged-anchor"
    anchor.write_text(json.dumps(payload), encoding="utf-8")
    release = _commit(repo, "changed trust anchor")
    with pytest.raises(RuntimeError, match="trust anchor changed after testedCommit"):
        verify_fleet_release_evidence.verify_evidence(repo, evidence, release, "v9.9.9-beta.1")


def test_product_change_after_tested_sha_is_rejected(tmp_path: Path) -> None:
    repo, evidence, _, _ = _repo(tmp_path)
    (repo / "mcp-server" / "bundle.js").write_text("untested product\n", encoding="utf-8")
    release = _commit(repo, "untested product mutation")
    with pytest.raises(RuntimeError, match="product changes not covered"):
        verify_fleet_release_evidence.verify_evidence(repo, evidence, release, "v9.9.9-beta.1")


def test_report_identity_mismatch_is_rejected(tmp_path: Path) -> None:
    repo, evidence, _, _ = _repo(tmp_path)
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    payload["reports"]["remote"]["report"]["correlationId"] = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    evidence.write_text(json.dumps(payload), encoding="utf-8")
    release = _commit(repo, "bad evidence")
    with pytest.raises(RuntimeError, match="remote correlationId"):
        verify_fleet_release_evidence.verify_evidence(repo, evidence, release, "v9.9.9-beta.1")


def test_forged_report_digest_is_rejected(tmp_path: Path) -> None:
    repo, evidence, _, _ = _repo(tmp_path)
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    payload["reports"]["remote"]["report"]["checks"][0]["name"] = "forged"
    evidence.write_text(json.dumps(payload), encoding="utf-8")
    release = _commit(repo, "forged evidence")
    with pytest.raises(RuntimeError, match="sha256 does not match"):
        verify_fleet_release_evidence.verify_evidence(repo, evidence, release, "v9.9.9-beta.1")


def test_noncanonical_fixture_digest_is_rejected(tmp_path: Path) -> None:
    repo, evidence, _, _ = _repo(tmp_path)
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    payload["fixtureDigest"] = "f" * 64
    evidence.write_text(json.dumps(payload), encoding="utf-8")
    release = _commit(repo, "wrong fixture evidence")
    with pytest.raises(RuntimeError, match="canonical fleet-workflow.v2 fixture"):
        verify_fleet_release_evidence.verify_evidence(repo, evidence, release, "v9.9.9-beta.1")


def test_minimal_forged_checks_are_rejected(tmp_path: Path) -> None:
    repo, evidence, _, _ = _repo(tmp_path)
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    report = payload["reports"]["verify"]["report"]
    report["checks"] = [{"id": "forged-pass", "name": "forged", "ok": True}]
    payload["reports"]["verify"]["sha256"] = verify_fleet_release_evidence.report_sha256(report)
    evidence.write_text(json.dumps(payload), encoding="utf-8")
    release = _commit(repo, "minimal forged checks")
    with pytest.raises(RuntimeError, match="missing required checks"):
        verify_fleet_release_evidence.verify_evidence(repo, evidence, release, "v9.9.9-beta.1")


def test_extra_secret_bearing_evidence_fields_are_rejected(tmp_path: Path) -> None:
    repo, evidence, _, _ = _repo(tmp_path)
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    payload["handoffToken"] = "must-not-be-accepted"
    evidence.write_text(json.dumps(payload), encoding="utf-8")
    release = _commit(repo, "unsafe extra evidence")
    with pytest.raises(RuntimeError, match="fields do not match"):
        verify_fleet_release_evidence.verify_evidence(repo, evidence, release, "v9.9.9-beta.1")
