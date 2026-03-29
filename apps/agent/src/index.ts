import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  createCodingTools,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import { persistAssistantMessage, registerRuntimeSession, updateProviderRender } from "./api.js";
import { env } from "./env.js";
import { initializeContainer } from "./init.js";
import {
  closeRedisConnections,
  listenForInput,
  sendOutput,
  setRuntimeStatus,
} from "./redis.js";

type SessionHandle = {
  sessionId: string;
  session: AgentSession;
  sessionManager: SessionManager;
  currentUserMessageId: string | null;
  streamState: {
    thinking: string;
    assistantText: string;
    toolCalls: Array<{ toolCallId: string; toolName: string; status: string; summary?: string }>;
    lastRenderAt: number;
    preferredDisplayMode: "full" | "compact" | "minimal";
  };
};

let isShuttingDown = false;
const sessionHandles = new Map<string, SessionHandle>();

async function shutdown(status: "stopped" | "error", exitCode: number) {
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

function extractAssistantText(message: Record<string, unknown>): string {
  const content = Array.isArray(message.content) ? message.content : [];
  return content
    .filter((item): item is { type: string; text?: string } => !!item && typeof item === "object" && "type" in item)
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

function extractThinkingText(message: Record<string, unknown>): string {
  const content = Array.isArray(message.content) ? message.content : [];
  return content
    .filter((item): item is { type: string; thinking?: string } => !!item && typeof item === "object" && "type" in item)
    .filter((item) => item.type === "thinking" && typeof item.thinking === "string")
    .map((item) => item.thinking ?? "")
    .join("\n")
    .trim();
}

function summarizeThinking(thinking: string): string {
  const trimmed = thinking.trim();
  if (!trimmed) return "";
  return trimmed.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 2).join("\n").slice(0, 320);
}

async function emitProviderRenderUpdate(handle: SessionHandle) {
  const now = Date.now();
  if (now - handle.streamState.lastRenderAt < 900) return;
  handle.streamState.lastRenderAt = now;

  const sourceMessageId = handle.currentUserMessageId?.trim() || null;
  if (!sourceMessageId) return;

  const thinking = handle.streamState.thinking.trim();

  await sendOutput({
    type: "provider_render_update",
    runtimeId: env.RUNTIME_ID,
    sessionId: handle.sessionId,
    renderMode: "rich_status",
    thinking,
    toolCalls: handle.streamState.toolCalls,
    answer: handle.streamState.assistantText,
    sourceMessageId,
  });

  await updateProviderRender({
    runtimeId: env.RUNTIME_ID,
    runtimeSessionId: handle.sessionId,
    renderMode: "rich_status",
    thinking,
    toolCalls: handle.streamState.toolCalls,
    answer: handle.streamState.assistantText,
    sourceMessageId,
  }).catch((error) => {
    console.error(`[Supervisor] Failed to update provider render for ${handle.sessionId}:`, error);
  });
}

function resetStreamState(handle: SessionHandle) {
  handle.streamState = {
    thinking: "",
    assistantText: "",
    toolCalls: [],
    lastRenderAt: 0,
    preferredDisplayMode: handle.streamState.preferredDisplayMode,
  };
}

function subscribeSessionEvents(handle: SessionHandle) {
  handle.session.subscribe((event) => {
    void sendOutput({
      type: "agent_event",
      runtimeId: env.RUNTIME_ID,
      sessionId: handle.sessionId,
      event,
    });

    if (event.type === "message_start") {
      const message = event.message as unknown as Record<string, unknown>;
      if (message.role === "assistant") {
        resetStreamState(handle);
        void emitProviderRenderUpdate(handle);
      }
    }

    if (event.type === "message_update") {
      const message = event.message as unknown as Record<string, unknown>;
      handle.streamState.assistantText = extractAssistantText(message);
      handle.streamState.thinking = extractThinkingText(message);
      void emitProviderRenderUpdate(handle);
    }

    if (event.type === "tool_execution_start") {
      handle.streamState.toolCalls = [
        ...handle.streamState.toolCalls.filter((item) => item.toolCallId !== event.toolCallId),
        {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: "running",
          summary: summarizeToolArgs(event.toolName, event.args),
        },
      ];
      void emitProviderRenderUpdate(handle);
    }

    if (event.type === "tool_execution_end") {
      const existing = handle.streamState.toolCalls.find((item) => item.toolCallId === event.toolCallId);
      handle.streamState.toolCalls = [
        ...handle.streamState.toolCalls.filter((item) => item.toolCallId !== event.toolCallId),
        {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: event.isError ? "failed" : "done",
          summary: existing?.summary ?? "",
        },
      ];
      void emitProviderRenderUpdate(handle);
    }

    if (event.type === "turn_end" && handle.currentUserMessageId) {
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
    }

    if (event.type === "turn_end" || event.type === "message_end") {
      void emitProviderRenderUpdate(handle);
    }
  });
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
    currentUserMessageId: null,
    streamState: {
      thinking: "",
      assistantText: "",
      toolCalls: [],
      lastRenderAt: 0,
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
  console.log("[Supervisor] Build features:", {
    env: env.ENV,
    runtimeId: env.RUNTIME_ID,
    internalApiBaseUrl:
      env.ENV === "prod"
        ? "http://cohub-api.cohub.svc.cluster.local:8787"
        : "http://cohub-api-dev.cohub-dev.svc.cluster.local:8787",
    runtimeOwnedSessions: false,
    multiSessionRestore: true,
  });

  await initializeContainer();

  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);
  const tools = createCodingTools(env.WORKSPACE_DIR);

  await setRuntimeStatus("running");
  console.log("[Supervisor] Runtime is now running and listening for input.");

  await listenForInput(async (inputEntry) => {
    console.log("[Supervisor] Received input from Redis:", inputEntry);

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

        resetStreamState(handle);
        handle.currentUserMessageId = inputEntry.userMessageId ?? null;

        try {
          await handle.session.prompt(inputEntry.message.text, {
            images: inputEntry.message.images,
          });
        } finally {
          handle.currentUserMessageId = null;
        }
      } else if (inputEntry.action === "abort") {
        if (inputEntry.sessionId) {
          const handle = sessionHandles.get(inputEntry.sessionId);
          if (!handle) {
            console.warn(
              `[Supervisor] Abort requested for unknown session ${inputEntry.sessionId}`,
            );
            return;
          }
          await handle.session.abort();
        } else {
          await Promise.all(
            Array.from(sessionHandles.values()).map((handle) => handle.session.abort()),
          );
        }
      }
    } catch (error) {
      console.error("[Supervisor] Error processing input:", error);
      await sendOutput({
        type: "error",
        runtimeId: env.RUNTIME_ID,
        sessionId: inputEntry.sessionId ?? null,
        error: String(error),
      });
      throw error;
    }
  });
}

process.on("SIGTERM", () => {
  console.log("[Supervisor] SIGTERM received. Shutting down.");
  void shutdown("stopped", 0);
});

process.on("SIGINT", () => {
  console.log("[Supervisor] SIGINT received. Shutting down.");
  void shutdown("stopped", 0);
});

main().catch(async (err) => {
  console.error("[Supervisor] Fatal error:", err);
  await shutdown("error", 1);
});
