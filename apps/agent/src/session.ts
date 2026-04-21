import { existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  type AuthStorage,
  type DefaultResourceLoader,
  type ModelRegistry,
  SessionManager,
  createAgentSession,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import type { ContentBlock, SessionStreamEvent } from "@cohub/protocol";
import { persistAssistantMessage, persistUserMessage, registerSpaceSession } from "./api.js";
import { env } from "./env.js";
import { sendOutput } from "./redis.js";
import type { createSandboxCodingTools } from "./sandbox/tools.js";

export type PendingUserMessage = {
  userMessageId: string;
  content: ContentBlock[];
  meta?: Record<string, unknown> | null;
};

export type SessionHandle = {
  spaceId: string;
  sessionKey: string;
  sessionId: string;
  session: AgentSession;
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

export function getSpaceWorkspaceDir(spaceId: string) {
  return join(env.WORKSPACE_ROOT, spaceId, "workspace");
}

export function getSpaceSessionsDir(spaceId: string) {
  return join(env.SESSIONS_DIR, "spaces", spaceId);
}

export function getSessionFilePath(spaceId: string, sessionId: string) {
  return join(getSpaceSessionsDir(spaceId), `${sessionId}.jsonl`);
}

export async function ensureSpaceDirs(spaceId: string) {
  await mkdir(getSpaceSessionsDir(spaceId), { recursive: true }).catch(() => undefined);
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

function sdkContentToBlocks(content: unknown, existing: ContentBlock[]): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  const blocks: ContentBlock[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const block = item as Record<string, unknown>;
    const type = block.type as string | undefined;

    if (type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text });
    } else if (type === "thinking" && typeof block.thinking === "string") {
      blocks.push({ type: "thinking", thinking: block.thinking });
    } else if (type === "toolCall" && typeof block.id === "string" && typeof block.name === "string") {
      const existingBlock = existing.find(
        (b) => b.type === "tool_use" && b.id === block.id,
      ) as Extract<ContentBlock, { type: "tool_use" }> | undefined;
      blocks.push({
        type: "tool_use",
        id: block.id as string,
        name: block.name as string,
        input: (block.arguments as Record<string, unknown> | null) ?? {},
        _meta: existingBlock?._meta,
      });
    } else if (type === "image" && typeof block.uri === "string") {
      blocks.push({ type: "image", source: { type: "url", url: block.uri } });
    } else if (type === "tool_result" && typeof block.tool_use_id === "string") {
      const existingBlock = existing.find(
        (b) => b.type === "tool_result" && b.tool_use_id === block.tool_use_id,
      ) as Extract<ContentBlock, { type: "tool_result" }> | undefined;
      blocks.push({
        type: "tool_result",
        tool_use_id: block.tool_use_id as string,
        content: typeof block.content === "string" ? block.content : (block.content as string | ContentBlock[] | null) ?? "",
        is_error: Boolean(block.is_error),
        _meta: existingBlock?._meta,
      });
    }
  }
  return blocks;
}

function upsertBlock(content: ContentBlock[], block: ContentBlock): ContentBlock[] {
  const idx = content.findIndex((b) => {
    if (b.type === "tool_use" && block.type === "tool_use") return b.id === block.id;
    if (b.type === "tool_result" && block.type === "tool_result") return b.tool_use_id === block.tool_use_id;
    return false;
  });
  if (idx !== -1) {
    const updated = [...content];
    updated[idx] = block;
    return updated;
  }
  return [...content, block];
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
    content: [],
    preferredDisplayMode: handle.streamState.preferredDisplayMode,
    lastSent: [],
    pendingFlush: false,
    flushPromise: null,
  };
}

function groupByType(blocks: ContentBlock[]) {
  const result: Record<string, ContentBlock[]> = {
    text: [],
    thinking: [],
    tool_use: [],
    tool_result: [],
  };
  for (const b of blocks) {
    const arr = result[b.type];
    if (arr) {
      arr.push(b);
    }
  }
  return result;
}

