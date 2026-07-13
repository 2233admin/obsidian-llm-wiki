from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

COMPILER = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures" / "project-context"
if str(COMPILER) not in sys.path:
    sys.path.insert(0, str(COMPILER))

import project_migration  # noqa: E402


def _snapshot(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*")) if path.is_file()
    }


class ProjectMigrationFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="project-migration-"))
        self.vault = self.tmp / "vault"
        (self.vault / "Projects").mkdir(parents=True)
        # Bare compatibility identities are explicit legacy identity, unlike a
        # path basename; migration can normalize them without guessing.
        (self.vault / "Projects" / "alpha.md").write_text(
            "---\nentity: alpha\ntype: project\nstatus: active\n"
            "aliases: [old-alpha]\n---\n"
            "\n# Alpha\n", encoding="utf-8")
        work_root = self.vault / "01-Projects" / "alpha"
        (work_root / "issues").mkdir(parents=True)
        (work_root / "_project.md").write_text(
            "---\nentity: alpha\ntype: project\nstatus: active\n---\n",
            encoding="utf-8")
        docket = self.vault / "10-Projects" / "alpha" / "docket" / "open"
        docket.mkdir(parents=True)
        (docket / "legacy-task.md").write_text(
            "---\ntype: issue\nstate: todo\n---\n\nLegacy task\n", encoding="utf-8")
        (self.vault / ".vault-mind").mkdir(parents=True)
        self.workspace = self.tmp / "workspaces" / "alpha"
        self.workspace.mkdir(parents=True)
        (self.vault / ".vault-mind" / "local-bindings.json").write_text(
            json.dumps({"alpha": {"path": self.workspace.as_posix()}}),
            encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_inventory_is_byte_preserving_and_reports_domain_ownership(self):
        before = _snapshot(self.vault)
        inventory = project_migration.inventory_project_layout(self.vault)
        self.assertEqual(_snapshot(self.vault), before)
        ownership = {item["ownership"] for item in inventory["domain_roots"]}
        self.assertEqual(ownership, {"work_os", "knowledge"})
        retired = [item for item in inventory["legacy_work"] if item.get("retired")]
        self.assertEqual(len(retired), 1)
        self.assertEqual(
            retired[0]["proposed_destination"],
            "01-Projects/alpha/issues/legacy-task.md",
        )

    def test_dry_run_plan_is_byte_preserving_and_complete(self):
        before = _snapshot(self.vault)
        plan = project_migration.plan_project_migration(self.vault)
        self.assertFalse(plan["apply"])
        self.assertEqual(_snapshot(self.vault), before)
        reasons = {item["reason"] for item in plan["actions"]}
        self.assertEqual(reasons, {
            "canonicalize_shared_project_id",
            "align_work_os_anchor_project_id",
            "canonicalize_local_binding_ids",
            "migrate_retired_docket_to_work_os",
        })
        self.assertEqual(plan["conflicts"], [])
        self.assertEqual(plan["retained_domain_ownership"]["10-Projects"], "knowledge")
        self.assertEqual(plan["redirects"][0]["mode"], "compatibility_read_only")

    def test_default_apply_is_noop(self):
        plan = project_migration.plan_project_migration(self.vault)
        before = _snapshot(self.vault)
        result = project_migration.apply_migration_plan(plan)
        self.assertFalse(result["apply"])
        self.assertEqual(_snapshot(self.vault), before)

    def test_apply_writes_canonical_records_and_manifest(self):
        plan = project_migration.plan_project_migration(self.vault)
        result = project_migration.apply_migration_plan(
            plan, apply=True, batch_id="batch-one")
        self.assertEqual(result["state"], "completed")
        self.assertTrue(Path(result["manifest_path"]).is_file())
        self.assertIn(
            "entity: project/alpha",
            (self.vault / "Projects" / "alpha.md").read_text("utf-8"),
        )
        self.assertIn(
            "entity: project/alpha",
            (self.vault / "01-Projects" / "alpha" / "_project.md").read_text("utf-8"),
        )
        bindings = json.loads(
            (self.vault / ".vault-mind" / "local-bindings.json").read_text("utf-8"))
        self.assertEqual(list(bindings), ["project/alpha"])
        migrated = self.vault / "01-Projects" / "alpha" / "issues" / "legacy-task.md"
        self.assertIn("entity: project/alpha/issue/legacy-task", migrated.read_text("utf-8"))
        # The retired docket is compatibility input only; apply never rewrites it.
        self.assertNotIn(
            str(self.vault / "10-Projects" / "alpha" / "docket"),
            result["written"],
        )

    def test_restore_recovers_original_bytes_and_removes_new_destination(self):
        before = _snapshot(self.vault)
        plan = project_migration.plan_project_migration(self.vault)
        applied = project_migration.apply_migration_plan(
            plan, apply=True, batch_id="restore-me")
        dry = project_migration.restore_migration(
            self.vault, applied["manifest_path"])
        self.assertFalse(dry["apply"])
        project_migration.restore_migration(
            self.vault, applied["manifest_path"], apply=True)
        after = _snapshot(self.vault)
        # Audit evidence remains; all pre-existing project data is byte-identical.
        after_project_data = {
            key: value for key, value in after.items()
            if not key.startswith(".vault-mind/project-migrations/")
        }
        self.assertEqual(after_project_data, before)

    def test_stale_precondition_rejects_before_project_writes(self):
        plan = project_migration.plan_project_migration(self.vault)
        anchor = self.vault / "01-Projects" / "alpha" / "_project.md"
        anchor.write_text(anchor.read_text("utf-8") + "changed\n", encoding="utf-8")
        before = _snapshot(self.vault)
        with self.assertRaises(project_migration.StalePrecondition):
            project_migration.apply_migration_plan(
                plan, apply=True, batch_id="stale-batch")
        self.assertEqual(_snapshot(self.vault), before)
        self.assertFalse(
            (self.vault / ".vault-mind" / "project-migrations" / "stale-batch").exists())

    def test_edit_injected_after_validation_is_not_overwritten(self):
        plan = project_migration.plan_project_migration(self.vault)
        anchor = self.vault / "01-Projects" / "alpha" / "_project.md"
        shared = self.vault / "Projects" / "alpha.md"
        shared_before = shared.read_bytes()
        original_validate = project_migration._validate_plan

        def validate_then_edit(*args, **kwargs):
            targets = original_validate(*args, **kwargs)
            anchor.write_text(
                anchor.read_text("utf-8") + "human edit after validation\n",
                encoding="utf-8",
            )
            return targets

        with mock.patch.object(
            project_migration, "_validate_plan", side_effect=validate_then_edit
        ):
            with self.assertRaisesRegex(
                project_migration.StalePrecondition, "drifted before backup"
            ):
                project_migration.apply_migration_plan(
                    plan, apply=True, batch_id="post-validation-drift"
                )

        self.assertIn("human edit after validation", anchor.read_text("utf-8"))
        self.assertEqual(shared.read_bytes(), shared_before)
        self.assertFalse(
            (self.vault / ".vault-mind" / "project-migrations" /
             "post-validation-drift" / "manifest.json").exists()
        )

    def test_old_migration_lock_is_fail_closed_and_not_reclaimed(self):
        plan = project_migration.plan_project_migration(self.vault)
        shared = self.vault / "Projects" / "alpha.md"
        before = shared.read_bytes()
        lock_path = (
            self.vault / ".vault-mind" / "project-migrations" / "_migration.lock"
        )
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        lock_path.write_text("old-runtime-owner", encoding="utf-8")
        os.utime(lock_path, (1, 1))

        with self.assertRaisesRegex(project_migration.MigrationBusy, "recorded owner"):
            project_migration.apply_migration_plan(
                plan, apply=True, batch_id="blocked-by-old-lock"
            )

        self.assertEqual(shared.read_bytes(), before)
        self.assertEqual(lock_path.read_text("utf-8"), "old-runtime-owner")

    def test_path_escape_is_rejected(self):
        plan = project_migration.plan_project_migration(self.vault)
        plan["actions"][0]["path"] = "../escaped.md"
        with self.assertRaises(project_migration.PathEscape):
            project_migration.apply_migration_plan(
                plan, apply=True, batch_id="escape-batch")
        self.assertFalse((self.tmp / "escaped.md").exists())

    def test_repeated_apply_is_idempotent_and_verifies_completed_hashes(self):
        plan = project_migration.plan_project_migration(self.vault)
        first = project_migration.apply_migration_plan(
            plan, apply=True, batch_id="repeat")
        second = project_migration.apply_migration_plan(
            plan, apply=True, batch_id="repeat")
        self.assertEqual(second["state"], "completed")
        self.assertEqual(second["plan_hash"], first["plan_hash"])

    def test_apply_resumes_replace_completed_before_manifest_update(self):
        plan = project_migration.plan_project_migration(self.vault)
        applied = project_migration.apply_migration_plan(
            plan, apply=True, batch_id="resume")
        manifest_path = Path(applied["manifest_path"])
        manifest = json.loads(manifest_path.read_text("utf-8"))
        manifest["state"] = "applying"
        manifest["actions"][0]["status"] = "pending"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        resumed = project_migration.apply_migration_plan(
            plan, apply=True, batch_id="resume")
        self.assertEqual(resumed["state"], "completed")
        self.assertTrue(all(action["status"] == "completed"
                            for action in resumed["actions"]))

    def test_duplicate_alias_is_a_review_required_conflict(self):
        (self.vault / "Projects" / "beta.md").write_text(
            "---\nentity: project/beta\nstatus: active\n"
            "aliases: [old-alpha]\n---\n", encoding="utf-8")
        plan = project_migration.plan_project_migration(self.vault)
        self.assertIn("duplicate_alias", {item["code"] for item in plan["conflicts"]})
        with self.assertRaises(project_migration.MigrationConflict):
            project_migration.apply_migration_plan(
                plan, apply=True, batch_id="conflict-batch")

    def test_path_basename_is_evidence_not_project_identity(self):
        record = self.vault / "Projects" / "alpha.md"
        record.write_text(
            "---\ntype: project\nstatus: active\n---\n", encoding="utf-8")
        plan = project_migration.plan_project_migration(self.vault)
        unresolved = [item for item in plan["conflicts"]
                      if item["code"] == "unresolved_project_identity"]
        self.assertEqual(unresolved[0]["path_basename_evidence"], "alpha")
        self.assertNotIn(
            "canonicalize_shared_project_id",
            {action["reason"] for action in plan["actions"]},
        )

    def test_tampered_plan_content_is_rejected(self):
        plan = project_migration.plan_project_migration(self.vault)
        plan["actions"][0]["content"] += "tampered"
        with self.assertRaises(project_migration.MigrationConflict):
            project_migration.apply_migration_plan(
                plan, apply=True, batch_id="tampered-content")

    def test_restore_rejects_post_migration_drift(self):
        plan = project_migration.plan_project_migration(self.vault)
        applied = project_migration.apply_migration_plan(
            plan, apply=True, batch_id="restore-drift")
        record = self.vault / "Projects" / "alpha.md"
        record.write_text(record.read_text("utf-8") + "human edit\n", encoding="utf-8")
        with self.assertRaises(project_migration.StalePrecondition):
            project_migration.restore_migration(
                self.vault, applied["manifest_path"], apply=True)

    def test_restore_edit_injected_after_validation_is_not_overwritten(self):
        plan = project_migration.plan_project_migration(self.vault)
        applied = project_migration.apply_migration_plan(
            plan, apply=True, batch_id="restore-post-validation-drift"
        )
        manifest_path = Path(applied["manifest_path"])
        manifest = json.loads(manifest_path.read_text("utf-8"))
        first_entry = next(
            entry for entry in reversed(manifest["actions"])
            if entry["status"] == "completed"
        )
        target = self.vault / first_entry["path"]
        original_atomic_json = project_migration._atomic_json
        injected = False

        def write_manifest_then_edit(path, value):
            nonlocal injected
            original_atomic_json(path, value)
            if path == manifest_path and value.get("state") == "restoring" and not injected:
                target.write_bytes(target.read_bytes() + b"human edit after restore validation\n")
                injected = True

        with mock.patch.object(
            project_migration, "_atomic_json", side_effect=write_manifest_then_edit
        ):
            with self.assertRaisesRegex(
                project_migration.StalePrecondition, "drifted before restore"
            ):
                project_migration.restore_migration(
                    self.vault, manifest_path, apply=True
                )

        self.assertTrue(target.read_bytes().endswith(b"human edit after restore validation\n"))
        persisted = json.loads(manifest_path.read_text("utf-8"))
        self.assertEqual(persisted["state"], "restoring")

    def test_restore_is_blocked_by_concurrent_migration_lock(self):
        plan = project_migration.plan_project_migration(self.vault)
        applied = project_migration.apply_migration_plan(
            plan, apply=True, batch_id="restore-concurrent-lock"
        )
        lock_path = (
            self.vault / ".vault-mind" / "project-migrations" / "_migration.lock"
        )
        lock_path.write_text("other-runtime", encoding="utf-8")

        with self.assertRaises(project_migration.MigrationBusy):
            project_migration.restore_migration(
                self.vault, applied["manifest_path"], apply=True
            )

        self.assertEqual(lock_path.read_text("utf-8"), "other-runtime")

    def test_restore_resumes_replace_completed_before_manifest_receipt(self):
        before = _snapshot(self.vault)
        plan = project_migration.plan_project_migration(self.vault)
        applied = project_migration.apply_migration_plan(
            plan, apply=True, batch_id="restore-resume-receipt"
        )
        manifest_path = Path(applied["manifest_path"])
        original_atomic_json = project_migration._atomic_json
        failed_once = False

        def fail_first_completed_receipt(path, value):
            nonlocal failed_once
            if (
                path == manifest_path
                and value.get("state") == "restoring"
                and any(
                    entry.get("restore_status") == "completed"
                    for entry in value.get("actions", [])
                )
                and not failed_once
            ):
                failed_once = True
                raise OSError("simulated manifest receipt failure")
            original_atomic_json(path, value)

        with mock.patch.object(
            project_migration, "_atomic_json", side_effect=fail_first_completed_receipt
        ):
            with self.assertRaisesRegex(OSError, "receipt failure"):
                project_migration.restore_migration(
                    self.vault, manifest_path, apply=True
                )

        resumed = project_migration.restore_migration(
            self.vault, manifest_path, apply=True
        )
        self.assertTrue(resumed["apply"])
        persisted = json.loads(manifest_path.read_text("utf-8"))
        self.assertEqual(persisted["state"], "restored")
        self.assertTrue(all(
            entry.get("restore_status") == "completed"
            for entry in persisted["actions"] if entry.get("status") == "completed"
        ))
        after = _snapshot(self.vault)
        after_project_data = {
            key: value for key, value in after.items()
            if not key.startswith(".vault-mind/project-migrations/")
        }
        self.assertEqual(after_project_data, before)

    def test_anchor_only_project_is_hash_guarded_adopted_and_restorable(self):
        record = self.vault / "Projects" / "alpha.md"
        record.unlink()
        anchor = self.vault / "01-Projects" / "alpha" / "_project.md"
        anchor.write_text(
            "---\nentity: project/alpha\ntype: project\nstatus: active\n---\n\n# Alpha Work\n",
            encoding="utf-8",
        )
        anchor_before = anchor.read_bytes()

        inventory = project_migration.inventory_project_layout(self.vault)
        self.assertEqual(inventory["counts"]["shared_records"], 0)
        plan = project_migration.plan_project_migration(self.vault)
        adoption = next(
            action for action in plan["actions"]
            if action["reason"] == "adopt_work_os_anchor_as_shared_project"
        )
        self.assertEqual(adoption["path"], "Projects/alpha.md")
        self.assertIsNone(adoption["expected_hash"])
        self.assertEqual(adoption["source"], "01-Projects/alpha/_project.md")
        self.assertEqual(adoption["source_hash"], project_migration.file_hash(anchor))
        self.assertEqual(plan["conflicts"], [])

        applied = project_migration.apply_migration_plan(
            plan, apply=True, batch_id="anchor-only")
        self.assertIn("entity: project/alpha", record.read_text("utf-8"))
        self.assertIn("type: project", record.read_text("utf-8"))
        resolved = project_migration.project_context.resolve_project_context(
            self.vault, "project/alpha")
        self.assertEqual(resolved["project_id"], "project/alpha")
        manifest = json.loads(Path(applied["manifest_path"]).read_text("utf-8"))
        entry = next(item for item in manifest["actions"] if item["path"] == "Projects/alpha.md")
        self.assertIsNone(entry["before_hash"])
        self.assertIsNone(entry["backup"])

        project_migration.restore_migration(
            self.vault, applied["manifest_path"], apply=True)
        self.assertFalse(record.exists())
        self.assertEqual(anchor.read_bytes(), anchor_before)

    def test_anchor_adoption_resumes_after_anchor_alignment_completed_first(self):
        record = self.vault / "Projects" / "alpha.md"
        record.unlink()
        anchor = self.vault / "01-Projects" / "alpha" / "_project.md"
        anchor.write_text(
            "---\nentity: alpha\ntype: project\nstatus: active\n---\n\n# Alpha Work\n",
            encoding="utf-8",
        )
        plan = project_migration.plan_project_migration(self.vault)
        reasons = [action["reason"] for action in plan["actions"]]
        self.assertIn("align_work_os_anchor_project_id", reasons)
        self.assertIn("adopt_work_os_anchor_as_shared_project", reasons)

        applied = project_migration.apply_migration_plan(
            plan, apply=True, batch_id="anchor-resume")
        manifest_path = Path(applied["manifest_path"])
        manifest = json.loads(manifest_path.read_text("utf-8"))
        adoption = next(
            entry for entry in manifest["actions"]
            if entry["reason"] == "adopt_work_os_anchor_as_shared_project"
        )
        adoption["status"] = "pending"
        manifest["state"] = "applying"
        record.unlink()
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        resumed = project_migration.apply_migration_plan(
            plan, apply=True, batch_id="anchor-resume")
        self.assertEqual(resumed["state"], "completed")
        self.assertTrue(record.is_file())
        self.assertIn("entity: project/alpha", anchor.read_text("utf-8"))

    def test_anchor_identity_conflicting_with_registry_alias_requires_review(self):
        (self.vault / "Projects" / "alpha.md").unlink()
        (self.vault / "01-Projects" / "alpha" / "_project.md").write_text(
            "---\nentity: project/alpha\ntype: project\nstatus: active\n---\n",
            encoding="utf-8",
        )
        (self.vault / "Projects" / "beta.md").write_text(
            "---\nentity: project/beta\ntype: project\nlifecycle: active\n"
            "aliases: [alpha]\n---\n",
            encoding="utf-8",
        )

        plan = project_migration.plan_project_migration(self.vault)
        conflicts = [item for item in plan["conflicts"]
                     if item["code"] == "anchor_identity_conflicts_with_registry_alias"]
        self.assertEqual(conflicts[0]["project_id"], "project/alpha")
        self.assertNotIn(
            "adopt_work_os_anchor_as_shared_project",
            {action["reason"] for action in plan["actions"]},
        )
        before = _snapshot(self.vault)
        with self.assertRaises(project_migration.MigrationConflict):
            project_migration.apply_migration_plan(
                plan, apply=True, batch_id="anchor-conflict")
        self.assertEqual(_snapshot(self.vault), before)

    def test_current_repository_anchor_is_planned_for_shared_registry_adoption(self):
        repository = Path(__file__).resolve().parents[2]
        plan = project_migration.plan_project_migration(repository)
        adoption = next(
            action for action in plan["actions"]
            if action["path"] == "Projects/obsidian-llm-wiki.md"
        )
        self.assertEqual(adoption["reason"], "adopt_work_os_anchor_as_shared_project")
        self.assertEqual(adoption["source"], "01-Projects/obsidian-llm-wiki/_project.md")


if __name__ == "__main__":
    unittest.main()
