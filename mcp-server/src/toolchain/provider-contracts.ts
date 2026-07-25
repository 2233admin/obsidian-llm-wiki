import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// OpenCLI discovery / invocation (task 3.3)
// ---------------------------------------------------------------------------

export const OPENCLI_PROFILE_REVISION = "opencli/1.8" as const;
export const OPENCLI_BOUNDARY = "capture-provider" as const;
export const OPENCLI_VERSION_POLICY = ">=1.8 <2" as const;

export type OpenCliDiscoverySurface =
  | "version"
  | "list"
  | "help"
  | "validate"
  | "verify"
  | "doctor"
  | "profiles"
  | "plugins"
  | "adapters";

/** Semantic capabilities advertised after structured discovery. */
export const OPENCLI_CAPABILITY_NAMES = [
  "adapters.status",
  "browser.bridge",
  "capture.web",
  "command.list.structured",
  "definition.validate",
  "definition.verify",
  "doctor",
  "help.structured",
  "plugins.list",
  "profiles.list",
  "version.structured",
] as const;

export type OpenCliCapabilityName = (typeof OPENCLI_CAPABILITY_NAMES)[number];

export type OpenCliDiagnosticCode =
  | "TOOLCHAIN_PROBE_TIMEOUT"
  | "TOOLCHAIN_OUTPUT_INVALID"
  | "CAPABILITY_MISSING"
  | "PROVIDER_UNAVAILABLE"
  | "SENSITIVE_ERROR_REDACTED"
  | "OPENCLI_BOUNDARY_VIOLATION";

/** Capture-only invocation surfaces. Never Source, vault write, or promotion. */
export type OpenCliCaptureSurface =
  | "capture.page"
  | "capture.article"
  | "capture.browser";

const SENSITIVE_TOKEN_RE =
  /(?:=|:)?(?:sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._~+/=-]+|api[_-]?key[=:]\S+)/i;
const URL_USERINFO_RE = /\/\/([^/@\s]+)@/g;
const FLAG_SECRET_RE = /(--(?:api-?key|token|authorization|password|secret))(?:=|\s+)(\S+)/gi;

export function openCliDiscoveryCommand(
  surface: OpenCliDiscoverySurface,
  target?: string,
): string[] {
  switch (surface) {
    case "version":
      return ["--version"];
    case "list":
      return ["list", "--format", "json"];
    case "help":
      return target ? [target, "--help", "--format", "yaml"] : ["--help", "--format", "yaml"];
    case "validate":
      return ["validate", ...(target ? [target] : []), "--format", "json"];
    case "verify":
      return ["verify", ...(target ? [target] : []), "--format", "json"];
    case "doctor":
      return ["doctor", "--format", "json"];
    case "profiles":
      return ["profile", "list", "--format", "json"];
    case "plugins":
      return ["plugin", "list", "--format", "json"];
    case "adapters":
      return ["adapter", "status", "--format", "json"];
  }
}

/**
 * Capture Provider invocations only. Rejects vault/source/promotion verbs.
 */
export function openCliCaptureCommand(
  surface: OpenCliCaptureSurface,
  target: string,
  options: { format?: "json" | "markdown"; timeoutMs?: number } = {},
): string[] {
  assertOpenCliCaptureBoundary(surface);
  const format = options.format ?? "json";
  switch (surface) {
    case "capture.page":
      return ["capture", "page", target, "--format", format];
    case "capture.article":
      return ["capture", "article", target, "--format", format];
    case "capture.browser":
      return ["capture", "browser", target, "--format", format];
  }
}

const FORBIDDEN_OPENCLI_VERBS = new Set([
  "source.register",
  "source.ingest",
  "vault.write",
  "vault.delete",
  "promote",
  "memory.promote",
  "decision.create",
]);

export function assertOpenCliCaptureBoundary(operation: string): void {
  const normalized = operation.trim().toLowerCase();
  if (FORBIDDEN_OPENCLI_VERBS.has(normalized) || normalized.startsWith("vault.") || normalized.startsWith("promote")) {
    throw new Error(`OPENCLI_BOUNDARY_VIOLATION: ${operation} is outside the capture Provider boundary`);
  }
  if (
    normalized !== "capture.page"
    && normalized !== "capture.article"
    && normalized !== "capture.browser"
    && !normalized.startsWith("capture.")
    && ![
      "version", "list", "help", "validate", "verify", "doctor",
      "profiles", "plugins", "adapters",
      "profile.list", "plugin.list", "adapter.status",
    ].includes(normalized)
    && !normalized.startsWith("discovery.")
  ) {
    // Allow discovery surfaces and capture.*; block everything else that looks authoritative.
    if (
      normalized.includes("register")
      || normalized.includes("promote")
      || normalized.includes("write")
      || normalized.includes("delete")
    ) {
      throw new Error(`OPENCLI_BOUNDARY_VIOLATION: ${operation} is outside the capture Provider boundary`);
    }
  }
}

