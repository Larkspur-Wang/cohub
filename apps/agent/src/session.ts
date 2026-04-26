import { existsSync, renameSync } from "node:fs";
import { SessionManager } from "./runtime/local-session-manager.js";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import { getSpace, persistAssistantMessage, persistUserMessage, registerSpaceSession } from "./api.js";
import { sendOutput } from "./redis.js";
import type { CohubModelRegistry } from "./runtime/model-registry.js";
import {
  ensureAgentSpaceSessionPath,
  getAgentSessionFilePath,
  getAgentSpaceSessionsPath,
  getAgentWorkspacePath,
} from "./runtime/paths.js";
import { createCohubAgentSession, type CohubAgentSession } from "./runtime/session-runtime.js";
import type { createSandboxCodingTools } from "./sandbox/tools.js";
import {
  applyAssistantMessageEvent,
  applyToolExecutionEnd,
  applyToolExecutionStart,
  createAssistantStreamState,
  projectAssistantStreamState,
  type AssistantStreamState,
} from "./stream/assistant-stream-state.js";

export type PendingUserMessage = {
  userMessageId: string;
  content: ContentBlock[];
  meta?: Record<string, unknown> | null;
};

export type SessionHandle = {
  spaceId: string;
  spaceOwnerUserId: string | null;
  sessionKey: string;
  sessionId: string;
  session: CohubAgentSession;
  sessionManager: SessionManager;
  ownerEpoch: number;
  lastActiveAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  onIdle?: ((handle: SessionHandle) => void) | null;
  pendingUserMessages: PendingUserMessage[];
  currentUserMessageId: string | null;
  currentUserMessageContent: ContentBlock[] | null;
  currentUserMessageMeta: Record<string, unknown> | null;
  persistenceChain: Promise<void>;
  streamState: {
    assistantState: AssistantStreamState;
    content: ContentBlock[];
    preferredDisplayMode: "full" | "compact" | "minimal";
    /** Snapshot of the content sent in the last stream_update, used for delta computation. */
    lastSent?: ContentBlock[];
    pendingFlush?: boolean;
    flushPromise?: Promise<void> | null;
  };
};

export function getSessionKey(spaceId: string, sessionId: string) {
  return `${spaceId}:${sessionId}`;
}

function setSessionManagerFilePath(sessionManager: SessionManager, sessionFile: string) {
  ((sessionManager as unknown) as { sessionFile?: string }).sessionFile = sessionFile;
}
function summarizeToolArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const record = args as Record<string, unknown>;

  if (toolName === "bash" && typeof record.command === "string") {
    return record.command.trim().slice(0, 120);
  }

  if (typeof record.path === "string") return record.path;
  if (typeof record.pattern === "string" && typeof record.path === "string") {
    return `${record.pattern} in ${record.path}`;
  }
  if (typeof record.query === "string") return record.query;

  const first = Object.entries(record)
    .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 2)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  return first.slice(0, 120);
}


async function emitProviderRenderUpdate(handle: SessionHandle) {
  const sourceMessageId = handle.currentUserMessageId?.trim() || null;
  if (!sourceMessageId) return;

  if (handle.streamState.flushPromise) {
    handle.streamState.pendingFlush = true;
    return;
  }

  const flush = async () => {
    const full = handle.streamState.content;
    const last = handle.streamState.lastSent ?? [];
    const delta = computeDelta(full, last);

    handle.streamState.lastSent = structuredClone(full);
    handle.streamState.pendingFlush = false;

    await sendOutput({
      type: "stream_update",
      spaceId: handle.spaceId,
      sessionId: handle.sessionId,
      content: delta,
      sourceMessageId,
      timestamp: Date.now(),
    });

    handle.streamState.flushPromise = null;
    if (handle.streamState.pendingFlush) {
      void emitProviderRenderUpdate(handle);
    }
  };

  handle.streamState.flushPromise = flush();
  await handle.streamState.flushPromise;
}

function resetStreamState(handle: SessionHandle) {
  handle.streamState = {
    assistantState: createAssistantStreamState(),
    content: [],
    preferredDisplayMode: handle.streamState.preferredDisplayMode,
    lastSent: [],
    pendingFlush: false,
    flushPromise: null,
  };
}

