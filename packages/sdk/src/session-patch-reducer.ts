import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { RealtimePatchOperation, SessionTurnPatchEvent } from "@neta-art/cohub-protocol/realtime";

export type SessionPatchStatus =
  | "idle"
  | "pending"
  | "streaming"
  | "completed"
  | "failed";

export type SessionPatchState = {
  spaceId: string | null;
  sessionId: string;
  status: SessionPatchStatus;
  contentBlocks: ContentBlock[];
  anchorUserMessageId: string | null;
  patchSeq: number;
  turnId: string | null;
  appendPath: string | null;
};

export type SessionPatchApplyInput = {
  spaceId?: string | null;
  sessionId: string;
  turnId?: string | null;
  seq: number;
  baseSeq: number;
  ops: RealtimePatchOperation[];
  anchorUserMessageId?: string | null;
};

export type SessionPatchApplyResult =
  | { applied: true; state: SessionPatchState }
  | {
      applied: false;
      reason: "duplicate" | "version_mismatch" | "invalid";
      state: SessionPatchState;
    };

type SessionPatchKeyInput = {
  spaceId?: string | null;
  sessionId: string;
  turnId?: string | null;
};

type PatchBlocksResult = {
  failed: boolean;
  contentBlocks: ContentBlock[];
  anchorUserMessageId?: string | null;
  appendPath: string | null;
};

const blockTextPathPattern =
  /^\/message\/content\/blocks\/(\d+)\/(text|thinking)$/;
const blockPathPattern = /^\/message\/content\/blocks\/(\d+)$/;
const blockMetaPathPattern = /^\/message\/content\/blocks\/(\d+)\/_meta$/;
const blockSignaturePathPattern =
  /^\/message\/content\/blocks\/(\d+)\/signature$/;

const createIdleState = (input: SessionPatchKeyInput): SessionPatchState => ({
  spaceId: input.spaceId ?? null,
  sessionId: input.sessionId,
  status: "idle",
  contentBlocks: [],
  anchorUserMessageId: null,
  patchSeq: 0,
  turnId: null,
  appendPath: null,
});

function cloneBlock(block: ContentBlock): ContentBlock {
  return structuredClone(block);
}

