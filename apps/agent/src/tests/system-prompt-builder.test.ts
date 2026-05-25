import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SESSIONS_NAMESPACE ??= "test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.WORKSPACE_ROOT ??= "/tmp";
process.env.SESSIONS_DIR ??= "/tmp";
process.env.ENV ??= "dev";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const root = await mkdtemp(join(tmpdir(), "cohub-system-prompt-"));
process.env.PLATFORM_CONFIG_ROOT = join(root, "configs");
process.env.WORKSPACE_ROOT = join(root, "workspaces");

const userId = "11111111-1111-4111-8111-111111111111";
const workspace = join(root, "workspace");
const modSpaceId = "22222222-2222-4222-8222-222222222222";
const modWorkspace = join(root, "workspaces", modSpaceId, "workspace");
const userConfig = join(process.env.PLATFORM_CONFIG_ROOT, "users", userId);
const platformAgent = join(process.env.PLATFORM_CONFIG_ROOT, "platform", ".cohub");

await mkdir(workspace, { recursive: true });
await mkdir(userConfig, { recursive: true });
await mkdir(platformAgent, { recursive: true });
await mkdir(join(modWorkspace, ".agents", "skills", "mod-skill"), { recursive: true });
await writeFile(join(platformAgent, "SYSTEM.md"), "You are a Cohub test assistant.");
await writeFile(join(userConfig, "AGENTS.md"), "Always prefer concise answers.");
await writeFile(join(workspace, "AGENTS.md"), "Project rule: run typecheck.");
await writeFile(join(modWorkspace, "AGENTS.md"), "Mod rule: use shared defaults.");
await writeFile(join(modWorkspace, ".agents", "skills", "mod-skill", "SKILL.md"), "---\nname: mod-skill\ndescription: Shared mod skill.\n---\nUse the shared mod skill.");

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

const promptWithMod = await buildCohubSystemPrompt({
  cwd: workspace,
  selectedTools: ["read", "ls", "find", "grep"],
  spaceMods: [{
    id: "33333333-3333-4333-8333-333333333333",
    spaceId: "44444444-4444-4444-8444-444444444444",
    modSpaceId,
    enabled: true,
    sortOrder: 0,
    createdBy: userId,
    createdAt: null,
    updatedAt: null,
    modSpaceName: "Shared Defaults",
    modSpaceDescription: null,
  }],
});
assert.ok(promptWithMod.includes('Each item is "name: space_id".'), "should explain mod list format once");
assert.ok(promptWithMod.includes(`- Shared Defaults: ${modSpaceId}`), "should list mod name and id compactly");
assert.ok(promptWithMod.includes("<space_id>22222222-2222-4222-8222-222222222222</space_id>"), "should include skill space_id");
assert.ok(promptWithMod.includes("<location>/workspace/.agents/skills/mod-skill/SKILL.md</location>"), "should use workspace skill path");
assert.ok(!promptWithMod.includes("/mods"), "should not reference mod mount paths");
