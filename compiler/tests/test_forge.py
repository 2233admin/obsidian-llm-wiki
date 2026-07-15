"""Task 9 / PR 9C: SHARED FORGE ADAPTER SCAFFOLDING tests (zero-dep, unittest).

Covers compiler/forge.py. NO NETWORK: every provider call goes through a
FakeTransport with canned (method,url)->response so a live API is never hit and
no real remote repo is ever created (TASK9 §7.7).

Asserted contracts:
  * load_forge_config: reads <vault>/.vault-mind/forge.json; missing -> {}.
  * token_for: reads the provider's env var; missing -> None (graceful degrade).
  * remote_item_to_candidate: stamps origin{provider,object-id,revision,actor}
    + base-head (only when a head exists) + status:draft + maps remote state via
    a work_state-compatible word + NO supersedes.
  * pull_to_candidates: dry-run writes NOTHING; --apply writes append-only LF
    under 00-Inbox/AI-Output/sync-<provider>/; a missing token degrades to
    configured:False with no crash.
  * assert_single_bidirectional: refuses a 2nd bidirectional write path (§0 #10).
  * sync_plan: pushes the REVIEWED current-truth head, never a draft.

    PYTHONUTF8=1 python -m unittest tests.test_forge -v
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

_COMPILER = Path(__file__).resolve().parents[1]
if str(_COMPILER) not in sys.path:
    sys.path.insert(0, str(_COMPILER))

import currency  # noqa: E402
import forge  # noqa: E402
import settings_platform  # noqa: E402
import work_protocol as work_protocol  # noqa: E402
from _md_parse import parse_frontmatter  # noqa: E402

TODAY = "2026-06-25"


# --- a NETWORK-FREE transport: canned (method, url) -> response -------------

class FakeTransport(forge.Transport):
    """Records (method, url) and returns a canned response -- NEVER touches the
    network. A test seeds `responses[(method, url)] = {status, headers, body}`."""

    def __init__(self, responses=None):
        self.responses = responses or {}
        self.calls = []  # [(method, url, headers, body), ...]
        self.deadlines = []

    @contextmanager
    def operation_deadline(self, timeout_ms):
        self.deadlines.append(timeout_ms)
        yield self

    def request(self, method, url, headers=None, body=None):
        self.calls.append((method, url, dict(headers or {}), body))
        key = (method.upper(), url)
        if key in self.responses:
            return self.responses[key]
        # default: an empty 200 (a provider that issues an unseeded URL still
        # gets a well-formed response, so a test never accidentally hits urllib).
        return {"status": 200, "headers": {}, "body": b"[]"}


class FakeProvider(forge.Provider):
    """A provider that turns canned JSON from the transport into RemoteItems and
    builds a trivial push payload -- so the pull->candidate and reviewed->payload
    seams are exercised with zero network."""

    name = "gitea"

    def pull(self, repo_cfg, transport, token):
        # token must be present (pull_to_candidates only calls us when configured).
        assert token, "provider.pull called without a token"
        url = f"{repo_cfg.get('base_url', '')}/repos/{repo_cfg.get('repo', '')}/issues"
        resp = transport.request("GET", url, headers={"Authorization": "token X"})
        data = json.loads(resp["body"].decode("utf-8"))
        items = []
        for raw in data:
            items.append(forge.RemoteItem(
                kind="issue",
                object_id=str(raw.get("number")),
                revision=raw.get("updated_at"),
                actor=raw.get("user", {}).get("login"),
                title=raw.get("title", ""),
                state=raw.get("state"),
                entity_hint=raw.get("entity_hint"),
                raw=raw,
            ))
        return items

    def push_plan(self, snapshot, repo_cfg):
        return {"repo": repo_cfg.get("repo"), "state": snapshot.get("state"),
                "entity": snapshot.get("entity")}


def _write_forge_config(vault: Path, cfg: dict) -> Path:
    d = vault / ".vault-mind"
    d.mkdir(parents=True, exist_ok=True)
    p = d / "forge.json"
    p.write_bytes(json.dumps(cfg, indent=2).encode("utf-8"))
    return p


def _configured_forge_settings(vault: Path, environment: dict,
                               endpoint: str = "https://settings.example",
                               provider: str = "github"):
    service = settings_platform.SettingsService(
        registry=settings_platform.load_registry(
            settings_platform.default_registry_path()),
        vault_path=vault,
        user_device_id="forge-test-device",
        user_device_path=vault / ".test-settings" / "user-device.json",
        vault_id="forge-test-vault",
        workspace_project_id="project/web",
        environment=environment,
    )
    user_values = (
        ("providers.project_tracker.transport", "oauth"),
        ("providers.project_tracker.endpoint", endpoint),
        ("providers.project_tracker.secret_ref", {
            "provider": "environment",
            "locator": "FORGE_SETTINGS_TOKEN",
        }),
        ("providers.project_tracker.timeout_ms", 4321),
    )
    for revision, (key, value) in enumerate(user_values):
        result = service.assignment_set(
            scope="user-device",
            key=key,
            value=value,
            expected_revision=revision,
            updated_by="pytest",
        )
        assert result["status"] == "committed"
    result = service.assignment_set(
        scope="workspace-project",
        target_id="project/web",
        key="providers.project_tracker.provider",
        value=provider,
        expected_revision=0,
        updated_by="pytest",
    )
    assert result["status"] == "committed"
    result = service.assignment_set(
        scope="workspace-project",
        target_id="project/web",
        key="providers.project_tracker.enabled",
        value=True,
        expected_revision=1,
        updated_by="pytest",
    )
    assert result["status"] == "committed"
    return service


def _unconfigured_forge_settings(vault: Path, environment: dict):
    return settings_platform.SettingsService(
        registry=settings_platform.load_registry(
            settings_platform.default_registry_path()),
        vault_path=vault,
        user_device_id="forge-unconfigured-device",
        user_device_path=vault / ".test-settings" / "user-device.json",
        vault_id="forge-unconfigured-vault",
        workspace_project_id="project/web",
        environment=environment,
    )


# === config load ============================================================

class ForgeConfigTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9c-cfg-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_missing_file_is_empty(self):
        self.assertEqual(forge.load_forge_config(str(self.vault)), {})
        self.assertEqual(forge.project_configs(str(self.vault)), {})

    def test_loads_projects_map(self):
        cfg = {"projects": {
            "project/web": {
                "forge": {"provider": "gitea", "base_url": "https://git.invalid",
                          "repo": "org/web"},
                "primary_board": None,
                "mirrors": [{"provider": "gitea-project", "mode": "read-only"}],
            }
        }}
        _write_forge_config(self.vault, cfg)
        loaded = forge.load_forge_config(str(self.vault))
        self.assertIn("projects", loaded)
        pc = forge.project_configs(str(self.vault))["project/web"]
        self.assertEqual(pc["forge"]["repo"], "org/web")

    def test_malformed_file_is_empty_not_crash(self):
        d = self.vault / ".vault-mind"
        d.mkdir(parents=True)
        (d / "forge.json").write_bytes(b"{ this is not json")
        self.assertEqual(forge.load_forge_config(str(self.vault)), {})

    def test_config_holds_no_token(self):
        # the file MUST NOT carry a secret -- tokens come from the env only.
        cfg = {"projects": {"project/web": {
            "forge": {"provider": "gitea", "base_url": "https://git.invalid",
                      "repo": "org/web"}}}}
        p = _write_forge_config(self.vault, cfg)
        text = p.read_text("utf-8")
        self.assertNotIn("token", text.lower())


# === token_for (env, graceful) ==============================================

class TokenForTest(unittest.TestCase):
    def setUp(self):
        # snapshot + clear the token env vars so the test is hermetic.
        self._saved = {k: os.environ.pop(k, None)
                       for k in ("GITEA_TOKEN", "GITHUB_TOKEN", "LINEAR_TOKEN",
                                 "PLANE_API_KEY")}

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_reads_env(self):
        os.environ["GITEA_TOKEN"] = "secret-abc"
        self.assertEqual(forge.token_for("gitea"), "secret-abc")

    def test_missing_is_none(self):
        self.assertIsNone(forge.token_for("gitea"))
        self.assertIsNone(forge.token_for("github"))
        self.assertIsNone(forge.token_for("linear"))
        self.assertIsNone(forge.token_for("plane"))

    def test_blank_env_is_none(self):
        os.environ["LINEAR_TOKEN"] = "   "
        self.assertIsNone(forge.token_for("linear"))

    def test_unknown_provider_is_none(self):
        self.assertIsNone(forge.token_for("bitbucket"))
        self.assertIsNone(forge.token_for(None))


class GovernedForgeSettingsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-forge-settings-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        _write_forge_config(self.vault, {"projects": {
            "project/web": {
                "forge": {
                    "provider": "github",
                    "base_url": "https://legacy.example",
                    "repo": "org/web",
                },
            },
        }})

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_settings_endpoint_and_secret_override_legacy_forge_and_env_without_leak(self):
        settings_secret = "settings-secret-value"
        legacy_secret = "legacy-secret-value"
        service = _configured_forge_settings(self.vault, {
            "FORGE_SETTINGS_TOKEN": settings_secret,
            "GITHUB_TOKEN": legacy_secret,
        })
        transport = FakeTransport()

        out = forge.sync_pull(
            self.vault,
            transport,
            providers={"github": forge.GitHubAdapter()},
            today=TODAY,
            settings_service=service,
        )

        self.assertTrue(transport.calls)
        self.assertTrue(all(call[1].startswith("https://settings.example/")
                            for call in transport.calls))
        self.assertTrue(all(call[2].get("Authorization") == f"Bearer {settings_secret}"
                            for call in transport.calls))
        project = out["projects"][0]
        self.assertEqual(project["configurationSource"], "llmwiki-settings")
        self.assertEqual(project["credentialSource"], "settings-secret-reference")
        self.assertIsNone(project["compatibilitySource"])
        serialized = json.dumps(out, sort_keys=True)
        self.assertNotIn(settings_secret, serialized)
        self.assertNotIn(legacy_secret, serialized)
        self.assertNotIn("FORGE_SETTINGS_TOKEN", serialized)

    def test_configured_settings_missing_secret_fails_closed_without_legacy_env_fallback(self):
        legacy_secret = "legacy-must-not-run"
        service = _configured_forge_settings(self.vault, {
            "GITHUB_TOKEN": legacy_secret,
        })
        transport = FakeTransport()

        out = forge.sync_pull(
            self.vault,
            transport,
            providers={"github": forge.GitHubAdapter()},
            today=TODAY,
            settings_service=service,
        )

        self.assertEqual(transport.calls, [])
        self.assertTrue(out["errors"])
        error = out["errors"][0]
        self.assertEqual(error["configurationSource"], "llmwiki-settings")
        self.assertEqual(error["credentialSource"],
                         "settings-secret-reference-unavailable")
        self.assertEqual(error["configurationReason"], "settings-secret-unavailable")
        self.assertNotIn(legacy_secret, json.dumps(out, sort_keys=True))

    def test_unsetting_settings_rolls_back_to_labelled_legacy_binding_and_env(self):
        settings_secret = "settings-before-rollback"
        legacy_secret = "legacy-after-rollback"
        service = _configured_forge_settings(self.vault, {
            "FORGE_SETTINGS_TOKEN": settings_secret,
            "GITHUB_TOKEN": legacy_secret,
        })
        for revision, key in enumerate((
            "providers.project_tracker.transport",
            "providers.project_tracker.endpoint",
            "providers.project_tracker.secret_ref",
            "providers.project_tracker.timeout_ms",
        ), start=4):
            result = service.assignment_unset(
                scope="user-device",
                key=key,
                expected_revision=revision,
                updated_by="pytest",
                reason="rollback to legacy compatibility",
            )
            self.assertEqual(result["status"], "committed")
        result = service.assignment_unset(
            scope="workspace-project",
            target_id="project/web",
            key="providers.project_tracker.provider",
            expected_revision=2,
            updated_by="pytest",
            reason="rollback to legacy compatibility",
        )
        self.assertEqual(result["status"], "committed")
        result = service.assignment_unset(
            scope="workspace-project",
            target_id="project/web",
            key="providers.project_tracker.enabled",
            expected_revision=3,
            updated_by="pytest",
            reason="rollback to legacy compatibility",
        )
        self.assertEqual(result["status"], "committed")
        transport = FakeTransport()

        out = forge.sync_pull(
            self.vault,
            transport,
            providers={"github": forge.GitHubAdapter()},
            today=TODAY,
            settings_service=service,
        )

        self.assertTrue(transport.calls)
        self.assertTrue(all(call[1].startswith("https://legacy.example/")
                            for call in transport.calls))
        self.assertTrue(all(call[2].get("Authorization") == f"Bearer {legacy_secret}"
                            for call in transport.calls))
        project = out["projects"][0]
        self.assertEqual(project["configurationSource"], "legacy-forge-json")
        self.assertEqual(project["credentialSource"], "legacy-env")
        self.assertEqual(project["compatibilitySource"], "legacy")
        serialized = json.dumps(out, sort_keys=True)
        self.assertNotIn(settings_secret, serialized)
        self.assertNotIn(legacy_secret, serialized)

    def test_sync_apply_uses_settings_runtime_for_the_actual_write(self):
        settings_secret = "settings-apply-secret"
        service = _configured_forge_settings(self.vault, {
            "FORGE_SETTINGS_TOKEN": settings_secret,
            "GITHUB_TOKEN": "legacy-apply-secret",
        })
        _write_reviewed_head(
            self.vault,
            "Projects/web.reviewed.md",
            entity="project/web",
            state="done",
            provider="github",
            object_id="43",
            revision="r1",
        )
        url = "https://settings.example/repos/org/web/issues/43"
        transport = FakeTransport({
            ("PATCH", url): {
                "status": 200,
                "headers": {},
                "body": b'{"number":43}',
            },
        })

        out = forge.sync_apply(
            self.vault,
            transport,
            providers={"github": forge.GitHubAdapter()},
            apply=True,
            today=TODAY,
            settings_service=service,
        )

        push = out["projects"][0]["pushed"][0]
        self.assertTrue(push["pushed"])
        self.assertEqual(push["configurationSource"], "llmwiki-settings")
        self.assertEqual(push["credentialSource"], "settings-secret-reference")
        self.assertEqual([call[0] for call in transport.calls], ["PATCH"])
        self.assertEqual(transport.calls[0][1], url)
        self.assertEqual(transport.calls[0][2]["Authorization"],
                         f"Bearer {settings_secret}")
        self.assertNotIn(settings_secret, json.dumps(out, sort_keys=True))

    def test_linear_apply_uses_settings_graphql_endpoint_and_secret(self):
        _write_forge_config(self.vault, {"projects": {
            "project/web": {
                "forge": {
                    "provider": "linear",
                    "team_id": "team-uuid",
                    "state_type_ids": {"completed": "state-done"},
                },
            },
        }})
        settings_secret = "settings-linear-secret"
        endpoint = "https://linear.settings.example/graphql"
        service = _configured_forge_settings(
            self.vault,
            {
                "FORGE_SETTINGS_TOKEN": settings_secret,
                "LINEAR_TOKEN": "legacy-linear-secret",
            },
            endpoint=endpoint,
            provider="linear",
        )
        _write_reviewed_head(
            self.vault,
            "Projects/web-linear.reviewed.md",
            entity="project/web",
            state="done",
            provider="linear",
            object_id="linear-43",
            revision="r1",
        )
        transport = FakeTransport({
            ("POST", endpoint): {
                "status": 200,
                "headers": {},
                "body": json.dumps({
                    "data": {
                        "issueUpdate": {
                            "success": True,
                            "issue": {"id": "linear-43"},
                        },
                    },
                }).encode("utf-8"),
            },
        })

        out = forge.sync_apply(
            self.vault,
            transport,
            providers={"linear": forge.LinearAdapter()},
            apply=True,
            today=TODAY,
            settings_service=service,
        )

        push = out["projects"][0]["pushed"][0]
        self.assertTrue(push["pushed"])
        self.assertEqual(push["configurationSource"], "llmwiki-settings")
        self.assertEqual(transport.calls[0][1], endpoint)
        self.assertEqual(transport.calls[0][2]["Authorization"], settings_secret)
        serialized = json.dumps(out, sort_keys=True)
        self.assertNotIn(settings_secret, serialized)
        self.assertNotIn("legacy-linear-secret", serialized)

    def test_settings_profile_for_another_provider_fails_closed_before_resolving_credential(self):
        _write_forge_config(self.vault, {"projects": {
            "project/web": {
                "forge": {
                    "provider": "linear",
                    "team_id": "team-uuid",
                },
            },
        }})
        settings_secret = "github-settings-secret"
        legacy_secret = "linear-legacy-secret"
        service = _configured_forge_settings(
            self.vault,
            {
                "FORGE_SETTINGS_TOKEN": settings_secret,
                "LINEAR_TOKEN": legacy_secret,
            },
            provider="github",
        )
        transport = FakeTransport()

        out = forge.sync_pull(
            self.vault,
            transport,
            providers={"linear": forge.LinearAdapter()},
            today=TODAY,
            settings_service=service,
        )

        self.assertEqual(transport.calls, [])
        self.assertEqual(out["errors"][0]["configurationReason"],
                         "settings-provider-mismatch")
        serialized = json.dumps(out, sort_keys=True)
        self.assertNotIn(settings_secret, serialized)
        self.assertNotIn(legacy_secret, serialized)
        self.assertNotIn("FORGE_SETTINGS_TOKEN", serialized)

    def test_invalid_governed_endpoints_fail_closed_before_network(self):
        invalid_endpoints = (
            "https:///missing-host",
            "https://example.com?",
            "https://example.com#",
            "https://example.com:99999",
        )
        for index, endpoint in enumerate(invalid_endpoints):
            with self.subTest(endpoint=endpoint):
                case_vault = self.tmp / f"endpoint-{index}"
                case_vault.mkdir()
                _write_forge_config(case_vault, {"projects": {
                    "project/web": {
                        "forge": {"provider": "github", "repo": "org/web"},
                    },
                }})
                secret = f"endpoint-secret-{index}"
                service = _configured_forge_settings(
                    case_vault,
                    {"FORGE_SETTINGS_TOKEN": secret},
                    endpoint=endpoint,
                    provider="github",
                )
                transport = FakeTransport()

                out = forge.sync_pull(
                    case_vault,
                    transport,
                    providers={"github": forge.GitHubAdapter()},
                    today=TODAY,
                    settings_service=service,
                )

                self.assertEqual(transport.calls, [])
                self.assertEqual(out["errors"][0]["configurationReason"],
                                 "settings-endpoint-invalid")
                self.assertNotIn(secret, json.dumps(out, sort_keys=True))

    def test_authenticated_redirects_are_same_origin_https_only(self):
        authorization = "Bearer redirect-secret"
        handler = forge._same_origin_https_redirect_handler(authorization)
        request = urllib.request.Request(
            "https://settings.example/api/start",
            headers={"Authorization": authorization},
        )

        redirected = handler.redirect_request(
            request, None, 302, "Found", {}, "/api/next")

        self.assertEqual(
            redirected.full_url, "https://settings.example/api/next")
        self.assertNotIn("Authorization", redirected.headers)
        self.assertEqual(
            redirected.get_header("Authorization"), authorization)
        for target in (
            "https://other.example/api/next",
            "http://settings.example/api/next",
            "https://settings.example:444/api/next",
        ):
            with self.subTest(target=target), self.assertRaises(
                    urllib.error.HTTPError):
                handler.redirect_request(
                    request, None, 302, "Found", {}, target)

    def test_plane_api_key_redirect_is_preserved_only_on_same_https_origin(self):
        api_key = "plane-redirect-secret"
        handler = forge._same_origin_https_redirect_handler(
            {"X-API-Key": api_key})
        request = urllib.request.Request(
            "https://plane.example/api/v1/start",
            headers={"X-API-Key": api_key},
        )

        redirected = handler.redirect_request(
            request, None, 307, "Temporary Redirect", {}, "/api/v1/next")

        self.assertEqual(
            redirected.full_url, "https://plane.example/api/v1/next")
        self.assertNotIn("X-api-key", redirected.headers)
        self.assertEqual(redirected.get_header("X-api-key"), api_key)
        with self.assertRaises(urllib.error.HTTPError):
            handler.redirect_request(
                request, None, 307, "Temporary Redirect", {},
                "https://other.example/api/v1/next")

    def test_sync_plan_never_resolves_settings_secret_reference(self):
        secret = "last-mile-plan-secret"
        service = _configured_forge_settings(
            self.vault,
            {"FORGE_SETTINGS_TOKEN": secret},
            provider="github",
        )
        _write_reviewed_head(
            self.vault,
            "Projects/web-last-mile.reviewed.md",
            entity="project/web",
            state="done",
            provider="github",
            object_id="43",
            revision="r1",
        )
        url = "https://settings.example/repos/org/web/issues/43"
        transport = FakeTransport({
            ("PATCH", url): {
                "status": 200,
                "headers": {},
                "body": b'{"number":43}',
            },
        })

        with patch.object(
                service,
                "resolve_secret_reference",
                wraps=service.resolve_secret_reference) as resolver:
            plan = forge.sync_plan(
                self.vault,
                transport,
                providers={"github": forge.GitHubAdapter()},
                settings_service=service,
            )
            self.assertTrue(plan["projects"][0]["payloads"][0]["configured"])
            self.assertEqual(resolver.call_count, 0)
            forge.sync_apply(
                self.vault,
                transport,
                providers={"github": forge.GitHubAdapter()},
                apply=False,
                today=TODAY,
                settings_service=service,
            )
            self.assertEqual(resolver.call_count, 0)
            applied = forge.sync_apply(
                self.vault,
                transport,
                providers={"github": forge.GitHubAdapter()},
                apply=True,
                today=TODAY,
                settings_service=service,
            )

        self.assertEqual(resolver.call_count, 1)
        self.assertTrue(applied["projects"][0]["pushed"][0]["pushed"])
        self.assertNotIn(secret, json.dumps(applied, sort_keys=True))

    def test_settings_bootstrap_failure_never_falls_back_to_legacy_env(self):
        legacy_secret = "legacy-must-not-bypass-settings"
        transport = FakeTransport()

        with patch.dict(os.environ, {"GITHUB_TOKEN": legacy_secret}), patch.object(
                forge._settings_platform,
                "load_registry",
                side_effect=OSError(f"registry failed {legacy_secret}")):
            out = forge.sync_pull(
                self.vault,
                transport,
                providers={"github": forge.GitHubAdapter()},
                today=TODAY,
            )

        self.assertEqual(transport.calls, [])
        self.assertEqual(out["errors"][0]["configurationReason"],
                         "settings-initialization-failed")
        self.assertNotIn(legacy_secret, json.dumps(out, sort_keys=True))

    def test_settings_read_failure_is_typed_and_does_not_expose_exception_text(self):
        marker = "settings-read-secret-marker"

        class FailingSettings:
            environment = {"GITHUB_TOKEN": marker}
            default_context = {"workspaceProjectId": "project/web"}

            @staticmethod
            def project_tracker_invocation_profile(context):
                raise RuntimeError(f"failed reading {marker}")

        transport = FakeTransport()
        out = forge.sync_pull(
            self.vault,
            transport,
            providers={"github": forge.GitHubAdapter()},
            today=TODAY,
            settings_service=FailingSettings(),
        )

        self.assertEqual(transport.calls, [])
        self.assertEqual(out["errors"][0]["configurationReason"],
                         "settings-resolution-failed")
        self.assertNotIn(marker, json.dumps(out, sort_keys=True))

    def test_pull_provider_exception_text_never_enters_public_result(self):
        secret = "pull-provider-secret-marker"
        service = _configured_forge_settings(
            self.vault,
            {"FORGE_SETTINGS_TOKEN": secret},
            provider="github",
        )

        class LeakyProvider:
            @staticmethod
            def pull(repo_cfg, transport, token):
                raise forge.TransportError(
                    "GET", "https://settings.example/repos/org/web", 401,
                    detail=f"provider echoed {token}")

        out = forge.sync_pull(
            self.vault,
            FakeTransport(),
            providers={"github": LeakyProvider()},
            today=TODAY,
            settings_service=service,
        )

        serialized = json.dumps(out, sort_keys=True)
        self.assertNotIn(secret, serialized)
        self.assertNotIn("provider echoed", serialized)

    def test_execute_provider_exception_text_never_enters_public_result(self):
        secret = "execute-provider-secret-marker"
        service = _configured_forge_settings(
            self.vault,
            {"FORGE_SETTINGS_TOKEN": secret},
            provider="github",
        )
        _write_reviewed_head(
            self.vault,
            "Projects/web-provider-error.reviewed.md",
            entity="project/web",
            state="done",
            provider="github",
            object_id="43",
            revision="r1",
        )

        class LeakyProvider:
            @staticmethod
            def push_plan(snapshot, repo_cfg):
                return {"entity": snapshot["entity"], "payload": {}}

            @staticmethod
            def execute_push(plan, repo_cfg, transport, token):
                raise RuntimeError(f"provider echoed {token}")

        out = forge.sync_apply(
            self.vault,
            FakeTransport(),
            providers={"github": LeakyProvider()},
            apply=True,
            today=TODAY,
            settings_service=service,
        )

        serialized = json.dumps(out, sort_keys=True)
        self.assertNotIn(secret, serialized)
        self.assertNotIn("provider echoed", serialized)

    def test_execute_provider_result_cannot_echo_secret_into_public_record(self):
        secret = "execute-result-secret-marker"
        service = _configured_forge_settings(
            self.vault,
            {"FORGE_SETTINGS_TOKEN": secret},
            provider="github",
        )
        _write_reviewed_head(
            self.vault,
            "Projects/web-provider-result.reviewed.md",
            entity="project/web",
            state="done",
            provider="github",
            object_id="43",
            revision="r1",
        )

        class EchoingProvider:
            @staticmethod
            def push_plan(snapshot, repo_cfg):
                return {
                    "method": "PATCH",
                    "entity": snapshot["entity"],
                    "object_id": "43",
                    "payload": {},
                }

            @staticmethod
            def execute_push(plan, repo_cfg, transport, token):
                return {
                    "executed": True,
                    "method": "PATCH",
                    "object_id": "43",
                    "echo": token,
                    "url": f"https://settings.example/{token}",
                }

        out = forge.sync_apply(
            self.vault,
            FakeTransport(),
            providers={"github": EchoingProvider()},
            apply=True,
            today=TODAY,
            settings_service=service,
        )

        push = out["projects"][0]["pushed"][0]
        self.assertTrue(push["pushed"])
        self.assertNotIn("echo", push["executed"])
        self.assertNotIn("url", push["executed"])
        self.assertNotIn(secret, json.dumps(out, sort_keys=True))

    def test_governed_transport_without_deadline_support_fails_closed(self):
        service = _configured_forge_settings(
            self.vault,
            {"FORGE_SETTINGS_TOKEN": "unsupported-deadline-secret"},
            provider="github",
        )

        class UnsupportedTransport(forge.Transport):
            def __init__(self):
                self.calls = 0

            def request(self, method, url, headers=None, body=None):
                self.calls += 1
                return {"status": 200, "headers": {}, "body": b"[]"}

        transport = UnsupportedTransport()
        out = forge.sync_pull(
            self.vault,
            transport,
            providers={"github": forge.GitHubAdapter()},
            today=TODAY,
            settings_service=service,
        )

        self.assertEqual(transport.calls, 0)
        self.assertEqual(len(out["errors"]), 1)
        self.assertEqual(
            out["errors"][0]["error"],
            "PROVIDER provider request failed (no-response)",
        )
        self.assertNotIn(
            "unsupported-deadline-secret", json.dumps(out, sort_keys=True))

    def test_urllib_deadline_stops_a_slow_drip_response(self):
        class Clock:
            def __init__(self):
                self.now = 100.0

            def __call__(self):
                return self.now

        clock = Clock()

        class SlowResponse:
            status = 200
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

            def read1(self, size):
                del size
                clock.now += 0.06
                return b"x"

        class SlowOpener:
            @staticmethod
            def open(request, timeout):
                del request, timeout
                return SlowResponse()

        transport = forge.UrllibTransport(timeout=9, monotonic=clock)
        with patch(
                "urllib.request.build_opener",
                return_value=SlowOpener()), self.assertRaises(
                    forge.TransportError) as raised:
            with transport.operation_deadline(100):
                transport.request(
                    "GET",
                    "https://settings.example/slow",
                    headers={"Authorization": "Bearer deadline-secret"},
                )

        self.assertIn("operation deadline exceeded", str(raised.exception))
        self.assertNotIn("deadline-secret", str(raised.exception))
        self.assertEqual(transport.timeout, 9)

    def test_runtime_timeout_is_target_local_restored_and_plan_is_side_effect_free(self):
        class InspectingTransport(forge.UrllibTransport):
            def __init__(self):
                super().__init__(timeout=9)
                self.seen_timeouts = []

            def request(self, method, url, headers=None, body=None):
                self.seen_timeouts.append(self.timeout)
                return {"status": 200, "headers": {}, "body": b"[]"}

        service = _configured_forge_settings(
            self.vault,
            {"FORGE_SETTINGS_TOKEN": "settings-timeout-secret"},
            provider="github",
        )
        _write_reviewed_head(
            self.vault,
            "Projects/web-timeout.reviewed.md",
            entity="project/web",
            state="todo",
            provider="github",
            object_id="43",
            revision="r1",
        )
        transport = InspectingTransport()

        forge.sync_plan(
            self.vault,
            transport,
            providers={"github": forge.GitHubAdapter()},
            settings_service=service,
        )
        self.assertEqual(transport.timeout, 9)

        forge.sync_pull(
            self.vault,
            transport,
            providers={"github": forge.GitHubAdapter()},
            today=TODAY,
            settings_service=service,
        )
        self.assertTrue(transport.seen_timeouts)
        self.assertTrue(all(timeout == 4.321
                            for timeout in transport.seen_timeouts))
        self.assertEqual(transport.timeout, 9)

        legacy_vault = self.tmp / "legacy-timeout"
        legacy_vault.mkdir()
        _write_forge_config(legacy_vault, {"projects": {
            "project/web": {
                "forge": {
                    "provider": "github",
                    "base_url": "https://legacy.example",
                    "repo": "org/web",
                },
            },
        }})
        legacy_service = _unconfigured_forge_settings(
            legacy_vault,
            {"GITHUB_TOKEN": "legacy-timeout-secret"},
        )
        previous_calls = len(transport.seen_timeouts)
        forge.sync_pull(
            legacy_vault,
            transport,
            providers={"github": forge.GitHubAdapter()},
            today=TODAY,
            settings_service=legacy_service,
        )
        self.assertGreater(len(transport.seen_timeouts), previous_calls)
        self.assertTrue(all(timeout == 9
                            for timeout in transport.seen_timeouts[previous_calls:]))
        self.assertEqual(transport.timeout, 9)

    def test_sync_apply_detects_reviewed_head_drift_immediately_before_mutation(self):
        secret = "reviewed-head-drift-secret"
        service = _configured_forge_settings(
            self.vault,
            {"FORGE_SETTINGS_TOKEN": secret},
            provider="github",
        )
        _write_reviewed_head(
            self.vault,
            "Projects/web-reviewed-drift.reviewed.md",
            entity="project/web",
            state="done",
            provider="github",
            object_id="43",
            revision="r1",
        )
        planned = forge._reviewed_head_snapshot(self.vault, "project/web")
        changed = json.loads(json.dumps(planned))
        changed["fields"]["title"] = "promoted after planning"
        transport = FakeTransport()

        with patch.object(
                forge,
                "_reviewed_head_snapshot",
                side_effect=[planned, changed]), patch.object(
                    service,
                    "resolve_secret_reference",
                    wraps=service.resolve_secret_reference) as resolver:
            out = forge.sync_apply(
                self.vault,
                transport,
                providers={"github": forge.GitHubAdapter()},
                apply=True,
                today=TODAY,
                settings_service=service,
            )

        self.assertEqual(transport.calls, [])
        self.assertEqual(resolver.call_count, 0)
        push = out["projects"][0]["pushed"][0]
        self.assertFalse(push["pushed"])
        self.assertEqual(
            push["configurationReason"], "reviewed-head-drift-detected")
        self.assertNotIn(secret, json.dumps(out, sort_keys=True))

    def test_sync_apply_rechecks_reviewed_head_after_secret_resolution(self):
        secret = "reviewed-head-final-recheck-secret"
        service = _configured_forge_settings(
            self.vault,
            {"FORGE_SETTINGS_TOKEN": secret},
            provider="github",
        )
        _write_reviewed_head(
            self.vault,
            "Projects/web-reviewed-final-recheck.reviewed.md",
            entity="project/web",
            state="done",
            provider="github",
            object_id="43",
            revision="r1",
        )
        planned = forge._reviewed_head_snapshot(self.vault, "project/web")
        changed = json.loads(json.dumps(planned))
        changed["fields"]["title"] = "promoted during secret resolution"
        transport = FakeTransport()

        with patch.object(
                forge,
                "_reviewed_head_snapshot",
                side_effect=[planned, planned, changed]), patch.object(
                    service,
                    "resolve_secret_reference",
                    wraps=service.resolve_secret_reference) as resolver:
            out = forge.sync_apply(
                self.vault,
                transport,
                providers={"github": forge.GitHubAdapter()},
                apply=True,
                today=TODAY,
                settings_service=service,
            )

        self.assertEqual(resolver.call_count, 1)
        self.assertEqual(transport.calls, [])
        push = out["projects"][0]["pushed"][0]
        self.assertFalse(push["pushed"])
        self.assertEqual(
            push["configurationReason"], "reviewed-head-drift-detected")
        self.assertNotIn(secret, json.dumps(out, sort_keys=True))

    def test_sync_apply_detects_settings_drift_and_does_not_mutate(self):
        secret = "settings-drift-secret"
        base_service = _configured_forge_settings(
            self.vault,
            {"FORGE_SETTINGS_TOKEN": secret},
            provider="github",
        )
        _write_reviewed_head(
            self.vault,
            "Projects/web-drift.reviewed.md",
            entity="project/web",
            state="done",
            provider="github",
            object_id="43",
            revision="r1",
        )

        class DriftingSettings:
            environment = base_service.environment
            default_context = base_service.default_context

            def __init__(self):
                self.profile_calls = 0

            def project_tracker_invocation_profile(self, context):
                profile = base_service.project_tracker_invocation_profile(context)
                self.profile_calls += 1
                if self.profile_calls > 1:
                    profile["snapshotId"] = "changed-settings-snapshot"
                    profile["endpoint"] = "https://changed.example"
                return profile

            @staticmethod
            def resolve_secret_reference(reference):
                return base_service.resolve_secret_reference(reference)

        settings = DriftingSettings()
        transport = FakeTransport()
        out = forge.sync_apply(
            self.vault,
            transport,
            providers={"github": forge.GitHubAdapter()},
            apply=True,
            today=TODAY,
            settings_service=settings,
        )

        self.assertEqual(settings.profile_calls, 2)
        self.assertEqual(transport.calls, [])
        push = out["projects"][0]["pushed"][0]
        self.assertFalse(push["pushed"])
        self.assertEqual(push["configurationReason"],
                         "settings-drift-detected")
        self.assertNotIn(secret, json.dumps(out, sort_keys=True))


# === remote_item_to_candidate ==============================================

class RemoteItemToCandidateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9c-cand-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        self.item = forge.RemoteItem(
            kind="issue", object_id="LIN-123",
            revision="2026-06-24T20:30:00Z", actor="user/xue",
            title="Fix login bug", state="closed",
            entity_hint="project/web/issue/login",
        )

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _cand(self, resolver):
        return forge.remote_item_to_candidate(
            self.item, str(self.vault), "linear",
            base_head_resolver=resolver, today=TODAY)

    def test_stamps_origin_block(self):
        cand = self._cand(lambda e: "Projects/web.md")
        text = cand["text"]
        self.assertIn("origin:", text)
        self.assertIn("  provider: linear", text)
        self.assertIn("  object-id: LIN-123", text)
        self.assertIn("  revision: 2026-06-24T20:30:00Z", text)
        self.assertIn("  actor: user/xue", text)
        self.assertEqual(cand["origin"]["provider"], "linear")
        self.assertEqual(cand["origin"]["object-id"], "LIN-123")

    def test_status_is_always_draft(self):
        cand = self._cand(lambda e: "Projects/web.md")
        fm = parse_frontmatter(cand["text"])
        self.assertEqual(fm["status"], "draft")
        cm = currency.normalize(fm)
        self.assertTrue(work_protocol.is_candidate_work_note(cm))
        self.assertFalse(work_protocol.is_authoritative_work_note(cm))

    def test_no_supersedes_on_a_draft(self):
        cand = self._cand(lambda e: "Projects/web.md")
        fm = parse_frontmatter(cand["text"])
        self.assertNotIn(work_protocol.F_SUPERSEDES, fm)

    def test_base_head_stamped_when_head_exists(self):
        cand = self._cand(lambda e: "Projects/web.md")
        fm = parse_frontmatter(cand["text"])
        self.assertEqual(fm["base-head"], "Projects/web.md")
        self.assertEqual(cand["base_head"], "Projects/web.md")

    def test_base_head_omitted_for_new_entity(self):
        # resolver returns None (brand-new entity) -> NO base-head stamped.
        cand = self._cand(lambda e: None)
        fm = parse_frontmatter(cand["text"])
        self.assertNotIn("base-head", fm)
        self.assertIsNone(cand["base_head"])

    def test_remote_state_mapped_to_work_state_word(self):
        # remote "closed" -> canonical done (a PROPOSAL on a draft, not auto-close).
        cand = self._cand(lambda e: None)
        fm = parse_frontmatter(cand["text"])
        self.assertEqual(fm["state"], currency.STATE_DONE)
        self.assertEqual(cand["state"], currency.STATE_DONE)
        self.assertEqual(currency.work_state(currency.normalize(fm)),
                         currency.STATE_DONE)

    def test_open_state_maps_to_todo(self):
        self.item.state = "open"
        cand = self._cand(lambda e: None)
        self.assertEqual(cand["state"], currency.STATE_TODO)

    def test_type_is_issue_and_entity_from_hint(self):
        cand = self._cand(lambda e: None)
        fm = parse_frontmatter(cand["text"])
        self.assertEqual(fm["type"], work_protocol.TYPE_ISSUE)
        self.assertEqual(fm["entity"], "project/web/issue/login")

    def test_generated_by_marks_the_sync(self):
        cand = self._cand(lambda e: None)
        fm = parse_frontmatter(cand["text"])
        self.assertEqual(fm["generated-by"], "sync/linear")

    def test_candidate_text_is_lf_only(self):
        cand = self._cand(lambda e: "Projects/web.md")
        self.assertNotIn("\r", cand["text"])

    def test_title_becomes_body(self):
        cand = self._cand(lambda e: None)
        self.assertIn("Fix login bug", cand["text"])


# === pull_to_candidates =====================================================

class PullToCandidatesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9c-pull-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        _write_forge_config(self.vault, {"projects": {
            "project/web": {
                "forge": {"provider": "gitea", "base_url": "https://git.invalid",
                          "repo": "org/web"},
            }
        }})
        # canned issues JSON for the URL FakeProvider.pull will request.
        issues = [
            {"number": 42, "updated_at": "2026-06-24T10:00:00Z",
             "user": {"login": "user/curry"}, "title": "Add OAuth",
             "state": "open",
             "entity_hint": "project/web/issue/oauth"},
            {"number": 43, "updated_at": "2026-06-25T08:00:00Z",
             "user": {"login": "user/xue"}, "title": "Bug in parser",
             "state": "closed"},
        ]
        self.transport = FakeTransport({
            ("GET", "https://git.invalid/repos/org/web/issues"):
                {"status": 200, "headers": {},
                 "body": json.dumps(issues).encode("utf-8")},
        })
        self.provider = FakeProvider()
        self._saved = os.environ.pop("GITEA_TOKEN", None)

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("GITEA_TOKEN", None)
        else:
            os.environ["GITEA_TOKEN"] = self._saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _sync_dir(self) -> Path:
        return self.vault / "00-Inbox" / "AI-Output" / "sync-gitea"

    def test_missing_token_degrades_gracefully(self):
        # no GITEA_TOKEN -> not configured, nothing pulled, no crash.
        res = forge.pull_to_candidates(str(self.vault), "gitea", self.transport,
                                       provider=self.provider, today=TODAY)
        self.assertFalse(res["configured"])
        self.assertEqual(res["candidates"], [])
        # and the transport was NEVER called (no network attempted).
        self.assertEqual(self.transport.calls, [])

    def test_dry_run_writes_nothing(self):
        os.environ["GITEA_TOKEN"] = "secret"
        res = forge.pull_to_candidates(str(self.vault), "gitea", self.transport,
                                       provider=self.provider, apply=False,
                                       today=TODAY)
        self.assertTrue(res["configured"])
        self.assertEqual(len(res["candidates"]), 2)
        self.assertEqual(res["written"], [])
        self.assertFalse(self._sync_dir().exists())

    def test_apply_writes_append_only_lf_under_sync_provider_dir(self):
        os.environ["GITEA_TOKEN"] = "secret"
        res = forge.pull_to_candidates(str(self.vault), "gitea", self.transport,
                                       provider=self.provider, apply=True,
                                       today=TODAY)
        self.assertEqual(len(res["written"]), 2)
        d = self._sync_dir()
        self.assertTrue(d.exists())
        files = sorted(p.name for p in d.iterdir())
        self.assertEqual(len(files), 2)
        for p in d.iterdir():
            raw = p.read_bytes()
            self.assertNotIn(b"\r", raw)  # LF-only
            self.assertTrue(raw.startswith(b"---"))  # has frontmatter

    def test_apply_is_append_only_never_overwrites(self):
        # a pre-existing file with the same target name must NOT be clobbered;
        # the writer advances to -2.
        os.environ["GITEA_TOKEN"] = "secret"
        d = self._sync_dir()
        d.mkdir(parents=True)
        collide = d / f"{TODAY}-42.md"
        collide.write_bytes(b"PRE-EXISTING DO NOT TOUCH\n")
        forge.pull_to_candidates(str(self.vault), "gitea", self.transport,
                                 provider=self.provider, apply=True, today=TODAY)
        # the original bytes are intact.
        self.assertEqual(collide.read_bytes(), b"PRE-EXISTING DO NOT TOUCH\n")
        # and a -2 sibling was created for the colliding item.
        self.assertTrue((d / f"{TODAY}-42-2.md").exists())

    def test_pulled_candidate_attaches_to_project_when_no_finer_hint(self):
        # issue #43 carried no entity_hint -> defaults to the project entity.
        os.environ["GITEA_TOKEN"] = "secret"
        res = forge.pull_to_candidates(str(self.vault), "gitea", self.transport,
                                       provider=self.provider, today=TODAY)
        by_oid = {c["origin"]["object-id"]: c for c in res["candidates"]}
        self.assertEqual(by_oid["43"]["entity"], "project/web")
        self.assertEqual(by_oid["42"]["entity"], "project/web/issue/oauth")

    def test_no_provider_supplied_is_empty_plan_not_error(self):
        # 9C ships only the seam: with a token but no provider, the plan is
        # well-formed + empty (NOT an error).
        os.environ["GITEA_TOKEN"] = "secret"
        res = forge.pull_to_candidates(str(self.vault), "gitea", self.transport,
                                       provider=None, today=TODAY)
        self.assertTrue(res["configured"])
        self.assertEqual(res["candidates"], [])
        self.assertIn("seam", res["reason"])


# === anti-loop guard (§0 #10) ===============================================

class AntiLoopGuardTest(unittest.TestCase):
    def test_forge_plus_primary_board_is_allowed(self):
        cfg = {
            "forge": {"provider": "gitea", "repo": "org/x"},
            "primary_board": {"provider": "linear", "project-id": "P1"},
            "mirrors": [{"provider": "github", "mode": "read-only"}],
        }
        rw = forge.assert_single_bidirectional(cfg, "project/x")
        self.assertEqual(rw, ["forge:gitea", "primary-board:linear"])

    def test_writable_mirror_is_refused(self):
        # a mirror that is NOT read-only = a 2nd bidirectional path -> loop risk.
        cfg = {
            "forge": {"provider": "gitea", "repo": "org/x"},
            "mirrors": [{"provider": "github"}],  # no mode:read-only
        }
        with self.assertRaises(forge.BidirectionalConflict) as cm:
            forge.assert_single_bidirectional(cfg, "project/x")
        self.assertEqual(cm.exception.project_entity, "project/x")

    def test_read_only_mirror_does_not_trip_the_guard(self):
        cfg = {
            "forge": {"provider": "gitea", "repo": "org/x"},
            "mirrors": [{"provider": "github", "mode": "read-only"},
                        {"provider": "gitea-project", "mode": "ro"}],
        }
        rw = forge.assert_single_bidirectional(cfg, "project/x")
        self.assertEqual(rw, ["forge:gitea"])

    def test_only_forge_is_one_rw_path(self):
        cfg = {"forge": {"provider": "gitea", "repo": "org/x"}}
        self.assertEqual(forge.assert_single_bidirectional(cfg),
                         ["forge:gitea"])


# === sync_plan / sync_apply (reviewed, not draft) ===========================

class SyncPlanReviewedTest(unittest.TestCase):
    """sync_plan/apply project the REVIEWED current-truth head, never a draft."""

    def setUp(self):
        # scrub provider tokens so the apply path is deterministic regardless of
        # the ambient env (matches the hermetic pattern of the 9F apply tests).
        self._saved = {k: os.environ.pop(k, None)
                       for k in ("GITEA_TOKEN", "GITHUB_TOKEN", "LINEAR_TOKEN")}
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9c-sync-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        _write_forge_config(self.vault, {"projects": {
            "project/web/issue/login": {
                "forge": {"provider": "gitea", "repo": "org/web"},
            }
        }})
        # a REVIEWED head for the entity (current-truth, state in-progress).
        self.proj = self.vault / "Projects"
        self.proj.mkdir()
        (self.proj / "login.reviewed.md").write_bytes((
            "---\n"
            "type: issue\n"
            "entity: project/web/issue/login\n"
            "state: in-progress\n"
            "status: reviewed\n"
            "last-verified: 2026-06-20\n"
            "---\n\nReviewed login work.\n"
        ).encode("utf-8"))
        # a competing DRAFT capture for the SAME entity, state done. It must
        # NEVER be the snapshot we push (it is a proposal, not current-truth).
        inbox = self.vault / "00-Inbox" / "AI-Output" / "sync-gitea"
        inbox.mkdir(parents=True)
        (inbox / "2026-06-25-99.md").write_bytes((
            "---\n"
            "type: issue\n"
            "entity: project/web/issue/login\n"
            "state: done\n"
            "status: draft\n"
            "base-head: Projects/login.reviewed.md\n"
            "last-verified: 2026-06-25\n"
            "---\n\nDraft done proposal.\n"
        ).encode("utf-8"))
        self.transport = FakeTransport()
        self.providers = {"gitea": FakeProvider()}

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_plan_pushes_reviewed_not_draft(self):
        plan = forge.sync_plan(str(self.vault), self.transport,
                               providers=self.providers)
        entry = {p["entity"]: p for p in plan["projects"]}["project/web/issue/login"]
        snap = entry["snapshot"]
        self.assertIsNotNone(snap)
        # the snapshot is the REVIEWED head (state in-progress), NOT the draft
        # (state done) -- a draft must never become the pushed truth.
        self.assertEqual(snap["state"], currency.STATE_IN_PROGRESS)
        self.assertEqual(snap["status"], "reviewed")
        self.assertEqual(snap["note_id"], "Projects/login.reviewed.md")
        # the payload reflects the reviewed state.
        payload = entry["payloads"][0]["payload"]
        self.assertEqual(payload["state"], currency.STATE_IN_PROGRESS)

    def test_apply_without_configured_token_does_not_push(self):
        # 9F: with NO provider token in the env (scrubbed in setUp), the apply path
        # records the planned payload but executes no network write -- the push is
        # marked not-pushed (the not-configured branch), never a real PATCH/POST.
        out = forge.sync_apply(str(self.vault), self.transport,
                               providers=self.providers, apply=True)
        proj = {p["entity"]: p for p in out["projects"]}["project/web/issue/login"]
        self.assertTrue(proj["pushed"])
        for push in proj["pushed"]:
            self.assertFalse(push["pushed"])  # not configured -> no execute.
            self.assertIsNotNone(push["payload"])
        self.assertEqual(self.transport.calls, [])  # no network write at all.

    def test_apply_refuses_loop_risk_project(self):
        # add a SECOND bound project with a writable mirror -> refused, not pushed.
        _write_forge_config(self.vault, {"projects": {
            "project/web/issue/login": {
                "forge": {"provider": "gitea", "repo": "org/web"},
            },
            "project/loopy": {
                "forge": {"provider": "gitea", "repo": "org/loopy"},
                "mirrors": [{"provider": "github"}],  # writable mirror -> loop
            },
        }})
        out = forge.sync_apply(str(self.vault), self.transport,
                               providers=self.providers, apply=True)
        self.assertTrue(out["conflicts"])
        loopy = {p["entity"]: p for p in out["projects"]}["project/loopy"]
        self.assertIn("refused", loopy)
        self.assertEqual(loopy["pushed"], [])

    def test_plan_skips_entity_with_no_reviewed_head(self):
        # a bound project with NO authoritative head -> snapshot None, no push.
        _write_forge_config(self.vault, {"projects": {
            "project/never-touched": {
                "forge": {"provider": "gitea", "repo": "org/nt"},
            }
        }})
        plan = forge.sync_plan(str(self.vault), self.transport,
                               providers=self.providers)
        entry = {p["entity"]: p for p in plan["projects"]}["project/never-touched"]
        self.assertIsNone(entry["snapshot"])


# === transport (no network) =================================================

class TransportContractTest(unittest.TestCase):
    def test_fake_transport_records_and_returns_canned(self):
        t = FakeTransport({("GET", "https://x/y"):
                           {"status": 200, "headers": {}, "body": b"ok"}})
        resp = t.request("GET", "https://x/y", headers={"A": "B"}, body=None)
        self.assertEqual(resp["body"], b"ok")
        self.assertEqual(t.calls[0][0], "GET")
        self.assertEqual(t.calls[0][1], "https://x/y")

    def test_transport_error_redacts_query_and_omits_token(self):
        # a token carried as a query param must NOT survive into the error text,
        # and request headers (Authorization) are never echoed.
        err = forge.TransportError("GET", "https://x/y?access_token=SECRET", 401,
                                   detail="http error")
        s = str(err)
        self.assertNotIn("SECRET", s)
        self.assertNotIn("access_token", s)
        self.assertIn("401", s)

    def test_urllib_transport_is_the_default_and_uses_stdlib_only(self):
        # constructing the default transport must not require any third-party dep.
        t = forge.UrllibTransport(timeout=1)
        self.assertIsInstance(t, forge.Transport)


# === Gitea adapter (PR 9C part 2): RECORDED JSON, NEVER a live call =========

# A small RECORDED Gitea /issues payload (the shape Gitea actually returns). It
# is fed to the adapter through a FakeTransport so no network is ever touched.
_GITEA_ISSUES_JSON = [
    {"number": 42, "title": "Add OAuth", "state": "open",
     "updated_at": "2026-06-24T10:00:00Z",
     "user": {"login": "curry"}},
    {"number": 43, "title": "Bug in parser", "state": "closed",
     "updated_at": "2026-06-25T08:00:00Z",
     "user": {"login": "xue"}},
    # a PULL REQUEST also comes back from the issues endpoint -- it must be SKIPPED
    # (PRs are 9D evidence, not 9C work candidates).
    {"number": 44, "title": "PR: refactor", "state": "open",
     "updated_at": "2026-06-25T09:00:00Z",
     "user": {"login": "curry"},
     "pull_request": {"merged": False}},
]


class GiteaPullTest(unittest.TestCase):
    """GiteaAdapter.pull maps recorded Gitea issues JSON to RemoteItems and (via
    the shared stamper) to draft candidates -- with ZERO network."""

    def setUp(self):
        self.adapter = forge.GiteaAdapter()
        self.repo_cfg = {"provider": "gitea",
                         "base_url": "https://git.xart.top:8418",
                         "repo": "2233admin/vault-mind"}
        self.issues_url = ("https://git.xart.top:8418/api/v1/repos/"
                           "2233admin/vault-mind/issues"
                           "?state=all&type=issues&page=1&limit=50")
        self.transport = FakeTransport({
            ("GET", self.issues_url):
                {"status": 200, "headers": {},
                 "body": json.dumps(_GITEA_ISSUES_JSON).encode("utf-8")},
        })

    def test_pull_maps_issues_to_remote_items(self):
        items = self.adapter.pull(self.repo_cfg, self.transport, token="secret-T")
        # the PR (#44) is skipped -> only the two real issues map.
        self.assertEqual(len(items), 2)
        by_oid = {it.object_id: it for it in items}
        self.assertEqual(set(by_oid), {"42", "43"})
        i42 = by_oid["42"]
        self.assertEqual(i42.kind, "issue")
        self.assertEqual(i42.revision, "2026-06-24T10:00:00Z")
        self.assertEqual(i42.actor, "curry")
        self.assertEqual(i42.title, "Add OAuth")
        self.assertEqual(i42.state, "open")
        # entity_hint shape: project/<slug>/issue/<number>.
        self.assertEqual(i42.entity_hint, "project/vault-mind/issue/42")

    def test_pull_open_maps_active_closed_maps_done(self):
        # the candidate stamper turns gitea open->todo (active) and closed->done.
        items = self.adapter.pull(self.repo_cfg, self.transport, token="secret-T")
        by_oid = {it.object_id: it for it in items}
        cand_open = forge.remote_item_to_candidate(
            by_oid["42"], "/x", "gitea", base_head_resolver=lambda e: None,
            today=TODAY)
        cand_closed = forge.remote_item_to_candidate(
            by_oid["43"], "/x", "gitea", base_head_resolver=lambda e: None,
            today=TODAY)
        # open -> an ACTIVE state (todo); closed -> done.
        self.assertEqual(cand_open["state"], currency.STATE_TODO)
        self.assertEqual(cand_closed["state"], currency.STATE_DONE)

    def test_pull_candidate_origin_object_id_and_revision(self):
        items = self.adapter.pull(self.repo_cfg, self.transport, token="secret-T")
        by_oid = {it.object_id: it for it in items}
        cand = forge.remote_item_to_candidate(
            by_oid["43"], "/x", "gitea", base_head_resolver=lambda e: None,
            today=TODAY)
        self.assertEqual(cand["origin"]["provider"], "gitea")
        self.assertEqual(cand["origin"]["object-id"], "43")
        self.assertEqual(cand["origin"]["revision"], "2026-06-25T08:00:00Z")
        self.assertEqual(cand["origin"]["actor"], "xue")
        fm = parse_frontmatter(cand["text"])
        self.assertEqual(fm["status"], "draft")  # a remote change is a PROPOSAL.

    def test_pull_sends_authorization_token_header(self):
        self.adapter.pull(self.repo_cfg, self.transport, token="secret-T")
        # the token rides in the Authorization header (only), never in the URL.
        self.assertTrue(self.transport.calls)
        method, url, headers, body = self.transport.calls[0]
        self.assertEqual(headers.get("Authorization"), "token secret-T")
        self.assertNotIn("secret-T", url)

    def test_pull_without_token_is_empty_no_call(self):
        items = self.adapter.pull(self.repo_cfg, self.transport, token=None)
        self.assertEqual(items, [])
        self.assertEqual(self.transport.calls, [])  # no network attempted.

    def test_pull_401_is_graceful_error_token_absent(self):
        # a 401 -> a structured TransportError; the token NEVER appears in it.
        t = FakeTransport({
            ("GET", self.issues_url):
                {"status": 401, "headers": {}, "body": b'{"message":"unauth"}'},
        })
        with self.assertRaises(forge.TransportError) as cm:
            self.adapter.pull(self.repo_cfg, t, token="secret-T")
        msg = str(cm.exception)
        self.assertIn("401", msg)
        self.assertNotIn("secret-T", msg)
        self.assertNotIn("Authorization", msg)

    def test_pull_404_is_graceful_error(self):
        t = FakeTransport({
            ("GET", self.issues_url):
                {"status": 404, "headers": {}, "body": b'{"message":"not found"}'},
        })
        with self.assertRaises(forge.TransportError) as cm:
            self.adapter.pull(self.repo_cfg, t, token="secret-T")
        self.assertIn("404", str(cm.exception))

    def test_pull_pagination_stops_on_short_page(self):
        # a single short page (2 issues < limit) -> exactly one request.
        self.adapter.pull(self.repo_cfg, self.transport, token="secret-T")
        get_calls = [c for c in self.transport.calls if c[0] == "GET"]
        self.assertEqual(len(get_calls), 1)


class GiteaPushPlanTest(unittest.TestCase):
    def setUp(self):
        self.adapter = forge.GiteaAdapter()
        self.repo_cfg = {"provider": "gitea", "repo": "2233admin/vault-mind"}

    def test_new_snapshot_is_a_post_create_payload(self):
        # a snapshot with NO origin.object-id -> POST (create) at the collection.
        snapshot = {"entity": "project/vm/issue/oauth",
                    "state": currency.STATE_IN_PROGRESS,
                    "title": "Add OAuth", "body": "Implement OAuth login."}
        plan = self.adapter.push_plan(snapshot, self.repo_cfg)
        self.assertEqual(plan["method"], "POST")
        self.assertEqual(plan["endpoint"],
                         "/repos/2233admin/vault-mind/issues")
        self.assertIsNone(plan["object_id"])
        self.assertEqual(plan["payload"]["title"], "Add OAuth")
        self.assertEqual(plan["payload"]["body"], "Implement OAuth login.")
        # in-progress is active -> Gitea 'open'.
        self.assertEqual(plan["payload"]["state"], "open")

    def test_update_snapshot_is_a_patch_with_object_id(self):
        # a snapshot carrying origin.object-id -> PATCH at the numbered endpoint.
        snapshot = {"entity": "project/vm/issue/parser",
                    "state": currency.STATE_DONE,
                    "title": "Bug in parser",
                    "fields": {"origin": {"provider": "gitea",
                                          "object-id": "43"}}}
        plan = self.adapter.push_plan(snapshot, self.repo_cfg)
        self.assertEqual(plan["method"], "PATCH")
        self.assertEqual(plan["endpoint"],
                         "/repos/2233admin/vault-mind/issues/43")
        self.assertEqual(plan["object_id"], "43")
        # done is terminal -> Gitea 'closed'.
        self.assertEqual(plan["payload"]["state"], "closed")

    def test_canceled_maps_to_closed(self):
        snapshot = {"entity": "e", "state": currency.STATE_CANCELED, "title": "x"}
        plan = self.adapter.push_plan(snapshot, self.repo_cfg)
        self.assertEqual(plan["payload"]["state"], "closed")

    def test_origin_from_other_provider_is_a_create_not_patch(self):
        # a snapshot whose origin points at a DIFFERENT forge (github/linear) has
        # NO gitea counterpart yet -> a push to gitea CREATES; it must NOT PATCH a
        # foreign object-id (which would clobber an unrelated Gitea issue #43).
        for foreign in ("github", "linear"):
            snapshot = {"entity": "e", "state": currency.STATE_TODO, "title": "x",
                        "fields": {"origin": {"provider": foreign,
                                              "object-id": "43"}}}
            plan = self.adapter.push_plan(snapshot, self.repo_cfg)
            self.assertEqual(plan["method"], "POST",
                             f"{foreign}-origin must CREATE, not PATCH")
            self.assertEqual(plan["endpoint"],
                             "/repos/2233admin/vault-mind/issues")
            self.assertIsNone(plan["object_id"])

    def test_push_plan_issues_no_network(self):
        # push_plan is PURE -- a FakeTransport handed nowhere is irrelevant; the
        # point is the call returns a dict without any transport at all.
        snapshot = {"entity": "e", "state": currency.STATE_TODO, "title": "x"}
        plan = self.adapter.push_plan(snapshot, self.repo_cfg)
        self.assertIsInstance(plan, dict)


class GiteaCreateRepoPlanTest(unittest.TestCase):
    def test_create_repo_plan_is_private(self):
        adapter = forge.GiteaAdapter()
        plan = adapter.create_repo_plan({"repo": "2233admin/vault-mind"})
        self.assertEqual(plan["method"], "POST")
        self.assertEqual(plan["endpoint"], "/user/repos")
        self.assertEqual(plan["payload"]["name"], "vault-mind")
        self.assertTrue(plan["payload"]["private"])  # ALWAYS private.
        self.assertFalse(plan["payload"]["auto_init"])

    def test_create_repo_plan_name_override(self):
        adapter = forge.GiteaAdapter()
        plan = adapter.create_repo_plan({"name": "my-thing"})
        self.assertEqual(plan["payload"]["name"], "my-thing")
        self.assertTrue(plan["payload"]["private"])


class GiteaPublishPlanTest(unittest.TestCase):
    """publish_plan flags secrets + large files, lists uploads + steps, and
    creates / pushes NOTHING (the transport sees no call)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9c-publish-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        self.proj = self.tmp / "myproj"
        self.proj.mkdir()
        # a planted .env with a fake secret.
        (self.proj / ".env").write_bytes(
            b"API_KEY=sk-totally-fake-secret-value-1234567890\n"
            b"DB_PASSWORD=hunter2hunter2\n")
        # a planted AWS-key file (regex AKIA...).
        (self.proj / "creds.txt").write_bytes(
            b"aws_access_key_id = AKIAIOSFODNN7EXAMPLE\n")
        # a normal source file (NOT a secret).
        (self.proj / "main.py").write_bytes(b"print('hello')\n")
        # a >5MB large file.
        big = self.proj / "model.bin"
        big.write_bytes(b"\0" * (forge.PUBLISH_LARGE_FILE_BYTES + 1024))
        # a .gitignore so the "present" branch is exercised.
        (self.proj / ".gitignore").write_bytes(b".env\nnode_modules/\n")
        # noise that MUST be skipped (under a skip dir).
        (self.proj / "node_modules").mkdir()
        (self.proj / "node_modules" / "junk.js").write_bytes(b"x\n")

        # bind the project's machine path in local-bindings.json (9A registry).
        vm = self.vault / ".vault-mind"
        vm.mkdir(parents=True)
        (vm / "local-bindings.json").write_bytes(json.dumps(
            {"project/myproj": {"path": str(self.proj)}}).encode("utf-8"))
        # forge binding so the steps can name the remote.
        _write_forge_config(self.vault, {"projects": {
            "project/myproj": {
                "forge": {"provider": "gitea",
                          "base_url": "https://git.xart.top:8418",
                          "repo": "2233admin/myproj"}}}})
        self.adapter = forge.GiteaAdapter()
        self.transport = FakeTransport()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_publish_plan_flags_secret_and_large_file(self):
        plan = self.adapter.publish_plan(str(self.vault), "project/myproj",
                                         transport=self.transport)
        # the secret offenders include BOTH the .env and the AWS-key file.
        offenders = {o["file"] for o in plan["secret_offenders"]}
        self.assertIn(".env", offenders)
        self.assertIn("creds.txt", offenders)
        # the .env is flagged as a dotenv file (its contents ARE secrets).
        env_kinds = next(o["kinds"] for o in plan["secret_offenders"]
                         if o["file"] == ".env")
        self.assertIn("dotenv-file", env_kinds)
        # the AWS key is flagged by the AKIA pattern.
        creds_kinds = next(o["kinds"] for o in plan["secret_offenders"]
                           if o["file"] == "creds.txt")
        self.assertIn("aws-access-key-id", creds_kinds)
        # the large file is flagged.
        large_files = {f["file"] for f in plan["large_files"]}
        self.assertIn("model.bin", large_files)

    def test_publish_plan_lists_upload_files_excluding_skip_dirs(self):
        plan = self.adapter.publish_plan(str(self.vault), "project/myproj",
                                         transport=self.transport)
        uploads = set(plan["upload_files"])
        # real files would upload...
        self.assertIn("main.py", uploads)
        self.assertIn(".env", uploads)
        self.assertIn("model.bin", uploads)
        # ...but node_modules/* is excluded.
        self.assertNotIn("node_modules/junk.js", uploads)

    def test_publish_plan_has_gitignore_true(self):
        plan = self.adapter.publish_plan(str(self.vault), "project/myproj",
                                         transport=self.transport)
        self.assertTrue(plan["has_gitignore"])

    def test_publish_plan_lists_ordered_steps(self):
        plan = self.adapter.publish_plan(str(self.vault), "project/myproj",
                                         transport=self.transport)
        steps = [s["step"] for s in plan["steps"]]
        self.assertEqual(steps,
                         ["create-private-repo", "git-remote-add", "initial-push"])
        # the create-private-repo step carries the create_repo_plan (private).
        create = plan["steps"][0]["plan"]
        self.assertTrue(create["payload"]["private"])

    def test_publish_plan_is_dry_run_and_executes_no_write(self):
        plan = self.adapter.publish_plan(str(self.vault), "project/myproj",
                                         transport=self.transport)
        self.assertTrue(plan["dry_run"])
        self.assertFalse(plan["apply"])
        # CRITICAL: no repo created / no push executed -> the transport saw
        # NOTHING (publish_plan must never touch the network).
        self.assertEqual(self.transport.calls, [])
        # and the project dir is untouched (no .git created, no remote).
        self.assertFalse((self.proj / ".git").exists())

    def test_publish_plan_unbound_entity_is_graceful(self):
        plan = self.adapter.publish_plan(str(self.vault), "project/nope",
                                         transport=self.transport)
        self.assertIsNone(plan["path"])
        self.assertIn("binding", plan["reason"])
        self.assertEqual(self.transport.calls, [])

    def test_publish_plan_missing_token_is_not_configured_no_crash(self):
        saved = os.environ.pop("GITEA_TOKEN", None)
        try:
            plan = self.adapter.publish_plan(str(self.vault), "project/myproj",
                                             transport=self.transport)
            # missing token -> a graceful 'not configured' flag, never a crash.
            self.assertFalse(plan["configured"])
            # the plan is still computed (it does not need a token to be a plan).
            self.assertTrue(plan["steps"])
        finally:
            if saved is not None:
                os.environ["GITEA_TOKEN"] = saved


