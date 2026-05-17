import { randomUUID } from "node:crypto";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepToolDefinition,
  createLsTool,
  createReadTool,
  createWriteTool,
  type BashOperations,
  type EditOperations,
  type FindOperations,
  type GrepToolDetails,
  type GrepToolInput,
  type LsOperations,
  type ReadOperations,
  type WriteOperations,
  DEFAULT_MAX_BYTES,
  formatSize,
  truncateHead,
  truncateLine,
} from "../runtime/tools/index.js";

const GREP_MAX_LINE_LENGTH = 500;
import type { RpcMethod, RpcRequestMap } from "@cohub/protocol/sandbox";
import { wrapToolCall, wrapSandboxRpc, getAgentTracer } from "@cohub/infra/tracing/agent";
import {
  getAgentPlatformAgentsPath,
  getAgentPlatformConfigPath,
  getAgentWorkspacePath,
  SANDBOX_PLATFORM_AGENTS_PATH,
  SANDBOX_WORKSPACE_PATH,
} from "../runtime/paths.js";
import { getCurrentSessionExecutionAuth } from "../runtime/session-execution-auth.js";
import { getCurrentToolExecutionContext, runWithToolExecutionContext, type TurnTelemetryMetrics } from "../tool-context.js";
import { assertSpaceFileViewAccess } from "../runtime/cross-space-query-access.js";
import {
  createSpaceAwareFindTool,
  createSpaceAwareGrepTool,
  createSpaceAwareLsTool,
  createSpaceAwareReadTool,
} from "../runtime/tools/space-aware-query-tools.js";
import { getUserEnvForProcess } from "../runtime/env-cache.js";
import { type SandboxConnection, waitForSandboxConnection, disconnectSandboxWsClient } from "./ws-client.js";
import { recoverSpaceSandbox } from "../api.js";
import { classifySandboxInfrastructureError, type SandboxInfrastructureError } from "./infra-error.js";
import { logger } from "../logger.js";

function getCurrentTraceContext() {
  const ctx = getCurrentToolExecutionContext();
  return {
    spaceId: ctx?.spaceId,
    sessionId: ctx?.sessionId,
    turnId: ctx?.turnId,
    turnSeq: ctx?.turnSeq,
    llmRound: ctx?.llmRound,
    toolCallId: ctx?.toolCallId,
  };
}

function incrementToolCallCount(metrics: TurnTelemetryMetrics | undefined) {
  if (!metrics) return;
  metrics.toolCallCount += 1;
}

function getCurrentSpaceId() {
  const ctx = getCurrentToolExecutionContext();
  if (!ctx?.spaceId) {
    throw new Error("Tool execution context is missing spaceId");
  }
  return ctx.spaceId;
}

function getSpaceWorkspaceDir(spaceId: string) {
  return getAgentWorkspacePath(spaceId);
}

function toPosixPath(value: string) {
  return value.replace(/\\/g, "/");
}

function mapLocalAbsolutePathToSandboxPath(absolutePath: string) {
  const normalized = toPosixPath(absolutePath);
  const workspaceRoot = toPosixPath(getSpaceWorkspaceDir(getCurrentSpaceId()));
  const platformAgentsRoot = toPosixPath(getAgentPlatformAgentsPath());
  const platformRoot = toPosixPath(getAgentPlatformConfigPath());

  if (normalized === workspaceRoot) {
    return SANDBOX_WORKSPACE_PATH;
  }
  if (normalized.startsWith(`${workspaceRoot}/`)) {
    const relativePath = normalized.slice(workspaceRoot.length + 1);
    return `${SANDBOX_WORKSPACE_PATH}/${relativePath}`;
  }

  if (normalized === platformAgentsRoot) {
    return SANDBOX_PLATFORM_AGENTS_PATH;
  }
  if (normalized.startsWith(`${platformAgentsRoot}/`)) {
    const relativePath = normalized.slice(platformAgentsRoot.length + 1);
    return `${SANDBOX_PLATFORM_AGENTS_PATH}/${relativePath}`;
  }

  if (normalized === platformRoot || normalized.startsWith(`${platformRoot}/`)) {
    throw new Error(`Platform path is not tool-visible in sandbox: ${absolutePath}`);
  }

  if (normalized.startsWith("/")) {
    return normalized;
  }

  throw new Error(`Unable to map non-absolute path into sandbox: ${absolutePath}`);
}

