import type {
  EffectiveSetting,
  SecretReference,
  SecretStatus,
  SettingsScope,
  SettingsService,
  SettingsSnapshot,
} from "../../../packages/settings-platform/dist/src/index.js";

export const DEFAULT_ENABLED_ADAPTERS = [
  "filesystem",
  "memu",
  "gitnexus",
  "obsidian",
  "kanban",
  "qmd",
  "lightrag",
  "raganything",
  "hindsight",
  "vaultbrain",
  "graphify",
] as const;

const KNOWN_ADAPTERS = new Set<string>(DEFAULT_ENABLED_ADAPTERS);

export type KnowledgeAdapterProfileSource =
  | "settings-assignment"
  | "legacy-env"
  | "legacy-config"
  | "product-default";

export interface KnowledgeAdapterFieldProvenance {
  source: KnowledgeAdapterProfileSource;
  scope?: SettingsScope;
  actor?: string;
  detail: string;
}

export interface KnowledgeAdapterCredentialProfile {
  secretRef: SecretReference;
  status: SecretStatus;
  provenance: KnowledgeAdapterFieldProvenance;
}

export interface KnowledgeAdapterProfileIssue {
  code: string;
  message: string;
  key: string;
}

interface AdapterRuntimeBase {
  enabled: boolean;
  valid: boolean;
  issues: KnowledgeAdapterProfileIssue[];
}

export interface LightRAGRuntimeProfile extends AdapterRuntimeBase {
  baseUrl?: string;
  mode: string;
  queryPath: string;
  queryDataPath: string;
  documentsTextPath: string;
  documentsUploadPath: string;
  credential?: KnowledgeAdapterCredentialProfile;
  provenance: Record<string, KnowledgeAdapterFieldProvenance>;
}

export interface RAGAnythingRuntimeProfile extends AdapterRuntimeBase {
  baseUrl?: string;
  queryPath: string;
  processPath: string;
  credential?: KnowledgeAdapterCredentialProfile;
  provenance: Record<string, KnowledgeAdapterFieldProvenance>;
}

export interface KanbanRuntimeProfile extends AdapterRuntimeBase {
  glob: string;
  provenance: Record<string, KnowledgeAdapterFieldProvenance>;
}

export interface QmdRuntimeProfile extends AdapterRuntimeBase {
  collection?: string;
  binary: string;
  provenance: Record<string, KnowledgeAdapterFieldProvenance>;
}

export interface GraphifyRuntimeProfile extends AdapterRuntimeBase {
  binary: string;
  outputDir?: string;
  autoRescan: boolean;
  timeoutMs: number;
  provenance: Record<string, KnowledgeAdapterFieldProvenance>;
}

export interface HindsightRuntimeProfile extends AdapterRuntimeBase {
  baseUrl?: string;
  bankId?: string;
  timeoutMs: number;
  credential?: KnowledgeAdapterCredentialProfile;
  provenance: Record<string, KnowledgeAdapterFieldProvenance>;
}

export interface MemURuntimeProfile extends AdapterRuntimeBase {
  dsn: string;
  userId: string;
  maxResults: number;
  timeout: number;
  excludeMemoryTypes: readonly string[];
  pythonExe: string;
  memuGraphCwd: string;
  graphRecallTimeoutMs: number;
  memuSearchPy: string;
  memuSearchPythonExe: string;
  memuSearchTimeoutMs: number;
  embedModel: string;
  credential?: KnowledgeAdapterCredentialProfile;
  provenance: Record<string, KnowledgeAdapterFieldProvenance>;
}

export interface KnowledgeAdaptersRuntimeProfile {
  snapshotId: string;
  enabledAdapters: string[];
  enablement: {
    valid: boolean;
    issues: KnowledgeAdapterProfileIssue[];
    provenance: KnowledgeAdapterFieldProvenance;
  };
  memu: MemURuntimeProfile;
  lightrag: LightRAGRuntimeProfile;
  raganything: RAGAnythingRuntimeProfile;
  hindsight: HindsightRuntimeProfile;
  kanban: KanbanRuntimeProfile;
  qmd: QmdRuntimeProfile;
  graphify: GraphifyRuntimeProfile;
}

export interface LegacyGraphifyRuntimeConfig {
  binary?: string;
  outputDir?: string;
  autoRescan?: string | boolean;
  timeoutMs?: string | number;
}

export interface LegacyKnowledgeAdaptersYaml {
  enabledAdapters?: string[];
  graphify?: LegacyGraphifyRuntimeConfig;
}

export interface KnowledgeAdapterProfileOptions {
  environment?: NodeJS.ProcessEnv;
  /** Compatibility input from vault-mind.yaml. Settings assignments still win. */
  legacyEnabledAdapters?: string[];
  /** Compatibility input from flat graphify_* keys in vault-mind.yaml. */
  legacyGraphify?: LegacyGraphifyRuntimeConfig;
}

