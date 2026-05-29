import { createLogger } from "@cohub/infra/logging";
import { createHash } from "node:crypto";
import type {
  PersistMessageInput,
  RegisterSessionInput,
} from "@cohub/protocol/model";
import type { ContentBlock } from "@cohub/protocol/core";
import { normalizeContentBlockSafe, normalizeContentBlocksSafe } from "@cohub/core/content/normalize";
import { buildTraceHeaders, getCurrentRequestId } from "@cohub/infra/tracing";
import { env } from "./env.js";


const logger = createLogger({ serviceName: "cohub-agent" });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const INTERNAL_API_BASE_URL =
  env.ENV === "prod"
    ? "http://cohub-api.cohub.svc.cluster.local:8787"
    : "http://cohub-api-dev.cohub-dev.svc.cluster.local:8787";


const internalHeaders = () => ({
  "content-type": "application/json",
  ...(env.WORKER_SECRET ? { "x-worker-secret": env.WORKER_SECRET } : {}),
  ...buildTraceHeaders({ requestId: getCurrentRequestId() }),
});

// ─── Idempotency ───

const stableSerialize = (value: unknown): string => {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`)
    .join(",")}}`;
};

const buildAssistantIdempotencyKey = (input: {
  previousMessageId: string;
  message: PersistMessageInput["message"];
}): string => {
  return createHash("sha256")
    .update(
      stableSerialize({
        previousMessageId: input.previousMessageId,
        role: "assistant",
        message: input.message,
      }),
    )
    .digest("hex");
};

const buildUserIdempotencyKey = (input: {
  messageId: string;
  content: ContentBlock[];
  meta?: Record<string, unknown> | null;
}): string => {
  return createHash("sha256")
    .update(
      stableSerialize({
        role: "user",
        messageId: input.messageId,
        content: input.content,
        meta: input.meta ?? null,
      }),
    )
    .digest("hex");
};

