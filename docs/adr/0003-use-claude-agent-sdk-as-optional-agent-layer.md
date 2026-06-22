# Use Claude Agent SDK as optional agent layer

LLMwiki may use Claude Code Agent SDK as an optional orchestration layer for workflows such as analyzing a person, expanding a Source, summarizing a dataset, generating project issues, or writing handoff and passport notes. The MCP server core should remain model-agnostic and expose stable domain tools for Source, Ingest, Memory, Project, Query, and Vault operations; Claude-specific dependencies belong in a separate agent/client layer so other hosts, models, and local workflows can use the same LLMwiki core.
