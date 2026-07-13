import { readFileSync } from "node:fs";

import { canonicalDigest, deepClone } from "./canonical.js";
import type { SettingDefinition, SettingsRegistry } from "./types.js";

type RegistryDocument = Omit<SettingsRegistry, "registryDigest"> & { registryDigest?: string };

export function loadRegistry(path: string): SettingsRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Settings registry could not be loaded: ${(error as Error).message}`);
  }
  return parseRegistry(parsed);
}

export function parseRegistry(parsed: unknown): SettingsRegistry {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Settings registry must be a JSON object");
  }
  const raw = parsed as RegistryDocument;
  if (!Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 1) {
    throw new Error("Settings registry schemaVersion must be a positive integer");
  }
  if (typeof raw.registryVersion !== "string" || !raw.registryVersion.trim()) {
    throw new Error("Settings registry registryVersion is required");
  }
  if (!Array.isArray(raw.definitions) || !Array.isArray(raw.migrations)) {
    throw new Error("Settings registry definitions and migrations must be arrays");
  }
  const material = {
    schemaVersion: raw.schemaVersion,
    registryVersion: raw.registryVersion,
    definitions: raw.definitions,
    migrations: raw.migrations,
  };
  const digest = canonicalDigest(material);
  if (raw.registryDigest && raw.registryDigest !== digest) {
    throw new Error(`Settings registry digest mismatch: expected ${raw.registryDigest}, calculated ${digest}`);
  }
  const registry: SettingsRegistry = { ...deepClone(material), registryDigest: digest };
  validateRegistry(registry);
  return registry;
}

export function definitionMap(registry: SettingsRegistry): Map<string, SettingDefinition> {
  return new Map(registry.definitions.map(definition => [definition.key, definition]));
}

export function getDefinition(registry: SettingsRegistry, key: string): SettingDefinition | undefined {
  return registry.definitions.find(definition => definition.key === key);
}

function validateRegistry(registry: SettingsRegistry): void {
  const keys = new Set<string>();
  for (const rawDefinition of registry.definitions as unknown[]) {
    if (!rawDefinition || typeof rawDefinition !== "object" || Array.isArray(rawDefinition)) {
      throw new Error("Setting definition must be a JSON object");
    }
    const definition = rawDefinition as SettingDefinition;
    if (!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(definition.key)) {
      throw new Error(`Setting key must be namespaced: ${definition.key}`);
    }
    if (keys.has(definition.key)) throw new Error(`Duplicate setting definition: ${definition.key}`);
    keys.add(definition.key);
    if (![definition.owner, definition.category, definition.name, definition.description]
      .every(value => typeof value === "string" && value.trim())) {
      throw new Error(`Setting definition metadata is incomplete: ${definition.key}`);
    }
    if (!SETTING_VALUE_TYPES.has(definition.valueType)) {
      throw new Error(`Setting definition has an invalid valueType: ${definition.key}`);
    }
    if (!Array.isArray(definition.allowedScopes)
      || definition.allowedScopes.length === 0
      || new Set(definition.allowedScopes).size !== definition.allowedScopes.length
      || definition.allowedScopes.some(scope => !MUTABLE_SCOPES.has(scope))) {
      throw new Error(`Setting definition has no allowed scopes: ${definition.key}`);
    }
    if (!SENSITIVITIES.has(definition.sensitivity)) {
      throw new Error(`Setting definition has an invalid sensitivity: ${definition.key}`);
    }
    if (!APPLY_MODES.has(definition.applyMode) || !VISIBILITIES.has(definition.visibility)) {
      throw new Error(`Setting definition presentation metadata is invalid: ${definition.key}`);
    }
    if (!definition.validator
      || typeof definition.validator !== "object"
      || Array.isArray(definition.validator)
      || typeof definition.validator.id !== "string"
      || !definition.validator.id.trim()) {
      throw new Error(`Setting definition validator is incomplete: ${definition.key}`);
    }
    validateValidator(definition);
    if (!Array.isArray(definition.requires)
      || definition.requires.some(key => typeof key !== "string")
      || new Set(definition.requires).size !== definition.requires.length) {
      throw new Error(`Setting definition requirements are invalid: ${definition.key}`);
    }
    if (definition.valueType === "secret-reference") {
      if (!isSecretReference(definition.defaultSecretRef) || definition.defaultValue !== undefined) {
        throw new Error(`Secret setting must define defaultSecretRef only: ${definition.key}`);
      }
      if (definition.sensitivity !== "secret-reference") {
        throw new Error(`Secret setting must use secret-reference sensitivity: ${definition.key}`);
      }
    } else {
      if (definition.defaultSecretRef !== undefined) {
        throw new Error(`Non-secret setting cannot define defaultSecretRef: ${definition.key}`);
      }
      if (definition.defaultValue === undefined || !defaultMatchesType(definition)) {
        throw new Error(`Setting default does not match ${definition.valueType}: ${definition.key}`);
      }
    }
  }
  for (const migration of registry.migrations as unknown[]) {
    if (!migration || typeof migration !== "object" || Array.isArray(migration)) {
      throw new Error("Settings migration must be a JSON object");
    }
    const item = migration as SettingsRegistry["migrations"][number];
    if (typeof item.id !== "string" || !item.id.trim()
      || typeof item.description !== "string" || !item.description.trim()
      || !Number.isInteger(item.fromSchemaVersion) || item.fromSchemaVersion < 0
      || !Number.isInteger(item.toSchemaVersion) || item.toSchemaVersion < 1) {
      throw new Error(`Settings migration is invalid: ${item.id ?? "unknown"}`);
    }
  }
}

const SETTING_VALUE_TYPES = new Set(["boolean", "integer", "number", "string", "enum", "path", "duration", "list", "object", "secret-reference"]);
const MUTABLE_SCOPES = new Set(["user-device", "vault", "workspace-project", "session"]);
const SENSITIVITIES = new Set(["public", "local", "secret-reference"]);
const APPLY_MODES = new Set(["hot", "next-operation", "restart-required"]);
const VISIBILITIES = new Set(["normal", "advanced", "internal"]);
const SECRET_PROVIDERS = new Set(["os-keychain", "environment", "external-vault"]);

function validateValidator(definition: SettingDefinition): void {
  const validator = definition.validator;
  if (validator.required !== undefined && typeof validator.required !== "boolean") {
    throw new Error(`Setting validator required flag is invalid: ${definition.key}`);
  }
  if (validator.enum !== undefined && (!Array.isArray(validator.enum)
    || validator.enum.some(value => typeof value !== "string")
    || new Set(validator.enum).size !== validator.enum.length)) {
    throw new Error(`Setting validator enum is invalid: ${definition.key}`);
  }
  for (const value of [validator.min, validator.max]) {
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error(`Setting validator numeric bound is invalid: ${definition.key}`);
    }
  }
  for (const value of [validator.minLength, validator.maxLength]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`Setting validator length bound is invalid: ${definition.key}`);
    }
  }
  if (validator.pattern !== undefined) {
    if (typeof validator.pattern !== "string") throw new Error(`Setting validator pattern is invalid: ${definition.key}`);
    try {
      new RegExp(validator.pattern);
    } catch {
      throw new Error(`Setting validator pattern is invalid: ${definition.key}`);
    }
  }
}

function isSecretReference(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ref = value as { provider?: unknown; locator?: unknown; version?: unknown };
  return typeof ref.provider === "string"
    && SECRET_PROVIDERS.has(ref.provider)
    && typeof ref.locator === "string"
    && ref.locator.trim().length > 0
    && !/[\r\n\0]/.test(ref.locator)
    && (ref.version === undefined || (typeof ref.version === "string" && ref.version.length > 0));
}

function defaultMatchesType(definition: SettingDefinition): boolean {
  const value = definition.defaultValue;
  switch (definition.valueType) {
    case "boolean": return typeof value === "boolean";
    case "integer": return Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "string":
    case "enum":
    case "path":
    case "duration": return typeof value === "string";
    case "list": return Array.isArray(value);
    case "object": return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    default: return false;
  }
}
