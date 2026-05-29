import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getCurrentToolExecutionContext } from "../../tool-context.js";
import {
  assertResolvedOutputInsideWorkspace,
  createWorkspaceScope,
  normalizeWorkspaceInputPath,
  resolveExistingWorkspacePath,
  safeLstatWorkspacePath,
  toWorkspaceDisplayPath,
  toWorkspaceRelative,
  type WorkspaceScope,
} from "../workspace-scope.js";
import {
  createFindTool,
  createGrepToolDefinition,
  createLsTool,
  createReadTool,
  type FindOperations,
  type GrepToolInput,
  type LsOperations,
  type ReadOperations,
} from "./index.js";
import {
  detectReadImageMimeType,
  detectUnsupportedReadImageMimeType,
  isSupportedReadImageMimeType,
  unsupportedReadImageMimeTypeMessage,
} from "./read-file-types.js";
import { formatRgJsonGrepResult } from "./grep-json-format.js";

const execFileAsync = promisify(execFile);
const SANDBOX_WORKSPACE_PATH = "/workspace";
const MAX_BUFFER = 10 * 1024 * 1024;
type ExecError = { code?: number | string; stdout?: string; stderr?: string; message?: string };

function getCurrentSpaceId() {
  const ctx = getCurrentToolExecutionContext();
  if (!ctx?.spaceId) throw new Error("Tool execution context is missing spaceId");
  return ctx.spaceId;
}

async function getCurrentWorkspaceScope() {
  return createWorkspaceScope(getCurrentSpaceId());
}

function toWorkspaceInputPath(path?: string) {
  const value = path?.trim() || ".";
  if (!value.startsWith("/")) return value;
  if (value === SANDBOX_WORKSPACE_PATH || value.startsWith(`${SANDBOX_WORKSPACE_PATH}/`)) return value;
  throw new Error("Only /workspace paths are supported.");
}

async function resolveToolPath(path: string) {
  const scope = await getCurrentWorkspaceScope();
  return resolveExistingWorkspacePath(scope, toWorkspaceInputPath(path));
}

function normalizeExecError(error: unknown, tool: string) {
  const err = error as ExecError;
  if (err?.code === "ENOENT") throw new Error(`${tool} is not installed in agent image.`);
  throw new Error((err?.stderr || err?.message || String(error)).trim());
}

async function runFd(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("fd", args, { cwd, maxBuffer: MAX_BUFFER });
    return stdout;
  } catch (error) {
    normalizeExecError(error, "fd");
    return "";
  }
}

async function runRg(args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  try {
    const { stdout } = await execFileAsync("rg", args, { cwd, maxBuffer: MAX_BUFFER, signal });
    return stdout;
  } catch (error) {
    const err = error as ExecError;
    if (err?.code === 1) return err.stdout ?? "";
    normalizeExecError(error, "rg");
    return "";
  }
}

function splitNonEmptyLines(output: string) {
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function filterWorkspaceRelativeResults(scope: WorkspaceScope, baseRealPath: string, lines: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const rel = normalizeWorkspaceInputPath(line);
    const abs = resolve(scope.rootReal, rel === "." ? "" : rel);
    const real = await assertResolvedOutputInsideWorkspace(scope, abs);
    if (!real) continue;
    const display = toWorkspaceRelative({ ...scope, rootReal: baseRealPath }, abs);
    if (!seen.has(display)) {
      seen.add(display);
      out.push(display);
    }
  }
  return out;
}

async function assertRgJsonLinesInsideWorkspace(scope: WorkspaceScope, lines: string[]) {
  const checked = new Set<string>();
  for (const rawLine of lines) {
    let event: { type?: string; data?: { path?: { text?: string } } };
    try {
      event = JSON.parse(rawLine) as { type?: string; data?: { path?: { text?: string } } };
    } catch {
      continue;
    }
    if (event.type !== "match" && event.type !== "context") continue;
    const filePath = event.data?.path?.text;
    if (!filePath || checked.has(filePath)) continue;
    checked.add(filePath);
    const rel = normalizeWorkspaceInputPath(filePath);
    const abs = resolve(scope.rootReal, rel === "." ? "" : rel);
    const real = await assertResolvedOutputInsideWorkspace(scope, abs);
    if (!real) throw new Error("Path outside workspace is not allowed.");
  }
}

