export const SETTINGS_SCHEMA_VERSION = 1;

export type SettingScope = "user-device" | "vault" | "workspace-project" | "session";
export type SettingValue = string | boolean | number;
export type SettingsCategory = "runtime" | "vault" | "query" | "diagnostics" | "providers";
export const EDITABLE_SCOPES: SettingScope[] = ["user-device", "vault"];

export interface SettingDefinition {
  key: string;
  category: SettingsCategory;
  name: string;
  description: string;
  valueType: "string" | "boolean" | "secret-reference";
  defaultValue: SettingValue;
  allowedScopes: SettingScope[];
  applyMode: "hot" | "next-operation" | "restart-required";
  required?: boolean;
  advanced?: boolean;
  placeholder?: string;
}

export interface LLMWikiSettingsData {
  schemaVersion: number;
  revision: number;
  assignments: Record<SettingScope, Record<string, SettingValue>>;
  presentation: {
    selectedScope: SettingScope;
    showAdvanced: boolean;
  };
}

export interface EffectiveSetting {
  definition: SettingDefinition;
  value: SettingValue;
  winningScope: SettingScope | "product-default";
  overriddenScopes: SettingScope[];
}

export interface SettingValidationIssue {
  key: string;
  severity: "error" | "warning";
  message: string;
}

export interface LegacyPluginData {
  pythonPath?: unknown;
  kbMetaPath?: unknown;
  schemaVersion?: unknown;
  revision?: unknown;
  assignments?: unknown;
  presentation?: unknown;
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: "providers.web_search.enabled",
    category: "providers",
    name: "Web search provider",
    description: "Allow unified query workflows to use the configured web search provider.",
    valueType: "boolean",
    defaultValue: false,
    allowedScopes: ["vault", "workspace-project", "session"],
    applyMode: "next-operation",
  },
  {
    key: "runtime.python.path",
    category: "runtime",
    name: "Python runtime",
    description: "Interpreter used by LLM Wiki's Python capabilities.",
    valueType: "string",
    defaultValue: "python",
    allowedScopes: ["user-device", "session"],
    applyMode: "next-operation",
    required: true,
    placeholder: "python or an absolute executable path",
  },
  {
    key: "runtime.kb_meta.path",
    category: "runtime",
    name: "LLM Wiki runtime entry",
    description: "Absolute path to compiler/kb_meta.py. This is a runtime binding, not vault knowledge.",
    valueType: "string",
    defaultValue: "",
    allowedScopes: ["user-device", "session"],
    applyMode: "next-operation",
    required: true,
    placeholder: "D:\\projects\\obsidian-llm-wiki\\compiler\\kb_meta.py",
  },
  {
    key: "query.semantic.enabled",
    category: "query",
    name: "Semantic query",
    description: "Enable semantic retrieval when its configured provider is available.",
    valueType: "boolean",
    defaultValue: false,
    allowedScopes: ["vault", "workspace-project", "session"],
    applyMode: "next-operation",
  },
  {
    key: "diagnostics.obc.semantic.enabled",
    category: "diagnostics",
    name: "OBC semantic suggestions",
    description: "Add optional semantic suggestions while deterministic link diagnostics remain available.",
    valueType: "boolean",
    defaultValue: false,
    allowedScopes: ["vault", "workspace-project", "session"],
    applyMode: "next-operation",
  },
  {
    key: "providers.web_search.secret_ref",
    category: "providers",
    name: "Web search secret reference",
    description: "Opaque environment reference. The secret value is never stored by the plugin.",
    valueType: "secret-reference",
    defaultValue: "env:TAVILY_API_KEY",
    allowedScopes: ["user-device", "session"],
    applyMode: "next-operation",
    advanced: true,
    placeholder: "env:TAVILY_API_KEY",
  },
];

const SCOPE_PRECEDENCE: SettingScope[] = ["session", "workspace-project", "vault", "user-device"];

