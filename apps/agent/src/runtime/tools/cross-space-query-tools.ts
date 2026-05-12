import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  truncateLine,
  type GrepToolDetails,
} from "./index.js";
import {
  assertResolvedOutputInsideWorkspace,
  createWorkspaceScope,
  normalizeWorkspaceInputPath,
  resolveExistingWorkspacePath,
  safeLstatWorkspacePath,
  toWorkspaceDisplayPath,
  toWorkspaceRelative,
} from "../workspace-scope.js";
import { assertCrossSpaceQueryAccess, getCrossSpaceQueryAccess } from "../cross-space-query-access.js";

const execFileAsync = promisify(execFile);
const GREP_MAX_LINE_LENGTH = 500;
const EXEC_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 10 * 1024 * 1024;
const MAX_READ_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function ensureAccess(spaceId: string, actorUserId: string | null | undefined) {
  if (!actorUserId?.trim()) throw new Error("Access denied: cross-space queries require an authenticated user.");
  const status = await getCrossSpaceQueryAccess({ actorUserId: actorUserId.trim(), spaceId });
  assertCrossSpaceQueryAccess(status, spaceId);
}

function detectImageMimeType(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return null;
}

function normalizeExecError(error: unknown, tool: string) {
  const err = error as { code?: string; stderr?: string; message?: string };
  if (err?.code === "ENOENT") throw new Error(`${tool} is not installed in agent image.`);
  throw new Error((err?.stderr || err?.message || String(error)).trim());
}

function splitNonEmptyLines(output: string) {
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

async function runFd(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("fd", args, { cwd, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
    return stdout;
  } catch (error) {
    normalizeExecError(error, "fd");
    return "";
  }
}

async function runRg(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("rg", args, { cwd, timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER });
    return stdout;
  } catch (error) {
    const err = error as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    if (err?.code === 1) return err.stdout ?? "";
    normalizeExecError(error, "rg");
    return "";
  }
}

async function filterWorkspaceRelativeResults(scope: Awaited<ReturnType<typeof createWorkspaceScope>>, lines: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const rel = normalizeWorkspaceInputPath(line);
    const abs = resolve(scope.rootReal, rel === "." ? "" : rel);
    const real = await assertResolvedOutputInsideWorkspace(scope, abs);
    if (!real) continue;
    const display = toWorkspaceRelative(scope, abs);
    if (!seen.has(display)) {
      seen.add(display);
      out.push(display);
    }
  }
  return out;
}

