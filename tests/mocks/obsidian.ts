/**
 * Minimal Obsidian API mock for unit tests.
 *
 * Only the surface actually touched by bridge.ts + server.ts tests is stubbed.
 * Real classes are used (not plain objects) so that `instanceof TFile` and
 * `instanceof TFolder` checks in bridge.ts work correctly.
 */

// ---------------------------------------------------------------------------
// Abstract base (mirrors Obsidian's TAbstractFile)
// ---------------------------------------------------------------------------

export class TAbstractFile {
  path: string;
  name: string;
  constructor(path: string) {
    this.path = path;
    this.name = path.split("/").pop() ?? path;
  }
}

// ---------------------------------------------------------------------------
// TFile -- represents a markdown (or any) file
// ---------------------------------------------------------------------------

export class TFile extends TAbstractFile {
  extension: string;
  basename: string;
  stat: { size: number; ctime: number; mtime: number };

  constructor(path: string, content: string = "") {
    super(path);
    const parts = path.split(".");
    this.extension = parts.length > 1 ? parts[parts.length - 1] : "";
    this.basename = this.name.replace(/\.[^.]+$/, "");
    this.stat = { size: content.length, ctime: 0, mtime: 0 };
  }
}

// ---------------------------------------------------------------------------
// TFolder -- represents a directory
// ---------------------------------------------------------------------------

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  constructor(path: string) {
    super(path);
  }
}

// ---------------------------------------------------------------------------
// MockVault
//
// Seeded via the constructor: pass a Record<path, content>.
// Implements the Vault methods that bridge.ts calls:
//   getAbstractFileByPath, getMarkdownFiles, cachedRead, read,
//   create, process (modify/append), delete, trash, createFolder, getRoot
// ---------------------------------------------------------------------------

export class MockVault {
  private files: Map<string, TFile> = new Map();
  private contents: Map<string, string> = new Map();

  constructor(seed: Record<string, string> = {}) {
    for (const [p, c] of Object.entries(seed)) {
      const f = new TFile(p, c);
      this.files.set(p, f);
      this.contents.set(p, c);
    }
  }

  getName(): string {
    return "test-vault";
  }

  /** Adapter stub for bridge.getVaultPath() */
  adapter: { basePath: string } = { basePath: "/mock/vault" };

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.files.get(path) ?? null;
  }

  getMarkdownFiles(): TFile[] {
    return Array.from(this.files.values()).filter((f) => f.extension === "md");
  }

  /** Used by bridge.search() */
  async cachedRead(file: TFile): Promise<string> {
    return this.contents.get(file.path) ?? "";
  }

  /** Used by bridge.read() */
  async read(file: TFile): Promise<string> {
    return this.contents.get(file.path) ?? "";
  }

  async create(path: string, content: string): Promise<TFile> {
    const f = new TFile(path, content);
    this.files.set(path, f);
    this.contents.set(path, content);
    return f;
  }

  /** Used by bridge.modify() and bridge.append() */
  async process(file: TFile, fn: (existing: string) => string): Promise<void> {
    const current = this.contents.get(file.path) ?? "";
    const next = fn(current);
    this.contents.set(file.path, next);
    file.stat.size = next.length;
  }

  async delete(_file: TAbstractFile, _force: boolean): Promise<void> {
    this.files.delete(_file.path);
    this.contents.delete(_file.path);
  }

  async trash(file: TAbstractFile, _local: boolean): Promise<void> {
    this.files.delete(file.path);
    this.contents.delete(file.path);
  }

  async createFolder(path: string): Promise<TFolder> {
    const folder = new TFolder(path);
    // Store folder as a TFolder so getAbstractFileByPath returns it
    (this.files as unknown as Map<string, TAbstractFile>).set(path, folder);
    return folder;
  }

  getRoot(): TFolder {
    const root = new TFolder("/");
    root.children = Array.from(this.files.values());
    return root;
  }
}

// ---------------------------------------------------------------------------
// MockMetadataCache
//
// Implements the MetadataCache surface that bridge.ts uses:
//   getCache, getFileCache, resolvedLinks, unresolvedLinks
// ---------------------------------------------------------------------------

export class MockMetadataCache {
  resolvedLinks: Record<string, Record<string, number>> = {};
  unresolvedLinks: Record<string, Record<string, number>> = {};

  private caches: Map<string, Record<string, unknown>> = new Map();

  setCache(path: string, cache: Record<string, unknown>): void {
    this.caches.set(path, cache);
  }

  getCache(path: string): Record<string, unknown> | null {
    return this.caches.get(path) ?? null;
  }

  getFileCache(file: TFile): Record<string, unknown> | null {
    return this.caches.get(file.path) ?? null;
  }
}

// ---------------------------------------------------------------------------
// MockApp
//
// Composes MockVault + MockMetadataCache + minimal fileManager stub.
// ---------------------------------------------------------------------------

export class MockApp {
  vault: MockVault;
  metadataCache: MockMetadataCache;
  fileManager: { renameFile: (_file: TAbstractFile, _newPath: string) => Promise<void> };

  constructor(seed: Record<string, string> = {}) {
    this.vault = new MockVault(seed);
    this.metadataCache = new MockMetadataCache();
    this.fileManager = {
      renameFile: async () => {},
    };
  }
}

// ---------------------------------------------------------------------------
// Plugin base class stub (only needed if main.ts is ever tested directly)
// ---------------------------------------------------------------------------

export class Plugin {
  app: MockApp = new MockApp();
  manifest: unknown = {};
  loadData(): Promise<null> { return Promise.resolve(null); }
  saveData(_data: unknown): Promise<void> { return Promise.resolve(); }
  addSettingTab(_tab: unknown): void {}
  registerEvent(_ref: unknown): void {}
}
