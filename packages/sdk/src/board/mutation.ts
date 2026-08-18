import {
  BoardClipSchema,
  BoardEffectSchema,
  BoardSequenceSchema,
  type BoardClip,
  type BoardEffect,
  type BoardNodeInput,
  type BoardOperation,
  type BoardPlaybackPolicy,
  type BoardSequence,
} from "@cohub/protocol";
import type { BoardConnection } from "@cohub/protocol/board-connection";
import {
  BoardAppearanceSchema,
  type BoardAppearance,
} from "@cohub/protocol/board-document";

const EffectInputSchema = BoardEffectSchema.omit({ boardId: true, revision: true });
const SequenceInputSchema = BoardSequenceSchema.omit({ boardId: true, revision: true });
const ClipInputSchema = BoardClipSchema.omit({ sequenceId: true });

export function patchBoardAppearance(
  current: BoardAppearance,
  patch: Partial<BoardAppearance>,
): BoardAppearance {
  return BoardAppearanceSchema.parse({
    ...current,
    ...patch,
    background: patch.background ?? current.background,
    grid: patch.grid ?? current.grid,
  });
}

export function boardAppearanceOperation(appearance: BoardAppearance): BoardOperation {
  return {
    type: "board.patch",
    payload: { patch: { metadataPatch: { appearance } } },
  };
}

export function boardTitleOperation(title: string): BoardOperation {
  return { type: "board.patch", payload: { patch: { title } } };
}

export function boardPlaybackPolicyOperation(
  metadata: Record<string, unknown>,
  policy: BoardPlaybackPolicy | null,
): BoardOperation {
  if (policy) {
    return {
      type: "board.patch",
      payload: { patch: { metadataPatch: { playback: policy } } },
    };
  }
  const next = { ...metadata };
  delete next.playback;
  return { type: "board.patch", payload: { patch: { metadata: next } } };
}

export function boardNodeCreateOperation(node: BoardNodeInput): BoardOperation {
  return { type: "node.create", payload: { node } };
}

export function boardNodePatchOperation(
  nodeId: string,
  patch: Partial<Omit<BoardNodeInput, "nodeId">>,
): BoardOperation {
  return { type: "node.patch", payload: { nodeId, patch } };
}

export function boardNodeDeleteOperations(
  nodeId: string,
  connections: readonly BoardConnection[],
): BoardOperation[] {
  const deletes = connections
    .filter(
      (connection) =>
        connection.source.nodeId === nodeId || connection.target.nodeId === nodeId,
    )
    .map(
      (connection): BoardOperation => ({
        type: "connection.delete",
        payload: { connectionId: connection.id, reason: "node-cascade" },
      }),
    );
  return [
    ...deletes,
    { type: "node.delete", payload: { nodeId, reason: "node-cascade" } },
  ];
}

export function boardEffectUpsertOperation(
  effect: Omit<BoardEffect, "boardId" | "revision">,
): BoardOperation {
  return {
    type: "effect.upsert",
    payload: { effect: EffectInputSchema.parse(effect) },
  };
}

export function boardEffectDeleteOperation(effectId: string): BoardOperation {
  return { type: "effect.delete", payload: { effectId } };
}

export function boardSequenceUpsertOperation(input: {
  sequence: Omit<BoardSequence, "boardId" | "revision">;
  clips: Array<Omit<BoardClip, "sequenceId">>;
}): BoardOperation {
  return {
    type: "sequence.upsert",
    payload: {
      sequence: SequenceInputSchema.parse(input.sequence),
      clips: input.clips.map((clip) => ClipInputSchema.parse(clip)),
    },
  };
}

export function boardSequenceDeleteOperation(sequenceId: string): BoardOperation {
  return { type: "sequence.delete", payload: { sequenceId } };
}
