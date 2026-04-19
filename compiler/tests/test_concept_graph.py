from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import concept_graph as cg


class ExtractWikilinksTest(unittest.TestCase):
    def test_plain(self) -> None:
        self.assertEqual(cg.extract_wikilinks("see [[Foo]] and [[Bar]]"), ["Foo", "Bar"])

    def test_strip_heading_and_alias(self) -> None:
        self.assertEqual(
            cg.extract_wikilinks("[[Foo#Section|display]] [[Bar|alt]]"),
            ["Foo", "Bar"],
        )

    def test_skip_in_code_fence(self) -> None:
        text = "text [[Foo]]\n```\n[[InCode]]\n```\n[[Bar]]"
        self.assertEqual(cg.extract_wikilinks(text), ["Foo", "Bar"])

    def test_skip_in_inline_code(self) -> None:
        text = "see `[[InCode]]` but [[Real]] counts"
        self.assertEqual(cg.extract_wikilinks(text), ["Real"])

    def test_skip_in_frontmatter(self) -> None:
        text = "---\ntitle: '[[NotALink]]'\n---\n[[Real]]\n"
        self.assertEqual(cg.extract_wikilinks(text), ["Real"])


class CollectTagsTest(unittest.TestCase):
    def test_frontmatter_bracket_list(self) -> None:
        text = "---\ntags: [alpha, beta]\n---\n"
        self.assertEqual(cg.collect_tags(text), ["alpha", "beta"])

    def test_frontmatter_bullet_list(self) -> None:
        text = "---\ntags:\n  - one\n  - two\n---\n"
        self.assertEqual(cg.collect_tags(text), ["one", "two"])

    def test_no_tags(self) -> None:
        self.assertEqual(cg.collect_tags("# body\n"), [])


class BuildGraphTest(unittest.TestCase):
    def _vault(self, files: dict[str, str]) -> Path:
        root = Path(tempfile.mkdtemp(prefix="cg-test-"))
        for name, body in files.items():
            p = root / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(body, encoding="utf-8")
        return root

    def test_nodes_and_resolved_edges(self) -> None:
        vault = self._vault({
            "A.md": "# A\nlinks to [[B]]\n",
            "B.md": "# B\nno links\n",
        })
        graph = cg.build_graph(vault, cg.DEFAULT_SKIP | cg.ARCHIVE_DIRS)
        ids = {n["id"] for n in graph["nodes"]}
        self.assertEqual(ids, {"A.md", "B.md"})
        edges = graph["edges"]
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["src"], "A.md")
        self.assertEqual(edges[0]["dst"], "B.md")
        self.assertTrue(edges[0]["resolved"])

    def test_unresolved_edge_tracked(self) -> None:
        vault = self._vault({"A.md": "[[Ghost]]\n"})
        graph = cg.build_graph(vault, cg.DEFAULT_SKIP | cg.ARCHIVE_DIRS)
        edges = graph["edges"]
        self.assertEqual(len(edges), 1)
        self.assertFalse(edges[0]["resolved"])
        self.assertEqual(edges[0]["dst"], "Ghost")
        self.assertEqual(graph["stats"]["unresolved"], 1)

    def test_alias_resolution(self) -> None:
        vault = self._vault({
            "A.md": "[[AWG]]\n",
            "Sprachwelt.md": "---\naliases: [AWG]\n---\n# Sprachwelt\n",
        })
        graph = cg.build_graph(vault, cg.DEFAULT_SKIP | cg.ARCHIVE_DIRS)
        edges = [e for e in graph["edges"] if e["src"] == "A.md"]
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["dst"], "Sprachwelt.md")
        self.assertTrue(edges[0]["resolved"])

    def test_tags_attached_to_nodes(self) -> None:
        vault = self._vault({
            "A.md": "---\ntags: [ai, research]\n---\n# A\n",
        })
        graph = cg.build_graph(vault, cg.DEFAULT_SKIP | cg.ARCHIVE_DIRS)
        node = next(n for n in graph["nodes"] if n["id"] == "A.md")
        self.assertEqual(sorted(node["tags"]), ["ai", "research"])

    def test_tag_edges_emitted(self) -> None:
        vault = self._vault({
            "A.md": "---\ntags: [ai, research]\n---\n# A\n[[B]]\n",
            "B.md": "# B\n",
        })
        graph = cg.build_graph(vault, cg.DEFAULT_SKIP | cg.ARCHIVE_DIRS)
        tag_edges = [e for e in graph["edges"] if e["kind"] == "tag"]
        self.assertEqual(len(tag_edges), 2)
        destinations = sorted(e["dst"] for e in tag_edges)
        self.assertEqual(destinations, ["tag:ai", "tag:research"])
        for e in tag_edges:
            self.assertEqual(e["src"], "A.md")
            self.assertTrue(e["resolved"])
        wikilink_edges = [e for e in graph["edges"] if e["kind"] == "wikilink"]
        self.assertEqual(len(wikilink_edges), 1)
        self.assertEqual(wikilink_edges[0]["dst"], "B.md")
        stats = graph["stats"]
        self.assertEqual(stats["wikilink_edges"], 1)
        self.assertEqual(stats["tag_edges"], 2)
        self.assertEqual(stats["edges"], 3)


class EndToEndTest(unittest.TestCase):
    def test_run_writes_json(self) -> None:
        tmp = Path(tempfile.mkdtemp(prefix="cg-e2e-"))
        (tmp / "A.md").write_text("# A\n[[B]]\n", encoding="utf-8")
        (tmp / "B.md").write_text("# B\n", encoding="utf-8")
        out = tmp / ".compile" / "graph.json"
        stats = cg.run(tmp, out, cg.DEFAULT_SKIP | cg.ARCHIVE_DIRS)
        self.assertTrue(out.exists())
        data = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(len(data["nodes"]), 2)
        self.assertEqual(len(data["edges"]), 1)
        self.assertEqual(stats["nodes"], 2)
        self.assertEqual(stats["edges"], 1)


if __name__ == "__main__":
    unittest.main()
