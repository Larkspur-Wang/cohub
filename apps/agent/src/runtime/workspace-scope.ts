import { lstat, realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { env } from "../env.js";
import { getAgentWorkspacePath } from "./paths.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHORT_UUID_REGEX = /^[0-9a-f]{32}$/i;
const WORKSPACE_PATH = "/workspace";

export type WorkspaceScope = {
  spaceId: string;
  root: string;
  rootReal: string;
};

export function assertValidSpaceId(spaceId: string) {
  const value = spaceId.trim();
  if (!value || (!UUID_REGEX.test(value) && !SHORT_UUID_REGEX.test(value))) {
    throw new Error(`Invalid space id: ${spaceId}`);
  }
  return value;
}

export function assertInsideRoot(target: string, root: string, message = "Path outside workspace is not allowed.") {
  const normalizedTarget = resolve(target);
  const normalizedRoot = resolve(root);
  const rootWithSep = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
  if (normalizedTarget === normalizedRoot || normalizedTarget.startsWith(rootWithSep)) return;
  throw new Error(message);
}

export async function createWorkspaceScope(spaceId: string): Promise<WorkspaceScope> {
  const validSpaceId = assertValidSpaceId(spaceId);
  const root = getAgentWorkspacePath(validSpaceId);
  const rootReal = await realpath(root).catch(() => {
    throw new Error(`Workspace directory not found for space ${validSpaceId}.`);
  });

  const storageRootReal = await realpath(env.WORKSPACE_ROOT).catch(() => resolve(env.WORKSPACE_ROOT));
  assertInsideRoot(rootReal, storageRootReal, "Workspace path is outside storage root.");
  return { spaceId: validSpaceId, root, rootReal };
}

export function normalizeWorkspaceInputPath(input?: string): string {
  const raw = input?.trim() || ".";
  if (raw.includes("\0")) throw new Error("Path contains invalid characters.");
  if (raw.includes("\\")) throw new Error("Path cannot contain backslashes.");

  let relativePath: string;
  if (raw.startsWith("/")) {
    if (raw !== WORKSPACE_PATH && !raw.startsWith(`${WORKSPACE_PATH}/`)) {
      throw new Error("Only relative paths or /workspace paths are supported.");
    }
    relativePath = raw === WORKSPACE_PATH ? "." : raw.slice(WORKSPACE_PATH.length + 1);
  } else {
    relativePath = raw;
  }

  const parts = relativePath.split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.some((part) => part === "..")) throw new Error("Path cannot contain '..'.");
  return parts.join("/") || ".";
}

export async function resolveExistingWorkspacePath(scope: WorkspaceScope, inputPath?: string) {
  const relativePath = normalizeWorkspaceInputPath(inputPath);
  const lexicalTarget = resolve(scope.rootReal, relativePath === "." ? "" : relativePath);
  assertInsideRoot(lexicalTarget, scope.rootReal);

  const realPath = await realpath(lexicalTarget).catch(() => null);
  if (!realPath) throw new Error(`Path not found: ${toWorkspaceDisplayPath(relativePath)}`);
  assertInsideRoot(realPath, scope.rootReal);
  return { absolutePath: lexicalTarget, realPath, relativePath };
}

export async function assertResolvedOutputInsideWorkspace(scope: WorkspaceScope, absolutePath: string) {
  const real = await realpath(absolutePath).catch(() => null);
  if (!real) return null;
  try {
    assertInsideRoot(real, scope.rootReal);
    return real;
  } catch {
    return null;
  }
}

export function toWorkspaceRelative(scope: WorkspaceScope, absolutePath: string) {
  return relative(scope.rootReal, absolutePath).replace(/\\/g, "/") || ".";
}

export function toWorkspaceDisplayPath(relativePath: string) {
  return relativePath === "." ? WORKSPACE_PATH : `${WORKSPACE_PATH}/${relativePath}`;
}

export async function safeLstatWorkspacePath(scope: WorkspaceScope, inputPath?: string) {
  const resolved = await resolveExistingWorkspacePath(scope, inputPath);
  const info = await lstat(resolved.absolutePath);
  return { ...resolved, info };
}

export async function safeStatWorkspacePath(scope: WorkspaceScope, inputPath?: string) {
  const resolved = await resolveExistingWorkspacePath(scope, inputPath);
  const info = await stat(resolved.realPath);
  return { ...resolved, info };
}
