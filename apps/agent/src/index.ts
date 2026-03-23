import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  createReadOnlyTools,
} from "@mariozechner/pi-coding-agent";
import { persistAssistantMessage, registerRuntimeSession } from "./api.js";
import { env } from "./env.js";
import { initializeContainer } from "./init.js";
import {
  closeRedisConnections,
  listenForInput,
  sendOutput,
  setRuntimeStatus,
} from "./redis.js";

let isShuttingDown = false;

async function shutdown(status: "stopped" | "error", exitCode: number) {
  if (isShuttingDown) {
    process.exit(exitCode);
  }

  isShuttingDown = true;

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
    runtimeOwnedSessions: true,
  });

  await initializeContainer();

  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);
  const tools = createReadOnlyTools(env.WORKSPACE_DIR);
  const sessionManager = SessionManager.create(env.WORKSPACE_DIR);

  const { session } = await createAgentSession({
    cwd: env.WORKSPACE_DIR,
    authStorage,
    modelRegistry,
    tools,
    sessionManager,
  });

  console.log("[Supervisor] Agent Session created.");

  const currentInternalSessionId = sessionManager.getSessionId();
  await registerRuntimeSession({
    runtimeId: env.RUNTIME_ID,
    sessionId: currentInternalSessionId,
    title: undefined,
    protocol: "pi",
    externalSessionId: sessionManager.getSessionFile() ?? null,
    cwd: env.WORKSPACE_DIR,
    meta: { source: "pi" },
  });

  let currentUserMessageId: string | null = null;
  let currentRuntimeSessionId: string = currentInternalSessionId;

  session.subscribe((event) => {
    void sendOutput({
      type: "agent_event",
      runtimeId: env.RUNTIME_ID,
      sessionId: currentRuntimeSessionId,
      event,
    });

    if (event.type === "turn_end" && currentUserMessageId) {
      void persistAssistantMessage({
        runtimeId: env.RUNTIME_ID,
        runtimeSessionId: currentRuntimeSessionId,
        userMessageId: currentUserMessageId,
        event: event as Record<string, unknown>,
      }).catch((error) => {
        console.error("[Supervisor] Failed to persist assistant message:", error);
      });
    }
  });

  await setRuntimeStatus("running");
  console.log("[Supervisor] Runtime is now running and listening for input.");

  await listenForInput(async (inputEntry) => {
    console.log("[Supervisor] Received input from Redis:", inputEntry);

    try {
      if (inputEntry.action === "prompt") {
        currentRuntimeSessionId = inputEntry.sessionId ?? currentInternalSessionId;
        currentUserMessageId = inputEntry.userMessageId ?? null;

        if (!inputEntry.sessionId) {
          await registerRuntimeSession({
            runtimeId: env.RUNTIME_ID,
            sessionId: currentRuntimeSessionId,
            title: undefined,
            protocol: "pi",
            externalSessionId: sessionManager.getSessionFile() ?? null,
            cwd: env.WORKSPACE_DIR,
            meta: { source: "pi", createdFromPrompt: true },
          });
        }

        await session.prompt(inputEntry.message.text, {
          images: inputEntry.message.images,
        });
      } else if (inputEntry.action === "abort") {
        await session.abort();
      }
    } catch (error) {
      console.error("[Supervisor] Error processing input:", error);
      await sendOutput({
        type: "error",
        runtimeId: env.RUNTIME_ID,
        sessionId: currentRuntimeSessionId,
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