const readParams = Type.Object({
  path: Type.String({ description: "Path to the file to read (relative or /workspace path)" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
  space: Type.String({ description: "Target space id" }),
});

export function createCrossSpaceReadTool(getActorUserId: () => string | null | undefined): AgentTool {
  return {
    name: "read",
    label: "read",
    description: `Read a file from another space workspace. Supports text files and images. Text output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB.`,
    parameters: readParams,
    async execute(_id, rawParams): Promise<AgentToolResult<unknown>> {
      const params = rawParams as Static<typeof readParams>;
      await ensureAccess(params.space, getActorUserId());
      const scope = await createWorkspaceScope(params.space);
      const resolved = await safeLstatWorkspacePath(scope, params.path);
      if (resolved.info.isDirectory()) throw new Error(`Path is a directory: ${toWorkspaceDisplayPath(resolved.relativePath)}`);
      const mimeType = detectImageMimeType(resolved.absolutePath);
      const fileInfo = await stat(resolved.realPath);
      if (mimeType?.startsWith("image/") && fileInfo.size > MAX_IMAGE_BYTES) {
        throw new Error(`Image file is too large: ${toWorkspaceDisplayPath(resolved.relativePath)} (${formatSize(fileInfo.size)}).`);
      }
      if (!mimeType && fileInfo.size > MAX_READ_BYTES) {
        throw new Error(`File is too large: ${toWorkspaceDisplayPath(resolved.relativePath)} (${formatSize(fileInfo.size)}). Use grep or a more specific file.`);
      }
      const buffer = await readFile(resolved.realPath);
      if (mimeType?.startsWith("image/")) {
        return {
          content: [
            { type: "text", text: `Read image file [${mimeType}]` },
            { type: "image", data: buffer.toString("base64"), mimeType },
          ],
          details: undefined,
        };
      }

      const allLines = buffer.toString("utf-8").split("\n");
      const startLine = params.offset ? Math.max(0, params.offset - 1) : 0;
      if (startLine >= allLines.length) throw new Error(`Offset ${params.offset} is beyond end of file (${allLines.length} lines total)`);
      const selected = params.limit !== undefined
        ? allLines.slice(startLine, Math.min(startLine + params.limit, allLines.length)).join("\n")
        : allLines.slice(startLine).join("\n");
      const truncation = truncateHead(selected);
      let output = truncation.content;
      if (truncation.firstLineExceedsLimit) {
        output = `[Line ${startLine + 1} exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit]`;
      } else if (truncation.truncated) {
        const endLineDisplay = startLine + truncation.outputLines;
        output += `\n\n[Showing lines ${startLine + 1}-${endLineDisplay} of ${allLines.length}. Use offset=${endLineDisplay + 1} to continue.]`;
      } else if (params.limit !== undefined && startLine + params.limit < allLines.length) {
        output += `\n\n[${allLines.length - (startLine + params.limit)} more lines in file. Use offset=${startLine + params.limit + 1} to continue.]`;
      }
      return { content: [{ type: "text", text: output }], details: truncation.truncated ? { truncation } : undefined };
    },
  };
}

const lsParams = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory to list (default: /workspace)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
  space: Type.String({ description: "Target space id" }),
});

export function createCrossSpaceLsTool(getActorUserId: () => string | null | undefined): AgentTool {
  return {
    name: "ls",
    label: "ls",
    description: "List directory contents from another space workspace.",
    parameters: lsParams,
    async execute(_id, rawParams) {
      const params = rawParams as Static<typeof lsParams>;
      await ensureAccess(params.space, getActorUserId());
      const scope = await createWorkspaceScope(params.space);
      const resolved = await safeLstatWorkspacePath(scope, params.path || ".");
      if (!resolved.info.isDirectory()) throw new Error(`Not a directory: ${toWorkspaceDisplayPath(resolved.relativePath)}`);
      const entries = await readdir(resolved.realPath, { withFileTypes: true });
      const lines = entries
        .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      return { content: [{ type: "text", text: lines.slice(0, params.limit ?? 500).join("\n") }], details: undefined };
    },
  };
}

const findParams = Type.Object({
  path: Type.Optional(Type.String({ description: "Directory to search in (default: /workspace)" })),
  pattern: Type.String({ description: "Glob pattern to match files" }),
  limit: Type.Optional(Type.Number({ description: "Maximum number of results" })),
  space: Type.String({ description: "Target space id" }),
});

export function createCrossSpaceFindTool(getActorUserId: () => string | null | undefined): AgentTool {
  return {
    name: "find",
    label: "find",
    description: "Search for files in another space workspace by glob pattern. Respects .gitignore.",
    parameters: findParams,
    async execute(_id, rawParams) {
      const params = rawParams as Static<typeof findParams>;
      await ensureAccess(params.space, getActorUserId());
      const scope = await createWorkspaceScope(params.space);
      const resolved = await resolveExistingWorkspacePath(scope, params.path || ".");
      const info = await stat(resolved.realPath);
      if (!info.isDirectory()) throw new Error(`Not a directory: ${toWorkspaceDisplayPath(resolved.relativePath)}`);
      const searchPath = resolved.relativePath === "." ? "." : resolved.relativePath;
      const limit = params.limit ?? 1000;
      let effectivePattern = params.pattern;
      const useFullPath = params.pattern.includes("/");
      if (useFullPath && !params.pattern.startsWith("/") && !params.pattern.startsWith("**/") && params.pattern !== "**") {
        effectivePattern = `**/${params.pattern}`;
      }
      const args = ["--color=never", "--glob", "--hidden", "--no-require-git"];
      if (useFullPath) args.push("--full-path");
      args.push("--max-results", String(limit), effectivePattern, searchPath);
      const stdout = await runFd(args, scope.rootReal);
      const matches = await filterWorkspaceRelativeResults(scope, splitNonEmptyLines(stdout));
      return { content: [{ type: "text", text: matches.slice(0, limit).join("\n") }], details: undefined };
    },
  };
}

