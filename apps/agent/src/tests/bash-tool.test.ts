import assert from "node:assert/strict";
import test from "node:test";
import { createBashTool } from "../runtime/tools/basic-tools.js";

const CWD = "/workspace";

test("bash hides the background execution parameter from its schema", () => {
  const tool = createBashTool(CWD, { operations: { async exec() { return { exitCode: 0 }; } } });
  const schema = tool.parameters as { properties?: Record<string, unknown> };

  assert.deepEqual(Object.keys(schema.properties ?? {}), ["command", "timeout"]);
  assert.doesNotMatch(tool.description, /run_in_background/);
});

test("bash keeps compatibility with the hidden background parameter", async () => {
  let request: { command: string; cwd: string; timeout?: number; toolCallId: string } | undefined;
  const tool = createBashTool(CWD, {
    operations: {
      async exec() {
        throw new Error("Foreground execution must not be used");
      },
      async startBackground(input) {
        request = input;
        return { taskRunId: "task-1" };
      },
    },
  });

  const result = await tool.execute("call-1", {
    command: "pnpm test",
    timeout: 12.8,
    run_in_background: true,
  });

  assert.equal(request?.command, "pnpm test");
  assert.equal(request?.cwd, CWD);
  assert.equal(request?.timeout, 12);
  assert.equal(request?.toolCallId, "call-1");
  assert.match(result.content[0]?.type === "text" ? result.content[0].text : "", /Task ID: task-1/);
});
