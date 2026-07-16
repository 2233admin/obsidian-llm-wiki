export interface ExecutableCommand {
  executable: string;
  args: string[];
}

/**
 * Parses a user-configured executable plus fixed argv without invoking a shell.
 * Supports Windows quoted paths, escaped quotes, UNC/device paths, and `py -3`.
 */
export function parseExecutableCommand(input: string): ExecutableCommand {
  const source = input.trim();
  if (!source) throw new Error("Executable command is empty");
  const args: string[] = [];
  let token = "";
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (character === "\\" && quote !== "'") {
      const escapesNextQuote = next === '"';
      if (escapesNextQuote) {
        token += next;
        index += 1;
      } else {
        token += character;
      }
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (token) {
        args.push(token);
        token = "";
      }
      continue;
    }
    token += character;
  }
  if (quote) throw new Error("Executable command contains an unterminated quote");
  if (token) args.push(token);
  if (!args.length) throw new Error("Executable command is empty");
  assertNotShellWrapper(args[0]);
  return { executable: args[0], args: args.slice(1) };
}

const SHELL_WRAPPER_EXTENSIONS = [".bat", ".cmd", ".ps1"];

// The configured interpreter must be a real executable. Batch/PowerShell
// wrappers re-enter cmd.exe/powershell parsing and would reintroduce the
// shell-composition attack surface that shell-less execFile excludes.
function assertNotShellWrapper(executable: string): void {
  const basename = executable.split(/[\\/]/).pop() ?? executable;
  const lower = basename.toLowerCase();
  if (SHELL_WRAPPER_EXTENSIONS.some(extension => lower.endsWith(extension))) {
    throw new Error(`Shell wrapper executables are not allowed as the runtime interpreter: ${basename}`);
  }
}

export function buildPythonInvocation(command: string, args: string[]): ExecutableCommand {
  const parsed = parseExecutableCommand(command);
  return { executable: parsed.executable, args: [...parsed.args, ...args] };
}