export interface OpenCliInvocationObservation {
  surface: OpenCliDiscoverySurface | OpenCliCaptureSurface;
  command: readonly string[];
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  durationMs?: number;
}

export interface OpenCliNormalizedDiscovery {
  schemaVersion: 1;
  profileRevision: typeof OPENCLI_PROFILE_REVISION;
  boundary: typeof OPENCLI_BOUNDARY;
  surface: OpenCliDiscoverySurface | OpenCliCaptureSurface;
  ok: boolean;
  partial: boolean;
  timedOut: boolean;
  observedVersion?: string;
  capabilities: OpenCliCapabilityName[];
  missingCapabilities: OpenCliCapabilityName[];
  diagnosticCodes: OpenCliDiagnosticCode[];
  /** Structured payload with secrets stripped. */
  data: Record<string, unknown> | null;
  evidence: {
    command: string[];
    exitCode?: number;
    outputDigest?: string;
    timedOut?: boolean;
    durationMs?: number;
  };
}

const SURFACE_REQUIRED_CAPABILITIES: Record<OpenCliDiscoverySurface, OpenCliCapabilityName[]> = {
  version: ["version.structured"],
  list: ["command.list.structured"],
  help: ["help.structured"],
  validate: ["definition.validate"],
  verify: ["definition.verify"],
  doctor: ["doctor"],
  profiles: ["profiles.list"],
  plugins: ["plugins.list"],
  adapters: ["adapters.status"],
};

export function normalizeOpenCliDiscovery(
  observation: OpenCliInvocationObservation,
): OpenCliNormalizedDiscovery {
  const command = redactOpenCliCommand([...observation.command]);
  const timedOut = observation.timedOut === true;
  const rawOutput = `${observation.stdout ?? ""}\n${observation.stderr ?? ""}`;
  const redactedOutput = redactOpenCliText(rawOutput);
  const diagnosticCodes: OpenCliDiagnosticCode[] = [];

  if (timedOut) {
    diagnosticCodes.push("TOOLCHAIN_PROBE_TIMEOUT");
    return {
      schemaVersion: 1,
      profileRevision: OPENCLI_PROFILE_REVISION,
      boundary: OPENCLI_BOUNDARY,
      surface: observation.surface,
      ok: false,
      partial: false,
      timedOut: true,
      capabilities: [],
      missingCapabilities: requiredCapsFor(observation.surface),
      diagnosticCodes: uniqueCodes(diagnosticCodes),
      data: null,
      evidence: {
        command,
        ...(observation.exitCode === undefined ? {} : { exitCode: observation.exitCode }),
        timedOut: true,
        ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs }),
      },
    };
  }

  if (containsSensitiveMaterial(rawOutput) && redactedOutput !== rawOutput) {
    diagnosticCodes.push("SENSITIVE_ERROR_REDACTED");
  }

  const parsed = parseOpenCliStructuredOutput(observation.surface, redactedOutput);
  if (!parsed.ok) {
    diagnosticCodes.push("TOOLCHAIN_OUTPUT_INVALID");
  }

  const capabilities = parsed.capabilities;
  const required = requiredCapsFor(observation.surface);
  const missingCapabilities = required.filter((cap) => !capabilities.includes(cap));
  if (missingCapabilities.length > 0) {
    diagnosticCodes.push("CAPABILITY_MISSING");
  }

  const exitFailed = observation.exitCode !== undefined && observation.exitCode !== 0;
  if (exitFailed && !parsed.ok) {
    diagnosticCodes.push("PROVIDER_UNAVAILABLE");
  }

  const partial = parsed.ok && missingCapabilities.length > 0;
  const ok = parsed.ok && !exitFailed && missingCapabilities.length === 0;

  return {
    schemaVersion: 1,
    profileRevision: OPENCLI_PROFILE_REVISION,
    boundary: OPENCLI_BOUNDARY,
    surface: observation.surface,
    ok,
    partial,
    timedOut: false,
    ...(parsed.observedVersion ? { observedVersion: parsed.observedVersion } : {}),
    capabilities,
    missingCapabilities,
    diagnosticCodes: uniqueCodes(diagnosticCodes),
    data: parsed.data,
    evidence: {
      command,
      ...(observation.exitCode === undefined ? {} : { exitCode: observation.exitCode }),
      ...(redactedOutput.trim() ? { outputDigest: digestText(redactedOutput) } : {}),
      ...(observation.durationMs === undefined ? {} : { durationMs: observation.durationMs }),
    },
  };
}

