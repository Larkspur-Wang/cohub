import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRunCommandExecutionContext } from "../src/tasks/run-command-context.js";

const CLIENT_ID = "client_12345678";

test("parses background command client and model context", () => {
  assert.deepEqual(parseRunCommandExecutionContext({
    sourceClientId: ` ${CLIENT_ID} `,
    model: { provider: " cohub ", id: " gpt-5 " },
  }), {
    sourceClientId: CLIENT_ID,
    model: { provider: "cohub", id: "gpt-5" },
  });
});

test("keeps legacy and malformed background command context empty", () => {
  assert.deepEqual(parseRunCommandExecutionContext({}), {
    sourceClientId: null,
    model: null,
  });
  assert.deepEqual(parseRunCommandExecutionContext({
    sourceClientId: "invalid client id",
    model: { provider: "cohub" },
  }), {
    sourceClientId: null,
    model: null,
  });
});
