/**
 * Tests for bridge-safe-paths.ts -- TS port of vault_safe_paths.py
 *
 * Every blocked case in Python has a matching blocked case here.
 * Structure mirrors tests/test_vault_safe_paths.py 1:1.
 */

import { describe, it, expect } from "vitest";
import {
  ALLOWED_VAULT_EXTENSIONS,
  BLOCKED_DIRECTORIES,
  BLOCKED_EXTENSIONS,
  isBlockedDirectory,
  isBlockedExtension,
  isSafeToWrite,
} from "../../src/safety/bridge-safe-paths";


// ---------- Docstring examples (load-bearing canonical cases) ----------

describe("docstring canonical cases", () => {
  it("safe markdown note", () => {
    expect(isSafeToWrite("notes/idea.md")).toBe(true);
  });

  it("blocks .obsidian/config.json", () => {
    expect(isSafeToWrite(".obsidian/config.json")).toBe(false);
  });

  it("blocks blocked extension python script", () => {
    expect(isSafeToWrite("scripts/run.py")).toBe(false);
  });

  it("blocks path traversal ../secrets.md", () => {
    expect(isSafeToWrite("../secrets.md")).toBe(false);
  });

  it("blocks canvas file by default", () => {
    expect(isSafeToWrite("notes/draft.canvas")).toBe(false);
  });
});


// ---------- Extension blocklist sweep ----------

describe("blocked extensions are refused", () => {
  const blockedPaths = [
    "src/main.py",
    "config/app.json",
    "config/app.yaml",
    "config/app.yml",
    "styles/theme.css",
    "server/index.ts",
    "client/view.tsx",
    "data/rows.csv",
    "config/settings.lock",
    "bin/tool.exe",
    "lib/native.dll",
    "assets/logo.png",
    "media/clip.mp4",
    "docs/spec.pdf",
    "db/store.sqlite",
    "creds/id.pem",
    "archive/bundle.zip",
  ];

  for (const p of blockedPaths) {
    it(`refuses ${p}`, () => {
      expect(isSafeToWrite(p)).toBe(false);
    });
  }
});

it("dotenv P2 bug preserved: bare .env passes (suffix is empty)", () => {
  // KNOWN QUIRK: ".env" listed in blocklist but bare dotfile has empty suffix.
  // Python PurePosixPath(".env").suffix == "" -- we match this behavior.
  // MATCHES Python vault_safe_paths.py:128-135 P2 TODO
  expect(isSafeToWrite(".env")).toBe(true);
  // "foo.env" is blocked (suffix ".env" hits the list)
  expect(isSafeToWrite("config/foo.env")).toBe(false);
});

describe("allowed extensions pass", () => {
  it("notes/idea.md", () => expect(isSafeToWrite("notes/idea.md")).toBe(true));
  it("reference/spec.markdown", () => expect(isSafeToWrite("reference/spec.markdown")).toBe(true));
  it("logs/session.txt", () => expect(isSafeToWrite("logs/session.txt")).toBe(true));
  it("docs/guide.rst is allowed", () => expect(isSafeToWrite("docs/guide.rst")).toBe(true));
});


// ---------- Directory blocklist sweep ----------

describe("every blocked directory is detected", () => {
  for (const segment of BLOCKED_DIRECTORIES) {
    it(`blocks vault/${segment}/file.md`, () => {
      const path = `vault/${segment}/file.md`;
      expect(isSafeToWrite(path)).toBe(false);
      expect(isBlockedDirectory(path)).toBe(true);
    });
  }
});

describe("blocked directory tests", () => {
  it("blocks .obsidian/config.json at top level", () => {
    expect(isBlockedDirectory(".obsidian/config.json")).toBe(true);
  });

  it("blocks .git/HEAD at top level", () => {
    expect(isBlockedDirectory(".git/HEAD")).toBe(true);
  });

  it("blocks .trash/note.md at top level", () => {
    expect(isBlockedDirectory(".trash/note.md")).toBe(true);
  });

  it("blocks nested .git", () => {
    expect(isBlockedDirectory("notes/.git/config.md")).toBe(true);
    expect(isSafeToWrite("notes/.git/config.md")).toBe(false);
  });

  it("blocks nested node_modules", () => {
    expect(isBlockedDirectory("frontend/app/node_modules/pkg.md")).toBe(true);
  });

  it("directory blocklist is exact segment not substring", () => {
    // ".gitignore-notes" must NOT match ".git" as substring
    expect(isBlockedDirectory("notes/gitignore-notes/draft.md")).toBe(false);
  });
});


// ---------- Path traversal / absolute paths ----------

describe("path traversal", () => {
  it("blocks ../secrets.md", () => {
    expect(isSafeToWrite("../secrets.md")).toBe(false);
  });

  it("./rel.md is normalized and accepted (matches TS handler behavior)", () => {
    // Bug #9 fix: leading "./" stripped by normalization -> "rel.md" -> safe
    expect(isSafeToWrite("./rel.md")).toBe(true);
  });

  it("blocks absolute posix path", () => {
    expect(isSafeToWrite("/abs/path.md")).toBe(false);
  });

  it("blocks Windows drive letter C:", () => {
    expect(isSafeToWrite("C:/drive.md")).toBe(false);
  });

  it("blocks Windows drive letter lowercase d:", () => {
    expect(isSafeToWrite("d:/drive.md")).toBe(false);
  });

  it("blocks nested dotdot notes/../../escape.md", () => {
    expect(isSafeToWrite("notes/../../escape.md")).toBe(false);
  });
});


