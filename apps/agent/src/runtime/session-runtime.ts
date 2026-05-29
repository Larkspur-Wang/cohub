import type { Agent, AgentEvent, AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import { Agent as PiAgent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream, streamSimple, type Api, type Context, type ImageContent, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { context, trace, type Span } from "@opentelemetry/api";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { logger } from "../logger.js";
import type { SessionManager } from "./local-session-manager.js";
import type { CohubModelRegistry } from "./model-registry.js";
import { buildCohubSystemPrompt } from "./system-prompt-builder.js";
import { recordLlmUsage, startLlmRoundSpan, getAgentTracer } from "@cohub/infra/tracing/agent";
import { getCurrentToolExecutionContext } from "../tool-context.js";
import { isToolFailureDetails } from "./tools/index.js";

import type { SpaceModListItem } from "@cohub/core/space-mods";

export type CohubAgentSessionEvent = AgentEvent;

export type CohubAgentSession = {
  agent: Agent;
  modelRegistry: CohubModelRegistry;
  sessionManager: SessionManager;
  isStreaming: boolean;
  isRetrying: boolean;
  shouldDeferErrorPersistence(message: Record<string, unknown>): boolean;
  prompt(text: string, options?: { images?: ImageContent[] }): Promise<void>;
  promptMessages(messages: AgentMessage[]): Promise<void>;
  steer(text: string, images?: ImageContent[]): Promise<void>;
  enqueueSteer(text: string, images?: ImageContent[]): void;
  waitForIdle(): Promise<void>;
  setModel(model: Model<Api>): Promise<void>;
  reload(): Promise<void>;
  abort(): Promise<void>;
  dispose(): void;
  subscribe(listener: (event: CohubAgentSessionEvent) => void): () => void;
};

type ToolLike = {
  name: string;
};

const AGENT_RETRY_ENABLED = true;
const AGENT_RETRY_MAX_RETRIES = 2;
const AGENT_RETRY_BASE_DELAY_MS = 1000;

function isRetryableAssistantError(message: AssistantMessage | undefined): boolean {
  if (message?.stopReason !== "error" || !message.errorMessage) return false;
  return /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i.test(
    message.errorMessage,
  );
}

function hasAssistantContent(message: AssistantMessage): boolean {
  const content = Array.isArray(message.content) ? message.content : [];
  return content.length > 0;
}

function isEmptySuccessfulAssistantMessage(message: AssistantMessage | undefined): boolean {
  if (!message) return false;
  if (message.stopReason === "error" || message.stopReason === "aborted") return false;
  return !hasAssistantContent(message);
}

export function isRetryableAssistantFailure(message: AssistantMessage | undefined): boolean {
  return isRetryableAssistantError(message) || isEmptySuccessfulAssistantMessage(message);
}

type AssistantRetryOutcome = {
  shouldRetry: boolean;
  retryAttempt: number;
  retryDelayMs?: number;
  retryReason?: string;
};

function getAssistantRetryOutcome(message: AssistantMessage | undefined, retryAttempt: number): AssistantRetryOutcome {
  if (!AGENT_RETRY_ENABLED || !isRetryableAssistantFailure(message) || retryAttempt >= AGENT_RETRY_MAX_RETRIES) {
    return { shouldRetry: false, retryAttempt };
  }

  return {
    shouldRetry: true,
    retryAttempt: retryAttempt + 1,
    retryDelayMs: AGENT_RETRY_BASE_DELAY_MS * 2 ** retryAttempt,
    retryReason: message?.stopReason === "error"
      ? (message?.errorMessage ?? "assistant_error")
      : "empty_assistant_message",
  };
}

function recordAssistantRetrySpanAttributes(span: Span | undefined, outcome: AssistantRetryOutcome) {
  if (!span) return;
  span.setAttribute("agent.retry.should_retry", outcome.shouldRetry);
  span.setAttribute("agent.retry.attempt", outcome.retryAttempt);
  if (outcome.retryDelayMs != null) span.setAttribute("agent.retry.delay_ms", outcome.retryDelayMs);
  if (outcome.retryReason) span.setAttribute("agent.retry.reason", outcome.retryReason);
}

function logAssistantRetry(sessionId: string, turnId: string | undefined, outcome: AssistantRetryOutcome) {
  const contextInfo = `sessionId=${sessionId}${turnId ? ` turnId=${turnId}` : ""}`;
  const reason = outcome.retryReason ?? "not_retryable";
  if (outcome.shouldRetry) {
    logger.info(
      `[Agent] assistant retry scheduled ${contextInfo} attempt=${outcome.retryAttempt} delayMs=${outcome.retryDelayMs} reason=${reason}`,
    );
  } else {
    logger.debug(`[Agent] assistant retry not scheduled ${contextInfo} attempt=${outcome.retryAttempt} reason=${reason}`);
  }
}


export function shouldResetAssistantRetryState(message: AssistantMessage | undefined): boolean {
  return !isRetryableAssistantFailure(message);
}

export type CreateCohubAgentSessionOptions = {
  cwd: string;
  userId?: string | null;
  sessionManager: SessionManager;
  modelRegistry: CohubModelRegistry;
  tools: ToolLike[];
  spaceMods?: SpaceModListItem[];
  model?: Model<Api>;
};

function extractTextFromToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => block && typeof block === "object" && (block as Record<string, unknown>).type === "text"
      ? String((block as Record<string, unknown>).text ?? "")
      : "")
    .join("");
}

