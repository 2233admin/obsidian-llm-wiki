"""Task 9 / PR 9A: LOCAL PROJECT REGISTRY tests (zero-dep, unittest).

Covers compiler/workspace.py + the kb_meta project-scan / project-adopt CLI:

  * scan detects all 3 project shapes -- pure dir (package.json, no git) /
    git-but-no-remote / git-with-remote -- with correct has_git; and does NOT
    descend into a detected project, and skips node_modules.
  * adopt(apply=True) writes the binding (abs path) to .vault-mind/
    local-bindings.json and the shared Projects/<slug>.md note that carries
    entity + type:project and NO path string anywhere; re-adopt is byte-stable.
  * adopt(apply=False) writes nothing.
  * the adopted project note flows into kb_meta.cmd_currency as a project entity.
  * a machine path NEVER appears in any committed/shared markdown note.

A TEMP workspace root is built programmatically -- nested .git dirs are created
with os.mkdir at runtime (never committed). Windows: run with PYTHONUTF8=1.

    PYTHONUTF8=1 python -m unittest tests.test_workspace -v
"""

from __future__ import annotations

import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

_COMPILER = Path(__file__).resolve().parents[1]
if str(_COMPILER) not in sys.path:
    sys.path.insert(0, str(_COMPILER))

import kb_meta  # noqa: E402
import workspace  # noqa: E402

# Fixed "today" so the last-verified stamp on adopted notes is byte-assertable.
TODAY = date(2026, 6, 25).isoformat()


def _mkproject(root: Path, name: str, *, marker_files=None, git=False,
               remote=False) -> Path:
    """Create a project dir under `root` with the given marker files, optionally a
    .git dir (created at RUNTIME with os.mkdir -- never a committed fixture) whose
    config has a [remote] section iff remote=True."""
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    for fn in (marker_files or []):
        (d / fn).write_bytes(b"{}\n")
    if git:
        gitdir = d / ".git"
        gitdir.mkdir(exist_ok=True)
        cfg = "[core]\n\trepositoryformatversion = 0\n"
        if remote:
            cfg += '[remote "origin"]\n\turl = https://example.invalid/x.git\n'
        (gitdir / "config").write_bytes(cfg.encode("utf-8"))
    return d


class ScanShapesTest(unittest.TestCase):
    """scan detects all 3 project shapes with correct has_git / has_remote."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9a-scan-"))
        self.roots = self.tmp / "workspace"
        self.roots.mkdir()
        # (a) pure dir: only package.json, NO git.
        _mkproject(self.roots, "pure-node", marker_files=["package.json"])
        # (b) git, NO remote.
        _mkproject(self.roots, "git-no-remote", git=True, remote=False)
        # (c) git WITH a remote.
        _mkproject(self.roots, "git-with-remote", git=True, remote=True)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _by_slug(self):
        return {d["slug"]: d for d in workspace.scan_roots([self.roots])}

    def test_all_three_shapes_detected(self):
        found = self._by_slug()
        for slug in ("pure-node", "git-no-remote", "git-with-remote"):
            self.assertIn(slug, found, f"{slug} not detected")

    def test_has_git_flag_correct(self):
        found = self._by_slug()
        self.assertFalse(found["pure-node"]["has_git"])
        self.assertTrue(found["git-no-remote"]["has_git"])
        self.assertTrue(found["git-with-remote"]["has_git"])

    def test_has_remote_flag_correct(self):
        found = self._by_slug()
        # local-only / git-no-remote MUST still be detected with has_remote False.
        self.assertFalse(found["pure-node"]["has_remote"])
        self.assertFalse(found["git-no-remote"]["has_remote"])
        self.assertTrue(found["git-with-remote"]["has_remote"])

    def test_paths_are_abs_posix(self):
        for d in workspace.scan_roots([self.roots]):
            self.assertEqual(d["path"], Path(d["path"]).as_posix())
            self.assertTrue(Path(d["path"]).is_absolute())

    def test_pure_local_project_with_no_git_no_remote_is_detected(self):
        # the whole point of 9A: a project with NO git / NO remote / NO board.
        found = self._by_slug()
        self.assertIn("pure-node", found)
        self.assertEqual(found["pure-node"]["markers"], ["package.json"])


class ScanBoundaryTest(unittest.TestCase):
    """scan does NOT descend into a detected project and skips node_modules."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9a-bound-"))
        self.roots = self.tmp / "workspace"
        self.roots.mkdir()
        # a detected project with a marker buried in a sub-subdir + node_modules.
        outer = _mkproject(self.roots, "outer", marker_files=["package.json"])
        # nested marker deep inside the detected project -> must NOT be a 2nd hit.
        nested = outer / "sub" / "inner"
        nested.mkdir(parents=True)
        (nested / "Cargo.toml").write_bytes(b"[package]\n")
        # a node_modules package with its own package.json -> must be skipped.
        nm = outer / "node_modules" / "leftpad"
        nm.mkdir(parents=True)
        (nm / "package.json").write_bytes(b"{}\n")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_no_descent_into_detected_project(self):
        detected = workspace.scan_roots([self.roots])
        slugs = [d["slug"] for d in detected]
        self.assertEqual(slugs, ["outer"])  # exactly one project, not the nested
        # neither the nested Cargo.toml dir nor a node_modules pkg shows up.
        paths = [d["path"] for d in detected]
        self.assertTrue(all("node_modules" not in p for p in paths))
        self.assertTrue(all("/inner" not in p for p in paths))

    def test_node_modules_at_root_level_is_skipped(self):
        # a node_modules sitting directly under a scanned root is also skipped.
        nm = self.roots / "node_modules" / "rootpkg"
        nm.mkdir(parents=True)
        (nm / "package.json").write_bytes(b"{}\n")
        detected = workspace.scan_roots([self.roots])
        self.assertTrue(all("node_modules" not in d["path"] for d in detected))


class ScanDepthAndSlnTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9a-depth-"))
        self.roots = self.tmp / "workspace"
        self.roots.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_sln_glob_marker(self):
        d = self.roots / "dotnet-app"
        d.mkdir()
        (d / "MyApp.sln").write_bytes(b"Microsoft Visual Studio Solution File\n")
        found = {x["slug"]: x for x in workspace.scan_roots([self.roots])}
        self.assertIn("dotnet-app", found)
        self.assertIn("*.sln", found["dotnet-app"]["markers"])

    def test_bounded_depth_does_not_find_too_deep(self):
        # a marker 4 levels below the root is beyond max_depth=3.
        deep = self.roots / "a" / "b" / "c" / "d"
        deep.mkdir(parents=True)
        (deep / "go.mod").write_bytes(b"module x\n")
        detected = workspace.scan_roots([self.roots], max_depth=3)
        self.assertEqual(detected, [])
        # but at depth 4 it is reachable.
        detected4 = workspace.scan_roots([self.roots], max_depth=4)
        self.assertEqual([d["slug"] for d in detected4], ["d"])


class AdoptDryRunTest(unittest.TestCase):
    """adopt(apply=False) writes NOTHING."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9a-dry-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        self.proj = self.tmp / "workspace" / "my-proj"
        self.proj.mkdir(parents=True)
        (self.proj / "package.json").write_bytes(b"{}\n")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_dry_run_writes_nothing(self):
        plan = workspace.adopt(str(self.vault), str(self.proj),
                               "project/my-proj", apply=False, today=TODAY)
        self.assertFalse(plan["apply"])
        self.assertEqual(plan["written"], [])
        # no .vault-mind dir, no Projects note created.
        self.assertFalse((self.vault / ".vault-mind").exists())
        self.assertFalse((self.vault / "Projects" / "my-proj.md").exists())

    def test_dry_run_plan_carries_full_intent(self):
        plan = workspace.adopt(str(self.vault), str(self.proj),
                               "project/my-proj", apply=False, today=TODAY)
        self.assertEqual(plan["entity"], "project/my-proj")
        self.assertEqual(plan["slug"], "my-proj")
        self.assertEqual(plan["binding"], {"project/my-proj": {"path": plan["path"]}})
        self.assertIn("type: project", plan["note_text"])


class AdoptApplyTest(unittest.TestCase):
    """adopt(apply=True): binding + shared note; idempotent; no path in note."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9a-apply-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        self.proj = self.tmp / "workspace" / "cool-proj"
        self.proj.mkdir(parents=True)
        (self.proj / "pyproject.toml").write_bytes(b"[project]\n")
        self.entity = "project/cool-proj"
        self.plan = workspace.adopt(str(self.vault), str(self.proj),
                                    self.entity, apply=True, today=TODAY)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _binding_file(self) -> Path:
        return self.vault / ".vault-mind" / "local-bindings.json"

    def _note_file(self) -> Path:
        return self.vault / "Projects" / "cool-proj.md"

    def test_binding_written_with_abs_path(self):
        bf = self._binding_file()
        self.assertTrue(bf.exists())
        data = json.loads(bf.read_text("utf-8"))
        self.assertIn(self.entity, data)
        bound = data[self.entity]["path"]
        self.assertEqual(bound, Path(self.proj).resolve().as_posix())
        self.assertTrue(Path(bound).is_absolute())

    def test_shared_note_has_entity_and_type_project(self):
        nf = self._note_file()
        self.assertTrue(nf.exists())
        text = nf.read_text("utf-8")
        self.assertIn(f"entity: {self.entity}", text)
        self.assertIn("type: project", text)

    def test_no_machine_path_in_shared_note(self):
        # the binding path must NEVER appear in the committed markdown (§0 #9).
        text = self._note_file().read_text("utf-8")
        bound = json.loads(self._binding_file().read_text("utf-8"))[self.entity]["path"]
        self.assertNotIn(bound, text)
        # and no path SEPARATOR-bearing fragment of the binding leaks in either.
        # (a project dir abs path always contains a separator).
        self.assertIn("/", bound)
        for segment in bound.split("/"):
            # the leaf basename "cool-proj" legitimately matches the slug; every
            # OTHER path segment (drive, tmp dir, "workspace") must be absent.
            if segment and segment != "cool-proj":
                self.assertNotIn(segment, text,
                                 f"path segment {segment!r} leaked into note")

    def test_note_is_lf_only_bytes(self):
        raw = self._note_file().read_bytes()
        self.assertNotIn(b"\r", raw)

    def test_binding_is_lf_only_bytes(self):
        raw = self._binding_file().read_bytes()
        self.assertNotIn(b"\r", raw)

    def test_readopt_is_idempotent_and_byte_stable(self):
        note_before = self._note_file().read_bytes()
        bind_before = self._binding_file().read_bytes()
        # re-adopt the identical project.
        workspace.adopt(str(self.vault), str(self.proj), self.entity,
                        apply=True, today=TODAY)
        self.assertEqual(self._note_file().read_bytes(), note_before)
        self.assertEqual(self._binding_file().read_bytes(), bind_before)
        # exactly one binding entry (no dup).
        data = json.loads(self._binding_file().read_text("utf-8"))
        self.assertEqual(list(data), [self.entity])
        # exactly one note (no second file).
        notes = sorted(p.name for p in (self.vault / "Projects").iterdir())
        self.assertEqual(notes, ["cool-proj.md"])

    def test_readopt_preserves_authored_body(self):
        # a human edits the note body; re-adopt must keep the prose.
        nf = self._note_file()
        text = nf.read_text("utf-8") + "\nHuman notes about the project.\n"
        nf.write_bytes(text.encode("utf-8"))
        workspace.adopt(str(self.vault), str(self.proj), self.entity,
                        apply=True, today=TODAY)
        self.assertIn("Human notes about the project.", nf.read_text("utf-8"))


