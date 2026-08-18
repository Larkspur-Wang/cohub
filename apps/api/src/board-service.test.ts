import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BoardCreateInputSchema,
  BoardInspectInputSchema,
  BoardPlaybackCommandSchema,
  type BoardOperation,
} from "@cohub/protocol";
import {
  BoardServiceError,
  contextualValidation,
  normalizeBoardOperation,
  normalizeBoardTransaction,
  normalizeNodes,
  normalizePlaybackPosition,
  structuralValidation,
  MAX_BOARD_NODES,
  NODE_WRITE_CHUNK,
} from "./board-ops.js";

const boardId = "11111111-1111-4111-8111-111111111111";

function operation(value: BoardOperation) {
  return normalizeBoardOperation(value);
}

test("normalizes Board metadata and title", () => {
  assert.deepEqual(operation({
    opId: "patch-1",
    type: "board.patch",
    payload: { patch: { title: "  Battle  ", metadata: { theme: "night" } } },
  }), {
    opId: "patch-1",
    type: "board.patch",
    payload: { patch: { title: "Battle", metadata: { theme: "night" } } },
  });
});

test("validates selective viewport inspection", () => {
  assert.deepEqual(BoardInspectInputSchema.parse({
    include: ["nodes", "effects"],
    viewport: { x: -100, y: -50, width: 200, height: 100 },
  }), {
    include: ["nodes", "effects"],
    viewport: { x: -100, y: -50, width: 200, height: 100 },
  });
  assert.equal(BoardInspectInputSchema.safeParse({
    viewport: { x: 0, y: 0, width: 0, height: 100 },
  }).success, false);
});

test("rejects malformed playback commands before persistence", () => {
  assert.equal(BoardPlaybackCommandSchema.safeParse({
    commandId: "seek-1",
    type: "seek",
    playbackId: "22222222-2222-4222-8222-222222222222",
    position: Number.NaN,
  }).success, false);
  assert.equal(BoardPlaybackCommandSchema.safeParse({
    commandId: "unknown-1",
    type: "rewind",
    playbackId: "22222222-2222-4222-8222-222222222222",
  }).success, false);
});

test("normalizes shared playback positions", () => {
  assert.equal(normalizePlaybackPosition(1_250, 1_000), 1_000);
  assert.equal(normalizePlaybackPosition(-250, 1_000), 0);
  assert.equal(normalizePlaybackPosition(250, 0), 0);
});

test("requires an exact base version", () => {
  assert.throws(
    () => normalizeBoardTransaction({ txId: "tx-1", boardId, operations: [{ type: "node.delete", payload: { nodeId: "n1" } }] }),
    (error) => error instanceof BoardServiceError && error.status === 400,
  );
  assert.equal(normalizeBoardTransaction({
    txId: "tx-1",
    boardId,
    baseVersion: 0,
    operations: [{ type: "node.delete", payload: { nodeId: "n1" } }],
  }).baseVersion, 0);
});

test("allows ordinary metadata while rejecting executable source", () => {
  assert.doesNotThrow(() => operation({
    type: "board.patch",
    payload: {
      patch: {
        metadata: {
          appearance: {
            background: { kind: "image", imageUrl: "https://cdn.example/background.png" },
          },
        },
      },
    },
  }));
  assert.throws(
    () => operation({ type: "board.patch", payload: { patch: { metadata: { wgsl: "@fragment fn main() {}" } } } }),
    (error) => error instanceof BoardServiceError && error.code === "UNTRUSTED_CODE",
  );
});

test("validates Board create input before side effects", () => {
  assert.equal(BoardCreateInputSchema.safeParse({ path: "battle.board", title: 42 }).success, false);
  assert.equal(BoardCreateInputSchema.safeParse({ path: "battle.board", effects: {} }).success, false);
  assert.equal(BoardCreateInputSchema.safeParse({ path: "battle.board", sequences: {} }).success, false);
  assert.equal(BoardCreateInputSchema.safeParse({ path: "battle.board" }).success, true);
  assert.equal(BoardCreateInputSchema.safeParse({ path: "battle.board", mutationId: "mutation-1" }).success, true);
  assert.equal(BoardCreateInputSchema.safeParse({ path: "battle.board", mutationId: "x".repeat(129) }).success, false);
});

test("rejects unsupported node types and non-semantic colors", () => {
  const base = {
    nodeId: "n1",
    parentId: null,
    orderKey: null,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    rotation: 0,
    refKind: null,
    refPath: null,
    refUrl: null,
    view: {},
    style: {},
  };
  assert.throws(
    () => normalizeNodes([{ ...base, type: "rect", data: {} }]),
    (error) =>
      error instanceof BoardServiceError &&
      error.code === "INVALID_BOARD_NODE" &&
      error.diagnostics?.[0]?.path === "nodes.0.type",
  );
  assert.throws(
    () => normalizeNodes([{
      ...base,
      type: "text",
      data: { text: "x", color: "#22c55e", fontSize: 24 },
    }]),
    (error) =>
      error instanceof BoardServiceError &&
      error.diagnostics?.[0]?.path === "nodes.0.data.color",
  );
});