function shellCommandResultToText(message: Record<string, unknown>) {
  const meta = message.meta && typeof message.meta === "object" && !Array.isArray(message.meta)
    ? message.meta as Record<string, unknown>
    : {};
  if (typeof meta.llmContextText === "string") return meta.llmContextText;

  const content = Array.isArray(message.content) ? message.content : [];
  const toolUse = content.find((block) => block && typeof block === "object" && (block as Record<string, unknown>).type === "tool_use") as Record<string, unknown> | undefined;
  const toolResult = content.find((block) => block && typeof block === "object" && (block as Record<string, unknown>).type === "tool_result") as Record<string, unknown> | undefined;
  const input = toolUse?.input && typeof toolUse.input === "object" ? toolUse.input as Record<string, unknown> : {};
  const command = typeof meta.command === "string" ? meta.command : typeof input.command === "string" ? input.command : "";
  const output = extractTextFromToolResultContent(toolResult?.content);
  const resultMeta = toolResult?._meta && typeof toolResult._meta === "object" ? toolResult._meta as Record<string, unknown> : {};
  const exitCode = typeof meta.exitCode === "number" ? meta.exitCode : typeof resultMeta.exitCode === "number" ? resultMeta.exitCode : null;
  const cancelled = meta.cancelled === true || resultMeta.cancelled === true;

  let text = `Ran \`${command}\``;
  text += output ? `\n\`\`\`\n${output}\n\`\`\`` : "\n(no output)";
  if (cancelled) {
    text += "\n\n(command cancelled)";
  } else if (exitCode != null && exitCode !== 0) {
    text += `\n\nCommand exited with code ${exitCode}`;
  }
  return text;
}

const SUPPORTED_LLM_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function isSupportedLlmImageMimeType(mimeType: string | null | undefined): boolean {
  return mimeType != null && SUPPORTED_LLM_IMAGE_MIME_TYPES.has(mimeType);
}

function toLlmImageContent(block: Record<string, unknown>): ImageContent | null {
  const directData = typeof block.data === "string" && block.data.trim() ? block.data : null;
  if (directData) {
    const mimeType = typeof block.mimeType === "string" && block.mimeType.trim()
      ? block.mimeType.trim()
      : typeof block.media_type === "string" && block.media_type.trim()
        ? block.media_type.trim()
        : "application/octet-stream";
    if (!isSupportedLlmImageMimeType(mimeType)) return null;
    return {
      type: "image",
      data: directData.replace(/^data:[^;,]+;base64,/, ""),
      mimeType,
    };
  }

  const source = block.source && typeof block.source === "object" && !Array.isArray(block.source)
    ? block.source as Record<string, unknown>
    : null;

  if (source?.type !== "base64" || typeof source.data !== "string" || !source.data.trim()) {
    return null;
  }

  const mimeType = typeof source.media_type === "string" && source.media_type.trim()
    ? source.media_type.trim()
    : "application/octet-stream";
  if (!isSupportedLlmImageMimeType(mimeType)) return null;
  return {
    type: "image",
    data: source.data.replace(/^data:[^;,]+;base64,/, ""),
    mimeType,
  };
}