export interface KnowledgeAdapterSecretResolverOptions {
  environment?: NodeJS.ProcessEnv;
  resolveSecret?: (reference: SecretReference) => Promise<string | undefined>;
}

interface SelectedField<T> {
  value: T;
  provenance: KnowledgeAdapterFieldProvenance;
  explicit: boolean;
}

/**
 * Resolve a redacted, immutable startup profile. Legacy environment/config
 * values participate only while the corresponding Settings key still wins at
 * product scope. No secret value is read here.
 */
export async function resolveKnowledgeAdaptersRuntimeProfile(
  service: SettingsService,
  options: KnowledgeAdapterProfileOptions = {},
): Promise<KnowledgeAdaptersRuntimeProfile> {
  const environment = options.environment ?? {};
  const { snapshot } = await service.snapshotResolve();

  const legacyAdapters = legacyAdapterList(environment, options.legacyEnabledAdapters);
  const enabledSelection = selectField(
    snapshot,
    "adapters.enabled",
    legacyAdapters?.value,
    [...DEFAULT_ENABLED_ADAPTERS],
    legacyAdapters?.provenance,
  );
  const enabledIssues = validateEnabledAdapters(enabledSelection.value);
  const enabledAdapters = enabledIssues.length === 0 ? [...enabledSelection.value] : [];
  const enabled = new Set(enabledAdapters);

  const portablePython = process.platform === "win32" ? "python" : "python3";
  const memuDsn = selectMemUDsn(snapshot, environment);
  const memuUserId = selectString(snapshot, "adapters.memu.user_id", environment.MEMU_USER_ID, "MEMU_USER_ID", "default");
  const memuMaxResults = selectNumber(snapshot, "adapters.memu.max_results", undefined, "", 20);
  const memuTimeout = selectNumber(snapshot, "adapters.memu.query_timeout_ms", undefined, "", 5_000);
  const memuExcludeTypes = selectField<unknown>(snapshot, "adapters.memu.exclude_memory_types", undefined, ["event"]);
  const memuPython = selectString(snapshot, "adapters.memu.graph_python", environment.MEMU_GRAPH_PYTHON, "MEMU_GRAPH_PYTHON", portablePython);
  const memuGraphCwd = selectString(snapshot, "adapters.memu.graph_cwd", environment.MEMU_GRAPH_CWD, "MEMU_GRAPH_CWD", process.cwd());
  const memuGraphTimeout = selectNumber(snapshot, "adapters.memu.graph_timeout_ms", environment.MEMU_GRAPH_TIMEOUT_MS, "MEMU_GRAPH_TIMEOUT_MS", 15_000);
  const memuSearchPy = selectString(snapshot, "adapters.memu.search_script", environment.MEMU_SEARCH_PY, "MEMU_SEARCH_PY", "memu_search.py");
  const memuSearchPython = selectString(snapshot, "adapters.memu.search_python", environment.MEMU_SEARCH_PYTHON, "MEMU_SEARCH_PYTHON", portablePython);
  const memuSearchTimeout = selectNumber(snapshot, "adapters.memu.search_timeout_ms", environment.MEMU_SEARCH_TIMEOUT_MS, "MEMU_SEARCH_TIMEOUT_MS", 20_000);
  const memuEmbedModel = selectString(snapshot, "adapters.memu.embed_model", environment.OLLAMA_EMBED_MODEL, "OLLAMA_EMBED_MODEL", "bge-m3");
  const memuCredential = selectCredential(snapshot, "adapters.memu.secret_ref", environment, "MEMU_DSN");
  const memuIssues = enabled.has("memu")
    ? [
        ...validateMemUDsn(memuDsn.value),
        ...(memuUserId.value ? [] : [{ code: "memu-user-missing", message: "adapters.memu.user_id is required while MemU is enabled.", key: "adapters.memu.user_id" }]),
        ...validateRange("adapters.memu.max_results", memuMaxResults.value, 1, 100),
        ...validateRange("adapters.memu.query_timeout_ms", memuTimeout.value, 100, 300_000),
        ...validateRange("adapters.memu.graph_timeout_ms", memuGraphTimeout.value, 100, 300_000),
        ...validateRange("adapters.memu.search_timeout_ms", memuSearchTimeout.value, 100, 300_000),
        ...validateStringList("adapters.memu.exclude_memory_types", memuExcludeTypes.value),
        ...validateExplicitCredential("adapters.memu.secret_ref", memuCredential),
      ]
    : [];

  const lightBaseUrl = selectString(snapshot, "adapters.lightrag.base_url", environment.LIGHTRAG_URL, "LIGHTRAG_URL", "");
  const lightMode = selectString(snapshot, "adapters.lightrag.mode", environment.LIGHTRAG_MODE, "LIGHTRAG_MODE", "hybrid");
  const lightQueryPath = selectString(snapshot, "adapters.lightrag.query_path", environment.LIGHTRAG_QUERY_PATH, "LIGHTRAG_QUERY_PATH", "/query");
  const lightQueryDataPath = selectString(snapshot, "adapters.lightrag.query_data_path", environment.LIGHTRAG_QUERY_DATA_PATH, "LIGHTRAG_QUERY_DATA_PATH", "/query/data");
  const lightDocumentsTextPath = selectString(snapshot, "adapters.lightrag.documents_text_path", environment.LIGHTRAG_DOCUMENTS_TEXT_PATH, "LIGHTRAG_DOCUMENTS_TEXT_PATH", "/documents/text");
  const lightDocumentsUploadPath = selectString(snapshot, "adapters.lightrag.documents_upload_path", environment.LIGHTRAG_DOCUMENTS_UPLOAD_PATH, "LIGHTRAG_DOCUMENTS_UPLOAD_PATH", "/documents/upload");
  const lightCredential = selectCredential(snapshot, "adapters.lightrag.secret_ref", environment, "LIGHTRAG_API_KEY");
  const lightIssues = enabled.has("lightrag")
    ? [
        ...validateEndpoint("adapters.lightrag.base_url", lightBaseUrl.value),
        ...validateExplicitCredential("adapters.lightrag.secret_ref", lightCredential),
      ]
    : [];

  const ragBaseUrl = selectString(snapshot, "adapters.raganything.base_url", environment.RAGANYTHING_URL, "RAGANYTHING_URL", "");
  const ragQueryPath = selectString(snapshot, "adapters.raganything.query_path", environment.RAGANYTHING_QUERY_PATH, "RAGANYTHING_QUERY_PATH", "/query");
  const ragProcessPath = selectString(snapshot, "adapters.raganything.process_path", environment.RAGANYTHING_PROCESS_PATH, "RAGANYTHING_PROCESS_PATH", "/process_document");
  const ragCredential = selectCredential(snapshot, "adapters.raganything.secret_ref", environment, "RAGANYTHING_API_KEY");
  const ragIssues = enabled.has("raganything")
    ? [
        ...validateEndpoint("adapters.raganything.base_url", ragBaseUrl.value),
        ...validateExplicitCredential("adapters.raganything.secret_ref", ragCredential),
      ]
    : [];

  const hindsightUrl = selectString(
    snapshot,
    "adapters.hindsight.base_url",
    environment.HINDSIGHT_URL ?? environment.HINDSIGHT_BASE_URL,
    environment.HINDSIGHT_URL ? "HINDSIGHT_URL" : "HINDSIGHT_BASE_URL",
    "",
  );
  const hindsightBank = selectString(snapshot, "adapters.hindsight.bank_id", environment.HINDSIGHT_BANK_ID, "HINDSIGHT_BANK_ID", "");
  const hindsightTimeout = selectNumber(
    snapshot,
    "adapters.hindsight.timeout_ms",
    environment.HINDSIGHT_TIMEOUT_MS,
    "HINDSIGHT_TIMEOUT_MS",
    10_000,
  );
  const hindsightCredential = selectCredential(snapshot, "adapters.hindsight.secret_ref", environment, "HINDSIGHT_API_KEY");
  const hindsightIssues = enabled.has("hindsight")
    ? [
        ...validateEndpoint("adapters.hindsight.base_url", hindsightUrl.value),
        ...(hindsightBank.value ? [] : [{ code: "hindsight-bank-missing", message: "adapters.hindsight.bank_id is required while Hindsight is enabled.", key: "adapters.hindsight.bank_id" }]),
        ...(hindsightTimeout.value >= 100 && hindsightTimeout.value <= 300_000
          ? []
          : [{ code: "hindsight-timeout-invalid", message: "adapters.hindsight.timeout_ms must be between 100 and 300000.", key: "adapters.hindsight.timeout_ms" }]),
        ...validateExplicitCredential("adapters.hindsight.secret_ref", hindsightCredential),
      ]
    : [];

  const kanbanGlob = selectString(snapshot, "adapters.kanban.glob", environment.VAULT_MIND_KANBAN_GLOB, "VAULT_MIND_KANBAN_GLOB", "**/*.md");
  const qmdCollection = selectString(snapshot, "adapters.qmd.collection", environment.VAULT_MIND_QMD_COLLECTION, "VAULT_MIND_QMD_COLLECTION", "");
  const qmdBinary = selectString(snapshot, "adapters.qmd.binary", undefined, "", "qmd");
  const graphifyBinary = selectLegacyString(
    snapshot,
    "adapters.graphify.binary",
    environment.VAULT_MIND_GRAPHIFY_BINARY,
    "VAULT_MIND_GRAPHIFY_BINARY",
    options.legacyGraphify?.binary,
    "vault-mind.yaml:graphify_binary",
    "graphify",
  );
  const graphifyOutputDir = selectLegacyString(
    snapshot,
    "adapters.graphify.output_dir",
    environment.VAULT_MIND_GRAPHIFY_OUTPUT_DIR,
    "VAULT_MIND_GRAPHIFY_OUTPUT_DIR",
    options.legacyGraphify?.outputDir,
    "vault-mind.yaml:graphify_output_dir",
    "",
  );
  const graphifyAutoRescan = selectLegacyBoolean(
    snapshot,
    "adapters.graphify.auto_rescan",
    environment.VAULT_MIND_GRAPHIFY_AUTO_RESCAN,
    "VAULT_MIND_GRAPHIFY_AUTO_RESCAN",
    options.legacyGraphify?.autoRescan,
    "vault-mind.yaml:graphify_auto_rescan",
    false,
  );
  const graphifyTimeout = selectLegacyNumber(
    snapshot,
    "adapters.graphify.timeout_ms",
    environment.VAULT_MIND_GRAPHIFY_TIMEOUT_MS,
    "VAULT_MIND_GRAPHIFY_TIMEOUT_MS",
    options.legacyGraphify?.timeoutMs,
    "vault-mind.yaml:graphify_timeout_ms",
    30_000,
  );
  const graphifyIssues = enabled.has("graphify")
    ? [
        ...validateRequiredLocalPath("adapters.graphify.binary", graphifyBinary.value),
        ...validateOptionalLocalPath("adapters.graphify.output_dir", graphifyOutputDir.value),
        ...(typeof graphifyAutoRescan.value === "boolean"
          ? []
          : [{ code: "graphify-auto-rescan-invalid", message: "adapters.graphify.auto_rescan must be true or false.", key: "adapters.graphify.auto_rescan" }]),
        ...validateRange("adapters.graphify.timeout_ms", graphifyTimeout.value, 100, 300_000),
      ]
    : [];

  return {
    snapshotId: snapshot.snapshotId,
    enabledAdapters,
    enablement: {
      valid: enabledIssues.length === 0,
      issues: enabledIssues,
      provenance: enabledSelection.provenance,
    },
    memu: {
      enabled: enabled.has("memu"),
      valid: memuIssues.length === 0,
      issues: memuIssues,
      dsn: memuDsn.value,
      userId: memuUserId.value,
      maxResults: memuMaxResults.value,
      timeout: memuTimeout.value,
      excludeMemoryTypes: Array.isArray(memuExcludeTypes.value) ? memuExcludeTypes.value as string[] : [],
      pythonExe: memuPython.value,
      memuGraphCwd: memuGraphCwd.value,
      graphRecallTimeoutMs: memuGraphTimeout.value,
      memuSearchPy: memuSearchPy.value,
      memuSearchPythonExe: memuSearchPython.value,
      memuSearchTimeoutMs: memuSearchTimeout.value,
      embedModel: memuEmbedModel.value,
      ...(memuCredential.profile ? { credential: memuCredential.profile } : {}),
      provenance: {
        dsn: memuDsn.provenance,
        userId: memuUserId.provenance,
        maxResults: memuMaxResults.provenance,
        timeout: memuTimeout.provenance,
        excludeMemoryTypes: memuExcludeTypes.provenance,
        pythonExe: memuPython.provenance,
        memuGraphCwd: memuGraphCwd.provenance,
        graphRecallTimeoutMs: memuGraphTimeout.provenance,
        memuSearchPy: memuSearchPy.provenance,
        memuSearchPythonExe: memuSearchPython.provenance,
        memuSearchTimeoutMs: memuSearchTimeout.provenance,
        embedModel: memuEmbedModel.provenance,
        credential: memuCredential.provenance,
      },
    },
    lightrag: {
      enabled: enabled.has("lightrag"),
      valid: lightIssues.length === 0,
      issues: lightIssues,
      baseUrl: nonEmpty(lightBaseUrl.value),
      mode: lightMode.value,
      queryPath: normalizePath(lightQueryPath.value),
      queryDataPath: normalizePath(lightQueryDataPath.value),
      documentsTextPath: normalizePath(lightDocumentsTextPath.value),
      documentsUploadPath: normalizePath(lightDocumentsUploadPath.value),
      ...(lightCredential.profile ? { credential: lightCredential.profile } : {}),
      provenance: {
        baseUrl: lightBaseUrl.provenance,
        mode: lightMode.provenance,
        queryPath: lightQueryPath.provenance,
        queryDataPath: lightQueryDataPath.provenance,
        documentsTextPath: lightDocumentsTextPath.provenance,
        documentsUploadPath: lightDocumentsUploadPath.provenance,
        credential: lightCredential.provenance,
      },
    },
    raganything: {
      enabled: enabled.has("raganything"),
      valid: ragIssues.length === 0,
      issues: ragIssues,
      baseUrl: nonEmpty(ragBaseUrl.value),
      queryPath: normalizePath(ragQueryPath.value),
      processPath: normalizePath(ragProcessPath.value),
      ...(ragCredential.profile ? { credential: ragCredential.profile } : {}),
      provenance: {
        baseUrl: ragBaseUrl.provenance,
        queryPath: ragQueryPath.provenance,
        processPath: ragProcessPath.provenance,
        credential: ragCredential.provenance,
      },
    },
    hindsight: {
      enabled: enabled.has("hindsight"),
      valid: hindsightIssues.length === 0,
      issues: hindsightIssues,
      baseUrl: nonEmpty(hindsightUrl.value),
      bankId: nonEmpty(hindsightBank.value),
      timeoutMs: hindsightTimeout.value,
      ...(hindsightCredential.profile ? { credential: hindsightCredential.profile } : {}),
      provenance: {
        baseUrl: hindsightUrl.provenance,
        bankId: hindsightBank.provenance,
        timeoutMs: hindsightTimeout.provenance,
        credential: hindsightCredential.provenance,
      },
    },
    kanban: {
      enabled: enabled.has("kanban"),
      valid: Boolean(kanbanGlob.value),
      issues: kanbanGlob.value ? [] : [{ code: "kanban-glob-missing", message: "Kanban glob is empty.", key: "adapters.kanban.glob" }],
      glob: kanbanGlob.value,
      provenance: { glob: kanbanGlob.provenance },
    },
    qmd: {
      enabled: enabled.has("qmd"),
      valid: Boolean(qmdBinary.value),
      issues: qmdBinary.value ? [] : [{ code: "qmd-binary-missing", message: "QMD binary is empty.", key: "adapters.qmd.binary" }],
      collection: nonEmpty(qmdCollection.value),
      binary: qmdBinary.value,
      provenance: { collection: qmdCollection.provenance, binary: qmdBinary.provenance },
    },
    graphify: {
      enabled: enabled.has("graphify"),
      valid: graphifyIssues.length === 0,
      issues: graphifyIssues,
      binary: graphifyBinary.value,
      outputDir: nonEmpty(graphifyOutputDir.value),
      autoRescan: graphifyAutoRescan.value === true,
      timeoutMs: graphifyTimeout.value,
      provenance: {
        binary: graphifyBinary.provenance,
        outputDir: graphifyOutputDir.provenance,
        autoRescan: graphifyAutoRescan.provenance,
        timeoutMs: graphifyTimeout.provenance,
      },
    },
  };
}

