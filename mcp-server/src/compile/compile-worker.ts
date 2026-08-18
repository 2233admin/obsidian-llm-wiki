import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

import type {
  CompileCancelAttempt,
  CompileExecutionContext,
  CompileExecutionPort,
  CompilePromotionResult,
  CompileVerificationResult,
} from "./compile-run-port.js";
import type {
  CompileArtifactReceipt,
  CompilePromotionReceipt,
  CompileResult,
} from "./types.js";
import { verifyStagedCompileArtifacts } from "./compile-verification.js";
import type { VaultStore } from "../vault/store.js";

export interface PythonCompileWorkerConfig {
  vaultPath: string;
  compilerPath: string;
  python: string;
  tier: string;
  vaultStore?: VaultStore;
  environmentResolver?: () => Promise<NodeJS.ProcessEnv>;
}

/** Owns the Python process and the staging-to-authority promotion boundary. */
export class PythonCompileWorker implements CompileExecutionPort {
  private environmentResolver?: () => Promise<NodeJS.ProcessEnv>;
  private activeProcess?: ChildProcess;

  constructor(private readonly config: PythonCompileWorkerConfig) {
    this.environmentResolver = config.environmentResolver;
  }

  setEnvironmentResolver(resolver: () => Promise<NodeJS.ProcessEnv>): void {
    this.environmentResolver = resolver;
  }

  async run(topic: string | undefined, context?: CompileExecutionContext): Promise<CompileResult> {
    const targetTopic = topic ?? "";
    const compilePy = resolve(this.config.compilerPath, "compile.py");
    const timestamp = new Date().toISOString();

    try {
      assertSafeTopic(targetTopic);
      const topicPath = resolve(this.config.vaultPath, targetTopic);
      const staging = context ? prepareStaging(this.config.vaultPath, targetTopic, context.stagingPath) : undefined;
      if (context && staging) context.baseSnapshot = staging.baseSnapshot;
      const executionTopicPath = staging?.topicPath ?? topicPath;
      const resultFile = staging ? join(staging.stagingPath, "compile-result.json") : undefined;
      const args = [
        compilePy,
        executionTopicPath,
        "--tier",
        this.config.tier,
        ...(resultFile ? ["--result-file", resultFile] : []),
      ];
      const { stdout, stderr } = await this.runCompiler(args, {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        env: this.environmentResolver ? await this.environmentResolver() : { ...process.env },
      });

      const result = this.parseCompileOutput(targetTopic, stdout, timestamp, resultFile);
      const artifacts = staging ? collectArtifacts(staging.topicPath, targetTopic, context?.runId ?? "compile-run/legacy") : [];
      if (stderr) process.stderr.write(`llmwiki: [compile] stderr: ${stderr.slice(0, 500)}\n`);
      return { ...result, artifacts };
    } catch (error) {
      return {
        ok: false,
        topic: targetTopic,
        sourcesCompiled: 0,
        conceptsCreated: 0,
        contradictions: 0,
        error: error instanceof Error ? error.message : String(error),
        timestamp,
      };
    }
  }

  abort(): CompileCancelAttempt {
    if (!this.activeProcess) {
      return { ok: true, message: "Compilation abort requested before process start; termination is not confirmed", confirmed: false };
    }
    const requested = this.activeProcess.kill();
    return {
      ok: requested,
      message: requested
        ? "Compilation process termination requested; exit is not yet confirmed"
        : "Compilation process termination could not be requested",
      confirmed: false,
    };
  }

  async verify(
    topic: string | undefined,
    context: CompileExecutionContext,
    result: CompileResult,
  ): Promise<CompileVerificationResult> {
    const targetTopic = topic ?? result.topic;
    assertSafeTopic(targetTopic);
    const stagedTopicPath = resolve(context.stagingPath, targetTopic);
    const verification = verifyStagedCompileArtifacts(stagedTopicPath, targetTopic, result.artifacts ?? []);
    return {
      result: verification.passed
        ? result
        : {
          ...result,
          ok: false,
          error: "COMPILE_VERIFICATION_FAILED: staging artifact checks did not pass",
        },
      verification,
    };
  }