class RegisteredHelperTest(unittest.TestCase):
    """registered() splits detected projects into already-bound vs new."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9a-reg-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        self.roots = self.tmp / "workspace"
        self.roots.mkdir()
        self.p1 = _mkproject(self.roots, "alpha", marker_files=["go.mod"])
        self.p2 = _mkproject(self.roots, "beta", marker_files=["Cargo.toml"])

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_new_vs_registered(self):
        # adopt alpha only.
        workspace.adopt(str(self.vault), str(self.p1), "project/alpha",
                        apply=True, today=TODAY)
        report = workspace.scan_report(str(self.vault), extra_roots=[self.roots])
        reg_slugs = [d["slug"] for d in report["registered"]]
        new_slugs = [d["slug"] for d in report["new"]]
        self.assertEqual(reg_slugs, ["alpha"])
        self.assertEqual(new_slugs, ["beta"])
        self.assertEqual(len(report["detected"]), 2)


class WorkspaceConfigTest(unittest.TestCase):
    """load_roots reads workspace.json; missing -> []."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9a-cfg-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_missing_config_is_empty(self):
        self.assertEqual(workspace.load_roots(str(self.vault)), [])

    def test_config_roots_drive_scan(self):
        roots_dir = self.tmp / "workspace"
        _mkproject(roots_dir, "gamma", marker_files=["pom.xml"])
        cfgdir = self.vault / ".vault-mind"
        cfgdir.mkdir(parents=True)
        (cfgdir / "workspace.json").write_bytes(
            json.dumps({"workspace-roots": [str(roots_dir)]}).encode("utf-8")
        )
        self.assertEqual(workspace.load_roots(str(self.vault)), [str(roots_dir)])
        report = workspace.scan_report(str(self.vault))
        self.assertEqual([d["slug"] for d in report["detected"]], ["gamma"])


class AdoptedNoteFlowsIntoCurrencyTest(unittest.TestCase):
    """Integration sanity: an adopted Projects/<slug>.md is picked up by
    kb_meta.cmd_currency as a project entity."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9a-cur-"))
        self.vault = self.tmp / "vault"
        # cmd_currency needs <topic>/wiki/ to exist; Projects/ is scanned for
        # entity-bearing work notes.
        (self.vault / "research" / "wiki").mkdir(parents=True)
        (self.vault / "research" / "_meta.json").write_bytes(
            b'{"sources": {}}'
        )
        self.proj = self.tmp / "workspace" / "ledger-cli"
        self.proj.mkdir(parents=True)
        (self.proj / "Cargo.toml").write_bytes(b"[package]\n")
        workspace.adopt(str(self.vault), str(self.proj), "project/ledger-cli",
                        apply=True, today=TODAY)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_adopted_project_appears_as_project_entity(self):
        res = kb_meta.cmd_currency(str(self.vault), "research",
                                   today_str=TODAY, apply=False)
        self.assertIn("project/ledger-cli", res["entities"])
        # it appears in the per-project current-truth pass too.
        self.assertIn("project/ledger-cli", res["project_status"])
        self.assertEqual(
            res["project_status"]["project/ledger-cli"]["note_id"],
            "Projects/ledger-cli.md",
        )

    def test_currency_view_never_contains_machine_path(self):
        # the derived current-truth render must not leak the binding path either.
        res = kb_meta.cmd_currency(str(self.vault), "research",
                                   today_str=TODAY, apply=False)
        bound = workspace.load_bindings(str(self.vault))["project/ledger-cli"]["path"]
        for seg in bound.split("/"):
            if seg and seg != "ledger-cli":
                self.assertNotIn(seg, res["project_status_md"])


class CliTest(unittest.TestCase):
    """The kb_meta cmd_project_* surface (what the CLI dispatch calls)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9a-cli-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        self.roots = self.tmp / "workspace"
        self.proj = _mkproject(self.roots, "widget", marker_files=["package.json"])

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_cmd_project_scan_is_read_only(self):
        before = sorted(os.listdir(self.vault))
        out = kb_meta.cmd_project_scan(str(self.vault), extra_roots=[str(self.roots)])
        self.assertEqual([d["slug"] for d in out["detected"]], ["widget"])
        self.assertEqual([d["slug"] for d in out["new"]], ["widget"])
        # scan wrote nothing into the vault.
        self.assertEqual(sorted(os.listdir(self.vault)), before)

    def test_cmd_project_adopt_dry_run_default(self):
        out = kb_meta.cmd_project_adopt(str(self.vault), str(self.proj),
                                        "project/widget", today=TODAY)
        self.assertFalse(out["apply"])
        self.assertEqual(out["written"], [])
        self.assertFalse((self.vault / ".vault-mind").exists())

    def test_cmd_project_adopt_apply(self):
        out = kb_meta.cmd_project_adopt(str(self.vault), str(self.proj),
                                        "project/widget", apply=True, today=TODAY)
        self.assertTrue(out["apply"])
        self.assertEqual(len(out["written"]), 2)
        self.assertTrue((self.vault / ".vault-mind" / "local-bindings.json").exists())
        self.assertTrue((self.vault / "Projects" / "widget.md").exists())