/** Final device-local hop. Call immediately before constructing the adapter. */
export async function resolveKnowledgeAdapterSecret(
  credential: KnowledgeAdapterCredentialProfile | undefined,
  options: KnowledgeAdapterSecretResolverOptions = {},
): Promise<string | undefined> {
  if (!credential) return undefined;
  const reference = credential.secretRef;
  const secret = options.resolveSecret
    ? await options.resolveSecret(reference)
    : reference.provider === "environment"
      ? (options.environment ?? process.env)[reference.locator]
      : undefined;
  if (typeof secret !== "string" || !secret.length) {
    throw new Error("Knowledge adapter Secret Reference is not resolvable on this device");
  }
  return secret;
}

/** Materialize a credential-bearing MemU DSN only after resolving SecretRef. */
export function resolveMemUConnectionString(publicDsn: string, secret: string | undefined): string {
  if (!secret) return publicDsn;
  const publicUrl = postgresUrl(publicDsn);
  const secretUrl = postgresUrl(secret);
  if (
    publicUrl.hostname !== secretUrl.hostname
    || normalizedPort(publicUrl) !== normalizedPort(secretUrl)
    || publicUrl.pathname !== secretUrl.pathname
  ) {
    throw new Error("MemU Secret Reference resolves to a different database endpoint");
  }
  return secret;
}

