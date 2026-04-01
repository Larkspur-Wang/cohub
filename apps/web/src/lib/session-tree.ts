import type {
  SessionMessageRecord,
  SessionToolCallRecord,
} from "$lib/api";

export type ChatMessage = {
  id: string;
  role: "system" | "user" | "assistant" | "error";
  title?: string;
  text: string;
  tone?: "default" | "thinking";
  blocks?: Array<
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string }
    | {
        type: "tool_call";
        toolCallId: string;
        toolName: string;
        args?: Record<string, unknown> | null;
        status?: "pending" | "running" | "completed" | "failed";
        resultPreview?: string | null;
      }
  >;
  meta?: {
    model?: string | null;
    provider?: string | null;
    usageOutput?: number | null;
    usageInput?: number | null;
    costTotal?: string | null;
  };
};

export type ToolState = {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: "running" | "done" | "error";
  output: string;
};

export type TimelineItem =
  | {
      id: string;
      kind: "message";
      message: ChatMessage;
    }
  | {
      id: string;
      kind: "tool";
      tool: ToolState;
    };

export const stringifyUnknown = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export const renderToolPreview = (
  name: string,
  args?: Record<string, unknown>,
) => {
  if (name === "bash" && typeof args?.command === "string") {
    return `$ ${args.command}`;
  }

  if (name === "read" && typeof args?.path === "string") {
    return `read ${args.path}`;
  }

  if (name === "find" && typeof args?.pattern === "string") {
    return `find ${args.pattern}`;
  }

  if (name === "grep" && typeof args?.pattern === "string") {
    return `grep ${args.pattern}`;
  }

  if (name === "write" && typeof args?.path === "string") {
    return `write ${args.path}`;
  }

  if (name === "edit" && typeof args?.path === "string") {
    return `edit ${args.path}`;
  }

  return stringifyUnknown(args ?? {});
};

export const toChatMessages = (
  messages: SessionMessageRecord[],
  toolCalls: SessionToolCallRecord[],
): ChatMessage[] => {
  const toolCallsByMessageId = new Map<string, SessionToolCallRecord[]>();

  for (const toolCall of toolCalls) {
    const list = toolCallsByMessageId.get(toolCall.messageId) ?? [];
    list.push(toolCall);
    toolCallsByMessageId.set(toolCall.messageId, list);
  }

  return messages.map((message) => {
    const blocks: NonNullable<ChatMessage["blocks"]> = [];

    for (const block of message.content ?? []) {
      if (block.type === "text") {
        blocks.push({ type: "text", text: block.text });
      } else if (block.type === "thinking") {
        blocks.push({ type: "thinking", thinking: block.thinking });
      } else if (block.type === "tool_call") {
        blocks.push({
          type: "tool_call",
          toolCallId: block.toolCallId,
          toolName: block.toolName,
          args: block.args,
          status: block.status,
          resultPreview: block.resultPreview ?? null,
        });
      }
    }

    const associatedToolCalls = toolCallsByMessageId.get(message.id) ?? [];
    for (const toolCall of associatedToolCalls) {
      if (
        blocks.some(
          (block) =>
            block.type === "tool_call" && block.toolCallId === toolCall.toolCallId,
        )
      ) {
        continue;
      }

      blocks.push({
        type: "tool_call",
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        args: toolCall.args ?? undefined,
        status:
          toolCall.status === "failed"
            ? "failed"
            : toolCall.status === "completed"
              ? "completed"
              : toolCall.status === "running"
                ? "running"
                : toolCall.status === "pending"
                  ? "pending"
                  : undefined,
        resultPreview: toolCall.resultPreview,
      });
    }

    return {
      id: message.id,
      role: message.role,
      text: message.text ?? "",
      blocks,
      meta:
        message.role === "assistant"
          ? {
              model: message.model,
              provider: message.provider,
              usageInput: message.usageInput,
              usageOutput: message.usageOutput,
              costTotal: message.costTotal,
            }
          : undefined,
    } satisfies ChatMessage;
  });
};
