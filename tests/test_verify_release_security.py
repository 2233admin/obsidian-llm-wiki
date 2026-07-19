from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "verify_release_security.py"
SPEC = importlib.util.spec_from_file_location("verify_release_security", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
verify_release_security = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verify_release_security)


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _lock(name: str, license_expression: str = "MIT") -> dict:
    return {
        "name": name,
        "version": "1.0.0",
        "lockfileVersion": 3,
        "packages": {
            "": {"name": name, "version": "1.0.0", "license": license_expression},
        },
    }


def _minimal_repo(root: Path) -> Path:
    _write(root / "compiler" / "runtime.py", "VALUE = 'clean'\n")
    _write(root / "LICENSE", "GNU GENERAL PUBLIC LICENSE Version 3\n")
    _write(
        root / "compiler" / "pyproject.toml",
        "[project]\n"
        'name = "llmwiki-compiler"\n'
        'license = "GPL-3.0-only"\n'
        'dependencies = ["orjson>=3.9"]\n',
    )
    _write(root / "mcp-server" / "src" / "runtime.ts", "export const clean = true;\n")
    _write(root / "obsidian-plugin" / "src" / "runtime.ts", "export const clean = true;\n")
    _write(root / "packages" / "agent-domain" / "src" / "index.ts", "export {};\n")
    _write(root / "packages" / "settings-platform" / "src" / "index.ts", "export {};\n")
    _write(root / "mcp-server" / "bundle.js", "#!/usr/bin/env node\nconsole.log('clean');\n")
    _write(root / "mcp-server" / "agent-domain-cli.js", "#!/usr/bin/env node\nconsole.log('clean');\n")
    _write(root / "mcp-server" / "memu-query.js", "#!/usr/bin/env node\nconsole.log('clean');\n")
    _write(root / "mcp-server" / "usage-cli.js", "#!/usr/bin/env node\nconsole.log('clean');\n")
    package_metadata = {
        "mcp-server": {
            "name": "@llmwiki/mcp",
            "version": "1.0.0",
            "license": "GPL-3.0-only",
        },
        "obsidian-plugin": {
            "name": "llmwiki-plugin",
            "version": "1.0.0",
            "license": "GPL-3.0-only",
        },
        "packages/agent-domain": {
            "name": "@llmwiki/agent-domain",
            "version": "1.0.0",
            "license": "GPL-3.0-only",
        },
        "packages/settings-platform": {
            "name": "@llmwiki/settings-platform",
            "version": "1.0.0",
            "license": "MIT",
        },
    }
    for parent, metadata in package_metadata.items():
        _write(root / parent / "package.json", json.dumps(metadata))
    _write(root / "obsidian-plugin" / "main.js", "console.log('clean');\n")
    _write(root / "obsidian-plugin" / "manifest.json", json.dumps({"id": "llmwiki"}))
    _write(root / "obsidian-plugin" / "styles.css", ".clean {}\n")

    locks = {
        "mcp-server": _lock("@llmwiki/mcp", "GPL-3.0-only"),
        "obsidian-plugin": _lock("llmwiki-plugin", "GPL-3.0-only"),
        "packages/agent-domain": _lock("@llmwiki/agent-domain", "GPL-3.0-only"),
        "packages/settings-platform": _lock("@llmwiki/settings-platform"),
    }
    locks["mcp-server"]["packages"]["node_modules/clean-runtime"] = {
        "version": "2.0.0",
        "license": "Apache-2.0",
        "resolved": "https://registry.npmjs.org/clean-runtime/-/clean-runtime-2.0.0.tgz",
    }
    for parent, lock in locks.items():
        _write(root / parent / "package-lock.json", json.dumps(lock))
    return root


