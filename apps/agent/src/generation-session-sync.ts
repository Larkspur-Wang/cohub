import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  projectGenerationSessionMessage,
  type GenerationSessionMessage,
} from "./generation-message-projection.js";

type GenerationMessageSink = {
  getMessageMetaValues(key: string): Set<string>;
  appendMessage(message: AgentMessage, options?: { id?: string }): string;
  flush(): Promise<void>;
};

function messageMeta(message: GenerationSessionMessage) {
  return message.meta && typeof message.meta === "object" && !Array.isArray(message.meta)
    ? message.meta as Record<string, unknown>
    : {};
}

export async function appendTerminalGenerationMessages(
  messages: GenerationSessionMessage[],
  sink: GenerationMessageSink,
) {
  const terminalTaskIds = new Set(messages.flatMap((message) => {
    const meta = messageMeta(message);
    return meta.messageKind === "generation_result" &&
      (meta.generationStatus === "completed" || meta.generationStatus === "failed") &&
      typeof meta.generationTaskId === "string"
      ? [meta.generationTaskId]
      : [];
  }));
  const projected = sink.getMessageMetaValues("generationTaskId");
  const appended: AgentMessage[] = [];

  for (const message of messages) {
    const meta = messageMeta(message);
    const taskId = typeof meta.generationTaskId === "string" ? meta.generationTaskId : null;
    if (!taskId || !terminalTaskIds.has(taskId)) continue;
    const projectionKey = `${taskId}:${message.role}`;
    if (projected.has(projectionKey)) continue;
    const projectedMessage = projectGenerationSessionMessage(message);
    sink.appendMessage(projectedMessage, { id: `generation:${taskId}:${message.role}` });
    projected.add(projectionKey);
    appended.push(projectedMessage);
  }

  if (appended.length > 0) await sink.flush();
  return appended;
}
