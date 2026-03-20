import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  createReadOnlyTools,
} from "@mariozechner/pi-coding-agent";
import { env } from "./env.js";
import { initializeContainer } from "./init.js";
import {
  closeRedisConnections,
  listenForInput,
  sendOutput,
  setSessionStatus,
} from "./redis.js";
import { persistAssistantMessage } from "./api.js";

let isShuttingDown = false;

async function shutdown(status: "stopped" | "error", exitCode: number) {
  if (isShuttingDown) {
    process.exit(exitCode);
  }

  isShuttingDown = true;

  try {
    await setSessionStatus(status);
  } catch (error) {
    console.error(
      "[Supervisor] Failed to update session status on shutdown:",
      error,
    );
  }

  try {
    await closeRedisConnections();
  } catch (error) {
    console.error("[Supervisor] Failed to close Redis connections:", error);
  }

  process.exit(exitCode);
}

async function main() {
  console.log(`[Supervisor] Starting for Session: ${env.SESSION_ID}`);
  console.log(`[Supervisor] Workspace: ${env.WORKSPACE_DIR}`);

  // 1. Initialize Container (Clone global config, setup dirs)
  await initializeContainer();

  // 2. Setup Pi Agent SDK
  // Read auth and models from default locations (which were just cloned to ~/.pi)
  // AuthStorage will also read from environment variables (e.g., LITELLM_API_KEY)
  const authStorage = AuthStorage.create();
  const modelRegistry = new ModelRegistry(authStorage);

  // We use readOnlyTools for the first version (read, grep, find, ls)
  const tools = createReadOnlyTools(env.WORKSPACE_DIR);

  // Initialize Session Manager backed by NAS workspace
  const sessionManager = SessionManager.create(env.WORKSPACE_DIR);

  const { session } = await createAgentSession({
    cwd: env.WORKSPACE_DIR,
    authStorage,
    modelRegistry,
    tools,
    sessionManager,
  });

  console.log("[Supervisor] Agent Session created.");

  let currentUserMessageId: string | null = null;

  // 3. Subscribe to agent events and pipe to Redis
  session.subscribe((event) => {
    void sendOutput({
      type: "agent_event",
      event,
    });

    if (event.type === "turn_end" && currentUserMessageId) {
      void persistAssistantMessage({
        sessionId: env.SESSION_ID,
        userMessageId: currentUserMessageId,
        event: event as Record<string, unknown>,
      }).catch((error) => {
        console.error("[Supervisor] Failed to persist assistant message:", error);
      });
    }
  });

  // 4. Mark session as running
  await setSessionStatus("running");
  console.log("[Supervisor] Session is now running and listening for input.");

  // 5. Start listening for user messages from Redis List
  await listenForInput(async (inputEntry) => {
    console.log("[Supervisor] Received input from Redis:", inputEntry);

    try {
      if (inputEntry.action === "prompt") {
        currentUserMessageId = inputEntry.userMessageId;
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
        error: String(error),
      });
      throw error;
    }
  });
}

// Handle graceful shutdown
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