function requiredCapsFor(
  surface: OpenCliDiscoverySurface | OpenCliCaptureSurface,
): OpenCliCapabilityName[] {
  if (surface.startsWith("capture.")) return ["capture.web"];
  return SURFACE_REQUIRED_CAPABILITIES[surface as OpenCliDiscoverySurface] ?? [];
}

function parseOpenCliStructuredOutput(
  surface: OpenCliDiscoverySurface | OpenCliCaptureSurface,
  text: string,
): {
  ok: boolean;
  observedVersion?: string;
  capabilities: OpenCliCapabilityName[];
  data: Record<string, unknown> | null;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, capabilities: [], data: null };
  }

  if (surface === "version") {
    const version = extractVersion(trimmed);
    if (!version) return { ok: false, capabilities: [], data: null };
    // Prefer structured JSON version when present.
    const json = tryParseJson(trimmed);
    if (json && typeof json === "object" && !Array.isArray(json)) {
      const record = json as Record<string, unknown>;
      const structuredVersion = typeof record.version === "string" ? record.version : version;
      return {
        ok: true,
        observedVersion: structuredVersion,
        capabilities: ["version.structured"],
        data: { version: structuredVersion, format: "json" },
      };
    }
    return {
      ok: true,
      observedVersion: version,
      capabilities: ["version.structured"],
      data: { version, format: "text" },
    };
  }

  if (surface === "help") {
    // YAML-ish or JSON help is accepted; plain text help is partial-capable.
    const json = tryParseJson(trimmed);
    if (json && typeof json === "object") {
      return {
        ok: true,
        capabilities: ["help.structured"],
        data: { format: "json", help: json },
      };
    }
    if (trimmed.includes(":") || trimmed.includes("Usage")) {
      return {
        ok: true,
        capabilities: ["help.structured"],
        data: { format: "yaml-or-text", preview: trimmed.slice(0, 500) },
      };
    }
    return { ok: false, capabilities: [], data: null };
  }

  if (surface.startsWith("capture.")) {
    const json = tryParseJson(trimmed);
    if (json && typeof json === "object" && !Array.isArray(json)) {
      return {
        ok: true,
        capabilities: ["capture.web"],
        data: redactOpenCliData(json as Record<string, unknown>),
      };
    }
    return { ok: false, capabilities: [], data: null };
  }

  const json = tryParseJson(trimmed);
  if (!json || typeof json !== "object") {
    return { ok: false, capabilities: [], data: null };
  }

  const record = Array.isArray(json)
    ? { items: json }
    : redactOpenCliData(json as Record<string, unknown>);

  const capability = surfaceCapability(surface as OpenCliDiscoverySurface);
  return {
    ok: true,
    capabilities: capability ? [capability] : [],
    data: record,
  };
}

function surfaceCapability(surface: OpenCliDiscoverySurface): OpenCliCapabilityName | null {
  switch (surface) {
    case "list":
      return "command.list.structured";
    case "validate":
      return "definition.validate";
    case "verify":
      return "definition.verify";
    case "doctor":
      return "doctor";
    case "profiles":
      return "profiles.list";
    case "plugins":
      return "plugins.list";
    case "adapters":
      return "adapters.status";
    case "help":
      return "help.structured";
    case "version":
      return "version.structured";
  }
}

export function openCliCompatibilitySurface(): Record<string, unknown> {
  return {
    profileRevision: OPENCLI_PROFILE_REVISION,
    versionPolicy: OPENCLI_VERSION_POLICY,
    boundary: OPENCLI_BOUNDARY,
    authority: {
      source: false,
      vault: false,
      promotion: false,
      capture: true,
    },
    discovery: {
      version: openCliDiscoveryCommand("version"),
      list: openCliDiscoveryCommand("list"),
      help: openCliDiscoveryCommand("help"),
      validate: openCliDiscoveryCommand("validate"),
      verify: openCliDiscoveryCommand("verify"),
      doctor: openCliDiscoveryCommand("doctor"),
      profiles: openCliDiscoveryCommand("profiles"),
      plugins: openCliDiscoveryCommand("plugins"),
      adapters: openCliDiscoveryCommand("adapters"),
    },
    capture: {
      page: openCliCaptureCommand("capture.page", "<url>"),
      article: openCliCaptureCommand("capture.article", "<url>"),
      browser: openCliCaptureCommand("capture.browser", "<url>"),
    },
  };
}