function mapSandboxInputPath(path: string | undefined) {
  // grep path comes directly from model input and should follow sandbox path semantics:
  // relative paths resolve from the tool cwd (/workspace by default), while absolute
  // paths are interpreted inside the sandbox as-is.
  if (!path || path.trim() === "") return ".";
  if (path === ".") return ".";
  if (path.startsWith("/")) return path;
  return path;
}

async function getCurrentConnection() {
  return waitForSandboxConnection(getCurrentSpaceId());
}

async function waitForRecoveredSandboxConnection(spaceId: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const remaining = Math.max(1_000, deadline - Date.now());
      return await waitForSandboxConnection(spaceId, Math.min(15_000, remaining));
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (Date.now() >= deadline) break;
      const delayMs = Math.min(1_000 * 2 ** Math.min(attempt, 4), 5_000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Timed out waiting for recovered sandbox connection for ${spaceId}`);
}

async function recoverAndRetryAfterInfraError<T>(spaceId: string, error: SandboxInfrastructureError, retry: () => Promise<T>) {
  console.warn(`[SandboxRecovery] ${error.code} detected spaceId=${spaceId} mount=${error.mountPath ?? "unknown"}; triggering recovery`);
  disconnectSandboxWsClient(spaceId, `sandbox recovery requested: ${error.code}`);
  const result = await recoverSpaceSandbox({ spaceId, reason: error.code, source: "agent" });
  if (!result?.ok) {
    throw new Error(`Sandbox recovery failed after ${error.code}: ${result?.message ?? error.message}`);
  }
  await waitForRecoveredSandboxConnection(spaceId);
  return retry();
}

async function tracedRpc<M extends RpcMethod>(
  connection: SandboxConnection,
  method: M,
  params: RpcRequestMap[M]["params"],
  options?: {
    onEvent?: (event: import("@cohub/protocol/sandbox").RpcEventPayload) => void;
  },
  retryInfraError = true,
): Promise<RpcRequestMap[M]["result"]> {
  const tracer = getAgentTracer();
  const spaceId = getCurrentSpaceId();
  const traceCtx = getCurrentTraceContext();
  const execute = () => wrapSandboxRpc(tracer, {
    method,
    sandboxId: connection.sandboxId,
    spaceId,
    sessionId: traceCtx.sessionId,
    turnId: traceCtx.turnId,
    turnSeq: traceCtx.turnSeq,
    llmRound: traceCtx.llmRound,
    toolCallId: traceCtx.toolCallId,
    params: params as Record<string, unknown>,
  }, async () => {
    return connection.request(method, params, {
      requestId: randomUUID(),
      spaceId,
      sandboxId: connection.sandboxId,
      onEvent: options?.onEvent,
    });
  });

  try {
    return await execute();
  } catch (error) {
    const classified = classifySandboxInfrastructureError(error instanceof Error ? error.message : String(error));
    if (!classified || !retryInfraError) throw error;
    return recoverAndRetryAfterInfraError(spaceId, classified, async () => {
      const freshConnection = await waitForSandboxConnection(spaceId, 60_000);
      return tracedRpc(freshConnection, method, params, options, false);
    });
  }
}

function createRemoteReadOperations(): ReadOperations {
  const tracer = getAgentTracer();
  return {
    async readFile(absolutePath) {
      const spaceId = getCurrentSpaceId();
      const toolCtx = getCurrentToolExecutionContext();
      incrementToolCallCount(toolCtx?.metrics);
      const toolCallId = randomUUID();
      return runWithToolExecutionContext({
        spaceId: toolCtx?.spaceId ?? spaceId,
        sessionId: toolCtx?.sessionId ?? "",
        toolCallId,
      }, async () => wrapToolCall(tracer, {
        toolName: "read",
        input: { path: absolutePath },
        ...getCurrentTraceContext(),
      }, async () => {
        const connection = await getCurrentConnection();
        const path = mapLocalAbsolutePathToSandboxPath(absolutePath);
        logger.debug(`[Tool:read] path=${path}`);
        // Use binary mode so sandbox detects MIME type and returns base64 for binary files.
        const result = await tracedRpc(connection, "fs.read", { path, binary: true });
        if (result.contentBase64) {
          return Buffer.from(result.contentBase64, "base64");
        }
        return Buffer.from(result.content, "utf8");
      }));
    },
    async access(absolutePath) {
      const connection = await getCurrentConnection();
      await tracedRpc(connection, "fs.read", { path: mapLocalAbsolutePathToSandboxPath(absolutePath), offset: 1, limit: 1 });
    },
    async detectImageMimeType(absolutePath) {
      const connection = await getCurrentConnection();
      const path = mapLocalAbsolutePathToSandboxPath(absolutePath);
      const result = await tracedRpc(connection, "fs.read", { path, binary: true });
      const mimeType = typeof result.mimeType === "string" ? result.mimeType : null;
      // Only return image MIME types. The upstream read tool treats any truthy
      // return value here as an image and will otherwise misclassify text files.
      return mimeType?.startsWith("image/") ? mimeType : null;
    },
  };
}

function createRemoteWriteOperations(): WriteOperations {
  const tracer = getAgentTracer();
  return {
    async writeFile(absolutePath, content) {
      const spaceId = getCurrentSpaceId();
      const toolCtx = getCurrentToolExecutionContext();
      incrementToolCallCount(toolCtx?.metrics);
      const toolCallId = randomUUID();
      return runWithToolExecutionContext({
        spaceId: toolCtx?.spaceId ?? spaceId,
        sessionId: toolCtx?.sessionId ?? "",
        toolCallId,
      }, async () => wrapToolCall(tracer, {
        toolName: "write",
        input: { path: absolutePath, bytes: content.length },
        ...getCurrentTraceContext(),
      }, async () => {
        const path = mapLocalAbsolutePathToSandboxPath(absolutePath);
        logger.debug(`[Tool:write] path=${path} bytes=${content.length}`);
        const connection = await getCurrentConnection();
        await tracedRpc(connection, "fs.write", { path, content });
      }));
    },
    async mkdir(_dir) {
      // sandbox fs.write already creates parent directories recursively
    },
  };
}

function createRemoteEditOperations(): EditOperations {
  const readOps = createRemoteReadOperations();
  const writeOps = createRemoteWriteOperations();
  return {
    readFile: readOps.readFile,
    access: async (absolutePath) => {
      await readOps.access(absolutePath);
    },
    writeFile: writeOps.writeFile,
  };
}

function createRemoteBashOperations(): BashOperations {
  const tracer = getAgentTracer();
  return {
    exec(command, cwd, { onData, signal, timeout, env }) {
      return new Promise((resolve, reject) => {
        let processId: string | null = null;
        let settled = false;
        let aborting = false;
        const cmdSummary = command.trim().slice(0, 80);

        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          fn();
        };

        void (async () => {
          try {
            const spaceId = getCurrentSpaceId();
            const toolCtx = getCurrentToolExecutionContext();
            incrementToolCallCount(toolCtx?.metrics);
            const toolCallId = randomUUID();
            return runWithToolExecutionContext({
              spaceId: toolCtx?.spaceId ?? spaceId,
              sessionId: toolCtx?.sessionId ?? "",
              toolCallId,
            }, async () => wrapToolCall(tracer, {
              toolName: "bash",
              input: { command: cmdSummary, cwd },
              ...getCurrentTraceContext(),
            }, async () => {
              const connection = await getCurrentConnection();
              const sandboxCwd = mapLocalAbsolutePathToSandboxPath(cwd);
              const ctx = getCurrentToolExecutionContext();
              const sessionExecutionAuth = ctx?.sessionId ? getCurrentSessionExecutionAuth(ctx.sessionId) : null;
              const injectedEnv: Record<string, string> = {
                ...(ctx?.spaceId ? getUserEnvForProcess(ctx.spaceId) : {}),
                ...(env ?? {}),
                ...(ctx?.spaceId ? { COHUB_SPACE_ID: ctx.spaceId } : {}),
                ...(ctx?.sessionId ? { COHUB_SESSION_ID: ctx.sessionId } : {}),
                ...(sessionExecutionAuth?.actorUserId ? { COHUB_USER_UUID: sessionExecutionAuth.actorUserId } : {}),
                ...(sessionExecutionAuth?.executionToken ? { COHUB_EXECUTION_TOKEN: sessionExecutionAuth.executionToken } : {}),
              };
              logger.debug(`[Tool:bash] exec summary="${cmdSummary}" cwd=${sandboxCwd}`);

              const cleanupAbort = () => {
                signal?.removeEventListener("abort", onAbort);
              };

              const onAbort = () => {
                aborting = true;
                if (!processId) return;
                void tracedRpc(connection, "process.abort", { processId }).catch(() => undefined);
              };

              if (signal) {
                if (signal.aborted) onAbort();
                else signal.addEventListener("abort", onAbort, { once: true });
              }

              await tracedRpc(
                connection,
                "process.start",
                {
                  command,
                  timeoutSecs: timeout,
                  cwd: sandboxCwd,
                  env: Object.keys(injectedEnv).length > 0 ? injectedEnv : undefined,
                },
                {
                  onEvent(event) {
                    if (event.type === "started") {
                      processId = event.processId;
                      if (aborting) {
                        void tracedRpc(connection, "process.abort", { processId: event.processId }).catch(() => undefined);
                      }
                      return;
                    }

                    if (event.type === "stdout" || event.type === "stderr") {
                      let chunk = `${event.chunk}\n`;
                      const token = injectedEnv.COHUB_EXECUTION_TOKEN;
                      if (token) {
                        chunk = chunk.split(token).join("[REDACTED_TOKEN]");
                      }
                      onData(Buffer.from(chunk, "utf8"));
                      return;
                    }

                    if (event.type === "exit") {
                      cleanupAbort();
                      logger.debug(`[Tool:bash] exit code=${event.exitCode} summary="${cmdSummary}"`);
                      finish(() => resolve({ exitCode: event.exitCode ?? null }));
                    }
                  },
                },
              );
            }));
          } catch (error) {
            console.error(`[Tool:bash] error cmd="${cmdSummary}"`, error);
            finish(() => reject(error));
          }
        })();
      });
    },
  };
}

function createRemoteLsOperations(): LsOperations {
  const tracer = getAgentTracer();
  return {
    async exists(absolutePath) {
      const connection = await getCurrentConnection();
      const result = await tracedRpc(connection, "fs.stat", { path: mapLocalAbsolutePathToSandboxPath(absolutePath) });
      return result.exists;
    },
    async stat(absolutePath) {
      const connection = await getCurrentConnection();
      const result = await tracedRpc(connection, "fs.stat", { path: mapLocalAbsolutePathToSandboxPath(absolutePath) });
      return {
        isDirectory: () => result.isDirectory,
      };
    },
    async readdir(absolutePath) {
      const spaceId = getCurrentSpaceId();
      const toolCtx = getCurrentToolExecutionContext();
      incrementToolCallCount(toolCtx?.metrics);
      const toolCallId = randomUUID();
      return runWithToolExecutionContext({
        spaceId: toolCtx?.spaceId ?? spaceId,
        sessionId: toolCtx?.sessionId ?? "",
        toolCallId,
      }, async () => wrapToolCall(tracer, {
        toolName: "ls",
        input: { path: absolutePath },
        ...getCurrentTraceContext(),
      }, async () => {
        const path = mapLocalAbsolutePathToSandboxPath(absolutePath);
        logger.debug(`[Tool:ls] path=${path}`);
        const connection = await getCurrentConnection();
        const result = await tracedRpc(connection, "fs.ls", { path });
        return result.entries.map((entry) => entry.endsWith("/") ? entry.slice(0, -1) : entry);
      }));
    },
  };
}

function createRemoteFindOperations(): FindOperations {
  const tracer = getAgentTracer();
  return {
    async exists(absolutePath) {
      const connection = await getCurrentConnection();
      const result = await tracedRpc(connection, "fs.stat", { path: mapLocalAbsolutePathToSandboxPath(absolutePath) });
      return result.exists;
    },
    async glob(pattern, cwd, options) {
      const spaceId = getCurrentSpaceId();
      const toolCtx = getCurrentToolExecutionContext();
      incrementToolCallCount(toolCtx?.metrics);
      const toolCallId = randomUUID();
      return runWithToolExecutionContext({
        spaceId: toolCtx?.spaceId ?? spaceId,
        sessionId: toolCtx?.sessionId ?? "",
        toolCallId,
      }, async () => wrapToolCall(tracer, {
        toolName: "find",
        input: { pattern, path: cwd },
        ...getCurrentTraceContext(),
      }, async () => {
        const path = mapLocalAbsolutePathToSandboxPath(cwd);
        logger.debug(`[Tool:find] pattern=${pattern} path=${path}`);

        // Agent owns tool semantics: match pi-coding-agent fd behavior.
        // In --full-path mode fd matches against the absolute candidate path,
        // so a path-containing pattern like 'src/**/*.spec.ts' needs a leading
        // '**/' to match anything (matching pi-coding-agent logic).
        let effectivePattern = pattern;
        const useFullPath = pattern.includes("/");
        if (useFullPath && !pattern.startsWith("/") && !pattern.startsWith("**/") && pattern !== "**") {
          effectivePattern = `**/${pattern}`;
        }

        const connection = await getCurrentConnection();
        const result = await tracedRpc(connection, "fs.find", {
          pattern: effectivePattern,
          path,
          limit: options.limit,
          maxResults: options.limit,
          mode: "glob",
          // Always include hidden files (matching pi-coding-agent `--hidden`).
          hidden: true,
          // Apply .gitignore even outside a git repo (matching pi-coding-agent `--no-require-git`).
          requireGit: false,
          // Don't skip VCS ignore rules — let .gitignore work naturally.
          ignoreVcs: false,
          fullPath: useFullPath,
          // Pass through ignore patterns from the caller (e.g. node_modules).
          ignore: options.ignore,
        });
        return result.matches;
      }));
    },
  };
}

/**
 * Sandbox grep tool that delegates fs.grep to the sandbox but replicates
 * the native pi-coding-agent output format so the model sees identical results.
 *
 * Native grep output format:
 *   Match lines:   relativePath:lineNumber: text
 *   Context lines: relativePath-lineNumber- text
 *   Long lines are truncated to GREP_MAX_LINE_LENGTH.
 */
function createRemoteGrepTool() {
  const tracer = getAgentTracer();
  const definition = createGrepToolDefinition(SANDBOX_WORKSPACE_PATH);

  definition.execute = async (
    _toolCallId,
    input,
    signal?: AbortSignal,
    _onUpdate?,
    _ctx?: unknown,
  ) => {
    const grepInput = input as GrepToolInput;
    const spaceId = getCurrentSpaceId();
    const toolCtx = getCurrentToolExecutionContext();
    incrementToolCallCount(toolCtx?.metrics);
    const toolCallId = _toolCallId || randomUUID();
    logger.debug(`[Tool:grep] pattern=${grepInput.pattern} path=${grepInput.path}`);

    return runWithToolExecutionContext({
      spaceId: toolCtx?.spaceId ?? spaceId,
      sessionId: toolCtx?.sessionId ?? "",
      toolCallId,
    }, async () => wrapToolCall(tracer, {
      toolName: "grep",
      input: { pattern: grepInput.pattern, path: grepInput.path },
      ...getCurrentTraceContext(),
    }, async () => {
      // Check abort before starting.
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const contextValue = grepInput.context && grepInput.context > 0 ? grepInput.context : 0;
      const effectiveLimit = Math.max(1, grepInput.limit ?? 100);

      // Set up abort handling.
      let aborted = false;
      let activeProcessId: string | null = null;
      const onAbort = () => {
        aborted = true;
        if (activeProcessId) {
          void tracedRpcAbortProcess(activeProcessId);
        }
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      const connection = await getCurrentConnection();
      try {
        const result = await tracedRpc(
          connection,
          "fs.grep",
          {
            pattern: grepInput.pattern,
            path: mapSandboxInputPath(grepInput.path),
            glob: grepInput.glob,
            ignoreCase: grepInput.ignoreCase,
            literal: grepInput.literal,
            context: grepInput.context,
            limit: effectiveLimit,
            // Agent owns semantics: match pi-coding-agent behavior.
            maxCount: grepInput.limit,
            json: true,
            hidden: true,
          },
          {
            onEvent(event) {
              if (event.type === "started") {
                activeProcessId = event.processId;
                if (aborted) {
                  void tracedRpcAbortProcess(event.processId);
                }
              }
            },
          },
        );

        if (aborted) {
          throw new Error("Operation aborted");
        }

        // Phase 1: Parse all matches from rg JSON output.
        const matches: Array<{
          filePath: string;
          lineNumber: number;
          lineText?: string;
        }> = [];
        for (const rawLine of result.lines) {
          if (!rawLine.trim()) continue;
          let rgEvent: {
            type: string;
            data?: {
              path?: { text?: string };
              line_number?: number;
              lines?: { text?: string };
            };
          };
          try {
            rgEvent = JSON.parse(rawLine);
          } catch {
            continue;
          }
          if (rgEvent.type === "match") {
            const filePath = rgEvent.data?.path?.text;
            const lineNumber = rgEvent.data?.line_number;
            const lineText = rgEvent.data?.lines?.text;
            if (filePath && typeof lineNumber === "number") {
              matches.push({ filePath, lineNumber, lineText });
            }
            if (matches.length >= effectiveLimit) break;
          }
        }

        if (matches.length === 0) {
          return {
            content: [{ type: "text", text: "No matches found" }],
            details: undefined,
          };
        }

        const matchLimitReached = matches.length >= effectiveLimit;

        // Phase 2: If context mode, pre-fetch all needed files in parallel with caching.
        const fileCache = new Map<string, string[]>();
        if (contextValue > 0) {
          // Collect unique file paths.
          const filePaths = [...new Set(matches.map((m) => m.filePath))];
          // Fetch all files in parallel.
          const fetchResults = await Promise.all(
            filePaths.map(async (filePath) => {
              const connection = await getCurrentConnection();
              const fileResult = await tracedRpc(connection, "fs.read", { path: filePath });
              return { filePath, lines: fileResult.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n") };
            }),
          );
          for (const r of fetchResults) {
            fileCache.set(r.filePath, r.lines);
          }
        }

        // Phase 3: Format output lines from parsed matches (with cache hits for context).
        const outputLines: string[] = [];
        let linesTruncated = false;

        for (const match of matches) {
          const relativePath = formatRelativePath(match.filePath, grepInput.path);

          if (contextValue === 0 && match.lineText !== undefined) {
            // No context: format directly from rg line text (native behavior).
            const sanitized = match.lineText.replace(/\r\n/g, "\n").replace(/\r/g, "").replace(/\n$/, "");
            const { text: truncatedText, wasTruncated } = truncateLine(sanitized);
            if (wasTruncated) linesTruncated = true;
            outputLines.push(`${relativePath}:${match.lineNumber}: ${truncatedText}`);
          } else {
            // Context mode: use pre-fetched file content from cache.
            const cachedLines = fileCache.get(match.filePath);
            if (cachedLines) {
              const block = formatContextBlockFromCache(match.filePath, match.lineNumber, contextValue, cachedLines);
              if (block.anyTruncated) linesTruncated = true;
              outputLines.push(...block.lines);
            } else {
              // Fallback: shouldn't happen after parallel fetch, but handle gracefully.
              const relativePathFallback = match.filePath.includes("/") ? match.filePath.split("/").pop() ?? match.filePath : match.filePath;
              outputLines.push(`${relativePathFallback}:${match.lineNumber}: (unable to read file)`);
            }
          }
        }

        // Apply byte truncation (matching native behavior).
        const rawOutput = outputLines.join("\n");
        const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
        let output = truncation.content;

        // Build details (matching native behavior).
        const details: GrepToolDetails = {};
        const notices: string[] = [];
        if (matchLimitReached) {
          notices.push(`${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`);
          details.matchLimitReached = effectiveLimit;
        }
        if (truncation.truncated) {
          notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
          details.truncation = truncation;
        }
        if (linesTruncated) {
          notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`);
          details.linesTruncated = true;
        }
        if (notices.length > 0) {
          output += `\n\n[${notices.join(". ")}]`;
        }

        return {
          content: [{ type: "text", text: output }],
          details: Object.keys(details).length > 0 ? details : undefined,
        };
      } finally {
        if (signal) signal.removeEventListener("abort", onAbort);
      }
    }));
  };

  // Keep native renderCall and renderResult for TUI consistency.
  return {
    ...definition,
    execute: definition.execute,
  };
}

