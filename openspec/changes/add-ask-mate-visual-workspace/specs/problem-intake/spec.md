## ADDED Requirements

### Requirement: Provider-neutral Problem Observations
The system SHALL normalize findings from OBC, Host Capability diagnostics, approved Obsidian plugin adapters, Agents, and humans into provenance-bearing Problem Observations with canonical Project identity, provider and rule identity, subject, severity, evidence references, observation time, lifecycle, and a deterministic fingerprint.

#### Scenario: OBC reports a broken link
- **WHEN** the OBC adapter reports a broken link in a Project-scoped note
- **THEN** Problem Intake records the rule, canonical note subject, broken target evidence, OBC version, Project ID, and observation fingerprint without changing the note or creating an issue

#### Scenario: Finding cannot resolve a Project
- **WHEN** a provider report has no unambiguous Project Context
- **THEN** intake rejects Project-scoped persistence or stores it only in an explicitly selected global diagnostic scope

### Requirement: Deterministic deduplication and recurrence
Problem Intake SHALL deduplicate observations by provider, rule, canonical subject, and normalized evidence identity while preserving occurrence count, first and last observation times, provider versions, and verification history.

#### Scenario: The same plugin reports the same problem again
- **WHEN** a later scan produces the same observation fingerprint
- **THEN** the existing observation receives a new occurrence or verification result and no duplicate observation or issue is created

#### Scenario: Evidence meaningfully changes
- **WHEN** the provider, rule, subject, or normalized evidence identity changes
- **THEN** the system records a distinct observation and may link it as related rather than merging it silently

### Requirement: Explicit observation lifecycle
Problem Observations SHALL have a validated lifecycle independent of Work-OS issue state and SHALL record actor, reason, revision, and transition token for acknowledgement, dismissal, reopening, and resolution decisions.

#### Scenario: A scan no longer reproduces a problem
- **WHEN** a later diagnostic run reports that the prior subject and rule pass
- **THEN** the observation records verification evidence but does not auto-close a linked Work-OS issue

#### Scenario: User dismisses a false positive
- **WHEN** an authorized user dismisses an observation with a reason
- **THEN** the observation remains auditable and repeated matching findings follow the reviewed suppression policy

### Requirement: Work-OS issue proposal routing
Problem Intake SHALL convert selected observations into reviewable Issue Change Plans and SHALL apply approved plans only through canonical Project and Work-OS operations; it SHALL NOT write issue files or authoritative issue state directly.

#### Scenario: Unlinked observation becomes work
- **WHEN** a user approves an Issue Change Plan for an observation with no linked issue
- **THEN** the system invokes `project.issue.create`, records the resulting issue entity on the observation, and preserves the observation evidence in the issue or sibling comment

#### Scenario: Matching issue already exists
- **WHEN** deduplication or explicit selection finds an authoritative issue for the problem
- **THEN** the plan proposes an update or comment instead of creating a second issue

### Requirement: User-selected problem disposition
Problem Intake SHALL let the user explicitly choose `local_only`, `submit_issue`, or `prepare_pull_request` for a reviewed observation and SHALL NOT infer remote-submission consent from diagnostic collection, model generation, prior approval, repository configuration, or installed credentials.

#### Scenario: User keeps a finding local
- **WHEN** the user selects `local_only` or closes the disposition view
- **THEN** the observation remains local and no remote Issue, branch, fork, or pull request is created

#### Scenario: User chooses upstream Issue
- **WHEN** the user selects `submit_issue`
- **THEN** the system prepares an exact, editable, secret-safe contribution preview and performs no remote mutation until that specific plan is confirmed

#### Scenario: User requests a pull request without a verified fix
- **WHEN** no isolated patch with passing regression evidence can be produced
- **THEN** `prepare_pull_request` is unavailable with explained evidence and the system offers `submit_issue` without submitting it automatically

### Requirement: Safe upstream Issue submission
An upstream Issue plan SHALL identify the exact provider and repository, sanitized title and body, bounded evidence references, labels, linked Problem Observation and Work-OS entity, Settings snapshot, warnings, plan fingerprint, and remote facts used for planning. Apply SHALL route local work through Work-OS and remote creation through the governed project-tracker projection with explicit per-run approval and mutation receipts.

#### Scenario: User confirms the exact Issue preview
- **WHEN** the target, sanitized content, current Settings snapshot, reviewed local issue head, and plan fingerprint still match
- **THEN** the remote Issue is created once, its remote identity and revision are linked to the observation and local Work-OS issue, and the receipt is auditable

#### Scenario: Remote Issue outcome is unknown
- **WHEN** the provider may have accepted the create but no durable success receipt was recorded
- **THEN** automatic retry is blocked and the user is shown a reconciliation action instead of risking a duplicate Issue

### Requirement: Verified pull-request preparation and submission
Pull-request preparation SHALL require a governed forge binding, a resolved repository and base revision, isolated changes that do not modify unrelated user work, a bounded diff, passing regression tests, secret-safe metadata, and an immutable contribution plan. Apply SHALL require explicit confirmation of the exact diff, tests, target, branch or fork, title, body, draft state, and plan fingerprint.

#### Scenario: Verified patch is ready
- **WHEN** the isolated patch passes its declared regression tests and repository facts still match
- **THEN** Ask Mate may offer separate confirmations to push the contribution branch and create a draft pull request linked to the observation and local issue

#### Scenario: Base revision changes after preview
- **WHEN** the target base, patch content, test evidence, permissions, or contribution metadata changes after the plan is shown
- **THEN** apply fails closed and requires a new preview

#### Scenario: Draft pull request is created
- **WHEN** the user confirms the current draft-PR plan and the provider returns a bounded remote identity and revision
- **THEN** the system stores a replay-safe receipt and links the pull request without marking it ready or merging it

#### Scenario: User wants the pull request ready for review
- **WHEN** a draft pull request exists and the user requests ready-for-review
- **THEN** the system requires a separate current-state preview and explicit confirmation; merge remains outside this flow

### Requirement: Safe diagnostic evidence
Problem Intake SHALL reject or redact credentials, machine-local secrets, unbounded plugin-private payloads, and undeclared personal data before persistence, and SHALL store bounded evidence references rather than opaque raw dumps.

#### Scenario: Plugin diagnostic includes an authorization header
- **WHEN** a provider returns secret-bearing diagnostic material
- **THEN** intake rejects or redacts the field, records a safe provider failure diagnostic, and never writes the secret to vault state or audit output

#### Scenario: Local evidence contains private vault content
- **WHEN** an Issue or pull-request preview would include private note content, absolute paths, tokens, or undeclared personal data
- **THEN** the remote plan omits or redacts it, explains the omission, and lets the user edit the remaining bounded report before confirmation
