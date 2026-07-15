# `@obsidian-llm-wiki/agent-domain`

Host-neutral pure domain core for governed LLM Wiki agents. It does not depend on Obsidian, MCP, a model provider, the compiler, or the settings platform.

It provides:

- versioned `AgentProfile`, `ProjectAgentBinding`, durable `Thread`, and read-only Agent Room contracts;
- copy-on-write filesystem stores with stable IDs and optimistic expected-revision conflicts;
- a deterministic four-layer Context Envelope compiler with mandatory-preserving token trimming and a locked model fingerprint;
- immutable Dream Time proposals, revisions, events, decisions, idempotency receipts, protected-memory enforcement, and recovery after an interrupted revision commit;
- read-only as-of Context Consult with explicit expiring grants, stale-result marking, and replay-safe artifacts;
- reviewable Delegation Plans that lock Assignment Plan, device snapshot, Profile/Binding versions, context fingerprint, budget, and expected output;
- independent Child Work Runs and Artifact Projections governed by Promotion and per-run Operation Write policies;
- deterministic read-only Store listings for Project Hub and doctor projections;
- recursive rejection of secret material and machine-local paths from shared state.

Runtime adapters own authentication, authorization policy implementation, filesystem root selection, model invocation, and host UI. The proposal worker receives a frozen input value and no mutation capability; only an authorized transition can publish a new memory revision.

```ts
import {
  AgentDomainService,
  compileContextEnvelope,
  DreamTimeStore,
} from "@obsidian-llm-wiki/agent-domain";
```

JSON Schemas in `schemas/` are versioned interchange contracts. Runtime validation remains strict and rejects additional fields, secrets, paths, tampered fingerprints, and stale revisions.