/** Format a file path as relative, matching native grep behavior. */
function formatRelativePath(absolutePath: string, searchPath: string | undefined): string {
  // Reconstruct the sandbox-internal search path to compute relative output.
  let sandboxSearchDir: string;
  if (!searchPath || searchPath === ".") {
    sandboxSearchDir = SANDBOX_WORKSPACE_PATH;
  } else if (!searchPath.startsWith("/")) {
    sandboxSearchDir = `${SANDBOX_WORKSPACE_PATH}/${searchPath}`;
  } else {
    sandboxSearchDir = searchPath;
  }

  if (absolutePath.startsWith(`${sandboxSearchDir}/`)) {
    return absolutePath.slice(sandboxSearchDir.length + 1);
  }
  // Fallback: just the filename.
  const parts = absolutePath.split("/");
  return parts[parts.length - 1] ?? absolutePath;
}

/** Format context lines from cached file content. Pure/sync, no RPC. */
function formatContextBlockFromCache(
  filePath: string,
  lineNumber: number,
  contextValue: number,
  fileLines: string[],
): { lines: string[]; anyTruncated: boolean } {
  const relativePath = filePath.includes("/") ? filePath.split("/").pop() ?? filePath : filePath;
  const block: string[] = [];
  let anyTruncated = false;
  const start = contextValue > 0 ? Math.max(1, lineNumber - contextValue) : lineNumber;
  const end = contextValue > 0 ? Math.min(fileLines.length, lineNumber + contextValue) : lineNumber;

  for (let current = start; current <= end; current++) {
    const lineText = fileLines[current - 1] ?? "";
    const sanitized = lineText.replace(/\r/g, "");
    const isMatchLine = current === lineNumber;
    const { text: truncatedText, wasTruncated } = truncateLine(sanitized);
    if (wasTruncated) anyTruncated = true;
    if (isMatchLine) block.push(`${relativePath}:${current}: ${truncatedText}`);
    else block.push(`${relativePath}-${current}- ${truncatedText}`);
  }
  return { lines: block, anyTruncated };
}

