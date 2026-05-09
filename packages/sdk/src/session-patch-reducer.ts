import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { RealtimePatchOperation, SessionTurnPatchEvent } from "@neta-art/cohub-protocol/realtime";

export type SessionPatchStatus =
  | "idle"
  | "pending"
  | "streaming"
  | "completed"
  | "failed"
  | "interrupted";

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

export type SessionPatchSnapshotInput = SessionPatchKeyInput & {
  turnId?: string | null;
  seq: number;
  contentBlocks: ContentBlock[];
  anchorUserMessageId?: string | null;
  appendPath?: string | null;
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

const blockSubPathPattern =
  /^\/message\/content\/blocks\/(\d+)\/(.+)$/;
const blockPathPattern = /^\/message\/content\/blocks\/(\d+)$/;
const blockMetaPathPattern = /^\/message\/content\/blocks\/(\d+)\/_meta$/;

const TERMINAL_PATCH_STATUSES = new Set<SessionPatchStatus>(["completed", "failed", "interrupted"]);

const isTerminalPatchStatus = (status: SessionPatchStatus) => TERMINAL_PATCH_STATUSES.has(status);

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function decodePointerSegments(encoded: string): string[] {
  if (!encoded) return [];
  return encoded.split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
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

function getOrCreateBlockForSubpath(
  blocks: ContentBlock[],
  streamIndex: number,
  firstSegment: string,
): ContentBlock | null {
  const idx = findBlockByStreamIndex(blocks, streamIndex);
  if (idx >= 0) return blocks[idx] ?? null;
  if (firstSegment === "text") {
    return ensureTextLikeBlock(blocks, streamIndex, "text");
  }
  if (firstSegment === "thinking") {
    return ensureTextLikeBlock(blocks, streamIndex, "thinking");
  }
  return null;
}

function setDeepOnContentBlock(
  root: ContentBlock,
  segments: string[],
  value: unknown,
): boolean {
  if (segments.length === 0) return false;
  let cur: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const k = segments[i];
    if (k === undefined) return false;
    if (!isPlainObject(cur)) return false;
    const next = cur[k];
    if (next === undefined) return false;
    cur = next;
  }
  const last = segments[segments.length - 1];
  if (last === undefined) return false;
  if (!isPlainObject(cur)) return false;
  const toAssign =
    value !== null && typeof value === "object"
      ? structuredClone(value)
      : value;
  (cur as Record<string, unknown>)[last] = toAssign;
  return true;
}

function appendDeepOnContentBlock(
  root: ContentBlock,
  segments: string[],
  suffix: string,
): boolean {
  if (segments.length === 0) return false;
  let cur: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const k = segments[i];
    if (k === undefined) return false;
    if (!isPlainObject(cur)) return false;
    const next = cur[k];
    if (next === undefined) return false;
    cur = next;
  }
  const last = segments[segments.length - 1];
  if (last === undefined) return false;
  if (!isPlainObject(cur)) return false;
  const parent = cur as Record<string, unknown>;
  const leaf = parent[last];
  if (typeof leaf !== "string") return false;
  parent[last] = leaf + suffix;
  return true;
}

function resolveBlockForSubpath(
  blocks: ContentBlock[],
  streamIndex: number,
  firstSegment: string,
): ContentBlock | null {
  const idx = findBlockByStreamIndex(blocks, streamIndex);
  if (idx >= 0) return blocks[idx] ?? null;
  return getOrCreateBlockForSubpath(blocks, streamIndex, firstSegment);
}

function applyReplaceAtBlockSubpath(
  blocks: ContentBlock[],
  streamIndex: number,
  encodedTail: string,
  value: unknown,
): boolean {
  const segs = decodePointerSegments(encodedTail);
  if (segs.length === 0) return false;
  const block = resolveBlockForSubpath(blocks, streamIndex, segs[0] ?? "");
  if (!block) return false;
  return setDeepOnContentBlock(block, segs, value);
}