class GiteaPullToCandidatesIntegrationTest(unittest.TestCase):
    """The GiteaAdapter wired through pull_to_candidates: missing token degrades,
    a present token pulls recorded issues into draft candidates -- no network."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9c-gitea-pull-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        _write_forge_config(self.vault, {"projects": {
            "project/vault-mind": {
                "forge": {"provider": "gitea",
                          "base_url": "https://git.xart.top:8418",
                          "repo": "2233admin/vault-mind"}}}})
        url = ("https://git.xart.top:8418/api/v1/repos/"
               "2233admin/vault-mind/issues?state=all&type=issues&page=1&limit=50")
        self.transport = FakeTransport({
            ("GET", url): {"status": 200, "headers": {},
                           "body": json.dumps(_GITEA_ISSUES_JSON).encode("utf-8")},
        })
        self.adapter = forge.GiteaAdapter()
        self._saved = os.environ.pop("GITEA_TOKEN", None)

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("GITEA_TOKEN", None)
        else:
            os.environ["GITEA_TOKEN"] = self._saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_missing_token_degrades_gracefully(self):
        res = forge.pull_to_candidates(str(self.vault), "gitea", self.transport,
                                       provider=self.adapter, today=TODAY)
        self.assertFalse(res["configured"])
        self.assertEqual(res["candidates"], [])
        self.assertEqual(self.transport.calls, [])  # no network.

    def test_configured_pull_makes_draft_candidates(self):
        os.environ["GITEA_TOKEN"] = "secret-T"
        res = forge.pull_to_candidates(str(self.vault), "gitea", self.transport,
                                       provider=self.adapter, today=TODAY)
        self.assertTrue(res["configured"])
        # 2 issues (the PR was skipped).
        self.assertEqual(len(res["candidates"]), 2)
        for cand in res["candidates"]:
            fm = parse_frontmatter(cand["text"])
            self.assertEqual(fm["status"], "draft")
            self.assertEqual(fm["generated-by"], "sync/gitea")
        # the dry-run wrote nothing.
        self.assertEqual(res["written"], [])


# === origin round-trip: persisted note -> scan -> push_plan PATCH ==========
# These are the REGRESSION GUARDS for the 9C review: the anti-duplication contract
# ("a sync doesn't duplicate a remote issue") must hold through the REAL pipeline
# (a persisted note carrying an origin block -> scan_work_notes -> reviewed-head
# snapshot -> push_plan), not just a hand-built dict in isolation.

class OriginRoundTripTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9c-origin-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects").mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_origin_block_parses_as_a_dict(self):
        # the parser must capture the nested single-level origin map (not [] ).
        text = (
            "---\n"
            "type: issue\n"
            "entity: project/web/issue/parser\n"
            "state: done\n"
            "status: reviewed\n"
            "origin:\n"
            "  provider: gitea\n"
            "  object-id: 43\n"
            "  revision: 2026-06-25T08:00:00Z\n"
            "  actor: xue\n"
            "last-verified: 2026-06-25\n"
            "---\n\nBug in parser\n"
        )
        fm = parse_frontmatter(text)
        self.assertIsInstance(fm["origin"], dict)
        self.assertEqual(fm["origin"]["object-id"], "43")
        self.assertEqual(fm["origin"]["provider"], "gitea")
        # a sibling field AFTER the nested block is still captured (the block does
        # not swallow following top-level keys).
        self.assertEqual(fm["last-verified"], "2026-06-25")

    def test_reviewed_head_with_origin_pushes_patch_not_post(self):
        # a REAL reviewed head note carrying an origin block, scanned via the
        # actual pipeline, must push_plan -> PATCH the SAME issue (no duplicate).
        (self.vault / "Projects" / "parser.reviewed.md").write_bytes((
            "---\n"
            "type: issue\n"
            "entity: project/web/issue/parser\n"
            "state: done\n"
            "origin:\n"
            "  provider: gitea\n"
            "  object-id: 43\n"
            "  revision: 2026-06-25T08:00:00Z\n"
            "  actor: xue\n"
            "status: reviewed\n"
            "last-verified: 2026-06-25\n"
            "---\n\nBug in parser\n"
        ).encode("utf-8"))
        snap = forge._reviewed_head_snapshot(str(self.vault),
                                             "project/web/issue/parser")
        self.assertIsNotNone(snap)
        self.assertIsInstance(snap["fields"]["origin"], dict)
        plan = forge.GiteaAdapter().push_plan(snap, {"repo": "org/web"})
        self.assertEqual(plan["method"], "PATCH")
        self.assertEqual(plan["object_id"], "43")
        self.assertEqual(plan["endpoint"], "/repos/org/web/issues/43")

    def test_synced_draft_promotes_origin_then_pushes_patch(self):
        # the FULL federation round-trip: a sync-pulled draft (origin object-id 43)
        # promoted -> the reviewed head carries origin -> push_plan PATCHes it.
        inbox = self.vault / "00-Inbox" / "AI-Output" / "sync-gitea"
        inbox.mkdir(parents=True)
        item = forge.RemoteItem(
            kind="issue", object_id="43", revision="2026-06-25T08:00:00Z",
            actor="xue", title="Bug in parser", state="closed",
            entity_hint="project/web/issue/parser")
        cand = forge.remote_item_to_candidate(
            item, str(self.vault), "gitea",
            base_head_resolver=lambda e: None, today=TODAY)
        (inbox / f"{TODAY}-43.md").write_bytes(cand["text"].encode("utf-8"))

        notes = work_protocol.scan_work_notes(str(self.vault))
        draft = next(n for n in notes if n.note_id.endswith("43.md"))
        self.assertTrue(draft.is_candidate)
        pr = work_protocol.promote(str(self.vault), draft, apply=True, today=TODAY)
        self.assertEqual(pr.outcome, work_protocol.OUTCOME_MATERIALIZED)
        # the materialized reviewed head CARRIES the origin block (not dropped).
        self.assertIn("origin:", pr.snapshot_text)
        self.assertIn("object-id: 43", pr.snapshot_text)

        snap = forge._reviewed_head_snapshot(str(self.vault),
                                             "project/web/issue/parser")
        plan = forge.GiteaAdapter().push_plan(snap, {"repo": "org/web"})
        self.assertEqual(plan["method"], "PATCH")
        self.assertEqual(plan["object_id"], "43")


# === title-injection defense (finding #4) ==================================

class RemoteTitleInjectionTest(unittest.TestCase):
    def test_malicious_title_cannot_open_a_competing_frontmatter(self):
        # a remote title that embeds a fake `---\nstatus: reviewed\n---` fence must
        # NOT produce a candidate body that reparses into a competing frontmatter.
        item = forge.RemoteItem(
            kind="issue", object_id="9",
            title="Innocent\n---\nstatus: reviewed\nstate: done\n---",
            state="open", entity_hint="project/web/issue/evil")
        cand = forge.remote_item_to_candidate(
            item, "/x", "gitea", base_head_resolver=lambda e: None, today=TODAY)
        # the canonical parse still yields the REAL block (status:draft, the safe
        # mapped state), never the injected status:reviewed.
        fm = parse_frontmatter(cand["text"])
        self.assertEqual(fm["status"], "draft")
        self.assertEqual(fm["state"], currency.STATE_TODO)  # open -> todo, not done.
        # the body's fence line is defanged: no body line is a bare `---` at the
        # START of the line (a YAML fence must be unindented), so it cannot open a
        # competing block even for a naive `---`-splitter. The injected fence
        # survives only as content (` ---`, leading space), never as a fence.
        body = cand["text"].split("---\n", 1)[-1]  # drop the real frontmatter.
        body = body.split("\n---\n", 1)[0] if "\n---\n" in body else body
        for line in body.split("\n"):
            self.assertNotEqual(line, "---",
                                "a bare --- survived in the body (fence not defanged)")
            self.assertNotEqual(line, "...",
                                "a bare ... survived in the body (fence not defanged)")


# === upload-set cap (finding #5) ===========================================

class PublishWalkCapTest(unittest.TestCase):
    def test_walk_is_capped_and_warns(self):
        tmp = Path(tempfile.mkdtemp(prefix="vault-9c-cap-"))
        try:
            vault = tmp / "vault"
            vault.mkdir()
            proj = tmp / "huge"
            proj.mkdir()
            # write a few files, then drive the cap DOWN to prove the bound fires
            # without actually creating 50k files.
            for i in range(5):
                (proj / f"f{i}.txt").write_bytes(b"x\n")
            vm = vault / ".vault-mind"
            vm.mkdir(parents=True)
            (vm / "local-bindings.json").write_bytes(json.dumps(
                {"project/huge": {"path": str(proj)}}).encode("utf-8"))
            _write_forge_config(vault, {"projects": {"project/huge": {
                "forge": {"provider": "gitea", "repo": "org/huge"}}}})

            saved_cap = forge.PUBLISH_WALK_FILE_CAP
            forge.PUBLISH_WALK_FILE_CAP = 2
            try:
                plan = forge.GiteaAdapter().publish_plan(str(vault),
                                                         "project/huge")
            finally:
                forge.PUBLISH_WALK_FILE_CAP = saved_cap
            self.assertEqual(len(plan["upload_files"]), 2)
            self.assertTrue(any("truncated" in w for w in plan["warnings"]))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


# === GitHub adapter (PR 9D): RECORDED JSON, NEVER a live call ==============

# A RECORDED GitHub /issues payload (the shape GitHub actually returns). A GitHub
# issues payload ALSO includes pull requests (each PR object carries a
# `pull_request` key) -- the adapter must DROP those. It is fed to the adapter
# through a FakeTransport so no network is ever touched.
_GITHUB_ISSUES_JSON = [
    {"number": 42, "title": "Add OAuth", "state": "open", "state_reason": None,
     "updated_at": "2026-06-24T10:00:00Z",
     "user": {"login": "curry"}},
    {"number": 43, "title": "Bug in parser", "state": "closed",
     "state_reason": "completed",
     "updated_at": "2026-06-25T08:00:00Z",
     "user": {"login": "xue"}},
    # a closed+not_planned issue -> the work was DROPPED -> canceled (not done).
    {"number": 44, "title": "Wontfix idea", "state": "closed",
     "state_reason": "not_planned",
     "updated_at": "2026-06-25T09:00:00Z",
     "user": {"login": "curry"}},
    # a PULL REQUEST also comes back from the issues endpoint -- it carries a
    # `pull_request` key and MUST be DROPPED (PRs are evidence, not work issues).
    {"number": 45, "title": "PR: refactor", "state": "open",
     "updated_at": "2026-06-25T11:00:00Z",
     "user": {"login": "curry"},
     "pull_request": {"merged_at": None, "url": "https://api.github.com/x/45"}},
]

# A RECORDED GitHub /pulls payload (the shape GitHub's pulls endpoint returns).
_GITHUB_PULLS_JSON = [
    # a MERGED PR -> evidence: a `suggested-state: done` candidate (NOT state:done).
    {"number": 50, "title": "Implement OAuth", "state": "closed",
     "merged_at": "2026-06-25T12:00:00Z",
     "updated_at": "2026-06-25T12:00:00Z",
     "user": {"login": "curry"}},
    # an OPEN (unmerged) PR -> NO suggestion (it is not evidence of completion).
    {"number": 51, "title": "WIP: parser fix", "state": "open",
     "merged_at": None,
     "updated_at": "2026-06-25T13:00:00Z",
     "user": {"login": "xue"}},
]


class GitHubPullTest(unittest.TestCase):
    """GitHubAdapter.pull maps recorded GitHub issues JSON to RemoteItems, drops
    pull requests, and maps closed/not_planned -> canceled -- with ZERO network."""

    def setUp(self):
        self.adapter = forge.GitHubAdapter()
        self.repo_cfg = {"provider": "github", "repo": "2233admin/vault-mind"}
        self.issues_url = ("https://api.github.com/repos/2233admin/vault-mind/"
                           "issues?state=all&per_page=100&page=1")
        self.transport = FakeTransport({
            ("GET", self.issues_url):
                {"status": 200, "headers": {},
                 "body": json.dumps(_GITHUB_ISSUES_JSON).encode("utf-8")},
        })

    def test_pull_drops_pull_requests(self):
        items = self.adapter.pull(self.repo_cfg, self.transport, token="ghp_T")
        # the PR (#45) is dropped -> only the three real issues map.
        oids = {it.object_id for it in items}
        self.assertEqual(oids, {"42", "43", "44"})
        self.assertNotIn("45", oids)

    def test_pull_maps_issue_fields(self):
        items = self.adapter.pull(self.repo_cfg, self.transport, token="ghp_T")
        by_oid = {it.object_id: it for it in items}
        i42 = by_oid["42"]
        self.assertEqual(i42.kind, "issue")
        self.assertEqual(i42.revision, "2026-06-24T10:00:00Z")
        self.assertEqual(i42.actor, "curry")
        self.assertEqual(i42.title, "Add OAuth")
        self.assertEqual(i42.state, "open")
        self.assertEqual(i42.entity_hint, "project/vault-mind/issue/42")

    def test_pull_state_mapping_open_closed_notplanned(self):
        # open -> todo; closed(completed) -> done; closed(not_planned) -> canceled.
        items = self.adapter.pull(self.repo_cfg, self.transport, token="ghp_T")
        by_oid = {it.object_id: it for it in items}
        cand_open = forge.remote_item_to_candidate(
            by_oid["42"], "/x", "github", base_head_resolver=lambda e: None,
            today=TODAY)
        cand_closed = forge.remote_item_to_candidate(
            by_oid["43"], "/x", "github", base_head_resolver=lambda e: None,
            today=TODAY)
        cand_cancel = forge.remote_item_to_candidate(
            by_oid["44"], "/x", "github", base_head_resolver=lambda e: None,
            today=TODAY)
        self.assertEqual(cand_open["state"], currency.STATE_TODO)
        self.assertEqual(cand_closed["state"], currency.STATE_DONE)
        self.assertEqual(cand_cancel["state"], currency.STATE_CANCELED)

    def test_pull_candidate_is_draft_with_origin(self):
        items = self.adapter.pull(self.repo_cfg, self.transport, token="ghp_T")
        by_oid = {it.object_id: it for it in items}
        cand = forge.remote_item_to_candidate(
            by_oid["43"], "/x", "github", base_head_resolver=lambda e: None,
            today=TODAY)
        self.assertEqual(cand["origin"]["provider"], "github")
        self.assertEqual(cand["origin"]["object-id"], "43")
        self.assertEqual(cand["origin"]["revision"], "2026-06-25T08:00:00Z")
        self.assertEqual(cand["origin"]["actor"], "xue")
        fm = parse_frontmatter(cand["text"])
        self.assertEqual(fm["status"], "draft")  # a remote change is a PROPOSAL.

    def test_pull_sends_bearer_token_header_not_in_url(self):
        self.adapter.pull(self.repo_cfg, self.transport, token="ghp_T")
        self.assertTrue(self.transport.calls)
        method, url, headers, body = self.transport.calls[0]
        self.assertEqual(headers.get("Authorization"), "Bearer ghp_T")
        self.assertEqual(headers.get("Accept"), "application/vnd.github+json")
        self.assertIn("X-GitHub-Api-Version", headers)
        self.assertNotIn("ghp_T", url)  # token NEVER in the URL.

    def test_pull_without_token_is_empty_no_call(self):
        items = self.adapter.pull(self.repo_cfg, self.transport, token=None)
        self.assertEqual(items, [])
        self.assertEqual(self.transport.calls, [])  # no network attempted.

    def test_pull_401_is_graceful_error_token_absent(self):
        # ADVERSARIAL: the 401 body ECHOES the token back (a buggy/malicious
        # endpoint can reflect the Authorization header into its error JSON). The
        # raised error must carry status only -- never the response body / token.
        t = FakeTransport({
            ("GET", self.issues_url):
                {"status": 401, "headers": {"X-Echo": "Bearer ghp_SECRET"},
                 "body": b'{"message":"Bad creds for Bearer ghp_SECRET"}'},
        })
        with self.assertRaises(forge.TransportError) as cm:
            self.adapter.pull(self.repo_cfg, t, token="ghp_SECRET")
        msg = str(cm.exception)
        self.assertIn("401", msg)
        self.assertNotIn("ghp_SECRET", msg)
        self.assertNotIn("Authorization", msg)
        self.assertNotIn("Bearer", msg)

    def test_pull_403_and_404_are_graceful(self):
        for code in (403, 404):
            t = FakeTransport({
                ("GET", self.issues_url):
                    {"status": code, "headers": {}, "body": b'{"message":"x"}'},
            })
            with self.assertRaises(forge.TransportError) as cm:
                self.adapter.pull(self.repo_cfg, t, token="ghp_T")
            self.assertIn(str(code), str(cm.exception))

    def test_pull_pagination_stops_on_short_page(self):
        # a single short page (< per_page) -> exactly one issues request.
        self.adapter.pull(self.repo_cfg, self.transport, token="ghp_T")
        get_calls = [c for c in self.transport.calls if c[0] == "GET"]
        self.assertEqual(len(get_calls), 1)

    def test_pull_bare_repo_without_owner_yields_nothing(self):
        items = self.adapter.pull({"repo": "vault-mind"}, self.transport,
                                  token="ghp_T")
        self.assertEqual(items, [])


class GitHubEvidenceTest(unittest.TestCase):
    """A merged PR yields a `suggested-state` candidate (NOT a direct state:done),
    so code activity never auto-closes a work item (§0 #12)."""

    def setUp(self):
        self.adapter = forge.GitHubAdapter()
        self.repo_cfg = {"provider": "github", "repo": "2233admin/vault-mind"}
        self.pulls_url = ("https://api.github.com/repos/2233admin/vault-mind/"
                          "pulls?state=all&per_page=100&page=1")
        self.transport = FakeTransport({
            ("GET", self.pulls_url):
                {"status": 200, "headers": {},
                 "body": json.dumps(_GITHUB_PULLS_JSON).encode("utf-8")},
        })

    def test_only_merged_prs_become_evidence(self):
        items = self.adapter.pull_evidence(self.repo_cfg, self.transport,
                                           token="ghp_T")
        # the merged PR (#50) is evidence; the open/unmerged PR (#51) is NOT.
        oids = {it.object_id for it in items}
        self.assertEqual(oids, {"50"})
        ev = items[0]
        self.assertEqual(ev.kind, "pull-request")
        self.assertEqual(ev.actor, "curry")
        # the evidence item carries NO work state (it only SUGGESTS one).
        self.assertIsNone(ev.state)

    def test_merged_pr_candidate_is_suggested_state_not_state(self):
        items = self.adapter.pull_evidence(self.repo_cfg, self.transport,
                                           token="ghp_T")
        cand = self.adapter.evidence_to_candidate(
            items[0], "/x", base_head_resolver=lambda e: None, today=TODAY)
        # CRITICAL: a suggested-state, NOT a direct state:done.
        self.assertEqual(cand["suggested_state"], currency.STATE_DONE)
        self.assertEqual(cand["evidence"], "github:pr/50")
        fm = parse_frontmatter(cand["text"])
        self.assertEqual(fm["suggested-state"], currency.STATE_DONE)
        self.assertEqual(fm["evidence"], "github:pr/50")
        # there is NO top-level `state:` field -> it can NEVER auto-close.
        self.assertNotIn("state", fm)
        # still a draft -> it must go through triage/promote (the PR gate).
        self.assertEqual(fm["status"], "draft")
        self.assertEqual(fm["generated-by"], "sync/github")
        self.assertNotIn(work_protocol.F_SUPERSEDES, fm)

    def test_evidence_candidate_carries_origin_and_is_lf(self):
        items = self.adapter.pull_evidence(self.repo_cfg, self.transport,
                                           token="ghp_T")
        cand = self.adapter.evidence_to_candidate(
            items[0], "/x", base_head_resolver=lambda e: "Projects/x.md",
            today=TODAY)
        self.assertEqual(cand["origin"]["provider"], "github")
        self.assertEqual(cand["origin"]["object-id"], "50")
        self.assertNotIn("\r", cand["text"])
        fm = parse_frontmatter(cand["text"])
        self.assertEqual(fm["base-head"], "Projects/x.md")

    def test_evidence_without_token_is_empty_no_call(self):
        items = self.adapter.pull_evidence(self.repo_cfg, self.transport,
                                           token=None)
        self.assertEqual(items, [])
        self.assertEqual(self.transport.calls, [])


class GitHubPushPlanTest(unittest.TestCase):
    def setUp(self):
        self.adapter = forge.GitHubAdapter()
        self.repo_cfg = {"provider": "github", "repo": "2233admin/vault-mind"}

    def test_new_snapshot_is_a_post_create_payload(self):
        # a snapshot with NO origin.object-id -> POST (create) at the collection.
        snapshot = {"entity": "project/vm/issue/oauth",
                    "state": currency.STATE_IN_PROGRESS,
                    "title": "Add OAuth", "body": "Implement OAuth login."}
        plan = self.adapter.push_plan(snapshot, self.repo_cfg)
        self.assertEqual(plan["method"], "POST")
        self.assertEqual(plan["endpoint"],
                         "/repos/2233admin/vault-mind/issues")
        self.assertIsNone(plan["object_id"])
        self.assertEqual(plan["payload"]["title"], "Add OAuth")
        self.assertEqual(plan["payload"]["body"], "Implement OAuth login.")
        # a create payload does not force a state (GitHub creates issues open).
        self.assertNotIn("state", plan["payload"])

    def test_update_snapshot_is_a_patch_with_object_id(self):
        # a snapshot carrying a github origin.object-id -> PATCH (no duplicate).
        snapshot = {"entity": "project/vm/issue/parser",
                    "state": currency.STATE_DONE,
                    "title": "Bug in parser",
                    "fields": {"origin": {"provider": "github",
                                          "object-id": "43"}}}
        plan = self.adapter.push_plan(snapshot, self.repo_cfg)
        self.assertEqual(plan["method"], "PATCH")
        self.assertEqual(plan["endpoint"],
                         "/repos/2233admin/vault-mind/issues/43")
        self.assertEqual(plan["object_id"], "43")
        # done -> closed/completed.
        self.assertEqual(plan["payload"]["state"], "closed")
        self.assertEqual(plan["payload"]["state_reason"], "completed")

    def test_canceled_maps_to_closed_not_planned(self):
        snapshot = {"entity": "e", "state": currency.STATE_CANCELED, "title": "x",
                    "fields": {"origin": {"provider": "github",
                                          "object-id": "9"}}}
        plan = self.adapter.push_plan(snapshot, self.repo_cfg)
        self.assertEqual(plan["payload"]["state"], "closed")
        self.assertEqual(plan["payload"]["state_reason"], "not_planned")

    def test_active_maps_to_open(self):
        snapshot = {"entity": "e", "state": currency.STATE_IN_PROGRESS, "title": "x",
                    "fields": {"origin": {"provider": "github",
                                          "object-id": "9"}}}
        plan = self.adapter.push_plan(snapshot, self.repo_cfg)
        self.assertEqual(plan["payload"]["state"], "open")
        self.assertIsNone(plan["payload"]["state_reason"])

    def test_origin_from_other_provider_is_a_create_not_patch(self):
        # a snapshot whose origin points at gitea has NO github counterpart yet ->
        # a push to github CREATES (it must not PATCH a foreign object-id).
        snapshot = {"entity": "e", "state": currency.STATE_TODO, "title": "x",
                    "fields": {"origin": {"provider": "gitea",
                                          "object-id": "43"}}}
        plan = self.adapter.push_plan(snapshot, self.repo_cfg)
        self.assertEqual(plan["method"], "POST")
        self.assertIsNone(plan["object_id"])

    def test_push_plan_issues_no_network(self):
        snapshot = {"entity": "e", "state": currency.STATE_TODO, "title": "x"}
        plan = self.adapter.push_plan(snapshot, self.repo_cfg)
        self.assertIsInstance(plan, dict)


class GitHubPullToCandidatesIntegrationTest(unittest.TestCase):
    """The GitHubAdapter wired through pull_to_candidates: missing token degrades,
    a present token pulls recorded issues into draft candidates -- no network."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9d-gh-pull-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        _write_forge_config(self.vault, {"projects": {
            "project/vault-mind": {
                "forge": {"provider": "github",
                          "repo": "2233admin/vault-mind"}}}})
        url = ("https://api.github.com/repos/2233admin/vault-mind/"
               "issues?state=all&per_page=100&page=1")
        self.transport = FakeTransport({
            ("GET", url): {"status": 200, "headers": {},
                           "body": json.dumps(_GITHUB_ISSUES_JSON).encode("utf-8")},
        })
        self.adapter = forge.GitHubAdapter()
        self._saved = os.environ.pop("GITHUB_TOKEN", None)

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("GITHUB_TOKEN", None)
        else:
            os.environ["GITHUB_TOKEN"] = self._saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_missing_token_degrades_gracefully(self):
        res = forge.pull_to_candidates(str(self.vault), "github", self.transport,
                                       provider=self.adapter, today=TODAY)
        self.assertFalse(res["configured"])
        self.assertEqual(res["candidates"], [])
        self.assertEqual(self.transport.calls, [])  # no network.
        # the token env var name is named in the reason; no token value present.
        self.assertIn("GITHUB_TOKEN", res["reason"])

    def test_configured_pull_makes_draft_candidates(self):
        os.environ["GITHUB_TOKEN"] = "ghp_secret-T"
        res = forge.pull_to_candidates(str(self.vault), "github", self.transport,
                                       provider=self.adapter, today=TODAY)
        self.assertTrue(res["configured"])
        # 3 issues (the PR was dropped).
        self.assertEqual(len(res["candidates"]), 3)
        for cand in res["candidates"]:
            fm = parse_frontmatter(cand["text"])
            self.assertEqual(fm["status"], "draft")
            self.assertEqual(fm["generated-by"], "sync/github")
        self.assertEqual(res["written"], [])  # dry-run wrote nothing.
        # the token never leaked into any candidate text.
        for cand in res["candidates"]:
            self.assertNotIn("ghp_secret-T", cand["text"])


class GitHubOriginRoundTripTest(unittest.TestCase):
    """A persisted reviewed head carrying a github origin block -> scan -> snapshot
    -> push_plan PATCH (no duplicate), through the REAL pipeline."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9d-gh-origin-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects").mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_reviewed_head_with_github_origin_pushes_patch(self):
        (self.vault / "Projects" / "parser.reviewed.md").write_bytes((
            "---\n"
            "type: issue\n"
            "entity: project/web/issue/parser\n"
            "state: done\n"
            "origin:\n"
            "  provider: github\n"
            "  object-id: 43\n"
            "  revision: 2026-06-25T08:00:00Z\n"
            "  actor: xue\n"
            "status: reviewed\n"
            "last-verified: 2026-06-25\n"
            "---\n\nBug in parser\n"
        ).encode("utf-8"))
        snap = forge._reviewed_head_snapshot(str(self.vault),
                                             "project/web/issue/parser")
        self.assertIsNotNone(snap)
        self.assertIsInstance(snap["fields"]["origin"], dict)
        plan = forge.GitHubAdapter().push_plan(snap, {"repo": "org/web"})
        self.assertEqual(plan["method"], "PATCH")
        self.assertEqual(plan["object_id"], "43")
        self.assertEqual(plan["endpoint"], "/repos/org/web/issues/43")
        self.assertEqual(plan["payload"]["state"], "closed")
        self.assertEqual(plan["payload"]["state_reason"], "completed")


