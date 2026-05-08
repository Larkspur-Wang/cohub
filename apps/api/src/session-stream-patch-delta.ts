import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { GatewaySessionPatchOperation } from "@neta-art/cohub-protocol/gateway";
import type { SessionStreamEvent } from "@neta-art/cohub-protocol/realtime";

const getStreamIndex = (block: ContentBlock, fallback: number) => {
  const value = block._meta?.streamIndex;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const blockPatchPath = (block: ContentBlock, fallback: number) =>
  `/message/content/blocks/${getStreamIndex(block, fallback)}`;

type AppendPatchCursor = { p: string; lastSeenAt: number };

const PATCH_CURSOR_MAX_AGE_MS = 10 * 60 * 1000;
const appendPatchCursors = new Map<string, AppendPatchCursor>();

const patchCursorKey = (event: SessionStreamEvent) =>
  `${event.sessionId}:${event.turnId ?? event.sourceMessageId ?? event.anchorUserMessageId ?? "unknown"}`;

const pruneExpiredPatchCursors = (now: number) => {
  for (const [key, cursor] of appendPatchCursors) {
    if (now - cursor.lastSeenAt > PATCH_CURSOR_MAX_AGE_MS) {
      appendPatchCursors.delete(key);
    }
  }
};

type StreamBlockSnapshot = {
  lastSeenAt: number;
  block: ContentBlock;
};

const streamBlockSnapshots = new Map<string, StreamBlockSnapshot>();

const streamBlockSnapshotKey = (event: SessionStreamEvent, streamIndex: number) =>
  `${patchCursorKey(event)}:${streamIndex}`;

const clearStreamBlockSnapshotsForEvent = (event: SessionStreamEvent) => {
  const prefix = `${patchCursorKey(event)}:`;
  for (const key of [...streamBlockSnapshots.keys()]) {
    if (key.startsWith(prefix)) streamBlockSnapshots.delete(key);
  }
};

const pruneStreamBlockSnapshots = (now: number) => {
  for (const [key, snap] of streamBlockSnapshots) {
    if (now - snap.lastSeenAt > PATCH_CURSOR_MAX_AGE_MS) {
      streamBlockSnapshots.delete(key);
    }
  }
};

const encodeJsonPointerSegment = (segment: string) =>
  segment.replace(/~/g, "~0").replace(/\//g, "~1");

const joinPointerPath = (basePath: string, segments: string[]) => {
  if (segments.length === 0) return basePath;
  return `${basePath}/${segments.map(encodeJsonPointerSegment).join("/")}`;
};

const MAX_BLOCK_DIFF_DEPTH = 48;

const blockIdentityCompatible = (prev: ContentBlock, next: ContentBlock): boolean => {
  if (prev.type !== next.type) return false;
  if (prev.type === "tool_use" && next.type === "tool_use") {
    return prev.id === next.id && prev.name === next.name;
  }
  if (prev.type === "tool_result" && next.type === "tool_result") {
    return prev.tool_use_id === next.tool_use_id;
  }
  return true;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v && typeof v === "object" && !Array.isArray(v));

function diffUnknownToOps(
  blockBasePath: string,
  prev: unknown,
  next: unknown,
  segments: string[],
  out: GatewaySessionPatchOperation[],
  depth: number,
): "ok" | "fallback" {
  if (depth > MAX_BLOCK_DIFF_DEPTH) return "fallback";
  if (prev === undefined && next === undefined) return "ok";
  if (prev === undefined) {
    out.push({ o: "replace", p: joinPointerPath(blockBasePath, segments), v: next });
    return "ok";
  }
  if (next === undefined) {
    if (prev !== undefined) return "fallback";
    return "ok";
  }
  if (typeof prev === "string" && typeof next === "string") {
    if (next.startsWith(prev) && next.length > prev.length) {
      out.push({
        o: "append",
        p: joinPointerPath(blockBasePath, segments),
        v: next.slice(prev.length),
      });
      return "ok";
    }
    if (prev === next) return "ok";
    out.push({ o: "replace", p: joinPointerPath(blockBasePath, segments), v: next });
    return "ok";
  }
  if (Array.isArray(prev) || Array.isArray(next)) {
    if (JSON.stringify(prev) === JSON.stringify(next)) return "ok";
    out.push({ o: "replace", p: joinPointerPath(blockBasePath, segments), v: next });
    return "ok";
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const k of [...keys].sort()) {
      const hasP = Object.hasOwn(prev, k);
      const hasN = Object.hasOwn(next, k);
      if (hasP && !hasN) return "fallback";
      const child = diffUnknownToOps(
        blockBasePath,
        hasP ? prev[k] : undefined,
        next[k],
        [...segments, k],
        out,
        depth + 1,
      );
      if (child === "fallback") return "fallback";
    }
    return "ok";
  }
  if (prev === next) return "ok";
  if (typeof prev === "number" && typeof next === "number" && prev === next) return "ok";
  if (typeof prev === "boolean" && typeof next === "boolean" && prev === next) return "ok";
  if (prev === null && next === null) return "ok";
  out.push({ o: "replace", p: joinPointerPath(blockBasePath, segments), v: next });
  return "ok";
}

function diffContentBlocksToOps(
  blockBasePath: string,
  prev: ContentBlock | undefined,
  next: ContentBlock,
): GatewaySessionPatchOperation[] | "fallback" {
  if (!prev) return "fallback";
  if (!blockIdentityCompatible(prev, next)) return "fallback";
  const p = prev as Record<string, unknown>;
  const n = next as Record<string, unknown>;
  const keys = new Set([...Object.keys(p), ...Object.keys(n)]);
  const out: GatewaySessionPatchOperation[] = [];
  for (const k of [...keys].sort()) {
    if (k === "type") continue;
    const hasP = Object.hasOwn(p, k);
    const hasN = Object.hasOwn(n, k);
    if (hasP && !hasN) return "fallback";
    const r = diffUnknownToOps(
      blockBasePath,
      hasP ? p[k] : undefined,
      n[k],
      [k],
      out,
      0,
    );
    if (r === "fallback") return "fallback";
  }
  return out;
}

const resolveFullBlockFromSnapshot = (
  snapshotContent: ContentBlock[] | undefined,
  streamIndex: number,
  deltaBlock: ContentBlock,
): ContentBlock => {
  if (!snapshotContent?.length) return structuredClone(deltaBlock);
  const found = snapshotContent.find(
    (b) => getStreamIndex(b, -1) === streamIndex,
  );
  return found ? structuredClone(found) : structuredClone(deltaBlock);
};

const compactAppendPatchOps = (
  event: SessionStreamEvent,
  ops: GatewaySessionPatchOperation[],
): GatewaySessionPatchOperation[] => {
  const now = Date.now();
  pruneExpiredPatchCursors(now);
  pruneStreamBlockSnapshots(now);
  const key = patchCursorKey(event);
  let cursor = event.baseSeq === 0 ? null : appendPatchCursors.get(key) ?? null;
  const compacted: GatewaySessionPatchOperation[] = [];

  for (const op of ops) {
    if (op.o === "append" && typeof op.p === "string") {
      if (cursor?.p === op.p) {
        compacted.push({ v: op.v });
      } else {
        compacted.push(op);
      }
      cursor = { p: op.p, lastSeenAt: now };
      continue;
    }
    compacted.push(op);
  }

  if (cursor) {
    appendPatchCursors.set(key, cursor);
  } else {
    appendPatchCursors.delete(key);
  }

  return compacted;
};

export const getAppendPathForStreamEvent = (event: SessionStreamEvent) =>
  appendPatchCursors.get(patchCursorKey(event))?.p ?? null;

export const buildPatchOpsForContentDelta = (input: {
  event: SessionStreamEvent;
}): GatewaySessionPatchOperation[] => {
  const ops: GatewaySessionPatchOperation[] = [];
  const now = Date.now();
  if (input.event.baseSeq === 0) {
    clearStreamBlockSnapshotsForEvent(input.event);
    ops.push(
      { o: "replace", p: "/message/status", v: "streaming" },
      { o: "replace", p: "/message/end_turn", v: false },
    );
    const metadata: Record<string, unknown> = {
      is_complete: false,
    };
    if (input.event.turnId) metadata.turnId = input.event.turnId;
    if (input.event.anchorUserMessageId) metadata.anchorUserMessageId = input.event.anchorUserMessageId;
    ops.push({ o: "merge", p: "/message/metadata", v: metadata });
  }

  input.event.content.forEach((deltaBlock, index) => {
    const path = blockPatchPath(deltaBlock, index);
    const streamIndex = getStreamIndex(deltaBlock, index);
    const snapKey = streamBlockSnapshotKey(input.event, streamIndex);
    const nextFull = resolveFullBlockFromSnapshot(
      input.event.snapshotContent,
      streamIndex,
      deltaBlock,
    );
    const prevEntry = streamBlockSnapshots.get(snapKey);
    const prevFull = prevEntry?.block;

    const diffResult = diffContentBlocksToOps(path, prevFull, nextFull);
    if (diffResult !== "fallback" && diffResult.length > 0) {
      for (const op of diffResult) ops.push(op);
    } else if (diffResult === "fallback") {
      ops.push({ o: "replace", p: path, v: nextFull });
    }

    streamBlockSnapshots.set(snapKey, { lastSeenAt: now, block: structuredClone(nextFull) });
  });

  return compactAppendPatchOps(input.event, ops);
};