function getStreamIndex(block: ContentBlock): number | null {
  const value = block._meta?.streamIndex;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function buildBlockIdentity(block: ContentBlock): string {
  const streamIndex = getStreamIndex(block);
  if (streamIndex != null) return `stream:${streamIndex}`;
  if (block.type === "tool_use") return `tool_use:${block.id}`;
  if (block.type === "tool_result") return `tool_result:${block.tool_use_id}`;
  return `${block.type}:${JSON.stringify(block)}`;
}

/** Compute the minimal delta between the current full content and the last-sent snapshot. */
function computeDelta(full: ContentBlock[], last: ContentBlock[]): ContentBlock[] {
  const delta: ContentBlock[] = [];
  const lastByIdentity = new Map(last.map((block) => [buildBlockIdentity(block), block]));

  for (const block of full) {
    const prev = lastByIdentity.get(buildBlockIdentity(block));

    if (block.type === "text") {
      const prevText = prev?.type === "text" ? prev.text : null;
      if (prevText == null) {
        delta.push(block);
      } else if (block.text.length > prevText.length) {
        const suffix = block.text.slice(prevText.length);
        if (suffix) {
          delta.push({
            type: "text",
            text: suffix,
            ...(block._meta ? { _meta: block._meta } : {}),
          });
        }
      }
    } else if (block.type === "thinking") {
      const prevThinking = prev?.type === "thinking" ? prev.thinking : null;
      if (prevThinking == null) {
        delta.push(block);
      } else if (block.thinking.length > prevThinking.length) {
        const suffix = block.thinking.slice(prevThinking.length);
        if (suffix) {
          delta.push({
            type: "thinking",
            thinking: suffix,
            ...(block.signature ? { signature: block.signature } : {}),
            ...(block._meta ? { _meta: block._meta } : {}),
          });
        }
      }
    } else if (block.type === "tool_use") {
      if (
        !prev ||
        prev.type !== "tool_use" ||
        prev._meta?.toolStatus !== block._meta?.toolStatus ||
        JSON.stringify(prev.input) !== JSON.stringify(block.input) ||
        prev.name !== block.name
      ) {
        delta.push(block);
      }
    } else if (block.type === "tool_result") {
      if (
        !prev ||
        prev.type !== "tool_result" ||
        JSON.stringify(prev.content) !== JSON.stringify(block.content) ||
        prev.is_error !== block.is_error
      ) {
        delta.push(block);
      }
    } else {
      if (!prev || JSON.stringify(prev) !== JSON.stringify(block)) {
        delta.push(block);
      }
    }
  }

  return delta;
}

function enqueuePersistence(handle: SessionHandle, label: string, task: () => Promise<void>) {
  const next = handle.persistenceChain
    .catch((error) => {
      console.error(`[Agent] Previous persistence task failed for session ${handle.sessionId}:`, error);
    })
    .then(task)
    .catch((error) => {
      console.error(`[Agent] Persistence task failed (${label}) for session ${handle.sessionId}:`, error);
      throw error;
    });

  handle.persistenceChain = next.catch(() => undefined);
  return next;
}

function extractTextFromToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  // Handle structured content array: [{type: "text", text: "..."}, ...]
  if (Array.isArray(record.content)) {
    const texts: string[] = [];
    for (const item of record.content) {
      if (item && typeof item === "object" && "type" in item) {
        const block = item as Record<string, unknown>;
        if (block.type === "text" && typeof block.text === "string") texts.push(block.text);
      }
    }
    if (texts.length > 0) return texts.join("");
  }
  return "";
}

