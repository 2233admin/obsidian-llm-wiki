---
name: vault-graduate
description: Review an idea and decide: ship, invest, or archive
---

Review an idea and make a graduation decision.

Usage: /vault-graduate [idea name or note path]

Steps:
1. Read the idea note with `vault.read`. If not found, search with `vault.search`.
2. Evaluate:
   - **Evidence accumulated**: what has been learned since the idea was captured
   - **Momentum**: has interest grown or faded?
   - **Feasibility**: is it more or less tractable now?
   - **Urgency**: has the window of opportunity shifted?
3. Issue a verdict: SHIP (start now), INVEST (dedicate more exploration), ARCHIVE (park it)
4. If ARCHIVE: update the note frontmatter with `status: archived` and a `## Archival note` section explaining why
5. If SHIP or INVEST: offer to create a project note with `vault.project`