/** Compute the minimal delta between the current full content and the last-sent snapshot. */
function computeDelta(full: ContentBlock[], last: ContentBlock[]): ContentBlock[] {
  const delta: ContentBlock[] = [];
  const lastByType = groupByType(last);
  const textBlocks = lastByType.text as Extract<ContentBlock, { type: "text" }>[];
  const thinkingBlocks = lastByType.thinking as Extract<ContentBlock, { type: "thinking" }>[];
  const toolUseBlocks = lastByType.tool_use as Extract<ContentBlock, { type: "tool_use" }>[];
  const toolResultBlocks = lastByType.tool_result as Extract<ContentBlock, { type: "tool_result" }>[];

  // Track ordinal position per type (only for append-only types)
  const ordinal = { text: 0, thinking: 0 };

  for (const block of full) {
    if (block.type === "text") {
      const idx = ordinal.text++;
      const prev = textBlocks[idx];
      if (!prev) {
        delta.push(block);
      } else if (block.text.length > prev.text.length) {
        const suffix = block.text.slice(prev.text.length);
        if (suffix) delta.push({ type: "text", text: suffix, _meta: block._meta });
      }
    } else if (block.type === "thinking") {
      const idx = ordinal.thinking++;
      const prev = thinkingBlocks[idx];
      if (!prev) {
        delta.push(block);
      } else if (block.thinking.length > prev.thinking.length) {
        const suffix = block.thinking.slice(prev.thinking.length);
        if (suffix) delta.push({ type: "thinking", thinking: suffix, signature: block.signature, _meta: block._meta });
      }
    } else if (block.type === "tool_use") {
      const prev = toolUseBlocks.find((b) => b.id === block.id);
      if (!prev || prev._meta?.toolStatus !== block._meta?.toolStatus) {
        delta.push(block);
      }
    } else if (block.type === "tool_result") {
      const prev = toolResultBlocks.find((b) => b.tool_use_id === block.tool_use_id);
      if (!prev || prev.content !== block.content) {
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
      const message = event.message as unknown as Record<string, unknown>;
      handle.streamState.content = sdkContentToBlocks(message.content, handle.streamState.content);
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
      const existingIdx = handle.streamState.content.findIndex(
        (b) => b.type === "tool_use" && b.id === event.toolCallId,
      );
      if (existingIdx !== -1) {
        const block = handle.streamState.content[existingIdx] as Extract<ContentBlock, { type: "tool_use" }>;
        handle.streamState.content = [
          ...handle.streamState.content.slice(0, existingIdx),
          {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input,
            _meta: { ...block._meta, toolStatus: "running", summary: summarizeToolArgs(event.toolName, event.args) },
          },
          ...handle.streamState.content.slice(existingIdx + 1),
        ];
      } else {
        handle.streamState.content = [
          ...handle.streamState.content,
          {
            type: "tool_use",
            id: event.toolCallId,
            name: event.toolName,
            input: (event.args as Record<string, unknown>) ?? {},
            _meta: { toolStatus: "running", summary: summarizeToolArgs(event.toolName, event.args) },
          },
        ];
      }
      void emitProviderRenderUpdate(handle);
    }

    if (event.type === "tool_execution_end") {
      console.log(`[Session] tool:end tool=${event.toolName} toolCallId=${event.toolCallId.slice(0, 8)} error=${event.isError}`);
      const status = event.isError ? "failed" : "done";
      const existingIdx = handle.streamState.content.findIndex(
        (b) => b.type === "tool_use" && b.id === event.toolCallId,
      );
      if (existingIdx !== -1) {
        const block = handle.streamState.content[existingIdx] as Extract<ContentBlock, { type: "tool_use" }>;
        handle.streamState.content = [
          ...handle.streamState.content.slice(0, existingIdx),
          {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input,
            _meta: { ...block._meta, toolStatus: status },
          },
          ...handle.streamState.content.slice(existingIdx + 1),
        ];
      }

      const resultContent = event.result ? extractTextFromToolResult(event.result) : "";
      handle.streamState.content = upsertBlock(handle.streamState.content, {
        type: "tool_result",
        tool_use_id: event.toolCallId,
        content: resultContent || JSON.stringify(event.result ?? null),
        is_error: event.isError,
        _meta: { toolStatus: status },
      });
      void emitProviderRenderUpdate(handle);
    }

    if (event.type === "turn_end" && handle.currentUserMessageId) {
      const toolCount = (event as unknown as { toolResults?: unknown[] }).toolResults?.length ?? 0;
      console.log(`[Session] turn:end toolResults=${toolCount} sessionId=${handle.sessionId}`);
      const currentUserMessageId = handle.currentUserMessageId;
      const currentModel = handle.session.agent.state.model;
      const enrichedMessage = {
        ...(event.message as unknown as Record<string, unknown>),
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
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  resourceLoader: DefaultResourceLoader;
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

  await ensureSpaceDirs(input.spaceId);

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

  const existingSessionFile = getSessionFilePath(input.spaceId, input.sessionId);
  const spaceWorkspaceDir = getSpaceWorkspaceDir(input.spaceId);
  const spaceSessionsDir = getSpaceSessionsDir(input.spaceId);

  let sessionManager: SessionManager;
  if (existsSync(existingSessionFile)) {
    console.log(`[Session] restore sessionId=${input.sessionId} spaceId=${input.spaceId}`);
    sessionManager = SessionManager.open(existingSessionFile, spaceSessionsDir);
  } else {
    const forkSourceProtocolMessageId = registration?.bootstrap?.forkSourceProtocolMessageId ?? null;
    const parentSessionId = ((registration?.session as { parentSessionId?: string | null } | undefined)?.parentSessionId) ?? null;
    const parentSessionFile = parentSessionId ? getSessionFilePath(input.spaceId, parentSessionId) : null;

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
      const actualSessionFile = tmpManager.getSessionFile();
      if (actualSessionFile && actualSessionFile !== existingSessionFile) {
        renameSync(actualSessionFile, existingSessionFile);
        tmpManager.setSessionFile(existingSessionFile);
      }
      sessionManager = tmpManager;
    }
  }

  const resolvedModel = input.model
    ? input.modelRegistry.find(input.model.provider, input.model.id)
    : undefined;

  const { session } = await createAgentSession({
    cwd: spaceWorkspaceDir,
    authStorage: input.authStorage,
    modelRegistry: input.modelRegistry,
    resourceLoader: input.resourceLoader,
    tools: input.tools.map((tool) => tool.name),
    sessionManager,
    ...(resolvedModel ? { model: resolvedModel } : {}),
  });

  const sandboxBaseTools = Object.fromEntries(
    input.tools.map((tool) => [tool.name, tool] as const),
  ) as Record<string, unknown>;

  const sessionWithOverrides = session as unknown as {
    _baseToolsOverride?: Record<string, unknown>;
    reload: () => Promise<void>;
  };

  sessionWithOverrides._baseToolsOverride = sandboxBaseTools;
  await sessionWithOverrides.reload();

  const handle: SessionHandle = {
    spaceId: input.spaceId,
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