export function createLocalCrossSpaceReadTool(): AgentTool {
  const operations: ReadOperations = {
    async readFile(absolutePath) {
      const resolved = await resolveToolPath(absolutePath);
      return readFile(resolved.realPath);
    },
    async access(absolutePath) {
      const resolved = await resolveToolPath(absolutePath);
      const info = await stat(resolved.realPath);
      if (info.isDirectory()) throw new Error(`Path is a directory: ${toWorkspaceDisplayPath(resolved.relativePath)}`);
    },
    async detectImageMimeType(absolutePath) {
      const resolved = await resolveToolPath(absolutePath);
      const mimeType = detectReadImageMimeType(resolved.realPath, await readFile(resolved.realPath));
      return isSupportedReadImageMimeType(mimeType) ? mimeType : null;
    },
    async detectUnsupportedImageMimeType(absolutePath) {
      const resolved = await resolveToolPath(absolutePath);
      return detectUnsupportedReadImageMimeType(detectReadImageMimeType(resolved.realPath, await readFile(resolved.realPath)));
    },
    unsupportedImageMimeTypeMessage: unsupportedReadImageMimeTypeMessage,
  };
  return createReadTool(SANDBOX_WORKSPACE_PATH, { operations });
}

export function createLocalCrossSpaceLsTool(): AgentTool {
  const operations: LsOperations = {
    async exists(absolutePath) {
      return Boolean(await resolveToolPath(absolutePath).catch(() => null));
    },
    async stat(absolutePath) {
      const resolved = await resolveToolPath(absolutePath);
      const info = await stat(resolved.realPath);
      return { isDirectory: () => info.isDirectory() };
    },
    async readdir(absolutePath) {
      const resolved = await safeLstatWorkspacePath(await getCurrentWorkspaceScope(), toWorkspaceInputPath(absolutePath));
      if (!resolved.info.isDirectory()) throw new Error(`Not a directory: ${toWorkspaceDisplayPath(resolved.relativePath)}`);
      const entries = await readdir(resolved.realPath, { withFileTypes: true });
      return entries
        .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    },
  };
  return createLsTool(SANDBOX_WORKSPACE_PATH, { operations });
}

export function createLocalCrossSpaceFindTool(): AgentTool {
  const operations: FindOperations = {
    async exists(absolutePath) {
      return Boolean(await resolveToolPath(absolutePath).catch(() => null));
    },
    async glob(pattern, cwd, options) {
      const scope = await getCurrentWorkspaceScope();
      const resolved = await resolveExistingWorkspacePath(scope, toWorkspaceInputPath(cwd));
      const info = await stat(resolved.realPath);
      if (!info.isDirectory()) throw new Error(`Not a directory: ${toWorkspaceDisplayPath(resolved.relativePath)}`);

      let effectivePattern = pattern;
      const useFullPath = pattern.includes("/");
      if (useFullPath && !pattern.startsWith("/") && !pattern.startsWith("**/") && pattern !== "**") {
        effectivePattern = `**/${pattern}`;
      }

      const searchPath = resolved.relativePath === "." ? "." : resolved.relativePath;
      const args = ["--color=never", "--glob", "--hidden", "--no-require-git"];
      if (useFullPath) args.push("--full-path");
      for (const ignore of options.ignore ?? []) args.push("--exclude", ignore);
      args.push("--max-results", String(options.limit), effectivePattern, searchPath);

      const stdout = await runFd(args, scope.rootReal);
      const matches = await filterWorkspaceRelativeResults(scope, resolved.realPath, splitNonEmptyLines(stdout));
      return matches.slice(0, options.limit);
    },
  };
  return createFindTool(SANDBOX_WORKSPACE_PATH, { operations });
}

export function createLocalCrossSpaceGrepTool(): AgentTool {
  const definition = createGrepToolDefinition(SANDBOX_WORKSPACE_PATH);
  definition.execute = async (_toolCallId, input, signal) => {
    if (signal?.aborted) throw new Error("Operation aborted");

    const params = input as GrepToolInput;
    const scope = await getCurrentWorkspaceScope();
    const resolved = await resolveExistingWorkspacePath(scope, toWorkspaceInputPath(params.path));
    const searchPath = resolved.relativePath === "." ? "." : resolved.relativePath;
    const effectiveLimit = Math.max(1, params.limit ?? 100);
    const args = ["--line-number", "--color=never", "--hidden", "--no-require-git", "--json"];
    if (params.context && params.context > 0) args.push("--context", String(params.context));
    if (params.ignoreCase) args.push("--ignore-case");
    if (params.literal) args.push("--fixed-strings");
    if (params.glob?.trim()) args.push("--glob", params.glob.trim());
    if (params.limit !== undefined) args.push("--max-count", String(effectiveLimit));
    args.push(params.pattern, searchPath);

    const stdout = await runRg(args, scope.rootReal, signal);
    if (signal?.aborted) throw new Error("Operation aborted");

    const lines = splitNonEmptyLines(stdout);
    await assertRgJsonLinesInsideWorkspace(scope, lines);
    return formatRgJsonGrepResult({ lines, searchPath: params.path, limit: effectiveLimit });
  };
  return definition;
}
