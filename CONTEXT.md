# LLMwiki Context

LLMwiki turns local vault content and captured external material into searchable, citable, agent-operable knowledge.

## Language

**Knowledge Item**: A first-class unit of knowledge that LLMwiki can search, cite, relate, or operate on inside a vault. A Knowledge Item may represent evidence, analysis, memory, project work, a kanban card, a source record, or an asset record.
_Avoid_: Evidence Note as the umbrella term, note, document

**Knowledge Item Type**: The category of a Knowledge Item. Phase 1 types are `source_record`, `evidence`, `analysis`, `memory`, `issue`, `comment`, `kanban_card`, `asset`, and `transcript`.
_Avoid_: file extension, provider type, platform

**Knowledge Item Metadata**: The shared metadata shape that adapters use to describe Knowledge Items in search and query results. It should identify type, vault path, citation target, source identity, provenance, ingest run, project state, or kanban state when those fields apply.
_Avoid_: adapter-specific payload, frontmatter dump, raw provider output

**Evidence Note**: A Knowledge Item that records source-backed material captured from an external or local input so later analysis can cite it.
_Avoid_: Source, capture, raw note

**Knowledge Item Status**: The lifecycle state of a Knowledge Item as it moves from intent to durable knowledge. Canonical statuses are `planned`, `captured`, `indexed`, `analyzed`, and `promoted`.
_Avoid_: task status, note status, import state

**Source**: An external or local entrypoint that can produce one or more Knowledge Items. A Source may be a single URL, author profile, channel, playlist, repository, podcast feed, vault path, or other collection-like input.
_Avoid_: Evidence Note, capture, provider

**Source Input**: The concrete user-provided form used to register or preflight a Source. Source Inputs may be URLs, vault paths, local file paths, directory paths, repository paths, or text snippets.
_Avoid_: Source, Knowledge Item, Capture

**Source Input Phase 1**: The initial Source Registration scope supports `url` and `vaultPath` inputs. Other Source Input types are reserved for the schema but should report unsupported rather than silently pretending to ingest them.
_Avoid_: full local import, repo indexing, text capture

**Capture**: A local raw artifact produced from a Source before it is trusted as durable knowledge. A Capture may be HTML, screenshot, image, video, audio, subtitle, comment data, metadata, or extracted page text.
_Avoid_: Knowledge Item, Evidence Note, analysis

**Platform**: A source family where a Source lives, such as Douyin, Bilibili, X, YouTube, Xiaohongshu, Weibo, Zhihu, WeChat Official Account, GitHub, or a local vault.
_Avoid_: Provider, capability, tool

**Provider**: A local callable tool, toolchain, provider pack, or skill bridge that can produce Captures, Derivatives, or Knowledge Items from a Source. OPENCLI and MEDIA_TRANSCRIBE are Providers; Douyin, Bilibili, X, and YouTube are Platforms.
_Avoid_: Platform, scraper, adapter

**Provider Capability**: A specific action a Provider can perform for a Platform or Source kind, such as resolving a profile, capturing a post, downloading media, extracting comments, or producing a transcript.
_Avoid_: Provider, Platform

**Ingest Pipeline**: An ordered plan of Provider Capabilities that turns a Source into vault-visible Knowledge Items. A pipeline may include resolving, capturing, transcribing, indexing, and vault verification steps.
_Avoid_: Provider, import, analysis

**Ingest Run**: A concrete execution attempt of an Ingest Pipeline for a Source. An Ingest Run records status, inputs, provider steps, errors, produced Captures, Derivatives, and Knowledge Items so ingestion can be audited or retried.
_Avoid_: preflight, pipeline, task

**Preflight**: A side-effect-free capability check and pipeline plan for a Source. Preflight may classify the Platform and Source Kind, recommend Providers, and report limitations, but it must not create an Ingest Run or write to the vault.
_Avoid_: ingest run, import, capture

