/**
 * QmdAdapter -- optional search adapter backed by tobi/qmd.
 *
 * tobi/qmd is an on-device BM25 + vector hybrid search tool recommended
 * by Karpathy in his LLM Wiki gist. This adapter spawns `qmd query`
 * as a subprocess, parses `--json` output, and maps results into the
 * VaultMindAdapter SearchResult shape.
 *
 * Prerequisites (contributor-responsibility, not a hard dep):
 *   1. Install qmd:   npm install -g @tobilu/qmd
 *   2. Add a collection that covers your vault:
 *      qmd collection add /path/to/vault --name vault --mask "**\/*.md"
 *   3. Index + embed:  qmd update && qmd embed
 *
 * If the qmd CLI is not on PATH, init() sets isAvailable=false and
 * search() returns [] -- the rest of the system degrades gracefully.
 */

import { spawn } from "node:child_process";
import type {
  VaultMindAdapter,
  AdapterCapability,
  SearchResult,
  SearchOpts,
} from "./interface.js";
import { normalizeSearchResult } from "../retrieval/evidence.js";

export interface QmdHit {
  docid: string;
  score: number;
  file: string;
  line?: number;
  title?: string;
  context?: string;
  snippet?: string;
  body?: string;
  explanation?: unknown;
}

export interface QmdSdkStore {
  search(options: {
    query: string;
    intent?: string;
    collections?: readonly string[];
    limit?: number;
    minScore?: number;
    explain?: boolean;
  }): Promise<readonly QmdHit[]>;
  getIndexHealth?(): Promise<unknown>;
  getStatus?(): Promise<unknown>;
  close(): Promise<void>;
}

export interface QmdIndexHealth {
  available: boolean;
  mode: "cli" | "sdk";
  profileRevision: string;
  observedVersion?: string;
  index?: string;
  modelFingerprint?: string;
  documentCount?: number;
  embeddedDocumentCount?: number;
  embeddingCoverage?: number;
  lastUpdatedAt?: string;
  collections: string[];
  diagnostics: string[];
}

export interface QmdAdapterOpts {
  /** Legacy single-collection alias. */
  collection?: string;
  /** Restrict queries to one or more qmd collections (default: all). */
  collections?: readonly string[];
  /** Override the qmd binary path (default: "qmd" on PATH). */
  binary?: string;
  /** Arguments to prepend before subcommand args -- useful for wrappers
   *  like `bun x @tobilu/qmd` or for tests that drive node as the binary. */
  binaryArgs?: string[];
  /** Min score threshold 0-1 (default: no filter). */
  minScore?: number;
  /** Named qmd index. Passed as a global option before the subcommand. */
  index?: string;
  /** Fingerprint of the selected qmd index/model binding. */
  modelFingerprint?: string;
  /** CLI remains the portable default; SDK mode requires an injected store. */
  mode?: "cli" | "sdk";
  /** Host-created qmd store. The adapter never imports or initializes qmd itself. */
  sdk?: QmdSdkStore;
  /** Observed package contract used to gate SDK mode. */
  sdkPackageVersion?: string;
  /** Injectable runtime version for deterministic probes/tests. */
  nodeVersion?: string;
}

export class QmdAdapter implements VaultMindAdapter {
  readonly name = "qmd";
  readonly capabilities: readonly AdapterCapability[] = ["search"];

  private _available = false;
  private readonly collections: readonly string[];
  private readonly binary: string;
  private readonly binaryArgs: readonly string[];
  private readonly minScore?: number;
  private readonly index?: string;
  private readonly modelFingerprint?: string;
  private readonly mode: "cli" | "sdk";
  private readonly sdk?: QmdSdkStore;
  private readonly sdkPackageVersion?: string;
  private readonly nodeVersion: string;
  private diagnostics: string[] = [];
  private observedVersion?: string;
  private profileRevision = "qmd/unknown";

  constructor(opts?: QmdAdapterOpts) {
    this.collections = uniqueStrings([
      ...(opts?.collections ?? []),
      ...(opts?.collection ? [opts.collection] : []),
    ]);
    this.binary = opts?.binary ?? "qmd";
    this.binaryArgs = opts?.binaryArgs ?? [];
    this.minScore = opts?.minScore;
    this.index = opts?.index;
    this.modelFingerprint = opts?.modelFingerprint;
    this.mode = opts?.mode ?? "cli";
    this.sdk = opts?.sdk;
    this.sdkPackageVersion = opts?.sdkPackageVersion;
    this.nodeVersion = opts?.nodeVersion ?? process.versions.node;
  }

  get isAvailable(): boolean {
    return this._available;
  }

