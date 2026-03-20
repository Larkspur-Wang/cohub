import { createHash } from "node:crypto";
import { env } from "./env.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type PersistAssistantMessagePayload = {
  parentMessageId: string;
  idempotencyKey: string;
  message: {
    content: Array<
      | { type: "text"; text: string }
      | { type: "image"; url: string; mimeType?: string }
      | {
          type: "tool_call";
          toolCallId: string;
          toolName: string;
          args?: unknown;
          resultPreview?: string | null;
          isError?: boolean;
        }
    >;
    text?: string | null;
    provider?: string | null;
    model?: string | null;
    stopReason?: string | null;
    errorMessage?: string | null;
    usage?: {
      input?: number;
      output?: number;
      totalTokens?: number;
      costTotal?: number;
    } | null;
  };
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    args?: unknown;
    result?: unknown;
    resultPreview?: string | null;
    isError?: boolean;
  }>;
};

const stableSerialize = (value: unknown): string => {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return `{${entries
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableSerialize(nestedValue)}`)
    .join(",")}}`;
};

const buildAssistantIdempotencyKey = (input: {
  parentMessageId: string;
  message: PersistAssistantMessagePayload["message"];
  toolCalls: PersistAssistantMessagePayload["toolCalls"];
}) => {
  return createHash("sha256")
    .update(
      stableSerialize({
        parentMessageId: input.parentMessageId,
        role: "assistant",
        message: input.message,
        toolCalls: input.toolCalls,
      }),
    )
    .digest("hex");
};

const extractTextFromContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter(
      (item): item is { type: string; text?: string } =>
        !!item && typeof item === "object" && "type" in item,
    )
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
};

const toToolCallBlocks = (
  assistantMessage: Record<string, unknown>,
  toolCalls: PersistAssistantMessagePayload["toolCalls"],
): PersistAssistantMessagePayload["message"]["content"] => {
  const content = assistantMessage.content;
  const blocks: PersistAssistantMessagePayload["message"]["content"] = [];

  if (Array.isArray(content)) {
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const block = item as Record<string, unknown>;

      if (block.type === "text" && typeof block.text === "string") {
        blocks.push({ type: "text", text: block.text });
      }

      if (
        block.type === "toolCall" &&
        typeof block.id === "string" &&
        typeof block.name === "string"
      ) {
        const matched = toolCalls.find((toolCall) => toolCall.toolCallId === block.id);
        blocks.push({
          type: "tool_call",
          toolCallId: block.id,
          toolName: block.name,
          args: block.arguments,
          resultPreview: matched?.resultPreview ?? null,
          isError: matched?.isError ?? false,
        });
      }
    }
  }

  return blocks;
};

const buildToolCalls = (toolResults: Array<Record<string, unknown>>) => {
  return toolResults.map((toolResult) => {
    const contentText = extractTextFromContent(toolResult.content);
    return {
      toolCallId: String(toolResult.toolCallId ?? ""),
      toolName: String(toolResult.toolName ?? "unknown"),
      result: toolResult,
      resultPreview: contentText || JSON.stringify(toolResult.content ?? null),
      isError: Boolean(toolResult.isError),
    };
  });
};

export async function persistAssistantMessage(input: {
  sessionId: string;
  userMessageId: string;
  event: Record<string, unknown>;
}) {
  if (!env.INTERNAL_API_TOKEN) {
    console.warn("[Persist] INTERNAL_API_TOKEN missing, skip assistant persistence.");
    return;
  }

  const assistantMessage = input.event.message;
  const toolResultsRaw = Array.isArray(input.event.toolResults)
    ? (input.event.toolResults as Array<Record<string, unknown>>)
    : [];

  if (!assistantMessage || typeof assistantMessage !== "object") {
    console.warn("[Persist] turn_end event missing assistant message payload.");
    return;
  }

  const assistant = assistantMessage as Record<string, unknown>;
  const toolCalls = buildToolCalls(toolResultsRaw);
  const content = toToolCallBlocks(assistant, toolCalls);
  const text = extractTextFromContent(assistant.content);

  const payload: PersistAssistantMessagePayload = {
    parentMessageId: input.userMessageId,
    idempotencyKey: "",
    message: {
      content,
      text,
      provider:
        typeof assistant.provider === "string" ? assistant.provider : null,
      model: typeof assistant.model === "string" ? assistant.model : null,
      stopReason:
        typeof assistant.stopReason === "string" ? assistant.stopReason : null,
      errorMessage:
        typeof assistant.errorMessage === "string"
          ? assistant.errorMessage
          : null,
      usage:
        assistant.usage && typeof assistant.usage === "object"
          ? {
              input:
                typeof (assistant.usage as Record<string, unknown>).input ===
                "number"
                  ? ((assistant.usage as Record<string, unknown>).input as number)
                  : undefined,
              output:
                typeof (assistant.usage as Record<string, unknown>).output ===
                "number"
                  ? ((assistant.usage as Record<string, unknown>).output as number)
                  : undefined,
              totalTokens:
                typeof (
                  (assistant.usage as Record<string, unknown>).totalTokens
                ) === "number"
                  ? ((assistant.usage as Record<string, unknown>).totalTokens as number)
                  : undefined,
              costTotal:
                assistant.usage &&
                typeof (assistant.usage as Record<string, unknown>).cost ===
                  "object" &&
                typeof (
                  ((assistant.usage as Record<string, unknown>).cost as Record<
                    string,
                    unknown
                  >).total
                ) === "number"
                  ? ((((assistant.usage as Record<string, unknown>).cost as Record<
                      string,
                      unknown
                    >).total as number) ?? undefined)
                  : undefined,
            }
          : null,
    },
    toolCalls,
  };

  payload.idempotencyKey = buildAssistantIdempotencyKey({
    parentMessageId: payload.parentMessageId,
    message: payload.message,
    toolCalls: payload.toolCalls,
  });

  const url = `${env.INTERNAL_API_BASE_URL}/internal/sessions/${input.sessionId}/assistant-message`;
  const maxAttempts = 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": env.INTERNAL_API_TOKEN,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Failed to persist assistant message: ${response.status} ${text}`,
        );
      }

      return;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) {
        break;
      }

      const delayMs = 300 * 2 ** (attempt - 1);
      console.warn(
        `[Persist] attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms:`,
        error,
      );
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "Unknown persistence error"));
}