async function postJsonWithRetry(input: {
  url: string;
  body: unknown;
  errorPrefix: string;
  maxAttempts?: number;
}) {
  const maxAttempts = input.maxAttempts ?? 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(input.url, {
        method: "POST",
        headers: internalHeaders(),
        body: JSON.stringify(input.body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        // Retry on 5xx server errors (transient — e.g. DB race on previousMessageId)
        if (response.status >= 500 && attempt < maxAttempts) {
          await sleep(500 * attempt);
          continue;
        }
        throw new Error(`${input.errorPrefix} ${response.status}: ${text}`);
      }

      return response.json().catch(() => null);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(500 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ─── Content extraction ───

const extractThinkingFromContent = (content: unknown): string => {
  if (!Array.isArray(content)) return "";
  return content
    .filter((item): item is { type: string; thinking?: string } =>
      !!item && typeof item === "object" && "type" in item && item.type === "thinking" && typeof item.thinking === "string")
    .map((item) => item.thinking ?? "")
    .join("\n")
    .trim();
};

const summarizeThinking = (thinking: string): string => {
  const trimmed = thinking.trim();
  if (!trimmed) return "";
  const lines = trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(0, 3).join("\n").slice(0, 600);
};

const summarizeToolArgs = (toolName: string, args: unknown): string => {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;
  if (toolName === "bash" && typeof record.command === "string") return record.command.trim().slice(0, 120);
  if (typeof record.path === "string") return record.path;
  if (typeof record.pattern === "string" && typeof record.path === "string") return `${record.pattern} in ${record.path}`;
  if (typeof record.query === "string") return record.query;
  const first = Object.entries(record)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .slice(0, 2)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return first.slice(0, 120);
};

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const warnInvalidContentBlock = (context: string) => (issue: { message: string; block: unknown }) => {
  logger.warn(`[Normalize] ${context}: ${issue.message}`, { block: issue.block });
};

type NormalizedToolResultContent = {
  content: string | ContentBlock[];
  isError: boolean;
  errorMessage?: string;
};

const normalizeToolResultBlocks = (blocks: unknown[], context: string): NormalizedToolResultContent => {
  const issues: Array<{ message: string; block: unknown }> = [];
  const content = normalizeContentBlocksSafe(blocks, {
    onInvalid: (issue) => {
      issues.push(issue);
      warnInvalidContentBlock(context)(issue);
    },
  });
  if (issues.length === 0) return { content, isError: false };
  const message = `Tool result content error: ${issues.map((issue) => issue.message).join("; ")}`;
  return { content: message, isError: true, errorMessage: message };
};

const extractToolResultContent = (result: unknown): NormalizedToolResultContent => {
  if (typeof result === "string") return { content: result, isError: false };
  if (!result || typeof result !== "object") return { content: "", isError: false };
  const record = result as Record<string, unknown>;
  if (typeof record.content === "string") return { content: record.content, isError: false };
  if (Array.isArray(record.content)) return normalizeToolResultBlocks(record.content, "tool result content");
  if (typeof record.text === "string") return { content: record.text, isError: false };
  return { content: safeStringify(result), isError: false };
};

type ToolExecution = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  resultContent?: string | ContentBlock[];
  isError: boolean;
  toolUseMeta?: Record<string, unknown>;
  toolResultMeta?: Record<string, unknown>;
};

type NormalizedAssistantTurn = {
  content: ContentBlock[];
  thinking: string;
  thinkingSummary: string;
  toolCallRenderStates: Array<{
    toolCallId: string;
    toolName: string;
    status: "running" | "done" | "failed";
    summary: string;
  }>;
};

const normalizeToolExecutions = (
  assistantMessage: Record<string, unknown>,
  toolResults: Array<Record<string, unknown>>,
): Map<string, ToolExecution> => {
  const executions = new Map<string, ToolExecution>();
  const content = Array.isArray(assistantMessage.content) ? assistantMessage.content : [];

  for (const raw of toolResults) {
    const id = typeof raw.toolCallId === "string" ? raw.toolCallId : "";
    const name = typeof raw.toolName === "string" ? raw.toolName : "";
    if (!id || !name) continue;
    const rawResultContent = "content" in raw ? extractToolResultContent(raw) : null;

    executions.set(id, {
      id,
      name,
      input: (raw.input as Record<string, unknown>) ?? {},
      resultContent: rawResultContent?.content,
      isError: Boolean(raw.isError) || Boolean(rawResultContent?.isError),
      toolResultMeta: {
        ...(((raw._meta as Record<string, unknown> | undefined) ?? (raw.meta as Record<string, unknown> | undefined)) ?? {}),
        ...(rawResultContent?.errorMessage ? { invalidContentBlock: true, errorMessage: rawResultContent.errorMessage } : {}),
      },
    });
  }

  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;

    if ((block.type === "toolCall" || block.type === "tool_use") && typeof block.id === "string" && typeof block.name === "string") {
      const existing = executions.get(block.id);
      executions.set(block.id, {
        id: block.id,
        name: block.name,
        input: (block.type === "toolCall" ? block.arguments : block.input) as Record<string, unknown> ?? existing?.input ?? {},
        resultContent: existing?.resultContent,
        isError: existing?.isError ?? false,
        toolUseMeta: (block._meta as Record<string, unknown> | undefined) ?? existing?.toolUseMeta,
      });
      continue;
    }

    if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
      const existing = executions.get(block.tool_use_id);
      if (!existing) continue;
      const normalizedBlockContent = Array.isArray(block.content)
        ? normalizeToolResultBlocks(block.content, "assistant tool_result content")
        : null;
      executions.set(block.tool_use_id, {
        ...existing,
        resultContent: typeof block.content === "string"
          ? block.content
          : normalizedBlockContent?.content ?? existing.resultContent,
        isError: Boolean(block.is_error) || existing.isError || Boolean(normalizedBlockContent?.isError),
        toolResultMeta: {
          ...(existing.toolResultMeta ?? {}),
          ...((block._meta as Record<string, unknown> | undefined) ?? {}),
          ...(normalizedBlockContent?.errorMessage ? { invalidContentBlock: true, errorMessage: normalizedBlockContent.errorMessage } : {}),
        },
      });
    }
  }

  return executions;
};

const emitToolUseBlock = (
  blocks: ContentBlock[],
  execution: ToolExecution,
  emittedToolUses: Set<string>,
) => {
  if (emittedToolUses.has(execution.id)) return;
  blocks.push({
    type: "tool_use",
    id: execution.id,
    name: execution.name,
    input: execution.input,
    ...(execution.toolUseMeta ? { _meta: execution.toolUseMeta } : {}),
  });
  emittedToolUses.add(execution.id);
};

const emitToolResultBlock = (
  blocks: ContentBlock[],
  execution: ToolExecution,
  emittedToolResults: Set<string>,
) => {
  if (emittedToolResults.has(execution.id) || execution.resultContent === undefined) return;
  blocks.push({
    type: "tool_result",
    tool_use_id: execution.id,
    content: execution.resultContent,
    is_error: execution.isError,
    ...(execution.toolResultMeta ? { _meta: execution.toolResultMeta } : {}),
  });
  emittedToolResults.add(execution.id);
};

export function normalizeAssistantTurn(
  assistantMessage: Record<string, unknown>,
  toolResults: Array<Record<string, unknown>>,
): NormalizedAssistantTurn {
  const blocks: ContentBlock[] = [];
  const content = Array.isArray(assistantMessage.content) ? assistantMessage.content : [];
  const executions = normalizeToolExecutions(assistantMessage, toolResults);
  const emittedToolUses = new Set<string>();
  const emittedToolResults = new Set<string>();

  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;

    if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type === "thinking" && typeof block.thinking === "string") {
      blocks.push({ type: "thinking", thinking: block.thinking });
      continue;
    }
    if (block.type === "image") {
      const normalizedImage = normalizeContentBlockSafe(block, { onInvalid: warnInvalidContentBlock("assistant image block") });
      if (normalizedImage?.type === "image") blocks.push(normalizedImage);
      continue;
    }
    if ((block.type === "toolCall" || block.type === "tool_use") && typeof block.id === "string") {
      const execution = executions.get(block.id);
      if (execution) {
        emitToolUseBlock(blocks, execution, emittedToolUses);
      } else if (typeof block.name === "string") {
        blocks.push({
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: (block.type === "toolCall" ? block.arguments : block.input) as Record<string, unknown> ?? {},
          ...(block._meta && typeof block._meta === "object" ? { _meta: block._meta as Record<string, unknown> } : {}),
        });
        emittedToolUses.add(block.id);
      } else {
        logger.warn("[Normalize] tool block has no matching execution", {
          blockType: block.type,
          toolCallId: block.id,
          hasName: typeof block.name === "string",
        });
      }
      continue;
    }
    if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
      const execution = executions.get(block.tool_use_id);
      if (execution) {
        emitToolUseBlock(blocks, execution, emittedToolUses);
        emitToolResultBlock(blocks, execution, emittedToolResults);
      } else {
        logger.warn("[Normalize] tool_result block has no matching execution", {
          toolCallId: block.tool_use_id,
        });
        const normalizedContent = Array.isArray(block.content)
          ? normalizeToolResultBlocks(block.content, "unmatched tool_result content")
          : null;
        blocks.push({
          type: "tool_result",
          tool_use_id: block.tool_use_id,
          content: typeof block.content === "string"
            ? block.content
            : normalizedContent?.content ?? "",
          is_error: Boolean(block.is_error) || Boolean(normalizedContent?.isError),
          _meta: normalizedContent?.errorMessage
            ? { invalidContentBlock: true, errorMessage: normalizedContent.errorMessage }
            : undefined,
        });
        emittedToolResults.add(block.tool_use_id);
      }
    }
  }

  for (const execution of executions.values()) {
    emitToolUseBlock(blocks, execution, emittedToolUses);
    emitToolResultBlock(blocks, execution, emittedToolResults);
  }

  const thinking = extractThinkingFromContent(assistantMessage.content);
  const thinkingSummary = summarizeThinking(thinking);
  const toolCallRenderStates = [...executions.values()].map((execution) => {
    const status: "running" | "done" | "failed" = execution.resultContent === undefined
      ? "running"
      : execution.isError
        ? "failed"
        : "done";
    return {
      toolCallId: execution.id,
      toolName: execution.name,
      status,
      summary: summarizeToolArgs(execution.name, execution.input),
    };
  });

  return {
    content: blocks,
    thinking,
    thinkingSummary,
    toolCallRenderStates,
  };
}