  async init(): Promise<void> {
    if (this.mode === "sdk") {
      this.observedVersion = this.sdkPackageVersion;
      this.profileRevision = this.sdkPackageVersion && qmd2Compatible(this.sdkPackageVersion)
        ? "qmd/2-sdk"
        : "qmd/unknown";
      this.diagnostics = sdkProbeDiagnostics({
        nodeVersion: this.nodeVersion,
        packageVersion: this.sdkPackageVersion,
        sdk: this.sdk,
      });
      this._available = this.diagnostics.length === 0;
      return;
    }
    try {
      const { stdout, stderr, code } = await this.runQmd(["--version"]);
      const version = parseQmdVersion(`${stdout}\n${stderr}`);
      this.observedVersion = version;
      this.profileRevision = version && qmd25Compatible(version) ? "qmd/2.5" : "qmd/unknown";
      this._available = code === 0 && this.profileRevision === "qmd/2.5";
    } catch {
      this._available = false;
    }
    if (!this._available) {
      process.stderr.write(
        "llmwiki: [qmd] CLI not available on PATH -- adapter disabled\n",
      );
    }
  }

  async search(query: string, opts?: SearchOpts): Promise<SearchResult[]> {
    if (!this._available) return [];
    const limit = opts?.maxResults ?? 20;
    if (this.mode === "sdk") {
      try {
        const hits = await this.sdk!.search({
          query,
          ...(opts?.intent ? { intent: opts.intent } : {}),
          ...(this.collections.length > 0 ? { collections: this.collections } : {}),
          limit,
          ...(this.minScore != null ? { minScore: this.minScore } : {}),
          ...(opts?.explain ? { explain: true } : {}),
        });
        return Array.isArray(hits) ? hits.map((hit) => this.normalizeHit(hit)) : [];
      } catch {
        return [];
      }
    }
    const args = buildQmdQueryArgs(query, {
      limit,
      collections: this.collections,
      minScore: this.minScore,
      intent: opts?.intent,
      explain: opts?.explain,
      index: this.index,
    });

    const { stdout, code } = await this.runQmd(args);
    if (code !== 0) return [];

    let hits: QmdHit[];
    try {
      hits = JSON.parse(stdout) as QmdHit[];
    } catch {
      return [];
    }
    if (!Array.isArray(hits)) return [];

    return hits.map((hit) => this.normalizeHit(hit));
  }

  async indexHealth(): Promise<QmdIndexHealth> {
    const base: QmdIndexHealth = {
      available: this._available,
      mode: this.mode,
      profileRevision: this.profileRevision,
      ...(this.observedVersion ? { observedVersion: this.observedVersion } : {}),
      ...(this.index ? { index: this.index } : {}),
      ...(this.modelFingerprint ? { modelFingerprint: this.modelFingerprint } : {}),
      collections: [...this.collections],
      diagnostics: [...this.diagnostics],
    };
    if (!this._available) return base;
    try {
      const raw = this.mode === "sdk"
        ? this.sdk!.getIndexHealth
          ? await this.sdk!.getIndexHealth()
          : await this.sdk!.getStatus!()
        : JSON.parse((await this.runQmd([
            ...(this.index ? ["--index", this.index] : []),
            "status",
            "--json",
          ])).stdout) as unknown;
      return { ...base, ...normalizeIndexHealth(raw, base.collections) };
    } catch {
      return { ...base, available: false, diagnostics: [...base.diagnostics, "QMD_INDEX_HEALTH_INVALID"] };
    }
  }

  private normalizeHit(h: QmdHit): SearchResult {
    return normalizeSearchResult({
      source: "qmd",
      path: normalizeQmdPath(h.file),
      content: h.snippet ?? h.body ?? h.title ?? "",
      score: typeof h.score === "number" ? h.score : 0,
      metadata: {
        docid: h.docid,
        line: h.line,
        title: h.title,
        context: h.context,
        uri: h.file,
        profileRevision: this.profileRevision,
        observedVersion: this.observedVersion,
        modelFingerprint: this.modelFingerprint,
        explanation: h.explanation,
        invocationMode: this.mode,
      },
    }, this.name);
  }

  async dispose(): Promise<void> {
    if (this.mode === "sdk" && this.sdk) await this.sdk.close();
  }

