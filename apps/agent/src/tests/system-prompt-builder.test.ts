import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SESSIONS_NAMESPACE ??= "test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.WORKSPACE_ROOT ??= "/tmp";
process.env.SESSIONS_DIR ??= "/tmp";
process.env.ENV ??= "dev";

const root = await mkdtemp(join(tmpdir(), "cohub-system-prompt-"));
process.env.PLATFORM_CONFIG_ROOT = join(root, "configs");

const userId = "11111111-1111-4111-8111-111111111111";
const workspace = join(root, "workspace");
const userConfig = join(process.env.PLATFORM_CONFIG_ROOT, "users", userId);
const platformAgent = join(process.env.PLATFORM_CONFIG_ROOT, "platform", ".cohub");

await mkdir(workspace, { recursive: true });
await mkdir(userConfig, { recursive: true });
await mkdir(platformAgent, { recursive: true });
await writeFile(join(platformAgent, "SYSTEM.md"), "You are a Cohub test assistant.");
await writeFile(join(userConfig, "AGENTS.md"), "Always prefer concise answers.");
await writeFile(join(workspace, "AGENTS.md"), "Project rule: run typecheck.");

const { buildCohubSystemPrompt } = await import("../runtime/system-prompt-builder.js");

const prompt = await buildCohubSystemPrompt({
  cwd: workspace,
  userId,
  selectedTools: [],
});

assert.ok(prompt.includes("# User Context"), "should include user context section");
assert.ok(prompt.includes("/configs/user/AGENTS.md"), "should expose sandbox user rule path");
assert.ok(prompt.includes("Always prefer concise answers."), "should include user rules content");
assert.ok(prompt.includes("# Project Context"), "should include project context section");
assert.ok(prompt.includes("Project rule: run typecheck."), "should include project rules content");
assert.ok(
  prompt.indexOf("# User Context") < prompt.indexOf("# Project Context"),
  "user context should be rendered before project context",
);

const promptWithoutUser = await buildCohubSystemPrompt({
  cwd: workspace,
  selectedTools: [],
});
assert.ok(!promptWithoutUser.includes("# User Context"), "should not include user context without userId");
assert.ok(promptWithoutUser.includes("# Project Context"), "should still include project context without userId");