**MCP Runtime Boundary**: The boundary between reusable MCP protocol/runtime plumbing and LLMwiki's domain operations. LLMwiki should prefer official SDKs or mature MCP frameworks for transport, tool registration, schema handling, and response formatting, while keeping Source, Ingest, Memory, Project, Query, and Vault behavior in its own domain layer.
_Avoid_: hand-rolled MCP server, protocol plumbing as product logic

**Partial Ingest**: An Ingest Run that produced useful Captures, Derivatives, Source metadata, or errors but did not reach an indexed Knowledge Item. Partial Ingests should be resumable or explain why manual action is required.
_Avoid_: failure, success, skipped import

**Derivative**: A reusable processing product derived from a Capture or another Derivative. Examples include transcript text, OCR text, extracted metadata, comment digest, speaker diarization, thumbnail description, or cleaned article text.
_Avoid_: Capture, Knowledge Item, Analysis Note

**Index Contract**: The minimum condition for an object to count as an indexed Knowledge Item in LLMwiki. It must have a vault path, type, indexed status, display title or label, searchable text, provenance, and at least file-level citation target.
_Avoid_: capture success, provider output, file exists

**Citation Target**: A concrete reference location that lets LLMwiki point back to evidence or work. Citation Targets may refer to a file, heading, Obsidian block, media timestamp, comment ID, platform post ID, local issue ID, or Kanban card.
_Avoid_: source URL, provenance, vague reference

**Provenance**: The traceable origin and processing history of a Knowledge Item, Capture, or Derivative. Provenance records original and canonical sources, Platform, Source Kind, Provider, Provider Capability, Ingest Run, timestamps, content hashes, and Access Context.
_Avoid_: citation, metadata, note frontmatter

**Access Context**: The access condition under which a Source, Capture, Derivative, or Knowledge Item can be obtained or refreshed. Canonical values include `public`, `login_required`, `cookie_required`, `browser_required`, `manual_required`, `paywalled`, `private`, `deleted_or_unavailable`, `region_blocked`, and `unknown`.
_Avoid_: permission, auth status, error

**Collection Expansion**: A pipeline step that turns a collection-like Source into child Sources or candidate Knowledge Items. Examples include expanding an author profile into posts, a channel into videos, a repository into docs and issues, or a podcast feed into episodes.
_Avoid_: search, crawl, scrape

**Candidate**: A discovered child Source from Collection Expansion that may become a Knowledge Item after selection and ingestion. Candidates can carry ranking signals such as recency, engagement, keyword match, user choice, or provider confidence.
_Avoid_: Knowledge Item, Capture, result

**Selection Policy**: The rule used to choose Candidates for ingestion or analysis. Examples include top by engagement, latest N, keyword match, manual selection, representative sample, since date, skip already indexed, or changed since last capture.
_Avoid_: filter, ranking, query

**Registered Selection Policy**: The Selection Policy stored with a Source during Source Registration. Phase 1 records this intent for future Collection Expansion even when no expansion is executed yet.
_Avoid_: executed selection, search query, provider filter

**Source Registry**: A lightweight catalog of Sources that LLMwiki may revisit, expand, ingest, or analyze over time. The registry records source identity, Platform, Source Kind, Access Context, last expansion or ingest state, and related Knowledge Items.
_Avoid_: bookmark list, ingest run, provider config

**Source Registry Phase 1**: The initial Source Registry scope supports registering, listing, and reading Sources plus creating Source Notes. It does not execute capture, download, transcription, scheduling, or automatic monitoring.
_Avoid_: ingest execution, crawler, monitor

**Source Registration**: The act of adding a Source to the Source Registry and creating or updating its Source Note. Registration may run Preflight to record Platform, Source Kind, Access Context, recommended Providers, and an Ingest Pipeline, but it must not execute the pipeline.
_Avoid_: ingest run, capture, crawl

**Project Source**: A Source registered inside a project context so it can support project issues, kanban boards, memory, evidence, and analysis. Project Sources use the project-scoped Source Note Path.
_Avoid_: global source, project issue, memory note