function getStreamIndex(block: ContentBlock): number | null {
  const value = block._meta?.streamIndex;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function findBlockByStreamIndex(blocks: ContentBlock[], streamIndex: number) {
  return blocks.findIndex((block) => getStreamIndex(block) === streamIndex);
}

function sortBlocksByStreamIndex(blocks: ContentBlock[]) {
  return [...blocks].sort((a, b) => {
    const aIndex = getStreamIndex(a);
    const bIndex = getStreamIndex(b);
    if (aIndex == null && bIndex == null) return 0;
    if (aIndex == null) return 1;
    if (bIndex == null) return -1;
    return aIndex - bIndex;
  });
}

function isContentBlock(value: unknown): value is ContentBlock {
  return Boolean(value && typeof value === "object" && "type" in value);
}

function ensureTextLikeBlock(
  blocks: ContentBlock[],
  streamIndex: number,
  field: "text" | "thinking",
) {
  const existingIndex = findBlockByStreamIndex(blocks, streamIndex);
  const existing = existingIndex >= 0 ? blocks[existingIndex] : undefined;
  if (field === "text") {
    if (existing?.type === "text") return existing;
    const block: ContentBlock = {
      type: "text",
      text: "",
      _meta: { streamIndex },
    };
    blocks.push(block);
    return block;
  }
  if (existing?.type === "thinking") return existing;
  const block: ContentBlock = {
    type: "thinking",
    thinking: "",
    _meta: { streamIndex },
  };
  blocks.push(block);
  return block;
}

function appendTextLikeValue(
  blocks: ContentBlock[],
  path: string,
  value: unknown,
) {
  const match = path.match(blockTextPathPattern);
  if (!match || typeof value !== "string") return false;
  const streamIndex = Number(match[1]);
  const field = match[2] as "text" | "thinking";
  const block = ensureTextLikeBlock(blocks, streamIndex, field);
  if (field === "text" && block.type === "text") {
    block.text += value;
  }
  if (field === "thinking" && block.type === "thinking") {
    block.thinking += value;
  }
  return true;
}

function applyPatchOpsToBlocks(
  current: ContentBlock[],
  ops: RealtimePatchOperation[],
  initialAppendPath: string | null,
): PatchBlocksResult {
  const next = current.map(cloneBlock);
  let anchorUserMessageId: string | null | undefined;
  let appendPath = initialAppendPath;
  let failed = false;

  for (const op of ops) {
    if (!op.o && !op.p) {
      if (!appendPath || !appendTextLikeValue(next, appendPath, op.v)) {
        failed = true;
        break;
      }
      continue;
    }

    if (op.o === "merge" && op.p === "/message/metadata") {
      const anchor = op.v.anchorUserMessageId;
      if (typeof anchor === "string" && anchor.trim()) {
        anchorUserMessageId = anchor;
      }
      continue;
    }

    if (op.o === "append") {
      if (!appendTextLikeValue(next, op.p, op.v)) {
        failed = true;
        break;
      }
      appendPath = op.p;
      continue;
    }

    if (op.o === "merge") {
      const match = op.p.match(blockMetaPathPattern);
      if (!match) continue;
      const streamIndex = Number(match[1]);
      const blockIndex = findBlockByStreamIndex(next, streamIndex);
      const block = blockIndex >= 0 ? next[blockIndex] : undefined;
      if (!block) continue;
      block._meta = { ...(block._meta ?? {}), ...op.v };
      continue;
    }

    if (op.o === "replace") {
      const match = op.p.match(blockSignaturePathPattern);
      if (match) {
        if (typeof op.v !== "string") continue;
        const blockIndex = findBlockByStreamIndex(next, Number(match[1]));
        const block = blockIndex >= 0 ? next[blockIndex] : undefined;
        if (block?.type === "thinking") block.signature = op.v;
        continue;
      }
    }

    if (op.o === "replace" || op.o === "add") {
      const match = op.p.match(blockPathPattern);
      if (!match || !isContentBlock(op.v)) continue;
      const streamIndex = Number(match[1]);
      const block = cloneBlock(op.v);
      block._meta = { ...(block._meta ?? {}), streamIndex };
      const blockIndex = findBlockByStreamIndex(next, streamIndex);
      if (blockIndex >= 0) {
        next[blockIndex] = block;
      } else {
        next.push(block);
      }
      continue;
    }

    if (op.o === "remove") {
      const match = op.p.match(blockPathPattern);
      if (!match) continue;
      const blockIndex = findBlockByStreamIndex(next, Number(match[1]));
      if (blockIndex >= 0) next.splice(blockIndex, 1);
    }
  }

  return {
    failed,
    contentBlocks: sortBlocksByStreamIndex(next),
    anchorUserMessageId,
    appendPath,
  };
}

export class SessionPatchReducer {
  private readonly states = new Map<string, SessionPatchState>();

  private key(input: SessionPatchKeyInput) {
    return `${input.spaceId ?? ""}:${input.sessionId}`;
  }

  get(input: SessionPatchKeyInput): SessionPatchState {
    const key = this.key(input);
    return this.states.get(key) ?? createIdleState(input);
  }

  start(input: SessionPatchKeyInput): SessionPatchState {
    const state: SessionPatchState = {
      ...this.get(input),
      status: "pending",
      contentBlocks: [],
      anchorUserMessageId: null,
      patchSeq: 0,
      turnId: null,
      appendPath: null,
    };
    this.states.set(this.key(input), state);
    return state;
  }

  complete(input: SessionPatchKeyInput): SessionPatchState {
    const current = this.get(input);
    const state: SessionPatchState = {
      ...current,
      turnId: input.turnId ?? current.turnId,
      status: "completed",
      contentBlocks: [],
      anchorUserMessageId: null,
    };
    this.states.set(this.key(input), state);
    return state;
  }

  fail(input: SessionPatchKeyInput): SessionPatchState {
    const current = this.get(input);
    const state: SessionPatchState = {
      ...current,
      turnId: input.turnId ?? current.turnId,
      status: "failed",
      contentBlocks: [],
      anchorUserMessageId: null,
    };
    this.states.set(this.key(input), state);
    return state;
  }

  reset(input: SessionPatchKeyInput) {
    this.states.delete(this.key(input));
  }

  resetAll() {
    this.states.clear();
  }

  applyEvent(event: SessionTurnPatchEvent): SessionPatchApplyResult {
    return this.applyPatch({
      spaceId: event.spaceId,
      sessionId: event.sessionId,
      turnId: event.payload.turnId,
      seq: event.payload.seq,
      baseSeq: event.payload.baseSeq,
      ops: event.payload.ops,
      anchorUserMessageId: event.payload.anchorUserMessageId,
    });
  }

  applyPatch(input: SessionPatchApplyInput): SessionPatchApplyResult {
    const current = this.get(input);
    const currentTurnId = current.turnId;
    const inputTurnId = input.turnId ?? null;
    const isDifferentKnownTurn = Boolean(
      currentTurnId && inputTurnId && currentTurnId !== inputTurnId,
    );
    const isFreshKnownTurn = isDifferentKnownTurn && input.baseSeq === 0;
    const currentSeq = isFreshKnownTurn ? 0 : current.patchSeq;
    const isSameTurnKeyframe = Boolean(
      currentTurnId &&
      inputTurnId &&
      currentTurnId === inputTurnId &&
      input.baseSeq === 0 &&
      input.seq > currentSeq,
    );
    const isTerminalSameTurn =
      (current.status === "completed" || current.status === "failed") &&
      Boolean(currentTurnId) &&
      currentTurnId === inputTurnId;

    if (isTerminalSameTurn) {
      return { applied: false, reason: "duplicate", state: current };
    }
    if (isDifferentKnownTurn && !isFreshKnownTurn) {
      return { applied: false, reason: "version_mismatch", state: current };
    }
    if (input.seq <= currentSeq) {
      return { applied: false, reason: "duplicate", state: current };
    }
    if (!isSameTurnKeyframe && input.baseSeq !== currentSeq) {
      return { applied: false, reason: "version_mismatch", state: current };
    }

    const startingFresh = input.baseSeq === 0 || isFreshKnownTurn || isSameTurnKeyframe;
    const baseBlocks = startingFresh ? [] : current.contentBlocks;
    const patched = applyPatchOpsToBlocks(
      baseBlocks,
      input.ops,
      startingFresh ? null : current.appendPath,
    );
    if (patched.failed) {
      return { applied: false, reason: "version_mismatch", state: current };
    }

    const next: SessionPatchState = {
      ...current,
      spaceId: input.spaceId ?? current.spaceId ?? null,
      sessionId: input.sessionId,
      status: "streaming",
      contentBlocks: patched.contentBlocks,
      anchorUserMessageId:
        patched.anchorUserMessageId ??
        input.anchorUserMessageId ??
        current.anchorUserMessageId ??
        null,
      patchSeq: input.seq,
      turnId: input.turnId ?? current.turnId ?? null,
      appendPath: patched.appendPath,
    };
    this.states.set(this.key(next), next);
    return { applied: true, state: next };
  }
}

export const createSessionPatchReducer = () => new SessionPatchReducer();
