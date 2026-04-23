import type { Job } from "bullmq";
import type { ContentBlock } from "@neta-art/cohub-protocol/core";
import type { TaskPayload } from "@neta-art/cohub-protocol/task";
import { registerTask } from "./registry.js";
import { InternalApiError, registerCronjobSession, enqueuePrompt } from "../api-client.js";

/**
 * Task: send_message
 *
 * Sends a user prompt to a space session, triggering the agent to process it.
 * Reuses the same pipeline as frontend message sending.
 *
 * Payload:
 *   spaceId          — target space (required)
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
  const spaceId = payload.spaceId;
  const { content, sessionId, title, model, provider } = (payload.data ?? {}) as {
    content?: ContentBlock[];
    sessionId?: string;
    title?: string;
    model?: string;
    provider?: string;
  };

  if (!spaceId) {
    throw new Error("spaceId is required for send_message task");
  }

  if (!content || content.length === 0) {
    throw new Error("content (ContentBlock[]) is required for send_message task");
  }

  let targetSessionId = sessionId?.trim() || null;

  if (!targetSessionId) {
    const source = payload.cronJobId
      ? `cronjob:${payload.cronJobId}`
      : "cronjob:manual";

    const session = await registerCronjobSession(spaceId, {
      source,
      title: title ?? null,
    });

    targetSessionId = session.id;
  } else {
    try {
      await enqueuePrompt(spaceId, targetSessionId, {
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
        spaceId,
        messageSent: true,
      };
    } catch (error) {
      if (error instanceof InternalApiError && error.statusCode === 404) {
        const source = payload.cronJobId
          ? `cronjob:${payload.cronJobId}`
          : "cronjob:manual";

        const session = await registerCronjobSession(spaceId, {
          source,
          title: title ?? null,
        });

        targetSessionId = session.id;
      } else {
        throw error;
      }
    }
  }

  if (!targetSessionId) {
    throw new Error("sessionId is unexpectedly null after session creation");
  }

  await enqueuePrompt(spaceId, targetSessionId, {
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
    spaceId,
    messageSent: true,
  };
};

registerTask("send_message", sendMessageHandler);