function toLlmTextContent(block: Record<string, unknown>) {
  return {
    type: "text",
    text: typeof block.text === "string" ? block.text : "",
  };
}

function toLlmUserMessage(message: AgentMessage): AgentMessage | null {
  const record = message as unknown as Record<string, unknown>;
  if (!Array.isArray(record.content)) return message;

  const content = record.content
    .map((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) return null;
      const item = block as Record<string, unknown>;
      if (item.type === "text") return toLlmTextContent(item);
      if (item.type === "image") return toLlmImageContent(item);
      return null;
    })
    .filter((block): block is ImageContent | { type: "text"; text: string } => Boolean(block));

  if (content.length === 0) return null;
  return {
    ...record,
    content,
  } as unknown as AgentMessage;
}

function toLlmToolResultMessage(message: AgentMessage): AgentMessage {
  const record = message as unknown as Record<string, unknown>;
  if (!Array.isArray(record.content)) return message;

  const content = record.content
    .map((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) return null;
      const item = block as Record<string, unknown>;
      if (item.type === "text") return toLlmTextContent(item);
      if (item.type === "image") return toLlmImageContent(item) ?? null;
      return null;
    })
    .filter((block): block is ImageContent | { type: "text"; text: string } => Boolean(block));

  return {
    ...record,
    content,
  } as unknown as AgentMessage;
}

function toLlmMessages(messages: AgentMessage[]) {
  const result: unknown[] = [];
  for (const message of messages) {
    const record = message as unknown as Record<string, unknown>;
    const role = record.role;
    const meta = record.meta && typeof record.meta === "object" && !Array.isArray(record.meta)
      ? record.meta as Record<string, unknown>
      : {};

    if (role === "user" && Array.isArray(record.content) && record.content.some((block) => Boolean(block && typeof block === "object" && (block as Record<string, unknown>).type === "shell_command"))) {
      continue;
    }

    if (role === "assistant" && meta.messageKind === "shell_command_result") {
      result.push({
        role: "user",
        content: [{ type: "text", text: shellCommandResultToText(record) }],
        timestamp: typeof record.timestamp === "number" ? record.timestamp : Date.now(),
      });
      continue;
    }

    if (role === "user") {
      const userMessage = toLlmUserMessage(message);
      if (userMessage) result.push(userMessage);
      continue;
    }

    if (role === "assistant") {
      result.push(message);
      continue;
    }

    if (role === "toolResult") {
      result.push(toLlmToolResultMessage(message));
    }
  }
  return result as never;
}