# === Linear adapter (PR 9E): RECORDED GraphQL JSON, NEVER a live call =======

# A RECORDED Linear GraphQL `issues` response (the {data:{issues:{nodes,pageInfo}}}
# shape Linear actually returns). state.type is the CANONICAL signal (state.name is
# human-renamable and must NOT be trusted). It is fed to the adapter through a
# FakeTransport so no network is ever touched.
_LINEAR_ISSUES_JSON = {
    "data": {
        "issues": {
            "pageInfo": {"hasNextPage": False, "endCursor": "cur-1"},
            "nodes": [
                # started -> in-progress.
                {"id": "lin-uuid-42", "identifier": "VM-42", "title": "Add OAuth",
                 "updatedAt": "2026-06-24T10:00:00Z",
                 "state": {"name": "In Progress", "type": "started"},
                 "assignee": {"displayName": "Curry"}},
                # completed -> done.
                {"id": "lin-uuid-43", "identifier": "VM-43",
                 "title": "Bug in parser", "updatedAt": "2026-06-25T08:00:00Z",
                 "state": {"name": "Done", "type": "completed"},
                 "assignee": {"displayName": "Xue"}},
                # canceled -> canceled.
                {"id": "lin-uuid-44", "identifier": "VM-44",
                 "title": "Wontfix idea", "updatedAt": "2026-06-25T09:00:00Z",
                 "state": {"name": "Cancelled", "type": "canceled"},
                 "assignee": None},
                # backlog -> backlog. state.NAME is a custom rename ("Icebox") but
                # state.TYPE is the canonical signal we trust.
                {"id": "lin-uuid-45", "identifier": "VM-45", "title": "Future idea",
                 "updatedAt": "2026-06-25T10:00:00Z",
                 "state": {"name": "Icebox", "type": "backlog"},
                 "assignee": {"displayName": "Curry"}},
            ],
        }
    }
}