export function createDefaultSettings(): LLMWikiSettingsData {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    revision: 0,
    assignments: {
      "user-device": {},
      vault: {},
      "workspace-project": {},
      session: {},
    },
    presentation: {
      selectedScope: "user-device",
      showAdvanced: false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAssignments(value: unknown): LLMWikiSettingsData["assignments"] {
  const empty = createDefaultSettings().assignments;
  if (!isRecord(value)) return empty;
  for (const scope of SCOPE_PRECEDENCE) {
    const candidate = value[scope];
    if (!isRecord(candidate)) continue;
    for (const [key, settingValue] of Object.entries(candidate)) {
      if (["string", "boolean", "number"].includes(typeof settingValue)) {
        empty[scope][key] = settingValue as SettingValue;
      }
    }
  }
  return empty;
}

export function migrateSettings(raw: unknown): { data: LLMWikiSettingsData; migrated: boolean } {
  const defaults = createDefaultSettings();
  if (!isRecord(raw)) return { data: defaults, migrated: false };

  if (raw.schemaVersion === SETTINGS_SCHEMA_VERSION) {
    const presentation = isRecord(raw.presentation) ? raw.presentation : {};
    const selected = presentation.selectedScope;
    const selectedScope = EDITABLE_SCOPES.includes(selected as SettingScope)
      ? selected as SettingScope
      : defaults.presentation.selectedScope;
    return {
      data: {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        revision: typeof raw.revision === "number" ? Math.max(0, Math.floor(raw.revision)) : 0,
        assignments: normalizeAssignments(raw.assignments),
        presentation: {
          selectedScope,
          showAdvanced: presentation.showAdvanced === true,
        },
      },
      migrated: false,
    };
  }

  if (typeof raw.schemaVersion === "number") {
    throw new Error(`Unsupported settings schema version: ${raw.schemaVersion}`);
  }

  const legacy = raw as LegacyPluginData;
  if (typeof legacy.pythonPath === "string" && legacy.pythonPath.trim()) {
    defaults.assignments["user-device"]["runtime.python.path"] = legacy.pythonPath.trim();
  }
  if (typeof legacy.kbMetaPath === "string" && legacy.kbMetaPath.trim()) {
    defaults.assignments["user-device"]["runtime.kb_meta.path"] = legacy.kbMetaPath.trim();
  }
  const migrated = "pythonPath" in legacy || "kbMetaPath" in legacy;
  return { data: defaults, migrated };
}

export function resolveSettings(data: LLMWikiSettingsData): Map<string, EffectiveSetting> {
  const resolved = new Map<string, EffectiveSetting>();
  for (const definition of SETTING_DEFINITIONS) {
    let value = definition.defaultValue;
    let winningScope: EffectiveSetting["winningScope"] = "product-default";
    const overriddenScopes: SettingScope[] = [];
    for (const scope of SCOPE_PRECEDENCE) {
      const assigned = data.assignments[scope][definition.key];
      if (assigned === undefined || !definition.allowedScopes.includes(scope)) continue;
      if (winningScope === "product-default") {
        value = assigned;
        winningScope = scope;
      } else {
        overriddenScopes.push(scope);
      }
    }
    resolved.set(definition.key, { definition, value, winningScope, overriddenScopes });
  }
  return resolved;
}

export function setAssignment(
  data: LLMWikiSettingsData,
  scope: SettingScope,
  key: string,
  value: SettingValue | undefined,
): LLMWikiSettingsData {
  const definition = SETTING_DEFINITIONS.find(item => item.key === key);
  if (!definition) throw new Error(`Unknown setting: ${key}`);
  if (!definition.allowedScopes.includes(scope)) throw new Error(`${key} cannot be set at ${scope} scope`);

  const assignments = normalizeAssignments(data.assignments);
  if (value === undefined || (typeof value === "string" && value.trim() === "" && !definition.required)) {
    delete assignments[scope][key];
  } else {
    assignments[scope][key] = typeof value === "string" ? value.trim() : value;
  }
  return {
    ...data,
    revision: data.revision + 1,
    assignments,
  };
}

export function validateSettings(data: LLMWikiSettingsData): SettingValidationIssue[] {
  const resolved = resolveSettings(data);
  const issues: SettingValidationIssue[] = [];
  for (const effective of resolved.values()) {
    const { definition, value } = effective;
    const expectedType = definition.valueType === "boolean" ? "boolean" : "string";
    if (typeof value !== expectedType) {
      issues.push({ key: definition.key, severity: "error", message: `${definition.name} must be a ${expectedType}.` });
      continue;
    }
    if (definition.required && typeof value === "string" && !value.trim()) {
      issues.push({ key: definition.key, severity: "error", message: `${definition.name} is required.` });
    }
    if (definition.valueType === "secret-reference" && typeof value === "string" && value && !value.startsWith("env:")) {
      issues.push({ key: definition.key, severity: "error", message: `${definition.name} must use an env: reference.` });
    }
  }
  const knownKeys = new Set(SETTING_DEFINITIONS.map(definition => definition.key));
  for (const scope of SCOPE_PRECEDENCE) {
    for (const key of Object.keys(data.assignments[scope])) {
      if (!knownKeys.has(key)) {
        issues.push({ key, severity: "warning", message: `Unknown ${scope} setting is preserved but ignored.` });
      }
    }
  }
  return issues;
}

export function getEffectiveValue<T extends SettingValue>(data: LLMWikiSettingsData, key: string): T {
  const effective = resolveSettings(data).get(key);
  if (!effective) throw new Error(`Unknown setting: ${key}`);
  return effective.value as T;
}