/**
 * Parse only the documented legacy adapter subset from vault-mind.yaml.
 * This deliberately is not a general YAML parser: it recognizes adapter
 * `enabled` flags plus Graphify's scalar runtime fields at either
 * `adapters.graphify` or the older top-level `graphify` block.
 */
export function parseLegacyKnowledgeAdaptersYaml(raw: string): LegacyKnowledgeAdaptersYaml {
  const enabled = new Map<string, boolean>();
  const invalidEnablement = new Set<string>();
  const graphify: LegacyGraphifyRuntimeConfig = {};
  let section: "adapters" | "graphify" | undefined;
  let currentAdapter: string | undefined;
  let sawEnablement = false;
  let sawGraphifyConfig = false;

  for (const originalLine of raw.split(/\r?\n/)) {
    if (!originalLine.trim() || originalLine.trimStart().startsWith("#")) continue;
    const indentation = originalLine.match(/^ */)?.[0].length ?? 0;
    const content = stripYamlComment(originalLine.slice(indentation)).trim();
    if (!content) continue;

    if (indentation === 0) {
      currentAdapter = undefined;
      if (content === "adapters:") {
        section = "adapters";
      } else if (content === "graphify:") {
        section = "graphify";
      } else {
        section = undefined;
      }
      continue;
    }

    if (section === "adapters" && indentation === 2) {
      const adapter = yamlMappingKey(content);
      currentAdapter = adapter;
      continue;
    }

    const scalar = yamlScalarEntry(content);
    if (!scalar) continue;
    if (section === "adapters" && currentAdapter && indentation >= 4) {
      if (scalar.key === "enabled") {
        sawEnablement = true;
        const value = parseLegacyBoolean(scalar.value);
        if (typeof value === "boolean") {
          enabled.set(currentAdapter, value);
          invalidEnablement.delete(currentAdapter);
        } else {
          enabled.delete(currentAdapter);
          invalidEnablement.add(currentAdapter);
        }
      }
      if (currentAdapter === "graphify") {
        sawGraphifyConfig = applyLegacyGraphifyScalar(graphify, scalar) || sawGraphifyConfig;
      }
    } else if (section === "graphify" && indentation >= 2) {
      if (scalar.key === "enabled") {
        sawEnablement = true;
        const value = parseLegacyBoolean(scalar.value);
        if (typeof value === "boolean") {
          enabled.set("graphify", value);
          invalidEnablement.delete("graphify");
        } else {
          enabled.delete("graphify");
          invalidEnablement.add("graphify");
        }
      }
      sawGraphifyConfig = applyLegacyGraphifyScalar(graphify, scalar) || sawGraphifyConfig;
    }
  }

  const enabledAdapters = sawEnablement
    ? [
        ...[...enabled.entries()].filter(([, isEnabled]) => isEnabled).map(([name]) => name),
        ...[...invalidEnablement].map(name => `invalid-enable:${name}`),
      ]
    : undefined;
  return {
    ...(enabledAdapters ? { enabledAdapters } : {}),
    ...(sawGraphifyConfig ? { graphify } : {}),
  };
}

