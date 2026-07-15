import {
  bundledRegistry,
  defaultUserDeviceId,
  SettingsService,
} from "../../packages/settings-platform/dist/src/index.js";
import type {
  MutableSettingsScope,
  SecretReference,
  SettingValue,
} from "../../packages/settings-platform/src/types";
import type { SettingsOperationTransport } from "./settings-client";

export function obsidianUserDeviceId(environment: NodeJS.ProcessEnv = process.env): string {
  return defaultUserDeviceId(environment);
}

/** Real, in-process Obsidian host adapter over the authoritative service. */
export class InProcessSettingsTransport implements SettingsOperationTransport {
  readonly service: SettingsService;

  constructor(options: {
    vaultPath: string;
    userDeviceId: string;
    userDevicePath?: string;
    workspaceProjectId?: string;
    pythonPath?: string;
    compilerPath?: string;
    environment?: NodeJS.ProcessEnv;
    service?: SettingsService;
  }) {
    this.service = options.service ?? new SettingsService({
      registry: bundledRegistry(),
      vaultPath: options.vaultPath,
      userDeviceId: options.userDeviceId,
      userDevicePath: options.userDevicePath,
      workspaceProjectId: options.workspaceProjectId,
      pythonPath: options.pythonPath,
      compilerPath: options.compilerPath,
      environment: options.environment,
    });
  }

  async invoke<T>(operation: string, args: Record<string, unknown>): Promise<T> {
    switch (operation) {
      case "settings.definitions.list":
        return this.service.definitionsList() as T;
      case "settings.snapshot.resolve":
        return this.service.snapshotResolve() as Promise<T>;
      case "settings.scopes.get":
        return this.service.scopesGet(this.scope(args.scope)) as Promise<T>;
      case "settings.validate":
        return this.service.validate() as Promise<T>;
      case "settings.doctor":
        return this.service.doctor() as Promise<T>;
      case "settings.assignment.set":
        return this.service.assignmentSet({
          scope: this.scope(args.scope),
          key: this.string(args.key, "key"),
          value: args.value as SettingValue | SecretReference,
          expectedRevision: this.revision(args.expectedRevision),
          updatedBy: this.optionalString(args.updatedBy) ?? "obsidian-control-plane",
          reason: this.optionalString(args.reason),
          expiresAt: this.optionalString(args.expiresAt),
        }) as Promise<T>;
      case "settings.assignment.unset":
        return this.service.assignmentUnset({
          scope: this.scope(args.scope),
          key: this.string(args.key, "key"),
          expectedRevision: this.revision(args.expectedRevision),
          updatedBy: this.optionalString(args.updatedBy) ?? "obsidian-control-plane",
          reason: this.optionalString(args.reason),
        }) as Promise<T>;
      default:
        throw new Error(`Unsupported Settings Platform operation: ${operation}`);
    }
  }

  private scope(value: unknown): MutableSettingsScope {
    const scopes: MutableSettingsScope[] = ["user-device", "vault", "workspace-project", "session"];
    if (typeof value !== "string" || !scopes.includes(value as MutableSettingsScope)) {
      throw new Error(`Invalid mutable settings scope: ${String(value)}`);
    }
    return value as MutableSettingsScope;
  }

  private revision(value: unknown): number {
    if (!Number.isInteger(value) || (value as number) < 0) throw new Error("expectedRevision must be a non-negative integer");
    return value as number;
  }

  private string(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string`);
    return value.trim();
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }
}
