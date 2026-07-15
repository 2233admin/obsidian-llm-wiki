import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { HostCapabilityConnectorRegistration } from './operation-contracts.js';
import {
  createDefaultHostCapabilityTransportFactory,
  parseDefaultHostTransport,
  resolveHostCapabilitySecret,
} from './transport.js';
import { connector, health } from './test-fixtures.js';

function registration(
  transport: 'stdio' | 'http' | 'mock' | 'in-process',
  parameters: Record<string, unknown>,
  secretReference?: { provider: 'environment' | 'os-keychain' | 'external-vault'; locator: string },
): HostCapabilityConnectorRegistration {
  return {
    schemaVersion: 1,
    connector: connector({ transport }),
    health: health(),
    configuration: {
      parameters,
      secretRequired: Boolean(secretReference),
      ...(secretReference ? { secretReference } : {}),
    },
  };
}

describe('default Host Capability transports', () => {
  test('invokes an MCP tool over a lazy no-shell stdio subprocess', async () => {
    const configured = registration('stdio', {
      command: 'node',
      args: ['./src/host-capabilities/test-mcp-server.mjs'],
    });
    const runtime = await createDefaultHostCapabilityTransportFactory({ environment: {} })(configured);
    try {
      const result = await runtime.invoke({
        projectId: 'project/alpha',
        workRunId: 'work-run/child',
        descriptorId: 'expert/test',
        descriptorVersion: '1.0.0',
        operation: 'echo',
        input: { value: 'ok' },
      }) as Record<string, unknown>;
      assert.deepEqual(result.structuredContent, { value: 'ok' });
    } finally {
      await runtime.close?.();
    }
  });

  test('parses HTTPS and loopback HTTP but rejects remote plaintext HTTP and command paths', () => {
    assert.deepEqual(parseDefaultHostTransport(registration('http', { endpoint: 'https://agents.example.test/mcp' })), {
      transport: 'http',
      endpoint: 'https://agents.example.test/mcp',
    });
    assert.equal(parseDefaultHostTransport(registration('http', { endpoint: 'http://127.0.0.1:8123/mcp' })).transport, 'http');
    assert.throws(() => parseDefaultHostTransport(registration('http', { endpoint: 'http://agents.example.test/mcp' })), /HTTPS/);
    assert.throws(() => parseDefaultHostTransport(registration('stdio', { command: 'C:\\tools\\agent.exe' })), /executable name/);
  });

  test('resolves an HTTP/OAuth bearer Secret Reference at connection time and fails closed for unavailable providers', async () => {
    const configured = registration('http', { endpoint: 'https://agents.example.test/mcp' }, {
      provider: 'environment',
      locator: 'HOST_TOKEN',
    });
    assert.equal(await resolveHostCapabilitySecret(configured, { environment: { HOST_TOKEN: 'device-only-value' } }), 'device-only-value');
    assert.equal(JSON.stringify(configured).includes('device-only-value'), false);
    await assert.rejects(
      () => resolveHostCapabilitySecret({
        ...configured,
        configuration: {
          ...configured.configuration,
          secretReference: { provider: 'os-keychain', locator: 'llmwiki/host/token' },
        },
      }),
      /device-local resolver/,
    );
  });
});