function applyAppendAtBlockSubpath(
  blocks: ContentBlock[],
  streamIndex: number,
  encodedTail: string,
  suffix: unknown,
): boolean {
  if (typeof suffix !== "string") return false;
  const segs = decodePointerSegments(encodedTail);
  if (segs.length === 0) return false;
  const block = resolveBlockForSubpath(blocks, streamIndex, segs[0] ?? "");
  if (!block) return false;
  return appendDeepOnContentBlock(block, segs, suffix);
}

function appendPatchStreamValue(blocks: ContentBlock[], path: string, value: unknown) {
  const m = path.match(blockSubPathPattern);
  if (!m) return false;
  return applyAppendAtBlockSubpath(blocks, Number(m[1]), m[2] ?? "", value);
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
      if (!appendPath || !appendPatchStreamValue(next, appendPath, op.v)) {
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
      if (typeof op.p !== "string" || !appendPatchStreamValue(next, op.p, op.v)) {
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
      const sub = op.p.match(blockSubPathPattern);
      if (sub?.[2] && typeof op.p === "string") {
        const streamIndex = Number(sub[1]);
        const encodedTail = sub[2];
        if (applyReplaceAtBlockSubpath(next, streamIndex, encodedTail, op.v)) {
          continue;
        }
        failed = true;
        break;
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
      turnId: input.turnId ?? null,
      appendPath: null,
    };
    this.states.set(this.key(input), state);
    return state;
  }

  replaceTurnId(input: SessionPatchKeyInput & { nextTurnId: string | null }): SessionPatchState {
    const current = this.get(input);
    const state: SessionPatchState = {
      ...current,
      turnId: input.nextTurnId,
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

  interrupt(input: SessionPatchKeyInput): SessionPatchState {
    const current = this.get(input);
    const state: SessionPatchState = {
      ...current,
      turnId: input.turnId ?? current.turnId,
      status: "interrupted",
      contentBlocks: [],
      anchorUserMessageId: null,
      appendPath: null,
    };
    this.states.set(this.key(input), state);
    return state;
  }

  reset(input: SessionPatchKeyInput) {
    this.states.delete(this.key(input));
  }

  applySnapshot(input: SessionPatchSnapshotInput): SessionPatchApplyResult {
    const current = this.get(input);
    const inputTurnId = input.turnId ?? null;
    const currentTurnId = current.turnId;
    const isDifferentKnownTurn = Boolean(
      currentTurnId && inputTurnId && currentTurnId !== inputTurnId,
    );

    const isTerminalSameTurn = isTerminalPatchStatus(current.status) && Boolean(currentTurnId) && currentTurnId === inputTurnId;

    if (isTerminalSameTurn || (!isDifferentKnownTurn && input.seq < current.patchSeq)) {
      return { applied: false, reason: "duplicate", state: current };
    }

    const state: SessionPatchState = {
      ...current,
      spaceId: input.spaceId ?? current.spaceId ?? null,
      sessionId: input.sessionId,
      status: "streaming",
      contentBlocks: sortBlocksByStreamIndex(input.contentBlocks.map(cloneBlock)),
      anchorUserMessageId:
        input.anchorUserMessageId ?? current.anchorUserMessageId ?? null,
      patchSeq: input.seq,
      turnId: inputTurnId ?? current.turnId ?? null,
      appendPath: input.appendPath ?? null,
    };
    this.states.set(this.key(input), state);
    return { applied: true, state };
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
      input.seq >= currentSeq,
    );
    const isTerminalSameTurn =
      isTerminalPatchStatus(current.status) &&
      Boolean(currentTurnId) &&
      currentTurnId === inputTurnId;

    if (isTerminalSameTurn) {
      return { applied: false, reason: "duplicate", state: current };
    }
    if (isDifferentKnownTurn && !isFreshKnownTurn) {
      return { applied: false, reason: "version_mismatch", state: current };
    }
    if (!isSameTurnKeyframe && input.seq <= currentSeq) {
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
