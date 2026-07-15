#!/usr/bin/env python3
"""Exercise Obsidian plugin clean-install, upgrade, and rollback in an isolated vault.

The verifier is intentionally offline.  It accepts either release directories or
``.tar.gz``/``.zip`` artifacts, installs only Obsidian's three production files,
and boots the real ``main.js`` behind a narrow Obsidian API stub.  Mutable plugin
data and backend-owned Settings/Agent Domain state are hashed across every
transition so a package replacement cannot silently discard user state.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_ID = "vault-mind-promote"
RELEASE_FILES = ("main.js", "manifest.json", "styles.css")
PRESERVED_STATE_ROOTS = (
    Path(".obsidian") / "plugins" / PLUGIN_ID / "data.json",
    Path("_llmwiki") / "settings",
    Path("_llmwiki") / "agent-domain",
)
SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")


@dataclass(frozen=True)
class PluginPayload:
    source: str
    files: dict[str, bytes]
    manifest: dict[str, Any]

    @property
    def version(self) -> str:
        return str(self.manifest["version"])

    @property
    def digest(self) -> str:
        digest = hashlib.sha256()
        for name in RELEASE_FILES:
            digest.update(name.encode("utf-8"))
            digest.update(b"\0")
            digest.update(self.files[name])
            digest.update(b"\0")
        return f"sha256:{digest.hexdigest()}"


def _safe_member_name(name: str) -> PurePosixPath:
    normalized = PurePosixPath(name.replace("\\", "/"))
    if normalized.is_absolute() or ".." in normalized.parts:
        raise RuntimeError(f"unsafe archive member: {name}")
    return normalized


def _archive_release_files(entries: list[tuple[str, bytes]]) -> dict[str, bytes]:
    matches: dict[str, bytes] = {}
    for raw_name, data in entries:
        member = _safe_member_name(raw_name)
        if member.name not in RELEASE_FILES:
            continue
        if member.name in matches:
            raise RuntimeError(f"archive contains duplicate {member.name}")
        matches[member.name] = data
    return matches


def _read_tar(path: Path) -> dict[str, bytes]:
    entries: list[tuple[str, bytes]] = []
    with tarfile.open(path, "r:*") as archive:
        for member in archive.getmembers():
            _safe_member_name(member.name)
            if member.issym() or member.islnk():
                raise RuntimeError(f"archive contains a link: {member.name}")
            if not member.isfile():
                continue
            fileobj = archive.extractfile(member)
            if fileobj is None:
                raise RuntimeError(f"cannot read archive member: {member.name}")
            entries.append((member.name, fileobj.read()))
    return _archive_release_files(entries)


def _read_zip(path: Path) -> dict[str, bytes]:
    entries: list[tuple[str, bytes]] = []
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            _safe_member_name(info.filename)
            if info.is_dir():
                continue
            # Unix symlink bit in the upper 16 bits of external_attr.
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise RuntimeError(f"archive contains a link: {info.filename}")
            entries.append((info.filename, archive.read(info)))
    return _archive_release_files(entries)


def load_payload(source: Path) -> PluginPayload:
    source = source.expanduser().resolve()
    if source.is_dir():
        files = {
            name: (source / name).read_bytes()
            for name in RELEASE_FILES
            if (source / name).is_file()
        }
    elif source.is_file() and tarfile.is_tarfile(source):
        files = _read_tar(source)
    elif source.is_file() and zipfile.is_zipfile(source):
        files = _read_zip(source)
    else:
        raise RuntimeError(f"plugin payload must be a directory, tar archive, or zip archive: {source}")

    missing = sorted(set(RELEASE_FILES) - set(files))
    if missing:
        raise RuntimeError(f"plugin payload is missing required files: {', '.join(missing)}")
    if any(not files[name] for name in RELEASE_FILES):
        raise RuntimeError("plugin payload contains an empty production file")
    try:
        manifest = json.loads(files["manifest.json"].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"invalid manifest.json: {error}") from error
    if not isinstance(manifest, dict):
        raise RuntimeError("manifest.json must contain an object")
    if manifest.get("id") != PLUGIN_ID:
        raise RuntimeError(f"plugin id must stay {PLUGIN_ID} for upgrade compatibility")
    version = manifest.get("version")
    if not isinstance(version, str) or not SEMVER.fullmatch(version):
        raise RuntimeError(f"manifest version is not semver: {version!r}")
    if not isinstance(manifest.get("minAppVersion"), str):
        raise RuntimeError("manifest minAppVersion must be a string")
    if b"module.exports" not in files["main.js"] and b"exports.default" not in files["main.js"]:
        raise RuntimeError("main.js does not look like a loadable Obsidian CommonJS bundle")
    return PluginPayload(str(source), files, manifest)


def compare_semver(left: str, right: str) -> int:
    """Compare the semver subset accepted by the Obsidian manifest contract."""

    def split(value: str) -> tuple[tuple[int, int, int], list[str] | None]:
        without_build = value.split("+", 1)[0]
        core_text, separator, prerelease_text = without_build.partition("-")
        core = tuple(int(part) for part in core_text.split("."))
        return core, prerelease_text.split(".") if separator else None  # type: ignore[return-value]

    left_core, left_pre = split(left)
    right_core, right_pre = split(right)
    if left_core != right_core:
        return 1 if left_core > right_core else -1
    if left_pre is None or right_pre is None:
        if left_pre is right_pre:
            return 0
        return 1 if left_pre is None else -1
    for left_item, right_item in zip(left_pre, right_pre):
        if left_item == right_item:
            continue
        left_numeric = left_item.isdigit()
        right_numeric = right_item.isdigit()
        if left_numeric and right_numeric:
            return 1 if int(left_item) > int(right_item) else -1
        if left_numeric != right_numeric:
            return -1 if left_numeric else 1
        return 1 if left_item > right_item else -1
    if len(left_pre) == len(right_pre):
        return 0
    return 1 if len(left_pre) > len(right_pre) else -1


def _copy_preserved_entry(source: Path, destination: Path) -> None:
    if source.is_symlink():
        raise RuntimeError(f"refusing to preserve symlink from plugin directory: {source}")
    if source.is_dir():
        shutil.copytree(source, destination)
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


def install_payload(vault: Path, payload: PluginPayload) -> Path:
    """Replace a plugin directory as one rename while retaining mutable files."""

    plugin_parent = vault / ".obsidian" / "plugins"
    destination = plugin_parent / PLUGIN_ID
    plugin_parent.mkdir(parents=True, exist_ok=True)
    stage = plugin_parent / f".{PLUGIN_ID}.stage-{uuid.uuid4().hex}"
    backup = plugin_parent / f".{PLUGIN_ID}.backup-{uuid.uuid4().hex}"
    stage.mkdir()
    try:
        if destination.exists():
            for entry in destination.iterdir():
                if entry.name not in RELEASE_FILES:
                    _copy_preserved_entry(entry, stage / entry.name)
        for name in RELEASE_FILES:
            (stage / name).write_bytes(payload.files[name])

        if destination.exists():
            os.replace(destination, backup)
        try:
            os.replace(stage, destination)
        except Exception:
            if backup.exists() and not destination.exists():
                os.replace(backup, destination)
            raise
        if backup.exists():
            shutil.rmtree(backup)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
        if backup.exists() and destination.exists():
            shutil.rmtree(backup)
    return destination


def installed_release_digest(vault: Path) -> str:
    return load_payload(vault / ".obsidian" / "plugins" / PLUGIN_ID).digest


def _tree_digest(root: Path, relative: Path) -> dict[str, str]:
    path = root / relative
    if not path.exists():
        return {}
    files = [path] if path.is_file() else sorted(item for item in path.rglob("*") if item.is_file())
    return {
        item.relative_to(root).as_posix(): hashlib.sha256(item.read_bytes()).hexdigest()
        for item in files
    }


def snapshot_user_state(vault: Path) -> dict[str, str]:
    state: dict[str, str] = {}
    for relative in PRESERVED_STATE_ROOTS:
        state.update(_tree_digest(vault, relative))
    return dict(sorted(state.items()))


OBSIDIAN_STUB = r'''"use strict";
const fs = require("fs");
const path = require("path");

class FileSystemAdapter {
  constructor(basePath) { this.basePath = basePath; }
  getBasePath() { return this.basePath; }
}

class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
    this.__commands = [];
    this.__settingTabs = [];
  }
  async loadData() {
    const file = path.join(process.env.LLMWIKI_SMOKE_VAULT, ".obsidian", "plugins", this.manifest.id, "data.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  }
  async saveData(value) {
    const file = path.join(process.env.LLMWIKI_SMOKE_VAULT, ".obsidian", "plugins", this.manifest.id, "data.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
  }
  addCommand(command) { this.__commands.push(command); return command; }
  addSettingTab(tab) { this.__settingTabs.push(tab); return tab; }
  registerEvent(event) { return event; }
}

class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
class Modal { constructor(app) { this.app = app; this.contentEl = element(); } open() {} close() {} }
class Setting {
  constructor() {}
  setName() { return this; } setDesc() { return this; }
  addDropdown() { return this; } addToggle() { return this; }
  addText() { return this; } addExtraButton() { return this; }
}
class Notice { constructor(message) { this.message = message; } }
class TAbstractFile {}
class TFile extends TAbstractFile {}
class Menu {}
function element() { return { createEl: element, createDiv: element, addClass() {}, empty() {}, setText() {} }; }

module.exports = { FileSystemAdapter, Plugin, PluginSettingTab, Modal, Setting, Notice, TAbstractFile, TFile, Menu };
'''


BOOT_HARNESS = r'''"use strict";
const fs = require("fs");
const path = require("path");
const obsidian = require("obsidian");

async function main() {
  const vault = process.argv[2];
  const action = process.argv[3];
  const pluginDir = path.join(vault, ".obsidian", "plugins", "vault-mind-promote");
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8"));
  const adapter = new obsidian.FileSystemAdapter(vault);
  const app = {
    vault: { adapter },
    workspace: { getActiveFile: () => null, on: () => ({ type: "event-ref" }) },
  };
  const loaded = require(path.join(pluginDir, "main.js"));
  const PluginClass = loaded.default || loaded;
  if (typeof PluginClass !== "function") throw new Error("main.js has no plugin constructor");
  const plugin = new PluginClass(app, manifest);
  await plugin.onload();

  let profileIds = [];
  const client = plugin.agentControlPlaneClient;
  if (action === "seed-profile") {
    if (!client || typeof client.createProfile !== "function") throw new Error("candidate has no Agent control-plane client");
    await client.createProfile({
      profileId: "agent/upgrade-smoke",
      displayName: "Upgrade Smoke",
      role: "Release compatibility probe",
      responsibilities: ["Preserve user state across package transitions"],
      capabilityClaims: ["release-smoke"],
      constitution: { principles: ["No data loss"], instructions: ["Read before writing"] },
      defaultModelPolicy: { mode: "local", provider: "local", model: "fixture-model" },
      actor: "obsidian-control-plane",
    });
  }
  if (action === "seed-profile" || action === "verify-profile") {
    if (!client || typeof client.listProfiles !== "function") throw new Error("candidate has no Agent control-plane client");
    profileIds = (await client.listProfiles()).map(item => item.profileId);
    if (!profileIds.includes("agent/upgrade-smoke")) throw new Error("seed Agent Profile was not readable");
  }
  const dataFile = path.join(pluginDir, "data.json");
  const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  if (data.schemaVersion !== 2) throw new Error(`unexpected plugin data schema: ${data.schemaVersion}`);
  if (data.deviceBinding?.deviceId !== "qa-device") throw new Error("device binding was not retained");
  process.stdout.write(JSON.stringify({
    version: manifest.version,
    commandCount: plugin.__commands?.length || 0,
    settingTabCount: plugin.__settingTabs?.length || 0,
    settingsError: plugin.settingsError || null,
    profileIds,
    data,
  }));
}

main().catch(error => { console.error(error?.stack || String(error)); process.exit(1); });
'''


def make_runtime_stub(root: Path) -> Path:
    module = root / "runtime-stub" / "node_modules" / "obsidian" / "index.js"
    module.parent.mkdir(parents=True)
    module.write_text(OBSIDIAN_STUB, encoding="utf-8")
    harness = root / "runtime-stub" / "boot-plugin.cjs"
    harness.write_text(BOOT_HARNESS, encoding="utf-8")
    return harness


def boot_plugin(vault: Path, harness: Path, action: str = "load") -> dict[str, Any]:
    environment = os.environ.copy()
    node_modules = harness.parent / "node_modules"
    environment.update({
        "NODE_PATH": str(node_modules),
        "LLMWIKI_SMOKE_VAULT": str(vault),
        "LLMWIKI_DEVICE_ID": "qa-device",
        "LLMWIKI_SETTINGS_USER_PATH": str(vault / "_llmwiki" / "settings" / "user-device.json"),
    })
    process = subprocess.run(
        ["node", str(harness), str(vault), action],
        cwd=harness.parent,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=45,
    )
    if process.returncode:
        raise RuntimeError((process.stderr or process.stdout).strip())
    result = json.loads(process.stdout)
    if result.get("commandCount", 0) < 1 or result.get("settingTabCount", 0) < 1:
        raise RuntimeError(f"plugin boot did not register its Obsidian surface: {result}")
    return result


def _assert_state_unchanged(expected: dict[str, str], vault: Path, stage: str) -> None:
    actual = snapshot_user_state(vault)
    if actual != expected:
        missing = sorted(set(expected) - set(actual))
        added = sorted(set(actual) - set(expected))
        changed = sorted(path for path in set(actual) & set(expected) if actual[path] != expected[path])
        raise RuntimeError(
            f"user state changed during {stage}: missing={missing}, added={added}, changed={changed}"
        )


def verify(candidate_source: Path, baseline_source: Path) -> dict[str, Any]:
    candidate = load_payload(candidate_source)
    baseline = load_payload(baseline_source)
    if candidate.manifest["id"] != baseline.manifest["id"]:
        raise RuntimeError("candidate and baseline plugin IDs differ")
    if compare_semver(candidate.version, baseline.version) <= 0:
        raise RuntimeError(
            "candidate manifest.version must be newer than the installed baseline: "
            f"candidate={candidate.version}, baseline={baseline.version}"
        )

    results: list[dict[str, Any]] = []
    warnings: list[str] = []

    with tempfile.TemporaryDirectory(prefix="llmwiki-plugin-lifecycle-") as temp:
        root = Path(temp)
        vault = root / "vault"
        vault.mkdir()
        harness = make_runtime_stub(root)

        install_payload(vault, candidate)
        clean = boot_plugin(vault, harness, "seed-profile")
        if clean.get("settingsError") is not None:
            raise RuntimeError(f"candidate Settings control plane did not load: {clean['settingsError']}")
        if installed_release_digest(vault) != candidate.digest:
            raise RuntimeError("clean install bytes do not match the candidate payload")
        results.append({
            "stage": "clean-install-candidate",
            "ok": True,
            "version": candidate.version,
            "commands": clean["commandCount"],
            "settingsTabs": clean["settingTabCount"],
            "agentProfiles": clean["profileIds"],
        })

        # Establish a currently installed release against the same persistent
        # state.  This also proves the old package can ignore newer Agent state.
        install_payload(vault, baseline)
        old_boot = boot_plugin(vault, harness)
        if installed_release_digest(vault) != baseline.digest:
            raise RuntimeError("baseline install bytes do not match the baseline payload")
        baseline_state = snapshot_user_state(vault)
        if not baseline_state:
            raise RuntimeError("lifecycle fixture did not create any persistent user state")
        results.append({
            "stage": "baseline-start",
            "ok": True,
            "version": baseline.version,
            "commands": old_boot["commandCount"],
            "settingsTabs": old_boot["settingTabCount"],
            "stateFiles": len(baseline_state),
        })

        install_payload(vault, candidate)
        upgraded = boot_plugin(vault, harness, "verify-profile")
        if upgraded.get("settingsError") is not None:
            raise RuntimeError(f"upgraded Settings control plane did not load: {upgraded['settingsError']}")
        _assert_state_unchanged(baseline_state, vault, "candidate upgrade")
        results.append({
            "stage": "upgrade-candidate",
            "ok": True,
            "version": candidate.version,
            "agentProfiles": upgraded["profileIds"],
            "stateDigest": hashlib.sha256(json.dumps(baseline_state, sort_keys=True).encode()).hexdigest(),
        })

        install_payload(vault, baseline)
        rolled_back = boot_plugin(vault, harness)
        if installed_release_digest(vault) != baseline.digest:
            raise RuntimeError("rollback bytes do not match the exact baseline payload")
        _assert_state_unchanged(baseline_state, vault, "baseline rollback")
        results.append({
            "stage": "rollback-baseline",
            "ok": True,
            "version": baseline.version,
            "commands": rolled_back["commandCount"],
            "settingsTabs": rolled_back["settingTabCount"],
        })

        # A final candidate boot proves Agent state created before the rollback
        # remains readable after the older package has run against the vault.
        install_payload(vault, candidate)
        final_boot = boot_plugin(vault, harness, "verify-profile")
        if final_boot.get("settingsError") is not None:
            raise RuntimeError(f"candidate did not recover after rollback: {final_boot['settingsError']}")
        _assert_state_unchanged(baseline_state, vault, "post-rollback candidate reinstall")
        results.append({
            "stage": "post-rollback-candidate",
            "ok": True,
            "version": candidate.version,
            "agentProfiles": final_boot["profileIds"],
        })

    return {
        "ok": True,
        "candidate": {"source": candidate.source, "version": candidate.version, "digest": candidate.digest},
        "baseline": {"source": baseline.source, "version": baseline.version, "digest": baseline.digest},
        "warnings": warnings,
        "results": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--candidate",
        default=str(ROOT / "obsidian-plugin"),
        help="candidate plugin directory or release archive",
    )
    parser.add_argument("--baseline", required=True, help="installed/previous plugin directory or release archive")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    args = parser.parse_args()
    try:
        report = verify(Path(args.candidate), Path(args.baseline))
    except Exception as error:
        report = {"ok": False, "error": str(error)}
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"Plugin lifecycle verify: {'ok' if report['ok'] else 'failed'}")
        if report["ok"]:
            for item in report["results"]:
                print(f"OK {item['stage']}: {item}")
            for warning in report["warnings"]:
                print(f"WARNING: {warning}")
        else:
            print(f"ERROR: {report['error']}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