function applyLegacyGraphifyScalar(
  graphify: LegacyGraphifyRuntimeConfig,
  scalar: { key: string; value: string },
): boolean {
  switch (scalar.key) {
    case "binary":
      graphify.binary = scalar.value;
      return true;
    case "output_dir":
      graphify.outputDir = scalar.value;
      return true;
    case "auto_rescan":
      graphify.autoRescan = scalar.value;
      return true;
    case "timeout":
    case "timeout_ms":
      graphify.timeoutMs = scalar.value;
      return true;
    default:
      return false;
  }
}

function yamlMappingKey(content: string): string | undefined {
  const match = /^([A-Za-z0-9_-]+):\s*$/.exec(content);
  return match?.[1];
}

function yamlScalarEntry(content: string): { key: string; value: string } | undefined {
  const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(content);
  if (!match) return undefined;
  return { key: match[1]!, value: unquoteYamlScalar(match[2]!.trim()) };
}

function unquoteYamlScalar(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function stripYamlComment(value: string): string {
  let quote: `"` | `'` | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = undefined;
    } else if (character === `"` || character === `'`) {
      quote = character;
    } else if (character === "#") {
      return value.slice(0, index);
    }
  }
  return value;
}

function legacyAdapterList(
  environment: NodeJS.ProcessEnv,
  configValue: string[] | undefined,
): { value: string[]; provenance: KnowledgeAdapterFieldProvenance } | undefined {
  const raw = environment.VAULT_MIND_ADAPTERS?.trim();
  if (raw) {
    return {
      value: raw.split(",").map(item => item.trim()).filter(Boolean),
      provenance: { source: "legacy-env", detail: "VAULT_MIND_ADAPTERS" },
    };
  }
  if (configValue) {
    return {
      value: [...configValue],
      provenance: { source: "legacy-config", detail: "vault-mind.yaml:adapters" },
    };
  }
  return undefined;
}