const SECRET_FLAG_NAMES = new Set([
  "--api-key",
  "--apikey",
  "--token",
  "--authorization",
  "--password",
  "--secret",
  "--cookie",
]);

export function redactOpenCliCommand(command: readonly string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < command.length; index += 1) {
    const part = command[index] ?? "";
    const lower = part.toLowerCase();
    if (SECRET_FLAG_NAMES.has(lower)) {
      out.push(part);
      if (index + 1 < command.length) {
        out.push("[redacted]");
        index += 1;
      }
      continue;
    }
    if (/^https?:\/\//i.test(part)) {
      try {
        const url = new URL(part);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        out.push(url.toString().replace(/\/$/, ""));
      } catch {
        out.push(part.replace(URL_USERINFO_RE, "//[redacted]@"));
      }
      continue;
    }
    if (SENSITIVE_TOKEN_RE.test(part) || /^(?:bearer|sk-)/i.test(part)) {
      out.push("[redacted]");
      continue;
    }
    out.push(part.replace(FLAG_SECRET_RE, "$1 [redacted]"));
  }
  return out;
}

export function redactOpenCliText(text: string): string {
  return text
    .replace(URL_USERINFO_RE, "//[redacted]@")
    .replace(FLAG_SECRET_RE, "$1 [redacted]")
    .replace(SENSITIVE_TOKEN_RE, "[redacted]")
    .replace(/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

function redactOpenCliData(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/secret|token|password|authorization|api[_-]?key|cookie/i.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (typeof entry === "string") {
      out[key] = redactOpenCliText(entry);
    } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      out[key] = redactOpenCliData(entry as Record<string, unknown>);
    } else if (Array.isArray(entry)) {
      out[key] = entry.map((item) =>
        typeof item === "string"
          ? redactOpenCliText(item)
          : item && typeof item === "object"
            ? redactOpenCliData(item as Record<string, unknown>)
            : item
      );
    } else {
      out[key] = entry;
    }
  }
  return out;
}

function containsSensitiveMaterial(text: string): boolean {
  return SENSITIVE_TOKEN_RE.test(text)
    || URL_USERINFO_RE.test(text)
    || FLAG_SECRET_RE.test(text)
    || /api[_-]?key\s*[:=]/i.test(text);
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Attempt to extract first JSON object/array from mixed CLI output.
    const startObj = text.indexOf("{");
    const startArr = text.indexOf("[");
    const start = startObj === -1
      ? startArr
      : startArr === -1
        ? startObj
        : Math.min(startObj, startArr);
    if (start < 0) return null;
    try {
      return JSON.parse(text.slice(start));
    } catch {
      return null;
    }
  }
}

function extractVersion(text: string): string | undefined {
  const match = text.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.]+)?)/);
  return match?.[1];
}

function digestText(text: string): string {
  return "sha256:" + createHash("sha256").update(text).digest("hex");
}

function uniqueCodes(codes: OpenCliDiagnosticCode[]): OpenCliDiagnosticCode[] {
  return [...new Set(codes)].sort();
}

// ---------------------------------------------------------------------------
// Graphify / qmd helpers (existing, preserved for 3.4 / shared tests)
// ---------------------------------------------------------------------------

export type GraphifyCompatibilityRevision = "graphify/legacy" | "graphify/0.9";

export function qmdModelFingerprint(index: string | undefined, model: string): string {
  const canonical = JSON.stringify({
    schemaVersion: 1,
    index: index?.trim() || "default",
    model: model.trim(),
    adapterSchemaVersion: "qmd/2.5",
  });
  return "sha256:" + createHash("sha256").update(canonical).digest("hex");
}

export function graphifyCompatibilityRevision(versionOutput: string): GraphifyCompatibilityRevision {
  const match = versionOutput.match(/(\d+)\.(\d+)/);
  if (!match) return "graphify/legacy";
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 0 || minor >= 9 ? "graphify/0.9" : "graphify/legacy";
}

export function graphifyQueryCommand(
  revision: GraphifyCompatibilityRevision,
  query: string,
  graphPath: string,
  budget: number,
): string[] {
  // 0.9.x deliberately retains the legacy query shape; the profile revision
  // remains explicit so a later CLI change can be added without domain drift.
  if (revision === "graphify/legacy" || revision === "graphify/0.9") {
    return ["query", query, "--graph", graphPath, "--budget", String(budget)];
  }
  return assertNever(revision);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported provider profile: ${String(value)}`);
}
