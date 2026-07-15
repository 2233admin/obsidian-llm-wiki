import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { HostCapabilityConnectorRegistration } from './operation-contracts.js';
import type { HostCapabilityConnectorRuntime } from './registry.js';
import type { HostCapabilityTransportFactory } from './operations.js';

export interface DefaultHostCapabilityTransportOptions {
  environment?: NodeJS.ProcessEnv;
  secretResolver?: (reference: NonNullable<HostCapabilityConnectorRegistration['configuration']['secretReference']>) => Promise<string | undefined>;
}

export type DefaultHostTransportConfiguration =
  | {
      transport: 'stdio';
      command: string;
      args: string[];
      credentialVariable: string;
    }
  | {
      transport: 'http';
      endpoint: string;
    };

function parametersOf(registration: HostCapabilityConnectorRegistration): Record<string, unknown> {
  return registration.configuration.parameters ?? {};
}

function stringParameter(parameters: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = parameters[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || /[\r\n\0]/.test(value)) {
    throw new Error(`Host Capability transport parameter ${key} must be a non-empty safe string`);
  }
  return value;
}

function stringArrayParameter(parameters: Record<string, unknown>, key: string): string[] {
  const value = parameters[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || /[\r\n\0]/.test(item))) {
    throw new Error(`Host Capability transport parameter ${key} must be an array of safe strings`);
  }
  return [...value] as string[];
}

function assertOnly(parameters: Record<string, unknown>, allowed: string[]): void {
  const names = new Set(allowed);
  const unsupported = Object.keys(parameters).filter((key) => !names.has(key)).sort();
  if (unsupported.length > 0) throw new Error(`Unsupported Host Capability transport parameters: ${unsupported.join(', ')}`);
}

const SETTINGS_METADATA_PARAMETERS = ['provider', 'connectorId', 'timeoutMs', 'settingsSnapshotId', 'settingsProvenance'];

function httpEndpoint(value: string): string {
  const url = new URL(value);
  if (url.username || url.password) throw new Error('Host Capability HTTP endpoint must not embed credentials');
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '::1']).has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Host Capability HTTP endpoint must use HTTPS unless it is loopback');
  }
  return url.toString();
}

export function parseDefaultHostTransport(
  registration: HostCapabilityConnectorRegistration,
): DefaultHostTransportConfiguration {
  const parameters = parametersOf(registration);
  if (registration.connector.transport === 'stdio') {
    assertOnly(parameters, ['command', 'args', 'credentialVariable', ...SETTINGS_METADATA_PARAMETERS]);
    const command = stringParameter(parameters, 'command', true)!;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(command)) {
      throw new Error('Host Capability stdio command must be an executable name, not a path or shell expression');
    }
    const credentialVariable = stringParameter(parameters, 'credentialVariable') ?? 'LLMWIKI_HOST_SECRET';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(credentialVariable)) {
      throw new Error('Host Capability credentialVariable must be an environment variable name');
    }
    return {
      transport: 'stdio',
      command,
      args: stringArrayParameter(parameters, 'args'),
      credentialVariable,
    };
  }
  if (registration.connector.transport === 'http') {
    assertOnly(parameters, ['endpoint', ...SETTINGS_METADATA_PARAMETERS]);
    return {
      transport: 'http',
      endpoint: httpEndpoint(stringParameter(parameters, 'endpoint', true)!),
    };
  }
  throw new Error(`Connector transport ${registration.connector.transport} requires an explicitly injected in-process factory`);
}

export async function resolveHostCapabilitySecret(
  registration: HostCapabilityConnectorRegistration,
  options: DefaultHostCapabilityTransportOptions = {},
): Promise<string | undefined> {
  const reference = registration.configuration.secretReference;
  if (!reference) {
    if (registration.configuration.secretRequired) throw new Error('Required Host Capability Secret Reference is not configured');
    return undefined;
  }
  let secret: string | undefined;
  if (options.secretResolver) secret = await options.secretResolver(reference);
  else if (reference.provider === 'environment') secret = (options.environment ?? process.env)[reference.locator];
  else throw new Error(`Secret Reference provider ${reference.provider} requires a device-local resolver`);
  if (typeof secret !== 'string' || !secret.length) throw new Error('Host Capability Secret Reference is not resolvable on this device');
  return secret;
}

function invocationArguments(request: Parameters<HostCapabilityConnectorRuntime['invoke']>[0]): Record<string, unknown> {
  if (request.input === undefined) return {};
  if (request.input && typeof request.input === 'object' && !Array.isArray(request.input)) {
    return structuredClone(request.input as Record<string, unknown>);
  }
  return { input: structuredClone(request.input) };
}

async function connectRuntime(transport: Transport): Promise<HostCapabilityConnectorRuntime> {
  const client = new Client({ name: 'llmwiki-host-capability-proxy', version: '1.0.0' });
  await client.connect(transport);
  return {
    async invoke(request) {
      return client.callTool({
        name: request.operation,
        arguments: invocationArguments(request),
      });
    },
    async close() {
      await client.close();
    },
  };
}

export function createDefaultHostCapabilityTransportFactory(
  options: DefaultHostCapabilityTransportOptions = {},
): HostCapabilityTransportFactory {
  return async (registration) => {
    const configuration = parseDefaultHostTransport(registration);
    const secret = await resolveHostCapabilitySecret(registration, options);
    if (configuration.transport === 'stdio') {
      const environment = getDefaultEnvironment();
      if (secret) environment[configuration.credentialVariable] = secret;
      return connectRuntime(new StdioClientTransport({
        command: configuration.command,
        args: configuration.args,
        env: environment,
        stderr: 'pipe',
      }));
    }
    return connectRuntime(new StreamableHTTPClientTransport(new URL(configuration.endpoint), {
      requestInit: secret ? { headers: { Authorization: `Bearer ${secret}` } } : undefined,
    }));
  };
}