function createStreamFn(modelRegistry: CohubModelRegistry, userId?: string | null): StreamFn {
  const tracer = getAgentTracer();

  return async (model: Model<Api>, ctx: Context, options?: SimpleStreamOptions) => {
    const toolCtx = getCurrentToolExecutionContext();
    const round = (toolCtx?.llmRound ?? 0) + 1;
    if (toolCtx) {
      toolCtx.llmRound = round;
    }
    const metrics = toolCtx?.metrics;
    if (metrics) {
      metrics.llmRoundCount = Math.max(metrics.llmRoundCount, round);
    }

    const llmRound = startLlmRoundSpan(tracer, {
      provider: model.provider,
      model: model.id,
      messageCount: ctx.messages.length,
      spaceId: toolCtx?.spaceId,
      sessionId: toolCtx?.sessionId,
      turnId: toolCtx?.turnId,
      turnSeq: toolCtx?.turnSeq,
      requestId: toolCtx?.requestId ?? undefined,
      llmRound: round,
    });

    return context.with(llmRound.context, async () => {
      try {
        if (toolCtx?.assistantMessageTiming && !toolCtx.assistantMessageTiming.startedAt) {
          toolCtx.assistantMessageTiming.startedAt = new Date().toISOString();
        }
        const headers = modelRegistry.getHeaders(model.provider, model.id);
        const streamHeaders = headers ? { ...headers, ...(options?.headers ?? {}) } : options?.headers;
        const stream = await streamSimple(model, ctx, {
          ...options,
          headers: model.provider === "cohub"
            ? {
                ...streamHeaders,
                "x-litellm-track-extra": JSON.stringify({
                  user_uuid: userId?.trim() || null,
                  cohub_space_uuid: toolCtx?.spaceId ?? null,
                  cohub_session_uuid: toolCtx?.sessionId ?? null,
                }),
              }
            : streamHeaders,
        });

        const wrapped = createAssistantMessageEventStream();
        void context.with(llmRound.context, async () => {
          try {
            for await (const event of stream) {
              if (event.type !== "start") {
                llmRound.markFirstToken();
              }

              wrapped.push(event);

              if (event.type === "done") {
                recordLlmUsage(llmRound.span, {
                  inputTokens: event.message.usage?.input,
                  outputTokens: event.message.usage?.output,
                  totalTokens: event.message.usage?.totalTokens,
                  cacheReadTokens: event.message.usage?.cacheRead,
                  cacheWriteTokens: event.message.usage?.cacheWrite,
                  cost: event.message.usage?.cost?.total,
                });
                llmRound.finish({ finishReason: event.reason, outcome: "ok" });
              } else if (event.type === "error") {
                recordLlmUsage(llmRound.span, {
                  inputTokens: event.error.usage?.input,
                  outputTokens: event.error.usage?.output,
                  totalTokens: event.error.usage?.totalTokens,
                  cacheReadTokens: event.error.usage?.cacheRead,
                  cacheWriteTokens: event.error.usage?.cacheWrite,
                  cost: event.error.usage?.cost?.total,
                });
                llmRound.finish({ finishReason: event.reason, outcome: event.reason === "aborted" ? "aborted" : "error" });
              }
            }
          } catch (error) {
            llmRound.fail(error);
            wrapped.end();
          } finally {
            if (toolCtx) {
              toolCtx.llmRound = round - 1;
            }
          }
        }).catch((error) => {
          llmRound.fail(error);
          wrapped.end();
        });

        return wrapped;
      } catch (error) {
        llmRound.fail(error);
        throw error;
      }
    });
  };
}

function createUserMessage(text: string, images?: ImageContent[]): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }, ...(images ?? [])],
    timestamp: Date.now(),
  } as AgentMessage;
}

function toolSnippets(toolName: string): string | undefined {
  switch (toolName) {
    case "read": return "Read file contents";
    case "bash": return "Execute bash commands";
    case "edit": return "Make precise file edits with exact text replacement";
    case "write": return "Create or overwrite files";
    case "grep": return "Search file contents";
    case "find": return "Search files by glob pattern";
    case "ls": return "List directory contents";
    default: return undefined;
  }
}

