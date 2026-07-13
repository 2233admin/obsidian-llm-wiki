from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

COMPILER = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures" / "project-context"
if str(COMPILER) not in sys.path:
    sys.path.insert(0, str(COMPILER))

import project_context  # noqa: E402


class ProjectIdentityTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = json.loads((FIXTURES / "identity-cases.json").read_text("utf-8"))

    def test_exact_identity_conformance(self):
        for case in self.cases["accepted"]:
            with self.subTest(case=case):
                self.assertEqual(project_context.parse_project_id(case["input"]), {
                    "project_id": case["project_id"], "slug": case["slug"]})

    def test_bare_compatibility_is_explicit(self):
        for case in self.cases["bare_compatibility"]:
            with self.subTest(case=case):
                self.assertEqual(
                    project_context.normalize_project_id(case["input"], allow_bare=True),
                    case["project_id"],
                )

    def test_rejected_identity_conformance(self):
        for value in self.cases["rejected"]:
            with self.subTest(value=value):
                with self.assertRaises(project_context.InvalidProjectId):
                    project_context.parse_project_id(value)


class ProjectContextFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="project-context-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects").mkdir(parents=True)
        (self.vault / "01-Projects" / "alpha").mkdir(parents=True)
        (self.vault / "10-Projects" / "alpha").mkdir(parents=True)
        (self.vault / ".vault-mind").mkdir(parents=True)
        shutil.copyfile(FIXTURES / "shared-project.md",
                        self.vault / "Projects" / "alpha.md")
        shutil.copyfile(FIXTURES / "work-anchor.md",
                        self.vault / "01-Projects" / "alpha" / "_project.md")
        self.workspace = self.tmp / "workspaces" / "renamed-alpha"
        self.workspace.mkdir(parents=True)
        (self.vault / ".vault-mind" / "local-bindings.json").write_text(
            json.dumps({"project/alpha": {"path": self.workspace.as_posix()}}),
            encoding="utf-8",
        )

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_exact_id_resolves_all_domain_roots(self):
        context = project_context.resolve_project_context(self.vault, "project/alpha")
        self.assertEqual(context["project_id"], "project/alpha")
        self.assertEqual(context["resolved_by"], "project_id")
        self.assertEqual(context["lifecycle"], "active")
        self.assertEqual(context["roots"], {
            "registry_record": "Projects/alpha.md",
            "work_os": "01-Projects/alpha",
            "knowledge": "10-Projects/alpha",
            "runtime": ".vault-mind",
        })
        self.assertEqual(context["projections"], [
            {"kind": "github", "target": "acme/alpha"},
            {"kind": "linear", "target": "ALPHA"},
        ])

    def test_normalized_context_matches_cross_runtime_fixture(self):
        context = project_context.resolve_project_context(self.vault, "project/alpha")
        expected = json.loads((FIXTURES / "expected-context.json").read_text("utf-8"))
        self.assertEqual(project_context.normalized_project_context(context), expected)

    def test_alias_and_slug_are_compatibility_matches(self):
        for reference, kind in (("alpha", "slug"), ("legacy-alpha", "alias")):
            with self.subTest(reference=reference):
                context = project_context.resolve_project_context(self.vault, reference)
                self.assertEqual(context["resolved_by"], kind)
                self.assertIn("compatibility_project_reference", {
                    item["code"] for item in context["diagnostics"]})

    def test_workspace_path_resolves_without_becoming_identity(self):
        context = project_context.resolve_project_context(self.vault, self.workspace)
        self.assertEqual(context["project_id"], "project/alpha")
        self.assertEqual(context["resolved_by"], "workspace_binding")
        self.assertTrue(context["workspace_binding"]["available"])

    def test_unknown_is_read_only(self):
        before = sorted(path.relative_to(self.vault).as_posix()
                        for path in self.vault.rglob("*"))
        with self.assertRaises(project_context.ProjectNotFound):
            project_context.resolve_project_context(self.vault, "unknown")
        after = sorted(path.relative_to(self.vault).as_posix()
                       for path in self.vault.rglob("*"))
        self.assertEqual(after, before)

    def test_ambiguous_alias_never_selects_first(self):
        (self.vault / "Projects" / "beta.md").write_text(
            "---\nentity: project/beta\ntype: project\nstatus: active\n"
            "aliases: [legacy-alpha]\n---\n",
            encoding="utf-8",
        )
        with self.assertRaises(project_context.AmbiguousProjectReference) as raised:
            project_context.resolve_project_context(self.vault, "legacy-alpha")
        self.assertEqual(raised.exception.candidates, ["project/alpha", "project/beta"])

    def test_shared_record_ignores_machine_path_and_secret_fields(self):
        note = self.vault / "Projects" / "unsafe.md"
        note.write_text(
            "---\nentity: project/unsafe\nstatus: active\npath: C:/private\n"
            "token: never-return-this\n---\n", encoding="utf-8")
        record = project_context.read_shared_project_record(note)
        self.assertNotEqual(record["path"], "C:/private")
        self.assertNotIn("token", record)
        self.assertEqual(
            sum(item["code"] == "forbidden_shared_field"
                for item in record["diagnostics"]), 2)

    def test_doctor_reports_stale_binding_and_orphan_root(self):
        missing = self.tmp / "gone"
        (self.vault / ".vault-mind" / "local-bindings.json").write_text(
            json.dumps({"project/alpha": {"path": missing.as_posix()}}),
            encoding="utf-8",
        )
        (self.vault / "10-Projects" / "orphan").mkdir()
        findings = project_context.doctor_project_context(self.vault)["findings"]
        codes = {item["code"] for item in findings}
        self.assertIn("stale_workspace_binding", codes)
        self.assertIn("orphan_domain_root", codes)

    def test_doctor_reports_cross_runtime_anchor_disagreement(self):
        anchor = self.vault / "01-Projects" / "alpha" / "_project.md"
        anchor.write_text("---\nentity: project/beta\n---\n", encoding="utf-8")
        findings = project_context.doctor_project_context(self.vault)["findings"]
        self.assertIn("cross_runtime_identity_disagreement",
                      {item["code"] for item in findings})


if __name__ == "__main__":
    unittest.main()
