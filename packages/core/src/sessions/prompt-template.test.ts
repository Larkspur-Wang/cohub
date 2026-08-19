import assert from "node:assert/strict";
import test from "node:test";
import { expandPromptContent } from "./prompt.js";
import { renderPromptTemplate } from "./prompt-template.js";

test("renders Cohub IDs and prompt arguments", () => {
  const rendered = renderPromptTemplate(
    "Session {{cohub.session.id}} in {{ cohub.space.id }} for {{cohub.user.uuid}}: $1 / $@",
    ["first", "second"],
    { sessionId: "session-1", spaceId: "space-1", userUuid: "user-1" },
  );

  assert.equal(rendered, "Session session-1 in space-1 for user-1: first / first second");
});

test("preserves unknown and unavailable system variables", () => {
  const rendered = renderPromptTemplate(
    "{{cohub.session.id}} {{cohub.space.name}} {{other.value}}",
    [],
    { sessionId: null },
  );

  assert.equal(rendered, "{{cohub.session.id}} {{cohub.space.name}} {{other.value}}");
});

test("does not interpret system variables introduced through arguments", () => {
  const rendered = renderPromptTemplate("Value: $1", ["{{cohub.session.id}}"], { sessionId: "session-1" });
  assert.equal(rendered, "Value: {{cohub.session.id}}");
});

test("passes session context through prompt expansion", async () => {
  let receivedContext: Record<string, unknown> | undefined;
  await expandPromptContent({
    expandPromptTemplate: async (input) => {
      receivedContext = input;
      return null;
    },
  }, {
    content: [{ type: "text", text: "/handoff" }],
    userId: "user-1",
    spaceId: "space-1",
    sessionId: "session-1",
  });

  assert.deepEqual(receivedContext, {
    text: "/handoff",
    userId: "user-1",
    spaceId: "space-1",
    sessionId: "session-1",
  });
});