// ─── Event normalization ───

export async function registerSpaceSession(input: RegisterSessionInput) {
  const url = `${INTERNAL_API_BASE_URL}/internal/spaces/${input.spaceId}/sessions`;
  const response = await fetch(url, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Register session failed ${response.status}: ${text}`);
  }

  return response.json().catch(() => null) as Promise<{
    ok: true;
    session: { id: string };
    bootstrap?: Record<string, unknown> | null;
  } | null>;
}

export async function getSpaceSandbox(input: { spaceId: string }) {
  const url = `${INTERNAL_API_BASE_URL}/internal/spaces/${input.spaceId}/sandbox`;
  const response = await fetch(url, {
    method: "GET",
    headers: internalHeaders(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Get space sandbox failed ${response.status}: ${text}`);
  }

  return response.json().catch(() => null) as Promise<{
    sandbox: {
      status: string;
      podName?: string | null;
      lastActivityAt?: string | null;
      meta?: Record<string, unknown> | null;
    } | null;
  } | null>;
}

export async function recoverSpaceSandbox(input: { spaceId: string; reason?: string; source?: string }) {
  const url = `${INTERNAL_API_BASE_URL}/internal/spaces/${input.spaceId}/sandbox/recover`;
  return postJsonWithRetry({
    url,
    body: { reason: input.reason ?? "recover", source: input.source ?? "agent" },
    errorPrefix: "Recover sandbox failed",
    maxAttempts: 1,
  }) as Promise<{
    ok: boolean;
    status?: string;
    verified?: boolean;
    message?: string;
  } | null>;
}