test("rejects clips outside their sequence", () => {
  assert.throws(
    () => operation({
      type: "sequence.upsert",
      payload: {
        sequence: { id: "fight", name: "Fight", duration: 100, seed: "seed", restPose: {}, metadata: {} },
        clips: [{
          id: "impact",
          kind: "effects.impact",
          kindVersion: 1,
          target: { type: "board" },
          start: 90,
          duration: 20,
          layer: "front",
          fill: "none",
          easing: "linear",
          params: {},
          keyframes: [],
          assetRefs: [],
          seed: "impact",
          metadata: {},
        }],
      },
    }),
    (error) => error instanceof BoardServiceError && error.status === 400,
  );
});

test("rejects overlapping semantic camera clips", () => {
  const focus = (id: string, start: number) => ({
    id,
    kind: "camera.focus",
    kindVersion: 1,
    target: { type: "camera" as const },
    start,
    duration: 600,
    layer: "screen" as const,
    fill: "forwards" as const,
    easing: "linear",
    params: {
      focus: { type: "rect" as const, rect: { x: 0, y: 0, width: 100, height: 100 } },
    },
    keyframes: [],
    assetRefs: [],
    seed: id,
    metadata: {},
  });
  assert.throws(
    () => operation({
      type: "sequence.upsert",
      payload: {
        sequence: { id: "tour", name: "Tour", duration: 2_000, seed: "tour", restPose: {}, metadata: {} },
        clips: [focus("first", 0), focus("second", 500)],
      },
    }),
    /must not overlap/,
  );
});

test("validates Board playback metadata and its final sequence reference", () => {
  assert.throws(
    () => operation({
      type: "board.patch",
      payload: {
        patch: {
          metadata: {
            playback: {
              sequenceId: "ambient",
              loop: "forever",
            },
          },
        },
      },
    }),
    (error) => error instanceof BoardServiceError && error.code === "INVALID_PLAYBACK_POLICY",
  );

  const transaction = normalizeBoardTransaction({
    txId: "tx-autoplay",
    boardId,
    baseVersion: 0,
    operations: [
      {
        type: "board.patch",
        payload: {
          patch: {
            metadata: {
              playback: {
                sequenceId: "ambient",
                delayMs: 250,
                loop: true,
              },
            },
          },
        },
      },
      {
        type: "sequence.upsert",
        payload: {
          sequence: {
            id: "ambient",
            name: "Ambient",
            duration: 1_000,
            seed: "ambient",
            restPose: {},
            metadata: {},
          },
          clips: [],
        },
      },
    ],
  });
  const context = {
    boardVersion: 0,
    metadata: {},
    nodeIds: [],
    connections: [],
    effects: [],
    sequences: [],
  };
  assert.deepEqual(errorsOf(contextualValidation(transaction, context)), []);

  const missingSequence = normalizeBoardTransaction({
    ...transaction,
    txId: "tx-missing-autoplay",
    operations: transaction.operations.slice(0, 1),
  });
  assert.deepEqual(
    errorsOf(contextualValidation(missingSequence, context)),
    ["INVALID_REFERENCE"],
  );
});

test("requires bounded deterministic particle clips", () => {
  const sequence = {
    id: "fight",
    name: "Fight",
    duration: 1_000,
    seed: "seed",
    restPose: {},
    metadata: {},
  };
  const particleClip = {
    id: "sparks",
    kind: "effects.particles",
    kindVersion: 1,
    target: { type: "board" as const },
    start: 0,
    duration: 800,
    layer: "front" as const,
    fill: "none" as const,
    easing: "linear",
    params: { count: 420 },
    keyframes: [],
    assetRefs: [],
    seed: "sparks",
    metadata: {},
  };
  assert.throws(
    () => operation({ type: "sequence.upsert", payload: { sequence, clips: [particleClip] } }),
    (error) => error instanceof BoardServiceError && error.status === 400,
  );

  const transaction = normalizeBoardTransaction({
    txId: "tx-particles",
    boardId,
    baseVersion: 0,
    operations: [{
      type: "sequence.upsert",
      payload: {
        sequence,
        clips: [{
          ...particleClip,
          params: { count: 420, bounds: { x: -200, y: -100, width: 400, height: 200 } },
        }],
      },
    }],
  });
  assert.equal(structuralValidation(transaction).peakCost.particles, 420);
});