function selectString(
  snapshot: SettingsSnapshot,
  key: string,
  legacyValue: string | undefined,
  legacyName: string,
  fallback: string,
): SelectedField<string> {
  const legacy = typeof legacyValue === "string" && legacyValue.trim()
    ? legacyValue.trim()
    : undefined;
  return selectField(
    snapshot,
    key,
    legacy,
    fallback,
    legacy ? { source: "legacy-env", detail: legacyName } : undefined,
  );
}

function selectMemUDsn(snapshot: SettingsSnapshot, environment: NodeJS.ProcessEnv): SelectedField<string> {
  const raw = environment.MEMU_DSN?.trim();
  const legacy = raw ? publicPostgresDsn(raw) : undefined;
  return selectField(
    snapshot,
    "adapters.memu.dsn",
    legacy,
    "postgresql://localhost:5432/memu",
    raw ? { source: "legacy-env", detail: "MEMU_DSN (credential redacted)" } : undefined,
  );
}

function selectNumber(
  snapshot: SettingsSnapshot,
  key: string,
  legacyValue: string | undefined,
  legacyName: string,
  fallback: number,
): SelectedField<number> {
  const raw = legacyValue?.trim();
  const legacy = raw ? Number(raw) : undefined;
  return selectField(
    snapshot,
    key,
    legacy,
    fallback,
    raw ? { source: "legacy-env", detail: legacyName } : undefined,
  );
}