class CliParserTest(unittest.TestCase):
    """The actual CLI argv parsers (_parse_project_*_args) -- the branchy flag
    logic the dispatch closures run, not the cmd_* helpers behind them."""

    def test_scan_parser_vault_and_extra_roots(self):
        p = kb_meta._parse_project_scan_args(
            ["project-scan", "/v", "/r1", "/r2"])
        self.assertEqual(p["vault"], "/v")
        self.assertEqual(p["extra_roots"], ["/r1", "/r2"])

    def test_scan_parser_missing_vault_raises(self):
        with self.assertRaises(IndexError):
            kb_meta._parse_project_scan_args(["project-scan"])

    def test_scan_parser_ignores_flag_tokens(self):
        # bare flags are not positionals -> stripped, vault still resolves.
        p = kb_meta._parse_project_scan_args(["project-scan", "/v", "--apply"])
        self.assertEqual(p["vault"], "/v")
        self.assertEqual(p["extra_roots"], [])

    def test_adopt_parser_full(self):
        p = kb_meta._parse_project_adopt_args([
            "project-adopt", "/v", "/p", "--entity", "project/x",
            "--apply", "--today", "2026-06-25"])
        self.assertEqual(p, {"vault": "/v", "path": "/p",
                             "entity": "project/x", "apply": True,
                             "today": "2026-06-25"})

    def test_adopt_parser_dry_run_default(self):
        p = kb_meta._parse_project_adopt_args(
            ["project-adopt", "/v", "/p", "--entity", "project/x"])
        self.assertFalse(p["apply"])
        self.assertIsNone(p["today"])

    def test_adopt_parser_missing_positionals_raises(self):
        # only <vault>, no <path> positional -> fewer than 2 positionals.
        with self.assertRaises(IndexError):
            kb_meta._parse_project_adopt_args(["project-adopt", "/v"])

    def test_adopt_parser_missing_entity_raises(self):
        with self.assertRaises(IndexError):
            kb_meta._parse_project_adopt_args(["project-adopt", "/v", "/p"])

    def test_adopt_parser_entity_at_end_of_args_raises(self):
        # '--entity' with no following token must NOT silently parse as no entity
        # AND must not consume a non-existent token -> treated as missing entity.
        with self.assertRaises(IndexError):
            kb_meta._parse_project_adopt_args(
                ["project-adopt", "/v", "/p", "--entity"])

    def test_adopt_parser_entity_value_starting_with_dashes(self):
        # --entity consumes the NEXT token verbatim, even if it begins with '--'.
        p = kb_meta._parse_project_adopt_args([
            "project-adopt", "/v", "/p", "--entity", "--weird"])
        self.assertEqual(p["entity"], "--weird")

    def test_main_scan_dispatch_prints_json(self):
        # drive the real dispatch path end-to-end via sys.argv -> stdout JSON.
        tmp = Path(tempfile.mkdtemp(prefix="vault-9a-main-"))
        try:
            vault = tmp / "vault"
            vault.mkdir()
            roots = tmp / "workspace"
            _mkproject(roots, "widget", marker_files=["package.json"])
            argv = ["kb_meta.py", "project-scan", str(vault), str(roots)]
            buf = io.StringIO()
            old_argv, old_out = sys.argv, sys.stdout
            sys.argv, sys.stdout = argv, buf
            try:
                kb_meta.main()
            finally:
                sys.argv, sys.stdout = old_argv, old_out
            out = json.loads(buf.getvalue())
            self.assertEqual([d["slug"] for d in out["detected"]], ["widget"])
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_main_adopt_missing_entity_exits_nonzero(self):
        # the IndexError from the parser is surfaced as a nonzero exit by main().
        old_argv = sys.argv
        sys.argv = ["kb_meta.py", "project-adopt", "/v", "/p"]
        try:
            with self.assertRaises(SystemExit) as cm:
                kb_meta.main()
            self.assertNotEqual(cm.exception.code, 0)
        finally:
            sys.argv = old_argv