export function subscribeSessionEvents(handle: SessionHandle) {
  handle.session.subscribe((event) => {
    if (event.type === "message_start") {
      const message = event.message as unknown as Record<string, unknown>;
      console.log(`[Session] message:start role=${message.role} sessionId=${handle.sessionId}`);
      if (message.role === "user") {
        const pending = handle.pendingUserMessages.shift();
        if (pending) {
          handle.currentUserMessageId = pending.userMessageId;
          handle.currentUserMessageContent = pending.content;
          handle.currentUserMessageMeta = pending.meta ?? null;
        }
      }
      if (message.role === "assistant") {
        resetStreamState(handle);
        void emitProviderRenderUpdate(handle);
      }
    }

    if (event.type === "agent_start") {
      console.log(`[Session] agent:start sessionId=${handle.sessionId}`);
    }

    if (event.type === "message_update") {
      handle.streamState.assistantState = applyAssistantMessageEvent(
        handle.streamState.assistantState,
        event.assistantMessageEvent as Parameters<typeof applyAssistantMessageEvent>[1],
      );
      handle.streamState.content = projectAssistantStreamState(handle.streamState.assistantState);
      void emitProviderRenderUpdate(handle);
    }

    if (event.type === "message_end") {
      const message = event.message as unknown as Record<string, unknown>;
      if (message.role === "user" && handle.currentUserMessageId && handle.currentUserMessageContent) {
        const userMessageId = handle.currentUserMessageId;
        const content = handle.currentUserMessageContent;
        const meta = handle.currentUserMessageMeta;
        handle.currentUserMessageContent = null;
        handle.currentUserMessageMeta = null;

        void enqueuePersistence(handle, `user:${userMessageId}`, async () => {
          await persistUserMessage({
            spaceId: handle.spaceId,
            sessionId: handle.sessionId,
            userMessageId,
            content,
            meta,
          });
        });
      }
      void emitProviderRenderUpdate(handle);
    }

    if (event.type === "tool_execution_start") {
      console.log(`[Session] tool:start tool=${event.toolName} toolCallId=${event.toolCallId.slice(0, 8)}`);
      handle.streamState.assistantState = applyToolExecutionStart(handle.streamState.assistantState, {
        toolCallId: event.toolCallId,
        summary: summarizeToolArgs(event.toolName, event.args),
      });
      handle.streamState.content = projectAssistantStreamState(handle.streamState.assistantState);
      void emitProviderRenderUpdate(handle);
    }

    if (event.type === "tool_execution_end") {
      console.log(`[Session] tool:end tool=${event.toolName} toolCallId=${event.toolCallId.slice(0, 8)} error=${event.isError}`);
      const resultContent = event.result ? extractTextFromToolResult(event.result) : "";
      handle.streamState.assistantState = applyToolExecutionEnd(handle.streamState.assistantState, {
        toolCallId: event.toolCallId,
        content: resultContent || JSON.stringify(event.result ?? null),
        isError: event.isError,
      });
      handle.streamState.content = projectAssistantStreamState(handle.streamState.assistantState);
      void emitProviderRenderUpdate(handle);
    }

    if (event.type === "turn_end" && handle.currentUserMessageId) {
      const toolCount = (event as unknown as { toolResults?: unknown[] }).toolResults?.length ?? 0;
      console.log(`[Session] turn:end toolResults=${toolCount} sessionId=${handle.sessionId}`);
      const currentUserMessageId = handle.currentUserMessageId;
      const currentModel = handle.session.agent.state.model;

      // Use streamState.content (built incrementally via upsert during streaming)
      // instead of the SDK's event.message.content, which may contain duplicated
      // tool_result text due to the SDK's content accumulation bug.
      const enrichedMessage = {
        ...(event.message as unknown as Record<string, unknown>),
        content: handle.streamState.content,
        provider: currentModel.provider,
        model: currentModel.id,
      };
      const enrichedEvent = { ...event, message: enrichedMessage };

      void enqueuePersistence(handle, `assistant:${currentUserMessageId}`, async () => {
        await persistAssistantMessage({
          spaceId: handle.spaceId,
          spaceSessionId: handle.sessionId,
          userMessageId: currentUserMessageId,
          event: enrichedEvent as Record<string, unknown>,
          userId: ((handle.currentUserMessageMeta as Record<string, unknown> | null | undefined)?.actorUserId as string | null | undefined) ?? null,
        });
      });

      resetStreamState(handle);
      handle.pendingUserMessages = handle.pendingUserMessages.filter((item) => item.userMessageId !== currentUserMessageId);
    }

    if (event.type === "agent_end") {
      console.log(`[Session] agent:end sessionId=${handle.sessionId}`);
      handle.currentUserMessageId = null;
      handle.onIdle?.(handle);
    }
  });
}

