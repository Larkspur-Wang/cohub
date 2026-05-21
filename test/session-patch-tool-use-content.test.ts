/**
 * 验证流式 patch：在 /message/content/blocks/{n} 下对 JSON 做通用 diff，
 * 字符串前缀增长走 append，其余走子路径或整块 replace；SDK 应用任意子路径 append/replace。
 */
import assert from "node:assert/strict";
import type { ContentBlock } from "@cohub/protocol/core";
import type { SessionStreamEvent } from "@cohub/protocol/realtime";
import { buildPatchOpsForContentDelta } from "../apps/agent/src/stream/patch-delta.js";
import { createSessionPatchReducer } from "../packages/sdk/src/session-patch-reducer.js";

const toolBlock = (input: Record<string, unknown>, streamIndex = 1): ContentBlock => ({
  type: "tool_use",
  id: "toolu_1",
  name: "write",
  input,
  _meta: { streamIndex, toolStatus: "pending" },
});

const baseEvent = (): Omit<SessionStreamEvent, "seq" | "baseSeq" | "content"> => ({
  type: "stream_update",
  spaceId: "sp1",
  sessionId: "se1",
  turnId: "turn1",
  sourceMessageId: "um1",
  anchorUserMessageId: "um1",
  timestamp: Date.now(),
  messageId: null,
  messageOrdinal: 0,
});

