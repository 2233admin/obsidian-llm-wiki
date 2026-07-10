---
name: vault-panel
description: Multi-perspective analysis of a topic
---

Generate a multi-perspective take on a topic or decision.

Usage: /vault-panel [topic or decision]

Steps:
1. Search vault for existing context with `vault.search`
2. Generate 3-5 stakeholder perspectives. For each perspective:
   - Name the stakeholder role (e.g., "user", "operator", "regulator", "skeptic", "advocate")
   - Core concern: what matters most to this stakeholder
   - Position: what they would argue
   - Key tension: where they conflict with other perspectives
3. Synthesize: where perspectives agree, where they genuinely conflict, what the conflict reveals
4. Optionally save as a decision-supporting note with `vault.decide`
