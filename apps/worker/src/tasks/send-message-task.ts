import type { Job } from "bullmq";
import type { ContentBlock, TaskPayload } from "@cohub/protocol";
import { registerTask } from "./registry.js";
import { InternalApiError, registerCronjobSession, enqueuePrompt } from "../api-client.js";

/**
 * Task: send_message
 *
 * Sends a user prompt to a runtime session, triggering the agent to process it.
 * Reuses the same pipeline as frontend message sending (enqueueRuntimePrompt).
 *
 * Payload:
 *   runtimeId        — target runtime (required)
 *   userId           — owner user (required)
 *   cronJobId        — optional, set when triggered by a cronjob
 *   data.sessionId   — optional, existing session ID. If absent or not found, creates a new one
 *   data.content     — ContentBlock[] (text, images, etc.) — same as frontend POST body
 *   data.title       — session title when creating a new session
 *   data.model       — optional model override
 *   data.provider    — optional provider override
 */
const sendMessageHandler = async (job: Job) => {
  const payload = job.data as TaskPayload;
  const runtimeId = payload.runtimeId;
  const { content, sessionId, title, model, provider } = (payload.data ?? {}) as {
    content?: ContentBlock[];
    sessionId?: string;
    title?: string;
    model?: string;
    provider?: string;
  };

  if (!runtimeId) {
    throw new Error("runtimeId is required for send_message task");
  }

  if (!content || content.length === 0) {
    throw new Error("content (ContentBlock[]) is required for send_message task");
  }

  let targetSessionId = sessionId?.trim() || null;

  // If no sessionId provided, create a new session
  if (!targetSessionId) {
    const source = payload.cronJobId
      ? `cronjob:${payload.cronJobId}`
      : "cronjob:manual";

    const session = await registerCronjobSession(runtimeId, {
      source,
      title: title ?? null,
    });

    targetSessionId = session.id;
  } else {
    // sessionId provided — try to prompt it.
    // If the session doesn't exist (404), fall back to creating a new session.
    try {
      await enqueuePrompt(runtimeId, targetSessionId, {
        content,
        meta: {
          source: "cronjob",
          authorUuid: payload.userId ?? null,
          ...(model && { model }),
          ...(provider && { provider }),
        },
      });

      return {
        sessionId: targetSessionId,
        runtimeId,
        messageSent: true,
      };
    } catch (error) {
      if (error instanceof InternalApiError && error.statusCode === 404) {
        // Session not found — create a new one as fallback
        const source = payload.cronJobId
          ? `cronjob:${payload.cronJobId}`
          : "cronjob:manual";

        const session = await registerCronjobSession(runtimeId, {
          source,
          title: title ?? null,
        });

        targetSessionId = session.id;
      } else {
        throw error;
      }
    }
  }

  // Enqueue the prompt (targetSessionId is guaranteed to be a string here)
  if (!targetSessionId) {
    throw new Error("sessionId is unexpectedly null after session creation");
  }
  await enqueuePrompt(runtimeId, targetSessionId, {
    content,
    meta: {
      source: "cronjob",
      authorUuid: payload.userId ?? null,
      ...(model && { model }),
      ...(provider && { provider }),
    },
  });

  return {
    sessionId: targetSessionId,
    runtimeId,
    messageSent: true,
  };
};

registerTask("send_message", sendMessageHandler);
