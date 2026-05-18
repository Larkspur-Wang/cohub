import type { ContentBlock } from "@cohub/protocol/core";
import type { TaskPayload } from "@cohub/protocol/task";
import { registerTask } from "./registry.js";
import type { SubmitSessionPromptContext } from "@cohub/core/sessions";
import { createExecutionGrantService } from "@cohub/core/security";
import { getPromptTemplateService } from "../prompt-templates.js";
import { getSessionDomainServices } from "../session-services.js";
import { config } from "../config.js";

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
  const { content, sessionId, title, model, provider, clientMessageId } = (payload.data ?? {}) as {
    content?: ContentBlock[];
    sessionId?: string;
    title?: string;
    model?: string;
    provider?: string;
    clientMessageId?: string;
  };

  if (!spaceId) throw new Error("spaceId is required for send_message task");
  if (!content || content.length === 0) throw new Error("content (ContentBlock[]) is required for send_message task");

  const userId = payload.userId?.trim();
  if (!userId) throw new Error("userId is required for send_message task");

  const taskRunId = (context?.taskRunId ?? String(job.id ?? "")).trim();
  if (!taskRunId) throw new Error("taskRunId is required for send_message task");

  const source = "scheduled_task";
  const targetSessionId = sessionId?.trim() || null;
  const promptSessionId = targetSessionId ?? (await sessionPromptService.registerCronjobSession(spaceId, { source, title: title ?? null })).id;
  const promptClientMessageId = payload.cronJobId?.trim()
    ? `cron:${payload.cronJobId.trim()}:run:${taskRunId}`
    : clientMessageId?.trim() || `taskrun:${taskRunId}`;

  const result = await sessionPromptService.submitPrompt({
    spaceId,
    sessionId: promptSessionId,
    userId,
    clientMessageId: promptClientMessageId,
    content,
    source,
    model: model ?? null,
    provider: provider ?? null,
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
