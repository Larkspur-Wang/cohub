import { normalize as normalizePosix } from "node:path/posix";

const WORKSPACE_ROOT = "/workspace";
const CROSS_SPACE_PATH_ERROR = "Cross-space path must stay within /workspace.";

function normalizeCrossSpacePath(path: string) {
  const normalized = normalizePosix(path.startsWith("/") ? path : `${WORKSPACE_ROOT}/${path}`);
  return normalized === "" ? "/" : normalized;
}

export function assertCrossSpaceQueryPathAllowed(path: unknown): void {
  if (path == null) return;
  if (typeof path !== "string") {
    throw new Error(CROSS_SPACE_PATH_ERROR);
  }

  const trimmed = path.trim();
  if (trimmed === "") return;
  if (trimmed.includes("\\")) {
    throw new Error(CROSS_SPACE_PATH_ERROR);
  }

  const normalized = normalizeCrossSpacePath(trimmed);
  if (normalized !== WORKSPACE_ROOT && !normalized.startsWith(`${WORKSPACE_ROOT}/`)) {
    throw new Error(CROSS_SPACE_PATH_ERROR);
  }
}