function selectLegacyString(
  snapshot: SettingsSnapshot,
  key: string,
  environmentValue: string | undefined,
  environmentName: string,
  configValue: string | undefined,
  configName: string,
  fallback: string,
): SelectedField<string> {
  const legacy = selectLegacyValue(
    environmentValue === undefined ? undefined : environmentValue.trim(),
    environmentName,
    configValue === undefined ? undefined : configValue.trim(),
    configName,
  );
  return selectField(snapshot, key, legacy?.value, fallback, legacy?.provenance);
}

function selectLegacyNumber(
  snapshot: SettingsSnapshot,
  key: string,
  environmentValue: string | undefined,
  environmentName: string,
  configValue: string | number | undefined,
  configName: string,
  fallback: number,
): SelectedField<number> {
  const environmentNumber = environmentValue === undefined
    ? undefined
    : Number(environmentValue.trim());
  const configNumber = configValue === undefined
    ? undefined
    : typeof configValue === "number"
      ? configValue
      : Number(configValue.trim());
  const legacy = selectLegacyValue(environmentNumber, environmentName, configNumber, configName);
  return selectField(snapshot, key, legacy?.value, fallback, legacy?.provenance);
}

function selectLegacyBoolean(
  snapshot: SettingsSnapshot,
  key: string,
  environmentValue: string | undefined,
  environmentName: string,
  configValue: string | boolean | undefined,
  configName: string,
  fallback: boolean,
): SelectedField<unknown> {
  const legacy = selectLegacyValue(
    parseLegacyBoolean(environmentValue),
    environmentName,
    parseLegacyBoolean(configValue),
    configName,
  );
  return selectField<unknown>(snapshot, key, legacy?.value, fallback, legacy?.provenance);
}

function selectLegacyValue<T>(
  environmentValue: T | undefined,
  environmentName: string,
  configValue: T | undefined,
  configName: string,
): { value: T; provenance: KnowledgeAdapterFieldProvenance } | undefined {
  if (environmentValue !== undefined) {
    return {
      value: environmentValue,
      provenance: { source: "legacy-env", detail: environmentName },
    };
  }
  if (configValue !== undefined) {
    return {
      value: configValue,
      provenance: { source: "legacy-config", detail: configName },
    };
  }
  return undefined;
}

function parseLegacyBoolean(value: string | boolean | undefined): boolean | string | undefined {
  if (typeof value === "boolean" || value === undefined) return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return normalized;
}

function selectField<T>(
  snapshot: SettingsSnapshot,
  key: string,
  legacyValue: T | undefined,
  fallback: T,
  legacyProvenance?: KnowledgeAdapterFieldProvenance,
): SelectedField<T> {
  const effective = effectiveSetting(snapshot, key);
  if (effective.winningScope !== "product") {
    return {
      value: effective.value as T,
      explicit: true,
      provenance: {
        source: "settings-assignment",
        scope: effective.winningScope,
        actor: effective.assignmentProvenance.actor,
        detail: effective.assignmentProvenance.source,
      },
    };
  }
  if (legacyValue !== undefined && legacyProvenance) {
    return { value: legacyValue, explicit: false, provenance: legacyProvenance };
  }
  return {
    value: (effective.value ?? fallback) as T,
    explicit: false,
    provenance: {
      source: "product-default",
      scope: "product",
      actor: effective.assignmentProvenance.actor,
      detail: effective.assignmentProvenance.source,
    },
  };
}

function selectCredential(
  snapshot: SettingsSnapshot,
  key: string,
  environment: NodeJS.ProcessEnv,
  legacyLocator: string,
): {
  profile?: KnowledgeAdapterCredentialProfile;
  provenance: KnowledgeAdapterFieldProvenance;
  explicit: boolean;
} {
  const effective = effectiveSetting(snapshot, key);
  const redacted = redactedSecret(effective);
  if (effective.winningScope !== "product") {
    const provenance: KnowledgeAdapterFieldProvenance = {
      source: "settings-assignment",
      scope: effective.winningScope,
      actor: effective.assignmentProvenance.actor,
      detail: effective.assignmentProvenance.source,
    };
    return {
      ...(redacted ? { profile: { ...redacted, provenance } } : {}),
      provenance,
      explicit: true,
    };
  }
  if (environment[legacyLocator]?.trim()) {
    const provenance: KnowledgeAdapterFieldProvenance = { source: "legacy-env", detail: legacyLocator };
    return {
      profile: {
        secretRef: { provider: "environment", locator: legacyLocator },
        status: "present",
        provenance,
      },
      provenance,
      explicit: false,
    };
  }
  const provenance: KnowledgeAdapterFieldProvenance = {
    source: "product-default",
    scope: "product",
    actor: effective.assignmentProvenance.actor,
    detail: effective.assignmentProvenance.source,
  };
  return {
    ...(redacted?.status === "present" ? { profile: { ...redacted, provenance } } : {}),
    provenance,
    explicit: false,
  };
}