test("contextual validation simulates operation order and references", () => {
  const transaction = normalizeBoardTransaction({
    txId: "tx-context",
    boardId,
    baseVersion: 2,
    operations: [
      {
        type: "effect.upsert",
        payload: {
          effect: {
            id: "pulse",
            target: { type: "node", nodeId: "created-first" },
            kind: "effects.pulse",
            kindVersion: 1,
            enabled: true,
            lifecycle: "persistent",
            timeOrigin: "board",
            layer: "front",
            seed: "pulse",
            params: {},
            assetRefs: [],
            metadata: {},
          },
        },
      },
      {
        type: "node.create",
        payload: {
          node: {
            nodeId: "created-first",
            type: "text",
            parentId: null,
            orderKey: null,
            x: 0,
            y: 0,
            width: 100,
            height: 40,
            rotation: 0,
            refKind: null,
            refPath: null,
            refUrl: null,
            view: {},
            style: {},
            data: {},
          },
        },
      },
    ],
  });
  const validation = contextualValidation(transaction, {
    boardVersion: 3,
    nodeIds: [],
    connections: [],
    effects: [],
    sequences: [],
  });
  assert.equal(validation.valid, false);
  assert.deepEqual(
    validation.diagnostics.filter((diagnostic) => diagnostic.severity === "error").map((diagnostic) => diagnostic.code),
    ["VERSION_CONFLICT", "INVALID_REFERENCE"],
  );
});

test("requires extension asset digests", () => {
  assert.throws(
    () => operation({
      type: "effect.upsert",
      payload: {
        effect: {
          id: "aura",
          target: { type: "board" },
          kind: "effects.particles",
          kindVersion: 1,
          enabled: true,
          lifecycle: "persistent",
          timeOrigin: "board",
          layer: "front",
          seed: "aura",
          params: {},
          assetRefs: [{ type: "extension", ref: "effects/aura" }],
          metadata: {},
        },
      },
    }),
    (error) => error instanceof BoardServiceError && error.status === 400,
  );
});

/**
 * Reference integrity across entity kinds is validated once, up front, against a
 * simulation of the whole transaction. These cases are the reason it lives there
 * and not in the apply path: each one is only legal *because* of the order its
 * operations appear in, so any check reading a pre-transaction snapshot rejects it.
 */

function nodeInput(nodeId: string) {
  return {
    nodeId,
    type: "text",
    parentId: null,
    orderKey: null,
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    rotation: 0,
    refKind: null,
    refPath: null,
    refUrl: null,
    view: {},
    style: {},
    data: { text: "", color: "neutral", fontSize: 24 },
  };
}

test("validates a node patch after merging it with current state", () => {
  const current = nodeInput("n1");
  const transaction = normalizeBoardTransaction({
    txId: "tx-node-patch",
    boardId,
    baseVersion: 0,
    operations: [{
      type: "node.patch",
      payload: {
        nodeId: "n1",
        patch: { data: { text: "x", color: "#22c55e", fontSize: 24 } },
      },
    }],
  });
  const validation = contextualValidation(transaction, {
    boardVersion: 0,
    nodeIds: ["n1"],
    nodes: [current],
    connections: [],
    effects: [],
    sequences: [],
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.diagnostics[0]?.code, "INVALID_BOARD_NODE");
  assert.equal(validation.diagnostics[0]?.path, "operations.0.payload.patch.data.color");
});

function effectInput(id: string, nodeId: string) {
  return {
    id,
    kind: "effects.pulse",
    kindVersion: 1,
    target: { type: "node" as const, nodeId },
    params: {},
    lifecycle: "persistent" as const,
    timeOrigin: "board" as const,
    seed: "seed-1",
    revision: 0,
  };
}

function errorsOf(validation: { diagnostics: Array<{ severity: string; code: string }> }) {
  return validation.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code);
}

test("an effect may target a node created earlier in the same transaction", () => {
  const transaction = normalizeBoardTransaction({
    txId: "tx-order-1",
    boardId,
    baseVersion: 0,
    operations: [
      { type: "node.create", payload: { node: nodeInput("fresh") } },
      { type: "effect.upsert", payload: { effect: effectInput("fx", "fresh") } },
    ],
  });
  const validation = contextualValidation(transaction, {
    boardVersion: 0,
    nodeIds: [],
    connections: [],
    effects: [],
    sequences: [],
  });
  assert.deepEqual(errorsOf(validation), []);
});