function main() {
  const reducer = createSessionPatchReducer();
  reducer.start({ sessionId: "se1", spaceId: "sp1", turnId: "turn1" });

  const e1: SessionStreamEvent = {
    ...baseEvent(),
    seq: 1,
    baseSeq: 0,
    content: [toolBlock({ path: "/tmp/a.txt" }, 1)],
    snapshotContent: [toolBlock({ path: "/tmp/a.txt" }, 1)],
  };
  const ops1 = buildPatchOpsForContentDelta(e1);
  const replace1 = ops1.filter(
    (o) => o.o === "replace" && typeof o.p === "string" && /\/blocks\/1$/.test(o.p),
  );
  assert.equal(replace1.length, 1, "首帧应为整块 replace");

  let r = reducer.applyPatch({
    sessionId: "se1",
    spaceId: "sp1",
    turnId: "turn1",
    seq: 1,
    baseSeq: 0,
    ops: ops1,
  });
  assert.equal(r.applied, true);

  const e2: SessionStreamEvent = {
    ...baseEvent(),
    seq: 2,
    baseSeq: 1,
    content: [toolBlock({ path: "/tmp/a.txt", content: "hel" }, 1)],
    snapshotContent: [toolBlock({ path: "/tmp/a.txt", content: "hel" }, 1)],
  };
  const ops2 = buildPatchOpsForContentDelta(e2);
  const subReplace2 = ops2.filter(
    (o) =>
      o.o === "replace" &&
      o.p === "/message/content/blocks/1/input/content" &&
      o.v === "hel",
  );
  assert.equal(subReplace2.length, 1, "首次出现 content 应为子路径 replace");
  r = reducer.applyPatch({
    sessionId: "se1",
    spaceId: "sp1",
    turnId: "turn1",
    seq: 2,
    baseSeq: 1,
    ops: ops2,
  });
  assert.equal(r.applied, true);
  const tu2 = r.state.contentBlocks.find((b) => b.type === "tool_use");
  assert.equal(tu2?.type === "tool_use" ? tu2.input.content : null, "hel");

  const e3: SessionStreamEvent = {
    ...baseEvent(),
    seq: 3,
    baseSeq: 2,
    content: [toolBlock({ path: "/tmp/a.txt", content: "hello" }, 1)],
    snapshotContent: [toolBlock({ path: "/tmp/a.txt", content: "hello" }, 1)],
  };
  const ops3 = buildPatchOpsForContentDelta(e3);
  const append3 = ops3.filter(
    (o) =>
      o.o === "append" &&
      o.p === "/message/content/blocks/1/input/content" &&
      o.v === "lo",
  );
  assert.equal(append3.length, 1, "前缀增长应为 input/content append");

  r = reducer.applyPatch({
    sessionId: "se1",
    spaceId: "sp1",
    turnId: "turn1",
    seq: 3,
    baseSeq: 2,
    ops: ops3,
  });
  assert.equal(r.applied, true);
  const tu3 = r.state.contentBlocks.find((b) => b.type === "tool_use");
  assert.equal(tu3?.type === "tool_use" ? tu3.input.content : null, "hello");

  const e4: SessionStreamEvent = {
    ...baseEvent(),
    seq: 4,
    baseSeq: 3,
    content: [toolBlock({ path: "/tmp/a.txt", content: "hey" }, 1)],
    snapshotContent: [toolBlock({ path: "/tmp/a.txt", content: "hey" }, 1)],
  };
  const ops4 = buildPatchOpsForContentDelta(e4);
  const subReplace4 = ops4.filter(
    (o) =>
      o.o === "replace" &&
      o.p === "/message/content/blocks/1/input/content" &&
      o.v === "hey",
  );
  assert.equal(subReplace4.length, 1, "非前缀改写应为子路径 replace");

  r = reducer.applyPatch({
    sessionId: "se1",
    spaceId: "sp1",
    turnId: "turn1",
    seq: 4,
    baseSeq: 3,
    ops: ops4,
  });
  assert.equal(r.applied, true);
  const tu4 = r.state.contentBlocks.find((b) => b.type === "tool_use");
  assert.equal(tu4?.type === "tool_use" ? tu4.input.content : null, "hey");

  const e5: SessionStreamEvent = {
    ...baseEvent(),
    seq: 5,
    baseSeq: 0,
    content: [toolBlock({ path: "/b", content: "x" }, 1)],
    snapshotContent: [toolBlock({ path: "/b", content: "x" }, 1)],
  };
  const ops5 = buildPatchOpsForContentDelta(e5);
  const replace5 = ops5.filter(
    (o) => o.o === "replace" && typeof o.p === "string" && /\/blocks\/1$/.test(o.p),
  );
  assert.ok(replace5.length >= 1, "新流首帧应有 tool 整块 replace");

  const rawToolBlock = (rawInput: string): ContentBlock => ({
    type: "tool_use",
    id: "toolu_raw",
    name: "bash",
    input: {},
    _meta: { streamIndex: 2, rawInput },
  });
  const rawBase = (): Omit<SessionStreamEvent, "seq" | "baseSeq" | "content"> => ({
    ...baseEvent(),
    turnId: "turn-raw",
    sourceMessageId: "um-raw",
    anchorUserMessageId: "um-raw",
  });
  const rawReducer = createSessionPatchReducer();
  rawReducer.start({ sessionId: "se1", spaceId: "sp1", turnId: "turn-raw" });

  const raw1: SessionStreamEvent = {
    ...rawBase(),
    seq: 1,
    baseSeq: 0,
    content: [rawToolBlock('{"command":"pnpm ')],
    snapshotContent: [rawToolBlock('{"command":"pnpm ')],
  };
  const rawOps1 = buildPatchOpsForContentDelta(raw1);
  let rawResult = rawReducer.applyPatch({
    sessionId: "se1",
    spaceId: "sp1",
    turnId: "turn-raw",
    seq: 1,
    baseSeq: 0,
    ops: rawOps1,
  });
  assert.equal(rawResult.applied, true);

  const raw2: SessionStreamEvent = {
    ...rawBase(),
    seq: 2,
    baseSeq: 1,
    content: [rawToolBlock('{"command":"pnpm --filter web typecheck"}')],
    snapshotContent: [rawToolBlock('{"command":"pnpm --filter web typecheck"}')],
  };
  const rawOps2 = buildPatchOpsForContentDelta(raw2);
  assert.deepEqual(
    rawOps2.filter((o) => o.o === "append" && o.p === "/message/content/blocks/2/_meta/rawInput"),
    [{ o: "append", p: "/message/content/blocks/2/_meta/rawInput", v: '--filter web typecheck"}' }],
    "rawInput 前缀增长应通过 append delta 传输",
  );
  rawResult = rawReducer.applyPatch({
    sessionId: "se1",
    spaceId: "sp1",
    turnId: "turn-raw",
    seq: 2,
    baseSeq: 1,
    ops: rawOps2,
  });
  assert.equal(rawResult.applied, true);
  const rawTool = rawResult.state.contentBlocks.find((b) => b.type === "tool_use" && b.id === "toolu_raw");
  assert.equal(rawTool?._meta?.rawInput, '{"command":"pnpm --filter web typecheck"}');

  console.log("session-patch-tool-use-content: ok");
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
