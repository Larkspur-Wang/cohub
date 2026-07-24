import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CanvasServiceError,
  MAX_DELETE_REASON_LENGTH,
  normalizeCanvasOps,
  type CanvasSemanticOp,
} from "./canvas-ops.js";

function normalize(op: CanvasSemanticOp) {
  return normalizeCanvasOps([op])[0];
}

test("normalizes document meta replacement", () => {
  assert.deepEqual(normalize({
    opId: "meta-1",
    type: "document.patch",
    payload: { patch: { meta: { modelKind: "cohub-2d", schemaVersion: 1 } } },
    inverse: { meta: { untrusted: true } },
  }), {
    opId: "meta-1",
    type: "document.patch",
    payload: { patch: { meta: { modelKind: "cohub-2d", schemaVersion: 1 } } },
  });
});

test("allows clearing document meta", () => {
  assert.deepEqual(normalize({
    type: "document.patch",
    payload: { patch: { meta: null } },
  }), {
    type: "document.patch",
    payload: { patch: { meta: null } },
  });
});

test("rejects unsupported document fields", () => {
  assert.throws(
    () => normalize({
      type: "document.patch",
      payload: { patch: { title: "New title" } },
    } as CanvasSemanticOp),
    (error) => error instanceof CanvasServiceError && error.status === 400,
  );
});

test("normalizes delete reason and discards client inverse", () => {
  assert.deepEqual(normalize({
    opId: "delete-1",
    type: "node.delete",
    payload: { nodeId: "node-1", reason: "  user-delete  " },
    inverse: { node: { nodeId: "incomplete" } },
  }), {
    opId: "delete-1",
    type: "node.delete",
    payload: { nodeId: "node-1", reason: "user-delete" },
  });
});

test("rejects invalid delete reasons", () => {
  assert.throws(
    () => normalize({
      type: "node.delete",
      payload: { nodeId: "node-1", reason: " ".repeat(2) },
    }),
    (error) => error instanceof CanvasServiceError && error.status === 400,
  );
  assert.throws(
    () => normalize({
      type: "node.delete",
      payload: { nodeId: "node-1", reason: "x".repeat(MAX_DELETE_REASON_LENGTH + 1) },
    }),
    (error) => error instanceof CanvasServiceError && error.status === 400,
  );
});