export async function loadOrCreateSessionHandle(input: {
  spaceId: string;
  sessionId: string;
  modelRegistry: CohubModelRegistry;
  tools: ReturnType<typeof createSandboxCodingTools>;
  model?: { provider: string; id: string };
  sessionHandles: Map<string, SessionHandle>;
}) {
  const sessionKey = getSessionKey(input.spaceId, input.sessionId);
  const existing = input.sessionHandles.get(sessionKey);
  if (existing) {
    console.log(`[Session] reuse sessionId=${input.sessionId} spaceId=${input.spaceId}`);
    return existing;
  }

  await ensureAgentSpaceSessionPath(input.spaceId);

  const registration = await registerSpaceSession({
    spaceId: input.spaceId,
    sessionId: input.sessionId,
    title: null,
    externalSessionId: null,
    meta: null,
  }).catch((error: unknown) => {
    console.error(`[Agent] Failed to register session bootstrap for ${input.sessionId}:`, error);
    return null;
  });

  const spaceInfo = await getSpace({ spaceId: input.spaceId }).catch((error: unknown) => {
    console.warn(`[Agent] Failed to load space info for ${input.spaceId}; falling back to platform config`, error);
    return null;
  });
  const spaceOwnerUserId = spaceInfo?.space?.userUuid?.trim() || null;

  const existingSessionFile = getAgentSessionFilePath(input.spaceId, input.sessionId);
  const spaceWorkspaceDir = getAgentWorkspacePath(input.spaceId);
  const spaceSessionsDir = getAgentSpaceSessionsPath(input.spaceId);

  let sessionManager: SessionManager;
  if (existsSync(existingSessionFile)) {
    console.log(`[Session] restore sessionId=${input.sessionId} spaceId=${input.spaceId}`);
    sessionManager = SessionManager.open(existingSessionFile, spaceSessionsDir);
  } else {
    const forkSourceProtocolMessageId = registration?.bootstrap?.forkSourceProtocolMessageId ?? null;
    const parentSessionId = ((registration?.session as { parentSessionId?: string | null } | undefined)?.parentSessionId) ?? null;
    const parentSessionFile = parentSessionId ? getAgentSessionFilePath(input.spaceId, parentSessionId) : null;

    if (parentSessionFile && existsSync(parentSessionFile) && forkSourceProtocolMessageId) {
      const parentManager = SessionManager.open(parentSessionFile, spaceSessionsDir);
      const forkedSessionFile = parentManager.createBranchedSession(forkSourceProtocolMessageId);
      if (!forkedSessionFile) throw new Error(`Failed to create branched session file for ${input.sessionId}`);
      const forkedManager = SessionManager.open(forkedSessionFile, spaceSessionsDir);
      const forkedEntries = forkedManager.getEntries();
      forkedManager.newSession({ id: input.sessionId, parentSession: parentSessionFile });
      for (const entry of forkedEntries) {
        if (entry.type === "message") forkedManager.appendMessage(entry.message as never);
        else if (entry.type === "model_change") forkedManager.appendModelChange(entry.provider, entry.modelId);
        else if (entry.type === "thinking_level_change") forkedManager.appendThinkingLevelChange(entry.thinkingLevel);
        else if (entry.type === "compaction") forkedManager.appendCompaction(entry.summary, entry.firstKeptEntryId, entry.tokensBefore, entry.details, entry.fromHook);
        else if (entry.type === "custom") forkedManager.appendCustomEntry(entry.customType, entry.data);
        else if (entry.type === "custom_message") forkedManager.appendCustomMessageEntry(entry.customType, entry.content, entry.display, entry.details);
        else if (entry.type === "session_info") forkedManager.appendSessionInfo(entry.name ?? "");
      }
      renameSync(forkedSessionFile, existingSessionFile);
      sessionManager = SessionManager.open(existingSessionFile, spaceSessionsDir);
    } else {
      const tmpManager = SessionManager.create(spaceWorkspaceDir, spaceSessionsDir);
      tmpManager.newSession({ id: input.sessionId });
      setSessionManagerFilePath(tmpManager, existingSessionFile);
      sessionManager = tmpManager;
    }
  }

  const resolvedModel = input.model
    ? input.modelRegistry.find(input.model.provider, input.model.id)
    : undefined;

  const { session } = await createCohubAgentSession({
    cwd: spaceWorkspaceDir,
    userId: spaceOwnerUserId,
    sessionManager,
    modelRegistry: input.modelRegistry,
    tools: input.tools,
    ...(resolvedModel ? { model: resolvedModel } : {}),
  });

  await session.reload();

  const handle: SessionHandle = {
    spaceId: input.spaceId,
    spaceOwnerUserId,
    sessionKey,
    sessionId: input.sessionId,
    session,
    sessionManager,
    ownerEpoch: 0,
    lastActiveAt: Date.now(),
    idleTimer: null,
    onIdle: null,
    pendingUserMessages: [],
    currentUserMessageId: null,
    currentUserMessageContent: null,
    currentUserMessageMeta: null,
    persistenceChain: Promise.resolve(),
    streamState: {
      assistantState: createAssistantStreamState(),
      content: [],
      preferredDisplayMode: "compact",
      lastSent: [],
      pendingFlush: false,
      flushPromise: null,
    },
  };

  subscribeSessionEvents(handle);
  input.sessionHandles.set(sessionKey, handle);
  console.log(`[Session] ready sessionId=${input.sessionId} spaceId=${input.spaceId}`);
  return handle;
}
