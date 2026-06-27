"""Task 9 / PR: ENSURE-PLUGIN tests (zero-dep, unittest). NO NETWORK EVER.

Covers compiler/plugins.py + its kb_meta CLI wiring. The download seam is the
ONLY thing that would touch GitHub, and it is injected exactly like forge.py's
FakeTransport: a FakeTransport(forge.Transport) records (method,url) and returns
canned {status,headers,body} for the GitHub-release asset URLs, AND a simpler
FakeDownloader {filename -> bytes|None} passed as downloader= to ensure_plugin /
cmd_ensure_plugin. A test seeds the three asset bodies and asserts the files
written match; the transport's .calls list proves urllib was never reached.

    PYTHONUTF8=1 python -m unittest tests.test_plugins -v
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

_COMPILER = Path(__file__).resolve().parents[1]
if str(_COMPILER) not in sys.path:
    sys.path.insert(0, str(_COMPILER))

import forge  # noqa: E402
import plugins  # noqa: E402
import kb_meta  # noqa: E402

TODAY = "2026-06-27"
DEFAULT_PLUGIN = "obsidian-kanban"
DEFAULT_REPO = "mgmeyers/obsidian-kanban"


# --- a NETWORK-FREE transport mirroring forge.FakeTransport -----------------

class FakeTransport(forge.Transport):
    """Records (method, url) and returns a canned response -- NEVER touches the
    network. A test seeds responses[(method, url)] = {status, headers, body}.
    An unseeded URL returns 404 so a 'missing asset' is the safe default (an
    accidental urllib hit is impossible)."""

    def __init__(self, responses=None):
        self.responses = responses or {}
        self.calls = []  # [(method, url, headers, body), ...]

    def request(self, method, url, headers=None, body=None):
        self.calls.append((method, url, dict(headers or {}), body))
        key = (method.upper(), url)
        if key in self.responses:
            return self.responses[key]
        return {"status": 404, "headers": {}, "body": b""}


class FakeDownloader:
    """A callable {filename -> bytes|None} -- the simplest download seam. None
    models a 404 (asset absent). Records every requested filename so a test can
    assert exactly which assets were fetched (and that none were on dry-run)."""

    def __init__(self, assets):
        self.assets = dict(assets)
        self.calls = []  # [filename, ...]

    def __call__(self, filename):
        self.calls.append(filename)
        return self.assets.get(filename)


def _gh_url(repo, filename):
    return f"https://github.com/{repo}/releases/latest/download/{filename}"


def _full_assets():
    return {
        "main.js": b"// kanban main\n",
        "manifest.json": b'{"id":"obsidian-kanban","version":"1.0.0"}\n',
        "styles.css": b".kanban{}\n",
    }


class _VaultCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-plugins-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    # helpers -----------------------------------------------------------------
    def _plugins_root(self):
        return self.vault / ".obsidian" / "plugins"

    def _cp_path(self):
        return self.vault / ".obsidian" / "community-plugins.json"

    def _write_cp(self, raw_bytes):
        p = self._cp_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(raw_bytes)
        return p

    def _seed_installed(self, plugin_id, with_styles=False, main=b"old\n",
                        manifest=b'{"id":"x"}\n'):
        d = self._plugins_root() / plugin_id
        d.mkdir(parents=True, exist_ok=True)
        (d / "main.js").write_bytes(main)
        (d / "manifest.json").write_bytes(manifest)
        if with_styles:
            (d / "styles.css").write_bytes(b".x{}\n")
        return d

    def _disk_snapshot(self):
        """Sorted list of (relpath, bytes) for every file under the vault, so a
        dry-run can assert the disk is byte-for-byte untouched."""
        out = []
        for p in sorted(self.vault.rglob("*")):
            if p.is_file():
                out.append((p.relative_to(self.vault).as_posix(), p.read_bytes()))
        return out


# === pure path helpers ======================================================

class PathHelpersTest(_VaultCase):
    def test_plugin_dir(self):
        d = plugins.plugin_dir(str(self.vault), "obsidian-kanban")
        self.assertEqual(
            Path(d).as_posix(),
            (self.vault / ".obsidian" / "plugins" / "obsidian-kanban").as_posix())
        # pure join: does NOT create anything.
        self.assertFalse(Path(d).exists())

    def test_community_plugins_path(self):
        p = plugins.community_plugins_path(str(self.vault))
        self.assertEqual(
            Path(p).as_posix(),
            (self.vault / ".obsidian" / "community-plugins.json").as_posix())


# === validate_plugin_id (the security gate) =================================

class ValidateIdTest(unittest.TestCase):
    def test_accepts_normal_ids(self):
        for good in ("obsidian-kanban", "dataview", "a_b", "plug.in", "x1",
                     "ABC-123", "obsidian.excalidraw"):
            self.assertEqual(plugins.validate_plugin_id(good), good)

    def test_rejects_separators(self):
        for bad in ("foo/bar", "a\\b", "../evil", "..\\evil", "x/../y"):
            with self.assertRaises(plugins.UnsafePluginId):
                plugins.validate_plugin_id(bad)

    def test_rejects_dot_traversal(self):
        for bad in (".", "..", "...", "./x"):
            with self.assertRaises(plugins.UnsafePluginId):
                plugins.validate_plugin_id(bad)

    def test_rejects_leading_dot(self):
        for bad in (".hidden", ".obsidian", ".git"):
            with self.assertRaises(plugins.UnsafePluginId):
                plugins.validate_plugin_id(bad)

    def test_rejects_empty_or_blank(self):
        for bad in ("", "   ", "\t"):
            with self.assertRaises(plugins.UnsafePluginId):
                plugins.validate_plugin_id(bad)

    def test_rejects_drive_and_absolute(self):
        for bad in ("c:", "C:", "c:foo", "C:\\x", "/etc", "/etc/passwd"):
            with self.assertRaises(plugins.UnsafePluginId):
                plugins.validate_plugin_id(bad)

    def test_rejects_control_and_nul(self):
        for bad in ("a\x00b", "x\ny", "tab\tname", "bell\x07"):
            with self.assertRaises(plugins.UnsafePluginId):
                plugins.validate_plugin_id(bad)

    def test_rejects_other_bad_chars(self):
        for bad in ("foo bar", "a*b", "a?b", "a:b", "name$", "h@ck", "(x)"):
            with self.assertRaises(plugins.UnsafePluginId):
                plugins.validate_plugin_id(bad)

    def test_carries_offending_id_and_reason(self):
        try:
            plugins.validate_plugin_id("../evil")
        except plugins.UnsafePluginId as e:
            self.assertEqual(e.plugin_id, "../evil")
            self.assertTrue(e.reason)
        else:
            self.fail("expected UnsafePluginId")

    def test_is_value_error_subclass(self):
        self.assertTrue(issubclass(plugins.UnsafePluginId, ValueError))


# === load_enabled / save_enabled ===========================================

class LoadEnabledTest(_VaultCase):
    def test_missing_file(self):
        ids, meta = plugins.load_enabled(str(self.vault))
        self.assertEqual(ids, [])
        self.assertFalse(meta["existed"])

    def test_empty_file_is_empty_array(self):
        self._write_cp(b"")
        ids, meta = plugins.load_enabled(str(self.vault))
        self.assertEqual(ids, [])
        self.assertTrue(meta["existed"])
        self.assertTrue(meta["parse_ok"])

    def test_whitespace_file_is_empty_array(self):
        self._write_cp(b"   \n  \n")
        ids, meta = plugins.load_enabled(str(self.vault))
        self.assertEqual(ids, [])
        self.assertTrue(meta["parse_ok"])

    def test_normal_array(self):
        self._write_cp(b'["dataview","obsidian-kanban"]\n')
        ids, meta = plugins.load_enabled(str(self.vault))
        self.assertEqual(ids, ["dataview", "obsidian-kanban"])
        self.assertTrue(meta["parse_ok"])
        self.assertTrue(meta["trailing_newline"])

    def test_no_trailing_newline_recorded(self):
        self._write_cp(b'["dataview"]')
        ids, meta = plugins.load_enabled(str(self.vault))
        self.assertEqual(ids, ["dataview"])
        self.assertFalse(meta["trailing_newline"])

    def test_malformed_json_tolerated(self):
        self._write_cp(b"{not json")
        ids, meta = plugins.load_enabled(str(self.vault))
        self.assertEqual(ids, [])
        self.assertFalse(meta["parse_ok"])

    def test_non_array_object_tolerated(self):
        self._write_cp(b'{"a":1}')
        ids, meta = plugins.load_enabled(str(self.vault))
        self.assertEqual(ids, [])
        self.assertTrue(meta["not_array"])

    def test_non_array_number_tolerated(self):
        self._write_cp(b"42")
        ids, meta = plugins.load_enabled(str(self.vault))
        self.assertEqual(ids, [])
        self.assertTrue(meta["not_array"])

    def test_bom_stripped(self):
        self._write_cp(b"\xef\xbb\xbf" + b'["dataview"]\n')
        ids, meta = plugins.load_enabled(str(self.vault))
        self.assertEqual(ids, ["dataview"])
        self.assertTrue(meta["had_bom"])

    def test_filters_non_string_and_empty(self):
        self._write_cp(b'["dataview", 1, "", null, "obsidian-kanban"]')
        ids, _ = plugins.load_enabled(str(self.vault))
        self.assertEqual(ids, ["dataview", "obsidian-kanban"])

    def test_dedupes_preserving_first_seen(self):
        self._write_cp(b'["a","b","a","c","b"]')
        ids, _ = plugins.load_enabled(str(self.vault))
        self.assertEqual(ids, ["a", "b", "c"])


class SaveEnabledTest(_VaultCase):
    def test_creates_obsidian_dir_and_file(self):
        _, meta = plugins.load_enabled(str(self.vault))  # missing
        p = plugins.save_enabled(str(self.vault), ["obsidian-kanban"], meta)
        self.assertTrue(Path(p).exists())
        data = json.loads(Path(p).read_text("utf-8"))
        self.assertEqual(data, ["obsidian-kanban"])

    def test_lf_only_bytes(self):
        _, meta = plugins.load_enabled(str(self.vault))
        p = plugins.save_enabled(str(self.vault), ["a", "b"], meta)
        raw = Path(p).read_bytes()
        self.assertNotIn(b"\r", raw)

    def test_missing_file_gets_trailing_newline(self):
        _, meta = plugins.load_enabled(str(self.vault))
        p = plugins.save_enabled(str(self.vault), ["a"], meta)
        self.assertTrue(Path(p).read_bytes().endswith(b"\n"))

    def test_preserves_no_trailing_newline(self):
        self._write_cp(b'["a"]')  # no newline
        _, meta = plugins.load_enabled(str(self.vault))
        p = plugins.save_enabled(str(self.vault), ["a", "b"], meta)
        self.assertFalse(Path(p).read_bytes().endswith(b"\n"))

    def test_never_reemits_bom(self):
        self._write_cp(b"\xef\xbb\xbf" + b'["a"]\n')
        _, meta = plugins.load_enabled(str(self.vault))
        p = plugins.save_enabled(str(self.vault), ["a", "b"], meta)
        raw = Path(p).read_bytes()
        self.assertFalse(raw.startswith(b"\xef\xbb\xbf"))

    def test_indent_two(self):
        _, meta = plugins.load_enabled(str(self.vault))
        p = plugins.save_enabled(str(self.vault), ["a", "b"], meta)
        self.assertIn(b'\n  "a"', Path(p).read_bytes())

    def test_idempotent_no_spurious_write(self):
        self._write_cp(b'[\n  "a",\n  "b"\n]\n')
        ids, meta = plugins.load_enabled(str(self.vault))
        before = self._cp_path().read_bytes()
        plugins.save_enabled(str(self.vault), ids, meta)
        self.assertEqual(self._cp_path().read_bytes(), before)

    def test_dedupes_and_preserves_order(self):
        _, meta = plugins.load_enabled(str(self.vault))
        p = plugins.save_enabled(str(self.vault), ["b", "a", "b", "c"], meta)
        self.assertEqual(json.loads(Path(p).read_text("utf-8")),
                         ["b", "a", "c"])


# === is_installed / is_enabled / plugin_status ==============================

class StatusTest(_VaultCase):
    def test_is_installed_requires_both_files(self):
        self.assertFalse(plugins.is_installed(str(self.vault), DEFAULT_PLUGIN))
        d = self._plugins_root() / DEFAULT_PLUGIN
        d.mkdir(parents=True)
        (d / "main.js").write_bytes(b"x")
        self.assertFalse(plugins.is_installed(str(self.vault), DEFAULT_PLUGIN))
        (d / "manifest.json").write_bytes(b"{}")
        self.assertTrue(plugins.is_installed(str(self.vault), DEFAULT_PLUGIN))

    def test_styles_optional(self):
        self._seed_installed(DEFAULT_PLUGIN, with_styles=False)
        self.assertTrue(plugins.is_installed(str(self.vault), DEFAULT_PLUGIN))

    def test_is_enabled(self):
        self.assertFalse(plugins.is_enabled(str(self.vault), DEFAULT_PLUGIN))
        self._write_cp(b'["obsidian-kanban"]')
        self.assertTrue(plugins.is_enabled(str(self.vault), DEFAULT_PLUGIN))

    def test_status_present(self):
        self._seed_installed(DEFAULT_PLUGIN)
        self._write_cp(b'["obsidian-kanban"]')
        st = plugins.plugin_status(str(self.vault), DEFAULT_PLUGIN)
        self.assertTrue(st["installed"])
        self.assertTrue(st["enabled"])
        self.assertTrue(st["present"])
        self.assertEqual(st["files_missing"], [])
        self.assertFalse(st["id_in_list_but_files_missing"])
        self.assertFalse(st["files_present_but_not_in_list"])

    def test_status_id_in_list_files_missing(self):
        self._write_cp(b'["obsidian-kanban"]')
        st = plugins.plugin_status(str(self.vault), DEFAULT_PLUGIN)
        self.assertFalse(st["installed"])
        self.assertTrue(st["enabled"])
        self.assertTrue(st["id_in_list_but_files_missing"])
        self.assertIn("main.js", st["files_missing"])
        self.assertIn("manifest.json", st["files_missing"])

    def test_status_files_present_not_in_list(self):
        self._seed_installed(DEFAULT_PLUGIN)
        st = plugins.plugin_status(str(self.vault), DEFAULT_PLUGIN)
        self.assertTrue(st["installed"])
        self.assertFalse(st["enabled"])
        self.assertTrue(st["files_present_but_not_in_list"])

    def test_status_is_read_only(self):
        before = self._disk_snapshot()
        plugins.plugin_status(str(self.vault), DEFAULT_PLUGIN)
        self.assertEqual(self._disk_snapshot(), before)

    def test_status_posix_paths(self):
        st = plugins.plugin_status(str(self.vault), DEFAULT_PLUGIN)
        self.assertNotIn("\\", st["plugin_dir"])
        self.assertNotIn("\\", st["community_plugins_path"])


# === default_downloader (the validated source seam) =========================

class DefaultDownloaderTest(unittest.TestCase):
    def test_returns_body_on_200(self):
        t = FakeTransport({
            ("GET", _gh_url(DEFAULT_REPO, "main.js")):
                {"status": 200, "headers": {}, "body": b"BODY"},
        })
        fetch = plugins.default_downloader(DEFAULT_REPO, t)
        self.assertEqual(fetch("main.js"), b"BODY")

    def test_returns_none_on_404(self):
        t = FakeTransport({
            ("GET", _gh_url(DEFAULT_REPO, "styles.css")):
                {"status": 404, "headers": {}, "body": b""},
        })
        fetch = plugins.default_downloader(DEFAULT_REPO, t)
        self.assertIsNone(fetch("styles.css"))

    def test_reraises_transport_error(self):
        class Boom(forge.Transport):
            def request(self, method, url, headers=None, body=None):
                raise forge.TransportError(method, url, 500, "boom")
        fetch = plugins.default_downloader(DEFAULT_REPO, Boom())
        with self.assertRaises(forge.TransportError):
            fetch("main.js")

    def test_only_github_host_validated(self):
        # the downloader must only ever issue github.com/<repo>/releases URLs.
        t = FakeTransport({
            ("GET", _gh_url(DEFAULT_REPO, "main.js")):
                {"status": 200, "headers": {}, "body": b"X"},
        })
        fetch = plugins.default_downloader(DEFAULT_REPO, t)
        fetch("main.js")
        method, url, _, _ = t.calls[0]
        self.assertEqual(method, "GET")
        self.assertTrue(url.startswith(f"https://github.com/{DEFAULT_REPO}/releases/"))


# === plan_install (READ-ONLY) ===============================================

class PlanInstallTest(_VaultCase):
    def test_install_and_enable_from_scratch(self):
        plan = plugins.plan_install(str(self.vault), DEFAULT_PLUGIN, DEFAULT_REPO)
        self.assertEqual(plan["status"], "install-and-enable")
        self.assertIn("main.js", plan["will_download"])
        self.assertIn("manifest.json", plan["will_download"])
        self.assertTrue(plan["will_enable"])
        self.assertFalse(plan["blocked"])

    def test_already_present(self):
        self._seed_installed(DEFAULT_PLUGIN)
        self._write_cp(b'["obsidian-kanban"]')
        plan = plugins.plan_install(str(self.vault), DEFAULT_PLUGIN, DEFAULT_REPO)
        self.assertEqual(plan["status"], "already-present")
        self.assertEqual(plan["actions"], [])
        self.assertEqual(plan["will_download"], [])
        self.assertFalse(plan["will_enable"])

    def test_enable_only(self):
        self._seed_installed(DEFAULT_PLUGIN)
        plan = plugins.plan_install(str(self.vault), DEFAULT_PLUGIN, DEFAULT_REPO)
        # fully installed but not enabled, no --force -> enable-only: add to list,
        # no download, never clobber.
        self.assertEqual(plan["status"], "enable-only")
        self.assertEqual(plan["will_download"], [])
        self.assertTrue(plan["will_enable"])

    def test_install_only_when_already_enabled(self):
        self._write_cp(b'["obsidian-kanban"]')  # listed but files missing
        plan = plugins.plan_install(str(self.vault), DEFAULT_PLUGIN, DEFAULT_REPO)
        self.assertEqual(plan["status"], "install-only")
        self.assertIn("main.js", plan["will_download"])
        self.assertFalse(plan["will_enable"])

    def test_blocked_existing_without_force(self):
        # a PARTIAL install: main.js present but manifest.json missing -> not
        # installed, but clobbering main.js is refused without --force.
        d = self._plugins_root() / DEFAULT_PLUGIN
        d.mkdir(parents=True)
        (d / "main.js").write_bytes(b"USER MAIN\n")
        plan = plugins.plan_install(str(self.vault), DEFAULT_PLUGIN, DEFAULT_REPO,
                                    force=False)
        self.assertEqual(plan["status"], "blocked-existing")
        self.assertTrue(plan["blocked"])
        self.assertTrue(plan["reason"])
        # neither a download NOR a list-add: a non-installable dir must never be
        # enabled (enabling it would list a plugin whose required files are missing).
        self.assertEqual(plan["will_download"], [])
        self.assertFalse(plan["will_enable"])
        self.assertNotIn("enable", plan["actions"])

    def test_force_replans_download(self):
        self._seed_installed(DEFAULT_PLUGIN)
        self._write_cp(b'["obsidian-kanban"]')  # complete + enabled
        plan = plugins.plan_install(str(self.vault), DEFAULT_PLUGIN, DEFAULT_REPO,
                                    force=True)
        # --force re-downloads even a complete+enabled install (install-only:
        # download, do not duplicate the list entry).
        self.assertEqual(plan["status"], "install-only")
        self.assertIn("main.js", plan["will_download"])
        self.assertFalse(plan["blocked"])

    def test_unsafe_id_raises_before_plan(self):
        with self.assertRaises(plugins.UnsafePluginId):
            plugins.plan_install(str(self.vault), "../evil", DEFAULT_REPO)

    def test_read_only(self):
        before = self._disk_snapshot()
        plugins.plan_install(str(self.vault), DEFAULT_PLUGIN, DEFAULT_REPO)
        self.assertEqual(self._disk_snapshot(), before)


# === ensure_plugin: dry-run (default) =======================================

class EnsureDryRunTest(_VaultCase):
    def test_default_is_dry_run_no_writes(self):
        before = self._disk_snapshot()
        dl = FakeDownloader(_full_assets())
        res = plugins.ensure_plugin(str(self.vault), downloader=dl, today=TODAY)
        self.assertFalse(res["apply"])
        self.assertFalse(res["changed"])
        self.assertEqual(res["written"], [])
        # NOTHING downloaded, NOTHING written.
        self.assertEqual(dl.calls, [])
        self.assertEqual(self._disk_snapshot(), before)

    def test_dry_run_transport_untouched(self):
        t = FakeTransport(_full_assets_transport())
        res = plugins.ensure_plugin(str(self.vault), transport=t, today=TODAY)
        self.assertEqual(t.calls, [])
        self.assertFalse(res["changed"])

    def test_dry_run_returns_plan(self):
        dl = FakeDownloader(_full_assets())
        res = plugins.ensure_plugin(str(self.vault), downloader=dl, today=TODAY)
        self.assertEqual(res["status"], "install-and-enable")
        self.assertIn("plan", res)

    def test_unsafe_id_raises(self):
        dl = FakeDownloader(_full_assets())
        with self.assertRaises(plugins.UnsafePluginId):
            plugins.ensure_plugin(str(self.vault), plugin_id="../evil",
                                  downloader=dl, today=TODAY)
        # no tmp dir, no transport hit.
        self.assertEqual(dl.calls, [])
        self.assertFalse(self._plugins_root().exists())


# === ensure_plugin: apply (the real install) ================================

class EnsureApplyTest(_VaultCase):
    def _assets_transport(self):
        return _full_assets_transport()

    def test_install_from_scratch(self):
        dl = FakeDownloader(_full_assets())
        res = plugins.ensure_plugin(str(self.vault), apply=True, downloader=dl,
                                    today=TODAY)
        self.assertTrue(res["apply"])
        self.assertTrue(res["changed"])
        self.assertEqual(res["status"], "install-and-enable")
        d = self._plugins_root() / DEFAULT_PLUGIN
        self.assertEqual((d / "main.js").read_bytes(), b"// kanban main\n")
        self.assertTrue((d / "manifest.json").exists())
        self.assertTrue((d / "styles.css").exists())
        # enabled list now contains the id.
        ids, _ = plugins.load_enabled(str(self.vault))
        self.assertIn(DEFAULT_PLUGIN, ids)

    def test_install_via_transport_seam(self):
        t = FakeTransport(self._assets_transport())
        res = plugins.ensure_plugin(str(self.vault), apply=True, transport=t,
                                    today=TODAY)
        self.assertTrue(res["changed"])
        d = self._plugins_root() / DEFAULT_PLUGIN
        self.assertTrue((d / "main.js").exists())
        self.assertTrue((d / "manifest.json").exists())
        # the transport was the ONLY network seam; every call is a github.com URL.
        self.assertTrue(t.calls)
        for _, url, _, _ in t.calls:
            self.assertTrue(url.startswith(f"https://github.com/{DEFAULT_REPO}/releases/"))

    def test_install_without_styles_ok(self):
        assets = _full_assets()
        del assets["styles.css"]  # styles 404s
        dl = FakeDownloader(assets)
        res = plugins.ensure_plugin(str(self.vault), apply=True, downloader=dl,
                                    today=TODAY)
        self.assertTrue(res["changed"])
        d = self._plugins_root() / DEFAULT_PLUGIN
        self.assertTrue((d / "main.js").exists())
        self.assertFalse((d / "styles.css").exists())

    def test_lf_only_community_plugins(self):
        dl = FakeDownloader(_full_assets())
        plugins.ensure_plugin(str(self.vault), apply=True, downloader=dl,
                              today=TODAY)
        raw = self._cp_path().read_bytes()
        self.assertNotIn(b"\r", raw)

    def test_already_present_noop(self):
        self._seed_installed(DEFAULT_PLUGIN)
        self._write_cp(b'["obsidian-kanban"]')
        before = self._disk_snapshot()
        dl = FakeDownloader(_full_assets())
        res = plugins.ensure_plugin(str(self.vault), apply=True, downloader=dl,
                                    today=TODAY)
        self.assertEqual(res["status"], "already-present")
        self.assertFalse(res["changed"])
        self.assertEqual(dl.calls, [])
        self.assertEqual(self._disk_snapshot(), before)

    def test_enable_only_no_download_no_clobber(self):
        d = self._seed_installed(DEFAULT_PLUGIN, main=b"USER MAIN\n")
        dl = FakeDownloader(_full_assets())
        res = plugins.ensure_plugin(str(self.vault), apply=True, downloader=dl,
                                    today=TODAY)
        # files present, id not listed -> add to list ONLY, no download, no clobber.
        self.assertEqual(dl.calls, [])
        self.assertEqual((d / "main.js").read_bytes(), b"USER MAIN\n")
        ids, _ = plugins.load_enabled(str(self.vault))
        self.assertIn(DEFAULT_PLUGIN, ids)
        self.assertTrue(res["changed"])

    def test_install_only_when_listed_but_missing(self):
        self._write_cp(b'["obsidian-kanban"]')
        dl = FakeDownloader(_full_assets())
        res = plugins.ensure_plugin(str(self.vault), apply=True, downloader=dl,
                                    today=TODAY)
        d = self._plugins_root() / DEFAULT_PLUGIN
        self.assertTrue((d / "main.js").exists())
        # NOT duplicated in the list.
        ids, _ = plugins.load_enabled(str(self.vault))
        self.assertEqual(ids.count(DEFAULT_PLUGIN), 1)

    def test_blocked_existing_without_force_untouched(self):
        d = self._seed_installed(DEFAULT_PLUGIN, main=b"USER MAIN\n")
        self._write_cp(b'["obsidian-kanban"]')  # listed + files present -> present
        # re-run wanting a fresh install but NO force: present already, no-op.
        dl = FakeDownloader(_full_assets())
        res = plugins.ensure_plugin(str(self.vault), apply=True, downloader=dl,
                                    today=TODAY)
        self.assertEqual(res["status"], "already-present")
        self.assertEqual((d / "main.js").read_bytes(), b"USER MAIN\n")

    def test_blocked_existing_when_not_enabled(self):
        # a PARTIAL/foreign dir: main.js present but manifest.json ABSENT (not
        # installable) and NOT enabled, no --force -> status blocked-existing. The
        # dir is byte-untouched AND the id must NOT be added to the list: enabling a
        # plugin whose required files are missing is the forbidden
        # 'id_in_list_but_files_missing' half-state (Obsidian would show an
        # enabled-but-broken plugin).
        d = self._plugins_root() / DEFAULT_PLUGIN
        d.mkdir(parents=True)
        (d / "main.js").write_bytes(b"USER MAIN\n")  # NO manifest.json
        before_main = (d / "main.js").read_bytes()
        before = self._disk_snapshot()
        dl = FakeDownloader(_full_assets())
        res = plugins.ensure_plugin(str(self.vault), apply=True, downloader=dl,
                                    today=TODAY)
        self.assertEqual(res["status"], "blocked-existing")
        # no download, dir untouched.
        self.assertEqual(dl.calls, [])
        self.assertEqual((d / "main.js").read_bytes(), before_main)
        # the plugin is NOT installable -> must NOT be listed.
        self.assertFalse(plugins.is_installed(str(self.vault), DEFAULT_PLUGIN))
        self.assertNotIn(DEFAULT_PLUGIN,
                         plugins.load_enabled(str(self.vault))[0])
        self.assertFalse(res["enabled"])
        # the whole disk is byte-for-byte unchanged: no list created, no edit.
        self.assertEqual(self._disk_snapshot(), before)
        self.assertFalse(res["changed"])

    def test_force_redownloads_over_existing(self):
        d = self._seed_installed(DEFAULT_PLUGIN, main=b"OLD\n")
        self._write_cp(b'["obsidian-kanban"]')
        dl = FakeDownloader(_full_assets())
        res = plugins.ensure_plugin(str(self.vault), apply=True, force=True,
                                    downloader=dl, today=TODAY)
        self.assertTrue(res["changed"])
        self.assertEqual((d / "main.js").read_bytes(), b"// kanban main\n")


# === ensure_plugin: atomicity / failure rollback ============================

class EnsureAtomicityTest(_VaultCase):
    def test_manifest_404_aborts_no_partial(self):
        assets = _full_assets()
        del assets["manifest.json"]  # manifest missing -> abort whole op
        dl = FakeDownloader(assets)
        before = self._disk_snapshot()
        res = plugins.ensure_plugin(str(self.vault), apply=True, downloader=dl,
                                    today=TODAY)
        self.assertFalse(res["changed"])
        self.assertTrue(res.get("reason"))
        # NO plugin dir, NO list edit, NO leftover staging dir.
        self.assertFalse((self._plugins_root() / DEFAULT_PLUGIN).exists())
        self.assertEqual(self._disk_snapshot(), before)
        # no .tmp-* staging dir survived.
        if self._plugins_root().exists():
            leftovers = [p for p in self._plugins_root().iterdir()
                         if ".tmp-" in p.name]
            self.assertEqual(leftovers, [])

    def test_main_404_aborts_no_partial(self):
        assets = _full_assets()
        del assets["main.js"]
        dl = FakeDownloader(assets)
        before = self._disk_snapshot()
        res = plugins.ensure_plugin(str(self.vault), apply=True, downloader=dl,
                                    today=TODAY)
        self.assertFalse(res["changed"])
        self.assertEqual(self._disk_snapshot(), before)

    def test_transport_error_no_mutation(self):
        class Boom(forge.Transport):
            def request(self, method, url, headers=None, body=None):
                raise forge.TransportError(method, url, None, "down")
        before = self._disk_snapshot()
        res = plugins.ensure_plugin(str(self.vault), apply=True, transport=Boom(),
                                    today=TODAY)
        self.assertFalse(res["changed"])
        self.assertTrue(res.get("reason"))
        self.assertEqual(self._disk_snapshot(), before)

    def test_force_failure_leaves_old_dir_intact(self):
        d = self._seed_installed(DEFAULT_PLUGIN, main=b"OLD MAIN\n")
        self._write_cp(b'["obsidian-kanban"]')
        assets = _full_assets()
        del assets["manifest.json"]  # mid-download failure under --force
        dl = FakeDownloader(assets)
        res = plugins.ensure_plugin(str(self.vault), apply=True, force=True,
                                    downloader=dl, today=TODAY)
        self.assertFalse(res["changed"])
        # the OLD dir is still intact (atomic swap never happened).
        self.assertEqual((d / "main.js").read_bytes(), b"OLD MAIN\n")


# === ensure_plugin: the SWAP window (download succeeds, os.replace fails) ====
#
# The bugs the download-abort tests above CANNOT reach: a --force re-download that
# downloads fine but fails at the os.replace that moves the staged dir into place
# (locked main.js under a running Obsidian, antivirus, EXDEV, perms). These patch
# plugins.os.replace so ONLY the staging->final move raises; the old dir must NOT
# be lost, the id must NOT be left dangling in the list, and no .tmp-/.bak- dir may
# leak.

def _raise_on_swap_into(plugin_id):
    """Return a fake os.replace that raises OSError exactly for the staging->final
    move (src is the .tmp- staging dir, dst is the final <plugin_id> dir) and
    delegates to the real os.replace for every other rename (move-old-aside,
    restore, save_enabled's tmp write)."""
    import os as _os
    real = _os.replace

    def fake_replace(src, dst, *a, **k):
        s, d = Path(src), Path(dst)
        if d.name == plugin_id and ".tmp-" in s.name:
            raise OSError(13, "simulated locked plugin dir (swap into place)")
        return real(src, dst, *a, **k)

    return fake_replace


class EnsureSwapFailureTest(_VaultCase):
    def _patch_replace(self, fn):
        import os as _os
        orig = plugins.os.replace
        plugins.os.replace = fn
        self.addCleanup(lambda: setattr(plugins.os, "replace", orig))

    def test_force_swap_failure_preserves_old_install_and_list(self):
        # COMPLETE + ENABLED install; --force re-download; the staged dir downloads
        # fine but the os.replace into place fails. The previously-working install
        # must survive AND the id must NOT be left dangling in community-plugins.json
        # (the 'list names a plugin whose files are missing' half-state).
        d = self._seed_installed(DEFAULT_PLUGIN, main=b"OLD MAIN\n",
                                 manifest=b'{"id":"obsidian-kanban","old":true}\n',
                                 with_styles=True)
        self._write_cp(b'["dataview","obsidian-kanban"]\n')
        self._patch_replace(_raise_on_swap_into(DEFAULT_PLUGIN))
        dl = FakeDownloader(_full_assets())
        res = plugins.ensure_plugin(str(self.vault), apply=True, force=True,
                                    downloader=dl, today=TODAY)
        # structured failure, no crash.
        self.assertFalse(res["changed"])
        self.assertTrue(res.get("reason"))
        self.assertIn("swap", res["reason"])
        # the OLD install is intact: main.js + manifest.json still present with the
        # OLD bytes (never destroyed).
        self.assertTrue((d / "main.js").exists())
        self.assertTrue((d / "manifest.json").exists())
        self.assertEqual((d / "main.js").read_bytes(), b"OLD MAIN\n")
        # is_installed must still hold (the invariant the docstring promises).
        self.assertTrue(plugins.is_installed(str(self.vault), DEFAULT_PLUGIN))
        # the id was ALREADY listed (install-only) and stays listed -> but it must
        # NOT be dangling: files are present, so this is consistent, not the
        # forbidden half-state.
        ids, _ = plugins.load_enabled(str(self.vault))
        self.assertIn(DEFAULT_PLUGIN, ids)
        self.assertFalse(
            plugins.plugin_status(str(self.vault), DEFAULT_PLUGIN)[
                "id_in_list_but_files_missing"])

    def test_swap_failure_leaves_no_orphan_tmp_or_bak_dir(self):
        # a swap failure must not litter .obsidian/plugins/ with a .tmp- staging dir
        # or a .bak- backup dir.
        self._seed_installed(DEFAULT_PLUGIN, main=b"OLD\n", with_styles=True)
        self._write_cp(b'["obsidian-kanban"]\n')
        self._patch_replace(_raise_on_swap_into(DEFAULT_PLUGIN))
        dl = FakeDownloader(_full_assets())
        plugins.ensure_plugin(str(self.vault), apply=True, force=True,
                              downloader=dl, today=TODAY)
        leftovers = [p.name for p in self._plugins_root().iterdir()
                     if ".tmp-" in p.name or ".bak-" in p.name]
        self.assertEqual(leftovers, [])

    def test_force_redownload_preserves_user_data_json(self):
        # --force re-download must refresh the asset files but PRESERVE the plugin's
        # data.json (user settings / board config), not wipe the whole dir.
        d = self._seed_installed(DEFAULT_PLUGIN, main=b"OLD\n", with_styles=True)
        (d / "data.json").write_bytes(b'{"boards":["Sprint"],"v":1}\n')
        self._write_cp(b'["obsidian-kanban"]\n')
        dl = FakeDownloader(_full_assets())
        res = plugins.ensure_plugin(str(self.vault), apply=True, force=True,
                                    downloader=dl, today=TODAY)
        self.assertTrue(res["changed"])
        # assets refreshed...
        self.assertEqual((d / "main.js").read_bytes(), b"// kanban main\n")
        # ...but the user's settings survived the swap.
        self.assertTrue((d / "data.json").exists())
        self.assertEqual((d / "data.json").read_bytes(),
                         b'{"boards":["Sprint"],"v":1}\n')

    def test_swap_failure_does_not_create_dangling_list_entry(self):
        # install-only over a LISTED-but-files-missing plugin, where there is NO old
        # dir, and the FIRST os.replace (staging->final) fails. Result: the dir is
        # still absent, no .tmp- leak, and changed=False. (The id was already in the
        # list before this run from a prior broken state; the op must not pretend it
        # installed.)
        self._write_cp(b'["obsidian-kanban"]\n')  # listed, files missing
        self._patch_replace(_raise_on_swap_into(DEFAULT_PLUGIN))
        dl = FakeDownloader(_full_assets())
        res = plugins.ensure_plugin(str(self.vault), apply=True,
                                    downloader=dl, today=TODAY)
        self.assertFalse(res["changed"])
        self.assertFalse((self._plugins_root() / DEFAULT_PLUGIN).exists())
        leftovers = [p.name for p in self._plugins_root().iterdir()
                     if ".tmp-" in p.name]
        self.assertEqual(leftovers, [])

    def test_non_bytes_body_is_structured_error_not_crash(self):
        # a downloader/transport that returns a str (not bytes) for an asset must
        # NOT propagate a raw TypeError out of the public API; it must yield a
        # structured {changed:False, reason:...} and leave NO partial dir / list edit.
        class StrBodyDownloader:
            def __init__(self):
                self.calls = []

            def __call__(self, filename):
                self.calls.append(filename)
                # main.js comes back as a *str* (bad transport) -> bytes() TypeError.
                if filename == "main.js":
                    return "// not bytes"
                return b"{}"

        before = self._disk_snapshot()
        dl = StrBodyDownloader()
        res = plugins.ensure_plugin(str(self.vault), apply=True,
                                    downloader=dl, today=TODAY)
        self.assertFalse(res["changed"])
        self.assertTrue(res.get("reason"))
        # no plugin dir, no list edit, no .tmp- leak -> atomicity preserved.
        self.assertFalse((self._plugins_root() / DEFAULT_PLUGIN).exists())
        self.assertEqual(self._disk_snapshot(), before)
        if self._plugins_root().exists():
            leftovers = [p for p in self._plugins_root().iterdir()
                         if ".tmp-" in p.name]
            self.assertEqual(leftovers, [])


# === ensure_plugin: idempotency =============================================

class EnsureIdempotencyTest(_VaultCase):
    def test_second_apply_is_noop_byte_identical(self):
        dl = FakeDownloader(_full_assets())
        plugins.ensure_plugin(str(self.vault), apply=True, downloader=dl,
                              today=TODAY)
        cp_after_first = self._cp_path().read_bytes()
        main_after_first = (self._plugins_root() / DEFAULT_PLUGIN / "main.js").read_bytes()

        dl2 = FakeDownloader(_full_assets())
        res = plugins.ensure_plugin(str(self.vault), apply=True, downloader=dl2,
                                    today=TODAY)
        self.assertEqual(res["status"], "already-present")
        self.assertFalse(res["changed"])
        self.assertEqual(dl2.calls, [])
        # community-plugins.json byte-identical (no spurious diff), LF-only.
        self.assertEqual(self._cp_path().read_bytes(), cp_after_first)
        self.assertNotIn(b"\r", self._cp_path().read_bytes())
        self.assertEqual(
            (self._plugins_root() / DEFAULT_PLUGIN / "main.js").read_bytes(),
            main_after_first)


# === CLI wiring =============================================================

class CliWiringTest(unittest.TestCase):
    def test_parse_defaults(self):
        p = kb_meta._parse_ensure_plugin_args(["ensure-plugin", "/vault"])
        self.assertEqual(p["vault"], "/vault")
        self.assertEqual(p["plugin"], DEFAULT_PLUGIN)
        self.assertEqual(p["repo"], DEFAULT_REPO)
        self.assertFalse(p["apply"])
        self.assertFalse(p["force"])

    def test_parse_plugin_and_repo_consume_next(self):
        p = kb_meta._parse_ensure_plugin_args(
            ["ensure-plugin", "/vault", "--plugin", "dataview",
             "--repo", "blacksmithgu/obsidian-dataview", "--apply", "--force"])
        self.assertEqual(p["plugin"], "dataview")
        self.assertEqual(p["repo"], "blacksmithgu/obsidian-dataview")
        self.assertTrue(p["apply"])
        self.assertTrue(p["force"])

    def test_parse_plugin_value_starting_with_dashes(self):
        # consume-next is deterministic even when the value looks like a flag.
        p = kb_meta._parse_ensure_plugin_args(
            ["ensure-plugin", "/vault", "--plugin", "--weird"])
        self.assertEqual(p["plugin"], "--weird")

    def test_parse_flag_at_end_of_args(self):
        # --plugin at end-of-args (no following token) leaves the default.
        p = kb_meta._parse_ensure_plugin_args(
            ["ensure-plugin", "/vault", "--plugin"])
        self.assertEqual(p["plugin"], DEFAULT_PLUGIN)

    def test_parse_missing_vault_raises_indexerror(self):
        with self.assertRaises(IndexError):
            kb_meta._parse_ensure_plugin_args(["ensure-plugin"])

    def test_dispatch_has_ensure_plugin(self):
        # the command is wired into the dispatch dict (built inside main(); we
        # assert the cmd_ + parser exist and the docstring usage line is present).
        self.assertTrue(hasattr(kb_meta, "cmd_ensure_plugin"))
        self.assertIn("ensure-plugin", kb_meta.__doc__)


class CmdEnsurePluginTest(_VaultCase):
    def test_cmd_dry_run_default(self):
        dl = FakeDownloader(_full_assets())
        res = kb_meta.cmd_ensure_plugin(str(self.vault), downloader=dl, today=TODAY)
        self.assertFalse(res["apply"])
        self.assertFalse(res["changed"])
        self.assertEqual(dl.calls, [])

    def test_cmd_apply_installs(self):
        dl = FakeDownloader(_full_assets())
        res = kb_meta.cmd_ensure_plugin(str(self.vault), apply=True, downloader=dl,
                                        today=TODAY)
        self.assertTrue(res["changed"])
        self.assertTrue((self._plugins_root() / DEFAULT_PLUGIN / "main.js").exists())

    def test_cmd_unsafe_id_surfaces_as_value_error(self):
        dl = FakeDownloader(_full_assets())
        with self.assertRaises(ValueError):
            kb_meta.cmd_ensure_plugin(str(self.vault), plugin="../evil",
                                      downloader=dl, today=TODAY)


def _full_assets_transport():
    a = _full_assets()
    return {
        ("GET", _gh_url(DEFAULT_REPO, "main.js")):
            {"status": 200, "headers": {}, "body": a["main.js"]},
        ("GET", _gh_url(DEFAULT_REPO, "manifest.json")):
            {"status": 200, "headers": {}, "body": a["manifest.json"]},
        ("GET", _gh_url(DEFAULT_REPO, "styles.css")):
            {"status": 200, "headers": {}, "body": a["styles.css"]},
    }


if __name__ == "__main__":
    unittest.main()
