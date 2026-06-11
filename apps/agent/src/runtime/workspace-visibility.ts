import ignore from "ignore";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type AgentFileVisibility = "full" | "filtered";

export type AgentWorkspaceVisibilityFilter = {
  visibility: AgentFileVisibility;
  isVisible(path: string, options?: { isDirectory?: boolean }): boolean;
  assertVisible(path: string, options?: { isDirectory?: boolean }): void;
};

const GIT_DIR_PATTERN = /^\.git(?:\/|$)/;
const FILTER_CACHE_TTL_MS = 5_000;
const normalizeFilterPath = (path: string) => {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\/$/, "");
  return normalized === "." ? "" : normalized;
};
const asDirectoryPath = (path: string) => path.endsWith("/") ? path : `${path}/`;

type CacheEntry = {
  expiresAt: number;
  promise: Promise<AgentWorkspaceVisibilityFilter>;
};

const filterCache = new Map<string, CacheEntry>();

function ancestorDirs(path: string) {
  const normalized = normalizeFilterPath(path);
  if (!normalized) return [""];
  const parts = normalized.split("/").filter(Boolean);
  const dirs = [""];
  const last = parts.at(-1) ?? "";
  const treatAsDirectory = path.endsWith("/") || !last.includes(".");
  const dirParts = treatAsDirectory ? parts : parts.slice(0, -1);
  for (let i = 1; i <= dirParts.length; i += 1) dirs.push(dirParts.slice(0, i).join("/"));
  return dirs;
}

function prefixGitignorePattern(base: string, rawLine: string) {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith("#")) return rawLine;

  const negated = trimmed.startsWith("!");
  const pattern = negated ? trimmed.slice(1) : trimmed;
  if (!base) return rawLine;

  const slashlessPattern = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  const anchored = slashlessPattern.includes("/");
  const prefixed = anchored ? `${base}/${slashlessPattern}` : `${base}/**/${slashlessPattern}`;
  return `${negated ? "!" : ""}${prefixed}`;
}

async function addGitignore(matcher: ReturnType<typeof ignore>, root: string, base: string) {
  let content: string;
  try {
    content = await readFile(join(root, base, ".gitignore"), "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    return;
  }

  matcher.add(content.split(/\r?\n/).map((line) => prefixGitignorePattern(base, line)).join("\n"));
}

async function buildFilteredWorkspaceVisibility(root: string, basePath: string): Promise<AgentWorkspaceVisibilityFilter> {
  const matcher = ignore();

  for (const base of ancestorDirs(basePath)) {
    if (base && (GIT_DIR_PATTERN.test(base) || matcher.ignores(base) || matcher.ignores(asDirectoryPath(base)))) break;
    await addGitignore(matcher, root, base);
  }

  const isVisible = (path: string, options?: { isDirectory?: boolean }) => {
    const normalized = normalizeFilterPath(path);
    return normalized.length === 0 || !(
      GIT_DIR_PATTERN.test(normalized)
      || matcher.ignores(normalized)
      || (options?.isDirectory === true && matcher.ignores(asDirectoryPath(normalized)))
    );
  };

  return {
    visibility: "filtered",
    isVisible,
    assertVisible(path, options) {
      if (!isVisible(path, options)) throw new Error("Access denied.");
    },
  };
}

function createFullWorkspaceVisibility(): AgentWorkspaceVisibilityFilter {
  return {
    visibility: "full",
    isVisible: () => true,
    assertVisible: () => undefined,
  };
}

export async function createWorkspaceVisibilityFilter(
  root: string,
  visibility: AgentFileVisibility,
  basePath = "",
): Promise<AgentWorkspaceVisibilityFilter> {
  if (visibility === "full") return createFullWorkspaceVisibility();

  const normalizedBase = normalizeFilterPath(basePath);
  const key = `${root}:filtered:${normalizedBase}`;
  const now = Date.now();
  const cached = filterCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = buildFilteredWorkspaceVisibility(root, normalizedBase);
  filterCache.set(key, { expiresAt: now + FILTER_CACHE_TTL_MS, promise });
  promise.catch(() => {
    if (filterCache.get(key)?.promise === promise) filterCache.delete(key);
  });
  return promise;
}
