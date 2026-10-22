# LLM Wiki onboarding

Follow this path once to reach a cited search result from Obsidian. The plugin is the
normal human entrypoint; MCP and CLI remain available for agents and automation.

## Prerequisites

- Obsidian desktop with a filesystem-backed vault.
- The LLM Wiki plugin enabled in that vault.
- Node.js 20+ only when the plugin is configured to use the local control-plane host.
- A canonical Project ID such as `project/my-project`.

Python, compiler workers, and optional adapters are not prerequisites for opening the
plugin or using filesystem search.

## 1. Open the LLM Wiki settings

Open **Settings → Community plugins → LLM Wiki**. Keep **Getting Started** open.

You should see **System status**, a Project binding action, and a five-step progress
list. The plugin stores presentation preferences and a device-local binding only; it
does not store credentials, query history, Flow state, or Work Run state.

If the control plane is unavailable, the page shows the failure as a capability state.
Use **Retry** after fixing the reported dependency. Do not paste a token into a Project
record or plugin data.

## 2. Bind the workspace

Select **Bind workspace** and enter a canonical ID, for example:

```text
project/my-project
```

The plugin creates or reuses the Project registry and Work-OS anchor, then refreshes
the Settings Platform snapshot.

Expected result: the progress list highlights **Repair capabilities**, **Complete
minimum settings**, or **Run the first search**. The Project ID is stable identity;
the local vault path remains a device binding.

If the ID is rejected, use lowercase letters, digits, and hyphens after `project/`.
Do not use a repository path as the Project ID.

## 3. Read capability health and repair only what is blocked

Each unavailable capability has a bounded explanation and a remediation action. Select
**How to fix** for the relevant capability, make the requested settings change, then
select **Run Doctor**.

Optional Python, MemU, graph, and semantic-query workers may remain unavailable. In
that state filesystem search and ordinary vault use remain available. A required
capability blocks only the operation that needs it.

See [Capability remediation](CAPABILITY_REMEDIATION.md) for the diagnostic codes,
owner, safe repair, and verification command.

## 4. Complete minimum settings

Open **All Settings** only when the Getting Started card reports a validation error.
Resolve the listed error in the scope shown by the setting. Secret values must be
represented by a Secret Reference; the raw value must stay in the device environment
or secret store.

Expected result: no blocking validation errors remain and the next action changes to
**Run the first search**.

## 5. Run the first search

Select **Open LLM Wiki**. For a Project context, enter a short query such as:

```text
recovery
```

The first search is read-only. A successful result shows the result text, citation
Target, and provenance. A missing optional adapter does not remove the filesystem
result. The Getting Started card records completion only in the current plugin session;
Flow details are never serialized into plugin data.

Expected result: the progress list reaches **Ready**, and the Project Hub remains a
read-only composition of Work-OS, knowledge, capability, and integration state.

## What to use next

- Use the Project Hub for recovery, cited search, and immutable Plan preview.
- Use **All Settings** and **System status** for configuration and remediation.
- Use MCP for agent access to the same domain Operations.
- Use `llmwiki-recovery` for headless `open`, `search`, `plan`, `refresh-plan`, `restart`,
  and `apply` requests. Later-stage requests are supplied through JSON files.
- Use the normal review and promotion paths before moving drafts into durable knowledge.

The canonical boundaries are documented in [AGENT_WORKFLOW_INTEGRATION.md](AGENT_WORKFLOW_INTEGRATION.md)
and [the product spine](../30-Architecture/llm-wiki-product-spine.md).
