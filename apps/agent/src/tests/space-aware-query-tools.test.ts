import assert from "node:assert/strict";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getCurrentToolExecutionContext, runWithToolExecutionContext } from "../tool-context.js";
import { createSpaceAwareReadTool } from "../runtime/tools/space-aware-query-tools.js";
import type { AgentFileVisibility } from "../runtime/workspace-visibility.js";

function createStubTool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: {} as never,
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: name }],
        details: { params, spaceId: getCurrentToolExecutionContext()?.spaceId },
      };
    },
  } as AgentTool;
}

async function runReadTool(input: {
  targetProvider: "cloud" | "local";
  visibility?: AgentFileVisibility;
}) {
  const tool = createSpaceAwareReadTool({
    sandboxTool: createStubTool("sandbox"),
    crossSpaceTool: createStubTool("pvc"),
    checkAccess: async () => input.visibility ?? "full",
    resolveSandboxProvider: async () => input.targetProvider,
  });

  return runWithToolExecutionContext({ spaceId: "space-a", sessionId: "session-a" }, () =>
    tool.execute("tool-call-a", { path: "README.md", space_id: "space-b" }));
}

const cloudResult = await runReadTool({ targetProvider: "cloud" });
assert.equal(cloudResult.content[0]?.type, "text");
assert.equal(cloudResult.content[0]?.text, "pvc");
assert.deepEqual(cloudResult.details, { params: { path: "README.md" }, spaceId: "space-b" });

const localResult = await runReadTool({ targetProvider: "local" });
assert.equal(localResult.content[0]?.type, "text");
assert.equal(localResult.content[0]?.text, "sandbox");
assert.deepEqual(localResult.details, { params: { path: "README.md" }, spaceId: "space-b" });

await assert.rejects(
  runReadTool({ targetProvider: "local", visibility: "filtered" }),
  /Filtered file access is not available for local sandboxes\./,
);

console.log("space-aware query tool routing checks passed");
