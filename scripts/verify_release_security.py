#!/usr/bin/env python3
"""Deterministic, offline release security and runtime-license gates for llmwiki."""
from __future__ import annotations

import argparse
import ast
import gzip
import hashlib
import io
import json
import re
import tarfile
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Iterator


ROOT = Path(__file__).resolve().parents[1]
POLICY_VERSION = 2
FIXTURE_ALLOW_MARKER = "release-security: allow-test-fixture"
PROHIBITED_PROVENANCE = re.compile(r"(?:exxeta|exxperts)", re.IGNORECASE)
PROVENANCE_POLICY_TEST_FILES = frozenset({"tests/test_verify_release_security.py"})

# JSON fixtures cannot carry comments without changing their conformance shape.
# These are exact SHA-256 prefixes of deliberately synthetic path values. Any
# value change invalidates the exception and requires an explicit review here.
FIXTURE_FAKE_MATCH_ALLOWLIST: dict[str, frozenset[str]] = {
    "compiler/tests/fixtures/project-context/architecture-fixture.json": frozenset(
        {"6c6b4d074728a61d"}
    ),
    "packages/settings-platform/fixtures/conformance/full-precedence.json": frozenset(
        {"28465484f273cedf", "7c6f94f88a19157f", "813c4294bc581775"}
    ),
    "packages/settings-platform/fixtures/expected/full-precedence.snapshot.json": frozenset(
        {"28465484f273cedf", "7c6f94f88a19157f", "813c4294bc581775"}
    ),
}

# GPL-3.0-only compatibility is an explicit review decision. A dependency whose
# SPDX expression is not listed here must be reviewed and added deliberately.
GPL3_COMPATIBLE_LICENSES = frozenset(
    {
        "0BSD",
        "Apache-2.0",
        "Apache-2.0 OR MIT",
        "BSD-2-Clause",
        "BSD-3-Clause",
        "CC0-1.0",
        "GPL-3.0-only",
        "GPL-3.0-or-later",
        "ISC",
        "LGPL-2.1-or-later",
        "LGPL-3.0-only",
        "LGPL-3.0-or-later",
        "MIT",
        "Unlicense",
    }
)

TEXT_SUFFIXES = frozenset(
    {
        ".cjs",
        ".css",
        ".cts",
        ".d.ts",
        ".html",
        ".js",
        ".json",
        ".jsx",
        ".map",
        ".md",
        ".mjs",
        ".mts",
        ".py",
        ".rst",
        ".sh",
        ".toml",
        ".ts",
        ".tsx",
        ".txt",
        ".yaml",
        ".yml",
    }
)
DOCUMENT_SUFFIXES = frozenset({".md", ".rst"})
IGNORED_PARTS = frozenset(
    {
        ".git",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        "__pycache__",
        "coverage",
        "node_modules",
        "pr-49-review-2",
    }
)

LEAK_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (
        "private-key",
        re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    ),
    (
        "bearer-credential",
        re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]{12,}", re.IGNORECASE),
    ),
    (
        "credential-prefix",
        re.compile(
            r"(?<![A-Za-z0-9])(?:"
            r"AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|"
            r"github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|"
            r"sk-(?:proj-)?[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}"
            r")"
        ),
    ),
    (
        "url-credential",
        re.compile(
            r"\b[A-Za-z][A-Za-z0-9+.-]*://[^\s/@:]+:[^\s/@]+@[^\s/]+",
            re.IGNORECASE,
        ),
    ),
    (
        "embedded-user-password",
        re.compile(
            r"(?<![A-Za-z0-9])(?:postgres|admin|root|user):[^@\s:/]{4,}@"
            r"[A-Za-z0-9.-]+",
            re.IGNORECASE,
        ),
    ),
    (
        "sensitive-literal",
        re.compile(
            r"(?<![A-Za-z0-9])[\"']?(?:api[_-]?key|client[_-]?secret|access[_-]?token|"
            r"refresh[_-]?token|lease[_-]?token|handoff[_-]?token|"
            r"prompt[_-]?(?:body|sentinel))\b[\"']?\s*[:=]\s*[\"']"
            r"(?:[^\"'\r\n]{12,})[\"']",
            re.IGNORECASE,
        ),
    ),
    (
        "fleet-prompt-sentinel",
        re.compile(
            r"\b(?:LLMWIKI[_-]?)?(?:(?:LEASE|HANDOFF)(?:[_-]TOKEN)?|"
            r"PROMPT(?:[_-]BODY)?)[_-]SENTINEL[_-][A-Za-z0-9_-]{4,}\b",
            re.IGNORECASE,
        ),
    ),
    (
        "legacy-personal-default",
        re.compile(r"\bboris\b", re.IGNORECASE),
    ),
    (
        "machine-absolute-path",
        re.compile(
            r"(?<![A-Za-z0-9])(?:"
            r"[A-Za-z]:\\{1,2}[^\s\"'`<>|]+|"
            r"[A-Za-z]:/(?!\\)[^\s\\\"'`<>|]+|"
            r"/(?:home|Users)/[A-Za-z0-9._-]+(?:/[^\s\"'`<>|]+)+|"
            r"(?:\\\\){2}[A-Za-z0-9._-]+(?:\\\\|\\)[A-Za-z0-9$._-]+"
            r"(?:\\\\|\\)[^\s\"'`<>|]+"
            r")"
        ),
    ),
)

