import json
import tempfile
import unittest
from pathlib import Path

from verify_obsidian_distribution import verify


class DistributionContractTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        plugin = self.root / "obsidian-plugin"
        plugin.mkdir()
        manifest = {"version": "1.2.3-beta.1", "minAppVersion": "1.4.0"}
        versions = {"1.2.3-beta.1": "1.4.0"}
        for path, value in (
            (self.root / "manifest.json", manifest),
            (plugin / "manifest.json", manifest),
            (self.root / "versions.json", versions),
            (plugin / "versions.json", versions),
        ):
            path.write_text(json.dumps(value))
        self.assets = self.root / "dist"
        self.assets.mkdir()
        for name in ("main.js", "styles.css"):
            (self.assets / name).write_text("")
        (self.assets / "manifest.json").write_text(json.dumps(manifest))

    def tearDown(self):
        self.temp.cleanup()

    def test_valid_contract(self):
        verify(self.root, "1.2.3-beta.1", self.assets)

    def test_tag_must_match_manifest(self):
        with self.assertRaisesRegex(AssertionError, "exactly match"):
            verify(self.root, "v1.2.3-beta.1", self.assets)


if __name__ == "__main__":
    unittest.main()
