#!/usr/bin/env python
"""Sign one fleet release evidence document with the device-local 5090 key."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

import verify_fleet_release_evidence as verifier


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TRUST_ANCHOR = Path("docs/release-evidence/trust/device-cloud-5090.json")
BASE_FIELDS = {
    "schemaVersion",
    "releaseTag",
    "testedCommit",
    "fixtureDigest",
    "correlationId",
    "executionProvenance",
    "reports",
}


def _outside_repository(path: Path) -> Path:
    resolved = path.expanduser().resolve(strict=True)
    try:
        resolved.relative_to(ROOT.resolve())
    except ValueError:
        return resolved
    raise RuntimeError("the 5090 private key must remain outside the repository")


def _load_anchor(relative_path: Path, tested_commit: str) -> tuple[str, dict[str, Any]]:
    trust_path = verifier._trust_anchor_path(relative_path.as_posix())
    working_bytes = (ROOT / trust_path).read_bytes()
    tested_bytes = verifier._git_blob(ROOT, tested_commit, trust_path, "trust anchor")
    working_anchor = verifier._parse_trust_anchor(working_bytes)
    tested_anchor = verifier._parse_trust_anchor(tested_bytes)
    if working_anchor != tested_anchor:
        raise RuntimeError("the working trust anchor does not match testedCommit")
    return trust_path, tested_anchor


def _private_key_id(private_key: Path) -> str:
    result = subprocess.run(
        [
            verifier._openssl(), "pkey", "-in", str(private_key),
            "-pubout", "-outform", "DER",
        ],
        check=False,
        capture_output=True,
    )
    if result.returncode != 0 or not result.stdout:
        raise RuntimeError("the 5090 private key could not be read by OpenSSL")
    return hashlib.sha256(result.stdout).hexdigest()


def _sign(private_key: Path, canonical: bytes) -> bytes:
    with tempfile.TemporaryDirectory(prefix="llmwiki-attestation-sign-") as temporary:
        root = Path(temporary)
        payload_path = root / "payload.json"
        signature_path = root / "signature.bin"
        payload_path.write_bytes(canonical)
        result = subprocess.run(
            [
                verifier._openssl(), "pkeyutl", "-sign", "-rawin",
                "-inkey", str(private_key), "-in", str(payload_path),
                "-out", str(signature_path),
            ],
            check=False,
            capture_output=True,
        )
        if result.returncode != 0 or not signature_path.is_file():
            raise RuntimeError("5090 fleet release attestation signing failed")
        signature = signature_path.read_bytes()
    if len(signature) != 64:
        raise RuntimeError("OpenSSL returned an invalid Ed25519 signature")
    return signature


def sign_evidence(
    evidence_path: Path,
    output_path: Path,
    private_key_path: Path,
    trust_anchor_path: Path = DEFAULT_TRUST_ANCHOR,
) -> dict[str, str]:
    private_key = _outside_repository(private_key_path)
    payload = json.loads(evidence_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("release evidence draft must be a JSON object")
    if frozenset(payload) not in {
        frozenset(BASE_FIELDS),
        frozenset(BASE_FIELDS | {"attestation"}),
    }:
        raise RuntimeError("release evidence draft fields do not match the schema")
    if payload.get("schemaVersion") != 2:
        raise RuntimeError("release evidence draft must use schemaVersion 2")
    tested_commit = str(payload.get("testedCommit", "")).lower()
    if not verifier.COMMIT.fullmatch(tested_commit):
        raise RuntimeError("testedCommit must be a full Git commit SHA")
    resolved_tested = verifier._git(
        ROOT,
        "rev-parse",
        "--verify",
        f"{tested_commit}^{{commit}}",
    ).stdout.strip().lower()
    if resolved_tested != tested_commit:
        raise RuntimeError("testedCommit did not resolve exactly")
    trust_anchor, anchor = _load_anchor(trust_anchor_path, tested_commit)
    private_key_id = _private_key_id(private_key)
    if private_key_id != anchor["keyId"]:
        raise RuntimeError("the private key does not match the frozen 5090 trust anchor")
    payload["attestation"] = {
        "algorithm": anchor["algorithm"],
        "keyId": anchor["keyId"],
        "trustAnchor": trust_anchor,
        "payloadSha256": "0" * 64,
        "signature": "pending",
    }
    canonical = verifier.canonical_attestation_payload(payload)
    payload_digest = hashlib.sha256(canonical).hexdigest()
    signature = _sign(private_key, canonical)
    verifier._verify_signature(str(anchor["publicKeyPem"]), canonical, signature)
    payload["attestation"]["payloadSha256"] = payload_digest
    payload["attestation"]["signature"] = base64.b64encode(signature).decode("ascii")

    expected_output = ROOT / "docs" / "release-evidence" / f"{payload.get('releaseTag')}.json"
    if output_path.resolve() != expected_output.resolve():
        raise RuntimeError(f"signed evidence output must be {expected_output}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        encoding="utf-8",
        newline="\n",
        dir=output_path.parent,
        prefix=f".{output_path.name}.",
        suffix=".tmp",
        delete=False,
    ) as temporary:
        json.dump(payload, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    try:
        os.replace(temporary_path, output_path)
    finally:
        temporary_path.unlink(missing_ok=True)
    return {
        "output": output_path.resolve().as_posix(),
        "keyId": str(anchor["keyId"]),
        "payloadSha256": payload_digest,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, required=True, help="Unsigned schema v2 draft")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--private-key", type=Path, required=True)
    parser.add_argument("--trust-anchor", type=Path, default=DEFAULT_TRUST_ANCHOR)
    args = parser.parse_args()
    try:
        result = sign_evidence(
            args.evidence,
            args.output,
            args.private_key,
            args.trust_anchor,
        )
    except Exception as error:
        print(f"Fleet release evidence signing: failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