REQUIRED_GENERATED_FILES = (
    Path("mcp-server/bundle.js"),
    Path("mcp-server/agent-domain-cli.js"),
    Path("mcp-server/memu-query.js"),
    Path("mcp-server/usage-cli.js"),
    Path("obsidian-plugin/main.js"),
)
CORE_NODE_COMPONENTS = (
    (Path("mcp-server/package.json"), Path("mcp-server/package-lock.json")),
    (Path("obsidian-plugin/package.json"), Path("obsidian-plugin/package-lock.json")),
    (Path("packages/agent-domain/package.json"), Path("packages/agent-domain/package-lock.json")),
    (Path("packages/settings-platform/package.json"), Path("packages/settings-platform/package-lock.json")),
)
ASK_MATE_NODE_COMPONENTS = (
    (Path("packages/visual-workspace/package.json"), Path("packages/visual-workspace/package-lock.json")),
    (Path("packages/problem-intake/package.json"), Path("packages/problem-intake/package-lock.json")),
)
PYTHON_COMPONENTS = (Path("compiler/pyproject.toml"),)
PYTHON_RUNTIME_LICENSES = {
    # Reviewed from the package's SPDX metadata and upstream license files.
    # This map is intentionally local: new Python runtime dependencies fail
    # until their license is reviewed and recorded here.
    "orjson": "Apache-2.0 OR MIT",
}

ASK_MATE_SCHEMAS = (
    Path("packages/visual-workspace/schemas/mind-map-document.schema.json"),
    Path("packages/visual-workspace/schemas/visual-edit-plan.schema.json"),
    Path("packages/visual-workspace/schemas/visual-apply-request.schema.json"),
    Path("packages/visual-workspace/schemas/graph-relation-evidence.schema.json"),
    Path("packages/problem-intake/schemas/problem-report.schema.json"),
    Path("packages/problem-intake/schemas/problem-observation.schema.json"),
    Path("packages/problem-intake/schemas/issue-change-plan.schema.json"),
    Path("packages/problem-intake/schemas/problem-disposition.schema.json"),
    Path("packages/problem-intake/schemas/external-contribution-plan.schema.json"),
)
VISUAL_WORKSPACE_OPERATIONS = (
    "visual.context.read",
    "visual.map.read",
    "visual.map.plan",
    "visual.map.apply",
    "visual.map.project",
)
PROBLEM_INTAKE_OPERATIONS = (
    "problem.intake.scan",
    "problem.intake.observe",
    "problem.intake.list",
    "problem.intake.lifecycle.apply",
    "problem.intake.verification.apply",
    "problem.intake.issue.plan",
    "problem.intake.issue.apply",
    "problem.intake.contribution.plan",
    "problem.intake.contribution.apply",
)
ASK_MATE_OPERATIONS = VISUAL_WORKSPACE_OPERATIONS + PROBLEM_INTAKE_OPERATIONS
ASK_MATE_SOURCE_CONTRACTS: dict[Path, tuple[str, ...]] = {
    Path("mcp-server/src/visual-workspace/operations.ts"): VISUAL_WORKSPACE_OPERATIONS,
    Path("mcp-server/src/problem-intake/operations.ts"): PROBLEM_INTAKE_OPERATIONS,
    Path("obsidian-plugin/src/ask-mate/client.ts"): (
        "visual.context.read",
        "visual.map.read",
        "visual.map.plan",
        "visual.map.apply",
        "problem.intake.issue.plan",
        "problem.intake.issue.apply",
        "problem.intake.contribution.plan",
        "problem.intake.contribution.apply",
    ),
    Path("obsidian-plugin/src/production-control-plane-host.ts"): (
        "createVaultGovernedContributionPort",
        "makeVisualWorkspaceOps",
        "makeProblemIntakeOps",
        "createProductionProjectHubIntegration",
    ),
    Path("mcp-server/src/contributions/contracts.ts"): (
        "PendingContributionReceipt",
        "OutcomeUnknownContributionReceipt",
        "ContributionReceiptStore",
    ),
    Path("mcp-server/src/contributions/receipts.ts"): (
        "CONTRIBUTION_RECEIPT_SCHEMA_VERSION",
        "MemoryContributionReceiptStore",
        "JsonFileContributionReceiptStore",
    ),
}
ASK_MATE_GENERATED_CONTRACTS: dict[Path, tuple[str, ...]] = {
    Path("mcp-server/bundle.js"): ASK_MATE_OPERATIONS,
    Path("obsidian-plugin/main.js"): (
        "llmwiki-ask-mate",
        "visual.context.read",
        "visual.map.read",
        "visual.map.plan",
        "visual.map.apply",
        "visual.map.project",
        "problem.intake.scan",
        "problem.intake.observe",
        "problem.intake.list",
        "problem.intake.lifecycle.apply",
        "problem.intake.verification.apply",
        "problem.intake.issue.plan",
        "problem.intake.issue.apply",
        "problem.intake.contribution.plan",
        "problem.intake.contribution.apply",
    ),
}
ASK_MATE_BUILD_OUTPUTS = (
    Path("packages/visual-workspace/dist/src/index.js"),
    Path("packages/problem-intake/dist/src/index.js"),
)
ASK_MATE_TEST_EVIDENCE = (
    Path("packages/visual-workspace/tests/schemas.test.ts"),
    Path("packages/visual-workspace/tests/sources.test.ts"),
    Path("packages/visual-workspace/tests/projections.test.ts"),
    Path("packages/problem-intake/tests/schemas.test.ts"),
    Path("packages/problem-intake/tests/plans.test.ts"),
    Path("mcp-server/src/visual-workspace/operations.test.ts"),
    Path("mcp-server/src/problem-intake/obc-runner.test.ts"),
    Path("mcp-server/src/contributions/service.test.ts"),
    Path("mcp-server/src/contributions/receipts.test.ts"),
    Path("obsidian-plugin/tests/ask-mate-interaction.test.ts"),
)
ASK_MATE_RELEASE_SUPPORT = (
    Path("scripts/verify_plugin_upgrade_rollback.py"),
    Path("tests/test_verify_plugin_upgrade_rollback.py"),
    Path(".github/workflows/release.yml"),
)
ASK_MATE_DOC_TOKENS = (
    "Experimental enablement and rollback",
    "Migration and Doctor",
    "Canvas supported subset",
    "Privacy, redaction, and remote approval",
    "Accessibility and mobile acceptance",
    "Clean-vault acceptance",
    "GPL-3.0-only and transitive dependency audit",
)


