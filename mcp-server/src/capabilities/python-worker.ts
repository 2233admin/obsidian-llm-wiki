import { execFile, type ChildProcess } from "node:child_process";

export interface PythonWorkerRequest {
  capabilityId: string;
  executable: string;
  args: readonly string[];
  cwd?: string;
  timeoutMs: number;
  environment: NodeJS.ProcessEnv;
  /** Maximum per-stream stdout/stderr buffer accepted from the worker. */
  maxBuffer?: number;
  /** Optional JSON/text payload for workers that read stdin. */
  stdin?: string;
  /** Optional caller-owned cancellation signal. */
  signal?: AbortSignal;
}

export interface PythonWorkerResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode?: number;
  timedOut: boolean;
  diagnosticCode?: string;
}

export interface PythonWorkerCancelAttempt {
  ok: boolean;
  message: string;
  confirmed: boolean;
}

export const PYTHON_WORKER_DIAGNOSTICS = {
  busy: "PYTHON_WORKER_BUSY",
  canceled: "PYTHON_WORKER_CANCELED",
  executableNotFound: "PYTHON_WORKER_EXECUTABLE_NOT_FOUND",
  invalidOutput: "PYTHON_WORKER_INVALID_OUTPUT",
  outputLimit: "PYTHON_WORKER_OUTPUT_LIMIT",
  scriptNotFound: "PYTHON_WORKER_SCRIPT_NOT_FOUND",
  spawnFailed: "PYTHON_WORKER_SPAWN_FAILED",
  timedOut: "PYTHON_WORKER_TIMEOUT",
  nonZeroExit: "PYTHON_WORKER_NON_ZERO_EXIT",
} as const;

const MAX_BUFFER = 10 * 1024 * 1024;

type ActiveProcess = {
  child: ChildProcess;
  cancelRequested: boolean;
};

/** Owns one Python child process and classifies its lifecycle at one boundary. */
export class PythonWorker {
  private activeProcess?: ActiveProcess;

  run(request: PythonWorkerRequest): Promise<PythonWorkerResult> {
    if (this.activeProcess) {
      return Promise.resolve({
        ok: false,
        stdout: "",
        stderr: "",
        timedOut: false,
        diagnosticCode: PYTHON_WORKER_DIAGNOSTICS.busy,
      });
    }

    return new Promise<PythonWorkerResult>((resolve) => {
      let timedOut = false;
      let settled = false;
      let timeout: NodeJS.Timeout | undefined;
      let removeAbortListener: (() => void) | undefined;

      const finish = (result: PythonWorkerResult): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        removeAbortListener?.();
        this.activeProcess = undefined;
        resolve(result);
      };
      const wrapper = isWindowsCommandWrapper(request.executable);
      const command = wrapper
        ? process.env.ComSpec ?? process.env.COMSPEC ?? "cmd.exe"
        : request.executable;
      const childArgs = wrapper
        ? ["/d", "/s", "/c", `"${[request.executable, ...request.args].map(quoteWindowsCommandArgument).join(" ")}"`]
        : [...request.args];
      const child = execFile(
        command,
        childArgs,
        {
          cwd: request.cwd,
          env: { ...request.environment },
          encoding: "utf8",
          maxBuffer: request.maxBuffer ?? MAX_BUFFER,
          windowsHide: true,
          ...(wrapper ? { windowsVerbatimArguments: true } : {}),
        },
        (error, stdout, stderr) => {
          const active = this.activeProcess;
          const cancelRequested = active?.child === child && active.cancelRequested;
          const stdoutText = String(stdout ?? "");
          const stderrText = redactEnvironment(String(stderr ?? ""), request.environment);
          const exitCode = typeof child.exitCode === "number"
            ? child.exitCode
            : typeof error?.code === "number" ? error.code : undefined;

          finish({
            ok: !error && !timedOut && !cancelRequested,
            stdout: stdoutText,
            stderr: stderrText,
            ...(exitCode === undefined ? {} : { exitCode }),
            timedOut,
            ...(error || timedOut || cancelRequested
              ? { diagnosticCode: classifyFailure(error, stderrText, timedOut, cancelRequested) }
              : {}),
          });
        },
      );

      this.activeProcess = { child, cancelRequested: false };

      if (request.timeoutMs > 0) {
        timeout = setTimeout(() => {
          if (settled) return;
          timedOut = true;
          child.kill();
        }, request.timeoutMs);
        timeout.unref?.();
      }

      if (request.signal) {
        const abort = (): void => {
          if (settled) return;
          if (this.activeProcess?.child !== child) return;
          this.activeProcess.cancelRequested = true;
          child.kill();
        };
        if (request.signal.aborted) abort();
        else {
          request.signal.addEventListener("abort", abort, { once: true });
          removeAbortListener = () => request.signal?.removeEventListener("abort", abort);
        }
      }

      try {
        if (request.stdin !== undefined) child.stdin?.end(request.stdin);
      } catch (error) {
        const stderr = redactEnvironment(error instanceof Error ? error.message : String(error), request.environment);
        child.kill();
        finish({
          ok: false,
          stdout: "",
          stderr,
          timedOut: false,
          diagnosticCode: PYTHON_WORKER_DIAGNOSTICS.spawnFailed,
        });
      }
    });
  }

  abort(): PythonWorkerCancelAttempt {
    if (!this.activeProcess) {
      return { ok: false, message: "No Python worker is running", confirmed: false };
    }
    const accepted = this.activeProcess.child.kill();
    if (accepted) this.activeProcess.cancelRequested = true;
    return {
      ok: accepted,
      message: accepted
        ? "Python worker termination requested"
        : "Python worker termination was not accepted",
      confirmed: false,
    };
  }
}
function isWindowsCommandWrapper(executable: string): boolean {
  return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(executable);
}

function quoteWindowsCommandArgument(value: string): string {
  // cmd.exe receives one /c command string. Escape metacharacters inside
  // quoted tokens so worker arguments cannot become shell syntax.
  return `"${value.replace(/(["^&|<>()%!])/g, "^$1")}"`;
}

/** Convenience entrypoint for callers without a long-lived cancellation owner. */
export function runPythonWorker(request: PythonWorkerRequest): Promise<PythonWorkerResult> {
  return new PythonWorker().run(request);
}

type WorkerError = (Error & { code?: string | number }) | null;

function classifyFailure(
  error: WorkerError,
  stderr: string,
  timedOut: boolean,
  cancelRequested: boolean,
): string {
  if (timedOut) return PYTHON_WORKER_DIAGNOSTICS.timedOut;
  if (cancelRequested || error?.name === "AbortError") return PYTHON_WORKER_DIAGNOSTICS.canceled;
  if (error?.code === "ENOENT") return PYTHON_WORKER_DIAGNOSTICS.executableNotFound;
  if (error?.code === "EACCES") return PYTHON_WORKER_DIAGNOSTICS.spawnFailed;
  if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return PYTHON_WORKER_DIAGNOSTICS.outputLimit;
  if (/can't open file|no such file or directory|cannot find the path/i.test(stderr)) {
    return PYTHON_WORKER_DIAGNOSTICS.scriptNotFound;
  }
  return typeof error?.code === "number" || error ? PYTHON_WORKER_DIAGNOSTICS.nonZeroExit : PYTHON_WORKER_DIAGNOSTICS.spawnFailed;
}

function redactEnvironment(text: string, environment: NodeJS.ProcessEnv): string {
  let redacted = text;
  const values = Object.values(environment)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const value of values) redacted = redacted.split(value).join("[redacted]");
  return redacted;
}
