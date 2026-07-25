import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { Operation, OperationContext } from "../core/types.js";
import {
  MCP_SDK_PRODUCTION_LINE,
  MCP_SDK_PRODUCTION_PACKAGE,
  MCP_SDK_V2_PACKAGE_SPLIT,
  MCP_SDK_V2_SEAM_LINE,
  assertV2SeamIsNonProduction,
  createMcpV2SeamServerDescriptor,
  describeV2PackageSplit,
  invokeDomainToolThroughV2Seam,
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

function echoOperation(): Operation {
  return {
    name: "ping.echo",
    namespace: "vault",
    description: "Echo a value",
    mutating: false,
    params: {
      message: { type: "string", required: true, description: "Message" },
    },
    handler: async (_ctx, params) => ({ echo: params.message }),
  };
}

describe("MCP SDK v2 seam (3.6, non-production)", () => {
  it("loads golden fixtures without adopting v2 as production", () => {
    const fixtures = JSON.parse(
      readFileSync(new URL("./fixtures/v2-seam-cases.json", import.meta.url), "utf8"),
    ) as {
      line: string;
      productionDependency: string;
      productionLine: string;
      cases: Array<Record<string, unknown>>;
    };

    assert.equal(fixtures.line, MCP_SDK_V2_SEAM_LINE);
    assert.equal(fixtures.productionLine, MCP_SDK_PRODUCTION_LINE);
    assert.equal(fixtures.productionDependency, MCP_SDK_PRODUCTION_PACKAGE);
    assert.notEqual(fixtures.line, MCP_SDK_PRODUCTION_LINE);
  });

  it("builds a non-production server descriptor from domain operations", () => {
    const descriptor = createMcpV2SeamServerDescriptor("test", "0.0.0-test", [echoOperation()]);
    assertV2SeamIsNonProduction(descriptor);
    assert.equal(descriptor.line, MCP_SDK_V2_SEAM_LINE);
    assert.deepEqual(descriptor.tools.map((tool) => tool.name), ["ping.echo"]);
    assert.equal(descriptor.tools[0]?.mutating, false);
  });

  it("invokes domain handlers through the v2 seam without SDK transport", async () => {
    const ops = [echoOperation()];
    const success = await invokeDomainToolThroughV2Seam(ops, ctx(), {
      toolName: "ping.echo",
      arguments: { message: "hello-v2-seam" },
    });
    assert.equal(success.line, MCP_SDK_V2_SEAM_LINE);
    assert.equal(success.response.isError, undefined);
    assert.match(success.response.content[0]?.text ?? "", /hello-v2-seam/);

    const missing = await invokeDomainToolThroughV2Seam(ops, ctx(), {
      toolName: "missing.tool",
      arguments: {},
    });
    assert.equal(missing.response.isError, true);
    assert.match(missing.response.content[0]?.text ?? "", /Unknown tool/);
  });

  it("documents package split while keeping production on v1", () => {
    const split = describeV2PackageSplit();
    assert.equal(split.productionRemains, "@modelcontextprotocol/sdk (v1)");
    assert.equal(split.seamPackages.server, MCP_SDK_V2_PACKAGE_SPLIT.server);
    assert.equal(split.seamPackages.client, MCP_SDK_V2_PACKAGE_SPLIT.client);
    assert.match(split.adoptionGate, /separate approved change/i);
    assert.equal(MCP_SDK_PRODUCTION_LINE, "v1-production");
  });
});