**Vault Path Source**: A Source registered from an existing vault path. Registration creates a separate Source Note and links the original vault file as a related Knowledge Item instead of modifying the original note.
_Avoid_: moving the original note, rewriting evidence, direct promotion

**Source Identity**: The stable key used to upsert a Source in the Source Registry. Phase 1 derives identity from the canonical source when available, otherwise from the normalized input URL or local path.
_Avoid_: display title, source note path, provider id

**Source Note**: A human-readable Markdown representation of a registered Source inside the vault. A Source Note lets users review, annotate, and organize a Source while the Source Registry keeps the machine-readable identity and state.
_Avoid_: Source Registry, Evidence Note, Capture

**Source Note Template**: The required Markdown shape for Source Notes. Phase 1 Source Notes use frontmatter with `llmwiki_type: source_record`, source identity, URL, Platform, Source Kind, Access Context, status, provider, pipeline, timestamps, project, and tags, followed by `Source`, `Preflight`, `Selection Policy`, `Notes`, and `Related Knowledge Items` sections.
_Avoid_: arbitrary bookmark, provider output, evidence template

**Source Note Path**: The vault path where a Source Note is stored. By default non-project Sources live under `00-Inbox/Sources/<platform>/<source-slug>.md`, while project-scoped Sources live under `10-Projects/<project>/sources/<platform>/<source-slug>.md`.
_Avoid_: provider output path, capture path, note title

**Source Registry Path**: The vault-internal machine index path for registered Sources. Phase 1 uses `_llmwiki/source-registry.json` as the primary Source Registry while Source Notes provide the human-readable Markdown view.
_Avoid_: Source Note Path, provider config, capture storage

**Agent Layer**: An optional orchestration layer that uses LLMwiki's MCP tools to perform multi-step knowledge workflows. Claude Code Agent SDK is a preferred Agent Layer candidate, but it should not be required by the MCP server core.
_Avoid_: MCP server core, provider, adapter

**Skill Pack**: A named external or project-local collection of agent skills that LLMwiki can inventory, explain, and optionally mirror. Skill Packs describe workflow capability, not vault knowledge by themselves.
_Avoid_: Provider, MCP tool namespace, adapter

**Skill Inventory**: A local scan of skill roots such as `.agents/skills`, `.codex/skills`, and project `skills/` that reports which Skill Pack entries are installed, missing, or project-mirrored.
_Avoid_: npm install result, runtime capability guarantee

**Skill Mirror**: A project-local copy or vendor view of a Skill Pack entry. Mirroring makes a skill visible to a project or distributable with it, but user-level installed skills remain the preferred execution source.
_Avoid_: source of truth, package install, automatic sync

**Global Skill Invocation**: The default way LLMwiki and its Agent Layer use external Skill Packs. Skills installed in user-level roots such as `.agents/skills` or `.codex/skills` are invoked on demand; project mirroring is optional and should not be required for normal use.
_Avoid_: mandatory project mirror, bundled skill dependency, hidden install step

**Operation Interface**: LLMwiki's internal domain interface for MCP-exposed behavior. Domain modules return `Operation[]`; a separate MCP runtime adapter turns those operations into SDK-registered tools and handles schema conversion, calls, errors, and content responses.
_Avoid_: SDK tool as domain model, direct protocol handler in domain module

**MCP Runtime Adapter**: A protocol adapter that exposes Operation Interface entries as MCP SDK tools. It owns tool schema conversion, operation dispatch, result formatting, and error formatting, but does not own config loading, vault initialization, adapter registry initialization, or compile trigger setup.
_Avoid_: bootstrap, domain module, config loader

**Operation Result**: The JSON-serializable value returned by an Operation handler before protocol formatting. MCP content arrays, text wrappers, and protocol-specific response shapes belong to the MCP Runtime Adapter, not domain modules.
_Avoid_: MCP content as domain return value, transport-specific result

