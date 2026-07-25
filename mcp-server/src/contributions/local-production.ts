import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import type {
  IsolatedWorktreePort,
  PreparedIsolatedPatch,
  RegressionTestEvidence,
  RegressionVerifierPort,
  ResolvedRepository,
  Sha256Digest,
} from './contracts.js';
import { ContributionError } from './errors.js';
import {
  type ContributionArtifactWorkspace,
  type ContributionArtifactWorkspacePort,
  type ExecFilePort,
  GhCliContributionTransport,
  type GhCliContributionTransportOptions,
  NodeExecFilePort,
} from './gh-cli.js';
import { assertSha256, fingerprint, sha256 } from './fingerprint.js';
import { assertSafeRelativePaths } from './sanitize.js';

const COMMIT_RE = /^[0-9a-f]{40,64}$/;
const SAFE_SCRIPT_RE = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,99}$/;
const DEFAULT_TEST_SCRIPTS = ['build', 'check', 'lint', 'test', 'typecheck'];
const DEFAULT_MAX_TEST_OUTPUT_BYTES = 1_000_000;
const DEFAULT_TEST_TIMEOUT_MS = 120_000;
const MAX_COMMAND_LENGTH = 1_000;

export interface LocalContributionWorkspaceBinding {
  projectId: `project/${string}`;
  repositoryMappingFingerprint: Sha256Digest;
  /**
   * Exact machine-local path resolved by Project Context. This runtime never
   * searches parent directories or discovers a different repository.
   */
  localRepositoryPath: string;
}

export interface TestCommandPolicy {
  parse(command: string): string[];
}

export interface LocalContributionProductionOptions {
  binding: LocalContributionWorkspaceBinding;
  exec?: ExecFilePort;
  gitPath?: string;
  tempRoot?: string;
  testCommandPolicy?: TestCommandPolicy;
  allowedTestScripts?: string[];
  testTimeoutMs?: number;
  maxTestOutputBytes?: number;
  generatedPathMatcher?: (repositoryRelativePath: string) => boolean;
  linkNodeModules?: boolean;
}

export interface LocalContributionProductionPorts {
  worktree: IsolatedWorktreePort;
  verifier: RegressionVerifierPort;
  artifacts: ContributionArtifactWorkspacePort;
  dispose(): Promise<void>;
}

export interface LocalGhCliContributionProductionOptions
  extends LocalContributionProductionOptions {
  gh?: GhCliContributionTransportOptions;
}

export interface LocalGhCliContributionProductionPorts
  extends LocalContributionProductionPorts {
  transport: GhCliContributionTransport;
}

interface LocalArtifactRecord {
  artifactId: string;
  artifactDigest: Sha256Digest;
  rootPath: string;
  workspacePath: string;
  branch: string;
  baseSha: string;
  headSha: string;
  verified: boolean;
}