# A RECORDED Linear GraphQL ERROR response ({data:null, errors:[...]}). A GraphQL
# endpoint signals failure with a top-level `errors` array, frequently WITH a 200
# HTTP status -- the adapter must surface a structured, token-free error.
#
# ADVERSARIAL: the error `message` ECHOES the request token (a buggy/malicious/
# MITM GraphQL endpoint can reflect the Authorization token into its own error
# text). The adapter MUST NOT carry that message into the raised error -- it
# surfaces only the count + the `code` extension (an enum), never the free-text
# message. The literal token here is asserted-absent from any raised error.
_LINEAR_ERROR_ECHOED_TOKEN = "lin_SECRET"
_LINEAR_ERRORS_JSON = {
    "data": None,
    "errors": [
        {"message": f"Authentication required for token {_LINEAR_ERROR_ECHOED_TOKEN}",
         "extensions": {"code": "AUTHENTICATION_ERROR"}},
    ],
}


class LinearPullTest(unittest.TestCase):
    """LinearAdapter.pull maps a recorded Linear GraphQL issues response to
    RemoteItems (trusting state.type, not state.name) -- with ZERO network."""

    def setUp(self):
        self.adapter = forge.LinearAdapter()
        self.repo_cfg = {"provider": "linear", "team_id": "team-uuid",
                         "project_id": "proj-uuid", "slug": "vault-mind"}
        self.transport = FakeTransport({
            ("POST", forge.LINEAR_API_URL):
                {"status": 200, "headers": {},
                 "body": json.dumps(_LINEAR_ISSUES_JSON).encode("utf-8")},
        })

    def test_pull_maps_nodes_to_remote_items(self):
        items = self.adapter.pull(self.repo_cfg, self.transport, token="lin_T")
        self.assertEqual(len(items), 4)
        by_oid = {it.object_id: it for it in items}
        # object_id is the STABLE linear id (used for issueUpdate), not VM-42.
        self.assertEqual(set(by_oid), {"lin-uuid-42", "lin-uuid-43",
                                       "lin-uuid-44", "lin-uuid-45"})
        i42 = by_oid["lin-uuid-42"]
        self.assertEqual(i42.kind, "issue")
        self.assertEqual(i42.revision, "2026-06-24T10:00:00Z")
        self.assertEqual(i42.actor, "Curry")
        self.assertEqual(i42.title, "Add OAuth")
        # entity_hint keys off the human identifier (ABC-123).
        self.assertEqual(i42.entity_hint, "project/vault-mind/issue/VM-42")

    def test_pull_uses_state_type_not_name(self):
        # state.type is the canonical signal: started->in-progress, completed->done,
        # canceled->canceled, backlog->backlog -- and state.NAME ("Icebox") is
        # IGNORED in favor of the type.
        items = self.adapter.pull(self.repo_cfg, self.transport, token="lin_T")
        by_oid = {it.object_id: it for it in items}
        cand_started = forge.remote_item_to_candidate(
            by_oid["lin-uuid-42"], "/x", "linear",
            base_head_resolver=lambda e: None, today=TODAY)
        cand_completed = forge.remote_item_to_candidate(
            by_oid["lin-uuid-43"], "/x", "linear",
            base_head_resolver=lambda e: None, today=TODAY)
        cand_canceled = forge.remote_item_to_candidate(
            by_oid["lin-uuid-44"], "/x", "linear",
            base_head_resolver=lambda e: None, today=TODAY)
        cand_backlog = forge.remote_item_to_candidate(
            by_oid["lin-uuid-45"], "/x", "linear",
            base_head_resolver=lambda e: None, today=TODAY)
        self.assertEqual(cand_started["state"], currency.STATE_IN_PROGRESS)
        self.assertEqual(cand_completed["state"], currency.STATE_DONE)
        self.assertEqual(cand_canceled["state"], currency.STATE_CANCELED)
        self.assertEqual(cand_backlog["state"], currency.STATE_BACKLOG)

    def test_pull_candidate_is_draft_with_origin(self):
        items = self.adapter.pull(self.repo_cfg, self.transport, token="lin_T")
        by_oid = {it.object_id: it for it in items}
        cand = forge.remote_item_to_candidate(
            by_oid["lin-uuid-43"], "/x", "linear",
            base_head_resolver=lambda e: None, today=TODAY)
        self.assertEqual(cand["origin"]["provider"], "linear")
        self.assertEqual(cand["origin"]["object-id"], "lin-uuid-43")
        self.assertEqual(cand["origin"]["revision"], "2026-06-25T08:00:00Z")
        self.assertEqual(cand["origin"]["actor"], "Xue")
        fm = parse_frontmatter(cand["text"])
        # a completed Linear issue is a PROPOSAL (draft), never an auto-close.
        self.assertEqual(fm["status"], "draft")
        self.assertNotIn(work_protocol.F_SUPERSEDES, fm)

    def test_pull_sends_raw_token_header_no_bearer_not_in_url(self):
        self.adapter.pull(self.repo_cfg, self.transport, token="lin_SECRET")
        self.assertTrue(self.transport.calls)
        method, url, headers, body = self.transport.calls[0]
        self.assertEqual(method, "POST")
        # Linear uses the RAW token (NO 'Bearer ' prefix).
        self.assertEqual(headers.get("Authorization"), "lin_SECRET")
        self.assertNotIn("Bearer", headers.get("Authorization", ""))
        self.assertEqual(headers.get("Content-Type"), "application/json")
        # the token NEVER rides in the URL.
        self.assertNotIn("lin_SECRET", url)

    def test_pull_token_never_appears_in_request_url(self):
        self.adapter.pull(self.repo_cfg, self.transport, token="lin_SECRET")
        for method, url, headers, body in self.transport.calls:
            self.assertNotIn("lin_SECRET", url)

    def test_pull_without_token_is_empty_no_call(self):
        items = self.adapter.pull(self.repo_cfg, self.transport, token=None)
        self.assertEqual(items, [])
        self.assertEqual(self.transport.calls, [])  # no network attempted.

    def test_pull_graphql_errors_is_graceful_structured_error_token_absent(self):
        # a {errors:[...]} GraphQL response (even with HTTP 200) -> a structured
        # TransportError; the token NEVER appears in it -- EVEN when the API's own
        # error `message` echoes the request token back (the message is server-
        # controlled response data and is NOT trusted; only count + code surface).
        t = FakeTransport({
            ("POST", forge.LINEAR_API_URL):
                {"status": 200, "headers": {},
                 "body": json.dumps(_LINEAR_ERRORS_JSON).encode("utf-8")},
        })
        with self.assertRaises(forge.TransportError) as cm:
            self.adapter.pull(self.repo_cfg, t, token="lin_SECRET")
        msg = str(cm.exception)
        self.assertIn("graphql errors", msg)
        # the token MUST NOT survive, even though the error message echoed it.
        self.assertNotIn("lin_SECRET", msg)
        self.assertNotIn("Authorization", msg)
        # the safe enum `code` extension may surface (it can never carry a secret).
        self.assertIn("AUTHENTICATION_ERROR", msg)

    def test_pull_graphql_error_message_is_never_embedded(self):
        # defense-in-depth: an error message with NO code extension contributes
        # NOTHING to the raised error text (the free-text message is never trusted).
        leaky = {"data": None, "errors": [
            {"message": "raw secret leaked: lin_SECRET-xyz no-code-here"}]}
        t = FakeTransport({
            ("POST", forge.LINEAR_API_URL):
                {"status": 200, "headers": {},
                 "body": json.dumps(leaky).encode("utf-8")},
        })
        with self.assertRaises(forge.TransportError) as cm:
            self.adapter.pull(self.repo_cfg, t, token="lin_SECRET")
        msg = str(cm.exception)
        self.assertIn("graphql errors (1)", msg)
        self.assertNotIn("lin_SECRET", msg)
        self.assertNotIn("raw secret leaked", msg)

    def test_pull_http_401_is_graceful_error(self):
        t = FakeTransport({
            ("POST", forge.LINEAR_API_URL):
                {"status": 401, "headers": {}, "body": b'{"message":"unauth"}'},
        })
        with self.assertRaises(forge.TransportError) as cm:
            self.adapter.pull(self.repo_cfg, t, token="lin_SECRET")
        msg = str(cm.exception)
        self.assertIn("401", msg)
        self.assertNotIn("lin_SECRET", msg)

    def test_pull_single_page_stops_when_has_next_false(self):
        # hasNextPage:false -> exactly one POST (no cursor follow-up).
        self.adapter.pull(self.repo_cfg, self.transport, token="lin_T")
        post_calls = [c for c in self.transport.calls if c[0] == "POST"]
        self.assertEqual(len(post_calls), 1)