class AdoptRebindTest(unittest.TestCase):
    """Two same-named dirs in DIFFERENT roots: scan keeps them distinct by path;
    re-pointing one entity to the other path re-binds (new path wins) and is
    surfaced as a warning, never silent."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9a-rebind-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        self.rootA = self.tmp / "A"
        self.rootB = self.tmp / "B"
        self.dirA = _mkproject(self.rootA, "shared", marker_files=["go.mod"])
        self.dirB = _mkproject(self.rootB, "shared", marker_files=["go.mod"])

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_same_slug_distinct_roots_detected_and_split_by_path(self):
        report = workspace.scan_report(
            str(self.vault), extra_roots=[self.rootA, self.rootB])
        # both same-slug projects detected, distinct paths (path-keyed, not slug).
        slugs = [d["slug"] for d in report["detected"]]
        self.assertEqual(slugs, ["shared", "shared"])
        paths = sorted(d["path"] for d in report["detected"])
        self.assertEqual(paths, sorted(
            [Path(self.dirA).resolve().as_posix(),
             Path(self.dirB).resolve().as_posix()]))
        # adopt only A -> registered() splits by path: A registered, B new.
        workspace.adopt(str(self.vault), str(self.dirA), "project/a-shared",
                        apply=True, today=TODAY)
        report2 = workspace.scan_report(
            str(self.vault), extra_roots=[self.rootA, self.rootB])
        reg_paths = [d["path"] for d in report2["registered"]]
        new_paths = [d["path"] for d in report2["new"]]
        self.assertEqual(reg_paths, [Path(self.dirA).resolve().as_posix()])
        self.assertEqual(new_paths, [Path(self.dirB).resolve().as_posix()])

    def test_rebind_same_entity_new_path_warns_and_new_path_wins(self):
        workspace.adopt(str(self.vault), str(self.dirA), "project/shared",
                        apply=True, today=TODAY)
        plan = workspace.adopt(str(self.vault), str(self.dirB), "project/shared",
                               apply=True, today=TODAY)
        # warned (not silent), and the new (B) path wins in the single binding.
        self.assertTrue(plan["warnings"], "rebind must surface a warning")
        self.assertIn("rebinding", plan["warnings"][0])
        bindings = workspace.load_bindings(str(self.vault))
        self.assertEqual(list(bindings), ["project/shared"])
        self.assertEqual(bindings["project/shared"]["path"],
                         Path(self.dirB).resolve().as_posix())

    def test_idempotent_readopt_same_path_warns_nothing(self):
        workspace.adopt(str(self.vault), str(self.dirA), "project/shared",
                        apply=True, today=TODAY)
        plan = workspace.adopt(str(self.vault), str(self.dirA), "project/shared",
                               apply=True, today=TODAY)
        self.assertEqual(plan["warnings"], [])


@unittest.skipUnless(hasattr(os, "symlink"), "platform lacks os.symlink")
class ScanSymlinkTest(unittest.TestCase):
    """scan must NOT follow a directory symlink out of a root (path traversal),
    and must terminate on a self-referential symlink loop."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9a-link-"))
        self.roots = self.tmp / "workspace"
        self.roots.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _can_symlink(self) -> bool:
        probe = self.tmp / "_probe"
        target = self.tmp / "_target"
        target.mkdir()
        try:
            os.symlink(target, probe, target_is_directory=True)
        except (OSError, NotImplementedError):
            return False
        finally:
            if probe.exists() or probe.is_symlink():
                try:
                    probe.unlink()
                except OSError:
                    pass
        return True

    def test_symlink_out_of_root_is_not_followed(self):
        if not self._can_symlink():
            self.skipTest("symlink creation not permitted on this host")
        # an out-of-root project the symlink points at.
        outside = self.tmp / "OUTSIDE"
        _mkproject(outside, "escaped-proj", marker_files=["go.mod"])
        # an in-root dir-symlink to the out-of-root dir.
        link = self.roots / "link-to-outside"
        os.symlink(outside, link, target_is_directory=True)
        detected = workspace.scan_roots([self.roots])
        slugs = [d["slug"] for d in detected]
        self.assertNotIn("escaped-proj", slugs,
                         "scan followed a symlink OUT of the root")
        self.assertEqual(detected, [])

    def test_self_referential_symlink_loop_terminates(self):
        if not self._can_symlink():
            self.skipTest("symlink creation not permitted on this host")
        loop = self.roots / "loop"
        loop.mkdir()
        os.symlink(loop, loop / "self", target_is_directory=True)
        # must not hang / recurse; bounded scan returns (no project markers here).
        detected = workspace.scan_roots([self.roots], max_depth=5)
        self.assertEqual(detected, [])


# === Task 9 / PR 9B: WORKSPACE HEALTH tests =================================
#
# Real git repos are built programmatically with subprocess (`git init` etc.)
# and a LOCAL user.email/name so commits succeed in CI with no global config.
# Each repo-health state is covered: no-git / local-only / clean / dirty /
# unpushed(ahead) / unpushed(no-upstream) / diverged / missing. The six
# workspace_status buckets are checked (a dirty+unpushed repo in BOTH, a
# clean-but-old repo as forgotten via a pinned today=, a missing path in Missing
# Local Path). Determinism + LF-only bytes + the §0 #9 path boundary are asserted.

import stat  # noqa: E402
import subprocess  # noqa: E402

_GIT = shutil.which("git")


def _rmtree_force(path):
    """shutil.rmtree that clears the read-only bit first -- git packs/objects are
    marked read-only on Windows, so a plain rmtree raises WinError 5. The onexc
    handler chmods the offending file +w and retries the unlink."""
    def _onerror(func, p, exc):
        try:
            os.chmod(p, stat.S_IWRITE)
            func(p)
        except OSError:
            pass
    # Python 3.12+ uses onexc; earlier uses onerror. Pass both compatibly. A
    # final failure is swallowed so a tearDown call site never raises.
    try:
        try:
            shutil.rmtree(path, onexc=lambda f, p, e: _onerror(f, p, e))
        except TypeError:
            shutil.rmtree(path, onerror=lambda f, p, e: _onerror(f, p, e))
    except OSError:
        pass


def _git(cwd, *args, check=True):
    """Run git in `cwd` for test SETUP (commits/remotes). Distinct from the
    READ-ONLY probes under test in workspace.py."""
    return subprocess.run(
        [_GIT, "-C", str(cwd), *args],
        capture_output=True, text=True, check=check,
    )


def _git_init(path: Path) -> Path:
    """git init a work repo with a LOCAL identity (so commits work in CI with no
    global git config) and a deterministic default branch name."""
    path.mkdir(parents=True, exist_ok=True)
    _git(path, "init", "-b", "main")
    _git(path, "config", "user.email", "ci@example.invalid")
    _git(path, "config", "user.name", "CI Bot")
    _git(path, "config", "commit.gpgsign", "false")
    return path


def _commit(path: Path, fname: str, content: str, msg: str,
            when: str | None = None) -> None:
    """Add a file and commit it. `when` (ISO) pins author+committer date so a
    'forgotten' (old last-commit) repo is deterministic."""
    (path / fname).write_bytes(content.encode("utf-8"))
    _git(path, "add", fname)
    env = None
    if when:
        env = dict(os.environ)
        env["GIT_AUTHOR_DATE"] = when
        env["GIT_COMMITTER_DATE"] = when
    subprocess.run(
        [_GIT, "-C", str(path), "commit", "-m", msg],
        capture_output=True, text=True, check=True, env=env,
    )


def _bare(path: Path) -> Path:
    """Create a bare repo to act as an upstream remote."""
    path.mkdir(parents=True, exist_ok=True)
    _git(path, "init", "--bare", "-b", "main")
    return path


