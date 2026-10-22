/**
 * Error shape consistency test.
 * Verifies every domain error helper produces an object that conforms to
 * { code: number, message: string } — the expected MCP error response shape.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  badRequest,
  notFound,
  conflict,
  unsupported,
  internal,
  makeErr,
} from "./types.js";
import { formatOperationError } from "../mcp-runtime/format.js";
import { isOperationError } from "./types.js";

describe("domain error helpers", () => {
  describe("badRequest", () => {
    it("returns an object with numeric code and string message", () => {
      const err = badRequest("invalid input");
      assert.equal(typeof err.code, "number");
      assert.equal(typeof err.message, "string");
      assert.equal(err.code, -32602);
      assert.equal(err.message, "invalid input");
    });

    it("is an OperationError", () => {
      assert.equal(isOperationError(badRequest("test")), true);
    });
  });

  describe("notFound", () => {
    it("returns an object with numeric code and string message", () => {
      const err = notFound("resource missing");
      assert.equal(typeof err.code, "number");
      assert.equal(typeof err.message, "string");
      assert.equal(err.code, -32004);
      assert.equal(err.message, "resource missing");
    });

    it("is an OperationError", () => {
      assert.equal(isOperationError(notFound("test")), true);
    });
  });

  describe("conflict", () => {
    it("returns an object with numeric code and string message", () => {
      const err = conflict("already exists");
      assert.equal(typeof err.code, "number");
      assert.equal(typeof err.message, "string");
      assert.equal(err.code, -32010);
      assert.equal(err.message, "already exists");
    });

    it("is an OperationError", () => {
      assert.equal(isOperationError(conflict("test")), true);
    });
  });

  describe("unsupported", () => {
    it("returns an object with numeric code and string message", () => {
      const err = unsupported("capability not available");
      assert.equal(typeof err.code, "number");
      assert.equal(typeof err.message, "string");
      assert.equal(err.code, -32040);
      assert.equal(err.message, "capability not available");
    });

    it("is an OperationError", () => {
      assert.equal(isOperationError(unsupported("test")), true);
    });
  });

  describe("internal", () => {
    it("returns an object with numeric code and string message", () => {
      const err = internal("something went wrong");
      assert.equal(typeof err.code, "number");
      assert.equal(typeof err.message, "string");
      assert.equal(err.code, -32603);
      assert.equal(err.message, "something went wrong");
    });

    it("is an OperationError", () => {
      assert.equal(isOperationError(internal("test")), true);
    });
  });

  describe("makeErr", () => {
    it("returns an object with numeric code and string message", () => {
      const err = makeErr(-31000, "custom error");
      assert.equal(typeof err.code, "number");
      assert.equal(typeof err.message, "string");
      assert.equal(err.code, -31000);
      assert.equal(err.message, "custom error");
    });

    it("is an OperationError", () => {
      assert.equal(isOperationError(makeErr(-31000, "test")), true);
    });
  });
});

describe("formatOperationError", () => {
  function parsePayload(result: ReturnType<typeof formatOperationError>): { code: number; message: string; data?: unknown } {
    const text = result.content[0].text;
    return JSON.parse(text);
  }

  it("produces { code, message } payload for badRequest", () => {
    const result = formatOperationError(badRequest("missing field"));
    const parsed = parsePayload(result);
    assert.equal(parsed.code, -32602);
    assert.equal(parsed.message, "missing field");
  });

  it("produces { code, message } payload for notFound", () => {
    const result = formatOperationError(notFound("note not found"));
    const parsed = parsePayload(result);
    assert.equal(parsed.code, -32004);
    assert.equal(parsed.message, "note not found");
  });

  it("produces { code, message } payload for conflict", () => {
    const result = formatOperationError(conflict("duplicate"));
    const parsed = parsePayload(result);
    assert.equal(parsed.code, -32010);
    assert.equal(parsed.message, "duplicate");
  });

  it("produces { code, message } payload for unsupported", () => {
    const result = formatOperationError(unsupported("not implemented"));
    const parsed = parsePayload(result);
    assert.equal(parsed.code, -32040);
    assert.equal(parsed.message, "not implemented");
  });

  it("produces { code, message } payload for internal", () => {
    const result = formatOperationError(internal("unexpected failure"));
    const parsed = parsePayload(result);
    assert.equal(parsed.code, -32603);
    assert.equal(parsed.message, "unexpected failure");
  });

  it("produces { code: -32603, message } for a plain Error (fallback)", () => {
    const result = formatOperationError(new Error("raw error message"));
    const parsed = parsePayload(result);
    assert.equal(parsed.code, -32603);
    assert.equal(parsed.message, "raw error message");
  });

  it("produces { code: -32603, message } for a non-Error value", () => {
    const result = formatOperationError("string error");
    const parsed = parsePayload(result);
    assert.equal(parsed.code, -32603);
    assert.equal(parsed.message, "Internal operation error");
  });
});
