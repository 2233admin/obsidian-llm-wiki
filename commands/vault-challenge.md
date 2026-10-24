---
name: vault-challenge
description: Play devil's advocate on a claim or idea
---

Play devil's advocate on a claim or idea. Usage: /vault-challenge [claim or note path]

Steps:
1. If given a note path, read it with `vault.read`. If given a claim, analyze it directly.
2. Find counter-evidence: search vault for contradicting views, surface weak assumptions, identify missing evidence
3. Structure the challenge:
   - **Claim**: the original assertion
   - **Counter-arguments**: 3-5 specific objections with reasoning
   - **Missing evidence**: what would need to be true for the claim to hold
   - **Steelman**: the strongest version of the opposing view
   - **Verdict**: genuinely weak / needs qualification / likely sound
4. Optionally save to vault at `_Reviews/{title}-challenge.md` if user confirms
