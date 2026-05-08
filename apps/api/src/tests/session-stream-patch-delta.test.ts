import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { SessionStreamEvent } from "@neta-art/cohub-protocol/realtime";
import { buildPatchOpsForContentDelta } from "../session-stream-patch-delta.js";

const baseEvent = (overrides: Partial<SessionStreamEvent>): SessionStreamEvent => ({
  type: "stream_update",
  spaceId: "space-1",
  sessionId: "session-1",
  turnId: "turn-1",
  seq: 1,
  baseSeq: 0,
  content: [],
  snapshotContent: [],
  messageId: null,
  messageOrdinal: null,
  sourceMessageId: null,
  timestamp: 1,
  anchorUserMessageId: null,
  ...overrides,
});

const commandBlock = (command: string): ContentBlock => ({
  type: "tool_use",
  id: "tool-1",
  name: "bash",
  input: { command },
  _meta: { streamIndex: 0 },
});

test("patch delta state is isolated for different messages in the same turn", () => {
  buildPatchOpsForContentDelta({
    event: baseEvent({
      messageId: "read-message",
      messageOrdinal: 0,
      anchorUserMessageId: "read-anchor",
      content: [{ type: "text", text: "reading skill", _meta: { streamIndex: 0 } }],
      snapshotContent: [{ type: "text", text: "reading skill", _meta: { streamIndex: 0 } }],
    }),
  });

  const commandPrefix = "node ./.neta/bin/neta narrating import <<'NARRATING_JSON'\n{\n  \"worldName\":";
  const commandWithPrologueStart = `${commandPrefix} "裂星边疆",\n  "prologue": "当跃迁航道被黑潮般的群体意识侵蚀，边疆`;
  const commandWithPrologue = `${commandPrefix} "裂星边疆",\n  "prologue": "当跃迁航道被黑潮般的群体意识侵蚀，边疆星系不再由国界划分`;

  buildPatchOpsForContentDelta({
    event: baseEvent({
      seq: 1,
      baseSeq: 0,
      messageId: "bash-message",
      messageOrdinal: 1,
      anchorUserMessageId: "bash-anchor",
      content: [commandBlock(commandPrefix)],
      snapshotContent: [commandBlock(commandPrefix)],
    }),
  });

  buildPatchOpsForContentDelta({
    event: baseEvent({
      seq: 2,
      baseSeq: 1,
      messageId: "bash-message",
      messageOrdinal: 1,
      anchorUserMessageId: "bash-anchor",
      content: [commandBlock(commandWithPrologueStart)],
      snapshotContent: [commandBlock(commandWithPrologueStart)],
    }),
  });

  const ops = buildPatchOpsForContentDelta({
    event: baseEvent({
      seq: 3,
      baseSeq: 2,
      messageId: "bash-message",
      messageOrdinal: 1,
      anchorUserMessageId: "bash-anchor",
      content: [commandBlock(commandWithPrologue)],
      snapshotContent: [commandBlock(commandWithPrologue)],
    }),
  });

  assert.deepEqual(ops, [{ v: "星系不再由国界划分" }]);
});

test("patch delta state is isolated by anchor when message identity is unavailable", () => {
  const firstAnchorCommand = "node read skill";
  const secondAnchorPrefix = "node narrating <<'JSON'\n{\n  \"worldName\":";
  const secondAnchorNext = `${secondAnchorPrefix} "裂星边疆"`;

  buildPatchOpsForContentDelta({
    event: baseEvent({
      seq: 1,
      baseSeq: 0,
      anchorUserMessageId: "first-anchor",
      content: [commandBlock(firstAnchorCommand)],
      snapshotContent: [commandBlock(firstAnchorCommand)],
    }),
  });

  buildPatchOpsForContentDelta({
    event: baseEvent({
      seq: 1,
      baseSeq: 0,
      anchorUserMessageId: "second-anchor",
      content: [commandBlock(secondAnchorPrefix)],
      snapshotContent: [commandBlock(secondAnchorPrefix)],
    }),
  });

  const ops = buildPatchOpsForContentDelta({
    event: baseEvent({
      seq: 2,
      baseSeq: 1,
      anchorUserMessageId: "second-anchor",
      content: [commandBlock(secondAnchorNext)],
      snapshotContent: [commandBlock(secondAnchorNext)],
    }),
  });

  assert.deepEqual(ops, [{ o: "append", p: "/message/content/blocks/0/input/command", v: " \"裂星边疆\"" }]);
});
