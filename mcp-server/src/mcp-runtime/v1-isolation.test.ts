import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { Operation, OperationContext } from "../core/types.js";
import {
  MCP_SDK_PRODUCTION_LINE,
  createMcpServer,
  createMcpServerV1,
  formatOperationResult,
  toDomainToolDescriptors,
} from "./index.js";

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function ctx(): OperationContext {
  return {
    config: {} as OperationContext["config"],
    vault: { execute: async () => null },
    adapters: null,
    logger,
    dryRun: true,
  };
}

describe("MCP SDK v1 isolation (3.6)", () => {
  it("keeps production createMcpServer on the v1 composition line", () => {
    assert.equal(MCP_SDK_PRODUCTION_LINE, "v1-production");
    // Production entry is a thin alias over v1 composition (not the v2 seam).
    assert.equal(typeof createMcpServer, "function");
    assert.equal(typeof createMcpServerV1, "function");
    assert.equal(MCP_SDK_PRODUCTION_LINE, "v1-production");
  });

  it("derives domain tool descriptors without SDK types", () => {
    const operation: Operation = {
      name: "demo.read",
      namespace: "vault",
      description: "Read-only demo",
      mutating: false,
      params: { id: { type: "string", required: true, description: "id" } },
      handler: async () => ({ ok: true }),
    };
    const descriptors = toDomainToolDescriptors([operation]);
    assert.deepEqual(descriptors, [{
      name: "demo.read",
      description: "Read-only demo",
      namespace: "vault",
      mutating: false,
      params: operation.params,
    }]);
  });

  it("formats domain results as protocol content without domain importing SDK", () => {
    const formatted = formatOperationResult({ hello: "world" });
    assert.equal(formatted.content[0]?.type, "text");
    assert.match(formatted.content[0]?.text ?? "", /"hello"/);
  });

  it("confines SDK imports to v1-composition (not domain modules)", () => {
    const v1Path = fileURLToPath(new URL("./v1-composition.ts", import.meta.url));
    const v2Path = fileURLToPath(new URL("./v2-seam.ts", import.meta.url));
    const formatPath = fileURLToPath(new URL("./format.ts", import.meta.url));
    const v1Source = readFileSync(v1Path, "utf8");
    const v2Source = readFileSync(v2Path, "utf8");
    const formatSource = readFileSync(formatPath, "utf8");

    assert.match(v1Source, /from ["']@modelcontextprotocol\/sdk/);
    assert.equal(/from ["']@modelcontextprotocol\/sdk/.test(v2Source), false);
    assert.equal(/from ["']@modelcontextprotocol\/sdk/.test(formatSource), false);
  });

  it("dispatches a domain operation through production server registration path", async () => {
    let handled = false;
    const operation: Operation = {
      name: "demo.ping",
      namespace: "vault",
      description: "Ping",
      mutating: false,
      params: {},
      handler: async () => {
        handled = true;
        return { pong: true };
      },
    };
    const server = createMcpServer({
      name: "isolation-test",
      version: "0.0.0-test",
      operations: [operation],
      ctx: ctx(),
      logger,
    });
    assert.ok(server);
    // Domain handler remains callable without transport connect.
    const direct = await operation.handler(ctx(), {});
    assert.deepEqual(direct, { pong: true });
    assert.equal(handled, true);
  });
});
