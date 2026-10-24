---
name: vault-connect
description: Map unexpected connections between concepts, people, and projects
---

Find unexpected connections between disparate vault entries.

Usage: /vault-connect [optional: two concepts or note paths to bridge]

Steps:
1. Use `vault.graph` to get the full wikilink graph
2. If two specific items given: find shortest path and intermediate nodes
3. If no items given: find node pairs with high topic overlap but no direct wikilink
4. For each interesting connection:
   - Name the connection (what links them)
   - Show the evidence chain (intermediate nodes / shared themes)
   - Rate novelty: obvious / interesting / surprising
5. Report top 5-10 connections. Offer to add wikilinks or create bridge notes.
