import type { Operation } from "../../mcp-server/src/core/types";

/**
 * Obsidian exposure policy for the shared application catalog.
 *
 * This is intentionally a predicate over Operations, not a second operation
 * registration list. The MCP/application catalog remains canonical; Obsidian
 * only chooses the subset appropriate for its desktop control surface.
 */
export function isObsidianControlPlaneOperation(operation: Pick<Operation, "name">): boolean {
  if (operation.name === "graph.adapters.query") return true;
  if (operation.name === "context.recall") return true;
  if (operation.name === "vault.writeAIOutput") return true;
  if (operation.name.startsWith("project.migration.")) return false;
  if (["agent.status", "agent.trigger", "agent.schedule", "agent.history"].includes(operation.name)) {
    return false;
  }
  return [
    "settings.",
    "project.",
    "visual.",
    "problem.",
    "usage.",
    "host.",
    "agent.",
    "dreamtime.",
    "consult.",
    "delegation.",
  ].some((prefix) => operation.name.startsWith(prefix));
}