function effectiveSetting(snapshot: SettingsSnapshot, key: string): EffectiveSetting {
  const effective = snapshot.effective.find(item => item.key === key);
  if (!effective) throw new Error(`Knowledge adapter setting is missing from the registry: ${key}`);
  return effective;
}

function redactedSecret(effective: EffectiveSetting): { secretRef: SecretReference; status: SecretStatus } | undefined {
  const value = effective.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as { secretRef?: unknown; status?: unknown };
  if (!candidate.secretRef || typeof candidate.secretRef !== "object" || Array.isArray(candidate.secretRef)) return undefined;
  if (candidate.status !== "present" && candidate.status !== "missing" && candidate.status !== "unreachable") return undefined;
  const ref = candidate.secretRef as Partial<SecretReference>;
  if (typeof ref.provider !== "string" || typeof ref.locator !== "string") return undefined;
  return { secretRef: ref as SecretReference, status: candidate.status };
}

function validateEnabledAdapters(value: unknown): KnowledgeAdapterProfileIssue[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    return [{ code: "adapter-enablement-invalid", message: "Adapter enablement must be a list of adapter names.", key: "adapters.enabled" }];
  }
  const unknown = [...new Set(value.filter(item => !KNOWN_ADAPTERS.has(item)))];
  return unknown.length === 0
    ? []
    : [{ code: "adapter-enablement-unknown", message: `Unknown adapters: ${unknown.join(", ")}.`, key: "adapters.enabled" }];
}

function validateEndpoint(key: string, value: string): KnowledgeAdapterProfileIssue[] {
  if (!value) return [{ code: "adapter-endpoint-missing", message: `${key} is required while the adapter is enabled.`, key }];
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) throw new Error("unsafe");
    return [];
  } catch {
    return [{ code: "adapter-endpoint-invalid", message: `${key} must be an HTTP(S) URL without embedded credentials.`, key }];
  }
}

function validateMemUDsn(value: string): KnowledgeAdapterProfileIssue[] {
  try {
    const url = postgresUrl(value);
    if (url.username || url.password || url.search || url.hash) throw new Error("credential");
    return [];
  } catch {
    return [{ code: "memu-dsn-invalid", message: "adapters.memu.dsn must be a PostgreSQL URL without userinfo, query parameters, or fragments.", key: "adapters.memu.dsn" }];
  }
}

function validateRange(key: string, value: number, min: number, max: number): KnowledgeAdapterProfileIssue[] {
  return Number.isFinite(value) && value >= min && value <= max
    ? []
    : [{ code: "adapter-number-invalid", message: `${key} must be between ${min} and ${max}.`, key }];
}

function validateOptionalLocalPath(key: string, value: string): KnowledgeAdapterProfileIssue[] {
  return !value || (value.length <= 1_000 && !/[\0\r\n]/.test(value))
    ? []
    : [{ code: "adapter-path-invalid", message: `${key} must be an empty or valid device-local path.`, key }];
}

function validateRequiredLocalPath(key: string, value: string): KnowledgeAdapterProfileIssue[] {
  return value && value.length <= 1_000 && !/[\0\r\n]/.test(value)
    ? []
    : [{ code: "adapter-path-invalid", message: `${key} must be a valid device-local path or executable name.`, key }];
}

function validateStringList(key: string, value: unknown): KnowledgeAdapterProfileIssue[] {
  return Array.isArray(value) && value.every(item => typeof item === "string")
    ? []
    : [{ code: "adapter-list-invalid", message: `${key} must be a list of strings.`, key }];
}

function validateExplicitCredential(
  key: string,
  credential: { profile?: KnowledgeAdapterCredentialProfile; explicit: boolean },
): KnowledgeAdapterProfileIssue[] {
  if (!credential.explicit || credential.profile?.status === "present") return [];
  return [{ code: "adapter-secret-unavailable", message: `${key} is explicit but is not resolvable on this device.`, key }];
}

function nonEmpty(value: string): string | undefined {
  return value ? value : undefined;
}

function normalizePath(value: string): string {
  if (!value) return value;
  return value.startsWith("/") ? value : `/${value}`;
}

function publicPostgresDsn(value: string): string {
  try {
    const url = postgresUrl(value);
    if (url.search || url.hash) return "";
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    // Invalid legacy input may itself be a credential or opaque token. Keep
    // the profile redacted and let validateMemUDsn fail closed on the empty
    // public endpoint instead of reflecting the raw value into diagnostics.
    return "";
  }
}

function postgresUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("unsupported protocol");
  return url;
}

function normalizedPort(url: URL): string {
  return url.port || "5432";
}
