import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";

import type { CompileArtifactReceipt, CompileVerificationCheck, CompileVerificationReport } from "./types.js";

/** Deterministic manifest, scope, existence, and digest gate for compiler output. */
export function verifyStagedCompileArtifacts(
  stagedTopicPath: string,
  topic: string,
  artifacts: CompileArtifactReceipt[],
): CompileVerificationReport {
  const checks: CompileVerificationCheck[] = [];
  const seenTargets = new Set<string>();
  for (const artifact of artifacts) {
    const targetSafe = artifact.proposedTarget.startsWith(`${topic}/wiki/`)
      && !artifact.proposedTarget.includes("..")
      && !artifact.proposedTarget.includes("\\");
    checks.push({
      checkId: `target:${artifact.artifactId}`,
      passed: targetSafe,
      message: targetSafe ? "Artifact target is within the compiler Wiki projection" : "Artifact target escapes the compiler Wiki projection",
    });

    const unique = !seenTargets.has(artifact.proposedTarget);
    seenTargets.add(artifact.proposedTarget);
    checks.push({
      checkId: `unique:${artifact.artifactId}`,
      passed: unique,
      message: unique ? "Artifact target is unique" : "Artifact target is duplicated",
    });

    const stagedPathMatches = artifact.stagedPath === `staging/${artifact.relativePath}`;
    checks.push({
      checkId: `staged-path:${artifact.artifactId}`,
      passed: stagedPathMatches,
      message: stagedPathMatches ? "Staged path agrees with the manifest target" : "Staged path does not agree with the manifest target",
    });

    const relativePath = artifact.relativePath.startsWith(`${topic}/`)
      ? artifact.relativePath.slice(`${topic}/`.length)
      : "../invalid-artifact-path";
    const stagedFile = resolve(stagedTopicPath, relativePath);
    const stagingRoot = resolve(stagedTopicPath);
    const relativeStagedFile = relative(stagingRoot, stagedFile).replace(/\\/g, "/");
    const contained = relativeStagedFile === "" || (relativeStagedFile !== ".." && !relativeStagedFile.startsWith("../"));
    const exists = contained && existsSync(stagedFile) && statSync(stagedFile).isFile();
    checks.push({
      checkId: `exists:${artifact.artifactId}`,
      passed: exists,
      message: exists ? "Staged artifact exists" : "Staged artifact is missing or escapes staging",
    });
    if (exists) {
      const actual = `sha256:${createHash("sha256").update(readFileSync(stagedFile)).digest("hex")}`;
      const digestMatches = actual === artifact.contentDigest;
      checks.push({
        checkId: `digest:${artifact.artifactId}`,
        passed: digestMatches,
        message: digestMatches ? "Staged artifact digest matches its manifest" : "Staged artifact digest differs from its manifest",
      });
    }
  }

  // The manifest is allowed to be empty for a no-op compile, but every listed
  // target must pass all deterministic checks before the promotion gate opens.
  const passed = checks.every((check) => check.passed);
  return {
    artifactIds: artifacts.map((artifact) => artifact.artifactId),
    checks,
    passed,
    acceptanceCoverage: checks.length === 0 ? 1 : checks.filter((check) => check.passed).length / checks.length,
    recommendedDecision: passed ? "promote" : "request_changes",
  };
}

export function listStagedCompileFiles(stagedTopicPath: string): string[] {
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
  return files.sort();
}

export function stagedCompileRelativePath(stagedTopicPath: string, filePath: string): string {
  return relative(stagedTopicPath, filePath).replace(/\\/g, "/");
}