const grepParams = Type.Object({
  pattern: Type.String({ description: "Search pattern" }),
  path: Type.Optional(Type.String({ description: "Directory or file to search" })),
  glob: Type.Optional(Type.String({ description: "File glob filter" })),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search" })),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string" })),
  context: Type.Optional(Type.Number({ description: "Context lines" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of matches" })),
  space: Type.String({ description: "Target space id" }),
});

export function createCrossSpaceGrepTool(getActorUserId: () => string | null | undefined): AgentTool {
  return {
    name: "grep",
    label: "grep",
    description: "Search file contents in another space workspace. Respects .gitignore.",
    parameters: grepParams,
    async execute(_id, rawParams) {
      const params = rawParams as Static<typeof grepParams>;
      await ensureAccess(params.space, getActorUserId());
      const scope = await createWorkspaceScope(params.space);
      const resolved = await resolveExistingWorkspacePath(scope, params.path || ".");
      const searchPath = resolved.relativePath === "." ? "." : resolved.relativePath;
      const effectiveLimit = Math.max(1, params.limit ?? 100);
      const args = ["--line-number", "--color=never", "--hidden", "--no-require-git", "--json"];
      if (params.context && params.context > 0) args.push("--context", String(params.context));
      if (params.ignoreCase) args.push("--ignore-case");
      if (params.literal) args.push("--fixed-strings");
      if (params.glob?.trim()) args.push("--glob", params.glob.trim());
      args.push(params.pattern, searchPath);
      const stdout = await runRg(args, scope.rootReal);
      const outputLines: string[] = [];
      const details: GrepToolDetails = {};
      let matchCount = 0;
      let linesTruncated = false;
      const allowedFiles = new Set<string>();

      for (const rawLine of splitNonEmptyLines(stdout)) {
        let event: { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
        try { event = JSON.parse(rawLine); } catch { continue; }
        if (event.type !== "match" && event.type !== "context") continue;
        const filePath = event.data?.path?.text;
        const lineNumber = event.data?.line_number;
        const lineText = event.data?.lines?.text;
        if (!filePath || typeof lineNumber !== "number" || typeof lineText !== "string") continue;
        if (!allowedFiles.has(filePath)) {
          const abs = resolve(scope.rootReal, normalizeWorkspaceInputPath(filePath));
          const real = await assertResolvedOutputInsideWorkspace(scope, abs);
          if (!real) continue;
          allowedFiles.add(filePath);
        }
        const sanitized = lineText.replace(/\r\n/g, "\n").replace(/\r/g, "").replace(/\n$/, "");
        const { text, wasTruncated } = truncateLine(sanitized, GREP_MAX_LINE_LENGTH);
        if (wasTruncated) linesTruncated = true;
        const sep = event.type === "match" ? ":" : "-";
        outputLines.push(`${filePath}${sep}${lineNumber}${sep} ${text}`);
        if (event.type === "match") {
          matchCount += 1;
          if (matchCount >= effectiveLimit) break;
        }
      }

      if (matchCount === 0) return { content: [{ type: "text", text: "No matches found" }], details: undefined };
      const rawOutput = outputLines.join("\n");
      const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
      let output = truncation.content;
      const notices: string[] = [];
      if (matchCount >= effectiveLimit) {
        notices.push(`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`);
        details.matchLimitReached = effectiveLimit;
      }
      if (truncation.truncated) {
        output = truncation.content;
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
        details.truncation = truncation;
      }
      if (linesTruncated) {
        notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`);
        details.linesTruncated = true;
      }
      if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
      return { content: [{ type: "text", text: output }], details: Object.keys(details).length ? details : undefined };
    },
  };
}
