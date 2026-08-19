import {
  BoardEffectSchema,
  parseBoardCompositionInput,
  type BoardEffect,
  type BoardOperation,
  type BoardPlaybackPolicy,
  type BoardComposition,
} from "@cohub/protocol";
import {
  BoardAppearanceSchema,
  type BoardAppearance,
} from "@cohub/protocol/board-document";

const EffectInputSchema = BoardEffectSchema.omit({ boardId: true, revision: true });

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

export function boardCompositionApplyOperation(
  composition: Omit<BoardComposition, "revision">,
): BoardOperation {
  return {
    type: "composition.apply",
    payload: { composition: parseBoardCompositionInput(composition) },
  };
}

export function boardCompositionDeleteOperation(
  compositionId: string,
): BoardOperation {
  return { type: "composition.delete", payload: { compositionId } };
}