**Operation Write Policy**: The deterministic adjudicator that decides whether an Operation's real write is allowed, which vault paths it may affect, what audit evidence must be recorded, and which post-write side effects must run. It consumes the Operation name, validated arguments, and collaboration context; it returns an allow or deny verdict plus write targets and side-effect intents. It does not execute domain behavior, write vault content, or format MCP responses.
_Avoid_: advisory policy note, handler-side permission check, MCP Runtime Adapter, Promotion Policy

**Operation Error**: The modern domain error shape for failed operations. Phase 1 keeps `makeErr` compatibility while introducing an `OperationError` class with `code`, `message`, optional `data`, and optional internal `cause`; the MCP Runtime Adapter formats it without leaking stack traces.
_Avoid_: raw thrown object, MCP-specific error in domain module

**Operation Error Helper**: A named constructor for common operation failures, such as `badRequest`, `notFound`, `conflict`, `unsupported`, and `internal`. Helpers make Source Registry, Ingest, Memory, Project, and Query errors consistent.
_Avoid_: ad hoc numeric code, string-only error, transport exception

**Work Driver**: The component that closes LLMwiki's loop from "true and queryable" to "work done" by reading authoritative work-OS truth, selecting the next executable item, leasing it, running an agent, and routing the result back through capture. It never decides knowledge truth on its own; it only proposes and promotes within the Promotion Policy.
_Avoid_: scheduler, daemon, orchestrator, runtime

**Work Run**: A single execution attempt in which the Work Driver leases one executable item, hands it to an agent, and collects the result for capture. Distinct from an Ingest Run, which executes a Source ingest pipeline; a Work Run executes a unit of project work.
_Avoid_: Ingest Run, job, task, build

**Run Output Class**: The category of what a Work Run produces, which decides how its result may re-enter the vault. The classes are view (compiled/derived, never a promote), work-state transition (a mechanical change to an item's workflow state), knowledge claim (a fact, decision, or supersession about an entity), and external side-effect (an action that leaves the repo, such as a real push, forge PR, or thread reply).
_Avoid_: result type, severity, risk score

**Promotion Policy**: The fail-safe rule that decides, by Run Output Class, whether a Work Run's result is auto-promoted into current-truth or routed to triage for human review. Auto-promotion is an allowlist a result must affirmatively clear: work-state transitions may auto-promote, knowledge claims always go to human review, external side-effects require explicit per-run approval, and any unclassifiable result falls back to human review.
_Avoid_: approval flow, risk gate, permission

**Settings Platform**: The LLMwiki domain that owns the definitions, scoped values, effective snapshots, validation, migration, and health of operational configuration shared by every host and capability. OBC, Dream Time, MCP, CLI, compiler, and Obsidian consume it but do not own it.
_Avoid_: OBC settings, Obsidian settings, config file, environment variables

**Setting Definition**: The registered meaning and constraints of one LLMwiki setting, identified by a stable namespaced key. It includes ownership and sensitivity semantics independently of any current value.
_Avoid_: form field, config entry, environment variable

**Settings Scope**: The boundary at which a setting value applies. Canonical scopes are product, user-device, vault, workspace-project, and session.
_Avoid_: config file, profile, environment

**Settings Snapshot**: An immutable, versioned view of effective settings and their provenance for a specific runtime context. It is the configuration input consumed by LLMwiki capabilities.
_Avoid_: live config object, Obsidian data.json, settings file

**Secret Reference**: An opaque reference that identifies where a sensitive value can be resolved without storing or returning that value through the Settings Platform.
_Avoid_: secret value, API key field, plaintext credential

**Capability Health**: The explained operational state of an LLMwiki capability after evaluating its settings, dependencies, and runtime availability. Canonical states are `available`, `degraded`, `unavailable`, and `disabled`.
_Avoid_: configured boolean, process health, diagnostic finding

**Obsidian Control Plane**: The primary human-facing LLMwiki client for inspecting and changing settings, capability health, and operations from Obsidian. It is not the settings source of truth and must use the same domain operations as other hosts.
_Avoid_: settings backend, source of truth, standalone plugin logic
