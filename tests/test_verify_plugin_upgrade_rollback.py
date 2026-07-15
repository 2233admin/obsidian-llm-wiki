from __future__ import annotations

import importlib.util
import io
import json
import sys
import tarfile
from pathlib import Path

import pytest


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "verify_plugin_upgrade_rollback.py"
SPEC = importlib.util.spec_from_file_location("verify_plugin_upgrade_rollback", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
verify_plugin = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = verify_plugin
SPEC.loader.exec_module(verify_plugin)


FAKE_PLUGIN = r'''"use strict";
const fs = require("fs");
const path = require("path");
const { Plugin } = require("obsidian");
class FakePlugin extends Plugin {
  async onload() {
    let data = await this.loadData();
    if (!data) {
      data = {
        schemaVersion: 2,
        presentation: { selectedScope: "user-device", showAdvanced: false },
        deviceBinding: { deviceId: "qa-device" },
      };
      await this.saveData(data);
    }
    this.data = data;
    this.settingsError = null;
    this.addCommand({ id: "fake-command" });
    this.addSettingTab({ id: "fake-settings" });
    const profileFile = path.join(process.env.LLMWIKI_SMOKE_VAULT, "_llmwiki", "agent-domain", "v1", "profiles.json");
    const settingsFile = path.join(process.env.LLMWIKI_SMOKE_VAULT, "_llmwiki", "settings", "user-device.json");
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, JSON.stringify({ schemaVersion: 1, revision: 0 }) + "\n");
    this.agentControlPlaneClient = {
      createProfile: async input => {
        fs.mkdirSync(path.dirname(profileFile), { recursive: true });
        fs.writeFileSync(profileFile, JSON.stringify([{ profileId: input.profileId }]) + "\n");
        return { status: "committed", record: input };
      },
      listProfiles: async () => fs.existsSync(profileFile) ? JSON.parse(fs.readFileSync(profileFile, "utf8")) : [],
    };
  }
}
module.exports = { default: FakePlugin };
'''


def make_payload(root: Path, *, version: str = "0.3.0", marker: str = "candidate") -> Path:
    root.mkdir(parents=True)
    (root / "main.js").write_text(FAKE_PLUGIN + f"\n// {marker}\n", encoding="utf-8")
    (root / "manifest.json").write_text(
        json.dumps(
            {
                "id": verify_plugin.PLUGIN_ID,
                "name": "LLM Wiki",
                "version": version,
                "minAppVersion": "1.4.0",
                "isDesktopOnly": True,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (root / "styles.css").write_text(f"/* {marker} */\n", encoding="utf-8")
    return root


def make_tar(source: Path, destination: Path, prefix: str = "") -> Path:
    with tarfile.open(destination, "w:gz") as archive:
        for name in verify_plugin.RELEASE_FILES:
            archive.add(source / name, arcname=f"{prefix}{name}")
    return destination


def test_load_payload_accepts_release_directory_and_nested_archive(tmp_path: Path) -> None:
    source = make_payload(tmp_path / "source")
    archive = make_tar(source, tmp_path / "plugin.tar.gz", "dist/plugin/")

    direct = verify_plugin.load_payload(source)
    packaged = verify_plugin.load_payload(archive)

    assert direct.manifest["id"] == verify_plugin.PLUGIN_ID
    assert direct.digest == packaged.digest
    assert packaged.version == "0.3.0"


def test_load_payload_rejects_archive_traversal_even_outside_release_files(tmp_path: Path) -> None:
    source = make_payload(tmp_path / "source")
    unsafe = tmp_path / "unsafe-rewritten.tar.gz"
    with tarfile.open(unsafe, "w:gz") as output:
        for name in verify_plugin.RELEASE_FILES:
            output.add(source / name, arcname=name)
        info = tarfile.TarInfo("../outside.txt")
        payload = b"must never extract\n"
        info.size = len(payload)
        output.addfile(info, io.BytesIO(payload))

    with pytest.raises(RuntimeError, match="unsafe archive member"):
        verify_plugin.load_payload(unsafe)


def test_install_payload_preserves_mutable_plugin_files_and_replaces_only_release_bytes(tmp_path: Path) -> None:
    baseline = verify_plugin.load_payload(make_payload(tmp_path / "baseline", marker="old"))
    candidate = verify_plugin.load_payload(make_payload(tmp_path / "candidate", marker="new"))
    vault = tmp_path / "vault"

    destination = verify_plugin.install_payload(vault, baseline)
    (destination / "data.json").write_text('{"user":"sentinel"}\n', encoding="utf-8")
    (destination / "cache" / "nested").mkdir(parents=True)
    (destination / "cache" / "nested" / "keep.txt").write_text("keep\n", encoding="utf-8")

    verify_plugin.install_payload(vault, candidate)

    assert verify_plugin.installed_release_digest(vault) == candidate.digest
    assert (destination / "data.json").read_text(encoding="utf-8") == '{"user":"sentinel"}\n'
    assert (destination / "cache" / "nested" / "keep.txt").read_text(encoding="utf-8") == "keep\n"
    assert not list((vault / ".obsidian" / "plugins").glob(f".{verify_plugin.PLUGIN_ID}.*-*"))


def test_install_rejects_bad_payload_before_touching_installed_plugin(tmp_path: Path) -> None:
    baseline_dir = make_payload(tmp_path / "baseline")
    baseline = verify_plugin.load_payload(baseline_dir)
    vault = tmp_path / "vault"
    verify_plugin.install_payload(vault, baseline)
    before = verify_plugin.installed_release_digest(vault)
    (baseline_dir / "styles.css").unlink()

    with pytest.raises(RuntimeError, match="missing required files"):
        verify_plugin.load_payload(baseline_dir)

    assert verify_plugin.installed_release_digest(vault) == before


def test_current_candidate_bundle_boots_with_settings_and_agent_state(tmp_path: Path) -> None:
    candidate = verify_plugin.load_payload(MODULE_PATH.parents[1] / "obsidian-plugin")
    vault = tmp_path / "vault"
    vault.mkdir()
    harness = verify_plugin.make_runtime_stub(tmp_path)

    verify_plugin.install_payload(vault, candidate)
    report = verify_plugin.boot_plugin(vault, harness, "seed-profile")

    assert report["settingsError"] is None
    assert report["profileIds"] == ["agent/upgrade-smoke"]
    assert report["commandCount"] >= 3
    assert report["settingTabCount"] >= 1


def test_verify_exercises_clean_install_upgrade_rollback_and_agent_state_recovery(tmp_path: Path) -> None:
    baseline = make_payload(tmp_path / "baseline", marker="old")
    candidate = make_payload(tmp_path / "candidate", version="0.4.0-beta.1", marker="new")

    report = verify_plugin.verify(candidate, baseline)

    assert report["ok"] is True
    assert [item["stage"] for item in report["results"]] == [
        "clean-install-candidate",
        "baseline-start",
        "upgrade-candidate",
        "rollback-baseline",
        "post-rollback-candidate",
    ]
    assert report["results"][0]["agentProfiles"] == ["agent/upgrade-smoke"]
    assert report["results"][-1]["agentProfiles"] == ["agent/upgrade-smoke"]
    assert report["warnings"] == []


def test_verify_rejects_same_or_older_candidate_version(tmp_path: Path) -> None:
    baseline = make_payload(tmp_path / "baseline", version="0.3.0", marker="old")
    same = make_payload(tmp_path / "same", version="0.3.0", marker="same")
    older = make_payload(tmp_path / "older", version="0.2.9", marker="older")

    with pytest.raises(RuntimeError, match="manifest.version must be newer"):
        verify_plugin.verify(same, baseline)
    with pytest.raises(RuntimeError, match="manifest.version must be newer"):
        verify_plugin.verify(older, baseline)


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [
        ("0.4.0-beta.1", "0.3.0", 1),
        ("0.4.0-beta.2", "0.4.0-beta.1", 1),
        ("0.4.0", "0.4.0-beta.2", 1),
        ("0.4.0-beta.1", "0.4.0", -1),
        ("0.4.0-beta.1", "0.4.0-beta.1", 0),
    ],
)
def test_compare_semver(left: str, right: str, expected: int) -> None:
    assert verify_plugin.compare_semver(left, right) == expected
