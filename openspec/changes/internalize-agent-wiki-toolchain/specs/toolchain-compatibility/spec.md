## ADDED Requirements

### Requirement: Versioned Toolchain Capability Profiles
The system SHALL represent each supported toolchain with a versioned profile containing discovery evidence, normalized semantic capabilities, invocation mode, compatibility result, limits, model or index fingerprints when applicable, configuration provenance, and health.

#### Scenario: Executable version is supported but feature is absent
- **WHEN** a provider reports an expected version but fails the required structured-output probe
- **THEN** its profile does not advertise that capability and health reports degraded or unavailable with evidence

### Requirement: Side-effect-free capability probing
Default startup and Doctor probes SHALL be bounded and side-effect-free and SHALL distinguish `available`, `degraded`, `unavailable`, and `disabled`; mutating verification SHALL require an explicit operation.

#### Scenario: Doctor checks a remote-capable tool
- **WHEN** Doctor probes OpenCLI, qmd, Graphify, or an embedding endpoint
- **THEN** it inspects version and declared contract without capturing remote content, changing an index, or writing graph data

### Requirement: Normalized invocation and fixtures
Domain services SHALL request normalized capabilities rather than construct vendor commands or payloads, and every supported invocation profile SHALL have golden contract fixtures for success, partial capability, incompatible output, timeout, and redaction.

#### Scenario: Graphify command shape changes
- **WHEN** the installed Graphify 0.9.x profile uses a command or response shape different from the legacy profile
- **THEN** only the selected adapter invocation changes and the normalized graph result fixtures remain equivalent

### Requirement: Current qmd compatibility
The qmd profile SHALL normalize qmd 2.x intent, explanation, `qmd://` URI, multiple-collection, index-health, and model-fingerprint behavior across supported CLI and optional SDK modes.

#### Scenario: SDK runtime requirement is not met
- **WHEN** qmd SDK mode is configured but the Node runtime or package contract is incompatible
- **THEN** the profile declines SDK mode, retains compatible CLI or filesystem fallback, and reports remediation

### Requirement: Current OpenCLI compatibility
The OpenCLI profile SHALL use structured version, list/help, validation or verification, Doctor, profile, plugin, and adapter discovery where available and SHALL keep OpenCLI output within the capture Provider boundary.

#### Scenario: Site adapter validates successfully
- **WHEN** OpenCLI discovers and validates a configured site adapter
- **THEN** the capability profile records its structured capture capabilities without granting it Source, vault, or promotion authority

### Requirement: Embedding fingerprint compatibility
Embedding profiles SHALL identify provider, endpoint identity, model, dimensions when known, and adapter schema version; the built-in profile registry SHALL support both `bge-m3` and `qwen3-embedding:0.6b`; and the system SHALL mark indexes with a mismatched fingerprint stale or incompatible instead of mixing vectors.

#### Scenario: Either built-in embedding model is selected for a new index
- **WHEN** Settings bind a new index to `bge-m3` or `qwen3-embedding:0.6b` through a compatible Ollama or OpenAI-compatible endpoint
- **THEN** the system accepts the selected supported profile and records its complete fingerprint on the new index

#### Scenario: Legacy and current model defaults differ
- **WHEN** an existing index fingerprint names `bge-m3` but effective Settings select `qwen3-embedding:0.6b`, or the inverse
- **THEN** the system keeps both profiles supported, proposes an explicit per-index rebuild or binding migration, and does not append mismatched vectors to the existing index

### Requirement: MCP production compatibility seam
The system SHALL keep MCP SDK v1 as the production transport until a separately approved stable-v2 migration and SHALL keep domain operations independent of SDK-specific server and client composition.

#### Scenario: v2 compatibility work begins before stable adoption
- **WHEN** a v2 transport fixture is evaluated
- **THEN** it runs only through the isolated compatibility seam and does not replace the production v1 runtime
