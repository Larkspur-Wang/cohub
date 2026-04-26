import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { env } from "../env.js";

// Standard UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Short UUID (no hyphens): xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
const SHORT_UUID_REGEX = /^[0-9a-f]{32}$/i;

function isValidId(value: string): boolean {
  return UUID_REGEX.test(value) || SHORT_UUID_REGEX.test(value);
}

function assertValidUserId(userId: string) {
  const value = userId.trim();
  if (!isValidId(value)) {
    throw new Error(`Invalid userId: ${userId}`);
  }
  return value;
}

export const SANDBOX_WORKSPACE_PATH = "/workspace";
export const SANDBOX_PLATFORM_CONFIG_PATH = "/configs/platform";
export const SANDBOX_PLATFORM_AGENT_PATH = `${SANDBOX_PLATFORM_CONFIG_PATH}/.pi/agent`;
export const SANDBOX_PLATFORM_AGENTS_PATH = `${SANDBOX_PLATFORM_CONFIG_PATH}/.agents`;
export const SANDBOX_PLATFORM_SKILLS_PATH = `${SANDBOX_PLATFORM_AGENTS_PATH}/skills`;
export const SANDBOX_USER_CONFIG_PATH = "/configs/user";
export const SANDBOX_USER_AGENT_PATH = `${SANDBOX_USER_CONFIG_PATH}/.pi/agent`;
export const SANDBOX_USER_AGENTS_PATH = `${SANDBOX_USER_CONFIG_PATH}/.agents`;
export const SANDBOX_USER_SKILLS_PATH = `${SANDBOX_USER_AGENTS_PATH}/skills`;
export const SANDBOX_WORKSPACE_AGENTS_PATH = `${SANDBOX_WORKSPACE_PATH}/.agents`;
export const SANDBOX_WORKSPACE_SKILLS_PATH = `${SANDBOX_WORKSPACE_AGENTS_PATH}/skills`;

export function getAgentPlatformConfigPath() {
  return join(env.PLATFORM_CONFIG_ROOT, "platform");
}

export function getAgentPlatformAgentPath() {
  return join(getAgentPlatformConfigPath(), ".pi", "agent");
}

export function getAgentPlatformAgentsPath() {
  return join(getAgentPlatformConfigPath(), ".agents");
}

export function getAgentPlatformSkillsPath() {
  return join(getAgentPlatformAgentsPath(), "skills");
}

export function getAgentPlatformModelsPath() {
  return join(getAgentPlatformAgentPath(), "models.json");
}

export function getAgentPlatformAuthPath() {
  return join(getAgentPlatformAgentPath(), "auth.json");
}

export function getAgentUserConfigPath(userId: string) {
  return join(env.PLATFORM_CONFIG_ROOT, "users", assertValidUserId(userId));
}

export function getAgentUserAgentPath(userId: string) {
  return join(getAgentUserConfigPath(userId), ".pi", "agent");
}

export function getAgentUserAgentsPath(userId: string) {
  return join(getAgentUserConfigPath(userId), ".agents");
}

export function getAgentUserSkillsPath(userId: string) {
  return join(getAgentUserAgentsPath(userId), "skills");
}

export function getAgentUserModelsPath(userId: string) {
  return join(getAgentUserAgentPath(userId), "models.json");
}

export function getAgentWorkspacePath(spaceId: string) {
  return join(env.WORKSPACE_ROOT, spaceId, "workspace");
}

export function getAgentWorkspaceAgentsPath(spaceIdOrWorkspacePath: string) {
  const workspacePath = spaceIdOrWorkspacePath.startsWith("/")
    ? spaceIdOrWorkspacePath
    : getAgentWorkspacePath(spaceIdOrWorkspacePath);
  return join(workspacePath, ".agents");
}

export function getAgentWorkspaceSkillsPath(spaceIdOrWorkspacePath: string) {
  return join(getAgentWorkspaceAgentsPath(spaceIdOrWorkspacePath), "skills");
}

export function getAgentSpaceSessionsPath(spaceId: string) {
  return join(env.SESSIONS_DIR, "spaces", spaceId);
}

export function getAgentSessionFilePath(spaceId: string, sessionId: string) {
  return join(getAgentSpaceSessionsPath(spaceId), `${sessionId}.jsonl`);
}

export async function ensureAgentSpaceSessionPath(spaceId: string) {
  await mkdir(getAgentSpaceSessionsPath(spaceId), { recursive: true }).catch(() => undefined);
}