// ---------- Empty / whitespace / unknown extension ----------

describe("empty and whitespace paths", () => {
  it("refuses empty string", () => {
    expect(isSafeToWrite("")).toBe(false);
  });

  it("refuses whitespace only", () => {
    expect(isSafeToWrite("   ")).toBe(false);
  });

  it("refuses tab and newline", () => {
    expect(isSafeToWrite("\t\n")).toBe(false);
  });
});

it("refuses unknown extension .xyz", () => {
  expect(BLOCKED_EXTENSIONS.has(".xyz")).toBe(false);
  expect(ALLOWED_VAULT_EXTENSIONS.has(".xyz")).toBe(false);
  expect(isSafeToWrite("notes/weird.xyz")).toBe(false);
});

it("extensionless file passes (P3 bug preserved)", () => {
  // P3 TODO: extensionless files fall through `if suffix` guard -> true
  // Matches Python vault_safe_paths.py:226-232 P3 TODO (current broken behavior)
  expect(isSafeToWrite("notes/READMEnoext")).toBe(true);
});


// ---------- Canvas gating ----------

describe("canvas gating", () => {
  it("canvas refused without flag", () => {
    expect(isSafeToWrite("notes/board.canvas")).toBe(false);
  });

  it("canvas allowed with allowCanvas flag", () => {
    expect(isSafeToWrite("notes/board.canvas", { allowCanvas: true })).toBe(true);
  });

  it("canvas flag does not bypass traversal", () => {
    expect(isSafeToWrite("../board.canvas", { allowCanvas: true })).toBe(false);
  });

  it("canvas flag does not bypass blocked directory", () => {
    expect(isSafeToWrite(".obsidian/board.canvas", { allowCanvas: true })).toBe(false);
  });
});


// ---------- isBlockedExtension standalone ----------

describe("isBlockedExtension standalone", () => {
  it("python is blocked", () => {
    expect(isBlockedExtension("foo.py")).toBe(true);
  });

  it("markdown is not blocked", () => {
    expect(isBlockedExtension("foo.md")).toBe(false);
  });

  it("no suffix returns false", () => {
    expect(isBlockedExtension("README")).toBe(false);
  });

  it("case insensitive: PDF", () => {
    expect(isBlockedExtension("Report.PDF")).toBe(true);
  });

  it("case insensitive: PY", () => {
    expect(isBlockedExtension("Script.PY")).toBe(true);
  });
});


// ---------- isBlockedDirectory standalone ----------

describe("isBlockedDirectory standalone", () => {
  it("returns false for clean path", () => {
    expect(isBlockedDirectory("notes/2026/idea.md")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isBlockedDirectory("")).toBe(false);
  });
});


// ---------- Windows backslash normalization ----------

describe("windows backslash normalization", () => {
  it("blocked dir with backslashes", () => {
    expect(isBlockedDirectory("notes\\.git\\config.md")).toBe(true);
    expect(isSafeToWrite("notes\\.git\\config.md")).toBe(false);
  });

  it("blocked ext with backslashes", () => {
    expect(isBlockedExtension("src\\app\\main.py")).toBe(true);
    expect(isSafeToWrite("src\\app\\main.py")).toBe(false);
  });

  it("safe markdown with backslashes", () => {
    expect(isSafeToWrite("notes\\2026\\idea.md")).toBe(true);
  });

  it("Windows drive letter with backslash refused", () => {
    expect(isSafeToWrite("C:\\vault\\note.md")).toBe(false);
  });
});


// ---------- Sets are ReadonlySet (frozen equivalent) ----------

describe("constants are ReadonlySet", () => {
  it("BLOCKED_EXTENSIONS is a Set", () => {
    expect(BLOCKED_EXTENSIONS).toBeInstanceOf(Set);
  });

  it("BLOCKED_DIRECTORIES is a Set", () => {
    expect(BLOCKED_DIRECTORIES).toBeInstanceOf(Set);
  });

  it("ALLOWED_VAULT_EXTENSIONS is a Set", () => {
    expect(ALLOWED_VAULT_EXTENSIONS).toBeInstanceOf(Set);
  });

  it("allowed extensions include markdown family", () => {
    expect(ALLOWED_VAULT_EXTENSIONS.has(".md")).toBe(true);
    expect(ALLOWED_VAULT_EXTENSIONS.has(".markdown")).toBe(true);
    expect(ALLOWED_VAULT_EXTENSIONS.has(".txt")).toBe(true);
  });
});


// ---------- Path normalization (TS-layer alignment) ----------

describe("path normalization", () => {
  it("./notes/idea.md -> safe after stripping ./", () => {
    expect(isSafeToWrite("./notes/idea.md")).toBe(true);
  });

  it("notes//idea.md -> safe after collapsing //", () => {
    expect(isSafeToWrite("notes//idea.md")).toBe(true);
  });

  it("./../secrets.md still rejected after stripping ./", () => {
    expect(isSafeToWrite("./../secrets.md")).toBe(false);
  });

  it("../notes/idea.md still rejected", () => {
    expect(isSafeToWrite("../notes/idea.md")).toBe(false);
  });

  it("/abs/path.md still rejected", () => {
    expect(isSafeToWrite("/abs/path.md")).toBe(false);
  });

  it("notes/./idea.md -> safe after dropping bare . segment", () => {
    expect(isSafeToWrite("notes/./idea.md")).toBe(true);
  });
});
