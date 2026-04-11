/**
 * bridge-safe-paths.ts -- Blocklist of paths that LLMs must never write to.
 *
 * Mirror of vault_safe_paths.py (Python reference implementation).
 * Logic must match byte-for-byte with vault_safe_paths.py.
 *
 * DO NOT import the Node `path` module. This file runs in the Obsidian
 * Electron renderer where path.sep is platform-dependent. All path
 * operations use manual string splitting after normalizing backslashes.
 *
 * Pattern origin: JuliusBrussee/caveman (MIT, 2026-04).
 */

// ---------- Extension blocklists ----------
// Source: caveman-compress/scripts/detect.py SKIP_EXTENSIONS

const _CAVEMAN_SKIP_EXTENSIONS: ReadonlySet<string> = new Set([
  ".py", ".js", ".ts", ".tsx", ".jsx",
  ".json", ".yaml", ".yml", ".toml",
  ".env", ".lock",
  ".css", ".scss", ".html", ".xml",
  ".sql", ".sh", ".bash", ".zsh",
  ".go", ".rs", ".java",
  ".c", ".cpp", ".h", ".hpp",
  ".rb", ".php", ".swift", ".kt", ".lua",
  ".dockerfile", ".makefile",
  ".csv", ".ini", ".cfg",
]);

const _VAULT_EXTRA_BLOCKED: ReadonlySet<string> = new Set([
  // Binaries / executables
  ".exe", ".dll", ".so", ".dylib", ".bin",
  // Compressed archives
  ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
  // Images
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".svg",
  // Audio / video
  ".mp3", ".mp4", ".wav", ".flac", ".webm", ".mov", ".avi", ".mkv",
  // Documents (binary)
  ".pdf", ".docx", ".xlsx", ".pptx",
  // Credentials / secrets
  ".pem", ".key", ".crt", ".pfx", ".p12", ".gpg", ".asc",
  // Database files
  ".db", ".sqlite", ".sqlite3", ".duckdb",
  // Git internals
  ".pack", ".idx",
]);

export const BLOCKED_EXTENSIONS: ReadonlySet<string> = new Set([
  ..._CAVEMAN_SKIP_EXTENSIONS,
  ..._VAULT_EXTRA_BLOCKED,
]);

// Vault is markdown-first. These are the safe extensions LLMs can write.
export const ALLOWED_VAULT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".md", ".markdown", ".txt", ".rst",
  // Obsidian Canvas JSON files -- gated separately (allowCanvas flag)
  ".canvas",
]);

// ---------- Directory blocklist ----------
// Path components (anywhere in the path) that mark protected directories.
// Match is exact-segment, not substring.

export const BLOCKED_DIRECTORIES: ReadonlySet<string> = new Set([
  // Obsidian config and plugin internals
  ".obsidian",
  ".obsidian.bak",
  // Git internals
  ".git",
  ".gitea",
  ".github",
  // Trash and cache
  ".trash",
  ".cache",
  ".tmp",
  "node_modules",
  "__pycache__",
  // Vault-bridge / vault-mind internals
  ".vault-bridge",
  ".vault-mind",
  // GSD planning
  ".planning",
  // FSC internals
  ".fsc",
  // Memory keeper persistent state
  ".memory_keeper",
]);


// ---------- Internal helpers ----------

/**
 * Extract the suffix (extension) from a path string, matching Python's
 * PurePosixPath(path).suffix.lower() behavior.
 *
 * Python pathlib: PurePosixPath(".env").suffix == "" (bare dotfile has no suffix).
 * P2 fix: bare dotfiles are handled separately in isBlockedExtension.
 */
function _getSuffix(path: string): string {
  const name = path.split("/").pop() ?? "";
  const dotIdx = name.lastIndexOf(".");
  // If the dot is at index 0 (bare dotfile like ".env"), no suffix.
  if (dotIdx <= 0) return "";
  return name.slice(dotIdx).toLowerCase();
}

/**
 * Normalize a vault-relative path to match the TypeScript handler.
 * Mirrors vault_safe_paths._normalize_vault_path.
 */
function _normalizeVaultPath(path: string): string {
  let norm = path.replace(/\\/g, "/");
  // Strip a single leading "./"
  if (norm.startsWith("./")) {
    norm = norm.slice(2);
  }
  // Collapse consecutive slashes
  while (norm.includes("//")) {
    norm = norm.replace(/\/\//g, "/");
  }
  // Drop bare "." segments (keep ".." so traversal check can catch it)
  const parts = norm.split("/").filter((p) => p !== ".");
  norm = parts.join("/");
  return norm;
}

/**
 * True if the path contains traversal markers or absolute prefixes.
 * Mirrors vault_safe_paths._has_path_traversal.
 */
function hasPathTraversal(path: string): boolean {
  const norm = _normalizeVaultPath(path);
  if (norm.startsWith("/")) return true;
  // Windows drive letter (C:, D:, ...)
  if (norm.length >= 2 && norm[1] === ":") return true;
  const parts = norm.split("/");
  return parts.some((p) => p === "..");
}

/**
 * True if the file extension is on the blocklist.
 *
 * P2 fix: bare dotfiles like ".env" have suffix "" from _getSuffix.
 * Special-case: if the filename starts with "." and has no further ".",
 * check whether "." + rest is in BLOCKED_EXTENSIONS.
 */
export function isBlockedExtension(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  const name = normalized.split("/").pop() ?? "";
  const suffix = _getSuffix(normalized);
  if (!suffix) {
    // P2 fix: bare dotfile like ".env" -- check "." + name[1:] in blocklist
    if (name.startsWith(".") && !name.slice(1).includes(".")) {
      return BLOCKED_EXTENSIONS.has(("." + name.slice(1)).toLowerCase());
    }
    return false;
  }
  return BLOCKED_EXTENSIONS.has(suffix);
}

/**
 * True if any path segment matches a blocked directory.
 * Mirrors vault_safe_paths.is_blocked_directory.
 */
export function isBlockedDirectory(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts.some((p) => BLOCKED_DIRECTORIES.has(p));
}

/**
 * Decide if an LLM-driven write to this path is safe.
 * Mirrors vault_safe_paths.is_safe_to_write byte-for-byte.
 *
 * @param path - The relative vault path. Forward or back slashes accepted.
 * @param opts.allowCanvas - If true, .canvas files are allowed. Default false.
 * @param opts.allowExtensionless - If true, extensionless paths are allowed. Default false.
 *   Used by vault.mkdir (directory names carry no extension by design).
 */
export function isSafeToWrite(path: string, opts?: { allowCanvas?: boolean; allowExtensionless?: boolean }): boolean {
  const allowCanvas = opts?.allowCanvas ?? false;
  const allowExtensionless = opts?.allowExtensionless ?? false;

  if (!path || !path.trim()) return false;

  // Normalize first so "." segments and leading "./" are stripped
  const normalized = _normalizeVaultPath(path);

  if (hasPathTraversal(path)) return false;
  if (isBlockedDirectory(normalized)) return false;
  if (isBlockedExtension(normalized)) return false;

  const suffix = _getSuffix(normalized);
  if (suffix === ".canvas" && !allowCanvas) return false;

  // P3 fix: extensionless files (Makefile, README, etc.) are refused.
  // Bare dotfiles (.env) are already handled by isBlockedExtension above.
  // allowExtensionless=true exempts vault.mkdir (directory names have no extension).
  if (!suffix) {
    return allowExtensionless;
  }
  if (!ALLOWED_VAULT_EXTENSIONS.has(suffix)) {
    return false;
  }
  return true;
}