export async function createCohubAgentSession(options: CreateCohubAgentSessionOptions): Promise<{ session: CohubAgentSession }> {
  const sessionContext = options.sessionManager.buildSessionContext();
  const model = options.model ?? (sessionContext.model ? options.modelRegistry.find(sessionContext.model.provider, sessionContext.model.modelId) : undefined) ?? options.modelRegistry.getDefault();
  if (!model) {
    throw new Error("No model available. Check platform models.json");
  }

  if (sessionContext.messages.length === 0) {
    options.sessionManager.appendModelChange(model.provider, model.id);
    options.sessionManager.appendThinkingLevelChange(model.reasoning ? "medium" : "off");
  }

  const systemPrompt = await buildCohubSystemPrompt({
    cwd: options.cwd,
    userId: options.userId,
    selectedTools: options.tools.map((tool) => tool.name),
    toolSnippets: Object.fromEntries(options.tools.map((tool) => [tool.name, toolSnippets(tool.name)]).filter((entry): entry is [string, string] => Boolean(entry[1]))),
    spaceMods: options.spaceMods ?? [],
  });

  const agent = new PiAgent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: model.reasoning ? "medium" : "off",
      tools: options.tools as never,
      messages: sessionContext.messages,
    },
    steeringMode: "all",
    convertToLlm: toLlmMessages,
    streamFn: createStreamFn(options.modelRegistry, options.userId),
    getApiKey: (provider: string) => options.modelRegistry.getApiKey(provider),
    async afterToolCall({ result }) {
      if (!isToolFailureDetails(result.details)) return undefined;
      return { isError: true };
    },
  });

  let lastAssistantMessage: AssistantMessage | undefined;
  let retryAttempt = 0;
  let retryPromise: Promise<void> | null = null;
  let retryResolve: (() => void) | null = null;
  let retryReject: ((error: Error) => void) | null = null;
  let retryFailure: Error | null = null;
  let retryScheduled = false;
  let retryCancelled = false;
  let retryTimeout: ReturnType<typeof setTimeout> | null = null;

  const ensureRetryPromise = () => {
    if (retryPromise) return retryPromise;
    retryPromise = new Promise<void>((resolve, reject) => {
      retryResolve = resolve;
      retryReject = reject;
    });
    retryPromise.catch(() => {});
    return retryPromise;
  };

  const clearRetryTimer = () => {
    if (!retryTimeout) return;
    clearTimeout(retryTimeout);
    retryTimeout = null;
  };

  const finishRetry = () => {
    retryScheduled = false;
    retryCancelled = false;
    clearRetryTimer();
    retryFailure = null;
    retryResolve?.();
    retryResolve = null;
    retryReject = null;
    retryPromise = null;
  };

  const failRetry = (error: Error) => {
    retryFailure = error;
    retryScheduled = false;
    retryCancelled = false;
    clearRetryTimer();
    retryReject?.(error);
    retryResolve = null;
    retryReject = null;
    retryPromise = null;
  };

  const getRecentMessageRoles = () => agent.state.messages.slice(-8).map((message) => message.role).join(",");

  const waitForRetryIfNeeded = async () => {
    const pendingRetry = retryPromise;
    if (pendingRetry) {
      try {
        await pendingRetry;
      } catch (error) {
        retryFailure = null;
        throw error;
      }
    }
    if (retryFailure) {
      const error = retryFailure;
      retryFailure = null;
      throw error;
    }
  };

  const unsubscribe = agent.subscribe((event: AgentEvent) => {
    if (event.type === "message_end") {
      const message = event.message as { role?: string };
      if (message.role === "assistant") {
        const assistantMessage = event.message as AssistantMessage;
        lastAssistantMessage = assistantMessage;
        const retryOutcome = getAssistantRetryOutcome(assistantMessage, retryAttempt);
        const sessionId = getCurrentToolExecutionContext()?.sessionId ?? "unknown";
        const turnId = getCurrentToolExecutionContext()?.turnId ?? undefined;
        logAssistantRetry(sessionId, turnId, retryOutcome);
        recordAssistantRetrySpanAttributes(trace.getActiveSpan(), retryOutcome);
        if (!retryOutcome.shouldRetry) {
          const entryId = options.sessionManager.appendMessage(event.message as never);
          (event.message as unknown as Record<string, unknown>).sessionEntryId = entryId;
        }
        if (shouldResetAssistantRetryState(assistantMessage)) {
          retryAttempt = 0;
          finishRetry();
        }
      } else if (message.role === "user" || message.role === "toolResult") {
        const entryId = options.sessionManager.appendMessage(event.message as never);
        (event.message as unknown as Record<string, unknown>).sessionEntryId = entryId;
      }
      return;
    }

    if (event.type === "agent_end" && lastAssistantMessage) {
      const assistantMessage = lastAssistantMessage;
      lastAssistantMessage = undefined;
      if (AGENT_RETRY_ENABLED && isRetryableAssistantFailure(assistantMessage) && retryAttempt < AGENT_RETRY_MAX_RETRIES) {
        retryAttempt += 1;
        retryScheduled = true;
        ensureRetryPromise();

        const messages = agent.state.messages;
        if (messages.length > 0 && messages[messages.length - 1]?.role === "assistant") {
          agent.state.messages = messages.slice(0, -1);
        }

        const delayMs = AGENT_RETRY_BASE_DELAY_MS * 2 ** (retryAttempt - 1);
        retryCancelled = false;
        retryTimeout = setTimeout(() => {
          retryTimeout = null;
          if (retryCancelled) return;
          logger.info(`[AgentRetry] continue:start sessionId=${getCurrentToolExecutionContext()?.sessionId ?? "unknown"} turnId=${getCurrentToolExecutionContext()?.turnId ?? "unknown"} attempt=${retryAttempt} roles=${getRecentMessageRoles()}`);
          void agent.continue().catch((error) => {
            const normalized = error instanceof Error ? error : new Error(String(error));
            logger.error("[AgentRetry] continue:failed", {
              sessionId: getCurrentToolExecutionContext()?.sessionId ?? "unknown",
              turnId: getCurrentToolExecutionContext()?.turnId ?? null,
              retryAttempt,
              retryCancelled,
              agentIsStreaming: agent.state.isStreaming,
              recentRoles: getRecentMessageRoles(),
              lastAssistantStopReason: assistantMessage.stopReason ?? null,
              lastAssistantErrorMessage: assistantMessage.errorMessage ?? null,
              lastAssistantContentLength: Array.isArray(assistantMessage.content) ? assistantMessage.content.length : null,
              errorName: normalized.name,
              errorMessage: normalized.message,
              stack: normalized.stack,
            });
            failRetry(normalized);
          });
        }, delayMs);
        return;
      }

      retryAttempt = 0;
      finishRetry();
    }
  });

  const session: CohubAgentSession = {
    agent,
    modelRegistry: options.modelRegistry,
    sessionManager: options.sessionManager,
    get isStreaming() {
      return agent.state.isStreaming;
    },
    get isRetrying() {
      return retryScheduled || retryPromise !== null;
    },
    shouldDeferErrorPersistence(message) {
      const assistantMessage = message as unknown as AssistantMessage;
      return AGENT_RETRY_ENABLED
        && isRetryableAssistantFailure(assistantMessage)
        && retryAttempt < AGENT_RETRY_MAX_RETRIES;
    },
    async prompt(text, inputOptions) {
      await agent.prompt(text, inputOptions?.images);
      await agent.waitForIdle();
      await waitForRetryIfNeeded();
      await agent.waitForIdle();
    },
    async promptMessages(messages) {
      await agent.prompt(messages);
      await agent.waitForIdle();
      await waitForRetryIfNeeded();
      await agent.waitForIdle();
    },
    async steer(text, images) {
      agent.steer(createUserMessage(text, images));
      await agent.waitForIdle();
    },
    enqueueSteer(text, images) {
      agent.steer(createUserMessage(text, images));
    },
    async waitForIdle() {
      await agent.waitForIdle();
      await waitForRetryIfNeeded();
      await agent.waitForIdle();
    },
    async setModel(nextModel) {
      agent.state.model = nextModel;
      options.sessionManager.appendModelChange(nextModel.provider, nextModel.id);
    },
    async reload() {
      const nextPrompt = await buildCohubSystemPrompt({
        cwd: options.cwd,
        userId: options.userId,
        selectedTools: options.tools.map((tool) => tool.name),
        toolSnippets: Object.fromEntries(options.tools.map((tool) => [tool.name, toolSnippets(tool.name)]).filter((entry): entry is [string, string] => Boolean(entry[1]))),
        spaceMods: options.spaceMods ?? [],
      });
      agent.state.systemPrompt = nextPrompt;
      agent.state.tools = options.tools as never;
    },
    async abort() {
      retryCancelled = true;
      clearRetryTimer();
      if (retryPromise) finishRetry();
      agent.abort();
      await agent.waitForIdle();
      retryAttempt = 0;
      finishRetry();
    },
    dispose() {
      unsubscribe();
      retryCancelled = true;
      clearRetryTimer();
      if (retryPromise) finishRetry();
      retryAttempt = 0;
      agent.abort();
    },
    subscribe(listener) {
      return agent.subscribe((event: AgentEvent) => {
        listener(event);
      });
    },
  };

  return { session };
}
