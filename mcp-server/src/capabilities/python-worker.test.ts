import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PYTHON_WORKER_DIAGNOSTICS,
  PythonWorker,
  runPythonWorker,
} from "./python-worker.js";

const node = process.execPath;

function request(args: readonly string[], overrides: Partial<Parameters<PythonWorker["run"]>[0]> = {}) {
  return {
    capabilityId: "test-python-worker",
    executable: node,
    args,
    timeoutMs: 5_000,
    environment: { ...process.env },
    ...overrides,
  };
}

describe("PythonWorker", () => {
  test("returns stdout and stderr for successful execution", async () => {
    const result = await runPythonWorker(request(["-e", "process.stdout.write('ok'); process.stderr.write('warning')"]));
    assert.equal(result.ok, true);
    assert.equal(result.stdout, "ok");
    assert.equal(result.stderr, "warning");
    assert.equal(result.timedOut, false);
    assert.equal(result.diagnosticCode, undefined);
  });

  test("classifies a missing executable", async () => {
    const result = await runPythonWorker(request([], { executable: "llmwiki-python-executable-that-does-not-exist" }));
    assert.equal(result.ok, false);
    assert.equal(result.diagnosticCode, PYTHON_WORKER_DIAGNOSTICS.executableNotFound);
    assert.equal(result.timedOut, false);
  });

  test("classifies a non-zero worker exit without hiding captured output", async () => {
    const result = await runPythonWorker(request([
      "-e",
      "process.stdout.write('partial'); process.stderr.write('failed'); process.exitCode = 7",
    ]));
    assert.equal(result.ok, false);
    assert.equal(result.stdout, "partial");
    assert.equal(result.stderr, "failed");
    assert.equal(result.exitCode, 7);
    assert.equal(result.diagnosticCode, PYTHON_WORKER_DIAGNOSTICS.nonZeroExit);
  });

  test("classifies a timeout and terminates the child", async () => {
    const result = await runPythonWorker(request(["-e", "setTimeout(() => {}, 10_000)"], { timeoutMs: 20 }));
    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.equal(result.diagnosticCode, PYTHON_WORKER_DIAGNOSTICS.timedOut);
  });

  test("classifies caller cancellation", async () => {
    const worker = new PythonWorker();
    const pending = worker.run(request(["-e", "setTimeout(() => {}, 10_000)"]));
    // run() installs the active process synchronously, so aborting immediately
    // exercises the cancellation boundary without a guessed sleep.
    const attempt = worker.abort();
    assert.equal(attempt.ok, true);
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.timedOut, false);
    assert.equal(result.diagnosticCode, PYTHON_WORKER_DIAGNOSTICS.canceled);
  });

  test("redacts environment values from stderr", async () => {
    const secret = "worker-boundary-secret-value";
    const result = await runPythonWorker(request(
      ["-e", "process.stderr.write(process.env.WORKER_SECRET)"],
      { environment: { ...process.env, WORKER_SECRET: secret } },
    ));
    assert.equal(result.ok, true);
    assert.equal(result.stderr, "[redacted]");
    assert.doesNotMatch(result.stderr, new RegExp(secret));
  });

  test("passes Windows-style paths as one argument without shell interpretation", async () => {
    const root = mkdtempSync(join(tmpdir(), "python-worker path "));
    const pathWithSpaces = join(root, "worker input \\ nested.txt");
    mkdirSync(join(root, "worker input \\ nested.txt"), { recursive: true });
    try {
      const result = await runPythonWorker(request(
        ["-e", "process.stdout.write(process.argv[1])", pathWithSpaces],
        { cwd: root },
      ));
      assert.equal(result.ok, true);
      assert.equal(result.stdout, pathWithSpaces);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("executes Windows .cmd and .bat wrappers with metacharacter-safe arguments", async () => {
    if (process.platform !== "win32") return;
    const root = mkdtempSync(join(tmpdir(), "python-worker-wrapper "));
    const argument = join(root, "safe path & value.txt");
    try {
      for (const extension of ["cmd", "bat"]) {
        const wrapper = join(root, `python wrapper.${extension}`);
        writeFileSync(wrapper, "@echo off\r\necho [%~1]\r\n", "utf8");
        const result = await runPythonWorker(request([argument], { executable: wrapper, cwd: root }));
        assert.equal(result.ok, true, result.stderr);
        assert.equal(result.stdout.trim(), `[${argument}]`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