test("a node becomes deletable once the effect referencing it is deleted", () => {
  const transaction = normalizeBoardTransaction({
    txId: "tx-order-2",
    boardId,
    baseVersion: 0,
    operations: [
      { type: "effect.delete", payload: { effectId: "fx" } },
      { type: "node.delete", payload: { nodeId: "pinned" } },
    ],
  });
  const validation = contextualValidation(transaction, {
    boardVersion: 0,
    nodeIds: ["pinned"],
    connections: [],
    effects: [effectInput("fx", "pinned")],
    sequences: [],
  });
  assert.deepEqual(errorsOf(validation), []);
  // The same two operations in the opposite order are still correctly refused.
  const reversed = normalizeBoardTransaction({
    txId: "tx-order-3",
    boardId,
    baseVersion: 0,
    operations: [
      { type: "node.delete", payload: { nodeId: "pinned" } },
      { type: "effect.delete", payload: { effectId: "fx" } },
    ],
  });
  assert.deepEqual(
    errorsOf(contextualValidation(reversed, {
      boardVersion: 0,
      nodeIds: ["pinned"],
      connections: [],
      effects: [effectInput("fx", "pinned")],
      sequences: [],
    })),
    ["NODE_REFERENCED"],
  );
});

test("board nodes are bounded by bytes, not only by count", () => {
  // A node carries free-form view/style/data, so a legal count says nothing about
  // the size of the request behind it.
  const fat = (index: number) => ({
    ...nodeInput(`n${index}`),
    data: { blob: "x".repeat(64 * 1024) },
  });
  assert.throws(
    () => normalizeNodes(Array.from({ length: 600 }, (_, index) => fat(index))),
    (error: unknown) =>
      error instanceof BoardServiceError && error.status === 413,
  );
  // A count above the cap is still refused on count alone.
  assert.throws(
    () => normalizeNodes(Array.from({ length: MAX_BOARD_NODES + 1 }, (_, i) => nodeInput(`n${i}`))),
    (error: unknown) =>
      error instanceof BoardServiceError && error.status === 413,
  );
});

test("a node write chunk cannot exceed Postgres's bind parameter limit", () => {
  // A node row binds ~18 parameters; the ceiling is 65535 per statement.
  const PARAMS_PER_ROW = 20;
  const POSTGRES_MAX_BIND_PARAMS = 65535;
  assert.ok(
    NODE_WRITE_CHUNK * PARAMS_PER_ROW < POSTGRES_MAX_BIND_PARAMS,
    `${NODE_WRITE_CHUNK} rows per statement is too many`,
  );
});

/**
 * The client emits operations in one order and the server validates in that same
 * order, so the two have to agree about referential rules. These pin the agreement
 * directly against the validator rather than trusting the client's own tests.
 */

const connectionInput = (id: string, source: string, target: string) => ({
  id,
  source: { nodeId: source, anchor: { kind: "auto" as const } },
  target: { nodeId: target, anchor: { kind: "auto" as const } },
  relation: "related",
  direction: "forward" as const,
  label: "",
  routing: { kind: "straight" as const, bend: 0, waypoints: [] },
  style: { color: "neutral", size: 2, line: "solid" as const },
  metadata: {},
});

test("deleting a connected node is accepted when the relation is removed first", () => {
  const transaction = normalizeBoardTransaction({
    txId: "tx-conn-order-1",
    boardId,
    baseVersion: 0,
    operations: [
      { type: "connection.delete", payload: { connectionId: "c1" } },
      { type: "node.delete", payload: { nodeId: "a" } },
    ],
  });
  const validation = contextualValidation(transaction, {
    boardVersion: 0,
    nodeIds: ["a", "b"],
    connections: [connectionInput("c1", "a", "b")],
    effects: [],
    sequences: [],
  });
  assert.deepEqual(errorsOf(validation), []);
});

test("deleting a connected node is refused when the relation is left behind", () => {
  // This is the failure the client ordering bug produced: node first, relation
  // second. Keeping the assertion here means a client regression is caught by a
  // named error rather than by a mysterious rejected save.
  const transaction = normalizeBoardTransaction({
    txId: "tx-conn-order-2",
    boardId,
    baseVersion: 0,
    operations: [
      { type: "node.delete", payload: { nodeId: "a" } },
      { type: "connection.delete", payload: { connectionId: "c1" } },
    ],
  });
  const validation = contextualValidation(transaction, {
    boardVersion: 0,
    nodeIds: ["a", "b"],
    connections: [connectionInput("c1", "a", "b")],
    effects: [],
    sequences: [],
  });
  assert.deepEqual(errorsOf(validation), ["NODE_REFERENCED"]);
});

test("a relation may name a node created earlier in the same transaction", () => {
  const transaction = normalizeBoardTransaction({
    txId: "tx-conn-order-3",
    boardId,
    baseVersion: 0,
    operations: [
      { type: "node.create", payload: { node: nodeInput("fresh") } },
      { type: "connection.create", payload: { connection: connectionInput("c9", "fresh", "b") } },
    ],
  });
  const validation = contextualValidation(transaction, {
    boardVersion: 0,
    nodeIds: ["b"],
    connections: [],
    effects: [],
    sequences: [],
  });
  assert.deepEqual(errorsOf(validation), []);
});
