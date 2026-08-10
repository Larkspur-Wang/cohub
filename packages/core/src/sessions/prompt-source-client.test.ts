import assert from "node:assert/strict";
import test from "node:test";
import type { SessionPromptDependencies, SubmitSessionPromptInput } from "./prompt.js";
import { submitSessionPrompt } from "./prompt.js";

const CLIENT_ID = "abc123def456abc789def012";

const createInput = (sourceClientId: string | null): SubmitSessionPromptInput => ({
  spaceId: "space-1",
  sessionId: "session-1",
  userId: "user-1",
  clientMessageId: "message-1",
  content: [{ type: "text", text: "Hello" }],
  source: "web",
  sourceClientId,
});

const captureTurnMeta = async (sourceClientId: string | null) => {
  const turnMetas: Record<string, unknown>[] = [];
  const deps: SessionPromptDependencies = {
    randomUUID: () => "message-id",
    expandPromptTemplate: async () => null,
    createSessionTurn: async (input) => {
      turnMetas.push(input.meta);
      return { id: "turn-id" };
    },
    enqueueSpacePrompt: async () => undefined,
    failSessionTurn: async () => undefined,
  };

  await submitSessionPrompt(deps, createInput(sourceClientId));
  return turnMetas[0];
};

test("prompt meta keeps source and source client id as sibling fields", async () => {
  const meta = await captureTurnMeta(` ${CLIENT_ID} `);
  assert.equal(meta?.source, "web");
  assert.equal(meta?.sourceClientId, CLIENT_ID);
});

test("prompt meta rejects an invalid source client id", async () => {
  const meta = await captureTurnMeta("invalid client id");
  assert.equal(meta?.source, "web");
  assert.equal(meta?.sourceClientId, undefined);
});
