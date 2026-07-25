## ADDED Requirements

### Requirement: Intent and detail aware query planning
The unified query operation SHALL accept optional intent and detail hints and SHALL create a deterministic plan across compiled knowledge, raw Evidence, and enabled external adapter evidence.

#### Scenario: Concept navigation query
- **WHEN** a query requests navigation or overview detail and fresh compiled projections cover the topic
- **THEN** the planner prefers compiled knowledge and records why that tier satisfied the request

#### Scenario: Factual support query
- **WHEN** a query requests factual support, quotation, or high detail
- **THEN** the planner includes raw Evidence with Source provenance even when a compiled summary is available

### Requirement: Freshness and provenance fallback
The planner SHALL evaluate projection freshness and provenance completeness and SHALL fall back to or supplement with raw Evidence when compiled knowledge is stale, missing, or insufficiently attributable.

#### Scenario: Compiled page is stale
- **WHEN** an affected projection is older than its active Source contributions or freshness policy
- **THEN** the planner labels it stale, uses eligible raw Evidence for support, and exposes the fallback in the trace

### Requirement: Normalized explainable results
Every returned result SHALL identify its evidence tier, normalized Source or provider identifier, freshness, provenance, relative score semantics, and available provider explanation without treating external evidence as governed memory.

#### Scenario: qmd returns an explained result
- **WHEN** qmd supplies a `qmd://` identifier and ranking explanation
- **THEN** the adapter maps them into the shared result and trace contract while preserving qmd as optional retrieval evidence

### Requirement: Safe query traces
Query traces SHALL record routing decisions and bounded diagnostic codes and SHALL NOT contain resolved secrets, credential-bearing endpoints, unsafe local paths, or raw remote error bodies.

#### Scenario: External adapter fails with sensitive text
- **WHEN** a provider error reflects a credential or private endpoint
- **THEN** the trace contains only a redacted provider identity, failure class, and remediation code

