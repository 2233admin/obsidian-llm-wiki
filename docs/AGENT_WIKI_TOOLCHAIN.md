# Agent Wiki toolchain

LLM Wiki internalizes the stable contracts needed to run an Agent Wiki while keeping external engines replaceable. The product owns Source identity, Settings, runs, receipts, Evidence, compilation, maintenance, retrieval routing, redaction, and promotion boundaries. Optional providers own only their declared capture, query, graph, or embedding capability.

## Baseline and optional profiles

The MCP server starts on Node.js 20+ with the filesystem adapter alone. Missing optional providers are reported as `disabled`, `unavailable`, or `degraded`; they do not make filesystem registration, ingest, compilation, or retrieval unavailable.

| Profile | Mode | Compatibility contract | Role |
|---|---|---|---|
| `filesystem` | built-in | always available when the vault is readable | Capture `vaultPath`, raw Evidence, deterministic fallback retrieval. |
| `opencli` | CLI | `>=1.8 <2`, structured discovery plus capture-only boundary | URL capture; never Source registration or promotion authority. |
| `qmd` | CLI | qmd 2.5-compatible intent, explanation, `qmd://`, collections, health, and model fingerprint | Optional local ranked retrieval. |
| `qmd` | SDK | qmd 2.x package contract and Node.js 22+ | Optional in-process retrieval with CLI-normalized parity. The main MCP runtime may remain Node 20 when SDK mode is not selected. |
| `graphify` | CLI | legacy and 0.9.x profiles | Optional graph query normalized into the shared Evidence contract. |
| `ollama` / OpenAI-compatible | HTTP GET probes | models/version endpoints and exact embedding fingerprint | Optional embeddings. |
| `lightrag` | HTTP wrapper | wrapper-defined `/health` and declared query/document endpoints | Optional external retrieval/ingest wrapper. |
| `raganything` | HTTP wrapper | wrapper-defined `/health`, query, and process-document capability | Optional multimodal parsing/retrieval wrapper. |
| `mcp-sdk` | library seam | production v1 transport; non-production v2 composition fixtures | Keeps domain handlers independent of transport generation. |

All provider observations normalize to versioned capability profiles with stable provider identifiers, capabilities, diagnostic codes, redacted endpoint/executable evidence, observed version, probe time, expiry, and profile revision.

## Settings

Semantic policy and device bindings are intentionally separate:

| Key | Scope and purpose |
|---|---|
| `toolchain.provider_selection` | Vault/Project/session list of optional profiles to evaluate. |
| `toolchain.capability_profiles` | Semantic invocation mode, version policy, required features, timeout, collection/index identity, and profile revision. |
| `toolchain.device_bindings` | User-device/session executable and public endpoint references. Credential-bearing URLs are rejected. |
| `embeddings.default_profile` | Default `ollama/bge-m3` or `ollama/qwen3-embedding:0.6b`. |
| `embeddings.endpoint` | Device-local OpenAI-compatible embedding endpoint. |
| `embeddings.index_profiles` | Explicit profile per index; defaults keep VaultBrain on `bge-m3` and MemU on `qwen3-embedding:0.6b`. |
| `embeddings.index_fingerprints` | Recorded provider, endpoint identity, model, dimensions, adapter schema, and digest. |
| `embeddings.fingerprint_enforcement` | `rebuild-required` or `reject-mismatch`. |

Use `settings.snapshot.explain` to see the winning scope and `settings.doctor` for profile health. Profiles never include resolved Secret Reference values or credential-bearing endpoints.

## Doctor remediation

| Diagnostic | Action |
|---|---|
| `PROVIDER_UNAVAILABLE` | Confirm the selected provider has a device executable/endpoint, then run Doctor again. Otherwise remove it from selection; filesystem remains usable. |
| `TOOLCHAIN_PROBE_TIMEOUT` | Check local process/network health and increase only that profile's bounded timeout if necessary. |
| `TOOLCHAIN_OUTPUT_INVALID` | Upgrade/downgrade to the documented version policy or switch invocation mode; do not accept unstructured output as authoritative. |
| `CAPABILITY_MISSING` | Inspect `missingCapabilities`; select a compatible provider revision or leave the feature degraded. |
| `EMBEDDING_MODEL_MISSING` | Install the selected model or bind the index to an installed supported preset. |
| fingerprint mismatch | Run the reported rebuild plan before querying that index; never mix vectors from different fingerprints. |
| `SENSITIVE_ERROR_REDACTED` | Remove credentials from URLs/arguments and configure a device-local Secret Reference. |
| legacy toolchain environment warning | Copy the non-secret value into Settings, verify Doctor, then unset the legacy environment variable. |

Probes are side-effect-free: CLI probes use version/list/help/validate/verify/Doctor surfaces; HTTP probes use GET only. Probe failures never invoke capture, insert documents, or modify indexes.

## Retrieval and evidence

Every adapter result carries a normalized identifier, Evidence tier, freshness, provenance, score semantics, explanation, profile revision, and partial-capability state. `query.unified`, `query.trace`, and `query.answer` accept optional `intent` and `detail` and route deterministically across:

1. maintained compiled projections;
2. raw Evidence Notes;
3. enabled external adapters.

Stale or missing-provenance compiled results are supplemented or replaced by raw Evidence. Quotation, factual-support, and high-detail intents prefer raw Evidence. Query traces contain bounded diagnostic codes and redacted profile evidence, never secrets.

## Maintenance and source revision

Changed Evidence creates a coalesced maintenance entry with dirty reasons, earliest run time, maximum freshness deadline, attempts, lease, and receipts. Drains are bounded, restart-safe, and continue unrelated work after retry or quarantine.

Compilation records source-versioned contribution manifests. A revision activates the new contribution set and deactivates obsolete claims/relationships before rebuilding the affected topic closure. Atomic generation pointers expose one complete generation; unrelated projections remain byte-stable. Source disablement/removal retracts only that Source's support. Legacy `unknown-provenance` content fails closed: review the provenance report and backfill or run an explicitly authorized `python compiler/compile.py <topic> --full --force-full-rebuild`. The ordinary compiler and durable maintenance trigger never bypass this gate.

## Rollout and rollback

`settings.agent_wiki.features` reports the effective switches:

| Environment | Compatibility value | Result |
|---|---|---|
| `VAULT_MIND_AGENT_WIKI_INGEST` | `disabled` | Blocks new run/resume; existing plan/inspect/verify state remains readable. |
| `VAULT_MIND_COMPILE_TRIGGER_MODE` | `legacy-threshold` | Restores the prior threshold trigger; durable queue state remains retained. |
| `VAULT_MIND_RETRIEVAL_MODE` | `legacy-rrf` | Keeps normalized adapter results but restores pure RRF ordering. |
| `VAULT_MIND_TOOLCHAIN_PROBES` | `disabled` | Prevents live probes; cached/redacted profile state remains readable. |

Rollback changes behavior selection, not data. Runs, artifacts, receipts, manifests, generations, queue entries, fingerprints, and traces are additive/versioned and retained until the operator has verified a replacement backup or completed the documented rebuild. See [MIGRATIONS.md](MIGRATIONS.md).
