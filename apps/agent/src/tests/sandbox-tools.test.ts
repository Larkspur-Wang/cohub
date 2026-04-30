import assert from "node:assert/strict";

process.env.SESSIONS_NAMESPACE ??= "test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.WORKSPACE_ROOT ??= "/tmp";
process.env.SESSIONS_DIR ??= "/tmp";
process.env.PLATFORM_CONFIG_ROOT ??= "/tmp";
process.env.ENV ??= "dev";
process.env.AGENT_INSTANCE_ID ??= "test-agent";

const { createSandboxCodingTools } = await import("../sandbox/tools.js");

assert.equal(
  createSandboxCodingTools().some((tool) => tool.name === "feishu_fetch_doc"),
  false,
  "base sandbox tools should not include feishu_fetch_doc",
);

assert.equal(
  createSandboxCodingTools({ feishu: true }).some((tool) => tool.name === "feishu_fetch_doc"),
  true,
  "Feishu-capable spaces should include feishu_fetch_doc",
);

console.log("sandbox tool capability checks passed");
process.exit(0);
