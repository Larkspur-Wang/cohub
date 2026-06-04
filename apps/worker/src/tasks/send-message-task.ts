import type { ContentBlock } from "@cohub/protocol/core";
import type { GenerationPolicy } from "@cohub/protocol/generation";
import type { TaskPayload } from "@cohub/protocol/task";
import { registerTask } from "./registry.js";
import { assignLabelsToSession } from "@cohub/core/labels";
import { assignSessionSourceSystemLabel } from "@cohub/core/labels/session-source";
import type { PromptAccessMode, SubmitSessionPromptContext } from "@cohub/core/sessions";
import type { SessionTurnIntent } from "@cohub/protocol/model";
import { createExecutionGrantService } from "@cohub/core/security";
import { getPromptTemplateService } from "../prompt-templates.js";
import { getSessionDomainServices } from "../session-services.js";
import { createLogger } from "@cohub/infra/logging";
import { config } from "../config.js";
import { db } from "../db.js";
import { dispatchLabelAssignmentsUpdated } from "../label-events.js";

const logger = createLogger({ serviceName: "cohub-worker" });

const executionGrantService = createExecutionGrantService({
  signingKey: config.executionGrantSigningKey,
});

const sessionPromptService = getSessionDomainServices({
  executionGrantService,
  promptTemplateService: getPromptTemplateService(),
});

const sendMessageHandler = async (job: import("bullmq").Job, context?: { taskRunId: string }) => {
  const payload = job.data as TaskPayload;
  const spaceId = payload.spaceId;
  const { content, sessionId, title, model, provider, clientMessageId, generationPolicy, accessMode, intent, labelIds } = (payload.data ?? {}) as {
    content?: ContentBlock[];
    sessionId?: string;
    title?: string;
    model?: string;
    provider?: string;
    clientMessageId?: string;
    generationPolicy?: GenerationPolicy | null;
    accessMode?: PromptAccessMode | null;
    intent?: SessionTurnIntent | null;
    labelIds?: string[];
  };

  if (!spaceId) throw new Error("spaceId is required for send_message task");
  if (!content || content.length === 0) throw new Error("content (ContentBlock[]) is required for send_message task");

  const userId = payload.userId?.trim();
  if (!userId) throw new Error("userId is required for send_message task");

  const taskRunId = (context?.taskRunId ?? String(job.id ?? "")).trim();
  if (!taskRunId) throw new Error("taskRunId is required for send_message task");

  const source = "scheduled_task";
  const targetSessionId = sessionId?.trim() || null;
  const createdSession = targetSessionId ? null : await sessionPromptService.registerCronjobSession(spaceId, { source, title: title ?? null, userUuid: userId });
  const promptSessionId = targetSessionId ?? createdSession?.id;
  if (!promptSessionId) throw new Error("sessionId is required for send_message task");
  const promptClientMessageId = payload.cronJobId?.trim()
    ? `cron:${payload.cronJobId.trim()}:run:${taskRunId}`
    : clientMessageId?.trim() || `taskrun:${taskRunId}`;

  if (labelIds && labelIds.length > 0) {
    await assignLabelsToSession({ db, spaceId, sessionId: promptSessionId, labelIds, userId });
  }
  if (createdSession) {
    await assignSessionSourceSystemLabel({ db, spaceId, sessionId: promptSessionId, source }).then(() =>
      dispatchLabelAssignmentsUpdated({ spaceId, resourceType: "session", resourceRef: promptSessionId, sessionId: promptSessionId }),
    ).catch((error) => {
      logger.warn("[SessionSourceLabel] failed to assign scheduled task source label", error);
    });
  }

  const result = await sessionPromptService.submitPrompt({
    spaceId,
    sessionId: promptSessionId,
    userId,
    clientMessageId: promptClientMessageId,
    content,
    source,
    model: model ?? null,
    provider: provider ?? null,
    generationPolicy: generationPolicy ?? null,
    accessMode: accessMode ?? "full_access",
    intent: intent ?? null,
    context: {
      kind: "scheduled_task",
      taskRunId,
      cronJobId: payload.cronJobId ?? null,
    } satisfies SubmitSessionPromptContext,
  });

  return {
    sessionId: promptSessionId,
    spaceId,
    turnId: result.turnId,
    userMessageId: result.userMessageId,
    messageSent: true,
  };
};

registerTask("send_message", sendMessageHandler);