@unittest.skipUnless(_GIT, "git not on PATH")
class RepoHealthStatesTest(unittest.TestCase):
    """repo_health() covers EACH state with real git repos."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9b-health-"))

    def tearDown(self):
        # Real git repos: rmtree must clear the read-only bit git sets on
        # packs/objects, else Windows leaks the whole tree (ignore_errors hides
        # the WinError 5). _rmtree_force handles that and never raises.
        _rmtree_force(self.tmp)

    def test_no_git_dir(self):
        d = self.tmp / "plain"
        d.mkdir()
        (d / "package.json").write_bytes(b"{}\n")
        h = workspace.repo_health(d)
        self.assertEqual(h["label"], "no-git")
        self.assertTrue(h["no_git"])
        self.assertFalse(workspace.is_git_repo(d))

    def test_git_no_remote_is_local_only(self):
        d = _git_init(self.tmp / "solo")
        _commit(d, "a.txt", "hi", "init")
        h = workspace.repo_health(d)
        self.assertEqual(h["label"], "local-only")
        self.assertTrue(h["local_only"])
        self.assertFalse(workspace.git_has_remote(d))
        self.assertFalse(h["dirty"])
        # a readable repo whose status probe succeeded ("" -> clean) is NOT a
        # probe error -- probe_error distinguishes 'confirmed clean' from
        # 'could not determine'.
        self.assertFalse(h["probe_error"])

    def test_clean_pushed_repo_is_clean(self):
        bare = _bare(self.tmp / "origin.git")
        d = _git_init(self.tmp / "work")
        _commit(d, "a.txt", "hi", "init")
        _git(d, "remote", "add", "origin", str(bare))
        _git(d, "push", "-u", "origin", "main")
        h = workspace.repo_health(d)
        self.assertEqual(h["label"], "clean")
        self.assertTrue(workspace.git_has_remote(d))
        self.assertEqual((h["ahead"], h["behind"]), (0, 0))
        self.assertFalse(h["no_upstream"])

    def test_uncommitted_change_sets_dirty(self):
        d = _git_init(self.tmp / "msgy")
        _commit(d, "a.txt", "hi", "init")
        (d / "a.txt").write_bytes(b"changed\n")  # uncommitted edit
        self.assertTrue(workspace.git_is_dirty(d))
        h = workspace.repo_health(d)
        self.assertTrue(h["dirty"])
        # no remote -> dirty label (dirty beats local-only in precedence).
        self.assertEqual(h["label"], "dirty")

    def test_commit_ahead_of_upstream_is_unpushed(self):
        bare = _bare(self.tmp / "origin.git")
        d = _git_init(self.tmp / "ahead")
        _commit(d, "a.txt", "hi", "init")
        _git(d, "remote", "add", "origin", str(bare))
        _git(d, "push", "-u", "origin", "main")
        _commit(d, "b.txt", "more", "second")  # 1 commit ahead, not pushed
        ahead, behind = workspace.git_ahead_behind(d)
        self.assertEqual((ahead, behind), (1, 0))
        h = workspace.repo_health(d)
        self.assertEqual(h["label"], "unpushed")

    def test_branch_with_remote_but_no_upstream_is_unpushed(self):
        bare = _bare(self.tmp / "origin.git")
        d = _git_init(self.tmp / "nou")
        _commit(d, "a.txt", "hi", "init")
        _git(d, "remote", "add", "origin", str(bare))
        # remote exists but the branch was never `push -u` -> no upstream.
        ahead, behind = workspace.git_ahead_behind(d)
        self.assertIsNone(ahead)  # the "no upstream" signal.
        h = workspace.repo_health(d)
        self.assertTrue(h["no_upstream"])
        self.assertFalse(h["local_only"])  # a remote DOES exist.
        self.assertEqual(h["label"], "unpushed")

    def test_ahead_and_behind_is_diverged(self):
        bare = _bare(self.tmp / "origin.git")
        # first clone-equivalent: repo A pushes a base commit.
        a = _git_init(self.tmp / "A")
        _commit(a, "a.txt", "base", "init")
        _git(a, "remote", "add", "origin", str(bare))
        _git(a, "push", "-u", "origin", "main")
        # repo B clones, both diverge from the shared base.
        b = self.tmp / "B"
        subprocess.run([_GIT, "clone", str(bare), str(b)],
                       capture_output=True, text=True, check=True)
        _git(b, "config", "user.email", "ci@example.invalid")
        _git(b, "config", "user.name", "CI Bot")
        # B commits + pushes -> origin advances.
        _commit(b, "b.txt", "from B", "B commit")
        _git(b, "push", "origin", "main")
        # A commits locally (now behind origin's B commit AND ahead of its own).
        _commit(a, "c.txt", "from A", "A commit")
        _git(a, "fetch", "origin")
        ahead, behind = workspace.git_ahead_behind(a)
        self.assertGreater(ahead, 0)
        self.assertGreater(behind, 0)
        h = workspace.repo_health(a)
        self.assertEqual(h["label"], "diverged")

    def test_missing_path_is_missing(self):
        gone = self.tmp / "does-not-exist"
        h = workspace.repo_health(gone)
        self.assertEqual(h["label"], "missing")
        self.assertTrue(h["missing"])
        self.assertEqual(workspace.local_presence(gone), "missing")

    def test_last_commit_date_is_iso(self):
        d = _git_init(self.tmp / "dated")
        _commit(d, "a.txt", "hi", "init", when="2026-01-15T10:00:00")
        iso = workspace.git_last_commit_date(d)
        self.assertIsNotNone(iso)
        self.assertTrue(iso.startswith("2026-01-15"))

    def test_probes_tolerate_non_repo_without_raising(self):
        # every probe must return a safe default on a non-repo, never raise.
        plain = self.tmp / "nope"
        plain.mkdir()
        self.assertFalse(workspace.is_git_repo(plain))
        self.assertFalse(workspace.git_has_remote(plain))
        self.assertFalse(workspace.git_is_dirty(plain))
        self.assertEqual(workspace.git_ahead_behind(plain), (None, None))
        self.assertIsNone(workspace.git_last_commit_date(plain))


@unittest.skipUnless(_GIT, "git not on PATH")
class WorkspaceStatusBucketsTest(unittest.TestCase):
    """workspace_status() places projects in the right §2 buckets, incl. a
    project appearing in MULTIPLE buckets at once."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9b-buckets-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        self.ws = self.tmp / "workspace"
        self.ws.mkdir()

    def tearDown(self):
        _rmtree_force(self.tmp)  # real git repos -> read-only-aware rmtree.

    def _adopt(self, entity: str, path: Path) -> None:
        workspace.adopt(str(self.vault), str(path), entity,
                        apply=True, today=TODAY)

    def test_dirty_unpushed_repo_in_both_buckets(self):
        # a repo that is BOTH dirty AND ahead of upstream -> appears in
        # Dirty/Forgotten AND Unpushed.
        bare = _bare(self.tmp / "o1.git")
        d = _git_init(self.ws / "both")
        _commit(d, "a.txt", "hi", "init")
        _git(d, "remote", "add", "origin", str(bare))
        _git(d, "push", "-u", "origin", "main")
        _commit(d, "b.txt", "more", "second")        # 1 ahead
        (d / "a.txt").write_bytes(b"dirty now\n")     # uncommitted edit
        self._adopt("project/both", d)
        st = workspace.workspace_status(str(self.vault), today=TODAY)
        unpushed = {r["entity"] for r in st["unpushed"]}
        dirty = {r["entity"] for r in st["dirty_forgotten"]}
        self.assertIn("project/both", unpushed)
        self.assertIn("project/both", dirty)

    def test_clean_but_old_repo_is_forgotten(self):
        # clean + pushed, but the last commit is way older than forgotten_days.
        bare = _bare(self.tmp / "o2.git")
        d = _git_init(self.ws / "old")
        _commit(d, "a.txt", "hi", "init", when="2026-01-01T09:00:00")
        _git(d, "remote", "add", "origin", str(bare))
        _git(d, "push", "-u", "origin", "main")
        self._adopt("project/old", d)
        # pin today far after the commit -> forgotten via age, not dirty.
        st = workspace.workspace_status(str(self.vault), today="2026-06-25",
                                        forgotten_days=30)
        dirty = {r["entity"]: r for r in st["dirty_forgotten"]}
        self.assertIn("project/old", dirty)
        why = dirty["project/old"]["why"]
        self.assertTrue(why["forgotten"])
        self.assertFalse(why["dirty"])
        self.assertGreater(why["age_days"], 30)

    def test_local_only_bucket(self):
        d = _git_init(self.ws / "solo")
        _commit(d, "a.txt", "hi", "init")
        self._adopt("project/solo", d)
        st = workspace.workspace_status(str(self.vault), today=TODAY)
        self.assertIn("project/solo", {r["entity"] for r in st["local_only"]})

    def test_missing_path_bucket(self):
        d = _git_init(self.ws / "ghost")
        _commit(d, "a.txt", "hi", "init")
        self._adopt("project/ghost", d)
        _rmtree_force(d)  # disk path now gone, binding remains.
        st = workspace.workspace_status(str(self.vault), today=TODAY)
        miss = {r["entity"] for r in st["missing_path"]}
        self.assertIn("project/ghost", miss)
        # a missing project lands ONLY in Missing Local Path.
        for bucket in ("local_only", "unpushed", "dirty_forgotten"):
            self.assertNotIn("project/ghost",
                             {r["entity"] for r in st[bucket]})

    def test_diverged_repo_in_unpushed_and_remote_drift_buckets(self):
        # a PURE diverged repo (ahead>0 AND behind>0, NOT dirty) must land in
        # Unpushed (it is ahead) AND in Remote Drift (the behind side -> a push
        # would be rejected). This pins the BUCKET contract -- not just the
        # repo_health() helper label asserted in RepoHealthStatesTest.
        bare = _bare(self.tmp / "od.git")
        a = _git_init(self.ws / "diva")
        _commit(a, "a.txt", "base", "init")
        _git(a, "remote", "add", "origin", str(bare))
        _git(a, "push", "-u", "origin", "main")
        # a second clone advances origin so A ends up behind as well as ahead.
        b = self.tmp / "divb"
        subprocess.run([_GIT, "clone", str(bare), str(b)],
                       capture_output=True, text=True, check=True)
        _git(b, "config", "user.email", "ci@example.invalid")
        _git(b, "config", "user.name", "CI Bot")
        _commit(b, "b.txt", "from B", "B commit")
        _git(b, "push", "origin", "main")
        _commit(a, "c.txt", "from A", "A commit")  # A now ahead AND behind
        _git(a, "fetch", "origin")
        self._adopt("project/diva", a)
        st = workspace.workspace_status(str(self.vault), today=TODAY)
        self.assertIn("project/diva", {r["entity"] for r in st["unpushed"]})
        self.assertIn("project/diva",
                      {r["entity"] for r in st["remote_drift"]})
        # NOT dirty -> it must not be force-fit into Dirty/Forgotten.
        self.assertNotIn("project/diva",
                         {r["entity"] for r in st["dirty_forgotten"]})
        # the rendered Remote Drift row surfaces BOTH ahead and behind counts.
        md = workspace.render_workspace_status(st)
        drift_section = md.split("## Remote Drift", 1)[1].split("##", 1)[0]
        self.assertIn("ahead", drift_section)
        self.assertIn("behind", drift_section)

    def test_board_unbound_always_lists_bound_projects(self):
        d = _git_init(self.ws / "x")
        _commit(d, "a.txt", "hi", "init")
        self._adopt("project/x", d)
        st = workspace.workspace_status(str(self.vault), today=TODAY)
        self.assertIn("project/x", {r["entity"] for r in st["board_unbound"]})
        # remote_drift carries only diverged repos now; a local-only repo is not
        # diverged -> it stays empty here.
        self.assertEqual(st["remote_drift"], [])

    def test_determinism_today_param_drives_forgotten(self):
        # the SAME repo is forgotten or not depending only on the pinned today.
        d = _git_init(self.ws / "pin")
        _commit(d, "a.txt", "hi", "init", when="2026-03-01T09:00:00")
        self._adopt("project/pin", d)
        near = workspace.workspace_status(str(self.vault), today="2026-03-10",
                                          forgotten_days=30)
        far = workspace.workspace_status(str(self.vault), today="2026-06-25",
                                         forgotten_days=30)
        self.assertNotIn("project/pin",
                         {r["entity"] for r in near["dirty_forgotten"]})
        self.assertIn("project/pin",
                      {r["entity"] for r in far["dirty_forgotten"]})


