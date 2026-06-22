# Use MCP runtime libraries for server plumbing

LLMwiki should not hand-roll MCP protocol plumbing such as tool listing, tool calls, transports, schema conversion, or response formatting. The server should use the official MCP TypeScript SDK or a mature MCP framework for runtime concerns, while LLMwiki owns the domain operation layer: Source Registry, Ingest Preflight, Markdown Memory, Project Management, Query, adapters, and vault-safe storage. This keeps the product focused on local knowledge workflows and reduces breakage as the MCP ecosystem evolves.