def _activate_ask_mate_release(root: Path) -> Path:
    components = {
        "packages/visual-workspace": "@obsidian-llm-wiki/visual-workspace",
        "packages/problem-intake": "@obsidian-llm-wiki/problem-intake",
    }
    for parent, name in components.items():
        _write(
            root / parent / "package.json",
            json.dumps({"name": name, "version": "1.0.0", "license": "GPL-3.0-only"}),
        )
        _write(
            root / parent / "package-lock.json",
            json.dumps(_lock(name, "GPL-3.0-only")),
        )

    for relative_schema in verify_release_security.ASK_MATE_SCHEMAS:
        family = "visual-workspace" if "visual-workspace" in relative_schema.parts else "problem-intake"
        _write(
            root / relative_schema,
            json.dumps(
                {
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "$id": f"https://schemas.llmwiki.org/{family}/v1/{relative_schema.name}",
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {"schemaVersion": {"const": 1}},
                }
            ),
        )

    for path, tokens in verify_release_security.ASK_MATE_SOURCE_CONTRACTS.items():
        _write(root / path, "\n".join(tokens) + "\n")
    for path, tokens in verify_release_security.ASK_MATE_GENERATED_CONTRACTS.items():
        _write(root / path, "\n".join(tokens) + "\n")
    for path in verify_release_security.ASK_MATE_BUILD_OUTPUTS:
        _write(root / path, "export {};\n")
    for path in verify_release_security.ASK_MATE_TEST_EVIDENCE:
        _write(root / path, "test('release evidence', () => {});\n")
    for path in verify_release_security.ASK_MATE_RELEASE_SUPPORT:
        _write(root / path, "offline release support\n")
    _write(
        root / "docs" / "ASK_MATE_VISUAL_WORKSPACE.md",
        "\n".join(verify_release_security.ASK_MATE_DOC_TOKENS) + "\n",
    )
    return root


@pytest.mark.parametrize(
    ("rule", "text"),
    [
        ("private-key", "-----BEGIN OPENSSH PRIVATE KEY-----"),
        ("bearer-credential", "Authorization: Bearer actualcredentialvalue123"),
        ("credential-prefix", "github_pat_abcdefghijklmnopqrstuvwxyz123456"),
        ("url-credential", "postgresql://operator:plaintext@localhost:5432/db"),
        ("embedded-user-password", "default postgres:plaintext@localhost is forbidden"),
        ("sensitive-literal", 'handoff_token: "raw-handoff-capability"'),
        ("fleet-prompt-sentinel", "PROMPT_BODY_SENTINEL_DO_NOT_SHIP"),
        ("legacy-personal-default", "user_id = 'boris'"),
        ("machine-absolute-path", "C:/Users/operator/private/vault"),
        ("machine-absolute-path", r"C:\Users\operator\private\vault"),
    ],
)
def test_each_release_leak_rule_fails_without_echoing_the_match(rule: str, text: str) -> None:
    findings = verify_release_security.scan_text(
        text,
        logical_path="mcp-server/bundle.js",
        scope="generated",
    )

    assert any(item["rule"] == rule for item in findings)
    assert all(text not in json.dumps(item) for item in findings)


def test_explicit_test_fake_marker_is_fixture_only() -> None:
    line = "Bearer actualcredentialvalue123 # release-security: allow-test-fixture"

    assert verify_release_security.scan_text(
        line,
        logical_path="tests/fixtures/fake.txt",
        scope="fixture",
    ) == []
    assert verify_release_security.scan_text(
        line,
        logical_path="mcp-server/src/runtime.ts",
        scope="source",
    )


def test_machine_path_rule_does_not_misread_minified_javascript_regex() -> None:
    minified = r'o:/\s/.test(o)?r&&(e.push(r),r=""):r+=o'

    assert verify_release_security.scan_text(
        minified,
        logical_path="obsidian-plugin/main.js",
        scope="generated",
    ) == []


@pytest.mark.parametrize(
    "text",
    [
        '{"handoff_token":"raw-handoff-capability"}',
        '{"leaseToken":"raw-lease-capability"}',
        '{"promptBody":"internal prompt content"}',
    ],
)
def test_sensitive_literal_rejects_quoted_json_and_camel_case_keys(text: str) -> None:
    findings = verify_release_security.scan_text(
        text,
        logical_path="tests/fixtures/unsafe.json",
        scope="fixture",
    )

    assert {item["rule"] for item in findings} == {"sensitive-literal"}


def test_exxeta_research_link_is_allowed_only_in_documentation() -> None:
    research = "Research: https://github.com/EXXETA/exxperts"  # release-security: allow-test-fixture

    assert verify_release_security.scan_text(
        research,
        logical_path="docs/research.md",
        scope="release-archive",
    ) == []
    findings = verify_release_security.scan_text(
        research,
        logical_path="mcp-server/src/import.ts",
        scope="source",
    )
    assert {item["rule"] for item in findings} == {"prohibited-exxeta-provenance"}


