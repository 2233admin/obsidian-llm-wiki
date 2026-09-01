export const CANONICAL_VAULT_ENV = "VAULT_MIND_VAULT_PATH" as const;
export const LEGACY_VAULT_ENV = "VAULT_BRIDGE_VAULT" as const;

export function readVaultEnvironment(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  return environment[CANONICAL_VAULT_ENV] || environment[LEGACY_VAULT_ENV];
}
