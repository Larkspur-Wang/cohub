import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  createCodingTools,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import { persistAssistantMessage, registerRuntimeSession } from "./api.js";
import { env } from "./env.js";
import { initializeContainer } from "./init.js";
import {
  closeRedisConnections,
  extractContentImages,
  extractContentText,
  listenForInput,
  sendOutput,
  setRuntimeStatus,
} from "./redis.js";
import type { ContentBlock, SessionStreamEvent, SessionStreamError } from "@cohub/protocol";

type PendingUserMessage = {
  messageKey: string;
  userMessageId: string;
};

type SessionHandle = {
  sessionId: string;
  session: AgentSession;
  sessionManager: SessionManager;
  pendingUserMessages: PendingUserMessage[];
  currentUserMessageId: string | null;
  streamState: {
    content: ContentBlock[];
    preferredDisplayMode: "full" | "compact" | "minimal";
  };
};

/**
 * Build a base64 key from ContentBlock[] for matching SDK echo messages.
 */
function buildContentKey(content: ContentBlock[]): string {
  const text = extractContentText(content);
  const imageCount = content.filter((b) => b.type === "image").length;
  return Buffer.from(JSON.stringify({ text, imageCount })).toString("base64");
}

/**
 * Build a base64 key from SDK message_start event content for matching.
 */
function buildMessageKeyFromEvent(message: Record<string, unknown>): string {
  const text = extractUserMessageText(message);
  const imageCount = extractUserImageCount(message);
  return Buffer.from(JSON.stringify({ text, imageCount })).toString("base64");
}

/**
 * Extract user message text from a message_start event for matching.
 */
function extractUserMessageText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item): item is { type: string; text?: string } =>
      !!item && typeof item === "object" && "type" in item
    )
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

/**
 * Extract image count from a message_start event for matching.
 */
function extractUserImageCount(message: Record<string, unknown>): number {
  const content = message.content;
  if (!Array.isArray(content)) return 0;
  return content.filter(
    (item) => !!item && typeof item === "object" && "type" in item && item.type === "image"
  ).length;
}

let isShuttingDown = false;
const sessionHandles = new Map<string, SessionHandle>();

async function shutdown(status: "hibernated" | "error", exitCode: number) {
  if (isShuttingDown) {
    process.exit(exitCode);
  }

  isShuttingDown = true;

  try {
    for (const handle of sessionHandles.values()) {
      try {
        handle.session.dispose();
      } catch (error) {
        console.error(
          `[Supervisor] Failed to dispose session ${handle.sessionId}:`,
          error,
        );
      }
    }
    sessionHandles.clear();
  } catch (error) {
    console.error("[Supervisor] Failed to dispose session handles on shutdown:", error);
  }

  try {
    await setRuntimeStatus(status);
  } catch (error) {
    console.error("[Supervisor] Failed to update runtime status on shutdown:", error);
  }

  try {
    await closeRedisConnections();
  } catch (error) {
    console.error("[Supervisor] Failed to close Redis connections:", error);
  }

  process.exit(exitCode);
}

async function findSessionFileById(sessionId: string) {
  const sessions = await SessionManager.list(env.WORKSPACE_DIR, env.SESSIONS_DIR).catch((error) => {
    console.error(`[Supervisor] Failed to list sessions for lookup ${sessionId}:`, error);
    return [];
  });

  const byId = sessions.find((session) => session.id === sessionId);
  if (byId) return byId.path;

  const bySuffix = sessions.find((session) => session.path.endsWith(`_${sessionId}.jsonl`));
  return bySuffix?.path;
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

function summarizeThinking(thinking: string): string {
  const trimmed = thinking.trim();
  if (!trimmed) return "";
  return trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 2).join("\n").slice(0, 320);
}

// ─── SDK content → ContentBlock conversion ───