def test_runtime_license_review_is_offline_allowlist_and_fail_closed(tmp_path: Path) -> None:
    repo = _minimal_repo(tmp_path)
    approved = verify_release_security.review_runtime_licenses(repo)
    assert approved["ok"] is True
    assert approved["licenseHistogram"] == {
        "Apache-2.0": 1,
        "Apache-2.0 OR MIT": 1,
    }

    lock_path = repo / "mcp-server" / "package-lock.json"
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    lock["packages"]["node_modules/clean-runtime"]["license"] = "SEE LICENSE IN LICENSE.txt"
    lock_path.write_text(json.dumps(lock), encoding="utf-8")

    rejected = verify_release_security.review_runtime_licenses(repo)
    assert rejected["ok"] is False
    assert any(
        item["rule"] == "unknown-or-incompatible-runtime-license"
        for item in rejected["findings"]
    )


def test_ask_mate_packages_require_matching_package_and_lock_metadata(tmp_path: Path) -> None:
    repo = _activate_ask_mate_release(_minimal_repo(tmp_path))
    approved = verify_release_security.review_runtime_licenses(repo)
    assert approved["ok"] is True
    assert {
        item["name"] for item in approved["components"]
    } >= {
        "@obsidian-llm-wiki/visual-workspace",
        "@obsidian-llm-wiki/problem-intake",
    }

    lock_path = repo / "packages" / "problem-intake" / "package-lock.json"
    lock_path.unlink()
    missing = verify_release_security.review_runtime_licenses(repo)
    assert any(
        item["rule"] == "missing-lockfile"
        and item["path"] == "packages/problem-intake/package-lock.json"
        for item in missing["findings"]
    )

    _write(
        lock_path,
        json.dumps(_lock("@obsidian-llm-wiki/problem-intake", "GPL-3.0-only")),
    )
    package_path = repo / "packages" / "problem-intake" / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    package["version"] = "0.2.0"
    package_path.write_text(json.dumps(package), encoding="utf-8")
    mismatched = verify_release_security.review_runtime_licenses(repo)
    assert any(
        item["rule"] == "package-lock-metadata-mismatch"
        and item["path"].endswith("#version")
        for item in mismatched["findings"]
    )


def test_ask_mate_release_gate_is_offline_deterministic_and_bundle_closed(tmp_path: Path) -> None:
    repo = _activate_ask_mate_release(_minimal_repo(tmp_path))
    first = verify_release_security.review_ask_mate_release(repo)
    second = verify_release_security.review_ask_mate_release(repo)

    assert first == second
    assert first["ok"] is True
    assert first["counts"] == {
        "schemas": 9,
        "sourceContracts": 6,
        "generatedContracts": 2,
        "buildOutputs": 2,
        "testEvidence": 10,
        "releaseSupport": 3,
        "documentation": 1,
    }

    bundle = repo / "mcp-server" / "bundle.js"
    bundle.write_text(
        bundle.read_text(encoding="utf-8").replace("problem.intake.contribution.apply", ""),
        encoding="utf-8",
    )
    failed = verify_release_security.review_ask_mate_release(repo)
    assert failed["ok"] is False
    assert any(
        item["rule"] == "missing-ask-mate-contract-token"
        and item["scope"] == "ask-mate-generated-contract"
        and item["path"] == "mcp-server/bundle.js"
        for item in failed["findings"]
    )


def test_exxeta_dependency_is_rejected_even_with_compatible_license(tmp_path: Path) -> None:
    repo = _minimal_repo(tmp_path)
    lock_path = repo / "mcp-server" / "package-lock.json"
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    lock["packages"]["node_modules/@exxeta/runtime"] = {  # release-security: allow-test-fixture
        "version": "1.0.0",
        "license": "MIT",
        "resolved": "https://registry.npmjs.org/@exxeta/runtime/-/runtime-1.0.0.tgz",  # release-security: allow-test-fixture
    }
    lock_path.write_text(json.dumps(lock), encoding="utf-8")

    report = verify_release_security.review_runtime_licenses(repo)
    assert report["ok"] is False
    assert any(item["rule"] == "prohibited-exxeta-dependency" for item in report["findings"])


def test_unreviewed_python_runtime_dependency_fails_closed(tmp_path: Path) -> None:
    repo = _minimal_repo(tmp_path)
    pyproject = repo / "compiler" / "pyproject.toml"
    pyproject.write_text(
        pyproject.read_text(encoding="utf-8").replace(
            'dependencies = ["orjson>=3.9"]',
            'dependencies = ["orjson>=3.9", "mystery-runtime>=1"]',
        ),
        encoding="utf-8",
    )

    report = verify_release_security.review_runtime_licenses(repo)
    assert report["ok"] is False
    assert any(
        item["rule"] == "unknown-or-incompatible-runtime-license"
        and item["path"].endswith("#mystery-runtime")
        for item in report["findings"]
    )