def _logical(path: Path, repo: Path) -> str:
    return path.relative_to(repo).as_posix()


def _is_text_path(path: Path | PurePosixPath) -> bool:
    name = path.name.lower()
    return name.endswith(".d.ts") or path.suffix.lower() in TEXT_SUFFIXES


def _is_ignored(path: Path, repo: Path) -> bool:
    try:
        parts = path.relative_to(repo).parts
    except ValueError:
        parts = path.parts
    return any(part in IGNORED_PARTS for part in parts)


def _iter_text_files(root: Path, repo: Path) -> Iterator[Path]:
    if not root.exists():
        return
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        if path.is_file() and not _is_ignored(path, repo) and _is_text_path(path):
            yield path


def production_source_files(repo: Path) -> list[Path]:
    roots = [repo / "compiler", repo / "mcp-server" / "src", repo / "obsidian-plugin" / "src"]
    packages_root = repo / "packages"
    if packages_root.is_dir():
        roots.extend(path / "src" for path in sorted(packages_root.iterdir()) if path.is_dir())
    files: list[Path] = []
    for root in roots:
        for path in _iter_text_files(root, repo):
            lower_parts = tuple(part.lower() for part in path.parts)
            if "tests" in lower_parts or "test" in lower_parts:
                continue
            if ".test." in path.name.lower() or ".spec." in path.name.lower():
                continue
            if path.name.lower().startswith("test-fixture"):
                continue
            files.append(path)
    return sorted(set(files), key=lambda item: _logical(item, repo))


def fixture_files(repo: Path) -> list[Path]:
    roots = [
        repo / "tests",
        repo / "compiler",
        repo / "mcp-server",
        repo / "obsidian-plugin",
        repo / "packages",
    ]
    files: list[Path] = []
    for root in roots:
        for path in _iter_text_files(root, repo):
            relative_parts = tuple(part.lower() for part in path.relative_to(repo).parts)
            if "fixtures" in relative_parts:
                files.append(path)
    return sorted(set(files), key=lambda item: _logical(item, repo))


def test_source_files(repo: Path) -> list[Path]:
    """Return test code omitted from production scans for provenance-only review."""
    roots = [
        repo / "tests",
        repo / "compiler",
        repo / "mcp-server",
        repo / "obsidian-plugin",
        repo / "packages",
    ]
    files: list[Path] = []
    for root in roots:
        for path in _iter_text_files(root, repo):
            if _logical(path, repo) in PROVENANCE_POLICY_TEST_FILES:
                continue
            relative_parts = tuple(part.lower() for part in path.relative_to(repo).parts)
            test_named = (
                "tests" in relative_parts
                or "test" in relative_parts
                or ".test." in path.name.lower()
                or ".spec." in path.name.lower()
                or path.name.lower().startswith("test-")
            )
            if test_named and "fixtures" not in relative_parts:
                files.append(path)
    return sorted(set(files), key=lambda item: _logical(item, repo))