  private runQmd(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(this.binary, [...this.binaryArgs, ...args], { stdio: ["ignore", "pipe", "pipe"] });
      } catch {
        resolve({ stdout: "", stderr: "spawn failed synchronously", code: -1 });
        return;
      }
      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d: Buffer) => {
        stdout += d.toString("utf-8");
      });
      proc.stderr.on("data", (d: Buffer) => {
        stderr += d.toString("utf-8");
      });
      proc.on("error", () => {
        resolve({ stdout, stderr: stderr || "spawn error", code: -1 });
      });
      proc.on("close", (code) => {
        resolve({ stdout, stderr, code: code ?? -1 });
      });
    });
  }
}

export interface QmdQueryArgsOptions {
  limit: number;
  collections?: readonly string[];
  minScore?: number;
  intent?: string;
  explain?: boolean;
  index?: string;
}

export function buildQmdQueryArgs(
  query: string,
  options: QmdQueryArgsOptions,
): string[] {
  const document = options.intent?.trim()
    ? [
        `intent: ${singleLine(options.intent)}`,
        `lex: ${singleLine(query)}`,
        `vec: ${singleLine(query)}`,
      ].join("\n")
    : query;
  const args = [
    ...(options.index ? ["--index", options.index] : []),
    "query",
    document,
    "--json",
    "-n",
    String(options.limit),
  ];
  for (const collection of uniqueStrings(options.collections ?? [])) {
    args.push("-c", collection);
  }
  if (options.minScore != null) args.push("--min-score", String(options.minScore));
  if (options.explain) args.push("--explain");
  return args;
}

function normalizeQmdPath(value: string): string {
  if (!value.startsWith("qmd://")) return value.replace(/\\/g, "/");
  const withoutScheme = value.slice("qmd://".length);
  const separator = withoutScheme.indexOf("/");
  return (separator >= 0 ? withoutScheme.slice(separator + 1) : withoutScheme)
    .replace(/\\/g, "/");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseQmdVersion(value: string): string | undefined {
  return value.match(/(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/)?.[1];
}

function qmd25Compatible(version: string): boolean {
  const [major, minor] = version.split(".").map(Number);
  return major === 2 && minor >= 5;
}

function qmd2Compatible(version: string): boolean {
  const [major] = version.split(".").map(Number);
  return major === 2;
}

function sdkProbeDiagnostics(input: {
  nodeVersion: string;
  packageVersion?: string;
  sdk?: QmdSdkStore;
}): string[] {
  const diagnostics: string[] = [];
  const nodeMajor = Number(input.nodeVersion.split(".")[0]);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 22) diagnostics.push("QMD_SDK_NODE_INCOMPATIBLE");
  if (!input.packageVersion || !qmd2Compatible(input.packageVersion)) diagnostics.push("QMD_SDK_PACKAGE_INCOMPATIBLE");
  if (!input.sdk || typeof input.sdk.search !== "function" || typeof input.sdk.close !== "function") {
    diagnostics.push("QMD_SDK_CONTRACT_INCOMPATIBLE");
  }
  if (input.sdk && typeof input.sdk.getIndexHealth !== "function" && typeof input.sdk.getStatus !== "function") {
    diagnostics.push("QMD_SDK_INDEX_HEALTH_MISSING");
  }
  return diagnostics;
}

function normalizeIndexHealth(raw: unknown, configuredCollections: readonly string[]): Partial<QmdIndexHealth> {
  if (!raw || typeof raw !== "object") throw new Error("invalid qmd health payload");
  const value = raw as Record<string, unknown>;
  const documentCount = finiteNumber(value.documentCount ?? value.documents ?? value.totalDocuments);
  const embeddedDocumentCount = finiteNumber(value.embeddedDocumentCount ?? value.embedded ?? value.documentsEmbedded);
  const explicitCoverage = finiteNumber(value.embeddingCoverage ?? value.coverage);
  const collections = Array.isArray(value.collections)
    ? value.collections.flatMap((entry) => {
        if (typeof entry === "string") return [entry];
        if (entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).name === "string") {
          return [(entry as Record<string, unknown>).name as string];
        }
        return [];
      })
    : [...configuredCollections];
  const coverage = explicitCoverage ?? (
    documentCount != null && embeddedDocumentCount != null && documentCount > 0
      ? embeddedDocumentCount / documentCount
      : undefined
  );
  const lastUpdated = value.lastUpdatedAt ?? value.lastUpdate ?? value.updatedAt;
  return {
    ...(documentCount != null ? { documentCount } : {}),
    ...(embeddedDocumentCount != null ? { embeddedDocumentCount } : {}),
    ...(coverage != null ? { embeddingCoverage: Math.max(0, Math.min(1, coverage)) } : {}),
    ...(typeof lastUpdated === "string" ? { lastUpdatedAt: lastUpdated } : {}),
    collections: uniqueStrings(collections),
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
