## ADDED Requirements

### Requirement: Source-versioned contribution manifests
Each successful compilation SHALL write a versioned contribution manifest that attributes claims, relationships, concept membership, summary inputs, and contradiction observations to a Source revision and compiler schema version.

#### Scenario: Source contributes to two concepts
- **WHEN** one Source revision compiles into claims and relationships affecting two concepts
- **THEN** the manifest records stable contribution identifiers and both affected concept keys before either projection is published

### Requirement: Deterministic revision and retraction
Replacing, disabling, or removing a Source revision SHALL deactivate its prior contributions and deterministically recompute the affected projection closure from the remaining active manifests.

#### Scenario: Changed source retracts an obsolete claim
- **WHEN** a newer Source revision no longer supports a claim emitted by its previous revision
- **THEN** the obsolete contribution is absent from the rebuilt concept and contradiction projections while claims supported by other active Sources remain

#### Scenario: Source is removed
- **WHEN** the final active Source supporting a relationship is removed
- **THEN** the relationship is retracted from generated projections and the removal is traceable to the deactivated manifest

### Requirement: Atomic and stable projection updates
The compiler SHALL stage and atomically publish all projections in one affected closure and SHALL leave unaffected generated pages byte-stable.

#### Scenario: One topic changes
- **WHEN** recompilation changes contributions only within one topic closure
- **THEN** all affected projections switch to one consistent generation and unrelated projection files retain their prior bytes and modification state

### Requirement: Legacy provenance safety
The compiler SHALL identify projections without complete contribution provenance and SHALL NOT perform destructive source-scoped retraction against them until they are rebuilt or explicitly migrated.

#### Scenario: Old compiled page has no manifest
- **WHEN** a Source update affects a legacy projection whose contributions cannot be attributed
- **THEN** health reports `unknown-provenance` and the compiler requires a safe rebuild rather than deleting inferred content

