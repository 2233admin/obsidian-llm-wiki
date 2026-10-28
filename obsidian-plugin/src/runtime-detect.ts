import { execFile } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { SettingsDocument } from "../../packages/settings-platform/src/types";

/**
 * Finds the Python runtime and compiler/kb_meta.py on this device so Promote
 * and Compile work without manual setup. Detected values are written to the
 * user-device scope under RUNTIME_DETECT_ACTOR; a value written by anyone else
 * (the user, a migration) is never replaced.
 */
export const RUNTIME_DETECT_ACTOR = "llmwiki-runtime-detect";

const CLAUDE_PLUGIN_ID = "llmwiki@obsidian-llm-wiki";

export interface RuntimeDetectHost {
  home: string;
  platform: NodeJS.Platform;
  exists(path: string): boolean;
  readText(path: string): string;
  /** Resolves true when `command --version` exits 0. */
  probe(command: string): Promise<boolean>;
}

export function nodeRuntimeDetectHost(home: string): RuntimeDetectHost {
  return {
    home,
    platform: process.platform,
    exists: existsSync,
    readText: path => readFileSync(path, "utf8"),
    probe: command => new Promise(resolve => {
      execFile(command, ["--version"], { timeout: 3_000, windowsHide: true }, error => resolve(!error));
    }),
  };
}

/**
 * The compiler shipped with an installed LLM Wiki plugin: the Claude Code
 * plugin's current install, then a `plugin` branch clone at ~/.llmwiki.
 */
export function detectKbMetaPath(host: RuntimeDetectHost): string | null {
  const candidates: string[] = [];
  try {
    const installed = JSON.parse(host.readText(join(host.home, ".claude", "plugins", "installed_plugins.json"))) as {
      plugins?: Record<string, Array<{ installPath?: unknown }>>;
    };
    for (const entry of installed.plugins?.[CLAUDE_PLUGIN_ID] ?? []) {
      if (typeof entry.installPath === "string") candidates.push(join(entry.installPath, "compiler", "kb_meta.py"));
    }
  } catch { /* Claude Code plugin not installed */ }
  candidates.push(join(host.home, ".llmwiki", "compiler", "kb_meta.py"));
  return candidates.find(path => host.exists(path)) ?? null;
}

/**
 * Apps launched from the macOS Dock do not inherit the shell PATH, so the
 * common Homebrew locations are tried after the bare command names.
 */
export async function detectPython(host: RuntimeDetectHost): Promise<string | null> {
  const candidates = host.platform === "win32"
    ? ["python", "py"]
    : ["python3", "python", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"];
  for (const command of candidates) {
    if (await host.probe(command)) return command;
  }
  return null;
}

/** The user-device assignments detection should write, given what is there now. */
export async function planRuntimeDetection(
  host: RuntimeDetectHost,
  userDevice: SettingsDocument,
): Promise<Array<{ key: string; value: string }>> {
  const replaceable = (key: string) => {
    const current = userDevice.assignments.find(assignment => assignment.key === key);
    return !current || current.provenance.actor === RUNTIME_DETECT_ACTOR ? current : null;
  };
  const plan: Array<{ key: string; value: string }> = [];
  const detect: Array<[string, () => Promise<string | null> | string | null]> = [
    ["runtime.kb_meta.path", () => detectKbMetaPath(host)],
    ["runtime.python.path", () => detectPython(host)],
  ];
  for (const [key, find] of detect) {
    const current = replaceable(key);
    if (current === null) continue;
    const value = await find();
    if (value && value !== current?.value) plan.push({ key, value });
  }
  return plan;
}
