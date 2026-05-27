import { randomUUID } from "node:crypto";
import {
  createBashTool,
  createToolFailure,
  createEditTool,
  createFindTool,
  createGrepToolDefinition,
  createLsTool,
  createReadTool,
  createWriteTool,
  type BashOperations,
  type BashExecutionResult,
  type EditOperations,
  type FindOperations,
  type GrepToolInput,
  type LsOperations,
  type ReadOperations,
  type WriteOperations,
} from "../runtime/tools/index.js";
import {
  detectUnsupportedReadImageMimeType,
  isSupportedReadImageMimeType,
  unsupportedReadImageMimeTypeMessage,
} from "../runtime/tools/read-file-types.js";
import {
  createLocalCrossSpaceFindTool,
  createLocalCrossSpaceGrepTool,
  createLocalCrossSpaceLsTool,
  createLocalCrossSpaceReadTool,
} from "../runtime/tools/local-cross-space-query-tools.js";
import { formatRgJsonGrepResult } from "../runtime/tools/grep-json-format.js";

import { encodeGenerationPolicy, GENERATION_POLICY_ENV_KEY } from "@cohub/protocol/generation";
import type { RpcMethod, RpcRequestMap } from "@cohub/protocol/sandbox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { wrapToolCall, wrapSandboxRpc, getAgentTracer } from "@cohub/infra/tracing/agent";
import { createSandboxLifecycleController } from "@cohub/sandbox-controller";
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
import { type SandboxConnection, disconnectSandboxWsClient } from "./ws-client.js";
import { SandboxRpcError, isSandboxRpcError, type SandboxRpcDiagnostics } from "./rpc-error.js";

import { ensureSandboxConnection, pruneSandboxConnections } from "../sandbox-pool.js";
import { recoverSpaceSandbox } from "../api.js";
import { classifySandboxInfrastructureError, type SandboxInfrastructureError } from "./infra-error.js";
import { logger } from "../logger.js";
import { db } from "../db.js";

const sandboxLifecycle = createSandboxLifecycleController({ db, infra: null });
const SANDBOX_UNAVAILABLE_MESSAGE = "Sandbox unavailable.";

function getCurrentTraceContext() {
  const ctx = getCurrentToolExecutionContext();
  return {
    spaceId: ctx?.spaceId,
    sessionId: ctx?.sessionId,
    turnId: ctx?.turnId,
    turnSeq: ctx?.turnSeq,
    llmRound: ctx?.llmRound,
    toolCallId: ctx?.toolCallId,
    requestId: ctx?.requestId ?? undefined,
  };
}

function incrementToolCallCount(metrics: TurnTelemetryMetrics | undefined) {
  if (!metrics) return;
  metrics.toolCallCount += 1;
}

