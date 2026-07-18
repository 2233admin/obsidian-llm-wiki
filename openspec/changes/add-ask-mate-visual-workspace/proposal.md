## Why

LLM Wiki can already manage canonical Project issues and expose governed host capabilities, but it lacks a first-party interactive visual workspace and a governed path from OBC, third-party plugin, or Agent diagnostics into actionable project work. It also lacks an in-product, user-controlled feedback path for turning a verified product problem into an upstream Issue or tested pull request. Users therefore depend on paid mind-map plugins, manually interpret diagnostics, and lose the connection between visual thinking, discovered problems, Work-OS execution, and continuous project improvement.

## What Changes

- Add a first-party Visual Workspace Domain that reads user-authored Obsidian notes or Canvas files into a normalized mind-map model, supports outline-first clarification and live visual preview, and writes reviewable Markdown-backed maps without requiring a third-party plugin. Direct node dragging is an optional follow-on enhancement rather than a first-release dependency.
- Add an Ask Mate Obsidian interaction surface that can discuss the selected note or map, generate or revise a mind map through preview-and-confirm flows, and invoke shared domain operations instead of owning project, model, or knowledge state.
- Treat Graphify as an important optional Knowledge Adapter for relationship discovery. Preserve relation, source, evidence, and extracted/inferred/ambiguous confidence in reviewable suggestions instead of promoting Graphify output directly into accepted map structure.
- Add a Problem Intake Domain that normalizes findings from OBC, Host Capability diagnostics, supported Obsidian plugins, Agents, and users into provenance-bearing Problem Observations; deduplicates them; and proposes Work-OS issue changes without silently creating authoritative work.
- Let the user keep a finding local, submit a redacted upstream Issue, or prepare a verified pull request. Every remote mutation requires an exact preview and explicit confirmation; pull-request preparation requires an isolated patch plus passing regression evidence and never auto-merges.
- Extend Project Hub and project-management views with a triage projection that connects Problem Observations, mind-map nodes, canonical issues, Work Runs, and verification results while preserving `01-Projects/<project>/issues/*.md` as the only authoritative work state.
- Extend Host Capability Connectors with a read-only diagnostic-reporting contract for approved third-party plugin adapters. Arbitrary Obsidian command execution remains forbidden.
- Ship the capability as GPL-3.0-only first-party code and avoid a required paid plugin or new rendering dependency. Obsidian core APIs, Markdown, optional native Canvas import/export, and optional ecosystem enhancers remain supported boundaries.

## Capabilities

### New Capabilities

- `visual-workspace`: Defines normalized Mind Map Documents, source adapters, interactive edit plans, validation, deterministic layout projections, and Markdown/Canvas/Mermaid rendering boundaries.
- `problem-intake`: Defines provenance-bearing Problem Observations, fingerprint-based deduplication, lifecycle and severity handling, diagnostic-provider intake, explicit conversion into Work-OS issue proposals, and user-selected upstream Issue or pull-request contribution plans.
- `ask-mate-interaction`: Defines the Obsidian-native conversational surface for reading selected material, clarifying structure, previewing map, issue, or contribution changes, and applying approved domain operations.

### Modified Capabilities

- `host-capability-connectors`: Add a governed, read-only diagnostic reporting contract for approved OBC and third-party Obsidian plugin adapters.
- `project-context`: Add read-only Project Hub projections for visual workspaces, problem triage, and linked upstream Issues or pull requests, with all local issue mutations routed to Work-OS operations.

## Impact

- New shared domain packages and MCP operations for visual workspace and problem intake behavior.
- New Obsidian plugin views, commands, and interaction components for Ask Mate and the first-party mind-map editor.
- Updates to Project Hub, Canvas/Base/Kanban projections, project-tracker and forge contribution adapters, write-policy targets, audit events, settings definitions, and capability diagnostics.
- A first-party OBC diagnostic adapter and typed plugin diagnostic adapters; no arbitrary plugin command bridge.
- Updates to the shared graph contract and Graphify adapter so relationship provenance and confidence survive into Visual Workspace suggestions.
- New fixtures and tests for Markdown/Canvas round trips, Graphify-assisted relation suggestions, deterministic layout, interaction preview/apply, diagnostic deduplication, Issue/PR choice, secret-safe submission previews, verified patch gates, replay receipts, permissions, provenance, and GPL-compatible dependency boundaries.