function sdkContentToBlocks(content: unknown): ContentBlock[] {
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
      blocks.push({
        type: "tool_use",
        id: block.id as string,
        name: block.name as string,
        input: (block.arguments as Record<string, unknown> | null) ?? {},
      });
    } else if (type === "image" && typeof block.uri === "string") {
      blocks.push({
        type: "image",
        source: { type: "url", url: block.uri },
      });
    } else if (type === "tool_result" && typeof block.tool_use_id === "string") {
      blocks.push({
        type: "tool_result",
        tool_use_id: block.tool_use_id as string,
        content: typeof block.content === "string" ? block.content : (block.content as string | ContentBlock[] | null) ?? "",
        is_error: Boolean(block.is_error),
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

  const event: SessionStreamEvent = {
    type: "stream_update",
    runtimeId: env.RUNTIME_ID,
    sessionId: handle.sessionId,
    content: handle.streamState.content,
    sourceMessageId,
    timestamp: Date.now(),
  };

  await sendOutput(event);
}

function resetStreamState(handle: SessionHandle) {
  handle.streamState = {
    content: [],
    preferredDisplayMode: handle.streamState.preferredDisplayMode,
  };
}

function subscribeSessionEvents(handle: SessionHandle) {
  handle.session.subscribe((event) => {
    if (event.type === "message_start") {
      const message = event.message as unknown as Record<string, unknown>;

      // Match user message from pending queue
      if (message.role === "user") {
        const eventKey = buildMessageKeyFromEvent(message);
        const matchIndex = handle.pendingUserMessages.findIndex(
          (item) => item.messageKey === eventKey
        );
        if (matchIndex !== -1) {
          const matched = handle.pendingUserMessages[matchIndex];
          if (matched) {
            handle.currentUserMessageId = matched.userMessageId;
            console.log(
              `[Supervisor] Matched user message ${handle.currentUserMessageId} for session ${handle.sessionId}`
            );
          }
        } else {
          console.warn(
            `[Supervisor] No matching user message found for key ${eventKey} in session ${handle.sessionId}`
          );
        }
      }

      if (message.role === "assistant") {
        resetStreamState(handle);
        void emitProviderRenderUpdate(handle);
      }
    }

    if (event.type === "message_update") {
      const message = event.message as unknown as Record<string, unknown>;
      // Convert SDK content blocks to our ContentBlock[]
      const newBlocks = sdkContentToBlocks(message.content);
      handle.streamState.content = newBlocks;
      void emitProviderRenderUpdate(handle);
    }

    if (event.type === "tool_execution_start") {
      // Add running status to the tool_use block
      const existingIdx = handle.streamState.content.findIndex(
        (b) => b.type === "tool_use" && b.id === event.toolCallId
      );
      if (existingIdx !== -1) {
        const block = handle.streamState.content[existingIdx] as Extract<ContentBlock, { type: "tool_use" }>;
        if (block.type === "tool_use") {
          const updated: ContentBlock = {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input,
            _meta: { ...block._meta, toolStatus: "running", summary: summarizeToolArgs(event.toolName, event.args) },
          };
          handle.streamState.content = [
            ...handle.streamState.content.slice(0, existingIdx),
            updated,
            ...handle.streamState.content.slice(existingIdx + 1),
          ];
        }
      } else {
        // Tool use block not yet in content — create one
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
      const status = event.isError ? "failed" : "done";
      const existingIdx = handle.streamState.content.findIndex(
        (b) => b.type === "tool_use" && b.id === event.toolCallId
      );

      // Update tool_use status
      if (existingIdx !== -1) {
        const block = handle.streamState.content[existingIdx] as Extract<ContentBlock, { type: "tool_use" }>;
        if (block.type === "tool_use") {
          const updated: ContentBlock = {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input,
            _meta: { ...block._meta, toolStatus: status },
          };
          handle.streamState.content = [
            ...handle.streamState.content.slice(0, existingIdx),
            updated,
            ...handle.streamState.content.slice(existingIdx + 1),
          ];
        }
      }

      // Add tool_result block
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
      // Persist to DB (uses local event object, not Redis)
      void persistAssistantMessage({
        runtimeId: env.RUNTIME_ID,
        runtimeSessionId: handle.sessionId,
        userMessageId: handle.currentUserMessageId,
        event: event as Record<string, unknown>,
      }).catch((error) => {
        console.error(
          `[Supervisor] Failed to persist assistant message for ${handle.sessionId}:`,
          error,
        );
      });

      // Emit final render update with turnEnd flag
      const finalEvent: SessionStreamEvent = {
        type: "stream_update",
        runtimeId: env.RUNTIME_ID,
        sessionId: handle.sessionId,
        content: handle.streamState.content,
        sourceMessageId: handle.currentUserMessageId,
        timestamp: Date.now(),
        turnEnd: true,
        anchorUserMessageId: handle.currentUserMessageId,
      };
      void sendOutput(finalEvent);

      // Reset stream state after emitting final event to prevent
      // content from leaking into the next turn.
      resetStreamState(handle);

      // Remove matched user message from queue
      const matchedId = handle.currentUserMessageId;
      handle.pendingUserMessages = handle.pendingUserMessages.filter(
        (item) => item.userMessageId !== matchedId,
      );
      // NOTE: Don't clear currentUserMessageId here - keep it for subsequent turns
      // It will be cleared on agent_end
    }

    if (event.type === "agent_end") {
      handle.currentUserMessageId = null;
    }

    if (event.type === "message_end") {
      void emitProviderRenderUpdate(handle);
    }
  });
}

function extractTextFromToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  const record = result as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  return "";
}

async function loadOrCreateSessionHandle(input: {
  sessionId: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  tools: ReturnType<typeof createCodingTools>;
}) {
  const existing = sessionHandles.get(input.sessionId);
  if (existing) return existing;

  const registration = await registerRuntimeSession({
    runtimeId: env.RUNTIME_ID,
    sessionId: input.sessionId,
    title: null,
    protocol: "pi",
    externalSessionId: null,
    cwd: null,
    meta: null,
  }).catch((error) => {
    console.error(`[Supervisor] Failed to register session bootstrap for ${input.sessionId}:`, error);
    return null;
  });

  const existingSessionFile = await findSessionFileById(input.sessionId);

  let sessionManager: SessionManager;
  if (existingSessionFile) {
    console.log(
      `[Supervisor] Restoring pi session ${input.sessionId} from ${existingSessionFile}`,
    );
    sessionManager = SessionManager.open(existingSessionFile, env.SESSIONS_DIR);

    if (sessionManager.getSessionId() !== input.sessionId) {
      console.warn(
        `[Supervisor] Restored session id mismatch. expected=${input.sessionId}, actual=${sessionManager.getSessionId()}`,
      );
    }
  } else {
    const forkSourceProtocolMessageId = registration?.bootstrap?.forkSourceProtocolMessageId ?? null;
    const parentSessionId = ((registration?.session as { parentSessionId?: string | null } | undefined)?.parentSessionId) ?? null;
    const parentSessionFile = parentSessionId ? await findSessionFileById(parentSessionId) : null;

    if (parentSessionFile && forkSourceProtocolMessageId) {
      console.log(
        `[Supervisor] Forking pi session ${input.sessionId} from parent=${parentSessionId} entry=${forkSourceProtocolMessageId}`,
      );
      const parentManager = SessionManager.open(parentSessionFile, env.SESSIONS_DIR);
      const forkedSessionFile = parentManager.createBranchedSession(forkSourceProtocolMessageId);
      if (!forkedSessionFile) {
        throw new Error(`Failed to create branched session file for ${input.sessionId}`);
      }
      const forkedManager = SessionManager.open(forkedSessionFile, env.SESSIONS_DIR);
      const forkedEntries = forkedManager.getEntries();
      forkedManager.newSession({ id: input.sessionId, parentSession: parentSessionFile });
      for (const entry of forkedEntries) {
        if (entry.type === "message") {
          forkedManager.appendMessage(entry.message as never);
        } else if (entry.type === "model_change") {
          forkedManager.appendModelChange(entry.provider, entry.modelId);
        } else if (entry.type === "thinking_level_change") {
          forkedManager.appendThinkingLevelChange(entry.thinkingLevel);
        } else if (entry.type === "compaction") {
          forkedManager.appendCompaction(entry.summary, entry.firstKeptEntryId, entry.tokensBefore, entry.details, entry.fromHook);
        } else if (entry.type === "custom") {
          forkedManager.appendCustomEntry(entry.customType, entry.data);
        } else if (entry.type === "custom_message") {
          forkedManager.appendCustomMessageEntry(entry.customType, entry.content, entry.display, entry.details);
        } else if (entry.type === "session_info") {
          forkedManager.appendSessionInfo(entry.name ?? "");
        }
      }
      const rewrittenSessionFile = forkedManager.getSessionFile();
      if (!rewrittenSessionFile) {
        throw new Error(`Failed to rewrite forked session file for ${input.sessionId}`);
      }
      sessionManager = SessionManager.open(rewrittenSessionFile, env.SESSIONS_DIR);
    } else {
      console.log(`[Supervisor] Creating new pi session ${input.sessionId}`);
      sessionManager = SessionManager.create(env.WORKSPACE_DIR, env.SESSIONS_DIR);
      sessionManager.newSession({ id: input.sessionId });
    }
  }

  const { session } = await createAgentSession({
    cwd: env.WORKSPACE_DIR,
    authStorage: input.authStorage,
    modelRegistry: input.modelRegistry,
    tools: input.tools,
    sessionManager,
  });

  const handle: SessionHandle = {
    sessionId: input.sessionId,
    session,
    sessionManager,
    pendingUserMessages: [],
    currentUserMessageId: null,
    streamState: {
      content: [],
      preferredDisplayMode: "compact",
    },
  };

  subscribeSessionEvents(handle);
  sessionHandles.set(input.sessionId, handle);

  console.log("[Supervisor] Agent Session ready:", {
    sessionId: handle.sessionId,
    sessionFile: handle.sessionManager.getSessionFile(),
    restored: Boolean(existingSessionFile),
  });

  return handle;
}

async function main() {
  console.log(`[Supervisor] Starting for Runtime: ${env.RUNTIME_ID}`);
  console.log(`[Supervisor] Workspace: ${env.WORKSPACE_DIR}`);
  console.log(`[Supervisor] Runtime version: ${env.RUNTIME_VERSION || "unknown"}`);
  console.log(`[Supervisor] Public URL prefix: ${env.PUBLIC_URL_PREFIX || "not set"}`);
  console.log("[Supervisor] Build features:", {
    env: env.ENV,
    runtimeId: env.RUNTIME_ID,
    runtimeVersion: env.RUNTIME_VERSION || null,
    publicUrlPrefix: env.PUBLIC_URL_PREFIX || null,
    internalApiBaseUrl:
      env.ENV === "prod"
        ? "http://cohub-api.cohub.svc.cluster.local:8787"
        : "http://cohub-api-dev.cohub-dev.svc.cluster.local:8787",
    runtimeOwnedSessions: false,
    multiSessionRestore: true,
  });

  await initializeContainer();

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const tools = createCodingTools(env.WORKSPACE_DIR);

  await setRuntimeStatus("running");
  console.log("[Supervisor] Runtime is now running and listening for input.");

  await listenForInput((inputEntry, ack, reject) => {
    console.log("[Supervisor] Received input from Redis:", inputEntry);

    // Fire and forget async handler
    (async () => {
      try {
        if (inputEntry.action === "prompt") {
          const sessionId = inputEntry.sessionId;
          if (!sessionId) {
            throw new Error("sessionId is required for prompt inputs");
          }

          const handle = await loadOrCreateSessionHandle({
            sessionId,
            authStorage,
            modelRegistry,
            tools,
          });

          // Input now carries ContentBlock[] — extract text + images for SDK
          const content = inputEntry.content as ContentBlock[];
          const messageKey = buildContentKey(content);
          const userMessageId = inputEntry.userMessageId;
          if (userMessageId) {
            handle.pendingUserMessages.push({ messageKey, userMessageId });
          }

          const text = extractContentText(content);
          const images = extractContentImages(content);

          // Decide whether to use prompt or steer based on streaming state
          if (handle.session.isStreaming) {
            console.log(
              `[Supervisor] Session ${sessionId} is streaming, using steer for new message`
            );
            await handle.session.steer(text, images);
          } else {
            console.log(
              `[Supervisor] Session ${sessionId} is idle, using prompt for new message`
            );
            await handle.session.prompt(text, {
              images,
            });
          }

          await ack();
        } else if (inputEntry.action === "abort") {
          if (inputEntry.sessionId) {
            const handle = sessionHandles.get(inputEntry.sessionId);
            if (!handle) {
              console.warn(
                `[Supervisor] Abort requested for unknown session ${inputEntry.sessionId}`,
              );
            } else {
              await handle.session.abort();
            }
          } else {
            await Promise.all(
              Array.from(sessionHandles.values()).map((handle) => handle.session.abort()),
            );
          }
          await ack();
        } else {
          await reject(`Unknown action: ${(inputEntry as { action?: string }).action}`);
        }
      } catch (error) {
        console.error("[Supervisor] Error processing input:", error);
        const errEvent: SessionStreamError = {
          type: "error",
          runtimeId: env.RUNTIME_ID,
          sessionId: inputEntry.sessionId ?? null,
          error: String(error),
        };
        await sendOutput(errEvent);
        await reject(error instanceof Error ? error.message : String(error));
      }
    })();
  });
}

process.on("SIGTERM", () => {
  console.log("[Supervisor] SIGTERM received. Shutting down.");
  void shutdown("hibernated", 0);
});

process.on("SIGINT", () => {
  console.log("[Supervisor] SIGINT received. Shutting down.");
  void shutdown("hibernated", 0);
});

main().catch(async (err) => {
  console.error("[Supervisor] Fatal error:", err);
  await shutdown("error", 1);
});