def test_release_archives_are_deterministic_and_scan_member_bytes(tmp_path: Path) -> None:
    repo = _minimal_repo(tmp_path)
    first_findings, first_report = verify_release_security.scan_release_archives(repo)
    second_findings, second_report = verify_release_security.scan_release_archives(repo)

    assert first_findings == []
    assert first_report == second_report
    assert sorted(first_report) == [
        "obsidian-llm-wiki-compiler.tar.gz",
        "obsidian-llm-wiki-mcp.tar.gz",
        "obsidian-llm-wiki-plugin.tar.gz",
    ]

    _write(repo / "compiler" / "runtime.py", "PROMPT_BODY_SENTINEL_RELEASE_LEAK\n")
    findings, _ = verify_release_security.scan_release_archives(repo)
    assert any(
        item["rule"] == "fleet-prompt-sentinel"
        and item["scope"] == "release-archive"
        and item["path"].endswith("!compiler/runtime.py")
        for item in findings
    )


def test_full_gate_is_deterministic_and_production_source_failures_reach_archive(tmp_path: Path) -> None:
    repo = _minimal_repo(tmp_path)
    first = verify_release_security.verify(repo)
    second = verify_release_security.verify(repo)
    assert first == second
    assert first["ok"] is True

    _write(repo / "compiler" / "runtime.py", "lease_token = 'unmarked-release-capability'\n")
    failed = verify_release_security.verify(repo)
    assert failed["ok"] is False
    scopes = {
        item["scope"]
        for item in failed["findings"]
        if item["rule"] == "sensitive-literal"
    }
    assert scopes == {"release-archive", "source"}


def test_release_workflow_runs_gate_and_excludes_test_build_trees() -> None:
    repo = MODULE_PATH.parents[1]
    ci = (repo / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    release = (repo / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")

    assert "python scripts/verify_release_security.py --json" in ci
    assert "python scripts/verify_release_security.py --json" in release
    assert "python scripts/verify_fleet_release_evidence.py" in release
    assert "verify_plugin_upgrade_rollback.py" in release
    assert "bundle.js agent-domain-cli.js package.json dist" not in release
    assert "bundle.js agent-domain-cli.js memu-query.js usage-cli.js package.json" in release
    assert release.count("LICENSE") >= 3
    assert "--exclude='compiler/tests'" in release


def test_test_source_provenance_scan_rejects_unmarked_external_code(tmp_path: Path) -> None:
    repo = _minimal_repo(tmp_path)
    test_source = repo / "mcp-server" / "src" / "copied.test.ts"
    _write(test_source, "// copied from EXXETA/exxperts\n")  # release-security: allow-test-fixture

    findings, count = verify_release_security.scan_test_provenance(
        verify_release_security.test_source_files(repo), repo=repo,
    )

    assert count >= 1
    assert {item["rule"] for item in findings} == {"prohibited-exxeta-provenance"}


def test_release_evidence_is_scanned_for_machine_paths_and_secrets(tmp_path: Path) -> None:
    repo = _minimal_repo(tmp_path)
    _write(
        repo / "docs" / "release-evidence" / "v1.0.0-beta.1.json",
        '{"handoff_token":"raw-release-capability","workspace":"C:/Users/operator/private"}\n',
    )

    report = verify_release_security.verify(repo)
    evidence_findings = [
        item for item in report["findings"] if item["scope"] == "release-evidence"
    ]

    assert {item["rule"] for item in evidence_findings} == {
        "machine-absolute-path",
        "sensitive-literal",
    }


def test_compiler_memu_user_id_prefers_environment_then_neutral_default(tmp_path: Path) -> None:
    from compiler import memu_sync

    args = memu_sync._parse_args([])
    profile, _ = memu_sync._resolve_memu_sync_profile(
        tmp_path,
        args,
        environment={"MEMU_USER_ID": "device-local-user"},
    )
    assert profile.user_id == "device-local-user"

    profile, _ = memu_sync._resolve_memu_sync_profile(
        tmp_path,
        args,
        environment={},
    )
    assert profile.user_id == "default"


def test_current_checkout_passes_release_security_gate() -> None:
    report = verify_release_security.verify(MODULE_PATH.parents[1])
    assert report["ok"] is True, report["findings"]