class LinearPushPlanTest(unittest.TestCase):
    def setUp(self):
        self.adapter = forge.LinearAdapter()
        self.repo_cfg = {"provider": "linear", "team_id": "team-uuid"}

    def test_new_snapshot_is_an_issue_create_mutation(self):
        # a snapshot with NO origin.object-id -> issueCreate.
        snapshot = {"entity": "project/vm/issue/oauth",
                    "state": currency.STATE_IN_PROGRESS,
                    "title": "Add OAuth", "body": "Implement OAuth login."}
        plan = self.adapter.push_plan(snapshot, self.repo_cfg)
        self.assertEqual(plan["mutation"], "issueCreate")
        self.assertIsNone(plan["object_id"])
        inp = plan["variables"]["input"]
        self.assertEqual(inp["title"], "Add OAuth")
        self.assertEqual(inp["description"], "Implement OAuth login.")
        self.assertEqual(inp["teamId"], "team-uuid")
        # in-progress -> the started TYPE is recorded.
        self.assertEqual(plan["state_type"], "started")

    def test_existing_origin_is_an_issue_update_mutation_no_duplicate(self):
        # a snapshot carrying a linear origin.object-id -> issueUpdate (no create).
        snapshot = {"entity": "project/vm/issue/parser",
                    "state": currency.STATE_DONE,
                    "title": "Bug in parser",
                    "fields": {"origin": {"provider": "linear",
                                          "object-id": "lin-uuid-43"}}}
        plan = self.adapter.push_plan(snapshot, self.repo_cfg)
        self.assertEqual(plan["mutation"], "issueUpdate")
        self.assertEqual(plan["object_id"], "lin-uuid-43")
        self.assertEqual(plan["variables"]["id"], "lin-uuid-43")
        self.assertEqual(plan["variables"]["input"]["title"], "Bug in parser")
        # done -> the completed TYPE is recorded.
        self.assertEqual(plan["state_type"], "completed")

    def test_origin_from_other_provider_is_a_create_not_update(self):
        # a snapshot whose origin points at gitea has NO linear counterpart yet ->
        # a push to linear CREATES (it must not issueUpdate a foreign id).
        snapshot = {"entity": "e", "state": currency.STATE_TODO, "title": "x",
                    "fields": {"origin": {"provider": "gitea",
                                          "object-id": "43"}}}
        plan = self.adapter.push_plan(snapshot, self.repo_cfg)
        self.assertEqual(plan["mutation"], "issueCreate")
        self.assertIsNone(plan["object_id"])

    def test_state_id_seam_resolves_when_configured(self):
        # repo_cfg carries a state-type -> stateId map -> the input gets a stateId
        # and there is NO 'needs stateId mapping' note.
        cfg = {"provider": "linear", "team_id": "team-uuid",
               "state_type_ids": {"completed": "state-done-uuid"}}
        snapshot = {"entity": "e", "state": currency.STATE_DONE, "title": "x",
                    "fields": {"origin": {"provider": "linear",
                                          "object-id": "lin-9"}}}
        plan = self.adapter.push_plan(snapshot, cfg)
        self.assertEqual(plan["variables"]["input"]["stateId"], "state-done-uuid")
        self.assertFalse(any("needs stateId" in n for n in plan["notes"]))

    def test_missing_state_id_mapping_records_a_note_never_guesses(self):
        # no state_type_ids -> NO stateId in the input + a documented note (the
        # plan never fabricates a workspace stateId).
        snapshot = {"entity": "e", "state": currency.STATE_DONE, "title": "x",
                    "fields": {"origin": {"provider": "linear",
                                          "object-id": "lin-9"}}}
        plan = self.adapter.push_plan(snapshot, self.repo_cfg)
        self.assertNotIn("stateId", plan["variables"]["input"])
        self.assertTrue(any("needs stateId" in n for n in plan["notes"]))

    def test_create_without_team_id_records_a_note(self):
        snapshot = {"entity": "e", "state": currency.STATE_TODO, "title": "x"}
        plan = self.adapter.push_plan(snapshot, {"provider": "linear"})
        self.assertEqual(plan["mutation"], "issueCreate")
        self.assertNotIn("teamId", plan["variables"]["input"])
        self.assertTrue(any("needs teamId" in n for n in plan["notes"]))

    def test_push_plan_issues_no_network(self):
        snapshot = {"entity": "e", "state": currency.STATE_TODO, "title": "x"}
        plan = self.adapter.push_plan(snapshot, self.repo_cfg)
        self.assertIsInstance(plan, dict)


