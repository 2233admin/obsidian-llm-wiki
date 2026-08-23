import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Resolve repository-owned runtime assets without relying on import.meta.url.
 * The application is also bundled into Obsidian's CJS plugin, where
 * import.meta.url is not a safe production path source.
 */
export function resolveProjectRoot(environment: NodeJS.ProcessEnv = process.env): string {
  const entryDirectory = process.argv[1] ? dirname(resolve(process.argv[1])) : undefined;
  const configured = environment.LLMWIKI_PROJECT_ROOT?.trim();
  const candidates = [
    ...(configured ? [resolve(configured)] : []),
    resolve(process.cwd()),
    resolve(process.cwd(), '..'),
    resolve(process.cwd(), '..', '..'),
    ...(entryDirectory
      ? [entryDirectory, resolve(entryDirectory, '..'), resolve(entryDirectory, '..', '..')]
      : []),
  ];
  const unique = [...new Set(candidates)];
  return unique.find((candidate) =>
    existsSync(join(candidate, 'compiler')) && existsSync(join(candidate, 'recipes')),
  ) ?? unique[0] ?? resolve(process.cwd());
}

export function resolveProjectAsset(
  relativePath: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return join(resolveProjectRoot(environment), relativePath);
}