/** Abort a running process via sandbox RPC. */
async function tracedRpcAbortProcess(processId: string) {
  try {
    const connection = await getCurrentConnection();
    await tracedRpc(connection, "process.abort", { processId });
  } catch {
    // Ignore abort errors.
  }
}

function getCurrentActorUserId() {
  const ctx = getCurrentToolExecutionContext();
  if (ctx?.actorUserId) return ctx.actorUserId;
  if (ctx?.sessionId) return getCurrentSessionExecutionAuth(ctx.sessionId)?.actorUserId ?? null;
  return null;
}

async function assertCurrentActorCanViewSpaceFiles(spaceId: string) {
  const actorUserId = getCurrentActorUserId();
  if (!actorUserId?.trim()) throw new Error("Access denied: cross-space queries require an authenticated user.");
  await assertSpaceFileViewAccess({ actorUserId: actorUserId.trim(), spaceId });
}

export function createSandboxCodingTools() {
  const toolCwd = SANDBOX_WORKSPACE_PATH;

  const sandboxReadTool = createReadTool(toolCwd, { operations: createRemoteReadOperations() });
  const sandboxLsTool = createLsTool(toolCwd, { operations: createRemoteLsOperations() });
  const sandboxFindTool = createFindTool(toolCwd, { operations: createRemoteFindOperations() });
  const sandboxGrepTool = createRemoteGrepTool();

  return [
    createSpaceAwareReadTool(sandboxReadTool, assertCurrentActorCanViewSpaceFiles),
    createBashTool(toolCwd, { operations: createRemoteBashOperations() }),
    createEditTool(toolCwd, { operations: createRemoteEditOperations() }),
    createWriteTool(toolCwd, { operations: createRemoteWriteOperations() }),
    createSpaceAwareLsTool(sandboxLsTool, assertCurrentActorCanViewSpaceFiles),
    createSpaceAwareFindTool(sandboxFindTool, assertCurrentActorCanViewSpaceFiles),
    createSpaceAwareGrepTool(sandboxGrepTool, assertCurrentActorCanViewSpaceFiles),
  ];
}