function truncateLogValue(value: string, limit = 500) {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function formatDiagnostics(diagnostics: SandboxRpcDiagnostics | undefined) {
  if (!diagnostics) return "";
  const entries = Object.entries(diagnostics).filter(([, value]) => value != null);
  if (entries.length === 0) return "";
  return entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ");
}

function formatTraceContextForLog() {
  const ctx = getCurrentTraceContext();
  return [
    ctx.spaceId ? `spaceId=${ctx.spaceId}` : null,
    ctx.sessionId ? `sessionId=${ctx.sessionId}` : null,
    ctx.turnId ? `turnId=${ctx.turnId}` : null,
    ctx.toolCallId ? `toolCallId=${ctx.toolCallId}` : null,
    ctx.requestId ? `requestId=${ctx.requestId}` : null,
  ].filter(Boolean).join(" ");
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

async function getCurrentConnection(method: RpcMethod | string = "sandbox.connect") {
  const spaceId = getCurrentSpaceId();
  try {
    return await ensureSandboxConnection(spaceId);
  } catch (error) {
    logger.warn(`[SandboxWS] unavailable while waiting for connection spaceId=${spaceId}:`, error);
    throw new SandboxRpcError(SANDBOX_UNAVAILABLE_MESSAGE, {
      method,
      rpcErrorCode: "IO_ERROR",
      retryable: false,
    });
  }
}

async function waitForRecoveredSandboxConnection(spaceId: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      return await ensureSandboxConnection(spaceId, { timeoutMs: Math.min(15_000, Math.max(1_000, deadline - Date.now())) });
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
    await sandboxLifecycle.recordActivity({ spaceId, reason: "rpc", rpcMethod: method }).catch((error) => {
      logger.warn(`[SandboxActivity] failed to record rpc activity spaceId=${spaceId} method=${method}: ${error instanceof Error ? error.message : String(error)}`);
    });
    return connection.request(method, params, {
      requestId: randomUUID(),
      spaceId,
      sandboxId: connection.sandboxId,
      onEvent: options?.onEvent,
    });
  });

  try {
    try {
      return await execute();
    } catch (error) {
      const classified = classifySandboxInfrastructureError(error instanceof Error ? error.message : String(error));
      if (!classified || !retryInfraError) throw error;
      return recoverAndRetryAfterInfraError(spaceId, classified, async () => {
        const freshConnection = await getCurrentConnection(method);
        return tracedRpc(freshConnection, method, params, options, false);
      });
    }
  } finally {
    try {
      pruneSandboxConnections();
    } catch (error) {
      logger.warn(`[SandboxPool] prune failed: ${error instanceof Error ? error.message : String(error)}`);
    }
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
      // Only return supported raster image MIME types. The upstream read tool
      // treats any truthy return value here as an image.
      return isSupportedReadImageMimeType(mimeType) ? mimeType : null;
    },
    async detectUnsupportedImageMimeType(absolutePath) {
      const connection = await getCurrentConnection();
      const path = mapLocalAbsolutePathToSandboxPath(absolutePath);
      const result = await tracedRpc(connection, "fs.read", { path, binary: true });
      const mimeType = typeof result.mimeType === "string" ? result.mimeType : null;
      return detectUnsupportedReadImageMimeType(mimeType);
    },
    unsupportedImageMimeTypeMessage: unsupportedReadImageMimeTypeMessage,
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
      let outputPreview = "";
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
              const actorUserId = ctx?.actorUserId ?? sessionExecutionAuth?.actorUserId ?? null;
              const executionToken = ctx?.executionToken ?? sessionExecutionAuth?.executionToken ?? null;
              const injectedEnv: Record<string, string> = {
                ...(ctx?.spaceId ? getUserEnvForProcess(ctx.spaceId) : {}),
                ...(env ?? {}),
                ...(ctx?.generationPolicy ? { [GENERATION_POLICY_ENV_KEY]: encodeGenerationPolicy(ctx.generationPolicy) } : {}),
                ...(ctx?.spaceId ? { COHUB_SPACE_ID: ctx.spaceId } : {}),
                ...(ctx?.sessionId ? { COHUB_SESSION_ID: ctx.sessionId } : {}),
                ...(actorUserId ? { COHUB_USER_UUID: actorUserId } : {}),
                ...(executionToken ? { COHUB_EXECUTION_TOKEN: executionToken } : {}),
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
                      const rawChunk = typeof event.chunk === "string" ? event.chunk : "";
                      if (!rawChunk) return;
                      const chunk = executionToken
                        ? rawChunk.split(executionToken).join("[REDACTED_TOKEN]")
                        : rawChunk;
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
            if (isSandboxRpcError(error)) {
              logger.warn(`[Tool:bash] sandbox rpc failed cmd="${cmdSummary}" method=${error.method} rpcErrorCode=${error.rpcErrorCode} retryable=${error.retryable}`);
              finish(() => resolve({
                failure: {
                  isError: true,
                  retryable: error.retryable,
                  infrastructure: error.infrastructure,
                  rpcErrorCode: error.rpcErrorCode,
                  outputTail: outputPreview,
                  message: error.message,
                },
              } satisfies BashExecutionResult));
              return;
            }
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

          return formatRgJsonGrepResult({ lines: result.lines, searchPath: grepInput.path, limit: effectiveLimit });
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
  if (!actorUserId?.trim()) throw new Error("Access denied: an authenticated user is required.");
  await assertSpaceFileViewAccess({ actorUserId: actorUserId.trim(), spaceId });
}

function withSandboxFailureResult<T extends AgentTool>(tool: T): T {
  const execute: AgentTool["execute"] = async (...args) => {
    try {
      return await tool.execute(...args);
    } catch (error) {
      if (!isSandboxRpcError(error)) throw error;
      const traceContext = formatTraceContextForLog();
      const diagnostics = formatDiagnostics(error.diagnostics);
      const transportReason = error.transportReason ? ` transportReason=${JSON.stringify(truncateLogValue(error.transportReason))}` : "";
      logger.warn(`[Tool:${tool.name}] sandbox unavailable method=${error.method} rpcErrorCode=${error.rpcErrorCode} retryable=${error.retryable} infrastructure=${error.infrastructure}${transportReason}${traceContext ? ` ${traceContext}` : ""}${diagnostics ? ` ${diagnostics}` : ""}`);
      return {
        content: [{ type: "text", text: SANDBOX_UNAVAILABLE_MESSAGE }],
        details: createToolFailure(SANDBOX_UNAVAILABLE_MESSAGE, {
          retryable: error.retryable,
          infrastructure: error.infrastructure,
          rpcErrorCode: error.rpcErrorCode,
        }),
      };
    }
  };
  return { ...tool, execute } as T;
}

export function createSandboxCodingTools() {
  const toolCwd = SANDBOX_WORKSPACE_PATH;

  const sandboxReadTool = createReadTool(toolCwd, { operations: createRemoteReadOperations() });
  const sandboxLsTool = createLsTool(toolCwd, { operations: createRemoteLsOperations() });
  const sandboxFindTool = createFindTool(toolCwd, { operations: createRemoteFindOperations() });
  const sandboxGrepTool = createRemoteGrepTool();
  const crossSpaceReadTool = createLocalCrossSpaceReadTool();
  const crossSpaceLsTool = createLocalCrossSpaceLsTool();
  const crossSpaceFindTool = createLocalCrossSpaceFindTool();
  const crossSpaceGrepTool = createLocalCrossSpaceGrepTool();

  return [
    withSandboxFailureResult(createSpaceAwareReadTool({
      sandboxTool: sandboxReadTool,
      crossSpaceTool: crossSpaceReadTool,
      checkAccess: assertCurrentActorCanViewSpaceFiles,
    })),
    withSandboxFailureResult(createBashTool(toolCwd, { operations: createRemoteBashOperations() })),
    withSandboxFailureResult(createEditTool(toolCwd, { operations: createRemoteEditOperations() })),
    withSandboxFailureResult(createWriteTool(toolCwd, { operations: createRemoteWriteOperations() })),
    withSandboxFailureResult(createSpaceAwareLsTool({
      sandboxTool: sandboxLsTool,
      crossSpaceTool: crossSpaceLsTool,
      checkAccess: assertCurrentActorCanViewSpaceFiles,
    })),
    withSandboxFailureResult(createSpaceAwareFindTool({
      sandboxTool: sandboxFindTool,
      crossSpaceTool: crossSpaceFindTool,
      checkAccess: assertCurrentActorCanViewSpaceFiles,
    })),
    withSandboxFailureResult(createSpaceAwareGrepTool({
      sandboxTool: sandboxGrepTool,
      crossSpaceTool: crossSpaceGrepTool,
      checkAccess: assertCurrentActorCanViewSpaceFiles,
    })),
  ];
}