  async promote(
    topic: string | undefined,
    context: CompileExecutionContext,
    result: CompileResult,
  ): Promise<CompilePromotionResult> {
    const targetTopic = topic ?? result.topic;
    assertSafeTopic(targetTopic);
    const topicPath = resolve(this.config.vaultPath, targetTopic);
    const checked = await this.verify(targetTopic, context, result);
    result = checked.result;
    const verification = checked.verification;
    const stagedTopicPath = resolve(context.stagingPath, targetTopic);
    if (!verification.passed) {
      return {
        result: {
          ...result,
          ok: false,
          error: "COMPILE_VERIFICATION_FAILED: staging artifact checks did not pass",
        },
        verification,
        promotion: { status: "not-promoted", targets: result.artifacts?.map((artifact) => artifact.proposedTarget) ?? [] },
      };
    }

    try {
      if (!context.baseSnapshot) throw new Error("STAGING_BASE_SNAPSHOT_MISSING: promotion requires the original input snapshot");
      assertStagingBaseUnchanged(topicPath, context.baseSnapshot);
      promoteStagedTopic(stagedTopicPath, topicPath, this.config.vaultStore);
      const promotion: CompilePromotionReceipt = {
        status: "promoted",
        targets: result.artifacts?.map((artifact) => artifact.proposedTarget) ?? [],
        promotedAt: new Date().toISOString(),
      };
      return { result, verification, promotion };
    } catch (error) {
      return {
        result: {
          ...result,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        verification,
        promotion: {
          status: "not-promoted",
          targets: result.artifacts?.map((artifact) => artifact.proposedTarget) ?? [],
        },
      };
    }
  }

  private runCompiler(
    args: string[],
    options: { timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolvePromise, reject) => {
      const child = execFile(this.config.python, args, { ...options, encoding: "utf8" }, (error, stdout, stderr) => {
        this.activeProcess = undefined;
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolvePromise({ stdout: String(stdout), stderr: String(stderr) });
      });
      this.activeProcess = child;
    });
  }

  private parseCompileOutput(
    topic: string,
    stdout: string,
    timestamp: string,
    resultFile?: string,
  ): CompileResult {
    if (resultFile && existsSync(resultFile)) {
      try {
        const protocol = JSON.parse(readFileSync(resultFile, "utf8")) as Partial<CompileResult> & { protocolVersion?: number };
        if (protocol.protocolVersion !== 1 || typeof protocol.ok !== "boolean") {
          throw new Error("unsupported compiler result protocol");
        }
        return {
          ok: protocol.ok,
          topic: typeof protocol.topic === "string" ? protocol.topic : topic,
          sourcesCompiled: numberOrZero(protocol.sourcesCompiled),
          conceptsCreated: numberOrZero(protocol.conceptsCreated),
          contradictions: numberOrZero(protocol.contradictions),
          ...(typeof protocol.error === "string" ? { error: protocol.error } : {}),
          timestamp: typeof protocol.timestamp === "string" ? protocol.timestamp : timestamp,
        };
      } catch (error) {
        throw new Error(`Invalid compiler result protocol: ${(error as Error).message}`);
      }
    }

    // Transitional compatibility for older compiler scripts that only print the report.
    return {
      ok: true,
      topic,
      sourcesCompiled: extractNumber(stdout, "Sources compiled"),
      conceptsCreated: extractNumber(stdout, "Concepts created"),
      contradictions: extractNumber(stdout, "Contradictions"),
      timestamp,
    };
  }
}

interface StagingPreparation {
  stagingPath: string;
  topicPath: string;
  baseSnapshot: string;
}

function prepareStaging(vaultPath: string, topic: string, stagingPath: string): StagingPreparation {
  const sourceTopic = resolve(vaultPath, topic);
  const stagedTopic = resolve(stagingPath, topic);
  rmSync(stagingPath, { recursive: true, force: true });
  mkdirSync(stagingPath, { recursive: true });
  cpSync(sourceTopic, stagedTopic, { recursive: true, force: true });
  return {
    stagingPath,
    topicPath: stagedTopic,
    baseSnapshot: snapshotCompileInputs(sourceTopic),
  };
}

function snapshotCompileInputs(topicPath: string): string {
  const hash = createHash("sha256");
  const files: string[] = [];
  const rawPath = resolve(topicPath, "raw");
  const collect = (directory: string): void => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = resolve(directory, entry.name);
      if (entry.isDirectory()) collect(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  };
  collect(rawPath);
  files.push(resolve(topicPath, "_meta.json"));
  for (const file of files.sort()) {
    hash.update(file.slice(topicPath.length).replace(/\\/g, "/"));
    hash.update(existsSync(file) ? readFileSync(file) : "<missing>");
  }
  return hash.digest("hex");
}

function assertStagingBaseUnchanged(topicPath: string, expectedSnapshot: string): void {
  if (snapshotCompileInputs(topicPath) !== expectedSnapshot) {
    throw new Error("STAGING_BASE_CHANGED: source inputs changed while compilation was running");
  }
}

