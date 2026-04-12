import type { Job } from "bullmq";
import type { TaskPayload } from "@cohub/protocol";
import { registerTask } from "./registry.js";
import { sendSessionMessage } from "../api-client.js";

/**
 * Example task: echo.
 *
 * Demonstrates the full pipeline:
 *   1. Read payload from job
 *   2. Call internal API to send a message to a session
 *   3. Return summary result
 *
 * Usage via test-helpers:
 *   npx tsx src/test-helpers.ts trigger-echo "hello" <runtimeId> <sessionId>
 */
const echoHandler = async (job: Job) => {
  const data = job.data as TaskPayload;
  const runtimeId = data.runtimeId;
  const sessionId = data.sessionId;

  if (!runtimeId || !sessionId) {
    throw new Error("runtimeId and sessionId are required for echo task");
  }

  const message = (data.data?.message as string) ?? "no message provided";
  const echoText = `[echo-task] ${message} (job: ${job.id})`;

  await sendSessionMessage(runtimeId, sessionId, {
    role: "assistant",
    content: [{ type: "text", text: echoText }],
  });

  return {
    sessionId,
    runtimeId,
    messageSent: echoText,
  };
};

registerTask("echo", echoHandler);