export async function getSpace(input: { spaceId: string }) {
  const url = `${INTERNAL_API_BASE_URL}/internal/spaces/${input.spaceId}`;
  const response = await fetch(url, {
    method: "GET",
    headers: internalHeaders(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Get space failed ${response.status}: ${text}`);
  }

  return response.json().catch(() => null) as Promise<{
    space: {
      id: string;
      userUuid: string;
      name: string;
    } | null;
  } | null>;
}

export async function interruptSessionTurn(input: {
  spaceId: string;
  sessionId: string;
  turnId: string;
  continuedByTurnId: string;
}) {
  const url = `${INTERNAL_API_BASE_URL}/internal/spaces/${input.spaceId}/sessions/${input.sessionId}/turns/${input.turnId}/interrupt`;
  return postJsonWithRetry({
    url,
    body: { continuedByTurnId: input.continuedByTurnId },
    errorPrefix: "Interrupt session turn failed",
  });
}

export async function abortSessionTurn(input: {
  spaceId: string;
  sessionId: string;
  turnId: string;
  actorUserId?: string | null;
}) {
  const url = `${INTERNAL_API_BASE_URL}/internal/spaces/${input.spaceId}/sessions/${input.sessionId}/turns/${input.turnId}/abort`;
  return postJsonWithRetry({
    url,
    body: { actorUserId: input.actorUserId ?? null },
    errorPrefix: "Abort session turn failed",
  });
}

export async function failSessionTurn(input: {
  spaceId: string;
  sessionId: string;
  turnId: string;
  errorMessage: string;
}) {
  const url = `${INTERNAL_API_BASE_URL}/internal/spaces/${input.spaceId}/sessions/${input.sessionId}/turns/${input.turnId}/fail`;
  return postJsonWithRetry({
    url,
    body: { errorMessage: input.errorMessage },
    errorPrefix: "Fail session turn failed",
  });
}

export async function persistUserMessage(input: {
  spaceId: string;
  sessionId: string;
  userMessageId: string;
  turnId?: string | null;
  content: ContentBlock[];
  meta?: Record<string, unknown> | null;
  startedAt?: string | null;
}) {
  const timing = completeMessageTiming({ startedAt: input.startedAt });
  const payload: PersistMessageInput = {
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    previousMessageId: null,
    anchorUserMessageId: input.userMessageId,
    idempotencyKey: buildUserIdempotencyKey({
      messageId: input.userMessageId,
      content: input.content,
      meta: input.meta ?? null,
    }),
    message: {
      role: "user",
      content: input.content,
      meta: {
        ...(input.meta ?? {}),
        turnId: input.turnId ?? (typeof input.meta?.turnId === "string" ? input.meta.turnId : null),
        messageId: input.userMessageId,
        clientMessageId: typeof input.meta?.clientMessageId === "string" ? input.meta.clientMessageId : null,
        agentSessionEntryId: typeof input.meta?.sessionEntryId === "string" ? input.meta.sessionEntryId : null,
      },
      provider: null,
      model: null,
      stopReason: null,
      errorMessage: null,
      usage: null,
      ...timing,
    },
  };

  const url = `${INTERNAL_API_BASE_URL}/internal/spaces/${input.spaceId}/sessions/${input.sessionId}/messages`;
  return postJsonWithRetry({
    url,
    body: {
      previousMessageId: payload.previousMessageId,
      anchorUserMessageId: payload.anchorUserMessageId,
      idempotencyKey: payload.idempotencyKey,
      message: {
        ...payload.message,
        id: input.userMessageId,
      },
    },
    errorPrefix: "Persist user message failed",
  });
}

type MessageTimingInput = {
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
};

const toDateOrNull = (value: string | Date | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const completeMessageTiming = (input?: MessageTimingInput | null) => {
  const completedAt = toDateOrNull(input?.completedAt) ?? new Date();
  const startedAt = toDateOrNull(input?.startedAt) ?? completedAt;
  const durationMs =
    typeof input?.durationMs === "number" && Number.isFinite(input.durationMs)
      ? Math.max(0, Math.floor(input.durationMs))
      : Math.max(0, completedAt.getTime() - startedAt.getTime());
  return {
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs,
  };
};

const EMPTY_ASSISTANT_MESSAGE_ERROR = "LLM returned an empty assistant message after streaming completed.";

export async function persistAssistantMessage(input: {
  spaceId: string;
  spaceSessionId: string;
  userMessageId: string;
  event: Record<string, unknown>;
  userId?: string | null;
  turnId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}) {
  const assistantMessage = input.event.message;
  const toolResultsRaw = Array.isArray(input.event.toolResults)
    ? (input.event.toolResults as Array<Record<string, unknown>>)
    : [];

  if (!assistantMessage || typeof assistantMessage !== "object") {
    logger.warn("[Persist] turn_end event missing assistant message payload.");
    return;
  }

  const assistant = assistantMessage as Record<string, unknown>;
  const normalized = normalizeAssistantTurn(assistant, toolResultsRaw);
  const { content, thinking, thinkingSummary, toolCallRenderStates } = normalized;

  const stopReason = typeof assistant.stopReason === "string" ? assistant.stopReason : null;
  const errorMessage = typeof assistant.errorMessage === "string" ? assistant.errorMessage : null;
  const timing = completeMessageTiming({
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  });
  const hasAssistantError = stopReason === "error" || stopReason === "aborted" || Boolean(errorMessage);
  const isEmptySuccessfulAssistant = content.length === 0 && !hasAssistantError;
  const effectiveStopReason = isEmptySuccessfulAssistant ? "error" : stopReason;
  const effectiveErrorMessage = isEmptySuccessfulAssistant ? EMPTY_ASSISTANT_MESSAGE_ERROR : errorMessage;

  if (isEmptySuccessfulAssistant) {
    logger.warn("[Persist] empty assistant message converted to error", {
      spaceId: input.spaceId,
      spaceSessionId: input.spaceSessionId,
      userMessageId: input.userMessageId,
      stopReason,
    });
  }

  const payload: PersistMessageInput = {
    spaceId: input.spaceId,
    sessionId: input.spaceSessionId,
    previousMessageId: input.userMessageId,
    anchorUserMessageId: input.userMessageId,
    userId: input.userId ?? null,
    idempotencyKey: "",
    message: {
      role: "assistant",
      externalMessageId: typeof assistant.id === "string" ? assistant.id : null,
      protocolMessageId: typeof assistant.id === "string" ? assistant.id : null,
      content,
      provider: typeof assistant.provider === "string" ? assistant.provider : null,
      model: typeof assistant.model === "string" ? assistant.model : null,
      stopReason: effectiveStopReason,
      errorMessage: effectiveErrorMessage,
      meta: {
        ...((assistant.meta && typeof assistant.meta === "object" && !Array.isArray(assistant.meta))
          ? (assistant.meta as Record<string, unknown>)
          : {}),
        turnId: input.turnId ?? null,
        spaceId: input.spaceId,
        sessionId: input.spaceSessionId,
        rawStopReason: stopReason,
        ...(isEmptySuccessfulAssistant ? { emptyAssistantMessageConvertedToError: true } : {}),
        thinking,
        thinkingSummary,
        toolCallRenderStates,
        agentSessionEntryId: typeof assistant.sessionEntryId === "string" ? assistant.sessionEntryId : null,
      },
      usage:
        assistant.usage && typeof assistant.usage === "object"
          ? {
              input:
                typeof (assistant.usage as Record<string, unknown>).input === "number"
                  ? ((assistant.usage as Record<string, unknown>).input as number)
                  : undefined,
              output:
                typeof (assistant.usage as Record<string, unknown>).output === "number"
                  ? ((assistant.usage as Record<string, unknown>).output as number)
                  : undefined,
              cacheRead:
                typeof (assistant.usage as Record<string, unknown>).cacheRead === "number"
                  ? ((assistant.usage as Record<string, unknown>).cacheRead as number)
                  : undefined,
              cacheWrite:
                typeof (assistant.usage as Record<string, unknown>).cacheWrite === "number"
                  ? ((assistant.usage as Record<string, unknown>).cacheWrite as number)
                  : undefined,
              totalTokens:
                typeof (assistant.usage as Record<string, unknown>).totalTokens === "number"
                  ? ((assistant.usage as Record<string, unknown>).totalTokens as number)
                  : undefined,
              cost:
                assistant.usage &&
                typeof (assistant.usage as Record<string, unknown>).cost === "object"
                  ? {
                      input:
                        typeof (((assistant.usage as Record<string, unknown>).cost as Record<string, unknown>).input) === "number"
                          ? ((((assistant.usage as Record<string, unknown>).cost as Record<string, unknown>).input) as number)
                          : undefined,
                      output:
                        typeof (((assistant.usage as Record<string, unknown>).cost as Record<string, unknown>).output) === "number"
                          ? ((((assistant.usage as Record<string, unknown>).cost as Record<string, unknown>).output) as number)
                          : undefined,
                      cacheRead:
                        typeof (((assistant.usage as Record<string, unknown>).cost as Record<string, unknown>).cacheRead) === "number"
                          ? ((((assistant.usage as Record<string, unknown>).cost as Record<string, unknown>).cacheRead) as number)
                          : undefined,
                      cacheWrite:
                        typeof (((assistant.usage as Record<string, unknown>).cost as Record<string, unknown>).cacheWrite) === "number"
                          ? ((((assistant.usage as Record<string, unknown>).cost as Record<string, unknown>).cacheWrite) as number)
                          : undefined,
                      total:
                        typeof (((assistant.usage as Record<string, unknown>).cost as Record<string, unknown>).total) === "number"
                          ? ((((assistant.usage as Record<string, unknown>).cost as Record<string, unknown>).total) as number)
                          : undefined,
                    }
                  : null,
            }
          : null,
      ...timing,
    },
  };

  payload.idempotencyKey = buildAssistantIdempotencyKey({
    previousMessageId: payload.previousMessageId ?? "root",
    message: payload.message,
  });

  const url = `${INTERNAL_API_BASE_URL}/internal/spaces/${input.spaceId}/sessions/${input.spaceSessionId}/messages`;
  await postJsonWithRetry({
    url,
    body: payload,
    errorPrefix: "Persist API responded",
  });
}