function promoteStagedTopic(stagedTopicPath: string, topicPath: string, vaultStore?: VaultStore): void {
  if (vaultStore) {
    promoteStagedTopicThroughVaultStore(stagedTopicPath, topicPath, vaultStore);
    return;
  }
  const stagedWiki = resolve(stagedTopicPath, "wiki");
  if (!existsSync(stagedWiki)) throw new Error("STAGING_OUTPUT_MISSING: compiler did not produce a wiki projection");

  const liveWiki = resolve(topicPath, "wiki");
  const temporaryWiki = resolve(topicPath, `.wiki.compile-${randomUUID()}`);
  const backupWiki = resolve(topicPath, `.wiki.compile-backup-${randomUUID()}`);
  cpSync(stagedWiki, temporaryWiki, { recursive: true, force: true });
  let movedExisting = false;
  try {
    if (existsSync(liveWiki)) {
      renameSync(liveWiki, backupWiki);
      movedExisting = true;
    }
    renameSync(temporaryWiki, liveWiki);
    if (movedExisting) rmSync(backupWiki, { recursive: true, force: true });

    const stagedMeta = resolve(stagedTopicPath, "_meta.json");
    const liveMeta = resolve(topicPath, "_meta.json");
    if (existsSync(stagedMeta)) {
      const temporaryMeta = resolve(topicPath, `._meta.compile-${randomUUID()}.tmp`);
      cpSync(stagedMeta, temporaryMeta, { force: true });
      renameSync(temporaryMeta, liveMeta);
    }
  } catch (error) {
    rmSync(temporaryWiki, { recursive: true, force: true });
    if (movedExisting && !existsSync(liveWiki)) renameSync(backupWiki, liveWiki);
    throw error;
  } finally {
    rmSync(temporaryWiki, { recursive: true, force: true });
    rmSync(backupWiki, { recursive: true, force: true });
  }
}

function promoteStagedTopicThroughVaultStore(
  stagedTopicPath: string,
  topicPath: string,
  vaultStore: VaultStore,
): void {
  const topic = topicPath.split(/[\\/]/).pop();
	if (!topic) throw new Error("STAGING_TOPIC_MISSING: cannot resolve promotion topic");
	const stagedWiki = resolve(stagedTopicPath, "wiki");
	if (!existsSync(stagedWiki)) throw new Error("STAGING_OUTPUT_MISSING: compiler did not produce a wiki projection");
	const stagedFiles = collectFilePaths(stagedWiki);
	if (stagedFiles.length === 0) throw new Error("STAGING_OUTPUT_EMPTY: compiler produced an empty wiki projection");
	const stagedRelative = new Set(stagedFiles.map((filePath) => relative(stagedWiki, filePath).replace(/\\/g, "/")));
  const liveWiki = resolve(topicPath, "wiki");
  const liveFiles = collectFilePaths(liveWiki);

  vaultStore.withLock(topic, () => {
    for (const liveFile of liveFiles) {
      const rel = relative(liveWiki, liveFile).replace(/\\/g, "/");
      if (!stagedRelative.has(rel)) vaultStore.remove(`${topic}/wiki/${rel}`, { lock: false });
    }
    for (const stagedFile of stagedFiles) {
      const rel = relative(stagedWiki, stagedFile).replace(/\\/g, "/");
      vaultStore.writeText(`${topic}/wiki/${rel}`, readFileSync(stagedFile, "utf8"), { lock: false });
    }
    const stagedMeta = resolve(stagedTopicPath, "_meta.json");
    if (existsSync(stagedMeta)) vaultStore.writeText(`${topic}/_meta.json`, readFileSync(stagedMeta, "utf8"), { lock: false });
  });
}

function collectFilePaths(directory: string): string[] {
  const files: string[] = [];
  const walk = (current: string): void => {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(directory);
  return files.sort();
}

function extractNumber(text: string, label: string): number {
  const match = text.match(new RegExp(label + "\\s*:\\s*(\\d+)"));
  return match ? Number.parseInt(match[1], 10) : 0;
}

function collectArtifacts(stagedTopicPath: string, topic: string, runId: string): CompileArtifactReceipt[] {
  const wikiPath = resolve(stagedTopicPath, "wiki");
  const files: string[] = [];
  const walk = (directory: string): void => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  };
  walk(wikiPath);

  return files.sort().map((filePath) => {
    const wikiRelative = relative(wikiPath, filePath).replace(/\\/g, "/");
    const relativePath = `${topic}/wiki/${wikiRelative}`;
    const content = readFileSync(filePath);
    const contentDigest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    const artifactId = `artifact/compile-${runId.slice("compile-run/".length)}-${contentDigest.slice(-16)}`;
    return {
      artifactId,
      relativePath,
      stagedPath: `staging/${relativePath}`,
      proposedTarget: relativePath,
      contentDigest,
      mediaType: mediaTypeFor(filePath),
    };
  });
}

function mediaTypeFor(filePath: string): string {
  if (filePath.endsWith(".md")) return "text/markdown";
  if (filePath.endsWith(".json")) return "application/json";
  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) return "application/yaml";
  return "application/octet-stream";
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function assertSafeTopic(topic: string): void {
  if (!topic || topic === "." || topic === ".." || topic.includes("/") || topic.includes("\\")) {
    throw new Error("COMPILE_TOPIC_INVALID: topic must be one vault directory segment");
  }
}
