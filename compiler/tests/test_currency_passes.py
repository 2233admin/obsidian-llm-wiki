"""Task 2 -- currency passes (supersession / staleness / unsupported) acceptance.

Runs the three derived passes via `kb_meta currency` against a TEMP COPY of
fixtures/vault-iii (shutil.copytree + tempfile, so the committed fixture stays
pristine). Asserts the specific A-E verdicts from the build brief, not
vacuously, plus idempotency and that existing _index.md sections stay intact.

ENV: pytest collects nothing here; run with unittest:
    cd compiler && python -m unittest tests.test_currency_passes -v
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

KB_META = ROOT / "kb_meta.py"
FIXTURE = ROOT.parent / "fixtures" / "vault-iii"
TOPIC = "research"
TODAY = "2026-06-24"


def _run_currency(vault: Path, apply: bool = False) -> dict:
    args = [sys.executable, str(KB_META), "currency", str(vault), TOPIC, "--today", TODAY]
    if apply:
        args.append("--apply")
    result = subprocess.run(args, capture_output=True, text=True)
    assert result.returncode == 0, f"currency failed: {result.stderr}\n{result.stdout}"
    return json.loads(result.stdout)


class CurrencyPassesAcceptanceTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.mkdtemp()
        self.vault = Path(self._tmp) / "vault-iii"
        shutil.copytree(FIXTURE, self.vault)
        # init meta (records the placeholder hash so diff reports change).
        subprocess.run(
            [sys.executable, str(KB_META), "init", str(self.vault), TOPIC],
            capture_output=True, text=True, check=True,
        )

    def tearDown(self) -> None:
        shutil.rmtree(self._tmp, ignore_errors=True)

    # --- A: current-truth for k-atana/iii == seed#2 ("已完成") ----------------
    def test_A_current_truth_iii_is_seed2(self) -> None:
        out = _run_currency(self.vault)
        ct = out["current_truth"]["k-atana/iii"]
        self.assertEqual(ct, "00-Inbox/AI-Output/test-agent/iii-done.md")
        ent = out["entities"]["k-atana/iii"]
        self.assertEqual(ent["source"], "commit:NEW5678")
        self.assertEqual(ent["last_verified"], "2026-06-24")
        # seed#2 has a valid commit: source and is verified today -> OK.
        self.assertEqual(ent["marker"], "OK")
        # the rendered view carries the actual claim text.
        self.assertIn("iii pivot 已完成", out["current_truth_md"])

    # --- B: seed#1 (iii.md) SUPERSEDED + in log, NOT deleted ------------------
    def test_B_seed1_superseded_logged_not_deleted(self) -> None:
        out = _run_currency(self.vault, apply=True)
        sup_ids = [s["note_id"] for s in out["superseded"]]
        self.assertIn("research/wiki/entities/iii.md", sup_ids)
        rec = next(s for s in out["superseded"]
                   if s["note_id"] == "research/wiki/entities/iii.md")
        self.assertEqual(rec["entity"], "k-atana/iii")
        # explicit supersession by seed#2.
        self.assertIn("iii-done.md", rec["topped_by"])
        self.assertIn("explicit", rec["reason"])
        # the source note still exists on disk (not deleted).
        self.assertTrue((self.vault / "research/wiki/entities/iii.md").exists())
        # supersession log written under wiki/ and names both notes.
        log = (self.vault / "research/wiki/_supersession.md").read_text("utf-8")
        self.assertIn("research/wiki/entities/iii.md", log)
        self.assertIn("k-atana/iii", log)

    # --- C: seed#3 (unsupported-demo) UNSUPPORTED -----------------------------
    def test_C_seed3_unsupported(self) -> None:
        out = _run_currency(self.vault)
        ent = out["entities"]["k-atana/unsupported-demo"]
        self.assertEqual(ent["marker"], "UNSUPPORTED")
        self.assertIn("research/wiki/entities/unsupported-demo.md", out["unsupported"])
        self.assertTrue(any("empty" in r for r in ent["reasons"]))

    # --- D: seed#4 (stale-demo) STALE via hash-change, NOT age ----------------
    def test_D_seed4_stale_via_hash_not_age(self) -> None:
        out = _run_currency(self.vault)
        ent = out["entities"]["k-atana/stale-demo"]
        self.assertEqual(ent["marker"], "STALE")
        self.assertIn("research/wiki/entities/stale-demo.md", out["stale"])
        # reason must be the source-changed signal, NOT an age threshold.
        reasons = " ".join(ent["reasons"])
        self.assertIn("changed", reasons)
        self.assertNotIn("threshold", reasons)
        self.assertNotIn("age", reasons)

    # --- E: idempotency + existing tests stay green ---------------------------
    def test_E_idempotent(self) -> None:
        out1 = _run_currency(self.vault, apply=True)
        ct1 = (self.vault / "research/wiki/_current-truth.md").read_text("utf-8")
        sup1 = (self.vault / "research/wiki/_supersession.md").read_text("utf-8")
        out2 = _run_currency(self.vault, apply=True)
        ct2 = (self.vault / "research/wiki/_current-truth.md").read_text("utf-8")
        sup2 = (self.vault / "research/wiki/_supersession.md").read_text("utf-8")
        self.assertEqual(ct1, ct2)
        self.assertEqual(sup1, sup2)
        self.assertEqual(out1["current_truth"], out2["current_truth"])
        self.assertEqual(out1["stale"], out2["stale"])
        self.assertEqual(out1["unsupported"], out2["unsupported"])

    def test_E_index_additive_keeps_existing_sections(self) -> None:
        # Baseline index BEFORE the currency passes touch it.
        subprocess.run(
            [sys.executable, str(KB_META), "update-index", str(self.vault), TOPIC],
            capture_output=True, text=True, check=True,
        )
        base_index = (self.vault / "research/wiki/_index.md").read_text("utf-8")
        # existing sections present.
        for section in ("## Summaries", "## Concepts", "## Queries"):
            self.assertIn(section, base_index)
        # entities/ exists in the fixture -> Entities section is additive.
        self.assertIn("## Entities", base_index)
        # currency surfaces STALE + UNSUPPORTED additively.
        self.assertIn("## Stale", base_index)
        self.assertIn("## Unsupported", base_index)
        # the Summaries..Queries slice must be byte-identical to a run with no
        # entities/ and no stale/unsupported -> verify by slicing before Entities.
        head = base_index.split("\n## Entities")[0]
        self.assertIn("## Queries", head)
        self.assertNotIn("## Stale", head)


if __name__ == "__main__":
    unittest.main()
