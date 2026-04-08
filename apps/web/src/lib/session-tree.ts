import type { ContentBlock, MessageRecord } from "@cohub/protocol";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: ContentBlock[];
  text: string;
  sequence: number;
  blocks?: ContentBlock[];
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
  input?: Record<string, unknown>;
  status: "running" | "done" | "failed";
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
  input?: Record<string, unknown>,
) => {
  if (name === "bash" && typeof input?.command === "string") {
    return `$ ${input.command}`;
  }

  if (name === "read" && typeof input?.path === "string") {
    return `read ${input.path}`;
  }

  if (name === "find" && typeof input?.pattern === "string") {
    return `find ${input.pattern}`;
  }

  if (name === "grep" && typeof input?.pattern === "string") {
    return `grep ${input.pattern}`;
  }

  if (name === "write" && typeof input?.path === "string") {
    return `write ${input.path}`;
  }

  if (name === "edit" && typeof input?.path === "string") {
    return `edit ${input.path}`;
  }

  return stringifyUnknown(input ?? {});
};

export const toChatMessages = (
  messages: MessageRecord[],
): ChatMessage[] => {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    text: message.text ?? "",
    sequence: message.sequence,
    blocks: [...(message.content ?? [])],
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
  } satisfies ChatMessage));
};