def release_evidence_files(repo: Path) -> list[Path]:
    return list(_iter_text_files(repo / "docs" / "release-evidence", repo))


def generated_files(repo: Path) -> list[Path]:
    missing = [path.as_posix() for path in REQUIRED_GENERATED_FILES if not (repo / path).is_file()]
    if missing:
        raise FileNotFoundError("missing generated release file(s): " + ", ".join(missing))
    return [repo / path for path in REQUIRED_GENERATED_FILES]


def _finding(rule: str, scope: str, path: str, line: int, matched: str) -> dict[str, Any]:
    return {
        "rule": rule,
        "scope": scope,
        "path": path,
        "line": line,
        "matchSha256": hashlib.sha256(matched.encode("utf-8")).hexdigest()[:16],
    }


def scan_text(text: str, *, logical_path: str, scope: str) -> list[dict[str, Any]]:
    """Scan text without returning the sensitive bytes in diagnostics."""
    findings: list[dict[str, Any]] = []
    fixture_scope = scope == "fixture"
    suffix = PurePosixPath(logical_path.split("!", 1)[-1]).suffix.lower()
    for line_number, line in enumerate(text.splitlines(), start=1):
        for rule, pattern in LEAK_PATTERNS:
            for match in pattern.finditer(line):
                match_digest = hashlib.sha256(match.group(0).encode("utf-8")).hexdigest()[:16]
                fixture_exception = fixture_scope and (
                    FIXTURE_ALLOW_MARKER in line
                    or "LLMWIKI_TEST_FAKE_" in line
                    or match_digest in FIXTURE_FAKE_MATCH_ALLOWLIST.get(logical_path, frozenset())
                )
                if fixture_exception:
                    continue
                findings.append(_finding(rule, scope, logical_path, line_number, match.group(0)))
        if suffix not in DOCUMENT_SUFFIXES:
            for match in PROHIBITED_PROVENANCE.finditer(line):
                findings.append(
                    _finding("prohibited-exxeta-provenance", scope, logical_path, line_number, match.group(0))
                )
    return findings


def scan_files(files: Iterable[Path], *, repo: Path, scope: str) -> tuple[list[dict[str, Any]], int]:
    findings: list[dict[str, Any]] = []
    count = 0
    for path in files:
        count += 1
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            findings.append(_finding("non-utf8-release-text", scope, _logical(path, repo), 0, path.name))
            continue
        findings.extend(scan_text(text, logical_path=_logical(path, repo), scope=scope))
        if path.suffix.lower() not in DOCUMENT_SUFFIXES and PROHIBITED_PROVENANCE.search(path.name):
            findings.append(
                _finding("prohibited-exxeta-asset", scope, _logical(path, repo), 0, path.name)
            )
    return findings, count


def scan_test_provenance(files: Iterable[Path], *, repo: Path) -> tuple[list[dict[str, Any]], int]:
    """Reject copied EXXETA/Exxperts test assets without treating test credentials as release payloads."""
    findings: list[dict[str, Any]] = []
    count = 0
    for path in files:
        count += 1
        logical_path = _logical(path, repo)
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            findings.append(_finding("non-utf8-test-source", "test-provenance", logical_path, 0, path.name))
            continue
        if PROHIBITED_PROVENANCE.search(path.name):
            findings.append(
                _finding("prohibited-exxeta-asset", "test-provenance", logical_path, 0, path.name)
            )
        for line_number, line in enumerate(text.splitlines(), start=1):
            if FIXTURE_ALLOW_MARKER in line:
                continue
            for match in PROHIBITED_PROVENANCE.finditer(line):
                findings.append(
                    _finding(
                        "prohibited-exxeta-provenance",
                        "test-provenance",
                        logical_path,
                        line_number,
                        match.group(0),
                    )
                )
    return findings, count


def _archive_entries(repo: Path) -> dict[str, list[tuple[str, Path]]]:
    mcp_root = repo / "mcp-server"
    mcp_files = [
        ("bundle.js", mcp_root / "bundle.js"),
        ("agent-domain-cli.js", mcp_root / "agent-domain-cli.js"),
        ("memu-query.js", mcp_root / "memu-query.js"),
        ("usage-cli.js", mcp_root / "usage-cli.js"),
        ("package.json", mcp_root / "package.json"),
        ("LICENSE", repo / "LICENSE"),
    ]

    compiler_files = [
        path
        for path in sorted((repo / "compiler").rglob("*"), key=lambda item: item.as_posix())
        if path.is_file()
        and not _is_ignored(path, repo)
        and "tests" not in tuple(part.lower() for part in path.relative_to(repo / "compiler").parts)
    ]
    plugin_files = [
        repo / "obsidian-plugin" / "main.js",
        repo / "obsidian-plugin" / "manifest.json",
        repo / "obsidian-plugin" / "styles.css",
    ]
    entries = {
        "obsidian-llm-wiki-mcp.tar.gz": mcp_files,
        "obsidian-llm-wiki-compiler.tar.gz": [
            (_logical(path, repo), path) for path in compiler_files
        ] + [("LICENSE", repo / "LICENSE")],
        "obsidian-llm-wiki-plugin.tar.gz": [
            (_logical(path, repo / "obsidian-plugin"), path) for path in plugin_files
        ] + [("LICENSE", repo / "LICENSE")],
    }
    missing = sorted(
        f"{archive}:{name}"
        for archive, items in entries.items()
        for name, path in items
        if not path.is_file()
    )
    if missing:
        raise FileNotFoundError("missing release archive input(s): " + ", ".join(missing))
    return {
        archive: sorted(set(items), key=lambda item: item[0])
        for archive, items in sorted(entries.items())
    }


