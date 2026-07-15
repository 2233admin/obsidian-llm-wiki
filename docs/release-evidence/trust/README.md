# 5090 release-attestation trust

This directory contains public trust anchors only. The enrolled 5090 Ed25519
public key is `device-cloud-5090.json`. Its `keyId` is the SHA-256 digest of the
DER-encoded SubjectPublicKeyInfo:

```text
0554ab8225edfaacd693ec4844fdae01b8e0ba59f61d520b1745a4dd43ff3645
```

The corresponding private key remains on 5090 at
`%LOCALAPPDATA%\LLMWiki\attestation\5090-ed25519-private.pem`. Never copy that
file into this repository, a fleet vault, an artifact branch, a report, a
terminal transcript, or release evidence.

## Enrollment and fingerprint verification

Enrollment is a product change. Add or rotate a public trust anchor, commit it,
and only then run the real 5090 acceptance sequence at that exact product SHA.
A release evidence commit cannot introduce or replace its own trusted key.

On 5090, verify the public key and fingerprint from the private key without
piping binary DER through Windows PowerShell 5, which can transcode the bytes:

```powershell
$privateKey = Join-Path $env:LOCALAPPDATA 'LLMWiki\attestation\5090-ed25519-private.pem'
$publicPem = Join-Path $env:TEMP '5090-ed25519-public.pem'
$publicDer = Join-Path $env:TEMP '5090-ed25519-public.der'
openssl pkey -in $privateKey -pubout -out $publicPem
openssl pkey -in $privateKey -pubout -outform DER -out $publicDer
openssl dgst -sha256 $publicDer
Get-Content $publicPem
Remove-Item $publicPem, $publicDer
```

Only the PEM public key and verified DER fingerprint belong in the trust anchor.
The verifier independently recomputes the fingerprint before using the key.

## Signing release evidence on 5090

Create an unsigned schema v2 draft outside the repository after the `prepare`,
`remote`, and `verify` reports agree. It must contain the release tag, exact
tested product SHA, fixture digest, correlation ID, all three raw reports and
their canonical digests, and complete execution provenance including
`runtimeId`. Then sign it on 5090:

```powershell
$privateKey = Join-Path $env:LOCALAPPDATA 'LLMWiki\attestation\5090-ed25519-private.pem'
python scripts/sign_fleet_release_evidence.py `
  --evidence (Join-Path $env:TEMP 'llmwiki-fleet-evidence-draft.json') `
  --output 'docs/release-evidence/<release-tag>.json' `
  --private-key $privateKey
```

The helper first proves that the private key matches the public anchor frozen at
`testedCommit`. It signs the canonical payload using OpenSSL Ed25519
`pkeyutl -sign -rawin`, verifies the result locally with the public key, and only
then writes the signed document. It prints the output path, public key ID, and
payload digest; it never prints private key material or the signature.

The canonical signed payload covers:

- `releaseTag`, `testedCommit`, `fixtureDigest`, and `correlationId`;
- recomputed canonical SHA-256 digests for the `prepare`, `remote`, and `verify`
  raw reports;
- every `executionProvenance` field, including `environment`, `deviceId`,
  `orcaTask`, `orcaTerminal`, and `runtimeId`; and
- the fixed algorithm, key ID, protocol namespace, and trust-anchor path.

Commit only the signed evidence after the tested product SHA. The release gate
fails closed when OpenSSL is unavailable, the signature is absent or malformed,
the key is wrong, the reports or provenance were changed, the public anchor was
not already frozen at the tested SHA, or the release commit contains untested
product changes.

Key rotation requires a new trust-anchor product commit and a fresh complete
5090 run. Previous evidence stays bound to its original tested SHA and anchor.