class LinearPullToCandidatesIntegrationTest(unittest.TestCase):
    """The LinearAdapter wired through pull_to_candidates: missing token degrades,
    a present token pulls recorded issues into draft candidates -- no network."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9e-lin-pull-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        _write_forge_config(self.vault, {"projects": {
            "project/vault-mind": {
                "forge": {"provider": "linear", "team_id": "team-uuid",
                          "slug": "vault-mind"}}}})
        self.transport = FakeTransport({
            ("POST", forge.LINEAR_API_URL):
                {"status": 200, "headers": {},
                 "body": json.dumps(_LINEAR_ISSUES_JSON).encode("utf-8")},
        })
        self.adapter = forge.LinearAdapter()
        self._saved = os.environ.pop("LINEAR_TOKEN", None)

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("LINEAR_TOKEN", None)
        else:
            os.environ["LINEAR_TOKEN"] = self._saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_missing_token_degrades_gracefully(self):
        res = forge.pull_to_candidates(str(self.vault), "linear", self.transport,
                                       provider=self.adapter, today=TODAY)
        self.assertFalse(res["configured"])
        self.assertEqual(res["candidates"], [])
        self.assertEqual(self.transport.calls, [])  # no network.
        # the token env var name is named in the reason; no token value present.
        self.assertIn("LINEAR_TOKEN", res["reason"])

    def test_configured_pull_makes_draft_candidates(self):
        os.environ["LINEAR_TOKEN"] = "lin_secret-T"
        res = forge.pull_to_candidates(str(self.vault), "linear", self.transport,
                                       provider=self.adapter, today=TODAY)
        self.assertTrue(res["configured"])
        self.assertEqual(len(res["candidates"]), 4)
        for cand in res["candidates"]:
            fm = parse_frontmatter(cand["text"])
            self.assertEqual(fm["status"], "draft")
            self.assertEqual(fm["generated-by"], "sync/linear")
            # the token never leaked into any candidate text.
            self.assertNotIn("lin_secret-T", cand["text"])
        self.assertEqual(res["written"], [])  # dry-run wrote nothing.


class LinearOriginRoundTripTest(unittest.TestCase):
    """A persisted reviewed head carrying a linear origin block -> scan -> snapshot
    -> push_plan issueUpdate (no duplicate), through the REAL pipeline."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9e-lin-origin-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects").mkdir(parents=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_reviewed_head_with_linear_origin_pushes_issue_update(self):
        (self.vault / "Projects" / "parser.reviewed.md").write_bytes((
            "---\n"
            "type: issue\n"
            "entity: project/web/issue/parser\n"
            "state: done\n"
            "origin:\n"
            "  provider: linear\n"
            "  object-id: lin-uuid-43\n"
            "  revision: 2026-06-25T08:00:00Z\n"
            "  actor: Xue\n"
            "status: reviewed\n"
            "last-verified: 2026-06-25\n"
            "---\n\nBug in parser\n"
        ).encode("utf-8"))
        snap = forge._reviewed_head_snapshot(str(self.vault),
                                             "project/web/issue/parser")
        self.assertIsNotNone(snap)
        self.assertIsInstance(snap["fields"]["origin"], dict)
        plan = forge.LinearAdapter().push_plan(
            snap, {"team_id": "team-uuid",
                   "state_type_ids": {"completed": "state-done-uuid"}})
        # the origin maps to an EXISTING linear issue -> issueUpdate, not create.
        self.assertEqual(plan["mutation"], "issueUpdate")
        self.assertEqual(plan["object_id"], "lin-uuid-43")
        self.assertEqual(plan["variables"]["id"], "lin-uuid-43")
        self.assertEqual(plan["variables"]["input"]["stateId"], "state-done-uuid")


# === Plane adapter: current /work-items/ REST contract ======================

_PLANE_WORK_ITEMS_JSON = {
    "results": [
        {
            "id": "work-item-43",
            "sequence_id": 43,
            "name": "Plane parser bug",
            "updated_at": "2026-07-15T09:30:00Z",
            "updated_by": {"display_name": "Xue"},
            "state": {"id": "state-started", "group": "started"},
        },
    ],
    "next_cursor": None,
    "next_page_results": False,
}


class PlaneAdapterTest(unittest.TestCase):
    def setUp(self):
        self.adapter = forge.PlaneAdapter()
        self.binding = {
            "provider": "plane",
            "base_url": "https://plane.example",
            "workspace_slug": "xart",
            "project_id": "project-uuid",
            "state_type_ids": {
                "started": "state-started",
                "completed": "state-completed",
            },
        }
        self.collection_url = (
            "https://plane.example/api/v1/workspaces/xart/projects/"
            "project-uuid/work-items/"
        )
        self.list_url = self.collection_url + "?per_page=100&expand=state"

    def test_pull_uses_current_self_hosted_work_items_contract(self):
        transport = FakeTransport({
            ("GET", self.list_url): {
                "status": 200,
                "headers": {},
                "body": json.dumps(_PLANE_WORK_ITEMS_JSON).encode("utf-8"),
            },
        })

        items = self.adapter.pull(self.binding, transport, "plane-secret")

        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(item.kind, "work-item")
        self.assertEqual(item.object_id, "work-item-43")
        self.assertEqual(item.revision, "2026-07-15T09:30:00Z")
        self.assertEqual(item.actor, "Xue")
        self.assertEqual(item.state, "started")
        self.assertEqual(item.entity_hint, "project/xart/issue/43")
        method, url, headers, body = transport.calls[0]
        self.assertEqual(method, "GET")
        self.assertEqual(url, self.list_url)
        self.assertEqual(headers["X-API-Key"], "plane-secret")
        self.assertNotIn("plane-secret", url)
        self.assertIsNone(body)

    def test_create_plan_is_pure_and_uses_explicit_state_uuid(self):
        snapshot = {
            "entity": "project/web/issue/new-plane-item",
            "state": currency.STATE_IN_PROGRESS,
            "title": "Create from reviewed truth",
            "body": "Reviewed description.",
        }

        plan = self.adapter.push_plan(snapshot, self.binding)

        self.assertEqual(plan["method"], "POST")
        self.assertEqual(plan["url"], self.collection_url)
        self.assertEqual(plan["body"]["state"], "state-started")
        self.assertFalse(plan["needs_mapping"])

    def test_missing_state_mapping_omits_state_and_records_needs_mapping(self):
        snapshot = {
            "entity": "project/web/issue/unmapped",
            "state": currency.STATE_TODO,
            "title": "Needs workspace mapping",
        }

        plan = self.adapter.push_plan(snapshot, self.binding)

        self.assertNotIn("state", plan["body"])
        self.assertTrue(plan["needs_mapping"])
        self.assertTrue(any("needs-mapping" in note for note in plan["notes"]))

    def test_same_provider_origin_updates_and_foreign_origin_creates(self):
        same = {
            "entity": "project/web/issue/plane",
            "state": currency.STATE_DONE,
            "fields": {
                "origin": {"provider": "plane", "object-id": "work-item-43"},
            },
        }
        foreign = {
            **same,
            "fields": {
                "origin": {"provider": "linear", "object-id": "work-item-43"},
            },
        }

        update = self.adapter.push_plan(same, self.binding)
        create = self.adapter.push_plan(foreign, self.binding)

        self.assertEqual(update["method"], "PATCH")
        self.assertEqual(update["url"], self.collection_url + "work-item-43/")
        self.assertEqual(update["body"]["state"], "state-completed")
        self.assertEqual(create["method"], "POST")
        self.assertIsNone(create["object_id"])

    def test_missing_workspace_or_project_fails_closed_without_network(self):
        incomplete = {"provider": "plane", "workspace_slug": "xart"}
        plan = self.adapter.push_plan(
            {"entity": "project/web", "state": currency.STATE_TODO},
            incomplete,
        )
        transport = FakeTransport()

        result = self.adapter.execute_push(
            plan, incomplete, transport, token="plane-secret")

        self.assertIn("plane-binding-incomplete", plan["error"])
        self.assertFalse(result["executed"])
        self.assertEqual(transport.calls, [])

    def test_execute_push_posts_and_patches_with_x_api_key(self):
        create_plan = self.adapter.push_plan(
            {
                "entity": "project/web/issue/new",
                "state": currency.STATE_IN_PROGRESS,
                "title": "New item",
            },
            self.binding,
        )
        update_plan = self.adapter.push_plan(
            {
                "entity": "project/web/issue/existing",
                "state": currency.STATE_DONE,
                "title": "Existing item",
                "fields": {
                    "origin": {
                        "provider": "plane",
                        "object-id": "work-item-43",
                    },
                },
            },
            self.binding,
        )
        transport = FakeTransport({
            ("POST", self.collection_url): {
                "status": 201,
                "headers": {},
                "body": json.dumps({
                    "id": "work-item-new",
                    "updated_at": "2026-07-16T15:00:00Z",
                }).encode("utf-8"),
            },
            ("PATCH", self.collection_url + "work-item-43/"): {
                "status": 200, "headers": {}, "body": b"{}",
            },
        })

        created = self.adapter.execute_push(
            create_plan, self.binding, transport, "plane-secret")
        updated = self.adapter.execute_push(
            update_plan, self.binding, transport, "plane-secret")

        self.assertTrue(created["executed"])
        self.assertEqual(created["object_id"], "work-item-new")
        self.assertEqual(created["revision"], "2026-07-16T15:00:00Z")
        self.assertTrue(updated["executed"])
        self.assertEqual([call[0] for call in transport.calls], ["POST", "PATCH"])
        for _, url, headers, body in transport.calls:
            self.assertEqual(headers["X-API-Key"], "plane-secret")
            self.assertNotIn("plane-secret", url)
            self.assertIsInstance(json.loads(body.decode("utf-8")), dict)


class GovernedPlaneProjectionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-plane-settings-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        self.entity = "project/web/issue/plane"
        self.binding = {
            "provider": "plane",
            "workspace_slug": "xart",
            "project_id": "project-uuid",
            "state_type_ids": {"completed": "state-completed"},
        }
        _write_forge_config(self.vault, {
            "projects": {self.entity: {"forge": self.binding}},
        })
        _write_reviewed_head(
            self.vault,
            "Projects/plane.reviewed.md",
            entity=self.entity,
            state="done",
            provider="plane",
            object_id="work-item-43",
            revision="r1",
        )

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_settings_governed_apply_resolves_secret_only_for_patch(self):
        secret = "plane-settings-secret"
        service = _configured_forge_settings(
            self.vault,
            {"FORGE_SETTINGS_TOKEN": secret},
            endpoint="https://plane.example",
            provider="plane",
        )
        item_url = (
            "https://plane.example/api/v1/workspaces/xart/projects/"
            "project-uuid/work-items/work-item-43/"
        )
        transport = FakeTransport({
            ("PATCH", item_url): {
                "status": 200, "headers": {}, "body": b"{}",
            },
        })

        dry_run = forge.sync_plan(
            self.vault,
            transport,
            providers={"plane": forge.PlaneAdapter()},
            settings_service=service,
        )
        applied = forge.sync_apply(
            self.vault,
            transport,
            providers={"plane": forge.PlaneAdapter()},
            apply=True,
            today=TODAY,
            settings_service=service,
        )

        self.assertEqual(transport.calls[0][0], "PATCH")
        self.assertEqual(transport.calls[0][1], item_url)
        self.assertEqual(transport.calls[0][2]["X-API-Key"], secret)
        self.assertEqual(transport.deadlines, [4321])
        push = applied["projects"][0]["pushed"][0]
        self.assertTrue(push["pushed"])
        self.assertEqual(push["configurationSource"], "llmwiki-settings")
        serialized = json.dumps({"dryRun": dry_run, "applied": applied})
        self.assertNotIn(secret, serialized)
        self.assertNotIn("FORGE_SETTINGS_TOKEN", serialized)

    def test_explicit_disabled_settings_do_not_fall_back_to_plane_env(self):
        legacy_secret = "plane-legacy-must-not-run"
        service = _configured_forge_settings(
            self.vault,
            {"FORGE_SETTINGS_TOKEN": "configured-secret",
             "PLANE_API_KEY": legacy_secret},
            endpoint="https://plane.example",
            provider="plane",
        )
        result = service.assignment_set(
            scope="workspace-project",
            target_id="project/web",
            key="providers.project_tracker.enabled",
            value=False,
            expected_revision=2,
            updated_by="pytest",
        )
        self.assertEqual(result["status"], "committed")
        transport = FakeTransport()

        out = forge.sync_pull(
            self.vault,
            transport,
            providers={"plane": forge.PlaneAdapter()},
            today=TODAY,
            settings_service=service,
        )

        self.assertEqual(transport.calls, [])
        self.assertEqual(out["errors"][0]["configurationReason"],
                         "settings-profile-disabled")
        self.assertNotIn(legacy_secret, json.dumps(out))

    def test_entirely_unconfigured_settings_use_labelled_legacy_plane_env(self):
        service = _unconfigured_forge_settings(
            self.vault, {"PLANE_API_KEY": "legacy-plane-secret"})
        list_url = (
            "https://api.plane.so/api/v1/workspaces/xart/projects/"
            "project-uuid/work-items/?per_page=100&expand=state"
        )
        transport = FakeTransport({
            ("GET", list_url): {
                "status": 200,
                "headers": {},
                "body": json.dumps(_PLANE_WORK_ITEMS_JSON).encode("utf-8"),
            },
        })

        out = forge.sync_pull(
            self.vault,
            transport,
            providers={"plane": forge.PlaneAdapter()},
            today=TODAY,
            settings_service=service,
        )

        project = out["projects"][0]
        self.assertEqual(project["configurationSource"], "legacy-forge-json")
        self.assertEqual(project["credentialSource"], "legacy-env")
        self.assertEqual(project["compatibilitySource"], "legacy")
        self.assertEqual(len(out["candidates"]), 1)
        self.assertEqual(
            transport.deadlines, [forge.DEFAULT_HTTP_TIMEOUT_S * 1000])
        self.assertNotIn("legacy-plane-secret", json.dumps(out))

    def test_legacy_plane_endpoint_is_governed_before_api_key_can_be_sent(self):
        invalid_endpoints = (
            "http://plane.example",
            "https://user:password@plane.example",
            "https://plane.example?tenant=secret",
        )
        for endpoint in invalid_endpoints:
            with self.subTest(endpoint=endpoint):
                _write_forge_config(self.vault, {
                    "projects": {
                        self.entity: {
                            "forge": {**self.binding, "base_url": endpoint},
                        },
                    },
                })
                secret = "legacy-plane-secret-must-not-leave-process"
                service = _unconfigured_forge_settings(
                    self.vault, {"PLANE_API_KEY": secret})
                transport = FakeTransport()

                out = forge.sync_pull(
                    self.vault,
                    transport,
                    providers={"plane": forge.PlaneAdapter()},
                    today=TODAY,
                    settings_service=service,
                )

                self.assertEqual(transport.calls, [])
                self.assertEqual(transport.deadlines, [])
                self.assertEqual(
                    out["projects"][0]["configurationReason"],
                    "legacy-endpoint-invalid",
                )
                self.assertEqual(
                    out["errors"][0]["configurationReason"],
                    "legacy-endpoint-invalid",
                )
                self.assertNotIn(secret, json.dumps(out, sort_keys=True))


# === PR 9F: RECONCILIATION (sync_pull / detect_sync_conflict / sync_apply) ===
# All driven by FakeTransport + recorded JSON + injected providers -- NEVER a live
# API. These are the capstone tests that wire the adapters end-to-end.


def _write_reviewed_head(vault: Path, rel: str, *, entity: str, state: str,
                         provider: str, object_id: str, revision: str) -> None:
    """Write a REVIEWED current-truth head carrying a same-provider origin block
    (so push_plan PATCHes / issueUpdates it, and detect_sync_conflict can compare
    revisions). LF-only bytes."""
    p = vault / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes((
        "---\n"
        "type: issue\n"
        f"entity: {entity}\n"
        f"state: {state}\n"
        "origin:\n"
        f"  provider: {provider}\n"
        f"  object-id: {object_id}\n"
        f"  revision: {revision}\n"
        "  actor: xue\n"
        "status: reviewed\n"
        "last-verified: 2026-06-20\n"
        "---\n\nReviewed work.\n"
    ).encode("utf-8"))


def _write_new_reviewed_head(vault: Path, *, title: str = "Brand new") -> Path:
    path = vault / "Projects" / "new.reviewed.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes((
        "---\n"
        "type: issue\n"
        "entity: project/web/issue/new\n"
        "state: in-progress\n"
        "status: reviewed\n"
        f"title: {title}\n"
        "last-verified: 2026-06-20\n"
        "---\n\nNew work.\n"
    ).encode("utf-8"))
    return path