def _deterministic_tar(entries: list[tuple[str, Path]]) -> bytes:
    output = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=output, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.GNU_FORMAT) as archive:
            for name, path in entries:
                data = path.read_bytes()
                info = tarfile.TarInfo(name=name)
                info.size = len(data)
                info.mtime = 0
                info.uid = 0
                info.gid = 0
                info.uname = "root"
                info.gname = "root"
                info.mode = 0o755 if path.name in {
                    "bundle.js",
                    "agent-domain-cli.js",
                    "memu-query.js",
                    "usage-cli.js",
                } else 0o644
                archive.addfile(info, io.BytesIO(data))
    return output.getvalue()


def scan_release_archives(repo: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    report: dict[str, Any] = {}
    for archive_name, entries in _archive_entries(repo).items():
        payload = _deterministic_tar(entries)
        member_count = 0
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as archive:
            for member in archive.getmembers():
                if not member.isfile():
                    continue
                member_count += 1
                pure_name = PurePosixPath(member.name)
                if pure_name.is_absolute() or ".." in pure_name.parts:
                    findings.append(
                        _finding("unsafe-archive-member", "release-archive", f"{archive_name}!{member.name}", 0, member.name)
                    )
                    continue
                if not _is_text_path(pure_name):
                    continue
                extracted = archive.extractfile(member)
                assert extracted is not None
                try:
                    text = extracted.read().decode("utf-8")
                except UnicodeDecodeError:
                    findings.append(
                        _finding("non-utf8-release-text", "release-archive", f"{archive_name}!{member.name}", 0, member.name)
                    )
                    continue
                findings.extend(
                    scan_text(
                        text,
                        logical_path=f"{archive_name}!{member.name}",
                        scope="release-archive",
                    )
                )
                if pure_name.suffix.lower() not in DOCUMENT_SUFFIXES and PROHIBITED_PROVENANCE.search(member.name):
                    findings.append(
                        _finding("prohibited-exxeta-asset", "release-archive", f"{archive_name}!{member.name}", 0, member.name)
                    )
        report[archive_name] = {
            "fileCount": member_count,
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
    return findings, report


def _dependency_name(lock_path: str) -> str:
    return lock_path.rsplit("node_modules/", 1)[-1]


def _ask_mate_release_applicable(repo: Path) -> bool:
    return any((repo / package_path.parent).exists() for package_path, _ in ASK_MATE_NODE_COMPONENTS)


def _node_components(repo: Path) -> tuple[tuple[Path, Path], ...]:
    if _ask_mate_release_applicable(repo):
        return CORE_NODE_COMPONENTS + ASK_MATE_NODE_COMPONENTS
    return CORE_NODE_COMPONENTS


def _load_json_object(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("expected a JSON object")
    return value


def _review_node_component_metadata(
    repo: Path,
    package_path: Path,
    lock_path: Path,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, list[dict[str, Any]]]:
    findings: list[dict[str, Any]] = []
    package_file = repo / package_path
    lock_file = repo / lock_path
    if not package_file.is_file():
        findings.append(
            _finding("missing-package-metadata", "runtime-license", package_path.as_posix(), 0, package_path.as_posix())
        )
        return None, None, findings
    if not lock_file.is_file():
        findings.append(
            _finding("missing-lockfile", "runtime-license", lock_path.as_posix(), 0, lock_path.as_posix())
        )
        return None, None, findings
    try:
        package = _load_json_object(package_file)
    except (json.JSONDecodeError, ValueError) as error:
        findings.append(
            _finding("invalid-package-metadata", "runtime-license", package_path.as_posix(), 0, str(error))
        )
        return None, None, findings
    try:
        lock = _load_json_object(lock_file)
    except (json.JSONDecodeError, ValueError) as error:
        findings.append(
            _finding("invalid-lockfile", "runtime-license", lock_path.as_posix(), 0, str(error))
        )
        return package, None, findings

    packages = lock.get("packages")
    root = packages.get("") if isinstance(packages, dict) else None
    if lock.get("lockfileVersion") != 3 or not isinstance(root, dict):
        findings.append(
            _finding("invalid-lockfile", "runtime-license", lock_path.as_posix(), 0, "lockfileVersion/packages")
        )
        return package, lock, findings

    for field in ("name", "version", "license"):
        expected = package.get(field)
        actual = root.get(field)
        if not isinstance(expected, str) or not expected or actual != expected:
            findings.append(
                _finding(
                    "package-lock-metadata-mismatch",
                    "runtime-license",
                    f"{lock_path.as_posix()}#{field}",
                    0,
                    f"{expected!r}!={actual!r}",
                )
            )
    for field in ("dependencies", "optionalDependencies", "devDependencies"):
        expected = package.get(field, {})
        actual = root.get(field, {})
        valid = (
            isinstance(expected, dict)
            and isinstance(actual, dict)
            and all(isinstance(name, str) and isinstance(version, str) for name, version in expected.items())
            and all(isinstance(name, str) and isinstance(version, str) for name, version in actual.items())
        )
        if not valid or actual != expected:
            findings.append(
                _finding(
                    "package-lock-metadata-mismatch",
                    "runtime-license",
                    f"{lock_path.as_posix()}#{field}",
                    0,
                    field,
                )
            )
    return package, lock, findings


def _python_project_metadata(path: Path) -> tuple[str, str | None, list[str]]:
    """Read the small PEP 621 surface we need without environment dependencies."""
    text = path.read_text(encoding="utf-8")
    project_match = re.search(r"(?ms)^\[project\]\s*(.*?)(?=^\[|\Z)", text)
    if project_match is None:
        raise ValueError("missing [project] table")
    project = project_match.group(1)
    name_match = re.search(r'(?m)^name\s*=\s*[\"\']([^\"\']+)[\"\']\s*$', project)
    license_match = re.search(r'(?m)^license\s*=\s*[\"\']([^\"\']+)[\"\']\s*$', project)
    dependencies_match = re.search(r"(?ms)^dependencies\s*=\s*(\[.*?\])\s*$", project)
    dependencies: list[str] = []
    if dependencies_match is not None:
        parsed = ast.literal_eval(dependencies_match.group(1))
        if not isinstance(parsed, list) or any(not isinstance(item, str) for item in parsed):
            raise ValueError("project.dependencies must be a string list")
        dependencies = parsed
    return (
        name_match.group(1) if name_match else path.parent.name,
        license_match.group(1) if license_match else None,
        dependencies,
    )


def _python_requirement_name(requirement: str) -> str | None:
    match = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9_.-]*)", requirement)
    if match is None:
        return None
    return re.sub(r"[-_.]+", "-", match.group(1)).lower()


def review_runtime_licenses(repo: Path) -> dict[str, Any]:
    dependencies: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []
    components: list[dict[str, str]] = []
    for relative_package, relative_lock in _node_components(repo):
        package, lock, metadata_findings = _review_node_component_metadata(
            repo,
            relative_package,
            relative_lock,
        )
        findings.extend(metadata_findings)
        if package is None or lock is None:
            continue
        packages = lock.get("packages")
        if not isinstance(packages, dict):
            findings.append(
                _finding("invalid-lockfile", "runtime-license", relative_lock.as_posix(), 0, "packages")
            )
            continue
        component_license = package.get("license")
        component_name = package.get("name") or relative_lock.parent.as_posix()
        if not isinstance(component_license, str) or component_license not in GPL3_COMPATIBLE_LICENSES:
            findings.append(
                _finding(
                    "unknown-or-incompatible-component-license",
                    "runtime-license",
                    relative_lock.as_posix(),
                    0,
                    str(component_license),
                )
            )
        components.append({"name": str(component_name), "license": str(component_license)})

        for package_path, metadata in sorted(packages.items()):
            if not package_path or not isinstance(metadata, dict) or metadata.get("dev") is True:
                continue
            name = _dependency_name(package_path)
            license_expression = metadata.get("license")
            item = {
                "component": relative_lock.parent.as_posix(),
                "name": name,
                "version": str(metadata.get("version", "unknown")),
                "license": str(license_expression) if license_expression is not None else "unknown",
                "optional": bool(metadata.get("optional", False)),
            }
            dependencies.append(item)
            provenance = " ".join(
                str(value)
                for value in (name, metadata.get("resolved", ""))
            )
            if PROHIBITED_PROVENANCE.search(provenance):
                findings.append(
                    _finding(
                        "prohibited-exxeta-dependency",
                        "runtime-license",
                        f"{relative_lock.as_posix()}#{name}",
                        0,
                        provenance,
                    )
                )
            if not isinstance(license_expression, str) or license_expression not in GPL3_COMPATIBLE_LICENSES:
                findings.append(
                    _finding(
                        "unknown-or-incompatible-runtime-license",
                        "runtime-license",
                        f"{relative_lock.as_posix()}#{name}",
                        0,
                        str(license_expression),
                    )
                )

    for relative_pyproject in PYTHON_COMPONENTS:
        pyproject = repo / relative_pyproject
        if not pyproject.is_file():
            findings.append(
                _finding("missing-python-project", "runtime-license", relative_pyproject.as_posix(), 0, relative_pyproject.as_posix())
            )
            continue
        try:
            component_name, component_license, requirements = _python_project_metadata(pyproject)
        except (SyntaxError, ValueError) as error:
            findings.append(
                _finding("invalid-python-project", "runtime-license", relative_pyproject.as_posix(), 0, str(error))
            )
            continue
        if component_license not in GPL3_COMPATIBLE_LICENSES:
            findings.append(
                _finding(
                    "unknown-or-incompatible-component-license",
                    "runtime-license",
                    relative_pyproject.as_posix(),
                    0,
                    str(component_license),
                )
            )
        components.append({"name": component_name, "license": str(component_license)})
        for requirement in sorted(requirements):
            name = _python_requirement_name(requirement)
            license_expression = PYTHON_RUNTIME_LICENSES.get(name or "")
            logical_dependency = f"{relative_pyproject.as_posix()}#{name or 'invalid-requirement'}"
            item = {
                "component": relative_pyproject.parent.as_posix(),
                "name": name or "invalid-requirement",
                "version": requirement[len(name or ""):].strip() or "declared",
                "license": license_expression or "unknown",
                "optional": False,
            }
            dependencies.append(item)
            if PROHIBITED_PROVENANCE.search(requirement):
                findings.append(
                    _finding(
                        "prohibited-exxeta-dependency",
                        "runtime-license",
                        logical_dependency,
                        0,
                        requirement,
                    )
                )
            if license_expression not in GPL3_COMPATIBLE_LICENSES:
                findings.append(
                    _finding(
                        "unknown-or-incompatible-runtime-license",
                        "runtime-license",
                        logical_dependency,
                        0,
                        str(license_expression),
                    )
                )

    dependencies.sort(key=lambda item: (item["component"], item["name"], item["version"]))
    components.sort(key=lambda item: item["name"])
    histogram = Counter(item["license"] for item in dependencies)
    return {
        "ok": not findings,
        "policy": "explicit GPL-3.0-only-compatible SPDX allowlist; unknown expressions fail",
        "components": components,
        "dependencyCount": len(dependencies),
        "licenseHistogram": dict(sorted(histogram.items())),
        "dependencies": dependencies,
        "findings": sorted_findings(findings),
    }


def _require_static_tokens(
    repo: Path,
    path: Path,
    tokens: Iterable[str],
    *,
    scope: str,
) -> tuple[list[dict[str, Any]], int]:
    file = repo / path
    if not file.is_file():
        return [
            _finding("missing-ask-mate-release-input", scope, path.as_posix(), 0, path.as_posix())
        ], 0
    try:
        text = file.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return [
            _finding("non-utf8-release-text", scope, path.as_posix(), 0, path.name)
        ], 1
    findings = [
        _finding("missing-ask-mate-contract-token", scope, path.as_posix(), 0, token)
        for token in tokens
        if token not in text
    ]
    return findings, 1


def review_ask_mate_release(repo: Path) -> dict[str, Any]:
    """Statically prove the experimental Ask Mate release surface is complete.

    This gate is deliberately offline. It proves that reviewed schemas, source
    operations, generated bundles, test sources, lifecycle support, and the
    operator contract travel together. It does not publish or contact a forge.
    """
    applicable = _ask_mate_release_applicable(repo)
    if not applicable:
        return {
            "applicable": False,
            "ok": True,
            "policy": "inactive until either first-party Ask Mate domain package is present",
            "counts": {},
            "findings": [],
        }

    findings: list[dict[str, Any]] = []
    counts = {
        "schemas": 0,
        "sourceContracts": 0,
        "generatedContracts": 0,
        "buildOutputs": 0,
        "testEvidence": 0,
        "releaseSupport": 0,
        "documentation": 0,
    }

    for relative_schema in ASK_MATE_SCHEMAS:
        schema_path = repo / relative_schema
        if not schema_path.is_file():
            findings.append(
                _finding(
                    "missing-ask-mate-release-input",
                    "ask-mate-schema",
                    relative_schema.as_posix(),
                    0,
                    relative_schema.as_posix(),
                )
            )
            continue
        counts["schemas"] += 1
        try:
            schema = _load_json_object(schema_path)
        except (json.JSONDecodeError, ValueError) as error:
            findings.append(
                _finding(
                    "invalid-ask-mate-schema",
                    "ask-mate-schema",
                    relative_schema.as_posix(),
                    0,
                    str(error),
                )
            )
            continue
        expected_prefix = (
            "https://schemas.llmwiki.org/visual-workspace/v1/"
            if "visual-workspace" in relative_schema.parts
            else "https://schemas.llmwiki.org/problem-intake/v1/"
        )
        schema_id = schema.get("$id")
        properties = schema.get("properties")
        schema_version = properties.get("schemaVersion") if isinstance(properties, dict) else None
        version_contract_valid = (
            schema_version is None
            or (isinstance(schema_version, dict) and schema_version.get("const") == 1)
        )
        if (
            schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema"
            or not isinstance(schema_id, str)
            or not schema_id.startswith(expected_prefix)
            or schema.get("additionalProperties") is not False
            or not version_contract_valid
        ):
            findings.append(
                _finding(
                    "invalid-ask-mate-schema-contract",
                    "ask-mate-schema",
                    relative_schema.as_posix(),
                    0,
                    str(schema_id),
                )
            )

    for path, tokens in ASK_MATE_SOURCE_CONTRACTS.items():
        token_findings, present = _require_static_tokens(
            repo, path, tokens, scope="ask-mate-source-contract",
        )
        findings.extend(token_findings)
        counts["sourceContracts"] += present

    for path, tokens in ASK_MATE_GENERATED_CONTRACTS.items():
        token_findings, present = _require_static_tokens(
            repo, path, tokens, scope="ask-mate-generated-contract",
        )
        findings.extend(token_findings)
        counts["generatedContracts"] += present

    for path in ASK_MATE_BUILD_OUTPUTS:
        build_findings, present = _require_static_tokens(
            repo, path, (), scope="ask-mate-build-output",
        )
        findings.extend(build_findings)
        counts["buildOutputs"] += present

    for path in ASK_MATE_TEST_EVIDENCE:
        test_findings, present = _require_static_tokens(
            repo, path, ("test(",), scope="ask-mate-test-evidence",
        )
        findings.extend(test_findings)
        counts["testEvidence"] += present

    for path in ASK_MATE_RELEASE_SUPPORT:
        support_findings, present = _require_static_tokens(
            repo, path, (), scope="ask-mate-release-support",
        )
        findings.extend(support_findings)
        counts["releaseSupport"] += present

    doc_path = Path("docs/ASK_MATE_VISUAL_WORKSPACE.md")
    doc_findings, present = _require_static_tokens(
        repo,
        doc_path,
        ASK_MATE_DOC_TOKENS,
        scope="ask-mate-documentation",
    )
    findings.extend(doc_findings)
    counts["documentation"] += present

    findings = sorted_findings(findings)
    return {
        "applicable": True,
        "ok": not findings,
        "policy": (
            "offline static release closure: strict v1 schemas, source and generated operation parity, "
            "built domain outputs, test evidence, lifecycle support, and reviewed operator documentation"
        ),
        "counts": counts,
        "findings": findings,
    }


def sorted_findings(findings: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        findings,
        key=lambda item: (
            item["scope"],
            item["path"],
            item["line"],
            item["rule"],
            item["matchSha256"],
        ),
    )


def verify(repo: Path) -> dict[str, Any]:
    repo = repo.resolve()
    findings: list[dict[str, Any]] = []
    scan_counts: dict[str, int] = {}

    source_findings, scan_counts["sourceFiles"] = scan_files(
        production_source_files(repo), repo=repo, scope="source"
    )
    findings.extend(source_findings)
    fixture_findings, scan_counts["fixtureFiles"] = scan_files(
        fixture_files(repo), repo=repo, scope="fixture"
    )
    findings.extend(fixture_findings)
    test_provenance_findings, scan_counts["testSourceFiles"] = scan_test_provenance(
        test_source_files(repo), repo=repo
    )
    findings.extend(test_provenance_findings)
    evidence_findings, scan_counts["releaseEvidenceFiles"] = scan_files(
        release_evidence_files(repo), repo=repo, scope="release-evidence"
    )
    findings.extend(evidence_findings)

    try:
        generated_findings, scan_counts["generatedFiles"] = scan_files(
            generated_files(repo), repo=repo, scope="generated"
        )
        findings.extend(generated_findings)
    except FileNotFoundError as error:
        findings.append(_finding("missing-generated-artifact", "generated", "generated-release-inputs", 0, str(error)))
        scan_counts["generatedFiles"] = 0

    archives: dict[str, Any] = {}
    try:
        archive_findings, archives = scan_release_archives(repo)
        findings.extend(archive_findings)
    except FileNotFoundError as error:
        findings.append(_finding("missing-release-artifact-input", "release-archive", "release-inputs", 0, str(error)))

    license_report = review_runtime_licenses(repo)
    findings.extend(license_report["findings"])
    ask_mate_report = review_ask_mate_release(repo)
    findings.extend(ask_mate_report["findings"])
    findings = sorted_findings(findings)
    return {
        "policyVersion": POLICY_VERSION,
        "ok": not findings,
        "scans": scan_counts,
        "releaseArtifacts": archives,
        "runtimeLicenses": {
            key: value for key, value in license_report.items() if key != "findings"
        },
        "askMateVisualWorkspace": {
            key: value for key, value in ask_mate_report.items() if key != "findings"
        },
        "findings": findings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Offline release leak, provenance, and runtime-license verification."
    )
    parser.add_argument("--repo", default=str(ROOT), help="Repository checkout to verify")
    parser.add_argument("--json", action="store_true", help="Emit deterministic JSON")
    args = parser.parse_args()
    report = verify(Path(args.repo))
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print(f"Release security verify: {'ok' if report['ok'] else 'failed'}")
        print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