@unittest.skipUnless(_GIT, "git not on PATH")
class WorkspaceStatusRenderAndWriteTest(unittest.TestCase):
    """render + write: six sections, LF-only bytes, gitignored location, and the
    §0 #9 boundary (paths allowed in the machine-local report, NOT in shared
    Projects/*.md)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="vault-9b-render-"))
        self.vault = self.tmp / "vault"
        self.vault.mkdir()
        self.ws = self.tmp / "workspace"
        self.ws.mkdir()
        self.d = _git_init(self.ws / "renderme")
        _commit(self.d, "a.txt", "hi", "init")
        workspace.adopt(str(self.vault), str(self.d), "project/renderme",
                        apply=True, today=TODAY)

    def tearDown(self):
        _rmtree_force(self.tmp)  # real git repos -> read-only-aware rmtree.

    def test_render_has_all_six_sections(self):
        st = workspace.workspace_status(str(self.vault), today=TODAY)
        md = workspace.render_workspace_status(st)
        for heading in ("# Workspace Status", "## Local Only", "## Unpushed",
                        "## Dirty / Forgotten", "## Missing Local Path",
                        "## Board Unbound", "## Remote Drift",
                        "## Needs Recheck"):
            self.assertIn(heading, md)

    def test_dry_run_writes_nothing(self):
        before = sorted(os.listdir(self.vault))
        out = kb_meta.cmd_workspace_status(str(self.vault), apply=False,
                                           as_of=TODAY)
        self.assertFalse(out["apply"])
        self.assertEqual(out["written"], [])
        self.assertFalse((self.vault / ".vault-mind" /
                          "_workspace-status.md").exists())
        self.assertEqual(sorted(os.listdir(self.vault)), before)

    def test_apply_writes_lf_only_bytes_under_vault_mind(self):
        out = kb_meta.cmd_workspace_status(str(self.vault), apply=True,
                                           as_of=TODAY)
        self.assertTrue(out["apply"])
        p = self.vault / ".vault-mind" / "_workspace-status.md"
        self.assertTrue(p.exists())
        self.assertEqual(out["written"], [str(p)])
        raw = p.read_bytes()
        self.assertNotIn(b"\r", raw)  # LF-only.

    def test_machine_local_report_may_contain_path(self):
        # the report IS allowed to carry the machine path (it is gitignored).
        kb_meta.cmd_workspace_status(str(self.vault), apply=True, as_of=TODAY)
        p = self.vault / ".vault-mind" / "_workspace-status.md"
        text = p.read_text("utf-8")
        bound = workspace.load_bindings(str(self.vault))[
            "project/renderme"]["path"]
        self.assertIn(bound, text)  # path present in the local report.

    def test_path_does_not_leak_into_shared_projects_note(self):
        # §0 #9: the committed Projects/<slug>.md must carry NO machine path.
        kb_meta.cmd_workspace_status(str(self.vault), apply=True, as_of=TODAY)
        note = (self.vault / "Projects" / "renderme.md").read_text("utf-8")
        bound = workspace.load_bindings(str(self.vault))[
            "project/renderme"]["path"]
        for seg in bound.split("/"):
            if seg and seg != "renderme":
                self.assertNotIn(seg, note,
                                 f"path segment {seg!r} leaked into shared note")


class WorkspaceStatusParserTest(unittest.TestCase):
    """_parse_workspace_status_args: dry-run default + --as-of token consume."""

    def test_vault_only_dry_run_default(self):
        p = kb_meta._parse_workspace_status_args(["workspace-status", "/v"])
        self.assertEqual(p, {"vault": "/v", "apply": False, "as_of": None})

    def test_apply_and_as_of(self):
        p = kb_meta._parse_workspace_status_args(
            ["workspace-status", "/v", "--apply", "--as-of", "2026-06-25"])
        self.assertEqual(p, {"vault": "/v", "apply": True,
                             "as_of": "2026-06-25"})

    def test_missing_vault_raises(self):
        with self.assertRaises(IndexError):
            kb_meta._parse_workspace_status_args(["workspace-status"])

    def test_as_of_at_end_is_ignored_not_consuming_phantom(self):
        # '--as-of' with no following token must not crash; as_of stays None.
        p = kb_meta._parse_workspace_status_args(
            ["workspace-status", "/v", "--as-of"])
        self.assertIsNone(p["as_of"])


if __name__ == "__main__":
    unittest.main()