class CreateResponseIdentityTest(unittest.TestCase):
    def test_all_project_tracker_providers_parse_create_identity_and_revision(self):
        snapshot = {
            "entity": "project/web/issue/new",
            "state": currency.STATE_TODO,
            "title": "Create once",
            "body": "Reviewed body.",
        }
        cases = (
            (
                "github",
                forge.GitHubAdapter(),
                {"provider": "github", "repo": "org/web"},
                "https://api.github.com/repos/org/web/issues",
                {"number": 41, "updated_at": "2026-07-16T01:00:00Z"},
                "41",
            ),
            (
                "gitea",
                forge.GiteaAdapter(),
                {"provider": "gitea", "base_url": "https://git.example",
                 "repo": "org/web"},
                "https://git.example/api/v1/repos/org/web/issues",
                {"number": 42, "updated_at": "2026-07-16T02:00:00Z"},
                "42",
            ),
            (
                "plane",
                forge.PlaneAdapter(),
                {"provider": "plane", "workspace_slug": "xart",
                 "project_id": "project-uuid"},
                ("https://api.plane.so/api/v1/workspaces/xart/projects/"
                 "project-uuid/work-items/"),
                {"id": "plane-43", "updated_at": "2026-07-16T03:00:00Z"},
                "plane-43",
            ),
            (
                "linear",
                forge.LinearAdapter(),
                {"provider": "linear", "team_id": "team-uuid"},
                forge.LINEAR_API_URL,
                {"data": {"issueCreate": {"success": True, "issue": {
                    "id": "linear-44",
                    "updatedAt": "2026-07-16T04:00:00Z",
                }}}},
                "linear-44",
            ),
        )

        for name, adapter, binding, url, response_body, expected_id in cases:
            with self.subTest(provider=name):
                plan = adapter.push_plan(snapshot, binding)
                transport = FakeTransport({
                    ("POST", url): {
                        "status": 201,
                        "headers": {},
                        "body": json.dumps(response_body).encode("utf-8"),
                    },
                })

                result = adapter.execute_push(
                    plan, binding, transport, token=f"{name}-secret")

                self.assertTrue(result["executed"])
                self.assertEqual(result["object_id"], expected_id)
                expected_revision = {
                    "github": "2026-07-16T01:00:00Z",
                    "gitea": "2026-07-16T02:00:00Z",
                    "plane": "2026-07-16T03:00:00Z",
                    "linear": "2026-07-16T04:00:00Z",
                }[name]
                self.assertEqual(result["revision"], expected_revision)
                self.assertEqual([call[0] for call in transport.calls], ["POST"])

    def test_all_project_tracker_providers_share_zero_network_replay_semantics(self):
        cases = (
            (
                "github", "GITHUB_TOKEN", forge.GitHubAdapter(),
                {"provider": "github", "repo": "org/web"},
                "https://api.github.com/repos/org/web/issues",
                {"number": 51, "updated_at": "2026-07-16T11:00:00Z"},
            ),
            (
                "gitea", "GITEA_TOKEN", forge.GiteaAdapter(),
                {"provider": "gitea", "base_url": "https://git.example",
                 "repo": "org/web"},
                "https://git.example/api/v1/repos/org/web/issues",
                {"number": 52, "updated_at": "2026-07-16T12:00:00Z"},
            ),
            (
                "plane", "PLANE_API_KEY", forge.PlaneAdapter(),
                {"provider": "plane", "workspace_slug": "xart",
                 "project_id": "project-uuid"},
                ("https://api.plane.so/api/v1/workspaces/xart/projects/"
                 "project-uuid/work-items/"),
                {"id": "plane-53", "updated_at": "2026-07-16T13:00:00Z"},
            ),
            (
                "linear", "LINEAR_TOKEN", forge.LinearAdapter(),
                {"provider": "linear", "team_id": "team-uuid"},
                forge.LINEAR_API_URL,
                {"data": {"issueCreate": {"success": True, "issue": {
                    "id": "linear-54",
                    "updatedAt": "2026-07-16T14:00:00Z",
                }}}},
            ),
        )

        for name, env_name, adapter, binding, url, response_body in cases:
            with self.subTest(provider=name), tempfile.TemporaryDirectory(
                    prefix=f"vault-replay-{name}-") as tmp:
                vault = Path(tmp) / "vault"
                vault.mkdir()
                _write_forge_config(vault, {
                    "projects": {
                        "project/web/issue/new": {"forge": binding},
                    },
                })
                _write_new_reviewed_head(vault)
                transport = FakeTransport({
                    ("POST", url): {
                        "status": 201,
                        "headers": {},
                        "body": json.dumps(response_body).encode("utf-8"),
                    },
                })
                with patch.dict(os.environ, {env_name: f"{name}-secret"}):
                    first = forge.sync_apply(
                        vault, transport, providers={name: adapter},
                        apply=True, today=TODAY)
                    replay = forge.sync_apply(
                        vault, transport, providers={name: adapter},
                        apply=True, today=TODAY)

                first_push = first["projects"][0]["pushed"][0]
                replay_push = replay["projects"][0]["pushed"][0]
                self.assertTrue(first_push["pushed"])
                self.assertTrue(replay_push["pushed"])
                self.assertTrue(replay_push["executed"]["idempotentReplay"])
                self.assertFalse(replay_push["executed"]["networkMutation"])
                self.assertEqual([call[0] for call in transport.calls], ["POST"])


class SyncPullTest(unittest.TestCase):
    """sync_pull writes issue candidates AND merged-PR evidence candidates
    (suggested-state, no state) for a GitHub project; dry-run writes nothing."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9f-pull-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        _write_forge_config(self.vault, {"projects": {
            "project/vault-mind": {
                "forge": {"provider": "github", "repo": "2233admin/vault-mind"},
            }
        }})
        issues_url = ("https://api.github.com/repos/2233admin/vault-mind/"
                      "issues?state=all&per_page=100&page=1")
        pulls_url = ("https://api.github.com/repos/2233admin/vault-mind/"
                     "pulls?state=all&per_page=100&page=1")
        self.transport = FakeTransport({
            ("GET", issues_url): {"status": 200, "headers": {},
                "body": json.dumps(_GITHUB_ISSUES_JSON).encode("utf-8")},
            ("GET", pulls_url): {"status": 200, "headers": {},
                "body": json.dumps(_GITHUB_PULLS_JSON).encode("utf-8")},
        })
        self.providers = {"github": forge.GitHubAdapter()}
        self._saved = os.environ.pop("GITHUB_TOKEN", None)

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("GITHUB_TOKEN", None)
        else:
            os.environ["GITHUB_TOKEN"] = self._saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _sync_dir(self) -> Path:
        return self.vault / "00-Inbox" / "AI-Output" / "sync-github"

    def test_dry_run_pulls_issues_and_evidence_writes_nothing(self):
        os.environ["GITHUB_TOKEN"] = "ghp_T"
        res = forge.sync_pull(self.vault, self.transport,
                              providers=self.providers, today=TODAY)
        # 3 issues (PR #45 dropped from issues), 1 merged-PR evidence (#50).
        self.assertEqual(len(res["candidates"]), 3)
        self.assertEqual(len(res["evidence"]), 1)
        # the evidence candidate is a suggested-state, NOT a state (never closes).
        ev = res["evidence"][0]
        self.assertEqual(ev["suggested_state"], currency.STATE_DONE)
        self.assertEqual(ev["evidence"], "github:pr/50")
        ev_fm = parse_frontmatter(ev["text"])
        self.assertNotIn("state", ev_fm)
        self.assertEqual(ev_fm["suggested-state"], currency.STATE_DONE)
        # dry-run wrote NOTHING.
        self.assertEqual(res["written"], [])
        self.assertFalse(self._sync_dir().exists())

    def test_apply_writes_issue_and_evidence_candidates_lf(self):
        os.environ["GITHUB_TOKEN"] = "ghp_T"
        res = forge.sync_pull(self.vault, self.transport,
                              providers=self.providers, apply=True, today=TODAY)
        # 3 issues + 1 evidence = 4 files written, all LF, all frontmatter.
        self.assertEqual(len(res["written"]), 4)
        d = self._sync_dir()
        self.assertTrue(d.exists())
        names = sorted(p.name for p in d.iterdir())
        # the evidence file is named pr-<n>.
        self.assertIn(f"{TODAY}-pr-50.md", names)
        for p in d.iterdir():
            raw = p.read_bytes()
            self.assertNotIn(b"\r", raw)
            self.assertTrue(raw.startswith(b"---"))

    def test_missing_token_is_reported_not_crash_no_network(self):
        # no GITHUB_TOKEN -> a per-project error, nothing pulled, no transport call.
        res = forge.sync_pull(self.vault, self.transport,
                              providers=self.providers, today=TODAY)
        self.assertEqual(res["candidates"], [])
        self.assertEqual(res["evidence"], [])
        self.assertTrue(res["errors"])
        self.assertEqual(self.transport.calls, [])

    def test_token_never_leaks_into_result(self):
        os.environ["GITHUB_TOKEN"] = "ghp_SECRET"
        res = forge.sync_pull(self.vault, self.transport,
                              providers=self.providers, apply=True, today=TODAY)
        blob = json.dumps(res, default=str)
        self.assertNotIn("ghp_SECRET", blob)

    def test_per_project_error_does_not_abort_other_projects(self):
        # two GitHub projects: one 500s, the other succeeds -> the good one still
        # yields candidates and the bad one is recorded in errors.
        _write_forge_config(self.vault, {"projects": {
            "project/good": {"forge": {"provider": "github",
                                       "repo": "2233admin/vault-mind"}},
            "project/bad": {"forge": {"provider": "github",
                                      "repo": "2233admin/broken"}},
        }})
        bad_url = ("https://api.github.com/repos/2233admin/broken/"
                   "issues?state=all&per_page=100&page=1")
        self.transport.responses[("GET", bad_url)] = {
            "status": 500, "headers": {}, "body": b'{"message":"boom"}'}
        os.environ["GITHUB_TOKEN"] = "ghp_T"
        res = forge.sync_pull(self.vault, self.transport,
                              providers=self.providers, today=TODAY)
        self.assertTrue(res["candidates"])  # the good project pulled.
        self.assertTrue(any("500" in e["error"] for e in res["errors"]))


class DetectSyncConflictTest(unittest.TestCase):
    """detect_sync_conflict: remote+local both diverged -> conflict; remote-only
    change -> no conflict; the conflict candidate lands in _triage Conflicts."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9f-conflict-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _remote(self, *, object_id="43", revision, state):
        return forge.RemoteItem(
            kind="issue", object_id=object_id, revision=revision, actor="xue",
            title="Bug in parser", state=state,
            entity_hint="project/web/issue/parser")

    def test_no_local_head_is_not_a_conflict(self):
        is_c, info = forge.detect_sync_conflict(
            None, self._remote(revision="r2", state="closed"))
        self.assertFalse(is_c)
        self.assertIsNone(info)

    def test_remote_only_change_is_not_a_conflict(self):
        # local head synced at revision r1 with state DONE; remote moved to r2 but
        # still maps to DONE (closed) -> only the remote metadata changed -> benign.
        snap = {"entity": "project/web/issue/parser", "state": currency.STATE_DONE,
                "fields": {"origin": {"provider": "gitea", "object-id": "43",
                                      "revision": "r1"}}}
        is_c, info = forge.detect_sync_conflict(
            snap, self._remote(revision="r2", state="closed"))
        self.assertFalse(is_c)

    def test_both_diverged_is_a_conflict(self):
        # local head synced at r1, local state is now IN_PROGRESS (a local promote
        # changed it); remote moved to r2 AND now says closed -> DONE. The two
        # disagree on state AND both moved -> CONFLICT.
        snap = {"entity": "project/web/issue/parser",
                "state": currency.STATE_IN_PROGRESS,
                "fields": {"origin": {"provider": "gitea", "object-id": "43",
                                      "revision": "r1"}}}
        is_c, info = forge.detect_sync_conflict(
            snap, self._remote(revision="r2", state="closed"))
        self.assertTrue(is_c)
        self.assertEqual(info["local_revision"], "r1")
        self.assertEqual(info["remote_revision"], "r2")

    def test_different_object_id_is_not_a_conflict(self):
        # the local head's origin points at a DIFFERENT remote object -> not the
        # same synced pair -> never a conflict (a fresh candidate instead).
        snap = {"entity": "project/web/issue/parser",
                "state": currency.STATE_IN_PROGRESS,
                "fields": {"origin": {"provider": "gitea", "object-id": "999",
                                      "revision": "r1"}}}
        is_c, info = forge.detect_sync_conflict(
            snap, self._remote(object_id="43", revision="r2", state="closed"))
        self.assertFalse(is_c)

    def test_provider_mismatch_with_matching_object_id_is_not_a_conflict(self):
        # the local head was synced from GITHUB#43; the same id is pulled from a
        # GITEA binding. Same object-id, DIFFERENT provider -> not the same synced
        # pair -> no conflict (object-id-only collision must not mis-pair forges).
        snap = {"entity": "project/web/issue/parser",
                "state": currency.STATE_IN_PROGRESS,
                "fields": {"origin": {"provider": "github", "object-id": "43",
                                      "revision": "r1"}}}
        is_c, info = forge.detect_sync_conflict(
            snap, self._remote(object_id="43", revision="r2", state="closed"),
            remote_provider="gitea")
        self.assertFalse(is_c)
        self.assertIsNone(info)
        # without the provider hint, the legacy object-id-only path still flags it
        # (over-flag -> triage, the safe direction) -- the hint is the tightening.
        is_c2, _ = forge.detect_sync_conflict(
            snap, self._remote(object_id="43", revision="r2", state="closed"))
        self.assertTrue(is_c2)

    def test_conflict_candidate_is_flagged_and_lands_in_triage_conflicts(self):
        # a reviewed head at r1 (in-progress) + a sync-pulled conflict candidate
        # (remote r2 closed) -> classify_triage routes it to Conflicts, still draft.
        _write_reviewed_head(
            self.vault, "Projects/parser.reviewed.md",
            entity="project/web/issue/parser", state="in-progress",
            provider="gitea", object_id="43", revision="r1")
        local_snap = forge._reviewed_head_snapshot(
            str(self.vault), "project/web/issue/parser")
        item = self._remote(revision="r2", state="closed")
        is_c, info = forge.detect_sync_conflict(local_snap, item)
        self.assertTrue(is_c)
        cand = forge.remote_item_to_candidate(
            item, str(self.vault), "gitea",
            base_head_resolver=lambda e: "Projects/parser.reviewed.md",
            today=TODAY, conflict=info)
        fm = parse_frontmatter(cand["text"])
        self.assertEqual(fm["conflict"], "true")
        self.assertEqual(fm["status"], "draft")  # still a proposal, never overwrite.
        inbox = self.vault / "00-Inbox" / "AI-Output" / "sync-gitea"
        inbox.mkdir(parents=True)
        (inbox / f"{TODAY}-43.md").write_bytes(cand["text"].encode("utf-8"))

        items = work_protocol.classify_triage(str(self.vault), today=TODAY)
        match = [it for it in items
                 if it.entity == "project/web/issue/parser"]
        self.assertTrue(match)
        self.assertEqual(match[0].section, work_protocol.TRIAGE_CONFLICTS)
        self.assertIn("sync conflict", match[0].reason)

    def test_remote_only_change_is_pending_review_not_conflict(self):
        # local head at r1 DONE, remote moved to r2 but still DONE -> a NORMAL
        # Pending-Review candidate (no conflict flag, not in Conflicts).
        _write_reviewed_head(
            self.vault, "Projects/parser.reviewed.md",
            entity="project/web/issue/parser", state="done",
            provider="gitea", object_id="43", revision="r1")
        local_snap = forge._reviewed_head_snapshot(
            str(self.vault), "project/web/issue/parser")
        item = self._remote(revision="r2", state="closed")
        is_c, info = forge.detect_sync_conflict(local_snap, item)
        self.assertFalse(is_c)
        cand = forge.remote_item_to_candidate(
            item, str(self.vault), "gitea",
            base_head_resolver=lambda e: "Projects/parser.reviewed.md",
            today=TODAY, conflict=info if is_c else None)
        fm = parse_frontmatter(cand["text"])
        self.assertNotIn("conflict", fm)


class CreateMutationReceiptDriftTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-create-receipt-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        self.entity = "project/web/issue/new"
        self.binding = {"provider": "github", "repo": "org/web"}
        _write_forge_config(self.vault, {
            "projects": {self.entity: {"forge": self.binding}},
        })
        self.note = _write_new_reviewed_head(self.vault)
        self._saved = os.environ.pop("GITHUB_TOKEN", None)
        os.environ["GITHUB_TOKEN"] = "receipt-secret"

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("GITHUB_TOKEN", None)
        else:
            os.environ["GITHUB_TOKEN"] = self._saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    @staticmethod
    def _response():
        return {
            "status": 201,
            "headers": {},
            "body": json.dumps({
                "number": 99,
                "updated_at": "2026-07-16T05:00:00Z",
            }).encode("utf-8"),
        }

    def _apply(self, transport, *, adapter=None, settings_service=None):
        return forge.sync_apply(
            self.vault,
            transport,
            providers={"github": adapter or forge.GitHubAdapter()},
            apply=True,
            today=TODAY,
            settings_service=settings_service,
        )

    @staticmethod
    def _push(result):
        return result["projects"][0]["pushed"][0]

    def test_reviewed_head_drift_after_success_fails_closed(self):
        url = "https://api.github.com/repos/org/web/issues"
        transport = FakeTransport({("POST", url): self._response()})
        self.assertTrue(self._push(self._apply(transport))["pushed"])
        _write_new_reviewed_head(self.vault, title="Changed after create")

        replay = self._apply(transport)

        self.assertEqual([call[0] for call in transport.calls], ["POST"])
        self.assertEqual(
            self._push(replay)["configurationReason"],
            "mutation-receipt-reviewed-head-drift-detected",
        )

    def test_binding_drift_after_success_fails_closed(self):
        url = "https://api.github.com/repos/org/web/issues"
        transport = FakeTransport({("POST", url): self._response()})
        self.assertTrue(self._push(self._apply(transport))["pushed"])
        _write_forge_config(self.vault, {
            "projects": {self.entity: {"forge": {
                "provider": "github", "repo": "org/other",
            }}},
        })

        replay = self._apply(transport)

        self.assertEqual([call[0] for call in transport.calls], ["POST"])
        self.assertEqual(
            self._push(replay)["configurationReason"],
            "mutation-receipt-binding-drift-detected",
        )

    def test_settings_drift_after_success_fails_closed(self):
        service = _configured_forge_settings(
            self.vault,
            {"FORGE_SETTINGS_TOKEN": "receipt-settings-secret"},
            endpoint="https://settings.example",
            provider="github",
        )
        url = "https://settings.example/repos/org/web/issues"
        transport = FakeTransport({("POST", url): self._response()})
        self.assertTrue(self._push(self._apply(
            transport, settings_service=service))["pushed"])
        updated = service.assignment_set(
            scope="user-device",
            key="providers.project_tracker.timeout_ms",
            value=5432,
            expected_revision=4,
            updated_by="pytest",
        )
        self.assertEqual(updated["status"], "committed")

        replay = self._apply(transport, settings_service=service)

        self.assertEqual([call[0] for call in transport.calls], ["POST"])
        self.assertEqual(
            self._push(replay)["configurationReason"],
            "mutation-receipt-settings-drift-detected",
        )

    def test_create_plan_semantic_drift_after_success_fails_closed(self):
        url = "https://api.github.com/repos/org/web/issues"
        transport = FakeTransport({("POST", url): self._response()})
        self.assertTrue(self._push(self._apply(transport))["pushed"])

        class ChangedPlanAdapter(forge.GitHubAdapter):
            def push_plan(self, snapshot, repo_cfg):
                plan = super().push_plan(snapshot, repo_cfg)
                plan["payload"]["body"] += "\nChanged provider semantics."
                return plan

        replay = self._apply(transport, adapter=ChangedPlanAdapter())

        self.assertEqual([call[0] for call in transport.calls], ["POST"])
        self.assertEqual(
            self._push(replay)["configurationReason"],
            "mutation-receipt-semantic-drift-detected",
        )

    def test_unknown_create_response_leaves_pending_receipt_and_never_reposts(self):
        url = "https://api.github.com/repos/org/web/issues"
        transport = FakeTransport({
            ("POST", url): {"status": 201, "headers": {}, "body": b"{}"},
        })

        first = self._apply(transport)
        replay = self._apply(transport)

        self.assertEqual([call[0] for call in transport.calls], ["POST"])
        self.assertIn("error", self._push(first))
        self.assertEqual(
            self._push(replay)["configurationReason"],
            "mutation-receipt-outcome-unknown",
        )

    def test_receipt_slot_is_path_safe_and_atomic_claim_has_one_writer(self):
        project_entity = "project/web/issue/../../cannot-escape"
        snapshot = {
            "entity": project_entity,
            "state": currency.STATE_TODO,
            "title": "Concurrent create",
        }
        plan = forge.GitHubAdapter().push_plan(snapshot, self.binding)
        runtime = forge.ForgeProviderRuntime(
            binding=dict(self.binding),
            token="receipt-secret",
            credential_available=True,
            timeout_ms=10000,
        )
        planned = forge.ForgePlannedTargetRuntime(
            runtime=runtime,
            original_binding=dict(self.binding),
            reviewed_snapshot_digest=settings_platform.canonical_digest(snapshot),
        )
        receipt_path = forge._create_receipt_path(
            self.vault, project_entity, "forge")
        receipt_root = (
            self.vault / "01-Projects" / "web" / "projection-receipts"
        ).resolve()
        self.assertIsNotNone(receipt_path)
        self.assertEqual(receipt_path.resolve().parent, receipt_root)

        barrier = threading.Barrier(2)
        decisions = []

        def claim():
            barrier.wait()
            decisions.append(forge._create_receipt_decision(
                self.vault,
                project_entity,
                "forge",
                "github",
                plan,
                planned,
                claim=True,
            ))

        threads = [threading.Thread(target=claim) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(
            sum(item["action"] == "execute" for item in decisions), 1)
        self.assertEqual(
            sum(item["action"] == "refuse" for item in decisions), 1)
        self.assertEqual(json.loads(receipt_path.read_text("utf-8"))["status"],
                         "pending")


class SyncApplyExecuteTest(unittest.TestCase):
    """sync_apply EXECUTES the push: PATCH for an origin-bearing reviewed head (no
    duplicate POST), POST for a new one, GraphQL issueUpdate for Linear; a
    conflicted entity is skipped; an anti-loop project is excluded; the token never
    appears in any recorded call."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9f-apply-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        self._saved = {k: os.environ.pop(k, None)
                       for k in ("GITEA_TOKEN", "GITHUB_TOKEN", "LINEAR_TOKEN")}

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_origin_bearing_head_executes_patch_no_duplicate_post(self):
        # a reviewed head with a github origin -> sync_apply executes a PATCH (an
        # UPDATE of the same issue), never a POST (no duplicate).
        _write_forge_config(self.vault, {"projects": {
            "project/web/issue/parser": {
                "forge": {"provider": "github", "repo": "org/web"}}}})
        _write_reviewed_head(
            self.vault, "Projects/parser.reviewed.md",
            entity="project/web/issue/parser", state="done",
            provider="github", object_id="43", revision="r1")
        transport = FakeTransport({
            ("PATCH", "https://api.github.com/repos/org/web/issues/43"):
                {"status": 200, "headers": {}, "body": b'{"number":43}'},
        })
        os.environ["GITHUB_TOKEN"] = "ghp_SECRET"
        out = forge.sync_apply(self.vault, transport,
                               providers={"github": forge.GitHubAdapter()},
                               apply=True, today=TODAY)
        proj = {p["entity"]: p for p in out["projects"]}[
            "project/web/issue/parser"]
        push = proj["pushed"][0]
        self.assertTrue(push["pushed"])
        self.assertEqual(push["executed"]["method"], "PATCH")
        self.assertEqual(push["executed"]["object_id"], "43")
        # exactly ONE write call, a PATCH (no duplicate POST create).
        methods = [c[0] for c in transport.calls]
        self.assertEqual(methods, ["PATCH"])
        # the token rode in the header only, never the URL / recorded url.
        for method, url, headers, body in transport.calls:
            self.assertNotIn("ghp_SECRET", url)
        self.assertNotIn("ghp_SECRET", json.dumps(out, default=str))

    def test_new_head_executes_post_create(self):
        # a reviewed head with NO origin -> sync_apply executes a POST (create).
        _write_forge_config(self.vault, {"projects": {
            "project/web/issue/new": {
                "forge": {"provider": "github", "repo": "org/web"}}}})
        p = self.vault / "Projects" / "new.reviewed.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes((
            "---\n"
            "type: issue\n"
            "entity: project/web/issue/new\n"
            "state: in-progress\n"
            "status: reviewed\n"
            "title: Brand new\n"
            "last-verified: 2026-06-20\n"
            "---\n\nNew work.\n"
        ).encode("utf-8"))
        transport = FakeTransport({
            ("POST", "https://api.github.com/repos/org/web/issues"):
                {"status": 201, "headers": {}, "body": json.dumps({
                    "number": 99,
                    "updated_at": "2026-06-25T12:00:00Z",
                }).encode("utf-8")},
        })
        os.environ["GITHUB_TOKEN"] = "ghp_T"
        out = forge.sync_apply(self.vault, transport,
                               providers={"github": forge.GitHubAdapter()},
                               apply=True, today=TODAY)
        replayed = forge.sync_apply(self.vault, transport,
                                    providers={"github": forge.GitHubAdapter()},
                                    apply=True, today=TODAY)
        proj = {p2["entity"]: p2 for p2 in out["projects"]}[
            "project/web/issue/new"]
        push = proj["pushed"][0]
        self.assertTrue(push["pushed"])
        self.assertEqual(push["executed"]["method"], "POST")
        self.assertEqual(push["executed"]["object_id"], "99")
        self.assertEqual(
            push["executed"]["revision"], "2026-06-25T12:00:00Z")
        self.assertEqual([c[0] for c in transport.calls], ["POST"])
        replay_push = {p2["entity"]: p2 for p2 in replayed["projects"]}[
            "project/web/issue/new"]["pushed"][0]
        self.assertTrue(replay_push["pushed"])
        self.assertTrue(replay_push["executed"]["idempotentReplay"])
        self.assertFalse(replay_push["executed"]["networkMutation"])
        self.assertEqual(replay_push["executed"]["object_id"], "99")
        receipts = list((
            self.vault / "01-Projects" / "web" / "projection-receipts"
        ).glob("*.json"))
        self.assertEqual(len(receipts), 1)
        receipt_bytes = receipts[0].read_bytes()
        receipt = json.loads(receipt_bytes.decode("utf-8"))
        self.assertEqual(
            receipt_bytes,
            (settings_platform.canonical_json(receipt) + "\n").encode("utf-8"),
        )
        self.assertEqual(receipt["status"], "succeeded")
        self.assertEqual(receipt["remoteObjectId"], "99")
        self.assertEqual(
            receipt["remoteRevision"], "2026-06-25T12:00:00Z")
        self.assertNotIn("ghp_T", receipt_bytes.decode("utf-8"))

    def test_linear_executes_graphql_issue_update(self):
        # a reviewed head with a linear origin -> sync_apply POSTs a GraphQL
        # issueUpdate mutation to the Linear endpoint (no duplicate create).
        _write_forge_config(self.vault, {"projects": {
            "project/web/issue/parser": {
                "forge": {"provider": "linear", "team_id": "team-uuid",
                          "state_type_ids": {"completed": "st-done"}}}}})
        _write_reviewed_head(
            self.vault, "Projects/parser.reviewed.md",
            entity="project/web/issue/parser", state="done",
            provider="linear", object_id="lin-uuid-43", revision="r1")
        transport = FakeTransport({
            ("POST", forge.LINEAR_API_URL):
                {"status": 200, "headers": {},
                 "body": json.dumps({"data": {"issueUpdate": {
                     "success": True, "issue": {"id": "lin-uuid-43"}}}}
                 ).encode("utf-8")},
        })
        os.environ["LINEAR_TOKEN"] = "lin_SECRET"
        out = forge.sync_apply(self.vault, transport,
                               providers={"linear": forge.LinearAdapter()},
                               apply=True, today=TODAY)
        proj = {p["entity"]: p for p in out["projects"]}[
            "project/web/issue/parser"]
        push = proj["pushed"][0]
        self.assertTrue(push["pushed"])
        self.assertEqual(push["executed"]["mutation"], "issueUpdate")
        # the GraphQL POST body carried the issueUpdate mutation + the id.
        post = [c for c in transport.calls if c[0] == "POST"][0]
        body = post[3].decode("utf-8")
        self.assertIn("issueUpdate", body)
        self.assertIn("lin-uuid-43", body)
        # Linear uses the RAW token in the header (no Bearer); never in any URL.
        self.assertEqual(post[2].get("Authorization"), "lin_SECRET")
        self.assertNotIn("lin_SECRET", post[1])
        self.assertNotIn("lin_SECRET", json.dumps(out, default=str))

    def test_conflicted_entity_is_skipped_not_pushed(self):
        # a reviewed head + an unconsumed CONFLICT-flagged candidate for the same
        # entity -> sync_apply SKIPS the push (a known conflict must be reconciled
        # via triage/promote first, never blindly overwritten).
        _write_forge_config(self.vault, {"projects": {
            "project/web/issue/parser": {
                "forge": {"provider": "github", "repo": "org/web"}}}})
        _write_reviewed_head(
            self.vault, "Projects/parser.reviewed.md",
            entity="project/web/issue/parser", state="in-progress",
            provider="github", object_id="43", revision="r1")
        inbox = self.vault / "00-Inbox" / "AI-Output" / "sync-github"
        inbox.mkdir(parents=True)
        item = forge.RemoteItem(
            kind="issue", object_id="43", revision="r2", actor="xue",
            title="Bug in parser", state="closed",
            entity_hint="project/web/issue/parser")
        cand = forge.remote_item_to_candidate(
            item, str(self.vault), "github",
            base_head_resolver=lambda e: "Projects/parser.reviewed.md",
            today=TODAY,
            conflict={"local_revision": "r1", "remote_revision": "r2",
                      "reason": "diverged"})
        (inbox / f"{TODAY}-43.md").write_bytes(cand["text"].encode("utf-8"))

        transport = FakeTransport()
        os.environ["GITHUB_TOKEN"] = "ghp_T"
        out = forge.sync_apply(self.vault, transport,
                               providers={"github": forge.GitHubAdapter()},
                               apply=True, today=TODAY)
        proj = {p["entity"]: p for p in out["projects"]}[
            "project/web/issue/parser"]
        self.assertIn("skipped", proj)
        self.assertEqual(proj["pushed"], [])
        self.assertTrue(out["skipped"])
        # CRITICAL: nothing was pushed for the conflicted entity.
        self.assertEqual(transport.calls, [])

    def test_project_level_config_key_is_gated_by_descendant_issue_conflict(self):
        # forge.json is keyed at the PROJECT level (project/web), but the conflict
        # candidate is per-ISSUE (project/web/issue/parser, a DESCENDANT). The
        # conflict gate must still SKIP the push (prefix-aware) -- a known conflict
        # under the project is never blindly overwritten outward (9F#3).
        _write_forge_config(self.vault, {"projects": {
            "project/web": {
                "forge": {"provider": "github", "repo": "org/web"}}}})
        # a reviewed head for the PROJECT-LEVEL entity (what sync_plan would push).
        _write_reviewed_head(
            self.vault, "Projects/web.reviewed.md",
            entity="project/web", state="in-progress",
            provider="github", object_id="7", revision="r1")
        # a per-ISSUE conflict candidate UNDER that project.
        inbox = self.vault / "00-Inbox" / "AI-Output" / "sync-github"
        inbox.mkdir(parents=True)
        # the issue's own reviewed head so the candidate is a genuine conflict.
        _write_reviewed_head(
            self.vault, "Projects/parser.reviewed.md",
            entity="project/web/issue/parser", state="in-progress",
            provider="github", object_id="43", revision="r1")
        item = forge.RemoteItem(
            kind="issue", object_id="43", revision="r2", actor="xue",
            title="Bug in parser", state="closed",
            entity_hint="project/web/issue/parser")
        cand = forge.remote_item_to_candidate(
            item, str(self.vault), "github",
            base_head_resolver=lambda e: "Projects/parser.reviewed.md",
            today=TODAY,
            conflict={"local_revision": "r1", "remote_revision": "r2",
                      "reason": "diverged"})
        (inbox / f"{TODAY}-43.md").write_bytes(cand["text"].encode("utf-8"))

        transport = FakeTransport()
        os.environ["GITHUB_TOKEN"] = "ghp_T"
        out = forge.sync_apply(self.vault, transport,
                               providers={"github": forge.GitHubAdapter()},
                               apply=True, today=TODAY)
        proj = {p["entity"]: p for p in out["projects"]}["project/web"]
        self.assertIn("skipped", proj)
        self.assertEqual(proj["pushed"], [])
        # CRITICAL: nothing pushed for the project whose descendant issue conflicts.
        self.assertEqual(transport.calls, [])

    def test_anti_loop_project_is_refused_not_pushed(self):
        # a project with a writable mirror (2nd bidirectional path) -> refused.
        _write_forge_config(self.vault, {"projects": {
            "project/loopy": {
                "forge": {"provider": "github", "repo": "org/loopy"},
                "mirrors": [{"provider": "gitea"}],  # writable mirror -> loop
            }}})
        transport = FakeTransport()
        os.environ["GITHUB_TOKEN"] = "ghp_T"
        out = forge.sync_apply(self.vault, transport,
                               providers={"github": forge.GitHubAdapter()},
                               apply=True, today=TODAY)
        self.assertTrue(out["conflicts"])
        loopy = {p["entity"]: p for p in out["projects"]}["project/loopy"]
        self.assertIn("refused", loopy)
        self.assertEqual(loopy["pushed"], [])
        self.assertEqual(transport.calls, [])  # never pushed a loop-risk project.

    def test_dry_run_executes_no_push(self):
        _write_forge_config(self.vault, {"projects": {
            "project/web/issue/parser": {
                "forge": {"provider": "github", "repo": "org/web"}}}})
        _write_reviewed_head(
            self.vault, "Projects/parser.reviewed.md",
            entity="project/web/issue/parser", state="done",
            provider="github", object_id="43", revision="r1")
        transport = FakeTransport()
        os.environ["GITHUB_TOKEN"] = "ghp_T"
        out = forge.sync_apply(self.vault, transport,
                               providers={"github": forge.GitHubAdapter()},
                               apply=False, today=TODAY)
        proj = {p["entity"]: p for p in out["projects"]}[
            "project/web/issue/parser"]
        for push in proj["pushed"]:
            self.assertFalse(push["pushed"])  # dry-run -> planned, never executed.
        self.assertEqual(transport.calls, [])


class SyncPlanReviewedNotDraftTest(unittest.TestCase):
    """sync_plan reads the REVIEWED current-truth head, never a competing draft."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9f-plan-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        _write_forge_config(self.vault, {"projects": {
            "project/web/issue/login": {
                "forge": {"provider": "github", "repo": "org/web"}}}})
        _write_reviewed_head(
            self.vault, "Projects/login.reviewed.md",
            entity="project/web/issue/login", state="in-progress",
            provider="github", object_id="7", revision="r1")
        # a competing DRAFT (state done) that must NEVER be the pushed snapshot.
        inbox = self.vault / "00-Inbox" / "AI-Output" / "sync-github"
        inbox.mkdir(parents=True)
        (inbox / f"{TODAY}-7.md").write_bytes((
            "---\n"
            "type: issue\n"
            "entity: project/web/issue/login\n"
            "state: done\n"
            "status: draft\n"
            "base-head: Projects/login.reviewed.md\n"
            "last-verified: 2026-06-25\n"
            "---\n\nDraft done.\n"
        ).encode("utf-8"))
        self.transport = FakeTransport()
        self.providers = {"github": forge.GitHubAdapter()}

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_plan_uses_reviewed_head_not_draft(self):
        plan = forge.sync_plan(self.vault, self.transport,
                               providers=self.providers)
        entry = {p["entity"]: p for p in plan["projects"]}[
            "project/web/issue/login"]
        self.assertEqual(entry["snapshot"]["state"], currency.STATE_IN_PROGRESS)
        self.assertEqual(entry["snapshot"]["status"], "reviewed")
        # the payload PATCHes the same issue (origin object-id 7), state open
        # (in-progress is active), never the draft's done/closed.
        payload = entry["payloads"][0]["payload"]
        self.assertEqual(payload["method"], "PATCH")
        self.assertEqual(payload["object_id"], "7")
        self.assertEqual(payload["payload"]["state"], "open")


class SyncCliInjectionTest(unittest.TestCase):
    """The kb_meta sync-* CLI cmds accept an INJECTED transport + providers so a
    test drives them with FakeTransport/FakeProvider and never hits a live API."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9f-cli-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        _write_forge_config(self.vault, {"projects": {
            "project/vault-mind": {
                "forge": {"provider": "github", "repo": "2233admin/vault-mind"}}}})
        issues_url = ("https://api.github.com/repos/2233admin/vault-mind/"
                      "issues?state=all&per_page=100&page=1")
        pulls_url = ("https://api.github.com/repos/2233admin/vault-mind/"
                     "pulls?state=all&per_page=100&page=1")
        self.transport = FakeTransport({
            ("GET", issues_url): {"status": 200, "headers": {},
                "body": json.dumps(_GITHUB_ISSUES_JSON).encode("utf-8")},
            ("GET", pulls_url): {"status": 200, "headers": {},
                "body": json.dumps(_GITHUB_PULLS_JSON).encode("utf-8")},
        })
        self.providers = {"github": forge.GitHubAdapter()}
        self._saved = os.environ.pop("GITHUB_TOKEN", None)
        import kb_meta as _kb_meta
        self.kb = _kb_meta

    def tearDown(self):
        if self._saved is None:
            os.environ.pop("GITHUB_TOKEN", None)
        else:
            os.environ["GITHUB_TOKEN"] = self._saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_cmd_sync_pull_injected_transport(self):
        os.environ["GITHUB_TOKEN"] = "ghp_T"
        res = self.kb.cmd_sync_pull(str(self.vault), apply=False, today=TODAY,
                                    transport=self.transport,
                                    providers=self.providers)
        self.assertEqual(len(res["candidates"]), 3)
        self.assertEqual(len(res["evidence"]), 1)

    def test_cmd_sync_pull_provider_filter(self):
        # --provider linear filters to a provider with NO bound project -> nothing.
        os.environ["GITHUB_TOKEN"] = "ghp_T"
        res = self.kb.cmd_sync_pull(str(self.vault), provider="linear",
                                    today=TODAY, transport=self.transport,
                                    providers=self.providers)
        self.assertEqual(res["candidates"], [])
        self.assertEqual(self.transport.calls, [])

    def test_parse_sync_args(self):
        p = self.kb._parse_sync_pull_args(
            ["sync-pull", "/v", "--provider", "github", "--apply",
             "--today", "2026-06-25"])
        self.assertEqual(p, {"vault": "/v", "provider": "github",
                             "apply": True, "today": "2026-06-25"})
        self.assertEqual(
            self.kb._parse_sync_plan_args(["sync-plan", "/v"]),
            {"vault": "/v", "today": None})
        self.assertEqual(
            self.kb._parse_sync_apply_args(["sync-apply", "/v", "--apply"]),
            {"vault": "/v", "apply": True, "today": None})


if __name__ == "__main__":
    unittest.main()