function isInside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function samePath(left: string, right: string): boolean {
  const leftStat = statSync(left, { bigint: true });
  const rightStat = statSync(right, { bigint: true });
  if (leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino) return true;
  const normalizedLeft = realpathSync(left).replace(/[\\/]+$/, '');
  const normalizedRight = realpathSync(right).replace(/[\\/]+$/, '');
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function boundedMessage(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function splitNull(value: string): string[] {
  return value.split('\0').filter(Boolean);
}

function strictArgv(command: string): string[] {
  if (
    !command.trim()
    || command.length > MAX_COMMAND_LENGTH
    || /[\0\r\n;&|<>`]/.test(command)
    || command.includes('$(')
  ) {
    throw new ContributionError('PR_UNAVAILABLE', 'Test command violates the strict argv policy', {
      fallback: 'submit_issue',
    });
  }
  if (command.trim().startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(command);
    } catch {
      throw new ContributionError('PR_UNAVAILABLE', 'Test argv JSON is malformed', {
        fallback: 'submit_issue',
      });
    }
    if (
      !Array.isArray(parsed)
      || !parsed.length
      || parsed.some((item) => typeof item !== 'string' || !item || item.length > 500)
    ) {
      throw new ContributionError('PR_UNAVAILABLE', 'Test argv JSON must be a bounded string array', {
        fallback: 'submit_issue',
      });
    }
    return parsed as string[];
  }

  const argv: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!;
    if (quote) {
      if (character === quote) {
        quote = null;
      } else if (character === '\\' && quote === '"' && index + 1 < command.length) {
        index += 1;
        current += command[index]!;
      } else {
        current += character;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        argv.push(current);
        current = '';
      }
    } else {
      current += character;
    }
  }
  if (quote) {
    throw new ContributionError('PR_UNAVAILABLE', 'Test command contains an unterminated quote', {
      fallback: 'submit_issue',
    });
  }
  if (current) argv.push(current);
  if (!argv.length) {
    throw new ContributionError('PR_UNAVAILABLE', 'Test command is empty', {
      fallback: 'submit_issue',
    });
  }
  return argv;
}

export function createStrictTestCommandPolicy(
  allowedTestScripts: string[] = DEFAULT_TEST_SCRIPTS,
): TestCommandPolicy {
  const allowedScripts = new Set(allowedTestScripts.map((value) => {
    const script = value.trim();
    if (!SAFE_SCRIPT_RE.test(script)) {
      throw new ContributionError('INVALID_INPUT', 'allowedTestScripts contains an unsafe script name');
    }
    return script;
  }));
  return {
    parse(command): string[] {
      const argv = strictArgv(command);
      const executable = argv[0]!.toLowerCase();
      if (
        executable.includes('/')
        || executable.includes('\\')
        || !['bun', 'npm', 'npm.cmd', 'pnpm', 'pnpm.cmd', 'yarn', 'yarn.cmd', 'node', 'node.exe']
          .includes(executable)
      ) {
        throw new ContributionError('PR_UNAVAILABLE', 'Test executable is not allowed', {
          fallback: 'submit_issue',
        });
      }
      const args = argv.slice(1);
      if (executable === 'node' || executable === 'node.exe') {
        if (
          args[0] !== '--test'
          || args.some((arg) =>
            arg === '-e'
            || arg === '--eval'
            || arg === '-p'
            || arg === '--print'
            || arg.startsWith('--test-reporter-destination')
            || isAbsolute(arg)
            || arg.split(/[\\/]/).includes('..')
          )
        ) {
          throw new ContributionError('PR_UNAVAILABLE', 'Node tests must use bounded node --test argv', {
            fallback: 'submit_issue',
          });
        }
        return argv;
      }

      const operation = args[0];
      const script = operation === 'run' ? args[1] : operation;
      const scriptOffset = operation === 'run' ? 2 : 1;
      if (
        !script
        || !allowedScripts.has(script)
        || args.slice(scriptOffset).some((arg) =>
          isAbsolute(arg)
          || arg.split(/[\\/]/).includes('..')
          || /^(?:--prefix|--global|--location|--userconfig|--registry|--cache)(?:=|$)/.test(arg)
        )
      ) {
        throw new ContributionError(
          'PR_UNAVAILABLE',
          'Package-manager tests must invoke an allowed reviewed script',
          { fallback: 'submit_issue' },
        );
      }
      return argv;
    },
  };
}

function defaultGeneratedPathMatcher(path: string): boolean {
  const normalized = path.toLowerCase();
  return (
    /(^|\/)(?:dist|build|coverage|generated|vendor)(?:\/|$)/.test(normalized)
    || /\.(?:generated|gen)\.[^.]+$/.test(normalized)
    || /\.(?:min\.js|min\.css|map)$/.test(normalized)
  );
}

function testEnvironment(workspacePath: string, sourcePath: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
  ]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  const sourceBin = join(sourcePath, 'node_modules', '.bin');
  const currentPath = environment.Path ?? environment.PATH ?? '';
  if (existsSync(sourceBin)) {
    const joined = currentPath
      ? `${sourceBin}${process.platform === 'win32' ? ';' : ':'}${currentPath}`
      : sourceBin;
    if (environment.Path !== undefined) environment.Path = joined;
    else environment.PATH = joined;
  }
  return {
    ...environment,
    CI: '1',
    NO_COLOR: '1',
    GH_PROMPT_DISABLED: '1',
    GIT_TERMINAL_PROMPT: '0',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_offline: 'true',
    npm_config_update_notifier: 'false',
    npm_config_cache: join(workspacePath, '.llmwiki-npm-cache'),
  };
}

class LocalContributionArtifactRuntime
implements IsolatedWorktreePort, RegressionVerifierPort, ContributionArtifactWorkspacePort {
  private readonly sourcePath: string;
  private readonly exec: ExecFilePort;
  private readonly gitPath: string;
  private readonly tempRoot: string;
  private readonly commandPolicy: TestCommandPolicy;
  private readonly testTimeoutMs: number;
  private readonly maxTestOutputBytes: number;
  private readonly generatedPathMatcher: (path: string) => boolean;
  private readonly linkNodeModules: boolean;
  private readonly artifacts = new Map<string, LocalArtifactRecord>();

  constructor(private readonly options: LocalContributionProductionOptions) {
    assertSha256(
      options.binding.repositoryMappingFingerprint,
      'binding.repositoryMappingFingerprint',
    );
    if (!/^project\/[a-z0-9][a-z0-9-]*$/.test(options.binding.projectId)) {
      throw new ContributionError('INVALID_INPUT', 'binding.projectId must be canonical');
    }
    if (!isAbsolute(options.binding.localRepositoryPath)) {
      throw new ContributionError('INVALID_INPUT', 'Workspace binding path must be absolute');
    }
    const requestedPath = resolve(options.binding.localRepositoryPath);
    if (!existsSync(requestedPath) || !lstatSync(requestedPath).isDirectory()) {
      throw new ContributionError('PR_UNAVAILABLE', 'Workspace binding is unavailable', {
        fallback: 'submit_issue',
      });
    }
    this.sourcePath = realpathSync(requestedPath);
    this.exec = options.exec ?? new NodeExecFilePort();
    this.gitPath = options.gitPath ?? 'git';
    this.tempRoot = options.tempRoot ? resolve(options.tempRoot) : tmpdir();
    mkdirSync(this.tempRoot, { recursive: true });
    this.commandPolicy = options.testCommandPolicy
      ?? createStrictTestCommandPolicy(options.allowedTestScripts);
    this.testTimeoutMs = options.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
    this.maxTestOutputBytes = options.maxTestOutputBytes ?? DEFAULT_MAX_TEST_OUTPUT_BYTES;
    this.generatedPathMatcher = options.generatedPathMatcher ?? defaultGeneratedPathMatcher;
    this.linkNodeModules = options.linkNodeModules ?? true;
  }

  private async git(args: string[], maxBufferBytes = 2_000_000): Promise<string> {
    const result = await this.exec.run({
      file: this.gitPath,
      args: ['-C', this.sourcePath, ...args],
      cwd: this.sourcePath,
      env: {
        ...testEnvironment(this.sourcePath, this.sourcePath),
        GIT_LITERAL_PATHSPECS: '1',
      },
      timeoutMs: 30_000,
      maxBufferBytes,
    });
    if (result.exitCode !== 0) {
      throw new ContributionError(
        'PR_UNAVAILABLE',
        `Local git preparation failed: ${boundedMessage(result.stderr) || `exit ${result.exitCode}`}`,
        { fallback: 'submit_issue' },
      );
    }
    return result.stdout;
  }

  private async gitIn(
    workspacePath: string,
    args: string[],
    maxBufferBytes = 2_000_000,
  ): Promise<string> {
    const result = await this.exec.run({
      file: this.gitPath,
      args: ['-C', workspacePath, ...args],
      cwd: workspacePath,
      env: {
        ...testEnvironment(workspacePath, this.sourcePath),
        GIT_LITERAL_PATHSPECS: '1',
      },
      timeoutMs: 30_000,
      maxBufferBytes,
    });
    if (result.exitCode !== 0) {
      throw new ContributionError(
        'PR_UNAVAILABLE',
        `Isolated git preparation failed: ${boundedMessage(result.stderr) || `exit ${result.exitCode}`}`,
        { fallback: 'submit_issue' },
      );
    }
    return result.stdout;
  }

  private pathspecs(paths: string[]): string[] {
    return paths;
  }

  private assertChangedPaths(changedPaths: string[], allowedPaths: string[]): void {
    const safe = assertSafeRelativePaths(changedPaths, 'changedFiles');
    for (const changed of safe) {
      if (!allowedPaths.some((allowed) => changed === allowed || changed.startsWith(`${allowed}/`))) {
        throw new ContributionError(
          'PR_UNAVAILABLE',
          `Prepared patch escaped reviewed allowedPaths: ${changed}`,
          { fallback: 'submit_issue' },
        );
      }
    }
  }

  private assertTrackedFileModes(output: string): void {
    for (const entry of splitNull(output)) {
      const match = /^([0-9]{6}) [0-9a-f]{40,64} [0-3]\t(.+)$/.exec(entry);
      if (!match || !['100644', '100755'].includes(match[1]!)) {
        throw new ContributionError(
          'PR_UNAVAILABLE',
          'Contribution artifacts cannot contain symlinks, submodules, or special file modes',
          { fallback: 'submit_issue' },
        );
      }
      assertSafeRelativePaths([match[2]!], 'trackedArtifactPath');
    }
  }

  private copyUntrackedFiles(
    paths: string[],
    workspacePath: string,
    maxBytes: number,
  ): Map<string, Sha256Digest> {
    let copiedBytes = 0;
    const snapshots = new Map<string, Sha256Digest>();
    for (const path of paths) {
      assertSafeRelativePaths([path], 'untrackedPath');
      const source = join(this.sourcePath, ...path.split('/'));
      const target = join(workspacePath, ...path.split('/'));
      const stat = lstatSync(source);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new ContributionError(
          'PR_UNAVAILABLE',
          'Untracked contribution inputs must be regular files',
          { fallback: 'submit_issue' },
        );
      }
      const canonicalSource = realpathSync(source);
      if (!isInside(this.sourcePath, canonicalSource)) {
        throw new ContributionError('PR_UNAVAILABLE', 'Untracked path escaped the workspace binding', {
          fallback: 'submit_issue',
        });
      }
      const content = readFileSync(canonicalSource);
      copiedBytes += content.byteLength;
      if (copiedBytes > maxBytes) {
        throw new ContributionError('PR_UNAVAILABLE', 'Untracked contribution files exceed maxDiffBytes', {
          fallback: 'submit_issue',
        });
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, { flag: 'wx', mode: stat.mode });
      snapshots.set(path, sha256(content.toString('base64')));
    }
    return snapshots;
  }

  private async discardRecord(record: LocalArtifactRecord): Promise<void> {
    this.artifacts.delete(record.artifactId);
    await this.exec.run({
      file: this.gitPath,
      args: ['-C', this.sourcePath, 'worktree', 'remove', '--force', record.workspacePath],
      cwd: this.sourcePath,
      env: { ...testEnvironment(this.sourcePath, this.sourcePath), GIT_TERMINAL_PROMPT: '0' },
      timeoutMs: 30_000,
      maxBufferBytes: 100_000,
    }).catch(() => undefined);
    await this.exec.run({
      file: this.gitPath,
      args: ['-C', this.sourcePath, 'branch', '-D', record.branch],
      cwd: this.sourcePath,
      env: { ...testEnvironment(this.sourcePath, this.sourcePath), GIT_TERMINAL_PROMPT: '0' },
      timeoutMs: 30_000,
      maxBufferBytes: 100_000,
    }).catch(() => undefined);
    rmSync(record.rootPath, { recursive: true, force: true });
  }

  async prepare(request: {
    repository: ResolvedRepository;
    baseRef: string;
    baseSha: string;
    headRef: string;
    changeSummary: string;
    allowedPaths: string[];
    maxDiffBytes: number;
  }): Promise<PreparedIsolatedPatch> {
    if (
      request.repository.mappingFingerprint
        !== this.options.binding.repositoryMappingFingerprint
      || !COMMIT_RE.test(request.baseSha)
    ) {
      throw new ContributionError(
        'PR_UNAVAILABLE',
        'Repository or base revision does not match the explicit workspace binding',
        { fallback: 'submit_issue' },
      );
    }
    const actualRoot = (await this.git(['rev-parse', '--show-toplevel'])).trim();
    if (!actualRoot || !samePath(actualRoot, this.sourcePath)) {
      throw new ContributionError(
        'PR_UNAVAILABLE',
        'Workspace binding is not the exact Git repository root',
        { fallback: 'submit_issue' },
      );
    }
    await this.git(['cat-file', '-e', `${request.baseSha}^{commit}`], 100_000);
    const allowedPaths = [...new Set(assertSafeRelativePaths(
      request.allowedPaths,
      'allowedPaths',
    ))].sort();
    if (!allowedPaths.length) {
      throw new ContributionError('PR_UNAVAILABLE', 'No reviewed paths were provided', {
        fallback: 'submit_issue',
      });
    }
    const pathspecs = this.pathspecs(allowedPaths);
    const patch = await this.git([
      'diff',
      '--binary',
      '--full-index',
      '--no-ext-diff',
      request.baseSha,
      '--',
      ...pathspecs,
    ], request.maxDiffBytes + 100_000);
    const untracked = splitNull(await this.git([
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      ...pathspecs,
    ], request.maxDiffBytes + 100_000));
    if (Buffer.byteLength(patch, 'utf8') > request.maxDiffBytes) {
      throw new ContributionError('PR_UNAVAILABLE', 'Reviewed patch exceeds maxDiffBytes', {
        fallback: 'submit_issue',
      });
    }

    const rootPath = mkdtempSync(join(this.tempRoot, 'llmwiki-contribution-'));
    const workspacePath = join(rootPath, 'worktree');
    const branch = `llmwiki-artifact/${randomUUID()}`;
    const provisional: LocalArtifactRecord = {
      artifactId: `artifact:${randomUUID()}`,
      artifactDigest: sha256('provisional'),
      rootPath,
      workspacePath,
      branch,
      baseSha: request.baseSha,
      headSha: request.baseSha,
      verified: false,
    };
    try {
      await this.git([
        'worktree',
        'add',
        '--force',
        '-b',
        branch,
        workspacePath,
        request.baseSha,
      ]);
      if (patch) {
        const patchPath = join(rootPath, 'reviewed.patch');
        writeFileSync(patchPath, patch, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        try {
          await this.gitIn(workspacePath, [
            'apply',
            '--index',
            '--binary',
            '--whitespace=nowarn',
            patchPath,
          ], request.maxDiffBytes + 100_000);
        } finally {
          rmSync(patchPath, { force: true });
        }
      }
      const untrackedSnapshots = this.copyUntrackedFiles(
        untracked,
        workspacePath,
        request.maxDiffBytes,
      );
      const currentPatch = await this.git([
        'diff',
        '--binary',
        '--full-index',
        '--no-ext-diff',
        request.baseSha,
        '--',
        ...pathspecs,
      ], request.maxDiffBytes + 100_000);
      const currentUntracked = splitNull(await this.git([
        'ls-files',
        '--others',
        '--exclude-standard',
        '-z',
        '--',
        ...pathspecs,
      ], request.maxDiffBytes + 100_000));
      const untrackedStable = currentUntracked.length === untracked.length
        && currentUntracked.every((path, index) => path === untracked[index])
        && currentUntracked.every((path) => {
          const content = readFileSync(join(this.sourcePath, ...path.split('/')));
          return sha256(content.toString('base64')) === untrackedSnapshots.get(path);
        });
      if (currentPatch !== patch || !untrackedStable) {
        throw new ContributionError(
          'PR_UNAVAILABLE',
          'Reviewed workspace files changed while the isolated artifact was prepared',
          { fallback: 'submit_issue' },
        );
      }
      await this.gitIn(workspacePath, ['add', '--all', '--', ...pathspecs]);
      const changedPaths = splitNull(await this.gitIn(workspacePath, [
        'diff',
        '--cached',
        '--name-only',
        '--diff-filter=ACDMRTUXB',
        '-z',
        request.baseSha,
      ]));
      if (!changedPaths.length) {
        throw new ContributionError('PR_UNAVAILABLE', 'Reviewed paths contain no contribution changes', {
          fallback: 'submit_issue',
        });
      }
      this.assertChangedPaths(changedPaths, allowedPaths);
      this.assertTrackedFileModes(await this.gitIn(workspacePath, [
        'ls-files',
        '--stage',
        '-z',
        '--',
        ...changedPaths,
      ]));
      const finalDiff = await this.gitIn(workspacePath, [
        'diff',
        '--cached',
        '--binary',
        '--full-index',
        '--no-ext-diff',
        request.baseSha,
      ], request.maxDiffBytes + 100_000);
      const diffBytes = Buffer.byteLength(finalDiff, 'utf8');
      if (diffBytes < 1 || diffBytes > request.maxDiffBytes) {
        throw new ContributionError('PR_UNAVAILABLE', 'Final isolated diff is empty or unbounded', {
          fallback: 'submit_issue',
        });
      }
      const diffSummaryOutput = await this.gitIn(workspacePath, [
        'diff',
        '--cached',
        '--stat',
        '--summary',
        request.baseSha,
      ], 100_000);
      const diffSummary = boundedMessage(diffSummaryOutput)
        || `${changedPaths.length} reviewed file${changedPaths.length === 1 ? '' : 's'} changed`;
      await this.gitIn(workspacePath, [
        '-c',
        'user.name=LLM Wiki Contribution',
        '-c',
        'user.email=contribution@localhost.invalid',
        'commit',
        '--no-gpg-sign',
        '-m',
        request.changeSummary,
      ], 500_000);
      const headSha = (await this.gitIn(workspacePath, ['rev-parse', 'HEAD'], 100_000)).trim();
      if (!COMMIT_RE.test(headSha) || headSha === request.baseSha) {
        throw new ContributionError('PR_UNAVAILABLE', 'Isolated contribution commit is invalid', {
          fallback: 'submit_issue',
        });
      }
      const diffDigest = sha256(finalDiff);
      const artifactDigest = fingerprint({
        repositoryMappingFingerprint: request.repository.mappingFingerprint,
        baseRef: request.baseRef,
        baseSha: request.baseSha,
        headRef: request.headRef,
        headSha,
        changedPaths,
        diffDigest,
        diffBytes,
      });
      const record: LocalArtifactRecord = {
        ...provisional,
        artifactDigest,
        headSha,
      };
      this.artifacts.set(record.artifactId, record);
      return {
        artifactId: record.artifactId,
        artifactDigest,
        isolation: 'isolated',
        baseRef: request.baseRef,
        baseSha: request.baseSha,
        headRef: request.headRef,
        headSha,
        changedFiles: changedPaths.map((path) => ({
          path,
          generated: this.generatedPathMatcher(path),
        })),
        diffSummary,
        diffDigest,
        diffBytes,
      };
    } catch (error) {
      await this.discardRecord(provisional);
      throw error;
    }
  }

  private artifact(artifactId: string, artifactDigest: Sha256Digest): LocalArtifactRecord {
    assertSha256(artifactDigest, 'artifactDigest');
    const record = this.artifacts.get(artifactId);
    if (!record || record.artifactDigest !== artifactDigest) {
      throw new ContributionError('STALE_PLAN', 'Contribution artifact is missing or changed');
    }
    return record;
  }

  async verify(request: {
    artifactId: string;
    artifactDigest: Sha256Digest;
    commands: string[];
  }): Promise<RegressionTestEvidence[]> {
    const record = this.artifact(request.artifactId, request.artifactDigest);
    if (!request.commands.length) {
      await this.discardRecord(record);
      throw new ContributionError('PR_UNAVAILABLE', 'At least one regression test is required', {
        fallback: 'submit_issue',
      });
    }
    const sourceModules = join(this.sourcePath, 'node_modules');
    const workspaceModules = join(record.workspacePath, 'node_modules');
    if (
      this.linkNodeModules
      && existsSync(sourceModules)
      && !existsSync(workspaceModules)
    ) {
      symlinkSync(
        sourceModules,
        workspaceModules,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    const evidence: RegressionTestEvidence[] = [];
    try {
      for (const command of request.commands) {
        const argv = this.commandPolicy.parse(command);
        const result = await this.exec.run({
          file: argv[0]!,
          args: argv.slice(1),
          cwd: record.workspacePath,
          env: testEnvironment(record.workspacePath, this.sourcePath),
          timeoutMs: this.testTimeoutMs,
          maxBufferBytes: this.maxTestOutputBytes,
        });
        const output = `${result.stdout}\n${result.stderr}`;
        const outputBytes = Buffer.byteLength(output, 'utf8');
        const passed = result.exitCode === 0 && outputBytes <= this.maxTestOutputBytes;
        evidence.push({
          command,
          status: passed ? 'passed' : 'failed',
          exitCode: result.exitCode,
          outputDigest: sha256(output),
          summary: `${passed ? 'passed' : 'failed'}: ${basename(argv[0]!)} ${argv[1] ?? ''}; ${outputBytes} output bytes`,
        });
        if (!passed) break;
      }
      if (evidence.length !== request.commands.length || evidence.some((test) => test.status === 'failed')) {
        await this.discardRecord(record);
      } else {
        record.verified = true;
      }
      return evidence;
    } catch (error) {
      await this.discardRecord(record);
      throw error;
    }
  }

  async resolve(request: {
    artifactId: string;
    artifactDigest: Sha256Digest;
  }): Promise<ContributionArtifactWorkspace> {
    const record = this.artifact(request.artifactId, request.artifactDigest);
    if (!record.verified || !existsSync(record.workspacePath)) {
      throw new ContributionError('STALE_PLAN', 'Contribution artifact is not verified or no longer available');
    }
    const headSha = (await this.gitIn(record.workspacePath, ['rev-parse', 'HEAD'], 100_000)).trim();
    if (headSha !== record.headSha) {
      throw new ContributionError('STALE_PLAN', 'Contribution artifact head changed after verification');
    }
    return { cwd: record.workspacePath, headSha };
  }

  async release(request: {
    artifactId: string;
    artifactDigest: Sha256Digest;
  }): Promise<void> {
    const record = this.artifact(request.artifactId, request.artifactDigest);
    await this.discardRecord(record);
  }

  async dispose(): Promise<void> {
    for (const record of [...this.artifacts.values()]) {
      await this.discardRecord(record);
    }
  }
}

/**
 * Production seam for problem_mcp_obc: pass the already-resolved Project
 * workspace binding and selected repository mapping fingerprint. All returned
 * ports share one fail-closed local artifact registry.
 */
export function createLocalContributionProductionPorts(
  options: LocalContributionProductionOptions,
): LocalContributionProductionPorts {
  const runtime = new LocalContributionArtifactRuntime(options);
  return {
    worktree: runtime,
    verifier: runtime,
    artifacts: runtime,
    dispose: () => runtime.dispose(),
  };
}

/**
 * Convenience production seam when GitHub CLI is the selected transport.
 * Construction performs no network or provider mutation.
 */
export function createLocalGhCliContributionProductionPorts(
  options: LocalGhCliContributionProductionOptions,
): LocalGhCliContributionProductionPorts {
  const exec = options.exec ?? new NodeExecFilePort();
  const runtime = new LocalContributionArtifactRuntime({ ...options, exec });
  return {
    worktree: runtime,
    verifier: runtime,
    artifacts: runtime,
    transport: new GhCliContributionTransport(exec, runtime, options.gh),
    dispose: () => runtime.dispose(),
  };
}
