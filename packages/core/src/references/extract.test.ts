import assert from "node:assert/strict";
import { test } from "node:test";
import type { ContentBlock } from "@cohub/protocol/core";
import { extractTurnReferences } from "./extract.js";
import { parseMentions } from "./mentions.js";

const SPACE = "11111111-1111-1111-1111-111111111111";
const SESSION = "22222222-2222-2222-2222-222222222222";
const TURN = "33333333-3333-3333-3333-333333333333";
const OTHER_SPACE = "44444444-4444-4444-4444-444444444444";
const OTHER_SESSION = "55555555-5555-5555-5555-555555555555";
const USER = "user-abc";

const spaceMentionUri = (spaceId: string, sessionId?: string) =>
  sessionId
    ? `cohub://spaces/${spaceId}/sessions/${sessionId}`
    : `cohub://spaces/${spaceId}`;

test("parseMentions extracts space and session mentions", () => {
  const text = `See @[Core](${spaceMentionUri(OTHER_SPACE)}) and @[Fork](${spaceMentionUri(OTHER_SPACE, OTHER_SESSION)}).`;
  assert.deepEqual(parseMentions(text), [
    { spaceId: OTHER_SPACE, label: "Core" },
    { spaceId: OTHER_SPACE, sessionId: OTHER_SESSION, label: "Fork" },
  ]);
});

test("participant reference is emitted for the turn author", () => {
  const refs = extractTurnReferences({
    spaceId: SPACE,
    sessionId: SESSION,
    turnId: TURN,
    userUuid: USER,
  });
  assert.equal(refs.length, 1);
  assert.deepEqual(refs[0], {
    kind: "participant",
    sourceType: "user",
    sourceId: USER,
    sourceTurnId: TURN,
    targetType: "session",
    targetId: SESSION,
    spaceId: SPACE,
    sessionId: SESSION,
  });
});

test("mentions in user content become references, self-session skipped", () => {
  const userContent: ContentBlock[] = [
    {
      type: "text",
      text: `Look at @[Core](${spaceMentionUri(OTHER_SPACE)}) and @[Self](${spaceMentionUri(SPACE, SESSION)})`,
    },
  ];
  const refs = extractTurnReferences({
    spaceId: SPACE,
    sessionId: SESSION,
    turnId: TURN,
    userContent,
  });
  const mentions = refs.filter((r) => r.kind === "mention");
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0]?.targetType, "space");
  assert.equal(mentions[0]?.targetId, OTHER_SPACE);
});

test("repeated mention of the same target increments count", () => {
  const userContent: ContentBlock[] = [
    {
      type: "text",
      text: `@[A](${spaceMentionUri(OTHER_SPACE)}) then @[A again](${spaceMentionUri(OTHER_SPACE)})`,
    },
  ];
  const refs = extractTurnReferences({
    spaceId: SPACE,
    sessionId: SESSION,
    turnId: TURN,
    userContent,
  });
  const mentions = refs.filter((r) => r.kind === "mention");
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0]?.count, 2);
});

test("cross-resource tool calls become tool_call references", () => {
  const assistantContent: ContentBlock[] = [
    { type: "tool_use", id: "t1", name: "space_sessions", input: { spaceId: OTHER_SPACE } },
    { type: "tool_use", id: "t2", name: "read", input: { path: "/a.txt" } },
    { type: "tool_use", id: "t3", name: "prompt", input: { spaceId: SPACE, sessionId: OTHER_SESSION } },
    { type: "tool_use", id: "t4", name: "space_self", input: { spaceId: SPACE } },
  ];
  const refs = extractTurnReferences({
    spaceId: SPACE,
    sessionId: SESSION,
    turnId: TURN,
    assistantContent,
  });
  const toolCalls = refs.filter((r) => r.kind === "tool_call");
  // t1 -> other space; t3 -> other session; t2 has no target; t4 targets self space.
  assert.equal(toolCalls.length, 2);
  const targets = toolCalls.map((r) => `${r.targetType}:${r.targetId}`).sort();
  assert.deepEqual(targets, [`session:${OTHER_SESSION}`, `space:${OTHER_SPACE}`].sort());
});

test("extraction is deterministic and combines all signals", () => {
  const source = {
    spaceId: SPACE,
    sessionId: SESSION,
    turnId: TURN,
    userUuid: USER,
    userContent: [
      { type: "text", text: `@[Core](${spaceMentionUri(OTHER_SPACE)})` },
    ] as ContentBlock[],
    assistantContent: [
      { type: "tool_use", id: "t1", name: "space_sessions", input: { sessionId: OTHER_SESSION } },
    ] as ContentBlock[],
  };
  const a = extractTurnReferences(source);
  const b = extractTurnReferences(source);
  assert.deepEqual(a, b);
  const kinds = a.map((r) => r.kind).sort();
  assert.deepEqual(kinds, ["mention", "participant", "tool_call"]);
});
